import { describe, expect, it } from "vitest";
import { SqliteMemoryStore } from "../../packages/memory/src/sqlite-memory-store";
import type { Finding } from "../../packages/core/src";

describe("SqliteMemoryStore", () => {
  it("manages session records and updates status cleanly", async () => {
    const store = new SqliteMemoryStore(); // In-memory database Sync mode
    const session = {
      id: "session-abc",
      agentName: "Triage Agent",
      task: "Scan files",
      status: "created" as const,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    await store.createSession(session);
    const retrieved = await store.getSession("session-abc");
    expect(retrieved).toBeDefined();
    expect(retrieved?.agentName).toBe("Triage Agent");
    expect(retrieved?.status).toBe("created");

    await store.updateSessionStatus("session-abc", "running");
    const updated = await store.getSession("session-abc");
    expect(updated?.status).toBe("running");
  });

  it("handles cases and observations correctly", async () => {
    const store = new SqliteMemoryStore();
    const caseRecord = {
      id: "case-123",
      sessionId: "session-abc",
      createdAt: new Date().toISOString(),
      input: { task: "Analyze" },
      metadata: { priority: "high" }
    };

    await store.createCase(caseRecord);
    const retrieved = await store.getCase("case-123");
    expect(retrieved).toBeDefined();
    expect(retrieved?.input.task).toBe("Analyze");
    expect(retrieved?.metadata?.priority).toBe("high");

    await store.addObservation({
      id: "obs-1",
      sessionId: "session-abc",
      caseId: "case-123",
      type: "tool.output",
      message: "Checked files",
      data: { count: 5 },
      createdAt: new Date().toISOString()
    });

    const obs = await store.getObservations("case-123");
    expect(obs.length).toBe(1);
    expect(obs[0].message).toBe("Checked files");
    expect(obs[0].data?.count).toBe(5);
  });

  it("performs semantic keyword vector search over findings successfully", async () => {
    const store = new SqliteMemoryStore();
    
    const finding1: Finding = {
      id: "find-1",
      sessionId: "session-abc",
      caseId: "case-123",
      title: "Hardcoded MySQL database password leak",
      severity: "high",
      description: "Found credentials in docker-compose.yml config file",
      sourceTool: "git.credential.scanner",
      cwe: "CWE-798",
      owasp: "A07:2021-Identification and Authentication Failures",
      createdAt: new Date().toISOString()
    };

    const finding2: Finding = {
      id: "find-2",
      sessionId: "session-abc",
      caseId: "case-123",
      title: "Local network SSH port open",
      severity: "low",
      description: "Detected TCP port 22 listening locally",
      sourceTool: "local.port.analyzer",
      cwe: "CWE-668",
      createdAt: new Date().toISOString()
    };

    await store.addFinding(finding1);
    await store.addFinding(finding2);

    const findings = await store.getFindings("case-123");
    expect(findings.length).toBe(2);

    // Search query related to secrets / credentials should score finding1 much higher
    const credentialSearch = await store.searchSimilarFindings("leaked mysql password credentials", 5);
    expect(credentialSearch.length).toBeGreaterThan(0);
    expect(credentialSearch[0].id).toBe("find-1");
    expect(credentialSearch[0].score).toBeGreaterThan(0.3);

    // Search query related to open network ports should score finding2 higher
    const portSearch = await store.searchSimilarFindings("listening open port network", 5);
    expect(portSearch.length).toBeGreaterThan(0);
    expect(portSearch[0].id).toBe("find-2");
    expect(portSearch[0].score).toBeGreaterThan(0.3);
  });

  it("saves and retrieves incomplete or blocked execution records smoothly", async () => {
    const store = new SqliteMemoryStore();

    const blockedRecord = {
      id: "rec-blocked-1",
      tool: "shell.executor",
      input: { command: "dangerous command" },
      status: "blocked" as const,
      startedAt: new Date().toISOString()
    };

    await store.appendExecutionRecord("case-123", blockedRecord);
    const history = await store.getExecutionHistory("case-123");

    expect(history.length).toBe(1);
    expect(history[0].id).toBe("rec-blocked-1");
    expect(history[0].status).toBe("blocked");
    expect(history[0].completedAt).toBeUndefined();
    expect(history[0].durationMs).toBeUndefined();
  });
});
