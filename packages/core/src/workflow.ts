export type WorkflowConditionSource = "rawInput" | "task" | "context" | "stepOutput";

export type WorkflowConditionOperator = "equals" | "not_equals" | "includes" | "exists";

export interface WorkflowCondition {
  source: WorkflowConditionSource;
  operator: WorkflowConditionOperator;
  value?: unknown;
  contextKey?: string;
  stepId?: string;
  valuePath?: string;
}

export type WorkflowFailureActionType = "stop" | "continue" | "fallback";

export interface WorkflowFailureAction {
  action: WorkflowFailureActionType;
  fallbackStepId?: string;
}

export interface WorkflowStep {
  id: string;
  tool: string;
  inputFrom: "rawInput" | "task" | "context" | "literal" | "stepOutput";
  contextKey?: string;
  sourceStepId?: string;
  valuePath?: string;
  inputKey?: string;
  literalInput?: unknown;
  maxRetries?: number;
  runIf?: WorkflowCondition[];
  runIfMode?: "all" | "any";
  onFailure?: WorkflowFailureAction;
  project?: Record<string, string>;
}

export interface ExecutablePlanStep {
  id: string;
  tool: string;
  inputFrom: WorkflowStep["inputFrom"];
  contextKey?: string;
  sourceStepId?: string;
  valuePath?: string;
  inputKey?: string;
  literalInput?: unknown;
  input: unknown;
  maxRetries: number;
  runIf: WorkflowCondition[];
  runIfMode: "all" | "any";
  onFailure: WorkflowFailureAction;
  project?: Record<string, string>;
}

export interface WorkflowPlan {
  steps: ExecutablePlanStep[];
}
