import type { AgentInput, AgentConfig, WorkflowPlan } from "@xyavoryx/core";

export class DeterministicPlanner {
  buildPlan(agent: AgentConfig, input: AgentInput): WorkflowPlan {
    const steps = (agent.workflow ?? []).map((step) => {
      let resolvedInput: unknown;

      if (step.inputFrom === "rawInput") {
        resolvedInput = input.rawInput;
      } else if (step.inputFrom === "task") {
        resolvedInput = input.task;
      } else if (step.inputFrom === "context") {
        resolvedInput = step.contextKey ? input.context?.[step.contextKey] : input.context;
      } else if (step.inputFrom === "stepOutput") {
        resolvedInput = undefined;
      } else {
        resolvedInput = step.literalInput;
      }

      const mappedInput = step.inputKey
        ? { [step.inputKey]: resolvedInput }
        : resolvedInput;
      // Normalize retry counts to a stable non-negative integer.
      const maxRetries =
        typeof step.maxRetries === "number" && step.maxRetries > 0
          ? Math.floor(step.maxRetries)
          : 0;
      // Default deterministic behavior: all conditions must match, stop on failure.
      const runIfMode: "all" | "any" = step.runIfMode === "any" ? "any" : "all";
      const runIf = step.runIf ? [...step.runIf] : [];
      const onFailure = step.onFailure?.action === "fallback"
        ? {
            action: "fallback" as const,
            fallbackStepId: step.onFailure.fallbackStepId
          }
        : step.onFailure?.action === "continue"
          ? { action: "continue" as const }
          : { action: "stop" as const };

      return {
        id: step.id,
        tool: step.tool,
        inputFrom: step.inputFrom,
        contextKey: step.contextKey,
        sourceStepId: step.sourceStepId,
        valuePath: step.valuePath,
        inputKey: step.inputKey,
        literalInput: step.literalInput,
        input: mappedInput,
        maxRetries,
        runIf,
        runIfMode,
        onFailure,
        project: step.project
      };
    });

    return { steps };
  }
}
