import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { EvaluationMetricTrend, EvaluationSuiteResult } from "../../packages/core/src";

interface CliArgs {
  basePath: string;
  headPath: string;
  outputPath: string;
  failOnRegression: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    basePath: "",
    headPath: "",
    outputPath: "evaluation-trend-report.md",
    failOnRegression: false
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    const value = argv[i + 1];

    if (token === "--base" && value) {
      args.basePath = value;
      i += 1;
      continue;
    }

    if (token === "--head" && value) {
      args.headPath = value;
      i += 1;
      continue;
    }

    if (token === "--output" && value) {
      args.outputPath = value;
      i += 1;
      continue;
    }

    if (token === "--fail-on-regression") {
      args.failOnRegression = true;
      continue;
    }
  }

  if (!args.basePath || !args.headPath) {
    throw new Error("Usage: tsx scripts/evaluation/compare-trend.ts --base <path> --head <path> [--output <path>] [--fail-on-regression]");
  }

  return args;
}

function loadSuite(path: string): EvaluationSuiteResult {
  const absolute = resolve(path);
  const raw = readFileSync(absolute, "utf8");
  return JSON.parse(raw) as EvaluationSuiteResult;
}

function buildMetricRows(metrics: EvaluationMetricTrend[]): string {
  if (metrics.length === 0) {
    return "| n/a | n/a | n/a | n/a | n/a |\n";
  }

  return metrics
    .map((metric) => {
      const direction = metric.direction === "up" ? "up" : metric.direction === "down" ? "down" : "flat";
      return `| ${metric.metric} | ${metric.previous} | ${metric.current} | ${metric.delta} (${direction}) | ${metric.better ? "yes" : "no"} |`;
    })
    .join("\n")
    .concat("\n");
}

function findMetric(summary: EvaluationSuiteResult["quality"], key: keyof EvaluationSuiteResult["quality"]): number {
  return summary[key];
}

function buildFallbackMetrics(base: EvaluationSuiteResult, head: EvaluationSuiteResult): EvaluationMetricTrend[] {
  const entries: Array<{ key: keyof EvaluationSuiteResult["quality"]; direction: "higher" | "lower"; metric: string }> = [
    { key: "checkPassRate", direction: "higher", metric: "check_pass_rate" },
    { key: "traceCompletenessRate", direction: "higher", metric: "trace_completeness" },
    { key: "policyComplianceRate", direction: "higher", metric: "policy_compliance" }
  ];

  return entries.map((entry) => {
    const previous = findMetric(base.quality, entry.key);
    const current = findMetric(head.quality, entry.key);
    const delta = Math.round((current - previous) * 1_000_000) / 1_000_000;
    const better = entry.direction === "higher" ? delta >= 0 : delta <= 0;

    return {
      metric: entry.metric,
      previous,
      current,
      delta,
      direction: delta === 0 ? "flat" : delta > 0 ? "up" : "down",
      better
    };
  });
}

function buildReport(base: EvaluationSuiteResult, head: EvaluationSuiteResult): { markdown: string; regressions: number } {
  const trend = head.trend;
  const metrics = trend?.metrics ?? buildFallbackMetrics(base, head);
  const regressions = trend?.regressions ?? metrics.filter((metric) => !metric.better && metric.delta !== 0).length;
  const improvements = trend?.improvements ?? metrics.filter((metric) => metric.better && metric.delta !== 0).length;
  const verdict = trend?.verdict ?? (regressions > 0 ? "regressed" : improvements > 0 ? "improved" : "stable");

  const markdown = [
    "# Evaluation Trend Report",
    "",
    `- Verdict: **${verdict.toUpperCase()}**`,
    `- Improvements: **${improvements}**`,
    `- Regressions: **${regressions}**`,
    "",
    "## Suite Overview",
    "",
    `| Suite | Pass Rate | Failed Scenarios | Check Pass Rate | Trace Completeness | Policy Compliance |`,
    `| --- | ---: | ---: | ---: | ---: | ---: |`,
    `| Base | ${base.passRate} | ${base.failed} | ${base.quality.checkPassRate} | ${base.quality.traceCompletenessRate} | ${base.quality.policyComplianceRate} |`,
    `| Head | ${head.passRate} | ${head.failed} | ${head.quality.checkPassRate} | ${head.quality.traceCompletenessRate} | ${head.quality.policyComplianceRate} |`,
    "",
    "## Metric Trends",
    "",
    "| Metric | Previous | Current | Delta | Better |",
    "| --- | ---: | ---: | ---: | --- |",
    buildMetricRows(metrics),
    "<!-- xyavoryx-evaluation-trend -->"
  ].join("\n");

  return { markdown, regressions };
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const baseSuite = loadSuite(args.basePath);
  const headSuite = loadSuite(args.headPath);
  const { markdown, regressions } = buildReport(baseSuite, headSuite);

  writeFileSync(resolve(args.outputPath), markdown, "utf8");
  console.log(`Evaluation trend report written to: ${resolve(args.outputPath)}`);
  console.log(`Regressions: ${regressions}`);

  if (args.failOnRegression && regressions > 0) {
    process.exitCode = 1;
  }
}

main();
