import type { AgentInput } from "./agent";
import type { ExecutionTrace, ToolExecutionRecord } from "./trace";

export type SessionStatus = "created" | "running" | "completed" | "failed" | "blocked";

export interface SessionRecord {
  id: string;
  agentName: string;
  task: string;
  status: SessionStatus;
  createdAt: string;
  updatedAt: string;
}

export interface CaseRecord {
  id: string;
  sessionId: string;
  createdAt: string;
  input: AgentInput;
}

export interface Observation {
  id: string;
  sessionId: string;
  caseId: string;
  type: string;
  message: string;
  data?: Record<string, unknown>;
  createdAt: string;
}

export type FindingSeverity = "low" | "medium" | "high";

export interface Finding {
  id: string;
  sessionId: string;
  caseId: string;
  title: string;
  severity: FindingSeverity;
  description: string;
  sourceTool?: string;
  data?: Record<string, unknown>;
  createdAt: string;
}

export interface MemoryStore {
  createSession(session: SessionRecord): Promise<void>;
  updateSessionStatus(sessionId: string, status: SessionStatus): Promise<void>;
  getSession(sessionId: string): Promise<SessionRecord | undefined>;

  createCase(record: CaseRecord): Promise<void>;
  getCase(caseId: string): Promise<CaseRecord | undefined>;

  addObservation(observation: Observation): Promise<void>;
  getObservations(caseId: string): Promise<Observation[]>;

  addFinding(finding: Finding): Promise<void>;
  getFindings(caseId: string): Promise<Finding[]>;

  appendExecutionRecord(caseId: string, record: ToolExecutionRecord): Promise<void>;
  getExecutionHistory(caseId: string): Promise<ToolExecutionRecord[]>;

  saveTrace(caseId: string, trace: ExecutionTrace): Promise<void>;
  getTrace(caseId: string): Promise<ExecutionTrace | undefined>;
}