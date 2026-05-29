import { describe, expect, it } from "vitest";
import type { AgentConfig, EvaluationScenario } from "../../packages/core/src";
import { InMemoryStore } from "../../packages/memory/src/in-memory-store";
import { MockLLMProvider } from "../../packages/providers/src/mock-llm-provider";
import { DeterministicRuntimeContext } from "../../packages/runtime/src/deterministic-runtime-context";
import { XyaVoryx } from "../../packages/runtime/src/xyavoryx";
import { EmailHeaderAnalyzerTool } from "../../packages/tools/src/email-header-analyzer-tool";
import { IOCExtractorTool } from "../../packages/tools/src/ioc-extractor-tool";

function buildAgent(overrides?: Partial<AgentConfig>): AgentConfig {
  return {
    id: "eval-agent",
    name: "Eval Agent",
    goal: "Evaluate deterministic scenarios",
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

describe("EvaluationHarness e2e", () => {
  it("produces deterministic suite metrics for pass and fail scenarios", async () => {
    const runtime = new XyaVoryx({
      memory: new InMemoryStore(),
      runtimeContext: new DeterministicRuntimeContext(Date.UTC(2026, 0, 1, 0, 0, 0, 0))
    });

    runtime.registerProvider(new MockLLMProvider());
    runtime.registerTool(EmailHeaderAnalyzerTool);
    runtime.registerTool(IOCExtractorTool);

    const scenarios: EvaluationScenario[] = [
      {
        id: "scenario-pass",
        name: "Completed flow should pass",
        agent: buildAgent(),
        input: {
          task: "Investigate email",
          rawInput: SAMPLE_EMAIL
        },
        expectations: {
          status: "completed",
          minFindings: 1,
          maxToolExecutions: 2,
          requiredEvents: ["agent.completed", "report.generated"],
          requiredTools: ["email.header.analyzer", "ioc.extractor"]
        }
      },
      {
        id: "scenario-fail",
        name: "Blocked policy should fail this expectation",
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
          status: "completed"
        }
      }
    ];

    const report = await runtime.runEvaluation(scenarios);

    expect(report.total).toBe(2);
    expect(report.passed).toBe(1);
    expect(report.failed).toBe(1);
    expect(report.passRate).toBe(0.5);
    expect(report.quality.checkPassRate).toBeGreaterThan(0);
    expect(report.quality.traceCompletenessRate).toBe(1);
    expect(report.quality.policyComplianceRate).toBe(1);
    expect(report.scenarios[0]?.passed).toBe(true);
    expect(report.scenarios[1]?.passed).toBe(false);
    expect(report.scenarios[1]?.checks.some((check) => check.name === "status" && !check.passed)).toBe(true);
    expect(report.scenarios[0]?.metrics.checkPassRate).toBe(1);
    expect(report.scenarios[0]?.metrics.traceCompletenessScore).toBe(1);
    expect(report.scenarios[0]?.metrics.policyComplianceScore).toBe(1);
    expect(report.scenarios[1]?.metrics.traceCompletenessScore).toBe(1);
    expect(report.scenarios[1]?.metrics.policyComplianceScore).toBe(1);
    expect(report.trend).toBeUndefined();
  });

  it("computes stable trend summary against baseline report", async () => {
    const runtime = new XyaVoryx({
      memory: new InMemoryStore(),
      runtimeContext: new DeterministicRuntimeContext(Date.UTC(2026, 0, 1, 0, 0, 0, 0))
    });

    runtime.registerProvider(new MockLLMProvider());
    runtime.registerTool(EmailHeaderAnalyzerTool);
    runtime.registerTool(IOCExtractorTool);

    const scenarios: EvaluationScenario[] = [
      {
        id: "scenario-pass",
        name: "Completed flow should pass",
        agent: buildAgent(),
        input: {
          task: "Investigate email",
          rawInput: SAMPLE_EMAIL
        },
        expectations: {
          status: "completed",
          minFindings: 1,
          maxToolExecutions: 2,
          requiredEvents: ["agent.completed", "report.generated"],
          requiredTools: ["email.header.analyzer", "ioc.extractor"]
        }
      }
    ];

    const baseline = await runtime.runEvaluation(scenarios);
    const current = await runtime.runEvaluation(scenarios, baseline);

    expect(current.trend?.verdict).toBe("stable");
    expect(current.trend?.regressions).toBe(0);
    expect(current.trend?.metrics.every((metric) => metric.delta === 0)).toBe(true);
  });

  it("marks trend as regressed when suite quality drops", async () => {
    const runtime = new XyaVoryx({
      memory: new InMemoryStore(),
      runtimeContext: new DeterministicRuntimeContext(Date.UTC(2026, 0, 1, 0, 0, 0, 0))
    });

    runtime.registerProvider(new MockLLMProvider());
    runtime.registerTool(EmailHeaderAnalyzerTool);
    runtime.registerTool(IOCExtractorTool);

    const baselineScenarios: EvaluationScenario[] = [
      {
        id: "scenario-baseline",
        name: "Baseline pass",
        agent: buildAgent(),
        input: {
          task: "Investigate email",
          rawInput: SAMPLE_EMAIL
        },
        expectations: {
          status: "completed",
          minFindings: 1
        }
      }
    ];

    const regressedScenarios: EvaluationScenario[] = [
      {
        id: "scenario-regressed",
        name: "Forced failure expectation",
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
          status: "completed"
        }
      }
    ];

    const baseline = await runtime.runEvaluation(baselineScenarios);
    const regressed = await runtime.runEvaluation(regressedScenarios, baseline);

    expect(regressed.failed).toBe(1);
    expect(regressed.trend?.verdict).toBe("regressed");
    expect(regressed.trend?.regressions).toBeGreaterThan(0);
    expect(regressed.trend?.metrics.some((metric) => metric.metric === "failed_scenarios" && metric.direction === "up")).toBe(true);
  });
});
