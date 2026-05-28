import { describe, expect, it } from "vitest";
import { TestOutputParserTool } from "../../packages/tools/src/test-output-parser-tool";

describe("TestOutputParserTool", () => {
  it("extracts failed suites, signatures, evidence, and findings", async () => {
    const output = [
      "FAIL tests/user.test.ts",
      "  x should return active users",
      "  AssertionError: expected true to be false"
    ].join("\n");

    const result = await TestOutputParserTool.run({ output }, {} as never);

    expect(result.failedSuites).toEqual(["tests/user.test.ts"]);
    expect(result.failedTests).toEqual(["should return active users"]);
    expect(result.failureSignatures).toContain("AssertionError: expected true to be false");
    expect(result.evidence.length).toBeGreaterThan(0);
    expect(result.findings.length).toBeGreaterThan(0);
    expect(result.risks).toContain("Test regression indicators detected");
  });

  it("supports both x and multiplication-sign markers for failed tests", async () => {
    const output = [
      "FAIL tests/parser.test.ts",
      "  \u00D7 should parse unicode marker",
      "  x should parse ascii marker"
    ].join("\n");

    const result = await TestOutputParserTool.run({ output }, {} as never);

    expect(result.failedTests).toEqual([
      "should parse unicode marker",
      "should parse ascii marker"
    ]);
  });
});
