import { z } from "zod";
import { spawnSync } from "node:child_process";
import type { XyaVoryxTool } from "@xyavoryx/core";

const inputSchema = z.object({
  command: z.string(),
  args: z.array(z.string()).optional()
});

export interface ShellExecutorOutput {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  error?: string;
}

export const ShellExecutorTool: XyaVoryxTool<z.infer<typeof inputSchema>, ShellExecutorOutput> = {
  name: "shell.executor",
  description: "Execute a command on the local operating system shell. Safely inspects system state.",
  inputSchema,
  metadata: {
    tags: ["system", "os", "executor"],
    capabilities: ["execute-command", "shell"],
    riskLevel: "high",
    requiresNetwork: true,
    requiresFilesystem: true,
    timeoutMs: 10000
  },
  async run(input) {
    try {
      // Hardened Shell Injection Protection: Block dangerous shell metacharacters
      const forbiddenChars = /[;&|`$\n\r<>]/;
      if (forbiddenChars.test(input.command) || (input.args && input.args.some(arg => forbiddenChars.test(arg)))) {
        return {
          stdout: "",
          stderr: "",
          exitCode: null,
          error: "Command execution blocked: input contains forbidden shell metacharacters."
        };
      }

      const result = spawnSync(input.command, input.args ?? [], {
        shell: true,
        encoding: "utf8",
        timeout: 10000
      });

      if (result.error) {
        return {
          stdout: result.stdout ?? "",
          stderr: result.stderr ?? "",
          exitCode: result.status,
          error: result.error.message
        };
      }

      return {
        stdout: result.stdout ?? "",
        stderr: result.stderr ?? "",
        exitCode: result.status
      };
    } catch (err) {
      return {
        stdout: "",
        stderr: "",
        exitCode: null,
        error: err instanceof Error ? err.message : String(err)
      };
    }
  }
};
