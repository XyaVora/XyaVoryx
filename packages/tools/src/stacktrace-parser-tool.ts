import { z } from "zod";
import type { FindingSeverity, XyaVoryxTool } from "@xyavoryx/core";

const inputSchema = z.object({
  stacktrace: z.string()
});

export interface StackFrame {
  function?: string;
  file: string;
  line?: number;
  column?: number;
}

export interface StacktraceParserOutput {
  errorType?: string;
  message?: string;
  frames: StackFrame[];
  signature?: string;
  evidence: Array<{ id: string; kind: string; value: string }>;
  findings: Array<{
    title: string;
    severity: FindingSeverity;
    description: string;
    data?: Record<string, unknown>;
  }>;
  risks: string[];
}

function unique<T>(values: T[], keyFn: (value: T) => string): T[] {
  const seen = new Set<string>();
  const result: T[] = [];

  for (const value of values) {
    const key = keyFn(value);
    if (!seen.has(key)) {
      seen.add(key);
      result.push(value);
    }
  }

  return result;
}

function parseErrorLine(lines: string[]): { errorType?: string; message?: string } {
  for (const line of [...lines].reverse()) {
    const match = line.match(/^([A-Za-z][A-Za-z0-9_.-]*(?:Error|Exception)):\s*(.+)$/);
    if (match) {
      return {
        errorType: match[1],
        message: match[2]
      };
    }
  }

  return {};
}

function parseFrames(lines: string[]): StackFrame[] {
  const frames: StackFrame[] = [];

  for (const line of lines) {
    const jsWithFunction = line.match(/^\s*at\s+(.+?)\s+\((.+?):(\d+):(\d+)\)\s*$/);
    if (jsWithFunction) {
      frames.push({
        function: jsWithFunction[1],
        file: jsWithFunction[2],
        line: Number(jsWithFunction[3]),
        column: Number(jsWithFunction[4])
      });
      continue;
    }

    const jsWithoutFunction = line.match(/^\s*at\s+(.+?):(\d+):(\d+)\s*$/);
    if (jsWithoutFunction) {
      frames.push({
        file: jsWithoutFunction[1],
        line: Number(jsWithoutFunction[2]),
        column: Number(jsWithoutFunction[3])
      });
      continue;
    }

    const pythonFrame = line.match(/^\s*File\s+"([^"]+)",\s+line\s+(\d+),\s+in\s+(.+)\s*$/);
    if (pythonFrame) {
      frames.push({
        function: pythonFrame[3],
        file: pythonFrame[1],
        line: Number(pythonFrame[2])
      });
    }
  }

  return unique(frames, (frame) => `${frame.function ?? ""}|${frame.file}|${frame.line ?? ""}|${frame.column ?? ""}`);
}

function buildSignature(errorType: string | undefined, topFrame: StackFrame | undefined): string | undefined {
  if (!errorType && !topFrame) {
    return undefined;
  }

  const framePart = topFrame
    ? `${topFrame.file}:${topFrame.line ?? 0}:${topFrame.column ?? 0}`
    : "unknown-frame";

  return `${errorType ?? "UnknownError"}@${framePart}`;
}

export const StacktraceParserTool: XyaVoryxTool<z.infer<typeof inputSchema>, StacktraceParserOutput> = {
  name: "stacktrace.parser",
  description: "Parse stacktrace text into deterministic frames and bug triage signals.",
  inputSchema,
  metadata: {
    tags: ["bugbot", "stacktrace", "triage"],
    capabilities: ["parse-stacktrace", "extract-signature"],
    riskLevel: "low",
    requiresNetwork: false,
    requiresFilesystem: false
  },
  async run(input) {
    const lines = input.stacktrace.replace(/\r\n/g, "\n").split("\n").map((line) => line.trimEnd());
    const frames = parseFrames(lines);
    const { errorType, message } = parseErrorLine(lines);
    const signature = buildSignature(errorType, frames[0]);

    const evidence: Array<{ id: string; kind: string; value: string }> = [];
    if (errorType) {
      evidence.push({ id: "ev-error-type", kind: "errorType", value: errorType });
    }
    if (message) {
      evidence.push({ id: "ev-error-message", kind: "errorMessage", value: message });
    }
    if (signature) {
      evidence.push({ id: "ev-signature", kind: "signature", value: signature });
    }
    if (frames[0]) {
      evidence.push({
        id: "ev-top-frame",
        kind: "topFrame",
        value: `${frames[0].file}:${frames[0].line ?? 0}:${frames[0].column ?? 0}`
      });
    }

    const risks: string[] = [];
    if (errorType) {
      risks.push(`Runtime failure detected: ${errorType}`);
    }
    if (frames.length === 0) {
      risks.push("Stacktrace has no parseable frames");
    }

    const findings: StacktraceParserOutput["findings"] = [];
    if (signature) {
      findings.push({
        title: "Stacktrace signature identified",
        severity: "medium",
        description: `Signature ${signature}`,
        data: {
          errorType,
          topFrame: frames[0] ? `${frames[0].file}:${frames[0].line ?? 0}` : undefined,
          evidenceIds: evidence.map((item) => item.id)
        }
      });
    }

    if (frames.length === 0) {
      findings.push({
        title: "Insufficient stacktrace evidence",
        severity: "low",
        description: "No stack frames could be parsed for localization",
        data: {
          evidenceIds: evidence.map((item) => item.id)
        }
      });
    }

    return {
      errorType,
      message,
      frames,
      signature,
      evidence,
      findings,
      risks
    };
  }
};