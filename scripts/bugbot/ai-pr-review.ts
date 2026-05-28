#!/usr/bin/env node
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

type Severity = "critical" | "high" | "medium" | "low";

type AIFinding = {
  severity: Severity;
  category: "bug" | "security" | "design" | "test-gap" | "performance" | "maintainability";
  file: string;
  line: number;
  title: string;
  evidence: string;
  suggested_fix: string;
};

type AIReviewResult = {
  summary: string;
  overall_risk: "low" | "medium" | "high";
  findings: AIFinding[];
};

type PersistedReport = {
  status: "skipped" | "ok" | "flagged" | "error";
  reason?: string;
  baseRef: string;
  headRef: string;
  changedFiles: string[];
  result?: AIReviewResult;
  error?: string;
};

const REPORT_PATH = process.env.BUGBOT_AI_REPORT_PATH || "bugbot-ai-report.md";
const FINDINGS_PATH = process.env.BUGBOT_AI_FINDINGS_PATH || "bugbot-ai-findings.json";
const MODEL = process.env.BUGBOT_AI_MODEL || "gpt-4.1-mini";
const OPENAI_BASE_URL = process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const FAIL_ON_HIGH = process.env.BUGBOT_AI_FAIL_ON_HIGH === "1";
const AI_REQUIRED = process.env.BUGBOT_AI_REQUIRED === "1";
const MAX_DIFF_CHARS = Number(process.env.BUGBOT_AI_MAX_DIFF_CHARS || 40000);
const MAX_FILES = Number(process.env.BUGBOT_AI_MAX_FILES || 120);
const REQUEST_TIMEOUT_MS = Number(process.env.BUGBOT_AI_TIMEOUT_MS || 90000);

function sh(command: string): string {
  return execSync(command, { encoding: "utf8" }).trim();
}

function safeJsonParse<T>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function sanitizeLine(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim();
}

function severityRank(severity: Severity): number {
  switch (severity) {
    case "critical":
      return 4;
    case "high":
      return 3;
    case "medium":
      return 2;
    default:
      return 1;
  }
}

function getBaseRef(): string {
  if (process.env.BUGBOT_BASE_REF) {
    return process.env.BUGBOT_BASE_REF;
  }

  const githubBaseRef = process.env.GITHUB_BASE_REF;
  if (githubBaseRef) {
    return `origin/${githubBaseRef}`;
  }

  return "origin/main";
}

function collectDiff(baseRef: string): { changedFiles: string[]; diff: string; headRef: string } {
  try {
    const changedFilesRaw = sh(`git diff --name-only ${baseRef}...HEAD`);
    const diffRaw = sh(`git diff --unified=3 ${baseRef}...HEAD`);
    const headRef = sh("git rev-parse --short HEAD");
    return {
      changedFiles: changedFilesRaw.split("\n").map((v) => v.trim()).filter(Boolean).slice(0, MAX_FILES),
      diff: diffRaw,
      headRef
    };
  } catch {
    const changedFilesRaw = sh("git diff --name-only HEAD~1...HEAD");
    const diffRaw = sh("git diff --unified=3 HEAD~1...HEAD");
    const headRef = sh("git rev-parse --short HEAD");
    return {
      changedFiles: changedFilesRaw.split("\n").map((v) => v.trim()).filter(Boolean).slice(0, MAX_FILES),
      diff: diffRaw,
      headRef
    };
  }
}

function truncateDiff(diff: string): string {
  if (diff.length <= MAX_DIFF_CHARS) {
    return diff;
  }

  return `${diff.slice(0, MAX_DIFF_CHARS)}\n\n[DIFF_TRUNCATED]`;
}

function parseChatCompletionContent(responseJson: unknown): string {
  const parsed = responseJson as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const value = parsed.choices?.[0]?.message?.content;
  if (typeof value !== "string") {
    throw new Error("AI response did not include choices[0].message.content.");
  }
  return value;
}

