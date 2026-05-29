import { describe, expect, it } from "vitest";
import { StacktraceParserTool } from "../../packages/tools/src/stacktrace-parser-tool";

describe("StacktraceParserTool", () => {
  it("parses frames, signature, evidence, and findings deterministically", async () => {
    const stacktrace = [
      "TypeError: Cannot read properties of undefined (reading 'id')",
      "    at parseUser (src/services/user.ts:42:15)",
      "    at buildProfile (src/controllers/profile.ts:18:5)"
    ].join("\n");

    const result = await StacktraceParserTool.run({ stacktrace }, {} as never);

    expect(result.errorType).toBe("TypeError");
    expect(result.frames[0]).toEqual({
      function: "parseUser",
      file: "src/services/user.ts",
      line: 42,
      column: 15
    });
    expect(result.signature).toBe("TypeError@src/services/user.ts:42:15");
    expect(result.evidence.length).toBeGreaterThan(0);
    expect(result.findings.length).toBeGreaterThan(0);
    expect(result.risks).toContain("Runtime failure detected: TypeError");
  });
});