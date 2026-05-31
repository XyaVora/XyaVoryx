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

      let execCommand = input.command;
      let execArgs = input.args ?? [];

      // Docker Container Sandbox Execution Mode
      if (process.env.XYAVORYX_SANDBOX_DOCKER === "true") {
        const image = process.env.XYAVORYX_SANDBOX_IMAGE ?? "node:22-alpine";
        const workspaceDir = process.cwd();
        execCommand = "docker";
        execArgs = [
          "run",
          "--rm",
          "-v", `${workspaceDir}:/workspace`,
          "-w", "/workspace",
          image,
          "sh", "-c", `${input.command} ${execArgs.join(" ")}`
        ];
      }

      const result = spawnSync(execCommand, execArgs, {
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
