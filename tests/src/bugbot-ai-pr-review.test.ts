import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const AI_REVIEW_SCRIPT = resolve(__dirname, "../../scripts/bugbot/ai-pr-review.mjs");
const tempDirs: string[] = [];

function runGitCommand(args: string[], cwd: string): void {
  execFileSync("git", args, { cwd, stdio: "pipe" });
}

function writeRepoFile(repoDir: string, relativePath: string, content: string): void {
  const absolutePath = resolve(repoDir, relativePath);
  mkdirSync(dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, content, "utf8");
}

function createTempRepo(baseFiles: Record<string, string>, headFiles: Record<string, string>): string {
  const repoDir = mkdtempSync(resolve(tmpdir(), "xyavoryx-ai-bugbot-"));
  tempDirs.push(repoDir);

  runGitCommand(["init"], repoDir);
  runGitCommand(["config", "user.email", "bugbot-ai-test@xyavoryx.local"], repoDir);
  runGitCommand(["config", "user.name", "Bugbot AI Test"], repoDir);

  for (const [file, content] of Object.entries(baseFiles)) {
    writeRepoFile(repoDir, file, content);
  }

  runGitCommand(["add", "."], repoDir);
  runGitCommand(["commit", "-m", "base"], repoDir);

  for (const [file, content] of Object.entries(headFiles)) {
    writeRepoFile(repoDir, file, content);
  }

  runGitCommand(["add", "."], repoDir);
  runGitCommand(["commit", "-m", "head"], repoDir);

  return repoDir;
}

