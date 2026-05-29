import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { AgentConfig, EvaluationScenario, EvaluationSuiteResult } from "../../packages/core/src";
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
    id: "snapshot-agent",
    name: "Snapshot Agent",
    goal: "Deterministic baseline snapshot",
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

function createScenarioPack(): EvaluationScenario[] {
  return [
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
    }
  ];
}

function loadExistingBaseline(path: string): EvaluationSuiteResult | undefined {
  if (!existsSync(path)) {
    return undefined;
  }

  try {
    const raw = readFileSync(path, "utf8");
    return JSON.parse(raw) as EvaluationSuiteResult;
  } catch {
    return undefined;
  }
}

function ensureDir(path: string): void {
  if (!existsSync(path)) {
    mkdirSync(path, { recursive: true });
  }
}

function dateStamp(now: Date): string {
  const yyyy = now.getUTCFullYear().toString();
  const mm = (now.getUTCMonth() + 1).toString().padStart(2, "0");
  const dd = now.getUTCDate().toString().padStart(2, "0");
  const hh = now.getUTCHours().toString().padStart(2, "0");
  const mi = now.getUTCMinutes().toString().padStart(2, "0");
  const ss = now.getUTCSeconds().toString().padStart(2, "0");
  const mmm = now.getUTCMilliseconds().toString().padStart(3, "0");
  return `${yyyy}${mm}${dd}-${hh}${mi}${ss}-${mmm}Z`;
}

async function main(): Promise<void> {
  const outputDir = resolve(process.env.XYAVORYX_EVAL_DIR ?? ".xyavoryx-eval");
  ensureDir(outputDir);

  const latestPath = join(outputDir, "baseline-latest.json");
  const previousBaseline = loadExistingBaseline(latestPath);

  const runtime = new XyaVoryx({
    memory: new InMemoryStore(),
    runtimeContext: new DeterministicRuntimeContext(Date.UTC(2026, 0, 1, 0, 0, 0, 0))
  });
  runtime.registerProvider(new MockLLMProvider());
  runtime.registerTool(EmailHeaderAnalyzerTool);
  runtime.registerTool(IOCExtractorTool);

  const scenarios = createScenarioPack();
  const currentBaseline = await runtime.runEvaluation(scenarios, previousBaseline);

  const now = new Date();
  const snapshotPath = join(outputDir, `baseline-${dateStamp(now)}.json`);
  const output = JSON.stringify(currentBaseline, null, 2);

  writeFileSync(latestPath, output, "utf8");
  writeFileSync(snapshotPath, output, "utf8");

  console.log(`Baseline latest: ${latestPath}`);
  console.log(`Baseline snapshot: ${snapshotPath}`);
  if (currentBaseline.trend) {
    console.log(`Trend verdict: ${currentBaseline.trend.verdict}`);
    console.log(`Improvements: ${currentBaseline.trend.improvements}`);
    console.log(`Regressions: ${currentBaseline.trend.regressions}`);
  } else {
    console.log("Trend verdict: n/a (no previous baseline)");
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Failed to generate evaluation snapshot: ${message}`);
  process.exitCode = 1;
});
