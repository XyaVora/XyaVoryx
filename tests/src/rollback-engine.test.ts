import { describe, expect, it, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { FileSystemTool } from "../../packages/tools/src/file-system-tool";
import { AgentRunner } from "../../packages/runtime/src/agent-runner";
import { InMemoryStore } from "../../packages/memory/src/in-memory-store";
import { DeterministicRuntimeContext } from "../../packages/runtime/src/deterministic-runtime-context";
import { EventBus } from "../../packages/runtime/src/event-bus";
import { ToolRegistry } from "../../packages/runtime/src/tool-registry";
import { ProviderRegistry } from "../../packages/runtime/src/provider-registry";
import { DeterministicPlanner } from "../../packages/runtime/src/deterministic-planner";
import { PolicyEngine } from "../../packages/runtime/src/policy-engine";
import { PolicyProfileRegistry } from "../../packages/runtime/src/policy-profile-registry";
import { ToolExecutor } from "../../packages/runtime/src/tool-executor";
import { ConsoleLogger } from "../../packages/runtime/src/console-logger";
import type { AgentConfig } from "../../packages/core/src";

describe("Auto-Rollback Engine", () => {
  const testFile = path.resolve(process.cwd(), "temp-test-file.txt");
  const backupDir = path.resolve(process.cwd(), ".xyavoryx-backup");

  beforeEach(() => {
    // Write original file
    fs.writeFileSync(testFile, "Original Content", "utf8");
  });

  afterEach(() => {
    // Cleanup files
    if (fs.existsSync(testFile)) {
      fs.unlinkSync(testFile);
    }
    if (fs.existsSync(backupDir)) {
      fs.rmSync(backupDir, { recursive: true, force: true });
    }
  });

  it("should automatically restore the original file state if the agent runner execution fails", async () => {
    // Initialize dependencies
    const memory = new InMemoryStore();
    const logger = new ConsoleLogger();
    const runtimeContext = new DeterministicRuntimeContext();
    const eventBus = new EventBus();
    const toolRegistry = new ToolRegistry();
    const providerRegistry = new ProviderRegistry();
    const planner = new DeterministicPlanner();
    const policyEngine = new PolicyEngine({ approvalHook: async () => true });
    const policyProfiles = new PolicyProfileRegistry();
    const toolExecutor = new ToolExecutor();

    // Register FileSystemTool
    toolRegistry.register(FileSystemTool);

    const runner = new AgentRunner({
      memory,
      logger,
      runtimeContext,
      eventBus,
      toolRegistry,
      providerRegistry,
      planner,
      policyEngine,
      policyProfiles,
      toolExecutor
    });

    // Define an agent with a workflow that writes to the file, and then deliberately FAILS on the next step
    const agent: AgentConfig = {
      id: "rollback-agent",
      name: "Rollback Test Agent",
      goal: "Modify a file and fail",
      tools: ["file.system"],
      workflow: [
        {
          id: "step-write",
          tool: "file.system",
          literalInput: {
            operation: "write",
            path: testFile,
            content: "Modified Content By Agent"
          }
        },
        {
          id: "step-fail",
          tool: "invalid.tool", // Deliberate failure step
          literalInput: {}
        }
      ],
      policies: {
        maxToolExecutions: 5
      }
    };

    // Run the agent
    const result = await runner.run(agent, { task: "Run test" });

    // Assert that the runner failed as planned
    expect(result.status).toBe("failed");

    // Assert that the file is rolled back and restored back to "Original Content"!
    const fileContent = fs.readFileSync(testFile, "utf8");
    expect(fileContent).toBe("Original Content");

    // Assert that the temporary backup folder has been cleaned up and deleted!
    const caseBackupDir = path.join(backupDir, result.caseId);
    expect(fs.existsSync(caseBackupDir)).toBe(false);
  });

  it("should preserve modified changes and clean up backups if the agent runner completes successfully", async () => {
    const memory = new InMemoryStore();
    const logger = new ConsoleLogger();
    const runtimeContext = new DeterministicRuntimeContext();
    const eventBus = new EventBus();
    const toolRegistry = new ToolRegistry();
    const providerRegistry = new ProviderRegistry();
    const planner = new DeterministicPlanner();
    const policyEngine = new PolicyEngine({ approvalHook: async () => true });
    const policyProfiles = new PolicyProfileRegistry();
    const toolExecutor = new ToolExecutor();

    toolRegistry.register(FileSystemTool);

    const runner = new AgentRunner({
      memory,
      logger,
      runtimeContext,
      eventBus,
      toolRegistry,
      providerRegistry,
      planner,
      policyEngine,
      policyProfiles,
      toolExecutor
    });

    const agent: AgentConfig = {
      id: "completed-agent",
      name: "Completed Test Agent",
      goal: "Modify a file successfully",
      tools: ["file.system"],
      workflow: [
        {
          id: "step-write",
          tool: "file.system",
          literalInput: {
            operation: "write",
            path: testFile,
            content: "Successfully Saved Content"
          }
        }
      ],
      policies: {
        maxToolExecutions: 5
      }
    };

    const result = await runner.run(agent, { task: "Run test" });

    // Assert runner succeeded
    expect(result.status).toBe("completed");

    // Assert that the changes are preserved!
    const fileContent = fs.readFileSync(testFile, "utf8");
    expect(fileContent).toBe("Successfully Saved Content");

    // Assert backup directory is fully cleaned up
    const caseBackupDir = path.join(backupDir, result.caseId);
    expect(fs.existsSync(caseBackupDir)).toBe(false);
  });

  it("should skip rollback restore when manifest points outside workspace", async () => {
    const memory = new InMemoryStore();
    const logger = new ConsoleLogger();
    const runtimeContext = new DeterministicRuntimeContext();
    const eventBus = new EventBus();
    const toolRegistry = new ToolRegistry();
    const providerRegistry = new ProviderRegistry();
    const planner = new DeterministicPlanner();
    const policyEngine = new PolicyEngine({ approvalHook: async () => true });
    const policyProfiles = new PolicyProfileRegistry();
    const toolExecutor = new ToolExecutor();

    const runner = new AgentRunner({
      memory,
      logger,
      runtimeContext,
      eventBus,
      toolRegistry,
      providerRegistry,
      planner,
      policyEngine,
      policyProfiles,
      toolExecutor
    });

    const caseId = "case-malicious";
    const caseBackupDir = path.join(backupDir, caseId);
    fs.mkdirSync(caseBackupDir, { recursive: true });

    const outsideTarget = path.resolve(process.cwd(), "..", "outside-target.txt");
    const outsideOriginal = "outside-original";
    fs.writeFileSync(outsideTarget, outsideOriginal, "utf8");

    const backupPayloadName = "outside-target.bak";
    fs.writeFileSync(path.join(caseBackupDir, backupPayloadName), "malicious-overwrite", "utf8");
    fs.writeFileSync(
      path.join(caseBackupDir, "manifest.json"),
      JSON.stringify({ [outsideTarget]: backupPayloadName }, null, 2),
      "utf8"
    );

    await (runner as any).triggerRollback(caseId, () => undefined);

    expect(fs.readFileSync(outsideTarget, "utf8")).toBe(outsideOriginal);
    fs.unlinkSync(outsideTarget);
  });
});
