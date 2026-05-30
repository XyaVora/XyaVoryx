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

  it("blocks tool when network is disabled", async () => {
    const engine = new PolicyEngine();

    const decision = await engine.validate({
      toolName: "network.tool",
      executionCount: 0,
      toolMetadata: {
        requiresNetwork: true
      },
      policy: {
        allowNetwork: false
      }
    });

    expect(decision.allowed).toBe(false);
    expect(decision.reason).toMatch(/network access blocked/i);
  });

  it("blocks tool when filesystem is disabled", async () => {
    const engine = new PolicyEngine();

    const decision = await engine.validate({
      toolName: "file.tool",
      executionCount: 0,
      toolMetadata: {
        requiresFilesystem: true
      },
      policy: {
        allowFilesystem: false
      }
    });

    expect(decision.allowed).toBe(false);
    expect(decision.reason).toMatch(/filesystem access blocked/i);
  });

  it("blocks tool and returns error description when approvalHook throws an error", async () => {
    const engine = new PolicyEngine({
      approvalHook: () => {
        throw new Error("Hook crashed");
      }
    });

    const decision = await engine.validate({
      toolName: "shell.executor",
      executionCount: 0
    });

    expect(decision.allowed).toBe(false);
    expect(decision.reason).toMatch(/policy approval gate threw an error: hook crashed/i);
  });
});