import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { AgentConfig } from "../../packages/core/src";
import { FileMemoryStore } from "../../packages/memory/src/file-memory-store";
import { MockLLMProvider } from "../../packages/providers/src/mock-llm-provider";
import { DeterministicRuntimeContext } from "../../packages/runtime/src/deterministic-runtime-context";
import { XyaVoryx } from "../../packages/runtime/src/xyavoryx";
import { EmailHeaderAnalyzerTool } from "../../packages/tools/src/email-header-analyzer-tool";
import { IOCExtractorTool } from "../../packages/tools/src/ioc-extractor-tool";

const tempDirs: string[] = [];

async function createTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "xyavoryx-agent-file-memory-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0, tempDirs.length).map((dir) =>
      rm(dir, { recursive: true, force: true })
    )
  );
});

function buildAgent(): AgentConfig {
  return {
    id: "agent-file-memory",
    name: "Phishing Agent",
    goal: "Analyze suspicious email",
    tools: ["email.header.analyzer", "ioc.extractor"],
    workflow: [
      {
        id: "step-email",
        tool: "email.header.analyzer",
        inputFrom: "rawInput",
        inputKey: "rawEmail"
      },
      {
        id: "step-ioc",
        tool: "ioc.extractor",
        inputFrom: "rawInput",
        inputKey: "text"
      }
    ]
  };
}

const SAMPLE_EMAIL = [
  "From: Admin <admin@secure-contoso.com>",
  "To: employee@contoso.com",
  "Subject: Urgent password reset",
  "Return-Path: <mailer@external-attacker.net>",
  "Received: from attacker.net by mx.contoso.com",
  "Authentication-Results: mx.contoso.com; spf=fail; dkim=none; dmarc=fail",
  "",
  "Click https://bad.example/login and contact phish@bad.example"
].join("\n");

describe("AgentRunner with FileMemoryStore", () => {
  it("persists execution artifacts across memory store instances", async () => {
    const dir = await createTempDir();
    const memory = new FileMemoryStore({ baseDir: dir });
    const runtime = new XyaVoryx({
      memory,
      runtimeContext: new DeterministicRuntimeContext(Date.UTC(2026, 0, 1, 0, 0, 0, 0))
    });

    runtime.registerProvider(new MockLLMProvider());
    runtime.registerTool(EmailHeaderAnalyzerTool);
    runtime.registerTool(IOCExtractorTool);

    const result = await runtime.runAgent(buildAgent(), {
      task: "Investigate email",
      rawInput: SAMPLE_EMAIL
    });

    expect(result.status).toBe("completed");

    const reloadedMemory = new FileMemoryStore({ baseDir: dir });
    const trace = await reloadedMemory.getTrace(result.caseId);
    const findings = await reloadedMemory.getFindings(result.caseId);

    expect(trace?.toolExecutions).toHaveLength(2);
    expect(findings.length).toBeGreaterThan(0);
  });
});
