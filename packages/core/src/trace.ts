import type { XyaVoryxEvent } from "./event";

export interface ToolExecutionRecord {
  id: string;
  tool: string;
  input: unknown;
  output?: unknown;
  status: "completed" | "failed" | "blocked";
  startedAt: string;
  completedAt?: string;
  durationMs?: number;
  error?: string;
}

export interface ExecutionTrace {
  sessionId: string;
  caseId: string;
  agentName: string;
  startedAt: string;
  completedAt?: string;
  toolExecutions: ToolExecutionRecord[];
  events: XyaVoryxEvent[];
}