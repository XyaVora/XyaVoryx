import type { PolicyDecision, PolicyValidationInput } from "@xyavoryx/core";

export class PolicyEngine {
  private approvalHook?: (input: PolicyValidationInput) => Promise<boolean> | boolean;

  constructor(options?: { approvalHook?: (input: PolicyValidationInput) => Promise<boolean> | boolean }) {
    this.approvalHook = options?.approvalHook;
  }

  setApprovalHook(hook: (input: PolicyValidationInput) => Promise<boolean> | boolean): void {
    this.approvalHook = hook;
  }

  async validate(input: PolicyValidationInput): Promise<PolicyDecision> {
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

    if (this.approvalHook) {
      try {
        const approved = await this.approvalHook(input);
        if (!approved) {
          return {
            allowed: false,
            reason: `Tool execution denied by user policy approval gate: ${input.toolName}`
          };
        }
      } catch (err) {
        return {
          allowed: false,
          reason: `Policy approval gate threw an error: ${err instanceof Error ? err.message : String(err)}`
        };
      }
    }

    return { allowed: true };
  }
}