function runAiReview(
  repoDir: string,
  options: { extraEnv?: Record<string, string>; repositoryProfile?: Record<string, unknown> } = {}
): { exitCode: number; report: string; payload: string } {
  const reportPath = resolve(repoDir, "bugbot-ai-report.md");
  const findingsPath = resolve(repoDir, "bugbot-ai-findings.json");
  const repositoryProfilePath = resolve(repoDir, "bugbot-repository-profile.json");
  let exitCode = 0;

  if (options.repositoryProfile) {
    writeFileSync(repositoryProfilePath, JSON.stringify(options.repositoryProfile, null, 2), "utf8");
  }

  try {
    execFileSync("node", [AI_REVIEW_SCRIPT], {
      cwd: repoDir,
      env: {
        ...process.env,
        BUGBOT_BASE_REF: "HEAD~1",
        BUGBOT_AI_REPORT_PATH: reportPath,
        BUGBOT_AI_FINDINGS_PATH: findingsPath,
        BUGBOT_REPOSITORY_PROFILE_PATH: repositoryProfilePath,
        ...(options.extraEnv ?? {})
      },
      stdio: "pipe"
    });
  } catch (error) {
    const code = (error as { status?: number }).status;
    exitCode = typeof code === "number" ? code : 1;
  }

  return {
    exitCode,
    report: readFileSync(reportPath, "utf8"),
    payload: readFileSync(findingsPath, "utf8")
  };
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe("bugbot ai-pr-review", () => {
  it("writes skipped report when OPENAI_API_KEY is missing", () => {
    const repoDir = createTempRepo(
      { "README.md": "base\n" },
      { "README.md": "base\nupdate\n" }
    );

    const result = runAiReview(repoDir, { extraEnv: { OPENAI_API_KEY: "" } });

    expect(result.exitCode).toBe(0);
    expect(result.report).toContain("Status: **SKIPPED**");
    expect(result.report).toContain("OPENAI_API_KEY is not configured.");
    expect(result.payload).toContain("\"status\": \"skipped\"");
  });

  it("fails when AI_REQUIRED=1 and OPENAI_API_KEY is missing", () => {
    const repoDir = createTempRepo(
      { "README.md": "base\n" },
      { "README.md": "base\nupdate\n" }
    );

    const result = runAiReview(repoDir, { extraEnv: { OPENAI_API_KEY: "", BUGBOT_AI_REQUIRED: "1" } });

    expect(result.exitCode).toBe(2);
    expect(result.report).toContain("Status: **SKIPPED**");
    expect(result.payload).toContain("\"status\": \"skipped\"");
  });

  it("drops AI findings that do not map to changed diff locations", () => {
    const repoDir = createTempRepo(
      { "README.md": "base\n" },
      {
        "README.md": "base\n",
        "packages/runtime/src/example.ts": "export const value = 1;\n"
      }
    );

    const mockPath = resolve(repoDir, "mock-ai.json");
    writeFileSync(
      mockPath,
      JSON.stringify(
        {
          summary: "Mock review",
          overall_risk: "medium",
          findings: [
            {
              severity: "medium",
              category: "bug",
              file: "packages/runtime/src/example.ts",
              line: 1,
              title: "Valid mapped finding",
              evidence:
                "The changed line directly introduces a new exported value without validation guard in this module context.",
              suggested_fix:
                "Add explicit validation or guard checks around this exported value usage to prevent incorrect downstream assumptions."
            },
            {
              severity: "high",
              category: "security",
              file: "packages/runtime/src/non-existent.ts",
              line: 9,
              title: "Invalid file finding",
              evidence: "file not changed",
              suggested_fix: "drop"
            },
            {
              severity: "high",
              category: "security",
              file: "packages/runtime/src/example.ts",
              line: 99,
              title: "Invalid line finding",
              evidence: "line not in diff",
              suggested_fix: "drop"
            }
          ]
        },
        null,
        2
      ),
      "utf8"
    );

    const result = runAiReview(repoDir, {
      extraEnv: {
        OPENAI_API_KEY: "",
        BUGBOT_AI_MOCK_RESULT_PATH: mockPath
      }
    });
    const payload = JSON.parse(result.payload) as {
      droppedInvalidFindings: number;
      droppedLowConfidenceFindings: number;
      result: { findings: Array<{ title: string; confidence: number }> };
    };

    expect(result.exitCode).toBe(0);
    expect(result.report).toContain("Status: **OK**");
    expect(result.report).toContain("Minimum confidence: 55");
    expect(result.report).toContain("Dropped invalid findings: 2");
    expect(result.report).toContain("Dropped low-confidence findings: 0");
    expect(payload.droppedInvalidFindings).toBe(2);
    expect(payload.droppedLowConfidenceFindings).toBe(0);
    expect(payload.result.findings).toHaveLength(1);
    expect(payload.result.findings[0]?.title).toContain("Valid mapped finding");
    expect(payload.result.findings[0]?.confidence).toBeGreaterThanOrEqual(55);
  });

  it("drops valid mapped finding when confidence is below threshold", () => {
    const repoDir = createTempRepo(
      { "README.md": "base\n" },
      {
        "README.md": "base\n",
        "packages/runtime/src/example.ts": "export const value = 1;\n"
      }
    );

    const mockPath = resolve(repoDir, "mock-ai-low-confidence.json");
    writeFileSync(
      mockPath,
      JSON.stringify(
        {
          summary: "Mock review low confidence",
          overall_risk: "medium",
          findings: [
            {
              severity: "high",
              category: "bug",
              file: "packages/runtime/src/example.ts",
              line: 1,
              title: "Weak",
              evidence: "maybe issue",
              suggested_fix: "fix"
            }
          ]
        },
        null,
        2
      ),
      "utf8"
    );

    const result = runAiReview(repoDir, {
      extraEnv: {
        OPENAI_API_KEY: "",
        BUGBOT_AI_MOCK_RESULT_PATH: mockPath,
        BUGBOT_AI_MIN_CONFIDENCE: "80"
      }
    });
    const payload = JSON.parse(result.payload) as {
      droppedInvalidFindings: number;
      droppedLowConfidenceFindings: number;
      result: { findings: Array<{ title: string }> };
    };

    expect(result.exitCode).toBe(0);
    expect(result.report).toContain("Status: **OK**");
    expect(result.report).toContain("Minimum confidence: 80");
    expect(result.report).toContain("Dropped invalid findings: 0");
    expect(result.report).toContain("Dropped low-confidence findings: 1");
    expect(payload.droppedInvalidFindings).toBe(0);
    expect(payload.droppedLowConfidenceFindings).toBe(1);
    expect(payload.result.findings).toHaveLength(0);
  });

  it("uses repository profile project type to apply strict AI confidence preset", () => {
    const repoDir = createTempRepo(
      { "README.md": "base\n" },
      {
        "README.md": "base\n",
        "packages/runtime/src/example.ts": "export const value = 1;\n"
      }
    );

    const mockPath = resolve(repoDir, "mock-ai-strict-profile.json");
    writeFileSync(
      mockPath,
      JSON.stringify(
        {
          summary: "Mock review strict profile",
          overall_risk: "medium",
          findings: [
            {
              severity: "medium",
              category: "bug",
              file: "packages/runtime/src/example.ts",
              line: 1,
              title: "Moderate confidence mapped finding",
              evidence: "Likely issue in export line.",
              suggested_fix: "Guard."
            }
          ]
        },
        null,
        2
      ),
      "utf8"
    );

    const result = runAiReview(repoDir, {
      repositoryProfile: {
        projectType: "security-critical"
      },
      extraEnv: {
        OPENAI_API_KEY: "",
        BUGBOT_AI_MOCK_RESULT_PATH: mockPath
      }
    });

    expect(result.exitCode).toBe(0);
    expect(result.report).toContain("Status: **OK**");
    expect(result.report).toContain("Active profile: strict");
    expect(result.report).toContain("Minimum confidence: 70");
    expect(result.report).toContain("Dropped low-confidence findings: 1");
  });
});
