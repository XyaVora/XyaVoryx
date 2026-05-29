import { execSync } from "node:child_process";
import { writeFileSync } from "node:fs";

function sh(command) {
  return execSync(command, { encoding: "utf8" }).trim();
}

function parseArgs(argv) {
  const args = {
    releaseTag: process.env.RELEASE_TAG || "",
    releaseScope: process.env.RELEASE_SCOPE || "patch",
    reportPath: process.env.RELEASE_READINESS_REPORT_PATH || "release-readiness-report.json",
    requireMain: process.env.RELEASE_READINESS_REQUIRE_MAIN !== "0",
    requireClean: process.env.RELEASE_READINESS_REQUIRE_CLEAN !== "0",
    skipPipeline: process.env.RELEASE_READINESS_SKIP_PIPELINE === "1"
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--release-tag") {
      args.releaseTag = argv[index + 1] || "";
      index += 1;
    } else if (arg === "--release-scope") {
      args.releaseScope = argv[index + 1] || "patch";
      index += 1;
    } else if (arg === "--report-path") {
      args.reportPath = argv[index + 1] || args.reportPath;
      index += 1;
    } else if (arg === "--skip-pipeline") {
      args.skipPipeline = true;
    } else if (arg === "--no-require-main") {
      args.requireMain = false;
    } else if (arg === "--no-require-clean") {
      args.requireClean = false;
    }
  }

  return args;
}

function parseSemverTag(tag) {
  const match = /^v(\d+)\.(\d+)\.(\d+)$/.exec(tag);
  if (!match) {
    return null;
  }
  return {
    raw: tag,
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3])
  };
}

function listSemverTags() {
  const output = sh("git tag --list");
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map(parseSemverTag)
    .filter((tag) => tag !== null)
    .sort((a, b) => {
      if (a.major !== b.major) {
        return a.major - b.major;
      }
      if (a.minor !== b.minor) {
        return a.minor - b.minor;
      }
      return a.patch - b.patch;
    });
}

function validateReleaseIncrementPolicy(releaseTag, releaseScope, latestTag) {
  if (!releaseTag) {
    return { status: "skipped", detail: "release tag not provided" };
  }

  const parsedReleaseTag = parseSemverTag(releaseTag);
  if (!parsedReleaseTag) {
    throw new Error("release_tag must follow semantic version format: vMAJOR.MINOR.PATCH");
  }

  if (releaseScope !== "patch" && releaseScope !== "minor") {
    throw new Error("release_scope must be either `patch` or `minor`.");
  }

  if (!latestTag) {
    return {
      status: "passed",
      detail: "no previous semver tag found, increment policy skipped",
      releaseTag: parsedReleaseTag.raw
    };
  }

  if (releaseScope === "patch") {
    const keepsMajorMinor = parsedReleaseTag.major === latestTag.major && parsedReleaseTag.minor === latestTag.minor;
    const bumpsPatch = parsedReleaseTag.patch > latestTag.patch;
    if (!keepsMajorMinor || !bumpsPatch) {
      throw new Error(
        `Patch release must keep major/minor and increase patch: latest=${latestTag.raw}, release=${parsedReleaseTag.raw}.`
      );
    }
  }

  if (releaseScope === "minor") {
    const keepsMajor = parsedReleaseTag.major === latestTag.major;
    const bumpsMinor = parsedReleaseTag.minor > latestTag.minor;
    if (!keepsMajor || !bumpsMinor) {
      throw new Error(
        `Minor release must keep major and increase minor: latest=${latestTag.raw}, release=${parsedReleaseTag.raw}.`
      );
    }
  }

  return {
    status: "passed",
    detail: `${releaseScope} increment policy satisfied`,
    releaseTag: parsedReleaseTag.raw
  };
}

function runPipelineChecks(skipPipeline) {
  const checks = [
    "corepack pnpm -r build",
    "corepack pnpm -r test",
    "corepack pnpm eval:replay",
    "corepack pnpm public:build",
    "corepack pnpm check:public-export"
  ];

  if (skipPipeline) {
    return { executed: false, commands: checks };
  }

  for (const command of checks) {
    execSync(command, { stdio: "inherit" });
  }

  return { executed: true, commands: checks };
}

function writeReport(reportPath, payload) {
  writeFileSync(reportPath, JSON.stringify(payload, null, 2), "utf8");
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const startedAt = new Date().toISOString();

  const branch = sh("git rev-parse --abbrev-ref HEAD");
  if (args.requireMain && branch !== "main") {
    throw new Error(`release readiness requires main branch. current=${branch}`);
  }

  const gitStatus = sh("git status --porcelain");
  if (args.requireClean && gitStatus.length > 0) {
    throw new Error("release readiness requires clean working tree.");
  }

  const semverTags = listSemverTags();
  const latestTag = semverTags.length > 0 ? semverTags[semverTags.length - 1] : null;
  const releasePolicy = validateReleaseIncrementPolicy(args.releaseTag, args.releaseScope, latestTag);
  const pipeline = runPipelineChecks(args.skipPipeline);

  const payload = {
    passed: true,
    startedAt,
    completedAt: new Date().toISOString(),
    branch,
    releaseTag: args.releaseTag || null,
    releaseScope: args.releaseScope,
    latestSemverTag: latestTag ? latestTag.raw : null,
    releasePolicy,
    pipeline
  };

  writeReport(args.reportPath, payload);
  console.log("Release readiness gate passed.");
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : "Unknown release readiness failure.";
  console.error(message);
  process.exitCode = 1;
}
