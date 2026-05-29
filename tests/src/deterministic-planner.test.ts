import { describe, expect, it } from "vitest";
import type { AgentConfig, AgentInput } from "../../packages/core/src";
import { DeterministicPlanner } from "../../packages/runtime/src/deterministic-planner";

function buildAgent(workflow: AgentConfig["workflow"]): AgentConfig {
  return {
    id: "planner-agent",
    name: "Planner Agent",
    goal: "Validate deterministic planning",
    tools: workflow.map((step) => step.tool),
    workflow
  };
}

describe("DeterministicPlanner", () => {
  it("maps step inputs deterministically from all sources", () => {
    const planner = new DeterministicPlanner();
    const agent = buildAgent([
      {
        id: "from-raw",
        tool: "raw.tool",
        inputFrom: "rawInput",
        inputKey: "text"
      },
      {
        id: "from-task",
        tool: "task.tool",
        inputFrom: "task"
      },
      {
        id: "from-context",
        tool: "context.tool",
        inputFrom: "context",
        contextKey: "payload"
      },
      {
        id: "from-literal",
        tool: "literal.tool",
        inputFrom: "literal",
        literalInput: { value: 1 }
      },
      {
        id: "from-step-output",
        tool: "step-output.tool",
        inputFrom: "stepOutput",
        sourceStepId: "from-literal",
        valuePath: "value",
        inputKey: "text"
      }
    ]);

    const input: AgentInput = {
      task: "investigate",
      rawInput: "raw body",
      context: {
        payload: {
          source: "ctx"
        }
      }
    };

    const plan = planner.buildPlan(agent, input);
    expect(plan.steps).toHaveLength(5);
    expect(plan.steps[0]?.input).toEqual({ text: "raw body" });
    expect(plan.steps[1]?.input).toBe("investigate");
    expect(plan.steps[2]?.input).toEqual({ source: "ctx" });
    expect(plan.steps[3]?.input).toEqual({ value: 1 });
    expect(plan.steps[4]?.input).toEqual({ text: undefined });
    expect(plan.steps[4]?.sourceStepId).toBe("from-literal");
    expect(plan.steps[4]?.valuePath).toBe("value");
  });

  it("normalizes defaults and retry values deterministically", () => {
    const planner = new DeterministicPlanner();
    const runIf = [
      {
        source: "task" as const,
        operator: "exists" as const
      }
    ];
    const agent = buildAgent([
      {
        id: "defaults",
        tool: "default.tool",
        inputFrom: "task"
      },
      {
        id: "retry-rounded",
        tool: "retry.tool",
        inputFrom: "task",
        maxRetries: 2.8,
        runIf,
        runIfMode: "any",
        onFailure: {
          action: "continue"
        }
      },
      {
        id: "retry-invalid",
        tool: "invalid.tool",
        inputFrom: "task",
        maxRetries: -1
      }
    ]);

    const plan = planner.buildPlan(agent, { task: "run" });

    expect(plan.steps[0]?.maxRetries).toBe(0);
    expect(plan.steps[0]?.runIf).toEqual([]);
    expect(plan.steps[0]?.runIfMode).toBe("all");
    expect(plan.steps[0]?.onFailure).toEqual({ action: "stop" });

    expect(plan.steps[1]?.maxRetries).toBe(2);
    expect(plan.steps[1]?.runIfMode).toBe("any");
    expect(plan.steps[1]?.onFailure).toEqual({ action: "continue" });
    expect(plan.steps[1]?.runIf).toEqual(runIf);
    expect(plan.steps[1]?.runIf).not.toBe(runIf);

    expect(plan.steps[2]?.maxRetries).toBe(0);
  });

  it("keeps fallback recovery configuration when provided", () => {
    const planner = new DeterministicPlanner();
    const agent = buildAgent([
      {
        id: "step-fail",
        tool: "fail.tool",
        inputFrom: "task",
        onFailure: {
          action: "fallback",
          fallbackStepId: "step-rescue"
        }
      }
    ]);

    const plan = planner.buildPlan(agent, { task: "run" });
    expect(plan.steps[0]?.onFailure).toEqual({
      action: "fallback",
      fallbackStepId: "step-rescue"
    });
  });
});
