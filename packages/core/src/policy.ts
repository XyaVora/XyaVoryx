import type { ToolMetadata } from "./tool";

export type PolicyProfileName = "default" | "strict" | "investigation";

export interface PolicyRuleConfig {
  allowedTools?: string[];
  deniedTools?: string[];
  allowNetwork?: boolean;
  allowFilesystem?: boolean;
  maxToolExecutions?: number;
  defaultTimeoutMs?: number;
}

export interface PolicyConfig extends PolicyRuleConfig {
  profile?: PolicyProfileName | string;
  toolPolicies?: Record<string, PolicyRuleConfig>;
  stepPolicies?: Record<string, PolicyRuleConfig>;
}

export interface PolicyDecision {
  allowed: boolean;
  reason?: string;
}

export interface PolicyValidationInput {
  toolName: string;
  toolMetadata?: ToolMetadata;
  executionCount: number;
  policy?: PolicyRuleConfig;
}
