import { describe, expect, it } from "vitest";
import { PolicyEngine } from "../../packages/runtime/src/policy-engine";

describe("PolicyEngine", () => {
  it("allows tool when policy permits", async () => {
    const engine = new PolicyEngine();

    const decision = await engine.validate({
      toolName: "ioc.extractor",
      executionCount: 0,
      toolMetadata: {
        requiresNetwork: false,
        requiresFilesystem: false
      },
      policy: {
        allowNetwork: false,
        allowFilesystem: false,
        allowedTools: ["ioc.extractor"]
      }
    });

    expect(decision.allowed).toBe(true);
  });

  it("blocks denied tools", async () => {
    const engine = new PolicyEngine();

    const decision = await engine.validate({
      toolName: "ioc.extractor",
      executionCount: 0,
      policy: {
        deniedTools: ["ioc.extractor"]
      }
    });

    expect(decision.allowed).toBe(false);
    expect(decision.reason).toMatch(/denied/i);
  });

  it("blocks tool after max executions", async () => {
    const engine = new PolicyEngine();

    const decision = await engine.validate({
      toolName: "ioc.extractor",
      executionCount: 2,
      policy: {
        maxToolExecutions: 2
      }
    });

    expect(decision.allowed).toBe(false);
    expect(decision.reason).toMatch(/max tool executions/i);
  });

  it("blocks high risk tools if approvalHook returns false", async () => {
    const engine = new PolicyEngine({
      approvalHook: () => false
    });

    const decision = await engine.validate({
      toolName: "shell.executor",
      executionCount: 0,
      toolMetadata: {
        riskLevel: "high"
      }
    });

    expect(decision.allowed).toBe(false);
    expect(decision.reason).toMatch(/denied by user policy approval gate/i);
  });

  it("allows high risk tools if approvalHook returns true", async () => {
    const engine = new PolicyEngine();
    engine.setApprovalHook(async () => true);

    const decision = await engine.validate({
      toolName: "shell.executor",
      executionCount: 0,
      toolMetadata: {
        riskLevel: "high"
      }
    });

    expect(decision.allowed).toBe(true);
  });
});