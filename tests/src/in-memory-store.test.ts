import { describe, expect, it } from "vitest";
import { InMemoryStore } from "../../packages/memory/src/in-memory-store";

describe("InMemoryStore", () => {
  it("stores and retrieves session and case records", async () => {
    const store = new InMemoryStore();

    await store.createSession({
      id: "session-1",
      agentName: "Agent",
      task: "Task",
      status: "created",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z"
    });

    await store.createCase({
      id: "case-1",
      sessionId: "session-1",
      createdAt: "2026-01-01T00:00:00.000Z",
      input: {
        task: "Task",
        rawInput: "raw"
      }
    });

    expect((await store.getSession("session-1"))?.agentName).toBe("Agent");
    expect((await store.getCase("case-1"))?.input.rawInput).toBe("raw");
  });

  it("stores findings and traces", async () => {
    const store = new InMemoryStore();

    await store.addFinding({
      id: "finding-1",
      caseId: "case-1",
      sessionId: "session-1",
      title: "Indicator",
      severity: "medium",
      description: "desc",
      createdAt: "2026-01-01T00:00:00.000Z"
    });

    await store.saveTrace("case-1", {
      sessionId: "session-1",
      caseId: "case-1",
      agentName: "Agent",
      startedAt: "2026-01-01T00:00:00.000Z",
      completedAt: "2026-01-01T00:00:01.000Z",
      toolExecutions: [],
      events: []
    });

    expect((await store.getFindings("case-1"))).toHaveLength(1);
    expect((await store.getTrace("case-1"))?.agentName).toBe("Agent");
  });
});