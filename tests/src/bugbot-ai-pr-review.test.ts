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

function runAiReview(repoDir: string, extraEnv: Record<string, string> = {}): { exitCode: number; report: string; payload: string } {
  const reportPath = resolve(repoDir, "bugbot-ai-report.md");
  const findingsPath = resolve(repoDir, "bugbot-ai-findings.json");
  let exitCode = 0;

  try {
    execFileSync("node", [AI_REVIEW_SCRIPT], {
      cwd: repoDir,
      env: {
        ...process.env,
        BUGBOT_BASE_REF: "HEAD~1",
        BUGBOT_AI_REPORT_PATH: reportPath,
        BUGBOT_AI_FINDINGS_PATH: findingsPath,
        ...extraEnv
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

    const result = runAiReview(repoDir, { OPENAI_API_KEY: "" });

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

    const result = runAiReview(repoDir, { OPENAI_API_KEY: "", BUGBOT_AI_REQUIRED: "1" });

    expect(result.exitCode).toBe(2);
    expect(result.report).toContain("Status: **SKIPPED**");
    expect(result.payload).toContain("\"status\": \"skipped\"");
  });
});
