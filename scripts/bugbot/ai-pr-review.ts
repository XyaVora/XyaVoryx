#!/usr/bin/env node
import { execSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

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

type RawAIReviewResult = {
  summary: string;
  overall_risk: "low" | "medium" | "high";
  findings: AIFinding[];
};

type ConfidenceLabel = "low" | "medium" | "high";

type ReviewedFinding = AIFinding & {
  confidence: number;
  confidence_label: ConfidenceLabel;
};

type AIReviewResult = {
  summary: string;
  overall_risk: "low" | "medium" | "high";
  findings: ReviewedFinding[];
};

type PersistedReport = {
  status: "skipped" | "ok" | "flagged" | "error";
  reason?: string;
  baseRef: string;
  headRef: string;
  changedFiles: string[];
  result?: AIReviewResult;
  droppedInvalidFindings?: number;
  droppedLowConfidenceFindings?: number;
  error?: string;
};

type DiffLocationMap = Map<string, Set<number>>;

const REPORT_PATH = process.env.BUGBOT_AI_REPORT_PATH || "bugbot-ai-report.md";
const FINDINGS_PATH = process.env.BUGBOT_AI_FINDINGS_PATH || "bugbot-ai-findings.json";
const MODEL = process.env.BUGBOT_AI_MODEL || "gpt-4.1-mini";
const OPENAI_BASE_URL = process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const AI_REQUIRED = process.env.BUGBOT_AI_REQUIRED === "1";
const MAX_DIFF_CHARS = Number(process.env.BUGBOT_AI_MAX_DIFF_CHARS || 40000);
const MAX_FILES = Number(process.env.BUGBOT_AI_MAX_FILES || 120);
const REQUEST_TIMEOUT_MS = Number(process.env.BUGBOT_AI_TIMEOUT_MS || 90000);
const REPO_PROFILE_PATH = process.env.BUGBOT_REPOSITORY_PROFILE_PATH || ".github/bugbot-repository-profile.json";
const MOCK_RESULT_PATH = process.env.BUGBOT_AI_MOCK_RESULT_PATH || "";

type RepositoryProfile = {
  projectType?: string;
  deterministicProfile?: "strict" | "balanced" | "fast";
  aiProfile?: "strict" | "balanced" | "fast";
};

type AIProfilePreset = {
  minConfidence: number;
  maxFindings: number;
  failOnHigh: boolean;
};

const AI_PROFILE_PRESETS: Record<"strict" | "balanced" | "fast", AIProfilePreset> = {
  strict: {
    minConfidence: 70,
    maxFindings: 20,
    failOnHigh: true
  },
  balanced: {
    minConfidence: 55,
    maxFindings: 30,
    failOnHigh: false
  },
  fast: {
    minConfidence: 45,
    maxFindings: 15,
    failOnHigh: false
  }
};

const PROJECT_TYPE_TO_PROFILE: Record<string, "strict" | "balanced" | "fast"> = {
  security_critical: "strict",
  "security-critical": "strict",
  enterprise_hardened: "strict",
  "enterprise-hardened": "strict",
  default: "balanced",
  balanced: "balanced",
  general: "balanced",
  rapid: "fast",
  rapid_iteration: "fast",
  "rapid-iteration": "fast"
};

function loadOptionalJson<T>(path: string): Partial<T> {
  try {
    if (!existsSync(path)) {
      return {};
    }
    const raw = readFileSync(path, "utf8");
    const parsed = safeJsonParse<Partial<T>>(raw);
    return parsed ?? {};
  } catch {
    return {};
  }
}

function resolveProfileName(value: unknown): "strict" | "balanced" | "fast" | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === "strict" || normalized === "balanced" || normalized === "fast") {
    return normalized;
  }
  return null;
}

function resolveProfileFromProjectType(value: unknown): "strict" | "balanced" | "fast" {
  if (typeof value !== "string") {
    return "balanced";
  }
  const normalized = value.trim().toLowerCase();
  return PROJECT_TYPE_TO_PROFILE[normalized] ?? "balanced";
}