function normalizeResult(result: AIReviewResult): AIReviewResult {
  const summary = typeof result.summary === "string" && result.summary.trim().length > 0
    ? sanitizeLine(result.summary)
    : "AI reviewer returned findings.";

  const normalizedRisk = result.overall_risk === "high" || result.overall_risk === "medium" || result.overall_risk === "low"
    ? result.overall_risk
    : "medium";

  const findings = Array.isArray(result.findings)
    ? result.findings
        .filter((finding) => finding && typeof finding === "object")
        .map((finding) => ({
          severity: finding.severity === "critical" || finding.severity === "high" || finding.severity === "medium"
              ? finding.severity
              : "low",
          category:
            finding.category === "bug" ||
            finding.category === "security" ||
            finding.category === "design" ||
            finding.category === "test-gap" ||
            finding.category === "performance"
              ? finding.category
              : "maintainability",
          file: typeof finding.file === "string" ? finding.file : "n/a",
          line: Number.isFinite(finding.line) ? Math.max(1, Math.floor(finding.line)) : 1,
          title: typeof finding.title === "string" ? sanitizeLine(finding.title) : "Untitled finding",
          evidence: typeof finding.evidence === "string" ? sanitizeLine(finding.evidence) : "No evidence provided.",
          suggested_fix:
            typeof finding.suggested_fix === "string" ? sanitizeLine(finding.suggested_fix) : "No fix suggestion provided."
        }))
    : [];

  return {
    summary,
    overall_risk: normalizedRisk,
    findings
  };
}

async function callOpenAI(baseRef: string, changedFiles: string[], diff: string): Promise<AIReviewResult> {
  const systemPrompt = [
    "You are XyaVoryx AI PR Reviewer.",
    "Review pull request code changes and report only concrete issues backed by diff evidence.",
    "Prioritize security, correctness, deterministic behavior, policy bypass, and missing tests.",
    "Do not invent files or line numbers.",
    "Return strict JSON that follows the schema."
  ].join(" ");

  const userPrompt = [
    `Repository: XyaVoryx`,
    `Base ref: ${baseRef}`,
    `Changed files:`,
    ...changedFiles.map((file) => `- ${file}`),
    "",
    "Patch diff:",
    truncateDiff(diff),
    "",
    "Rules:",
    "- Focus on real defects likely to affect behavior or security.",
    "- If no actionable issues, return empty findings with low risk.",
    "- Use file paths and line numbers from the diff when possible.",
    "- Keep summary concise."
  ].join("\n");

  const requestBody = {
    model: MODEL,
    temperature: 0.1,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt }
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "xyavoryx_ai_pr_review",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          required: ["summary", "overall_risk", "findings"],
          properties: {
            summary: { type: "string" },
            overall_risk: { type: "string", enum: ["low", "medium", "high"] },
            findings: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                required: ["severity", "category", "file", "line", "title", "evidence", "suggested_fix"],
                properties: {
                  severity: { type: "string", enum: ["critical", "high", "medium", "low"] },
                  category: {
                    type: "string",
                    enum: ["bug", "security", "design", "test-gap", "performance", "maintainability"]
                  },
                  file: { type: "string" },
                  line: { type: "integer", minimum: 1 },
                  title: { type: "string" },
                  evidence: { type: "string" },
                  suggested_fix: { type: "string" }
                }
              }
            }
          }
        }
      }
    }
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(`${OPENAI_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(requestBody),
      signal: controller.signal
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`OpenAI API error ${response.status}: ${sanitizeLine(errorBody)}`);
    }

    const rawJson = (await response.json()) as unknown;
    const content = parseChatCompletionContent(rawJson);
    const parsed = safeJsonParse<AIReviewResult>(content);

    if (!parsed) {
      throw new Error("AI response is not valid JSON.");
    }

    return normalizeResult(parsed);
  } finally {
    clearTimeout(timeout);
  }
}

function buildMarkdownReport(report: PersistedReport): string {
  const lines: string[] = [];
  lines.push("## XyaVoryx AI PR Review");
  lines.push("");
  lines.push(`- Status: **${report.status.toUpperCase()}**`);
  lines.push(`- Base ref: \`${report.baseRef}\``);
  lines.push(`- Head ref: \`${report.headRef}\``);
  lines.push(`- Changed files: ${report.changedFiles.length}`);
  lines.push(`- Model: \`${MODEL}\``);
  lines.push("");

  if (report.reason) {
    lines.push(`- Reason: ${report.reason}`);
    lines.push("");
  }

  if (report.error) {
    lines.push("### Error");
    lines.push(`- ${report.error}`);
    lines.push("");
  }

  if (!report.result) {
    lines.push("### Findings");
    lines.push("- None");
    lines.push("");
    return lines.join("\n");
  }

  lines.push("### Summary");
  lines.push(`- ${report.result.summary}`);
  lines.push(`- Overall risk: **${report.result.overall_risk.toUpperCase()}**`);
  lines.push("");

  lines.push("### Findings");
  if (report.result.findings.length === 0) {
    lines.push("- None");
  } else {
    const sorted = [...report.result.findings].sort((a, b) => severityRank(b.severity) - severityRank(a.severity));
    for (const finding of sorted) {
      lines.push(`- [${finding.severity.toUpperCase()}] ${finding.title}`);
      lines.push(`  - Category: ${finding.category}`);
      lines.push(`  - Location: ${finding.file}:${finding.line}`);
      lines.push(`  - Evidence: ${finding.evidence}`);
      lines.push(`  - Suggested fix: ${finding.suggested_fix}`);
    }
  }
  lines.push("");

  lines.push("### Notes");
  lines.push("- This is an AI-assisted advisory review.");
  lines.push("- Deterministic Bugbot gates remain the blocking policy layer.");

  return lines.join("\n");
}

