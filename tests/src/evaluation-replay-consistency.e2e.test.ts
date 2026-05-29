import { describe, expect, it } from "vitest";
import type { AgentConfig, EvaluationScenario } from "../../packages/core/src";
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

function buildAgent(overrides?: Partial<AgentConfig>): AgentConfig {
  return {
    id: "replay-agent",
    name: "Replay Agent",
    goal: "Deterministic replay validation",
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
    ],
    ...overrides
  };
}

function createRuntime(baseTime: number): XyaVoryx {
  const runtime = new XyaVoryx({
    memory: new InMemoryStore(),
    runtimeContext: new DeterministicRuntimeContext(baseTime)
  });

  runtime.registerProvider(new MockLLMProvider());
  runtime.registerTool(EmailHeaderAnalyzerTool);
  runtime.registerTool(IOCExtractorTool);

  return runtime;
}

function createScenarioPack(): EvaluationScenario[] {
  return [
    {
      id: "replay-completed",
      name: "Completed flow",
      agent: buildAgent(),
      input: {
        task: "Investigate email",
        rawInput: SAMPLE_EMAIL
      },
      expectations: {
        status: "completed",
        minFindings: 1,
        maxToolExecutions: 2,
        requiredEvents: ["report.generated", "agent.completed", "policy.checked"],
        requiredTools: ["email.header.analyzer", "ioc.extractor"]
      }
    },
    {
      id: "replay-blocked",
      name: "Blocked policy flow",
      agent: buildAgent({
        policies: {
          deniedTools: ["ioc.extractor"]
        }
      }),
      input: {
        task: "Investigate email",
        rawInput: SAMPLE_EMAIL
      },
      expectations: {
        status: "blocked",
        requiredEvents: ["policy.blocked", "agent.failed"]
      }
    }
  ];
}

describe("Evaluation replay consistency", () => {
  it("returns identical suite outputs for deterministic replays", async () => {
    const baseTime = Date.UTC(2026, 0, 1, 0, 0, 0, 0);
    const scenarios = createScenarioPack();

    const firstRuntime = createRuntime(baseTime);
    const secondRuntime = createRuntime(baseTime);

    const firstReport = await firstRuntime.runEvaluation(scenarios);
    const secondReport = await secondRuntime.runEvaluation(scenarios);

    expect(secondReport).toEqual(firstReport);
  });
});