const repositoryProfile = loadOptionalJson<RepositoryProfile>(REPO_PROFILE_PATH);
const activeProfile = resolveProfileName(process.env.BUGBOT_AI_PROFILE)
  ?? resolveProfileName(repositoryProfile.aiProfile)
  ?? resolveProfileFromProjectType(repositoryProfile.projectType);
const activePreset = AI_PROFILE_PRESETS[activeProfile];
const MAX_FINDINGS = Number(process.env.BUGBOT_AI_MAX_FINDINGS || activePreset.maxFindings);
const MIN_CONFIDENCE = Number(process.env.BUGBOT_AI_MIN_CONFIDENCE || activePreset.minConfidence);
const FAIL_ON_HIGH = process.env.BUGBOT_AI_FAIL_ON_HIGH === "1"
  ? true
  : process.env.BUGBOT_AI_FAIL_ON_HIGH === "0"
    ? false
    : activePreset.failOnHigh;

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

function loadMockResultIfConfigured(): RawAIReviewResult | null {
  if (!MOCK_RESULT_PATH) {
    return null;
  }
  if (!existsSync(MOCK_RESULT_PATH)) {
    throw new Error(`Mock result file not found: ${MOCK_RESULT_PATH}`);
  }
  const raw = readFileSync(MOCK_RESULT_PATH, "utf8");
  const parsed = safeJsonParse<RawAIReviewResult>(raw);
  if (!parsed) {
    throw new Error("Mock result file is not valid JSON.");
  }
  return normalizeResult(parsed);
}

function truncateDiff(diff: string): string {
  if (diff.length <= MAX_DIFF_CHARS) {
    return diff;
  }

  return `${diff.slice(0, MAX_DIFF_CHARS)}\n\n[DIFF_TRUNCATED]`;
}

function parseDiffLocations(unifiedDiff: string): DiffLocationMap {
  const locations: DiffLocationMap = new Map();
  let currentFile = "";
  let currentNewLine = 0;

  for (const line of unifiedDiff.split("\n")) {
    if (line.startsWith("+++ b/")) {
      currentFile = line.slice(6).trim();
      if (!locations.has(currentFile)) {
        locations.set(currentFile, new Set<number>());
      }
      continue;
    }

    if (line.startsWith("@@ ")) {
      const match = line.match(/\+(\d+)(?:,\d+)?/);
      if (match) {
        currentNewLine = Number(match[1]);
      }
      continue;
    }

    if (!currentFile) {
      continue;
    }

    if (line.startsWith("+") && !line.startsWith("+++")) {
      locations.get(currentFile)?.add(currentNewLine);
      currentNewLine += 1;
      continue;
    }

    if (line.startsWith("-") && !line.startsWith("---")) {
      continue;
    }

    if (line.startsWith(" ")) {
      locations.get(currentFile)?.add(currentNewLine);
      currentNewLine += 1;
    }
  }

  return locations;
}

function isRelativeRepoPath(file: string): boolean {
  if (!file || file === "n/a") {
    return false;
  }
  if (file.includes("..")) {
    return false;
  }
  if (/^[a-zA-Z]:\\/.test(file)) {
    return false;
  }
  if (file.startsWith("/") || file.startsWith("\\")) {
    return false;
  }
  return true;
}

function confidenceLabel(score: number): ConfidenceLabel {
  if (score >= 80) {
    return "high";
  }
  if (score >= 60) {
    return "medium";
  }
  return "low";
}

function scoreFindingConfidence(finding: AIFinding): number {
  let score = 0;

  score += 30;

  const evidenceLength = finding.evidence.trim().length;
  if (evidenceLength >= 80) {
    score += 30;
  } else if (evidenceLength >= 40) {
    score += 22;
  } else if (evidenceLength >= 20) {
    score += 12;
  } else {
    score += 4;
  }

  const fixLength = finding.suggested_fix.trim().length;
  if (fixLength >= 80) {
    score += 22;
  } else if (fixLength >= 40) {
    score += 16;
  } else if (fixLength >= 20) {
    score += 10;
  } else {
    score += 4;
  }

  const titleWords = finding.title.split(/\s+/).filter(Boolean).length;
  if (titleWords >= 7) {
    score += 12;
  } else if (titleWords >= 4) {
    score += 8;
  } else {
    score += 4;
  }

  if (/\b(maybe|possibly|might|could be)\b/i.test(finding.evidence)) {
    score -= 12;
  }

  const bounded = Math.max(0, Math.min(100, score));
  return bounded;
}

