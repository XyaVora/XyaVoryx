export type XyaVoryxEventType =
  | "agent.started"
  | "agent.status_changed"
  | "tool.started"
  | "tool.completed"
  | "tool.failed"
  | "workflow.step_skipped"
  | "workflow.step_recovered"
  | "workflow.recovery_failed"
  | "policy.checked"
  | "policy.blocked"
  | "observation.created"
  | "finding.created"
  | "report.generated"
  | "agent.completed"
  | "agent.failed";

export interface XyaVoryxEvent {
  id: string;
  type: XyaVoryxEventType | string;
  timestamp: string;
  sessionId?: string;
  caseId?: string;
  agentName?: string;
  payload?: Record<string, unknown>;
}

export type EventHandler = (event: XyaVoryxEvent) => void;
