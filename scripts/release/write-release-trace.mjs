#!/usr/bin/env node

import { writeFileSync } from "node:fs";

function parseArgs(argv) {
  const args = {
    output: "release-trace.json",
    privateRepo: "XyaVora/xyavoryx-private",
    publicRepo: "XyaVora/XyaVoryx",
    privateCommit: "",
    publicCommit: "",
    releaseTag: "",
    releaseBranch: "",
    targetBranch: "main"
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--output") {
      args.output = argv[i + 1] || args.output;
      i += 1;
    } else if (arg === "--private-repo") {
      args.privateRepo = argv[i + 1] || args.privateRepo;
      i += 1;
    } else if (arg === "--public-repo") {
      args.publicRepo = argv[i + 1] || args.publicRepo;
      i += 1;
    } else if (arg === "--private-commit") {
      args.privateCommit = argv[i + 1] || args.privateCommit;
      i += 1;
    } else if (arg === "--public-commit") {
      args.publicCommit = argv[i + 1] || args.publicCommit;
      i += 1;
    } else if (arg === "--release-tag") {
      args.releaseTag = argv[i + 1] || args.releaseTag;
      i += 1;
    } else if (arg === "--release-branch") {
      args.releaseBranch = argv[i + 1] || args.releaseBranch;
      i += 1;
    } else if (arg === "--target-branch") {
      args.targetBranch = argv[i + 1] || args.targetBranch;
      i += 1;
    }
  }

  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.privateCommit) {
    throw new Error("Missing --private-commit");
  }
  if (!args.publicCommit) {
    throw new Error("Missing --public-commit");
  }

  const trace = {
    schemaVersion: "1.0.0",
    generatedAt: new Date().toISOString(),
    private: {
      repo: args.privateRepo,
      commit: args.privateCommit
    },
    public: {
      repo: args.publicRepo,
      commit: args.publicCommit,
      releaseTag: args.releaseTag || null,
      releaseBranch: args.releaseBranch || null,
      targetBranch: args.targetBranch
    }
  };

  writeFileSync(args.output, `${JSON.stringify(trace, null, 2)}\n`, "utf8");
  console.log(`Release trace written: ${args.output}`);
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : "Unknown release trace failure.";
  console.error(message);
  process.exitCode = 1;
}
