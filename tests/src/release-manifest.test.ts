import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const RELEASE_MANIFEST_SCRIPT = resolve(__dirname, "../../scripts/release/generate-release-manifest.mjs");
const tempDirs: string[] = [];

function createTempFixture() {
  const root = mkdtempSync(resolve(tmpdir(), "xyavoryx-release-manifest-"));
  tempDirs.push(root);
  return root;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const directory = tempDirs.pop();
    if (directory) {
      rmSync(directory, { recursive: true, force: true });
    }
  }
});

describe("generate-release-manifest", () => {
  it("creates deterministic sorted manifest with aggregate digest", () => {
    const fixtureDir = createTempFixture();
    const nestedDir = resolve(fixtureDir, "dist-public", "z");
    mkdirSync(nestedDir, { recursive: true });
    writeFileSync(resolve(fixtureDir, "dist-public", "b.txt"), "beta\n", "utf8");
    writeFileSync(resolve(nestedDir, "a.txt"), "alpha\n", "utf8");

    const outPath = resolve(fixtureDir, "release.manifest.json");
    execFileSync("node", [RELEASE_MANIFEST_SCRIPT, "--output", "release.manifest.json", "dist-public"], {
      cwd: fixtureDir,
      stdio: "pipe"
    });

    const manifest = JSON.parse(readFileSync(outPath, "utf8")) as {
      fileCount: number;
      aggregateSha256: string;
      files: Array<{ path: string; size: number; sha256: string }>;
    };

    expect(manifest.fileCount).toBe(2);
    expect(manifest.aggregateSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(manifest.files.map((entry) => entry.path)).toEqual([
      "dist-public/b.txt",
      "dist-public/z/a.txt"
    ]);
    expect(manifest.files.every((entry) => entry.size > 0)).toBe(true);
    expect(manifest.files.every((entry) => /^[a-f0-9]{64}$/.test(entry.sha256))).toBe(true);
  });
});
