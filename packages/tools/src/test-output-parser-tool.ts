import { z } from "zod";
import type { FindingSeverity, XyaVoryxTool } from "@xyavoryx/core";

const inputSchema = z.object({
  output: z.string()
});

export interface TestOutputParserOutput {
  failedSuites: string[];
  failedTests: string[];
  failureSignatures: string[];
  evidence: Array<{ id: string; kind: string; value: string }>;
  findings: Array<{
    title: string;
    severity: FindingSeverity;
    description: string;
    data?: Record<string, unknown>;
  }>;
  risks: string[];
}

function unique(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    if (!seen.has(value)) {
      seen.add(value);
      result.push(value);
    }
  }

  return result;
}

function collect(pattern: RegExp, text: string, group = 1): string[] {
  const values: string[] = [];
  for (const match of text.matchAll(pattern)) {
    const value = match[group];
    if (value) {
      values.push(value.trim());
    }
  }

  return unique(values);
}

export const TestOutputParserTool: XyaVoryxTool<z.infer<typeof inputSchema>, TestOutputParserOutput> = {
  name: "test.output.parser",
  description: "Parse test runner output for deterministic failure triage.",
  inputSchema,
  metadata: {
    tags: ["bugbot", "test", "triage"],
    capabilities: ["parse-test-output", "extract-failure-signatures"],
    riskLevel: "low",
    requiresNetwork: false,
    requiresFilesystem: false
  },
  async run(input) {
    const text = input.output.replace(/\r\n/g, "\n");
    const failedSuites = collect(/^\s*(?:FAIL|FAILED)\s+(.+)$/gm, text, 1);

    const failedTests = collect(/^\s*[\u00D7x]\s+(.+)$/gm, text, 1);
    const assertionFailures = collect(/\b(AssertionError:[^\n]+)/g, text, 1);
    const errorFailures = collect(/\b((?:TypeError|ReferenceError|RangeError|SyntaxError):[^\n]+)/g, text, 1);
    const expectedFailures = collect(/\b(Expected[^\n]+to[^\n]+)/g, text, 1);

    const failureSignatures = unique([
      ...assertionFailures,
      ...errorFailures,
      ...expectedFailures
    ]);

    const evidence: Array<{ id: string; kind: string; value: string }> = [];
    for (let i = 0; i < failedSuites.length; i += 1) {
      evidence.push({ id: `ev-suite-${i + 1}`, kind: "failedSuite", value: failedSuites[i] });
    }
    for (let i = 0; i < failureSignatures.length; i += 1) {
      evidence.push({ id: `ev-signature-${i + 1}`, kind: "failureSignature", value: failureSignatures[i] });
    }

    const risks: string[] = [];
    if (failedSuites.length > 0 || failedTests.length > 0 || failureSignatures.length > 0) {
      risks.push("Test regression indicators detected");
    }

    const findings: TestOutputParserOutput["findings"] = [];
    if (failedSuites.length > 0 || failedTests.length > 0) {
      findings.push({
        title: "Test execution failures detected",
        severity: "medium",
        description: `Detected ${failedSuites.length} failed suite(s) and ${failedTests.length} failed test case(s)`,
        data: {
          failedSuites,
          failedTests,
          evidenceIds: evidence.map((item) => item.id)
        }
      });
    }

    if (failureSignatures.length > 0) {
      findings.push({
        title: "Failure signatures extracted",
        severity: "low",
        description: `Extracted ${failureSignatures.length} failure signature(s) for clustering`,
        data: {
          failureSignatures,
          evidenceIds: evidence.filter((item) => item.kind === "failureSignature").map((item) => item.id)
        }
      });
    }

    return {
      failedSuites,
      failedTests,
      failureSignatures,
      evidence,
      findings,
      risks
    };
  }
};
