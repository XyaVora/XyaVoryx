import { describe, expect, it } from "vitest";
import { InMemoryStore } from "../../packages/memory/src/in-memory-store";
import { EncryptedMemoryStore } from "../../packages/memory/src/encrypted-memory-store";
import type { Finding, CaseRecord, Observation, ToolExecutionRecord, ExecutionTrace } from "../../packages/core/src";

describe("EncryptedMemoryStore", () => {
  const testKey = "test-secret-key-for-gcm-aes-256";

  it("encrypts sensitive finding fields in storage and decrypts them on retrieval", async () => {
    const rawStore = new InMemoryStore();
    const encryptedStore = new EncryptedMemoryStore(rawStore, testKey);

    const originalFinding: Finding = {
      id: "find-secure-1",
      sessionId: "session-xyz",
      caseId: "case-999",
      title: "Hardcoded secret key leak",
      severity: "high",
      description: "Discovered an API key 'secret_12345' in file index.js",
      sourceTool: "git.credential.scanner",
      evidence: "secret_12345",
      cwe: "CWE-798",
      owasp: "A07:2021",
      data: { position: 12, value: "secret_12345" },
      createdAt: new Date().toISOString()
    };

    // Add through the encrypted store
    await encryptedStore.addFinding(originalFinding);

    // 1. Read directly from the raw underlying store to verify it is encrypted
    const rawFindings = await rawStore.getFindings("case-999");
    expect(rawFindings.length).toBe(1);
    
    // Assert description is encrypted (starts with v1: and does not contain the plaintext secret)
    expect(rawFindings[0].description).toBeDefined();
    expect(rawFindings[0].description.startsWith("v1:")).toBe(true);
    expect(rawFindings[0].description).not.toContain("secret_12345");
    
    // Assert evidence is encrypted
    expect(rawFindings[0].evidence).toBeDefined();
    expect(rawFindings[0].evidence?.startsWith("v1:")).toBe(true);
    expect(rawFindings[0].evidence).not.toContain("secret_12345");

    // Assert data is encrypted
    expect(rawFindings[0].data).toBeDefined();
    expect(typeof rawFindings[0].data).toBe("object");
    expect((rawFindings[0].data as any).__encrypted).toBeDefined();
    expect((rawFindings[0].data as any).__encrypted.startsWith("v1:")).toBe(true);

    // 2. Read through the encrypted wrapper to verify it decodes perfectly
    const decryptedFindings = await encryptedStore.getFindings("case-999");
    expect(decryptedFindings.length).toBe(1);
    expect(decryptedFindings[0].id).toBe("find-secure-1");
    expect(decryptedFindings[0].description).toBe("Discovered an API key 'secret_12345' in file index.js");
    expect(decryptedFindings[0].evidence).toBe("secret_12345");
    expect(decryptedFindings[0].data).toEqual({ position: 12, value: "secret_12345" });
  });

  it("handles case records input and metadata encryption cleanly", async () => {
    const rawStore = new InMemoryStore();
    const encryptedStore = new EncryptedMemoryStore(rawStore, testKey);

    const originalCase: CaseRecord = {
      id: "case-secure-1",
      sessionId: "session-xyz",
      createdAt: new Date().toISOString(),
      input: { task: "inspect sensitive credential file" },
      metadata: { priority: "critical", serverId: "srv-prod-99" }
    };

    await encryptedStore.createCase(originalCase);

    // Assert raw data is encrypted
    const rawCase = await rawStore.getCase("case-secure-1");
    expect(rawCase).toBeDefined();
    expect(typeof rawCase?.input).toBe("object");
    expect((rawCase?.input as any).__encrypted).toBeDefined();
    expect((rawCase?.input as any).__encrypted.startsWith("v1:")).toBe(true);
    expect(typeof rawCase?.metadata).toBe("object");
    expect((rawCase?.metadata as any).__encrypted).toBeDefined();
    expect((rawCase?.metadata as any).__encrypted.startsWith("v1:")).toBe(true);

    // Assert decrypted retrieval is perfect
    const decryptedCase = await encryptedStore.getCase("case-secure-1");
    expect(decryptedCase).toBeDefined();
    expect(decryptedCase?.input).toEqual({ task: "inspect sensitive credential file" });
    expect(decryptedCase?.metadata).toEqual({ priority: "critical", serverId: "srv-prod-99" });
  });

  it("manages observations encryption and decryption", async () => {
    const rawStore = new InMemoryStore();
    const encryptedStore = new EncryptedMemoryStore(rawStore, testKey);

    const originalObs: Observation = {
      id: "obs-secure-1",
      sessionId: "session-xyz",
      caseId: "case-999",
      type: "credential.warning",
      message: "Detected warning in docker environment",
      data: { severityScore: 8.5 },
      createdAt: new Date().toISOString()
    };

    await encryptedStore.addObservation(originalObs);

    // Assert raw is encrypted
    const rawObsList = await rawStore.getObservations("case-999");
    expect(rawObsList.length).toBe(1);
    expect(rawObsList[0].message.startsWith("v1:")).toBe(true);
    expect(typeof rawObsList[0].data).toBe("object");
    expect((rawObsList[0].data as any).__encrypted).toBeDefined();
    expect((rawObsList[0].data as any).__encrypted.startsWith("v1:")).toBe(true);

    // Assert decrypted retrieval is correct
    const decryptedObsList = await encryptedStore.getObservations("case-999");
    expect(decryptedObsList.length).toBe(1);
    expect(decryptedObsList[0].message).toBe("Detected warning in docker environment");
    expect(decryptedObsList[0].data).toEqual({ severityScore: 8.5 });
  });

  it("handles execution records and complete traces encryption", async () => {
    const rawStore = new InMemoryStore();
    const encryptedStore = new EncryptedMemoryStore(rawStore, testKey);

    const originalRecord: ToolExecutionRecord = {
      id: "rec-secure-1",
      tool: "shell.executor",
      input: { cmd: "cat /etc/passwd" },
      output: { result: "root:x:0:0:root" },
      status: "completed",
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      durationMs: 45
    };

    await encryptedStore.appendExecutionRecord("case-999", originalRecord);

    // Verify raw is encrypted
    const rawHistory = await rawStore.getExecutionHistory("case-999");
    expect(rawHistory.length).toBe(1);
    expect(typeof rawHistory[0].input).toBe("object");
    expect((rawHistory[0].input as any).__encrypted).toBeDefined();
    expect((rawHistory[0].input as any).__encrypted.startsWith("v1:")).toBe(true);
    expect(typeof rawHistory[0].output).toBe("object");
    expect((rawHistory[0].output as any).__encrypted).toBeDefined();
    expect((rawHistory[0].output as any).__encrypted.startsWith("v1:")).toBe(true);

    // Verify decrypted retrieval
    const decryptedHistory = await encryptedStore.getExecutionHistory("case-999");
    expect(decryptedHistory.length).toBe(1);
    expect(decryptedHistory[0].input).toEqual({ cmd: "cat /etc/passwd" });
    expect(decryptedHistory[0].output).toEqual({ result: "root:x:0:0:root" });

    // Verify Trace encryption
    const originalTrace: ExecutionTrace = {
      caseId: "case-999",
      toolExecutions: [originalRecord],
      events: []
    };

    await encryptedStore.saveTrace("case-999", originalTrace);

    const rawTrace = await rawStore.getTrace("case-999");
    expect(rawTrace).toBeDefined();
    expect(typeof rawTrace).toBe("object");
    expect(rawTrace?.toolExecutions[0].input).toBeDefined();
    expect((rawTrace?.toolExecutions[0].input as any).__encrypted).toBeDefined();
    expect((rawTrace?.toolExecutions[0].input as any).__encrypted.startsWith("v1:")).toBe(true);

    const decryptedTrace = await encryptedStore.getTrace("case-999");
    expect(decryptedTrace).toBeDefined();
    expect(decryptedTrace?.toolExecutions[0].tool).toBe("shell.executor");
  });
});
