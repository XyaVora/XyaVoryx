import { describe, expect, it } from "vitest";
import { IOCExtractorTool } from "../../packages/tools/src/ioc-extractor-tool";

describe("IOCExtractorTool", () => {
  it("extracts and deduplicates indicators", async () => {
    const text = [
      "Visit https://example.com/path and https://example.com/path",
      "Email alert@example.com and alert@example.com",
      "IP 8.8.8.8",
      "Hash d41d8cd98f00b204e9800998ecf8427e",
      "CVE-2024-12345",
      "Path C:\\Temp\\evil.exe"
    ].join("\n");

    const output = await IOCExtractorTool.run({ text }, {} as never);

    expect(output.urls).toEqual(["https://example.com/path"]);
    expect(output.emails).toEqual(["alert@example.com"]);
    expect(output.ips).toEqual(["8.8.8.8"]);
    expect(output.hashes.md5).toEqual(["d41d8cd98f00b204e9800998ecf8427e"]);
    expect(output.cves).toEqual(["CVE-2024-12345"]);
    expect(output.filePaths).toContain("C:\\Temp\\evil.exe");
  });
});