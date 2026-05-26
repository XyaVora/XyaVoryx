import { describe, expect, it } from "vitest";
import type { AgentConfig } from "../../packages/core/src";
import { InMemoryStore } from "../../packages/memory/src/in-memory-store";
import { MockLLMProvider } from "../../packages/providers/src/mock-llm-provider";
import { DeterministicRuntimeContext } from "../../packages/runtime/src/deterministic-runtime-context";
import { XyaVoryx } from "../../packages/runtime/src/xyavoryx";
import { StacktraceParserTool } from "../../packages/tools/src/stacktrace-parser-tool";
import { TestOutputParserTool } from "../../packages/tools/src/test-output-parser-tool";

const BUG_INPUT = [
  "TypeError: Cannot read properties of undefined (reading 'id')",
  "    at parseUser (src/services/user.ts:42:15)",
  "FAIL tests/profile.test.ts",
  "  x should build profile for active user",
  "  AssertionError: expected true to be false"
].join("\n");

function bugbotAgent(): AgentConfig {
  return {
    id: "bugbot-agent",
    name: "Bugbot Agent",
    goal: "Deterministic bug triage",
    tools: ["stacktrace.parser", "test.output.parser"],
    workflow: [
      {
        id: "stacktrace-parse",
        tool: "stacktrace.parser",
        inputFrom: "rawInput",
        inputKey: "stacktrace"
      },
      {
        id: "test-output-parse",
        tool: "test.output.parser",
        inputFrom: "rawInput",
        inputKey: "output"
      }
    ],
    policies: {
      allowNetwork: false,
      allowFilesystem: false
    }
  };
}

describe("Bugbot agent e2e", () => {
  it("generates bug findings and trace evidence", async () => {
    const memory = new InMemoryStore();
    const runtime = new XyaVoryx({
      memory,
      runtimeContext: new DeterministicRuntimeContext(Date.UTC(2026, 0, 1, 0, 0, 0, 0))
    });

    runtime.registerProvider(new MockLLMProvider());
    runtime.registerTool(StacktraceParserTool);
    runtime.registerTool(TestOutputParserTool);

    const result = await runtime.runAgent(bugbotAgent(), {
      task: "Triage failing CI signal",
      rawInput: BUG_INPUT
    });

    expect(result.status).toBe("completed");
    expect(result.trace.toolExecutions).toHaveLength(2);
    expect(result.findings.length).toBeGreaterThan(0);
    expect(result.findings.some((finding) => finding.title.includes("signature") || finding.title.includes("Test"))).toBe(true);
    expect(result.trace.events.some((event) => event.type === "finding.created")).toBe(true);
  });
});