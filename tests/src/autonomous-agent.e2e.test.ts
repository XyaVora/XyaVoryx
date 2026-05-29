import { describe, expect, it } from "vitest";
import { InMemoryStore } from "../../packages/memory/src/in-memory-store";
import { MockLLMProvider } from "../../packages/providers/src/mock-llm-provider";
import { DeterministicRuntimeContext } from "../../packages/runtime/src/deterministic-runtime-context";
import { XyaVoryx } from "../../packages/runtime/src/xyavoryx";
import { EmailHeaderAnalyzerTool } from "../../packages/tools/src/email-header-analyzer-tool";
import { IOCExtractorTool } from "../../packages/tools/src/ioc-extractor-tool";

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

describe("Autonomous Agent end-to-end", () => {
  it("executes tools sequentially and finishes autonomously based on LLM decisions", async () => {
    const memory = new InMemoryStore();
    const runtime = new XyaVoryx({
      memory,
      runtimeContext: new DeterministicRuntimeContext(Date.UTC(2026, 0, 1, 0, 0, 0, 0))
    });

    runtime.registerProvider(
      new MockLLMProvider({
        responses: {
          // Iteration 1: No observations yet -> Call email analyzer
          "No observations recorded yet.": JSON.stringify({
            thought: "I need to analyze the email header to check for spoofing and authentication results first.",
            action: "call",
            tool: "email.header.analyzer",
            input: { rawEmail: SAMPLE_EMAIL }
          }),
          // Iteration 3: Both tools complete -> Finish (put this first so it matches in Iteration 3 when both completed strings are in prompt)
          "Tool ioc.extractor completed": JSON.stringify({
            thought: "Email header and IOCs are fully extracted. I can now compile the final phishing report.",
            action: "finish",
            report: "# Phishing Investigation Report\n\n- Header analysis flagged SPF failure.\n- Extracted malicious URL: bad.example"
          }),
          // Iteration 2: After email header analysis -> Call IOC extractor
          "Tool email.header.analyzer completed": JSON.stringify({
            thought: "Email header analyzed. Now I must extract IOCs like IPs, domains, and URLs from the email body.",
            action: "call",
            tool: "ioc.extractor",
            input: { text: SAMPLE_EMAIL }
          })
        }
      })
    );

    runtime.registerTool(EmailHeaderAnalyzerTool);
    runtime.registerTool(IOCExtractorTool);

    const result = await runtime.runAgent(
      {
        id: "auto-agent-1",
        name: "Autonomous Phishing Agent",
        goal: "Investigate email phishing autonomously",
        tools: ["email.header.analyzer", "ioc.extractor"],
        plannerMode: "autonomous"
      },
      {
        task: "Analyze suspicious email",
        rawInput: SAMPLE_EMAIL
      }
    );

    expect(result.status).toBe("completed");
    expect(result.trace.toolExecutions).toHaveLength(2);
    expect(result.trace.toolExecutions[0]?.tool).toBe("email.header.analyzer");
    expect(result.trace.toolExecutions[1]?.tool).toBe("ioc.extractor");
    expect(result.findings.length).toBeGreaterThan(0);
    expect(result.report).toContain("# Phishing Investigation Report");

    // Verify observations are saved in memory
    const obs = await memory.getObservations(result.caseId);
    expect(obs.some((o) => o.data?.tool === "email.header.analyzer")).toBe(true);
    expect(obs.some((o) => o.data?.tool === "ioc.extractor")).toBe(true);
  });

  it("enforces policies on autonomously planned tool executions", async () => {
    const memory = new InMemoryStore();
    const runtime = new XyaVoryx({
      memory,
      runtimeContext: new DeterministicRuntimeContext(Date.UTC(2026, 0, 1, 0, 0, 0, 0))
    });

    runtime.registerProvider(
      new MockLLMProvider({
        responses: {
          "No observations recorded yet.": JSON.stringify({
            thought: "I need to analyze email header.",
            action: "call",
            tool: "email.header.analyzer",
            input: { rawEmail: SAMPLE_EMAIL }
          })
        }
      })
    );

    runtime.registerTool(EmailHeaderAnalyzerTool);

    const result = await runtime.runAgent(
      {
        id: "auto-agent-policy",
        name: "Autonomous Policy Agent",
        goal: "Investigate email phishing autonomously",
        tools: ["email.header.analyzer"],
        plannerMode: "autonomous",
        policies: {
          deniedTools: ["email.header.analyzer"]
        }
      },
      {
        task: "Analyze email",
        rawInput: SAMPLE_EMAIL
      }
    );

    expect(result.status).toBe("blocked");
    expect(result.trace.toolExecutions).toHaveLength(1);
    expect(result.trace.toolExecutions[0]?.status).toBe("blocked");
    expect(result.trace.events.some((e) => e.type === "policy.blocked")).toBe(true);
  });
});
