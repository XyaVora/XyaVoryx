import { z } from "zod";
import { spawn } from "node:child_process";
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
  async run(input, context) {
    try {
      const command = input.command.trim();
      const args = input.args ?? [];

      // Block control chars and common shell metacharacters in command/args.
      const forbiddenChars = /[\u0000-\u001f\u007f;&|`$<>]/;
      if (!command || command.includes(" ") || forbiddenChars.test(command) || args.some((arg) => forbiddenChars.test(arg))) {
        return {
          stdout: "",
          stderr: "",
          exitCode: null,
          error: "Command execution blocked: invalid command or unsafe characters detected."
        };
      }

      const allowedCommands = new Set(
        (process.env.XYAVORYX_SHELL_ALLOWLIST ?? "echo,cat,ls,dir,pwd,whoami,git,node,npm,pnpm,docker")
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean)
      );

      if (!allowedCommands.has(command)) {
        return {
          stdout: "",
          stderr: "",
          exitCode: null,
          error: `Command execution blocked: command not allowed (${command}).`
        };
      }

      let execCommand = command;
      let execArgs = [...args];

      // Docker Container Sandbox Execution Mode
      if (process.env.XYAVORYX_SANDBOX_DOCKER === "true") {
        const image = process.env.XYAVORYX_SANDBOX_IMAGE ?? "node:22-alpine";
        const workspaceDir = process.cwd();
        execCommand = "docker";
        execArgs = [
          "run",
          "--rm",
          "--network=none",
          "-v", `${workspaceDir}:/workspace`,
          "-w", "/workspace",
          image,
          command,
          ...args
        ];
      }

      return await new Promise<ShellExecutorOutput>((resolve) => {
        const child = spawn(execCommand, execArgs, {
          shell: false,
          windowsHide: true,
          stdio: ["ignore", "pipe", "pipe"],
          signal: context.signal
        });

        let stdout = "";
        let stderr = "";

        child.stdout.on("data", (chunk) => {
          stdout += String(chunk);
        });
        child.stderr.on("data", (chunk) => {
          stderr += String(chunk);
        });

        child.on("error", (error) => {
          resolve({
            stdout,
            stderr,
            exitCode: null,
            error: error.message
          });
        });

        child.on("close", (code) => {
          resolve({
            stdout,
            stderr,
            exitCode: code
          });
        });
      });
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
