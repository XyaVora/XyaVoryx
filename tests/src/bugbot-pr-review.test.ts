import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const BUGBOT_SCRIPT = resolve(__dirname, "../../scripts/bugbot/pr-review.mjs");

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
  const repoDir = mkdtempSync(resolve(tmpdir(), "xyavoryx-bugbot-"));
  tempDirs.push(repoDir);

  runGitCommand(["init"], repoDir);
  runGitCommand(["config", "user.email", "bugbot-test@xyavoryx.local"], repoDir);
  runGitCommand(["config", "user.name", "Bugbot Test"], repoDir);

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

function runBugbotReview(
  repoDir: string,
  options: {
    extraEnv?: Record<string, string>;
    enforcementPolicy?: Record<string, unknown>;
    repositoryProfile?: Record<string, unknown>;
  } = {}
): { exitCode: number; report: string } {
  const reportPath = resolve(repoDir, "bugbot-report.md");
  const enforcementPath = resolve(repoDir, "bugbot-enforcement.json");
  const repositoryProfilePath = resolve(repoDir, "bugbot-repository-profile.json");
  let exitCode = 0;

  if (options.enforcementPolicy) {
    writeFileSync(enforcementPath, JSON.stringify(options.enforcementPolicy, null, 2), "utf8");
  }
  if (options.repositoryProfile) {
    writeFileSync(repositoryProfilePath, JSON.stringify(options.repositoryProfile, null, 2), "utf8");
  }

  try {
    execFileSync("node", [BUGBOT_SCRIPT], {
      cwd: repoDir,
      env: {
        ...process.env,
        BUGBOT_BASE_REF: "HEAD~1",
        BUGBOT_REPORT_PATH: reportPath,
        BUGBOT_ENFORCEMENT_PATH: enforcementPath,
        BUGBOT_REPOSITORY_PROFILE_PATH: repositoryProfilePath,
        ...(options.extraEnv ?? {})
      },
      stdio: "pipe"
    });
  } catch (error) {
    const code = (error as { status?: number }).status;
    exitCode = typeof code === "number" ? code : 1;
  }

  const report = readFileSync(reportPath, "utf8");
  return { exitCode, report };
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe("bugbot pr-review", () => {
  it("returns PASS for clean deterministic changes", () => {
    const repoDir = createTempRepo(
      { "README.md": "base\n" },
      { "README.md": "base\nsafe deterministic update\n" }
    );

    const result = runBugbotReview(repoDir);

    expect(result.exitCode).toBe(0);
    expect(result.report).toContain("Status: **PASS**");
    expect(result.report).toContain("### High Severity Findings\n- None");
    expect(result.report).toContain("### Cursor Security Agent: Security Reviewer");
    expect(result.report).toContain("No direct security policy violations detected.");
    expect(result.report).toContain("### CI Gate Matrix");
    expect(result.report).toContain("PASS domain=security, severity=high");
  });

  it("returns BLOCKED when high severity pattern is introduced", () => {
    const repoDir = createTempRepo(
      { "README.md": "base\n" },
      {
        "README.md": "base\n",
        "packages/runtime/src/example.ts": "export const now = () => Date.now();\n"
      }
    );

    const result = runBugbotReview(repoDir);

    expect(result.exitCode).toBe(2);
    expect(result.report).toContain("Status: **BLOCKED**");
    expect(result.report).toContain("Potential non-deterministic runtime primitive detected in runtime core.");
    expect(result.report).toMatch(/packages\/runtime\/src\/example\.ts:\d+/);
    expect(result.report).toContain("BLOCK domain=runtime, severity=high");
  });

  it("ignores self-scan files to avoid false positives", () => {
    const repoDir = createTempRepo(
      { "README.md": "base\n" },
      {
        "README.md": "base\n",
        ".cursor/BUGBOT.md": "Do not use better-sqlite3. API key required.\n"
      }
    );

    const result = runBugbotReview(repoDir);

    expect(result.exitCode).toBe(0);
    expect(result.report).toContain("Status: **PASS**");
    expect(result.report).not.toContain("Detected `better-sqlite3` usage.");
    expect(result.report).not.toContain("Detected API key requirement pattern in PR diff.");
  });

  it("does not flag negative API key requirement statements", () => {
    const repoDir = createTempRepo(
      { "README.md": "base\n" },
      {
        "README.md": "base\nNo cloud dependency and no API key required for examples/tests.\n"
      }
    );

    const result = runBugbotReview(repoDir);

    expect(result.exitCode).toBe(0);
    expect(result.report).toContain("Status: **PASS**");
    expect(result.report).not.toContain("Detected API key requirement pattern in PR diff.");
  });

  it("shows security reviewer section with line-mapped findings", () => {
    const repoDir = createTempRepo(
      { "README.md": "base\n" },
      {
        "README.md": "base\n",
        "packages/tools/src/insecure-tool.ts": "export const call = async () => fetch('https://example.com');\n"
      }
    );

    const result = runBugbotReview(repoDir);

    expect(result.exitCode).toBe(2);
    expect(result.report).toContain("### Cursor Security Agent: Security Reviewer");
    expect(result.report).toContain("[HIGH] Network call detected in built-in tool implementation.");
    expect(result.report).toMatch(/Primary location: packages\/tools\/src\/insecure-tool\.ts:\d+/);
  });

  it("maps advanced security reviewer findings to CWE and OWASP tags", () => {
    const repoDir = createTempRepo(
      { "README.md": "base\n" },
      {
        "README.md": "base\n",
        "packages/runtime/src/tls-risk.ts": "export const insecureTls = { rejectUnauthorized: false };\n"
      }
    );

    const result = runBugbotReview(repoDir);

    expect(result.exitCode).toBe(2);
    expect(result.report).toContain("[SEC-TLS-001] TLS certificate verification is disabled");
    expect(result.report).toContain("CWE-295");
    expect(result.report).toContain("A02:2021 - Cryptographic Failures");
    expect(result.report).toMatch(/Primary location: packages\/runtime\/src\/tls-risk\.ts:\d+/);
  });

  it("detects path traversal style composition via security reviewer rule pack", () => {
    const repoDir = createTempRepo(
      { "README.md": "base\n" },
      {
        "README.md": "base\n",
        "packages/runtime/src/path-risk.ts": "export const p = path.join('/safe', req.body.name);\n"
      }
    );

    const result = runBugbotReview(repoDir);

    expect(result.exitCode).toBe(2);
    expect(result.report).toContain("[SEC-PATH-001] Potential path traversal risk from unsanitized path composition");
    expect(result.report).toContain("CWE-22");
    expect(result.report).toContain("A01:2021 - Broken Access Control");
  });

  it("detects SSRF pattern from untrusted request target", () => {
    const repoDir = createTempRepo(
      { "README.md": "base\n" },
      {
        "README.md": "base\n",
        "packages/runtime/src/ssrf-risk.ts": "export const call = () => fetch(req.query.target);\n"
      }
    );

    const result = runBugbotReview(repoDir);

    expect(result.exitCode).toBe(2);
    expect(result.report).toContain("[SEC-SSRF-001] Potential SSRF via untrusted outbound request target");
    expect(result.report).toContain("CWE-918");
    expect(result.report).toContain("A10:2021 - Server-Side Request Forgery");
  });

  it("detects insecure CORS configuration pattern", () => {
    const repoDir = createTempRepo(
      { "README.md": "base\n" },
      {
        "README.md": "base\n",
        "packages/runtime/src/cors-risk.ts": "app.use(cors({ origin: '*', credentials: true }));\n"
      }
    );

    const result = runBugbotReview(repoDir);

    expect(result.exitCode).toBe(2);
    expect(result.report).toContain("[SEC-CORS-001] Potential insecure CORS configuration");
    expect(result.report).toContain("CWE-942");
  });

  it("detects weak hardcoded JWT secret pattern", () => {
    const repoDir = createTempRepo(
      { "README.md": "base\n" },
      {
        "README.md": "base\n",
        "packages/runtime/src/jwt-risk.ts": "const token = jwt.sign(payload, 'secret');\n"
      }
    );

    const result = runBugbotReview(repoDir);

    expect(result.exitCode).toBe(2);
    expect(result.report).toContain("[SEC-JWT-001] Potential weak or hardcoded JWT secret");
    expect(result.report).toContain("CWE-321");
    expect(result.report).toContain("A02:2021 - Cryptographic Failures");
  });

  it("blocks critical path changes when no tests are updated", () => {
    const repoDir = createTempRepo(
      { "README.md": "base\n" },
      {
        "README.md": "base\n",
        "packages/runtime/src/safe-change.ts": "export const normalize = (value: string) => value.trim();\n"
      }
    );

    const result = runBugbotReview(repoDir);

    expect(result.exitCode).toBe(2);
    expect(result.report).toContain("Critical path changes detected without accompanying test updates.");
    expect(result.report).toContain("Critical path changed: yes");
    expect(result.report).toContain("Test files changed: no");
  });

  it("passes critical path gate when matching tests are updated", () => {
    const repoDir = createTempRepo(
      { "README.md": "base\n" },
      {
        "README.md": "base\n",
        "packages/runtime/src/safe-change.ts": "export const normalize = (value: string) => value.trim();\n",
        "tests/src/safe-change.test.ts": "import { describe, it, expect } from 'vitest';\ndescribe('safe-change', () => { it('trim', () => { expect(' x '.trim()).toBe('x'); }); });\n"
      }
    );

    const result = runBugbotReview(repoDir);

    expect(result.exitCode).toBe(0);
    expect(result.report).toContain("Status: **PASS**");
    expect(result.report).toContain("Critical path changed: yes");
    expect(result.report).toContain("Test files changed: yes");
    expect(result.report).not.toContain("Critical path changes detected without accompanying test updates.");
  });

  it("blocks when changed source file has no file-level mapped test update", () => {
    const repoDir = createTempRepo(
      { "README.md": "base\n" },
      {
        "README.md": "base\n",
        "packages/tools/src/ioc-extractor-tool.ts": "export const renamed = true;\n",
        "tests/src/unrelated.test.ts": "import { describe, it, expect } from 'vitest';\ndescribe('unrelated', () => { it('ok', () => { expect(true).toBe(true); }); });\n"
      }
    );

    const result = runBugbotReview(repoDir);

    expect(result.exitCode).toBe(2);
    expect(result.report).toContain(
      "Missing file-level test mapping for changed source file: packages/tools/src/ioc-extractor-tool.ts"
    );
  });

  it("passes when changed source file has file-level mapped test update", () => {
    const repoDir = createTempRepo(
      { "README.md": "base\n" },
      {
        "README.md": "base\n",
        "packages/tools/src/ioc-extractor-tool.ts": "export const renamed = true;\n",
        "tests/src/ioc-extractor-tool.test.ts": "import { describe, it, expect } from 'vitest';\ndescribe('ioc', () => { it('ok', () => { expect(true).toBe(true); }); });\n"
      }
    );

    const result = runBugbotReview(repoDir);

    expect(result.exitCode).toBe(0);
    expect(result.report).toContain("Status: **PASS**");
    expect(result.report).not.toContain("Missing file-level test mapping for changed source file");
  });

  it("blocks when medium security findings threshold is exceeded", () => {
    const repoDir = createTempRepo(
      { "README.md": "base\n" },
      {
        "README.md": "base\n",
        "packages/runtime/src/medium-risk-a.ts": "import { createHash } from 'node:crypto';\nexport const h = createHash('md5').update('x').digest('hex');\n",
        "packages/runtime/src/medium-risk-b.ts": "import fs from 'node:fs';\nexport const w = () => fs.writeFileSync('/tmp/risk.txt', 'x');\n",
        "tests/src/medium-risk.test.ts": "import { describe, it, expect } from 'vitest';\ndescribe('medium-risk', () => { it('ok', () => { expect(true).toBe(true); }); });\n"
      }
    );

    const result = runBugbotReview(repoDir);

    expect(result.exitCode).toBe(2);
    expect(result.report).toContain("Medium security findings threshold exceeded");
  });

  it("blocks ownership-sensitive runtime changes without targeted ownership tests", () => {
    const repoDir = createTempRepo(
      { "README.md": "base\n" },
      {
        "README.md": "base\n",
        "packages/runtime/src/policy-engine.ts": "export const policyVersion = 'x';\n",
        "tests/src/unrelated.test.ts": "import { describe, it, expect } from 'vitest';\ndescribe('unrelated', () => { it('ok', () => { expect(true).toBe(true); }); });\n"
      }
    );

    const result = runBugbotReview(repoDir);

    expect(result.exitCode).toBe(2);
    expect(result.report).toContain("[OWNER-RUNTIME-POLICY] Sensitive runtime/policy files changed without matching ownership tests.");
  });

  it("passes ownership-sensitive runtime changes when targeted ownership tests are updated", () => {
    const repoDir = createTempRepo(
      { "README.md": "base\n" },
      {
        "README.md": "base\n",
        "packages/runtime/src/policy-engine.ts": "export const policyVersion = 'x';\n",
        "tests/src/policy-engine.test.ts": "import { describe, it, expect } from 'vitest';\ndescribe('policy-engine', () => { it('ok', () => { expect(true).toBe(true); }); });\n"
      }
    );

    const result = runBugbotReview(repoDir);

    expect(result.exitCode).toBe(0);
    expect(result.report).toContain("Status: **PASS**");
    expect(result.report).not.toContain("[OWNER-RUNTIME-POLICY]");
  });

  it("allows custom repository policy to disable high-severity blocking", () => {
    const repoDir = createTempRepo(
      { "README.md": "base\n" },
      {
        "README.md": "base\n",
        "packages/runtime/src/example.ts": "export const now = () => Date.now();\n",
        "tests/src/example.test.ts": "import { describe, it, expect } from 'vitest';\ndescribe('example', () => { it('ok', () => { expect(true).toBe(true); }); });\n"
      }
    );

    const result = runBugbotReview(repoDir, {
      enforcementPolicy: {
        blockSeverities: [],
        blockOnGateHits: false
      }
    });

    expect(result.exitCode).toBe(0);
    expect(result.report).toContain("Status: **PASS**");
    expect(result.report).toContain("Enforcement block severities: none");
    expect(result.report).toContain("Enforcement gate blocking: disabled");
  });

  it("allows custom repository policy to block medium findings", () => {
    const repoDir = createTempRepo(
      { "README.md": "base\n" },
      {
        "README.md": "base\nThis line contains emoji-like symbol: 🧪\n"
      }
    );

    const result = runBugbotReview(repoDir, {
      enforcementPolicy: {
        blockSeverities: ["medium"],
        blockOnGateHits: false
      }
    });

    expect(result.exitCode).toBe(2);
    expect(result.report).toContain("Status: **BLOCKED**");
    expect(result.report).toContain("Emoji-like character detected.");
    expect(result.report).toContain("Enforcement block severities: medium");
  });

  it("strict profile blocks medium findings without custom enforcement policy", () => {
    const repoDir = createTempRepo(
      { "README.md": "base\n" },
      {
        "README.md": "base\nconst h = createHash('md5');\n"
      }
    );

    const result = runBugbotReview(repoDir, {
      extraEnv: {
        BUGBOT_PROFILE: "strict"
      }
    });

    expect(result.exitCode).toBe(2);
    expect(result.report).toContain("Status: **BLOCKED**");
    expect(result.report).toContain("Active profile: strict");
    expect(result.report).toContain("Enforcement block severities: high, medium");
    expect(result.report).toContain("Weak hash algorithm detected");
  });

  it("fast profile allows isolated medium findings without escalation", () => {
    const repoDir = createTempRepo(
      { "README.md": "base\n" },
      {
        "README.md": "base\nconst h = createHash('md5');\n"
      }
    );

    const result = runBugbotReview(repoDir, {
      extraEnv: {
        BUGBOT_PROFILE: "fast"
      }
    });

    expect(result.exitCode).toBe(0);
    expect(result.report).toContain("Status: **PASS**");
    expect(result.report).toContain("Active profile: fast");
    expect(result.report).toContain("Weak hash algorithm detected");
    expect(result.report).not.toContain("Medium findings threshold exceeded");
  });

  it("uses repository profile project type to resolve deterministic strictness", () => {
    const repoDir = createTempRepo(
      { "README.md": "base\n" },
      {
        "README.md": "base\nconst h = createHash('md5');\n"
      }
    );

    const result = runBugbotReview(repoDir, {
      repositoryProfile: {
        projectType: "security-critical"
      }
    });

    expect(result.exitCode).toBe(2);
    expect(result.report).toContain("Status: **BLOCKED**");
    expect(result.report).toContain("Active profile: strict");
    expect(result.report).toContain("Enforcement block severities: high, medium");
  });
});
