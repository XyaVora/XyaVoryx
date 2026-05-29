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
  async run(input) {
    const resolvedPath = path.resolve(input.path);

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
