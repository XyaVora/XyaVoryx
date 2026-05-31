import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { ShellExecutorTool } from "../../packages/tools/src/shell-executor-tool";

class MockChildProcess extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
}

// Mock child_process spawn
vi.mock("node:child_process", () => ({
  spawn: vi.fn()
}));

describe("Docker Sandbox Executor Mode", () => {
  const originalEnv = process.env.XYAVORYX_SANDBOX_DOCKER;
  const originalImage = process.env.XYAVORYX_SANDBOX_IMAGE;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(spawn).mockImplementation(() => {
      const child = new MockChildProcess() as any;
      setImmediate(() => {
        child.stdout.emit("data", "Mocked stdout");
        child.emit("close", 0);
      });
      return child;
    });
  });

  afterEach(() => {
    process.env.XYAVORYX_SANDBOX_DOCKER = originalEnv;
    process.env.XYAVORYX_SANDBOX_IMAGE = originalImage;
  });

  it("should execute shell commands inside Docker container sandbox if XYAVORYX_SANDBOX_DOCKER is true", async () => {
    process.env.XYAVORYX_SANDBOX_DOCKER = "true";
    process.env.XYAVORYX_SANDBOX_IMAGE = "custom-node-image:latest";

    const result = await ShellExecutorTool.run({
      command: "npm",
      args: ["test", "--pass"]
    }, {} as any);

    expect(result.exitCode).toBe(0);

    expect(spawn).toHaveBeenCalledOnce();
    const [execCmd, execArgs] = vi.mocked(spawn).mock.calls[0];

    expect(execCmd).toBe("docker");
    expect(execArgs).toEqual([
      "run",
      "--rm",
      "--network=none",
      "-v", `${process.cwd()}:/workspace`,
      "-w", "/workspace",
      "custom-node-image:latest",
      "npm",
      "test",
      "--pass"
    ]);
  });

  it("should run commands directly on the host shell if XYAVORYX_SANDBOX_DOCKER is not set", async () => {
    process.env.XYAVORYX_SANDBOX_DOCKER = undefined;

    const result = await ShellExecutorTool.run({
      command: "echo",
      args: ["Hello"]
    }, {} as any);

    expect(result.exitCode).toBe(0);

    expect(spawn).toHaveBeenCalledOnce();
    const [execCmd, execArgs] = vi.mocked(spawn).mock.calls[0];

    expect(execCmd).toBe("echo");
    expect(execArgs).toEqual(["Hello"]);
  });

  it("blocks commands not in allowlist", async () => {
    process.env.XYAVORYX_SANDBOX_DOCKER = undefined;

    const result = await ShellExecutorTool.run(
      {
        command: "powershell",
        args: ["-Command", "Get-ChildItem"]
      },
      {} as any
    );

    expect(result.exitCode).toBeNull();
    expect(result.error).toMatch(/not allowed/i);
    expect(spawn).not.toHaveBeenCalled();
  });
});
