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
    id: "baseline-agent",
    name: "Baseline Agent",
    goal: "Deterministic regression baseline",
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

describe("Evaluation regression pack", () => {
  it("keeps baseline scenarios deterministic", async () => {
    const runtime = new XyaVoryx({
      memory: new InMemoryStore(),
      runtimeContext: new DeterministicRuntimeContext(Date.UTC(2026, 0, 1, 0, 0, 0, 0))
    });

    runtime.registerProvider(new MockLLMProvider());
    runtime.registerTool(EmailHeaderAnalyzerTool);
    runtime.registerTool(IOCExtractorTool);

    const scenarios: EvaluationScenario[] = [
      {
        id: "baseline-completed",
        name: "Completed phishing flow",
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
        id: "baseline-blocked",
        name: "Blocked tool policy flow",
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
          maxToolExecutions: 2,
          requiredEvents: ["policy.blocked", "agent.failed"]
        }
      },
      {
        id: "baseline-recovery",
        name: "Recovery continue flow",
        agent: {
          id: "recovery-agent",
          name: "Recovery Agent",
          goal: "Recover from failed first step",
          tools: ["ioc.extractor", "email.header.analyzer"],
          workflow: [
            {
              id: "step-a",
              tool: "ioc.extractor",
              inputFrom: "literal",
              literalInput: {},
              onFailure: { action: "continue" }
            },
            {
              id: "step-b",
              tool: "email.header.analyzer",
              inputFrom: "rawInput",
              inputKey: "rawEmail"
            }
          ]
        },
        input: {
          task: "Recovery scenario",
          rawInput: SAMPLE_EMAIL
        },
        expectations: {
          status: "completed",
          requiredEvents: ["workflow.step_recovered", "agent.completed"]
        }
      }
    ];

    const report = await runtime.runEvaluation(scenarios);
    expect(report.total).toBe(3);
    expect(report.passed).toBe(3);
    expect(report.failed).toBe(0);
    expect(report.scenarios.every((scenario) => scenario.passed)).toBe(true);
  });
});
