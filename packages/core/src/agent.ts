import type { Finding } from "./memory";
import type { PolicyConfig } from "./policy";
import type { ExecutionTrace } from "./trace";
import type { WorkflowStep } from "./workflow";

export interface AgentConfig {
  id?: string;
  name: string;
  description?: string;
  goal: string;
  tools: string[];
  workflow?: WorkflowStep[];
  provider?: string;
  maxIterations?: number;
  policyProfile?: string;
  policies?: PolicyConfig;
  plannerMode?: "deterministic" | "autonomous";
}

export interface AgentInput {
  task: string;
  rawInput?: string;
  context?: Record<string, unknown>;
}

export interface AgentResult {
  agentName: string;
  caseId: string;
  sessionId: string;
  status: "completed" | "failed" | "blocked";
  findings: Finding[];
  trace: ExecutionTrace;
  report: string;
  metadata?: Record<string, unknown>;
}

export interface XyaVoryxAgent {
  config: AgentConfig;
}
