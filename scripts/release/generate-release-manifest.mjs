#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { resolve, relative, sep } from "node:path";

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function normalizePath(pathValue) {
  return pathValue.split(sep).join("/");
}

function hashFile(filePath) {
  const content = readFileSync(filePath);
  return createHash("sha256").update(content).digest("hex");
}

function walkFiles(rootPath) {
  const entries = readdirSync(rootPath, { withFileTypes: true })
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name));

  /** @type {string[]} */
  const files = [];
  for (const entry of entries) {
    const absolutePath = resolve(rootPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkFiles(absolutePath));
      continue;
    }

    if (entry.isFile()) {
      files.push(absolutePath);
    }
  }

  return files;
}

function parseArgs(argv) {
  /** @type {{output: string | null, targets: string[]}} */
  const parsed = {
    output: null,
    targets: []
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--output") {
      const nextValue = argv[index + 1];
      if (!nextValue) {
        fail("Missing value for --output");
      }
      parsed.output = nextValue;
      index += 1;
      continue;
    }

    parsed.targets.push(token);
  }

  if (!parsed.output) {
    fail("Missing required --output <file>");
  }

  if (parsed.targets.length === 0) {
    fail("Provide at least one target file or directory.");
  }

  return parsed;
}

const args = parseArgs(process.argv.slice(2));
const workspaceRoot = process.cwd();
const resolvedTargets = args.targets.map((targetPath) => resolve(workspaceRoot, targetPath));
const outputPath = resolve(workspaceRoot, args.output);

/** @type {{path: string, size: number, sha256: string}[]} */
const manifestEntries = [];

for (const targetPath of resolvedTargets) {
  let targetStats;
  try {
    targetStats = statSync(targetPath);
  } catch {
    fail(`Target does not exist: ${targetPath}`);
  }

  if (targetStats.isFile()) {
    const relativePath = normalizePath(relative(workspaceRoot, targetPath));
    manifestEntries.push({
      path: relativePath,
      size: targetStats.size,
      sha256: hashFile(targetPath)
    });
    continue;
  }

  if (targetStats.isDirectory()) {
    const files = walkFiles(targetPath);
    for (const filePath of files) {
      const stats = statSync(filePath);
      const relativePath = normalizePath(relative(workspaceRoot, filePath));
      manifestEntries.push({
        path: relativePath,
        size: stats.size,
        sha256: hashFile(filePath)
      });
    }
    continue;
  }

  fail(`Unsupported target type: ${targetPath}`);
}

manifestEntries.sort((left, right) => left.path.localeCompare(right.path));
const aggregateSource = manifestEntries
  .map((entry) => `${entry.path}\t${entry.size}\t${entry.sha256}`)
  .join("\n");
const aggregateSha256 = createHash("sha256").update(aggregateSource).digest("hex");

const manifest = {
  schemaVersion: "1.0.0",
  gitCommit: process.env.GITHUB_SHA || "local",
  targets: args.targets,
  fileCount: manifestEntries.length,
  aggregateSha256,
  files: manifestEntries
};

writeFileSync(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
process.stdout.write(`Generated release manifest: ${args.output}\n`);
