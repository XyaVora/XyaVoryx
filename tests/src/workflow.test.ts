import { describe, expect, it } from "vitest";
import type { ExecutablePlanStep, WorkflowStep } from "../../packages/core/src";

describe("Workflow contracts", () => {
  it("supports deterministic step-output input mapping fields", () => {
    const workflowStep: WorkflowStep = {
      id: "step-consumer",
      tool: "consumer.tool",
      inputFrom: "stepOutput",
      sourceStepId: "step-producer",
      valuePath: "nested.token",
      inputKey: "text"
    };

    expect(workflowStep.inputFrom).toBe("stepOutput");
    expect(workflowStep.sourceStepId).toBe("step-producer");
    expect(workflowStep.valuePath).toBe("nested.token");
    expect(workflowStep.inputKey).toBe("text");
  });

  it("keeps executable step metadata required for deterministic runtime input resolution", () => {
    const planStep: ExecutablePlanStep = {
      id: "step-consumer",
      tool: "consumer.tool",
      inputFrom: "stepOutput",
      sourceStepId: "step-producer",
      valuePath: "nested.token",
      inputKey: "text",
      input: { text: undefined },
      maxRetries: 0,
      runIf: [],
      runIfMode: "all",
      onFailure: { action: "stop" }
    };

    expect(planStep.inputFrom).toBe("stepOutput");
    expect(planStep.sourceStepId).toBe("step-producer");
    expect(planStep.valuePath).toBe("nested.token");
  });
});
