#!/usr/bin/env node
import { execSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const DEFAULT_RULES_PATH = join(SCRIPT_DIR, "rules.json");

const defaultRules = {
  selfScanIgnoreFiles: [
    "scripts/bugbot/pr-review.mjs",
    "scripts/bugbot/pr-review.ts",
    "scripts/bugbot/rules.json",
    ".cursor/BUGBOT.md"
  ],
  literalPatternIgnorePathPrefixes: ["tests/"],
  securityReviewer: {
    ignorePathPrefixes: ["tests/", "docs/"],
    gating: {
      blockOn: [
        { domain: "security", severity: "high" },
        { domain: "runtime", severity: "high" },
        { domain: "architecture", severity: "high" }
      ]
    },
    rules: [
      {
        id: "SEC-TLS-001",
        severity: "high",
        title: "TLS certificate verification is disabled",
        cwe: "CWE-295",
        owasp: "A02:2021 - Cryptographic Failures",
        pattern: "rejectUnauthorized\\s*:\\s*false|NODE_TLS_REJECT_UNAUTHORIZED\\s*=\\s*['\\\"]?0",
        why: "Disabling TLS verification enables man-in-the-middle interception.",
        suggestion: "Remove insecure TLS overrides and trust only valid certificates."
      },
      {
        id: "SEC-INJECT-001",
        severity: "high",
        title: "Potential command injection in process execution",
        cwe: "CWE-78",
        owasp: "A03:2021 - Injection",
        pattern: "exec(?:Sync)?\\s*\\([^\\n]*\\$\\{|spawn(?:Sync)?\\s*\\([^\\n]*\\+",
        why: "Interpolated shell commands can execute attacker-controlled input.",
        suggestion: "Use argument-array APIs and validate/allowlist user inputs."
      },
      {
        id: "SEC-EVAL-001",
        severity: "high",
        title: "Dynamic code execution detected",
        cwe: "CWE-95",
        owasp: "A03:2021 - Injection",
        pattern: "\\beval\\s*\\(|new\\s+Function\\s*\\(",
        why: "Dynamic code execution can execute untrusted content.",
        suggestion: "Remove eval-like execution and replace with explicit logic."
      },
      {
        id: "SEC-CRYPTO-001",
        severity: "medium",
        title: "Weak hash algorithm detected",
        cwe: "CWE-327",
        owasp: "A02:2021 - Cryptographic Failures",
        pattern: "createHash\\s*\\(\\s*['\\\"](?:md5|sha1)['\\\"]\\s*\\)",
        why: "MD5/SHA1 are weak for integrity/security-sensitive use cases.",
        suggestion: "Use SHA-256 or stronger algorithm where security is required."
      },
      {
        id: "SEC-SECRET-001",
        severity: "high",
        title: "Potential hardcoded secret or private key marker",
        cwe: "CWE-798",
        owasp: "A02:2021 - Cryptographic Failures",
        pattern: "AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{36}|-----BEGIN (?:RSA|EC|DSA|OPENSSH) PRIVATE KEY-----",
        why: "Hardcoded credentials and private keys expose critical secrets.",
        suggestion: "Remove secrets from source and load via secure secret manager."
      },
      {
        id: "SEC-PATH-001",
        severity: "high",
        title: "Potential path traversal risk from unsanitized path composition",
        cwe: "CWE-22",
        owasp: "A01:2021 - Broken Access Control",
        pattern: "path\\.(?:join|resolve)\\s*\\([^\\n]*(?:req\\.|input\\.|params\\.|query\\.|body\\.)",
        why: "Composing file paths directly from untrusted input can escape intended directories.",
        suggestion: "Normalize and validate path against an allowlisted base directory before file operations."
      },
      {
        id: "SEC-DESER-001",
        severity: "high",
        title: "Potential deserialization of untrusted data",
        cwe: "CWE-502",
        owasp: "A08:2021 - Software and Data Integrity Failures",
        pattern: "\\b(?:yaml\\.load|jsyaml\\.load|deserialize\\s*\\(|unserialize\\s*\\(|pickle\\.loads?\\s*\\()",
        why: "Deserializing untrusted data can trigger arbitrary code paths or object abuse.",
        suggestion: "Use safe parser modes and strict schema validation before deserialization."
      },
      {
        id: "SEC-TMP-001",
        severity: "medium",
        title: "Potential insecure temporary file usage",
        cwe: "CWE-377",
        owasp: "A05:2021 - Security Misconfiguration",
        pattern: "fs\\.(?:writeFile|writeFileSync|createWriteStream|openSync)\\s*\\(\\s*['\\\"][^'\\\"]*(?:/tmp/|\\\\temp\\\\)[^'\\\"]*['\\\"]",
        why: "Predictable or globally writable temporary paths can be abused for file race or overwrite attacks.",
        suggestion: "Use secure temp-file APIs and randomized names with restricted permissions."
      },
      {
        id: "SEC-SSRF-001",
        severity: "high",
        title: "Potential SSRF via untrusted outbound request target",
        cwe: "CWE-918",
        owasp: "A10:2021 - Server-Side Request Forgery",
        pattern: "\\b(?:fetch|axios\\.(?:get|post|request)|http\\.request|https\\.request)\\s*\\([^\\n]*(?:req\\.|input\\.|params\\.|query\\.|body\\.)",
        why: "Outbound request destination appears to be derived from untrusted input.",
        suggestion: "Enforce allowlist for outbound hosts and validate URL scheme/host before request."
      },
      {
        id: "SEC-CORS-001",
        severity: "high",
        title: "Potential insecure CORS configuration",
        cwe: "CWE-942",
        owasp: "A05:2021 - Security Misconfiguration",
        pattern: "origin\\s*:\\s*['\\\"]\\*['\\\"].*credentials\\s*:\\s*true|credentials\\s*:\\s*true.*origin\\s*:\\s*['\\\"]\\*['\\\"]",
        why: "Wildcard CORS origin with credentials may expose sensitive authenticated responses.",
        suggestion: "Use strict origin allowlist and avoid credentials with wildcard origins."
      },
      {
        id: "SEC-JWT-001",
        severity: "high",
        title: "Potential weak or hardcoded JWT secret",
        cwe: "CWE-321",
        owasp: "A02:2021 - Cryptographic Failures",
        pattern: "jwt\\.sign\\s*\\([^\\n]*['\\\"](?:secret|changeme|password|devsecret|testsecret|123456)['\\\"]",
        why: "Hardcoded weak JWT signing secrets can be brute-forced or leaked from source control.",
        suggestion: "Load strong JWT secret from secure configuration and rotate compromised secrets."
      }
    ]
  },
  high: {
    disallowedDependencyPatterns: ["better-sqlite3"],
    apiKeyScanPathPrefixes: ["packages/", "examples/"],
    apiKeyPatterns: [
      "OPENAI_API_KEY",
      "ANTHROPIC_API_KEY",
      "GOOGLE_API_KEY",
      "api\\s*key\\s+is\\s+required",
      "requires\\s+an?\\s+api\\s*key"
    ],
    runtimeNondeterministicPatterns: ["\\bDate\\.now\\(", "\\bMath\\.random\\(", "\\bsetTimeout\\(", "\\bsetInterval\\("],
    offensiveTermPatterns: ["\\bpayload\\b", "\\breverse shell\\b", "\\bbeacon\\b", "\\bc2\\b", "\\bexploit\\b", "\\bprivilege escalation\\b"],
    networkCallPatterns: ["\\bfetch\\(", "\\baxios\\.", "\\bhttp\\.request\\b", "\\bhttps\\.request\\b"]
  },
  medium: {
    emojiPattern: "\\p{Extended_Pictographic}",
    planningPatterns: ["autonomous planning", "tool selection by llm", "dynamic planner"],
    coreRuntimeLogicPatterns: ["\\bclass\\s+\\w+", "\\bnew\\s+\\w+\\(", "\\basync\\s+function\\s+\\w+\\("]
  },
  qualityGates: {
    requireTestsForCriticalPaths: {
      enabled: true,
      criticalPathPrefixes: [
        "packages/runtime/src/",
        "packages/tools/src/",
        "packages/core/src/",
        "scripts/bugbot/"
      ],
      testPathPattern: "^tests/src/.*\\.test\\.ts$"
    },
    requirePerFileTestMapping: {
      enabled: true,
      sourcePatterns: [
        "^packages/runtime/src/(.+)\\.ts$",
        "^packages/tools/src/(.+)\\.ts$",
        "^packages/core/src/(.+)\\.ts$"
      ],
      ignoreSourcePatterns: [
        "^packages/.*/src/index\\.ts$",
        "^packages/.*/src/.*\\.d\\.ts$"
      ],
      testPatterns: [
        "^tests/src/$1\\.test\\.ts$",
        "^tests/src/$1\\.e2e\\.test\\.ts$",
        "^tests/src/.*$1.*\\.test\\.ts$",
        "^tests/src/.*$1.*\\.e2e\\.test\\.ts$"
      ]
    },
    mediumFindingsThreshold: {
      enabled: true,
      blockAtTotal: 5,
      blockAtSecurity: 2
    },
    requireOwnershipTestsForSensitivePaths: {
      enabled: true,
      rules: [
        {
          id: "OWNER-RUNTIME-POLICY",
          pathPrefixes: [
            "packages/runtime/src/policy-engine.ts",
            "packages/runtime/src/agent-runner.ts",
            "packages/runtime/src/tool-executor.ts",
            "packages/runtime/src/deterministic-planner.ts"
          ],
          requiredTestPatterns: [
            "^tests/src/policy-engine\\.test\\.ts$",
            "^tests/src/agent-runner\\.e2e\\.test\\.ts$"
          ],
          message: "Sensitive runtime/policy files changed without matching ownership tests."
        },
        {
          id: "OWNER-BUGBOT",
          pathPrefixes: [
            "scripts/bugbot/"
          ],
          requiredTestPatterns: [
            "^tests/src/bugbot-pr-review\\.test\\.ts$",
            "^tests/src/bugbot-ai-pr-review\\.test\\.ts$"
          ],
          message: "Bugbot scanner changed without matching bugbot test updates."
        }
      ]
    }
  },
  toolImplementationPattern: "^packages/tools/src/.*-tool\\.ts$"
};

function sh(command) {
  return execSync(command, { encoding: "utf8" });
}

function safeRead(path) {
  if (!existsSync(path)) {
    return "";
  }

  return readFileSync(path, "utf8");
}

function safeDelete(path) {
  if (existsSync(path)) {
    unlinkSync(path);
  }
}

function loadRules(path) {
  try {
    const raw = readFileSync(path, "utf8");
    return JSON.parse(raw);
  } catch {
    return defaultRules;
  }
}

function compilePatternList(patterns, flags = "") {
  if (!Array.isArray(patterns) || patterns.length === 0) {
    return null;
  }

  return new RegExp(patterns.join("|"), flags);
}

const args = new Set(process.argv.slice(2));
const reportPath = process.env.BUGBOT_REPORT_PATH || "bugbot-report.md";
const rulesPath = process.env.BUGBOT_RULES_PATH || DEFAULT_RULES_PATH;
const rules = loadRules(rulesPath);

const selfScanIgnoreFiles = new Set(rules.selfScanIgnoreFiles ?? defaultRules.selfScanIgnoreFiles);
const literalPatternIgnorePathPrefixes = rules.literalPatternIgnorePathPrefixes ?? defaultRules.literalPatternIgnorePathPrefixes;
const securityReviewerIgnorePathPrefixes = rules.securityReviewer?.ignorePathPrefixes ?? defaultRules.securityReviewer.ignorePathPrefixes;
const securityReviewerGating = rules.securityReviewer?.gating ?? defaultRules.securityReviewer.gating;
const securityReviewerRules = rules.securityReviewer?.rules ?? defaultRules.securityReviewer.rules;
const toolImplementationRegex = new RegExp(rules.toolImplementationPattern ?? defaultRules.toolImplementationPattern);

const disallowedDependencyRegex = compilePatternList(
  rules.high?.disallowedDependencyPatterns ?? defaultRules.high.disallowedDependencyPatterns
);
const apiKeyScanPathPrefixes = rules.high?.apiKeyScanPathPrefixes ?? defaultRules.high.apiKeyScanPathPrefixes;
const apiKeyRegex = compilePatternList(rules.high?.apiKeyPatterns ?? defaultRules.high.apiKeyPatterns, "i");
const runtimeNondeterministicRegex = compilePatternList(
  rules.high?.runtimeNondeterministicPatterns ?? defaultRules.high.runtimeNondeterministicPatterns
);
const offensiveTermRegex = compilePatternList(rules.high?.offensiveTermPatterns ?? defaultRules.high.offensiveTermPatterns, "i");
const networkCallRegex = compilePatternList(rules.high?.networkCallPatterns ?? defaultRules.high.networkCallPatterns);
const planningRegex = compilePatternList(rules.medium?.planningPatterns ?? defaultRules.medium.planningPatterns, "i");
const coreRuntimeLogicRegex = compilePatternList(
  rules.medium?.coreRuntimeLogicPatterns ?? defaultRules.medium.coreRuntimeLogicPatterns
);
const emojiRegex = new RegExp(rules.medium?.emojiPattern ?? defaultRules.medium.emojiPattern, "u");
const testCoverageGate = rules.qualityGates?.requireTestsForCriticalPaths ?? defaultRules.qualityGates.requireTestsForCriticalPaths;
const perFileTestMappingGate =
  rules.qualityGates?.requirePerFileTestMapping ?? defaultRules.qualityGates.requirePerFileTestMapping;
const mediumThresholdGate = rules.qualityGates?.mediumFindingsThreshold ?? defaultRules.qualityGates.mediumFindingsThreshold;
const ownershipTestGate = rules.qualityGates?.requireOwnershipTestsForSensitivePaths ?? defaultRules.qualityGates.requireOwnershipTestsForSensitivePaths;
const criticalPathPrefixes = testCoverageGate.criticalPathPrefixes ?? defaultRules.qualityGates.requireTestsForCriticalPaths.criticalPathPrefixes;
const testPathRegex = new RegExp(testCoverageGate.testPathPattern ?? defaultRules.qualityGates.requireTestsForCriticalPaths.testPathPattern);

if (args.has("--clean")) {
  safeDelete(reportPath);
  process.exit(0);
}

const baseRef = process.env.BUGBOT_BASE_REF || "origin/main";

function collectGitData() {
  try {
    return {
      changedFiles: sh(`git diff --name-only ${baseRef}...HEAD`).trim().split("\n").filter(Boolean),
      diffNoContext: sh(`git diff --unified=0 ${baseRef}...HEAD`)
    };
  } catch {
    return {
      changedFiles: sh("git diff --name-only HEAD~1...HEAD").trim().split("\n").filter(Boolean),
      diffNoContext: sh("git diff --unified=0 HEAD~1...HEAD")
    };
  }
}

const { changedFiles, diffNoContext } = collectGitData();

/** @typedef {{file: string, line: number, text: string}} AddedLine */
/** @typedef {{severity: "high"|"medium", domain: "security"|"runtime"|"architecture"|"style", message: string, locations: string[], ruleId?: string, cwe?: string, owasp?: string}} Finding */
/** @typedef {{location: string, why: string, suggestion: string}} InlineSuggestion */

/** @type {AddedLine[]} */
const addedLines = [];
/** @type {Finding[]} */
const highFindings = [];
/** @type {Finding[]} */
const mediumFindings = [];
/** @type {InlineSuggestion[]} */
const inlineSuggestions = [];

function parseAddedLinesFromDiff(unifiedDiff) {
  let currentFile = "";
  let currentNewLine = 0;

  for (const line of unifiedDiff.split("\n")) {
    if (line.startsWith("+++ b/")) {
      currentFile = line.slice(6).trim();
      continue;
    }

    if (line.startsWith("@@ ")) {
      const match = line.match(/\+(\d+)(?:,(\d+))?/);
      if (match) {
        currentNewLine = Number(match[1]);
      }
      continue;
    }

    if (!currentFile) {
      continue;
    }

    if (line.startsWith("+") && !line.startsWith("+++")) {
      addedLines.push({ file: currentFile, line: currentNewLine, text: line.slice(1) });
      currentNewLine += 1;
      continue;
    }

    if (line.startsWith("-") && !line.startsWith("---")) {
      continue;
    }

    if (!line.startsWith("diff --git") && !line.startsWith("index ") && !line.startsWith("---")) {
      currentNewLine += 1;
    }
  }
}

parseAddedLinesFromDiff(diffNoContext);

function pushFinding(severity, message, locations = [], domain = "runtime", metadata = {}) {
  const finding = { severity, domain, message, locations, ...metadata };
  if (severity === "high") {
    highFindings.push(finding);
  } else {
    mediumFindings.push(finding);
  }
}

function pushSuggestion(location, why, suggestion) {
  inlineSuggestions.push({ location, why, suggestion });
}

function loc(file, line) {
  return `${file}:${line}`;
}

function lineFromIndex(content, index) {
  if (index < 0) {
    return 1;
  }

  return content.slice(0, index).split("\n").length;
}

function findLineForLiteral(content, literal, fallback = 1) {
  const index = content.indexOf(literal);
  if (index === -1) {
    return fallback;
  }

  return lineFromIndex(content, index);
}

function findLineForRegex(content, regex, fallback = 1) {
  const match = regex.exec(content);
  if (!match || typeof match.index !== "number") {
    return fallback;
  }

  return lineFromIndex(content, match.index);
}

function hasChanged(file) {
  return changedFiles.includes(file);
}

function isBugbotSelfFile(file) {
  return selfScanIgnoreFiles.has(file);
}

function shouldIgnoreLiteralPatternFile(file) {
  return literalPatternIgnorePathPrefixes.some((prefix) => file.startsWith(prefix));
}

function shouldScanApiKeyFile(file) {
  return apiKeyScanPathPrefixes.some((prefix) => file.startsWith(prefix));
}

function shouldIgnoreSecurityReviewerFile(file) {
  return isBugbotSelfFile(file) || securityReviewerIgnorePathPrefixes.some((prefix) => file.startsWith(prefix));
}

function hasCriticalPathChanges() {
  return changedFiles.some((file) => criticalPathPrefixes.some((prefix) => file.startsWith(prefix)));
}

function hasTestCoverageChanges() {
  return changedFiles.some((file) => testPathRegex.test(file));
}

function hasMatchingTests(patterns) {
  if (!Array.isArray(patterns) || patterns.length === 0) {
    return true;
  }

  const regexes = patterns.map((pattern) => new RegExp(pattern));
  return changedFiles.some((file) => regexes.some((regex) => regex.test(file)));
}

function compileRegexList(patterns) {
  if (!Array.isArray(patterns)) {
    return [];
  }

  return patterns.map((pattern) => new RegExp(pattern));
}

function escapeRegexLiteral(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function expandTemplate(template, groups) {
  return template.replace(/\$(\d+)/g, (_, indexText) => {
    const index = Number(indexText) - 1;
    const value = groups[index] ?? "";
    return escapeRegexLiteral(value);
  });
}

function findAdded(pattern, filePredicate = () => true) {
  if (!pattern) {
    return [];
  }

  return addedLines.filter((entry) => filePredicate(entry.file) && pattern.test(entry.text));
}

const disallowedDependencyHits = findAdded(
  disallowedDependencyRegex,
  (file) => !isBugbotSelfFile(file) && !shouldIgnoreLiteralPatternFile(file)
);
if (disallowedDependencyHits.length > 0) {
  const locations = disallowedDependencyHits.map((entry) => loc(entry.file, entry.line));
  pushFinding("high", "Detected `better-sqlite3` usage. This dependency is not allowed.", locations, "security");
  for (const location of locations) {
    pushSuggestion(location, "Native dependency policy violation.", "Remove `better-sqlite3` and keep storage layer pure JS in this baseline.");
  }
}

const apiKeyHits = findAdded(
  apiKeyRegex,
  (file) => !isBugbotSelfFile(file) && !shouldIgnoreLiteralPatternFile(file) && shouldScanApiKeyFile(file)
);
if (apiKeyHits.length > 0) {
  const locations = apiKeyHits.map((entry) => loc(entry.file, entry.line));
  pushFinding("high", "Detected API key requirement pattern in PR diff. Baseline flows must not require API keys.", locations, "security");
  for (const location of locations) {
    pushSuggestion(location, "Default examples must run without secrets.", "Use `MockLLMProvider` and deterministic local flows by default.");
  }
}

const runtimeNondeterministic = findAdded(runtimeNondeterministicRegex, (file) => file.startsWith("packages/runtime/src/"));
if (runtimeNondeterministic.length > 0) {
  const locations = runtimeNondeterministic.map((entry) => loc(entry.file, entry.line));
  pushFinding("high", "Potential non-deterministic runtime primitive detected in runtime core.", locations, "runtime");
  for (const location of locations) {
    pushSuggestion(location, "Runtime determinism risk.", "Use `DeterministicRuntimeContext` for IDs/timestamps and avoid wall-clock/random primitives in runtime core.");
  }
}

const offensiveHits = findAdded(offensiveTermRegex, (file) => file.startsWith("packages/tools/src/"));
if (offensiveHits.length > 0) {
  const locations = offensiveHits.map((entry) => loc(entry.file, entry.line));
  pushFinding("high", "Potential offensive terminology detected in built-in tools. Review scope compliance.", locations, "security");
  for (const location of locations) {
    pushSuggestion(location, "Scope drift risk.", "Keep built-in tools defensive and investigation-oriented only.");
  }
}

const networkCallsInTools = findAdded(networkCallRegex, (file) => file.startsWith("packages/tools/src/"));
if (networkCallsInTools.length > 0) {
  const locations = networkCallsInTools.map((entry) => loc(entry.file, entry.line));
  pushFinding("high", "Network call detected in built-in tool implementation.", locations, "security");
  for (const location of locations) {
    pushSuggestion(location, "Built-in tools should be local-first.", "Remove direct network call or move to policy-gated integration layer outside baseline tools.");
  }
}

for (const securityRule of securityReviewerRules) {
  if (!securityRule?.pattern || !securityRule?.id || !securityRule?.title) {
    continue;
  }

  const regex = new RegExp(securityRule.pattern, securityRule.flags ?? "");
  const hits = findAdded(regex, (file) => !shouldIgnoreSecurityReviewerFile(file));
  if (hits.length === 0) {
    continue;
  }

  const severity = securityRule.severity === "medium" ? "medium" : "high";
  const locations = hits.map((entry) => loc(entry.file, entry.line));
  const message = `[${securityRule.id}] ${securityRule.title}`;
  pushFinding(severity, message, locations, "security", {
    ruleId: securityRule.id,
    cwe: securityRule.cwe,
    owasp: securityRule.owasp
  });

  const why = securityRule.why || "Security reviewer policy rule matched.";
  const suggestion = securityRule.suggestion || "Review and remediate this security finding.";
  for (const location of locations) {
    pushSuggestion(location, why, suggestion);
  }
}

const emojiHits = findAdded(emojiRegex);
if (emojiHits.length > 0) {
  pushFinding("medium", "Emoji-like character detected. Project style prefers emoji-free code and docs.", emojiHits.map((entry) => loc(entry.file, entry.line)), "style");
}

const planningHits = findAdded(planningRegex, (file) => file.startsWith("packages/runtime/src/") || file.startsWith("packages/core/src/"));
if (planningHits.length > 0) {
  pushFinding("medium", "Potential autonomous planning behavior referenced in runtime/core changes. Verify deterministic constraints.", planningHits.map((entry) => loc(entry.file, entry.line)), "runtime");
}

const coreLogicHits = findAdded(coreRuntimeLogicRegex, (file) => file.startsWith("packages/core/src/"));
if (coreLogicHits.length > 0) {
  const locations = coreLogicHits.map((entry) => loc(entry.file, entry.line));
  pushFinding("medium", "Core package appears to include runtime logic. Core should stay interface/type focused.", locations, "architecture");
  for (const location of locations) {
    pushSuggestion(location, "Boundary cleanliness risk.", "Move executable logic to runtime/tools package and keep core as shared contracts.");
  }
}

if (testCoverageGate.enabled && hasCriticalPathChanges() && !hasTestCoverageChanges()) {
  const criticalLocations = changedFiles
    .filter((file) => criticalPathPrefixes.some((prefix) => file.startsWith(prefix)))
    .map((file) => `${file}:1`);

  pushFinding(
    "high",
    "Critical path changes detected without accompanying test updates.",
    criticalLocations,
    "architecture"
  );
  for (const location of criticalLocations) {
    pushSuggestion(
      location,
      "Critical runtime/security paths changed but no tests were updated in this PR.",
      "Add or update tests under `tests/src/*.test.ts` that cover the changed behavior."
    );
  }
}

if (perFileTestMappingGate.enabled) {
  const sourceRegexes = compileRegexList(perFileTestMappingGate.sourcePatterns);
  const ignoreRegexes = compileRegexList(perFileTestMappingGate.ignoreSourcePatterns);
  const testTemplates = Array.isArray(perFileTestMappingGate.testPatterns)
    ? perFileTestMappingGate.testPatterns
    : [];

  const changedTests = changedFiles.filter((file) => testPathRegex.test(file));
  const mappedSourceFiles = changedFiles.filter((file) => sourceRegexes.some((regex) => regex.test(file)));

  for (const sourceFile of mappedSourceFiles) {
    if (ignoreRegexes.some((regex) => regex.test(sourceFile))) {
      continue;
    }

    const matchedRegex = sourceRegexes.find((regex) => regex.test(sourceFile));
    if (!matchedRegex) {
      continue;
    }

    const match = sourceFile.match(matchedRegex);
    if (!match) {
      continue;
    }

    const groups = match.slice(1);
    const expectedRegexes = testTemplates.map((template) => new RegExp(expandTemplate(template, groups)));
    const hasMappedTest = changedTests.some((testFile) => expectedRegexes.some((regex) => regex.test(testFile)));

    if (hasMappedTest) {
      continue;
    }

    const location = `${sourceFile}:1`;
    pushFinding(
      "high",
      `Missing file-level test mapping for changed source file: ${sourceFile}`,
      [location],
      "architecture"
    );
    pushSuggestion(
      location,
      "Source file changed without matching file-level test update.",
      `Add/update a test that matches one of: ${testTemplates.join(", ")}`
    );
  }
}

if (ownershipTestGate.enabled && Array.isArray(ownershipTestGate.rules)) {
  for (const ownershipRule of ownershipTestGate.rules) {
    const pathPrefixes = ownershipRule.pathPrefixes ?? [];
    const matchedPaths = changedFiles.filter((file) => pathPrefixes.some((prefix) => file.startsWith(prefix)));
    if (matchedPaths.length === 0) {
      continue;
    }

    if (hasMatchingTests(ownershipRule.requiredTestPatterns ?? [])) {
      continue;
    }

    const message = ownershipRule.message || "Sensitive paths changed without required ownership tests.";
    const locations = matchedPaths.map((file) => `${file}:1`);
    pushFinding("high", `[${ownershipRule.id ?? "OWNER-GATE"}] ${message}`, locations, "architecture");
    for (const location of locations) {
      pushSuggestion(
        location,
        "Ownership-sensitive path updated without required targeted tests.",
        `Add/update at least one required test file matching: ${(ownershipRule.requiredTestPatterns ?? []).join(", ")}`
      );
    }
  }
}

const toolFiles = changedFiles.filter((file) => toolImplementationRegex.test(file));
for (const file of toolFiles) {
  const content = safeRead(file);
  if (!/inputSchema\s*=\s*z\./.test(content)) {
    const line = findLineForRegex(content, /export\s+const\s+\w+\s*=/, 1);
    const location = loc(file, line);
    pushFinding("medium", "Tool file may be missing Zod input schema.", [location], "architecture");
    pushSuggestion(location, "Input contract may be unvalidated.", "Add `inputSchema` with Zod and parse input through `ToolExecutor`.");
  }
}

if (hasChanged("packages/runtime/src/agent-runner.ts")) {
  const filePath = "packages/runtime/src/agent-runner.ts";
  const runner = safeRead(filePath);
  const toolExecutionAnchor = loc(filePath, findLineForLiteral(runner, "toolExecutor.execute(", 1));
  const reportAnchor = loc(filePath, findLineForLiteral(runner, "report.generated", 1));
  const traceAnchor = loc(filePath, findLineForLiteral(runner, "traceRecorder", 1));

  if (!runner.includes('emitEvent("tool.started"')) {
    pushFinding("high", "agent-runner may be missing `tool.started` emission.", [toolExecutionAnchor], "runtime");
    pushSuggestion(toolExecutionAnchor, "Trace/event completeness risk.", "Emit `tool.started` before tool execution begins.");
  }

  if (!runner.includes('emitEvent("report.generated"')) {
    pushFinding("high", "agent-runner may be missing `report.generated` emission.", [reportAnchor], "runtime");
    pushSuggestion(reportAnchor, "Report lifecycle event missing.", "Emit `report.generated` immediately after report creation.");
  }

  if (!runner.includes("traceRecorder.complete(")) {
    pushFinding("high", "agent-runner may be missing trace completion call.", [traceAnchor], "runtime");
    pushSuggestion(traceAnchor, "Execution trace may be incomplete.", "Finalize trace with `traceRecorder.complete(...)` before saving trace.");
  }
}

if (hasChanged("packages/runtime/src/policy-engine.ts")) {
  const filePath = "packages/runtime/src/policy-engine.ts";
  const policy = safeRead(filePath);
  const deniedPos = policy.indexOf("deniedTools");
  const allowedPos = policy.indexOf("allowedTools");

  if (deniedPos !== -1 && allowedPos !== -1 && deniedPos > allowedPos) {
    const deniedLine = lineFromIndex(policy, deniedPos);
    const location = loc(filePath, deniedLine);
    pushFinding("high", "Policy precedence risk: `deniedTools` check appears after `allowedTools`.", [location], "security");
    pushSuggestion(location, "Denied precedence could be bypassed.", "Check `deniedTools` before `allowedTools` to keep deny rule authoritative.");
  }
}

if (mediumThresholdGate.enabled) {
  const mediumTotal = mediumFindings.length;
  const mediumSecurity = mediumFindings.filter((finding) => finding.domain === "security").length;
  const blockAtTotal = typeof mediumThresholdGate.blockAtTotal === "number"
    ? mediumThresholdGate.blockAtTotal
    : defaultRules.qualityGates.mediumFindingsThreshold.blockAtTotal;
  const blockAtSecurity = typeof mediumThresholdGate.blockAtSecurity === "number"
    ? mediumThresholdGate.blockAtSecurity
    : defaultRules.qualityGates.mediumFindingsThreshold.blockAtSecurity;

  if (mediumTotal >= blockAtTotal) {
    pushFinding(
      "high",
      `Medium findings threshold exceeded: total=${mediumTotal}, threshold=${blockAtTotal}.`,
      [],
      "architecture"
    );
  }

  if (mediumSecurity >= blockAtSecurity) {
    pushFinding(
      "high",
      `Medium security findings threshold exceeded: security=${mediumSecurity}, threshold=${blockAtSecurity}.`,
      [],
      "security"
    );
  }
}

const allFindings = [...highFindings, ...mediumFindings];
const gateRules = securityReviewerGating?.blockOn ?? [];
const gateHits = gateRules
  .map((rule) => {
    const matches = allFindings.filter((finding) => finding.domain === rule.domain && finding.severity === rule.severity);
    return { rule, matches };
  })
  .filter((entry) => entry.matches.length > 0);

const status = gateHits.length > 0 || highFindings.length > 0 ? "blocked" : "pass";

const lines = [];
lines.push("## XyaVoryx Bugbot PR Review");
lines.push("");
lines.push(`- Status: **${status.toUpperCase()}**`);
lines.push(`- Base ref: \`${baseRef}\``);
lines.push(`- Changed files: ${changedFiles.length}`);
lines.push(`- Added lines scanned: ${addedLines.length}`);
lines.push(`- Critical path changed: ${hasCriticalPathChanges() ? "yes" : "no"}`);
lines.push(`- Test files changed: ${hasTestCoverageChanges() ? "yes" : "no"}`);
lines.push("");

lines.push("### High Severity Findings");
if (highFindings.length === 0) {
  lines.push("- None");
} else {
  for (const finding of highFindings) {
    lines.push(`- ${finding.message}`);
    if (finding.locations.length > 0) {
      lines.push(`  - Locations: ${finding.locations.join(", ")}`);
    }
  }
}
lines.push("");

lines.push("### Medium Severity Warnings");
if (mediumFindings.length === 0) {
  lines.push("- None");
} else {
  for (const finding of mediumFindings) {
    lines.push(`- ${finding.message}`);
    if (finding.locations.length > 0) {
      lines.push(`  - Locations: ${finding.locations.join(", ")}`);
    }
  }
}
lines.push("");

lines.push("### Inline Suggestions");
if (inlineSuggestions.length === 0) {
  lines.push("- None");
} else {
  for (const suggestion of inlineSuggestions) {
    lines.push(`- ${suggestion.location}`);
    lines.push(`  - Why: ${suggestion.why}`);
    lines.push(`  - Suggestion: ${suggestion.suggestion}`);
  }
}
lines.push("");

const securityReviewFindings = [...highFindings, ...mediumFindings].filter((finding) => finding.domain === "security");
lines.push("### Cursor Security Agent: Security Reviewer");
if (securityReviewFindings.length === 0) {
  lines.push("- No direct security policy violations detected.");
} else {
  for (const finding of securityReviewFindings) {
    const firstLocation = finding.locations.length > 0 ? finding.locations[0] : "n/a";
    const cwe = finding.cwe ? ` ${finding.cwe}` : "";
    const owasp = finding.owasp ? ` | ${finding.owasp}` : "";
    lines.push(`- [${finding.severity.toUpperCase()}] ${finding.message}${cwe}${owasp}`);
    lines.push(`  - Primary location: ${firstLocation}`);
  }
}
lines.push("");

lines.push("### CI Gate Matrix");
if (gateRules.length === 0) {
  lines.push("- No gate rules configured.");
} else {
  for (const rule of gateRules) {
    const hit = gateHits.find((entry) => entry.rule.domain === rule.domain && entry.rule.severity === rule.severity);
    const count = hit ? hit.matches.length : 0;
    const gateStatus = count > 0 ? "BLOCK" : "PASS";
    lines.push(`- ${gateStatus} domain=${rule.domain}, severity=${rule.severity}, matches=${count}`);
  }
}
lines.push("");

lines.push("### Changed Files");
if (changedFiles.length === 0) {
  lines.push("- None");
} else {
  for (const file of changedFiles) {
    lines.push(`- ${file}`);
  }
}
lines.push("");

lines.push("### Notes");
lines.push("- This is a deterministic rule-based baseline report.");
lines.push("- Findings are derived from added diff lines and targeted file-content checks.");
lines.push("- Final merge decision should include human architectural review.");

writeFileSync(reportPath, lines.join("\n"), "utf8");

if (status === "blocked") {
  process.exitCode = 2;
}