function writeOutputs(report: PersistedReport): void {
  const reportMarkdown = buildMarkdownReport(report);
  const findingsPayload = {
    status: report.status,
    baseRef: report.baseRef,
    headRef: report.headRef,
    changedFiles: report.changedFiles,
    reason: report.reason,
    error: report.error,
    result: report.result ?? { summary: "", overall_risk: "low", findings: [] }
  };

  writeFileSync(REPORT_PATH, reportMarkdown, "utf8");
  writeFileSync(FINDINGS_PATH, JSON.stringify(findingsPayload, null, 2), "utf8");
}

async function main(): Promise<void> {
  const baseRef = getBaseRef();
  const { changedFiles, diff, headRef } = collectDiff(baseRef);

  if (!OPENAI_API_KEY) {
    const skippedReport: PersistedReport = {
      status: "skipped",
      reason: "OPENAI_API_KEY is not configured.",
      baseRef,
      headRef,
      changedFiles
    };
    writeOutputs(skippedReport);
    if (AI_REQUIRED) {
      process.exitCode = 2;
    }
    return;
  }

  try {
    const result = await callOpenAI(baseRef, changedFiles, diff);
    const hasHighRiskFinding = result.findings.some((finding) => finding.severity === "critical" || finding.severity === "high");
    const report: PersistedReport = {
      status: hasHighRiskFinding ? "flagged" : "ok",
      baseRef,
      headRef,
      changedFiles,
      result
    };

    writeOutputs(report);

    if (FAIL_ON_HIGH && hasHighRiskFinding) {
      process.exitCode = 2;
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? sanitizeLine(error.message) : "Unknown AI review error.";
    const errorReport: PersistedReport = {
      status: "error",
      baseRef,
      headRef,
      changedFiles,
      error: errorMessage
    };
    writeOutputs(errorReport);
    if (AI_REQUIRED) {
      process.exitCode = 2;
    }
  }
}

void main();
