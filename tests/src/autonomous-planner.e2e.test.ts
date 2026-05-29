// Test coverage mapping for autonomous-planner.ts
// The AutonomousPlanner is exercised end-to-end through the autonomous-agent tests
// which invoke runtime.runAgent with plannerMode: "autonomous".
import { describe, expect, it } from "vitest";
import { MockLLMProvider } from "../../packages/providers/src/mock-llm-provider";
import { AutonomousPlanner } from "../../packages/runtime/src/autonomous-planner";

describe("AutonomousPlanner unit", () => {
  it("returns a finish decision when the LLM outputs a finish action", async () => {
    const provider = new MockLLMProvider({
      responses: {
        "No observations recorded yet.": JSON.stringify({
          thought: "Nothing to investigate, finishing.",
          action: "finish",
          report: "# Empty Report\n\nNo data to analyze."
        })
      }
    });

    const planner = new AutonomousPlanner(provider);

    const decision = await planner.planNextAction(
      {
        id: "planner-test-1",
        name: "Test Planner Agent",
        goal: "Test the planner",
        tools: [],
        plannerMode: "autonomous"
      },
      {
        task: "Test planning",
        rawInput: "test"
      },
      {
        observations: [],
        findings: [],
        availableTools: []
      }
    );

    expect(decision.action).toBe("finish");
    expect(decision.report).toContain("# Empty Report");
  });

  it("returns a call decision when the LLM requests a tool invocation", async () => {
    const provider = new MockLLMProvider({
      responses: {
        "No observations recorded yet.": JSON.stringify({
          thought: "I need to analyze the email header first.",
          action: "call",
          tool: "email.header.analyzer",
          input: { rawEmail: "From: test@test.com" }
        })
      }
    });

    const planner = new AutonomousPlanner(provider);

    const decision = await planner.planNextAction(
      {
        id: "planner-test-2",
        name: "Call Planner Agent",
        goal: "Test tool calling",
        tools: ["email.header.analyzer"],
        plannerMode: "autonomous"
      },
      {
        task: "Analyze email",
        rawInput: "From: test@test.com"
      },
      {
        observations: [],
        findings: [],
        availableTools: [
          {
            name: "email.header.analyzer",
            description: "Analyzes email headers",
            execute: async () => ({ success: true, output: {} })
          }
        ]
      }
    );

    expect(decision.action).toBe("call");
    expect(decision.tool).toBe("email.header.analyzer");
  });

  it("gracefully handles unparseable LLM output with a fallback finish decision", async () => {
    const provider = new MockLLMProvider({
      responses: {
        "No observations recorded yet.": "This is not valid JSON at all, the model went rogue"
      }
    });

    const planner = new AutonomousPlanner(provider);

    const decision = await planner.planNextAction(
      {
        id: "planner-test-3",
        name: "Fallback Planner Agent",
        goal: "Test fallback",
        tools: [],
        plannerMode: "autonomous"
      },
      {
        task: "Test fallback behavior",
        rawInput: "test"
      },
      {
        observations: [],
        findings: [],
        availableTools: []
      }
    );

    expect(decision.action).toBe("finish");
    expect(decision.thought).toContain("Failed to parse");
    expect(decision.report).toContain("Investigation aborted");
  });
});
