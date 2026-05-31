import { describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { ShellExecutorTool } from "../../packages/tools/src/shell-executor-tool";
import { FileSystemTool } from "../../packages/tools/src/file-system-tool";
import { createXyaVoryx, defineAgent } from "@xyavoryx/sdk";

describe("System and OS Tools Integration", () => {
  describe("FileSystemTool", () => {
    const testFilePath = path.resolve(process.cwd(), "temp-fs-tool-test-file.txt");

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
      expect(fileNames).toContain("temp-fs-tool-test-file.txt");

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

    it("should deny path traversal via workspace prefix confusion", async () => {
      const workspaceRoot = path.resolve(process.cwd());
      const parent = path.dirname(workspaceRoot);
      const siblingLikePrefix = `${path.basename(workspaceRoot)}-evil`;
      const outsidePath = path.resolve(parent, siblingLikePrefix, "secret.txt");

      const result = await FileSystemTool.run(
        {
          operation: "read",
          path: outsidePath
        },
        {} as any
      );

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/access denied/i);
    });
  });

  describe("ShellExecutorTool", () => {
    it("should execute shell commands correctly", async () => {
      const result = await ShellExecutorTool.run(
        {
          command: "node",
          args: ["-e", "process.stdout.write('XyaVoryx_CLI')"]
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
    });

    it("should support custom sessionId reuse and context carry-over history", async () => {
      const runtime = createXyaVoryx({});
      runtime.registerTool(FileSystemTool);

      const agent = defineAgent({
        id: "test-repl-agent",
        name: "Test REPL Agent",
        goal: "Carry over context across runs",
        tools: ["file.system"],
        workflow: [
          {
            id: "list-root",
            tool: "file.system",
            literalInput: { operation: "list", path: "." }
          }
        ],
        policies: { maxToolExecutions: 2 }
      });

      const firstResult = await runtime.runAgent(agent, {
        task: "Step 1",
        context: { sessionId: "repl-test-session-999" }
      });

      expect(firstResult.sessionId).toBe("repl-test-session-999");

      const secondResult = await runtime.runAgent(agent, {
        task: "Step 2",
        context: {
          sessionId: "repl-test-session-999",
          previousFindings: ["Found vulnerability X"]
        }
      });

      expect(secondResult.sessionId).toBe("repl-test-session-999");
    });
  });
});
