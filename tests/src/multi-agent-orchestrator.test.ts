import { describe, expect, it } from "vitest";
import type { AgentConfig } from "../../packages/core/src";
import { InMemoryStore } from "../../packages/memory/src/in-memory-store";
import { MockLLMProvider } from "../../packages/providers/src/mock-llm-provider";
import { XyaVoryx } from "../../packages/runtime/src/xyavoryx";
import { MultiAgentOrchestrator } from "../../packages/runtime/src/multi-agent-orchestrator";

describe("MultiAgentOrchestrator", () => {
  it("executes sequential agent pipelines and consolidates reports", async () => {
    const memory = new InMemoryStore();
    const provider = new MockLLMProvider({
      defaultResponse: JSON.stringify({
        thought: "Mock thought",
        action: "finish",
        report: "Mock output report"
      })
    });

    const runtime = new XyaVoryx({ memory });
    runtime.registerProvider(provider);

    const agent1: AgentConfig = {
      id: "agent-1",
      name: "Triage Agent",
      goal: "Analyze high level alerts",
      tools: [],
      plannerMode: "autonomous"
    };

    const agent2: AgentConfig = {
      id: "agent-2",
      name: "Remediation Agent",
      goal: "Draft fix details",
      tools: [],
      plannerMode: "autonomous"
    };

    const orchestrator = new MultiAgentOrchestrator(runtime);
    const result = await orchestrator.runPipeline([agent1, agent2], "Analyze workspace alerts");

    expect(result.sessionId).toBeDefined();
    expect(result.status).toBe("completed");
    expect(result.reports.length).toBe(2);
    expect(result.reports[0].agentName).toBe("Triage Agent");
    expect(result.reports[1].agentName).toBe("Remediation Agent");
    expect(result.consolidatedReport).toContain("# Consolidated Executive Security Report");
    expect(result.consolidatedReport).toContain("Triage Agent");
    expect(result.consolidatedReport).toContain("Remediation Agent");
  });
});
