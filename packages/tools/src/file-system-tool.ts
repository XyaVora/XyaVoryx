import { z } from "zod";
import * as fs from "node:fs";
import * as path from "node:path";
import type { XyaVoryxTool } from "@xyavoryx/core";

const inputSchema = z.object({
  operation: z.enum(["read", "write", "list"]),
  path: z.string(),
  content: z.string().optional()
});

export interface FileSystemOutput {
  success: boolean;
  content?: string;
  files?: Array<{ name: string; isDirectory: boolean; size?: number }>;
  error?: string;
}

export const FileSystemTool: XyaVoryxTool<z.infer<typeof inputSchema>, FileSystemOutput> = {
  name: "file.system",
  description: "Read files, write files, or list directory contents on the local filesystem.",
  inputSchema,
  metadata: {
    tags: ["filesystem", "files", "io"],
    capabilities: ["read-file", "write-file", "list-dir"],
    riskLevel: "medium",
    requiresFilesystem: true
  },
  async run(input, context) {
    const resolvedPath = path.resolve(input.path);
    const workspaceRoot = path.resolve(process.cwd());

    // Path Traversal Mitigation: Ensure target path remains strictly within authorized workspace root
    if (!resolvedPath.startsWith(workspaceRoot)) {
      return {
        success: false,
        error: `Access denied: Path '${input.path}' lies outside the authorized workspace directory.`
      };
    }

    try {
      if (input.operation === "read") {
        if (!fs.existsSync(resolvedPath)) {
          return { success: false, error: `File not found: ${input.path}` };
        }
        const stats = fs.statSync(resolvedPath);
        if (stats.isDirectory()) {
          return { success: false, error: `Path is a directory: ${input.path}` };
        }
        const fileContent = fs.readFileSync(resolvedPath, "utf8");
        return { success: true, content: fileContent };
      }

      if (input.operation === "write") {
        if (input.content === undefined) {
          return { success: false, error: "Content is required for write operation." };
        }

        // Auto-Rollback Engine Backup Logic
        if (context && context.caseId) {
          const caseId = context.caseId;
          const backupDir = path.resolve(process.cwd(), ".xyavoryx-backup", caseId);
          const manifestPath = path.join(backupDir, "manifest.json");

          if (fs.existsSync(resolvedPath)) {
            try {
              if (!fs.existsSync(backupDir)) {
                fs.mkdirSync(backupDir, { recursive: true });
              }

              // Read original content
              const originalContent = fs.readFileSync(resolvedPath, "utf8");

              // Compute backup filename
              const randSuffix = Math.random().toString(36).substring(2, 7);
              const backupFilename = `backup-${Date.now()}-${randSuffix}.bak`;
              const backupFilePath = path.join(backupDir, backupFilename);

              // Write backup file
              fs.writeFileSync(backupFilePath, originalContent, "utf8");

              // Read existing manifest or initialize new
              let manifest: Record<string, string> = {};
              if (fs.existsSync(manifestPath)) {
                try {
                  manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
                } catch {
                  // Fallback
                }
              }

              // Only backup the absolute original state of the file before the agent's first write
              if (!manifest[resolvedPath]) {
                manifest[resolvedPath] = backupFilename;
                fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
              }
            } catch (err) {
              if (context.logger) {
                context.logger.warn(`Failed to create rollback backup for ${resolvedPath}: ${err}`);
              }
            }
          }
        }

        const dir = path.dirname(resolvedPath);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(resolvedPath, input.content, "utf8");
        return { success: true };
      }

      if (input.operation === "list") {
        if (!fs.existsSync(resolvedPath)) {
          return { success: false, error: `Directory not found: ${input.path}` };
        }
        const stats = fs.statSync(resolvedPath);
        if (!stats.isDirectory()) {
          return { success: false, error: `Path is not a directory: ${input.path}` };
        }

        const entries = fs.readdirSync(resolvedPath, { withFileTypes: true });
        const files = entries.map((entry) => {
          const entryPath = path.join(resolvedPath, entry.name);
          let size: number | undefined;
          if (entry.isFile()) {
            try {
              size = fs.statSync(entryPath).size;
            } catch {
              // Ignore file stat errors
            }
          }
          return {
            name: entry.name,
            isDirectory: entry.isDirectory(),
            size
          };
        });

        return { success: true, files };
      }

      return { success: false, error: `Unsupported operation: ${input.operation}` };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err)
      };
    }
  }
};
