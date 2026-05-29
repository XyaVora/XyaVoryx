import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const RELEASE_READINESS_SCRIPT = resolve(__dirname, "../../scripts/release/check-release-readiness.mjs");
const tempDirs: string[] = [];

function runGit(args: string[], cwd: string): void {
  execFileSync("git", args, { cwd, stdio: "pipe" });
}

function createRepo(tags: string[] = []): string {
  const root = mkdtempSync(resolve(tmpdir(), "xyavoryx-release-readiness-"));
  tempDirs.push(root);

  runGit(["init"], root);
  runGit(["checkout", "-b", "main"], root);
  runGit(["config", "user.email", "release-test@xyavoryx.local"], root);
  runGit(["config", "user.name", "Release Test"], root);

  writeFileSync(resolve(root, "README.md"), "base\n", "utf8");
  runGit(["add", "."], root);
  runGit(["commit", "-m", "base"], root);

  for (const tag of tags) {
    runGit(["tag", tag], root);
  }

  return root;
}

function runReadiness(repoDir: string, args: string[] = []): { exitCode: number; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync(
      "node",
      [RELEASE_READINESS_SCRIPT, "--report-path", "release-readiness-report.json", ...args],
      {
        cwd: repoDir,
        env: {
          ...process.env,
          RELEASE_READINESS_SKIP_PIPELINE: "1"
        },
        encoding: "utf8",
        stdio: "pipe"
      }
    );
    return { exitCode: 0, stdout, stderr: "" };
  } catch (error) {
    const failure = error as { status?: number; stdout?: string; stderr?: string };
    return {
      exitCode: failure.status ?? 1,
      stdout: failure.stdout ?? "",
      stderr: failure.stderr ?? ""
    };
  }
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const directory = tempDirs.pop();
    if (directory) {
      rmSync(directory, { recursive: true, force: true });
    }
  }
});

describe("release readiness gate", () => {
  it("passes patch release scope when patch is incremented", () => {
    const repo = createRepo(["v1.1.3"]);

    const result = runReadiness(repo, ["--release-tag", "v1.1.4", "--release-scope", "patch"]);
    const report = JSON.parse(readFileSync(resolve(repo, "release-readiness-report.json"), "utf8")) as {
      passed: boolean;
      latestSemverTag: string | null;
      pipeline: { executed: boolean };
      releasePolicy: { status: string; detail: string };
    };

    expect(result.exitCode).toBe(0);
    expect(report.passed).toBe(true);
    expect(report.latestSemverTag).toBe("v1.1.3");
    expect(report.pipeline.executed).toBe(false);
    expect(report.releasePolicy.status).toBe("passed");
  });

  it("fails patch release scope when minor is bumped", () => {
    const repo = createRepo(["v1.1.3"]);

    const result = runReadiness(repo, ["--release-tag", "v1.2.0", "--release-scope", "patch"]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Patch release must keep major/minor");
  });

  it("passes minor release scope when minor is bumped", () => {
    const repo = createRepo(["v1.1.3"]);

    const result = runReadiness(repo, ["--release-tag", "v1.2.0", "--release-scope", "minor"]);
    const report = JSON.parse(readFileSync(resolve(repo, "release-readiness-report.json"), "utf8")) as {
      releasePolicy: { status: string; detail: string };
    };

    expect(result.exitCode).toBe(0);
    expect(report.releasePolicy.status).toBe("passed");
    expect(report.releasePolicy.detail).toContain("minor increment policy satisfied");
  });

  it("fails on dirty working tree by default", () => {
    const repo = createRepo(["v1.1.3"]);
    writeFileSync(resolve(repo, "DIRTY.txt"), "dirty\n", "utf8");

    const result = runReadiness(repo, []);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("clean working tree");
  });
});
