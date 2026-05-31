#!/usr/bin/env node

import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

function sh(command) {
  return execSync(command, { encoding: "utf8" }).trim();
}

function parseArgs(argv) {
  const args = {
    privateRef: "HEAD",
    publicRepoUrl: "https://github.com/XyaVora/XyaVoryx.git",
    publicRef: "main",
    allowlistPath: "scripts/release/public-source-match.allowlist.json",
    reportPath: "public-source-match-report.json"
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--private-ref") {
      args.privateRef = argv[i + 1] || args.privateRef;
      i += 1;
    } else if (arg === "--public-repo-url") {
      args.publicRepoUrl = argv[i + 1] || args.publicRepoUrl;
      i += 1;
    } else if (arg === "--public-ref") {
      args.publicRef = argv[i + 1] || args.publicRef;
      i += 1;
    } else if (arg === "--allowlist") {
      args.allowlistPath = argv[i + 1] || args.allowlistPath;
      i += 1;
    } else if (arg === "--report-path") {
      args.reportPath = argv[i + 1] || args.reportPath;
      i += 1;
    }
  }

  return args;
}

function listFiles(ref) {
  const output = sh(`git ls-tree -r --name-only ${ref}`);
  return output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

function blobSha(ref, filePath) {
  return sh(`git rev-parse ${ref}:${filePath}`);
}

function toSet(values) {
  return new Set(values);
}

function diffUnexpected(actual, allowed) {
  const allowedSet = toSet(allowed);
  return actual.filter((item) => !allowedSet.has(item));
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const publicRemote = "public-sync-check";

  try {
    sh(`git remote add ${publicRemote} ${args.publicRepoUrl}`);
  } catch {
    sh(`git remote set-url ${publicRemote} ${args.publicRepoUrl}`);
  }
  sh(`git fetch ${publicRemote} --prune`);

  const privateRef = args.privateRef;
  const publicRef = `${publicRemote}/${args.publicRef}`;
  const allowlist = JSON.parse(readFileSync(args.allowlistPath, "utf8"));

  const privateFiles = listFiles(privateRef);
  const publicFiles = listFiles(publicRef);
  const privateSet = toSet(privateFiles);
  const publicSet = toSet(publicFiles);

  const onlyPrivate = privateFiles.filter((filePath) => !publicSet.has(filePath));
  const onlyPublic = publicFiles.filter((filePath) => !privateSet.has(filePath));
  const common = privateFiles.filter((filePath) => publicSet.has(filePath));

  const modified = [];
  for (const filePath of common) {
    if (blobSha(privateRef, filePath) !== blobSha(publicRef, filePath)) {
      modified.push(filePath);
    }
  }

  const unexpected = {
    onlyPrivate: diffUnexpected(onlyPrivate, allowlist.onlyPrivate ?? []),
    onlyPublic: diffUnexpected(onlyPublic, allowlist.onlyPublic ?? []),
    modified: diffUnexpected(modified, allowlist.modified ?? [])
  };

  const report = {
    passed: unexpected.onlyPrivate.length === 0 && unexpected.onlyPublic.length === 0 && unexpected.modified.length === 0,
    privateRef,
    publicRef,
    checkedAt: new Date().toISOString(),
    counts: {
      private: privateFiles.length,
      public: publicFiles.length,
      common: common.length,
      onlyPrivate: onlyPrivate.length,
      onlyPublic: onlyPublic.length,
      modified: modified.length
    },
    onlyPrivate,
    onlyPublic,
    modified,
    unexpected
  };

  writeFileSync(args.reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  if (!report.passed) {
    throw new Error(
      `Public source match failed. Unexpected diffs - onlyPrivate=${unexpected.onlyPrivate.length}, onlyPublic=${unexpected.onlyPublic.length}, modified=${unexpected.modified.length}`
    );
  }

  console.log("Public source match passed.");
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : "Unknown source match failure.";
  console.error(message);
  process.exitCode = 1;
}
