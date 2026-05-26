import type { AgentConfig, AgentInput, AgentResult } from "./agent";

export interface EvaluationScenarioExpectations {
  status?: AgentResult["status"];
  minFindings?: number;
  maxToolExecutions?: number;
  requiredEvents?: string[];
  requiredTools?: string[];
}

export interface EvaluationScenario {
  id: string;
  name: string;
  agent: AgentConfig;
  input: AgentInput;
  expectations: EvaluationScenarioExpectations;
}

export interface EvaluationCheckResult {
  name: string;
  passed: boolean;
  details?: string;
}

export interface EvaluationScenarioMetrics {
  findingCount: number;
  toolExecutionCount: number;
  eventCount: number;
  checkCount: number;
  checksPassed: number;
  checkPassRate: number;
  traceCompletenessScore: number;
  policyComplianceScore: number;
}

export interface EvaluationScenarioResult {
  scenarioId: string;
  scenarioName: string;
  passed: boolean;
  checks: EvaluationCheckResult[];
  result: AgentResult;
  metrics: EvaluationScenarioMetrics;
}

export interface EvaluationQualityMetrics {
  checkPassRate: number;
  averageFindings: number;
  averageToolExecutions: number;
  averageEvents: number;
  traceCompletenessRate: number;
  policyComplianceRate: number;
}

export type EvaluationTrendDirection = "up" | "down" | "flat";

export interface EvaluationMetricTrend {
  metric: string;
  previous: number;
  current: number;
  delta: number;
  direction: EvaluationTrendDirection;
  better: boolean;
}

export interface EvaluationTrendSummary {
  comparedAt: string;
  verdict: "improved" | "regressed" | "stable";
  improvements: number;
  regressions: number;
  metrics: EvaluationMetricTrend[];
}

export interface EvaluationSuiteResult {
  startedAt: string;
  completedAt: string;
  total: number;
  passed: number;
  failed: number;
  passRate: number;
  quality: EvaluationQualityMetrics;
  trend?: EvaluationTrendSummary;
  scenarios: EvaluationScenarioResult[];
}