function validateFindingsAgainstDiff(
  result: RawAIReviewResult,
  changedFiles: string[],
  unifiedDiff: string
): { result: AIReviewResult; droppedInvalid: number; droppedLowConfidence: number } {
  const changedFileSet = new Set(changedFiles);
  const locationMap = parseDiffLocations(unifiedDiff);
  const dedupe = new Set<string>();
  const validated: ReviewedFinding[] = [];
  let droppedInvalid = 0;
  let droppedLowConfidence = 0;

  for (const finding of result.findings) {
    const key = `${finding.file}:${finding.line}:${finding.title.toLowerCase()}`;
    if (dedupe.has(key)) {
      droppedInvalid += 1;
      continue;
    }

    const validPath = isRelativeRepoPath(finding.file);
    const pathKnown = validPath && changedFileSet.has(finding.file);
    const lineKnown = pathKnown && locationMap.get(finding.file)?.has(finding.line);

    if (!pathKnown || !lineKnown) {
      droppedInvalid += 1;
      continue;
    }

    const confidence = scoreFindingConfidence(finding);
    if (confidence < MIN_CONFIDENCE) {
      droppedLowConfidence += 1;
      continue;
    }

    dedupe.add(key);
    validated.push({
      ...finding,
      confidence,
      confidence_label: confidenceLabel(confidence)
    });
    if (validated.length >= MAX_FINDINGS) {
      break;
    }
  }

  return {
    result: {
      ...result,
      findings: validated
    },
    droppedInvalid,
    droppedLowConfidence
  };
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

function normalizeResult(result: RawAIReviewResult): RawAIReviewResult {
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

async function callOpenAI(baseRef: string, changedFiles: string[], diff: string): Promise<RawAIReviewResult> {
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
    const parsed = safeJsonParse<RawAIReviewResult>(content);

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
  lines.push(`- Mock mode: ${MOCK_RESULT_PATH ? "enabled" : "disabled"}`);
  lines.push(`- Active profile: ${activeProfile}`);
  lines.push(`- Minimum confidence: ${MIN_CONFIDENCE}`);
  lines.push(`- Dropped invalid findings: ${report.droppedInvalidFindings ?? 0}`);
  lines.push(`- Dropped low-confidence findings: ${report.droppedLowConfidenceFindings ?? 0}`);
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
    const sorted = [...report.result.findings].sort((a, b) => {
      const severityDelta = severityRank(b.severity) - severityRank(a.severity);
      if (severityDelta !== 0) {
        return severityDelta;
      }
      return b.confidence - a.confidence;
    });
    for (const finding of sorted) {
      lines.push(`- [${finding.severity.toUpperCase()}] ${finding.title}`);
      lines.push(`  - Category: ${finding.category}`);
      lines.push(`  - Location: ${finding.file}:${finding.line}`);
      lines.push(`  - Confidence: ${finding.confidence} (${finding.confidence_label})`);
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
    minimumConfidence: MIN_CONFIDENCE,
    droppedInvalidFindings: report.droppedInvalidFindings ?? 0,
    droppedLowConfidenceFindings: report.droppedLowConfidenceFindings ?? 0,
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

  if (!OPENAI_API_KEY && !MOCK_RESULT_PATH) {
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
    const mockResult = loadMockResultIfConfigured();
    const rawResult = mockResult ?? (await callOpenAI(baseRef, changedFiles, diff));
    const { result, droppedInvalid, droppedLowConfidence } = validateFindingsAgainstDiff(rawResult, changedFiles, diff);
    const hasHighRiskFinding = result.findings.some((finding) => finding.severity === "critical" || finding.severity === "high");
    const report: PersistedReport = {
      status: hasHighRiskFinding ? "flagged" : "ok",
      baseRef,
      headRef,
      changedFiles,
      result,
      droppedInvalidFindings: droppedInvalid,
      droppedLowConfidenceFindings: droppedLowConfidence
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
