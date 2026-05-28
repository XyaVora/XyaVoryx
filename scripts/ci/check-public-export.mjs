import { existsSync, readdirSync, statSync } from "node:fs";
import { readFileSync } from "node:fs";
import { join, normalize, relative, resolve } from "node:path";

const root = process.cwd();
const distDir = resolve(root, "dist-public");
const manifestPath = resolve(root, "public.manifest.json");

if (!existsSync(manifestPath)) {
  throw new Error("public.manifest.json not found.");
}

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const requiredExcludes = Array.isArray(manifest.requiredExcludes) ? manifest.requiredExcludes : [];
const allowedMarkdown = new Set(Array.isArray(manifest.allowedMarkdown) ? manifest.allowedMarkdown : ["README.md", "CONTRIBUTING.md"]);

const blockedPatterns = requiredExcludes;

function toPosix(path) {
  return normalize(path).replace(/\\/g, "/");
}

function escapeRegex(value) {
  return value.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
}

function globToRegex(glob) {
  const chunks = toPosix(glob).split("**").map((part) => escapeRegex(part).replace(/\\\*/g, "[^/]*"));
  return new RegExp(`^${chunks.join(".*")}$`);
}

function matchesAny(path, patterns) {
  const posixPath = toPosix(path);
  return patterns.some((pattern) => globToRegex(pattern).test(posixPath));
}

function listFiles(dir) {
  const files = [];
  if (!existsSync(dir)) {
    return files;
  }

  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stats = statSync(full);
    if (stats.isDirectory()) {
      files.push(...listFiles(full));
      continue;
    }
    files.push(toPosix(relative(distDir, full)));
  }

  return files;
}

if (!existsSync(distDir)) {
  throw new Error("dist-public not found. Run `corepack pnpm public:build` first.");
}

const files = listFiles(distDir);
const leaked = files.filter((file) => matchesAny(file, blockedPatterns));
if (leaked.length > 0) {
  throw new Error(`Blocked private files leaked to dist-public: ${leaked.join(", ")}`);
}

const markdownLeaks = files.filter((file) => file.endsWith(".md") && !allowedMarkdown.has(file));
if (markdownLeaks.length > 0) {
  throw new Error(`Unexpected markdown in dist-public: ${markdownLeaks.join(", ")}`);
}

console.log("Public export guard passed.");
