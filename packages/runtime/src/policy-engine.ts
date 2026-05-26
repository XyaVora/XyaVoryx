import type { PolicyDecision, PolicyValidationInput } from "@xyavoryx/core";

export class PolicyEngine {
  validate(input: PolicyValidationInput): PolicyDecision {
    const policy = input.policy;

    if (policy?.deniedTools?.includes(input.toolName)) {
      return {
        allowed: false,
        reason: `Tool denied by policy: ${input.toolName}`
      };
    }

    if (policy?.allowedTools && !policy.allowedTools.includes(input.toolName)) {
      return {
        allowed: false,
        reason: `Tool not in allowed list: ${input.toolName}`
      };
    }

    if (typeof policy?.maxToolExecutions === "number" && input.executionCount >= policy.maxToolExecutions) {
      return {
        allowed: false,
        reason: `Max tool executions reached: ${policy.maxToolExecutions}`
      };
    }

    if (policy?.allowNetwork === false && input.toolMetadata?.requiresNetwork) {
      return {
        allowed: false,
        reason: `Network access blocked for tool: ${input.toolName}`
      };
    }

    if (policy?.allowFilesystem === false && input.toolMetadata?.requiresFilesystem) {
      return {
        allowed: false,
        reason: `Filesystem access blocked for tool: ${input.toolName}`
      };
    }

    return { allowed: true };
  }
}