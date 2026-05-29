import { describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { ShellExecutorTool } from "../../packages/tools/src/shell-executor-tool";
import { FileSystemTool } from "../../packages/tools/src/file-system-tool";
import { createXyaVoryx, defineAgent } from "@xyavoryx/sdk";

describe("System and OS Tools Integration", () => {
  describe("FileSystemTool", () => {
    const testFilePath = path.resolve(process.cwd(), "temp-test-file.txt");

    it("should write, read, and list files", async () => {
      // 1. Write file
      const writeResult = await FileSystemTool.run(
        {
          operation: "write",
          path: testFilePath,
          content: "Hello, XyaVoryx!"
        },
        {} as any
      );
      expect(writeResult.success).toBe(true);

      // 2. Read file
      const readResult = await FileSystemTool.run(
        {
          operation: "read",
          path: testFilePath
        },
        {} as any
      );
      expect(readResult.success).toBe(true);
      expect(readResult.content).toBe("Hello, XyaVoryx!");

      // 3. List directory
      const listResult = await FileSystemTool.run(
        {
          operation: "list",
          path: process.cwd()
        },
        {} as any
      );
      expect(listResult.success).toBe(true);
      const fileNames = listResult.files?.map((f) => f.name);
      expect(fileNames).toContain("temp-test-file.txt");

      // Cleanup
      if (fs.existsSync(testFilePath)) {
        fs.unlinkSync(testFilePath);
      }
    });

    it("should return failure for missing files", async () => {
      const readResult = await FileSystemTool.run(
        {
          operation: "read",
          path: "non-existent-file.txt"
        },
        {} as any
      );
      expect(readResult.success).toBe(false);
      expect(readResult.error).toMatch(/file not found/i);
    });
  });

  describe("ShellExecutorTool", () => {
    it("should execute shell commands correctly", async () => {
      const result = await ShellExecutorTool.run(
        {
          command: "echo XyaVoryx_CLI"
        },
        {} as any
      );

      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toBe("XyaVoryx_CLI");
      expect(result.error).toBeUndefined();
    });
  });

  describe("Runtime Policy Approval Integration", () => {
    it("should intercept and enforce interactive policy approval hook in the runner", async () => {
      const approvalSpy = vi.fn().mockResolvedValue(false);

      const runtime = createXyaVoryx({
        approvalHook: approvalSpy
      });
      runtime.registerTool(ShellExecutorTool);

      const agent = defineAgent({
        id: "test-approval-agent",
        name: "Test Approval Agent",
        goal: "Run shell commands",
        tools: ["shell.executor"],
        workflow: [
          {
            id: "run-shell",
            tool: "shell.executor",
            inputFrom: "rawInput",
            inputKey: "command"
          }
        ],
        policies: {
          maxToolExecutions: 5
        }
      });

      const result = await runtime.runAgent(agent, {
        task: "Run command",
        rawInput: "echo Hello"
      });

      expect(result.status).toBe("blocked");
      expect(result.trace.toolExecutions[0].status).toBe("blocked");
      expect(approvalSpy).toHaveBeenCalledTimes(1);
    });
  });
});
