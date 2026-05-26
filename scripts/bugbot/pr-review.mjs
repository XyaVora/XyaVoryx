#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const scriptDir = dirname(fileURLToPath(import.meta.url));
const tsScriptPath = join(scriptDir, "pr-review.ts");
const tsxCliPath = require.resolve("tsx/cli");

const result = spawnSync(process.execPath, [tsxCliPath, tsScriptPath, ...process.argv.slice(2)], {
  cwd: process.cwd(),
  env: process.env,
  stdio: "inherit"
});

if (result.error) {
  throw result.error;
}

process.exit(typeof result.status === "number" ? result.status : 1);
