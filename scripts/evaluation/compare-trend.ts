import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

interface TrendMetric {
  metric: string;
  previous: number;
  current: number;
  delta: number;
  better: boolean;
}

interface SuiteResult {
  passRate: number;
  failed: number;
  quality: {
    checkPassRate: number;
    traceCompletenessRate: number;
    policyComplianceRate: number;
  };
}

function parseArg(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  if (index === -1 || index + 1 >= process.argv.length) {
    return undefined;
  }
  return process.argv[index + 1];
}

function loadSuite(path: string): SuiteResult {
  const raw = readFileSync(resolve(path), "utf8");
  return JSON.parse(raw) as SuiteResult;
}

function compare(metric: string, previous: number, current: number, higherIsBetter = true): TrendMetric {
  const delta = Math.round((current - previous) * 1_000_000) / 1_000_000;
  const better = higherIsBetter ? delta >= 0 : delta <= 0;
  return { metric, previous, current, delta, better };
}

function main(): void {
  const basePath = parseArg("--base");
  const headPath = parseArg("--head");
  const outputPath = parseArg("--output") ?? "evaluation-trend-report.md";

  if (!basePath || !headPath) {
    throw new Error("Usage: tsx scripts/evaluation/compare-trend.ts --base <path> --head <path> [--output <path>]");
  }

  const base = loadSuite(basePath);
  const head = loadSuite(headPath);

  const metrics: TrendMetric[] = [
    compare("pass_rate", base.passRate, head.passRate, true),
    compare("check_pass_rate", base.quality.checkPassRate, head.quality.checkPassRate, true),
    compare("trace_completeness", base.quality.traceCompletenessRate, head.quality.traceCompletenessRate, true),
    compare("policy_compliance", base.quality.policyComplianceRate, head.quality.policyComplianceRate, true),
    compare("failed_scenarios", base.failed, head.failed, false)
  ];

  const regressions = metrics.filter((item) => !item.better && item.delta !== 0).length;
  const improvements = metrics.filter((item) => item.better && item.delta !== 0).length;
  const verdict = regressions > 0 ? "REGRESSED" : improvements > 0 ? "IMPROVED" : "STABLE";

  const rows = metrics
    .map((item) => `| ${item.metric} | ${item.previous} | ${item.current} | ${item.delta} | ${item.better ? "yes" : "no"} |`)
    .join("\n");

  const report = [
    "# Evaluation Trend Report",
    "",
    `- Verdict: **${verdict}**`,
    `- Improvements: **${improvements}**`,
    `- Regressions: **${regressions}**`,
    "",
    "## Metrics",
    "",
    "| Metric | Previous | Current | Delta | Better |",
    "| --- | ---: | ---: | ---: | --- |",
    rows,
    "",
    "<!-- xyavoryx-evaluation-trend -->"
  ].join("\n");

  writeFileSync(resolve(outputPath), report, "utf8");
  console.log(`Evaluation trend report written to: ${resolve(outputPath)}`);
}

main();
