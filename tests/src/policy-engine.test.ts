import { describe, expect, it } from "vitest";
import { PolicyEngine } from "../../packages/runtime/src/policy-engine";

describe("PolicyEngine", () => {
  it("allows tool when policy permits", () => {
    const engine = new PolicyEngine();

    const decision = engine.validate({
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

  it("blocks denied tools", () => {
    const engine = new PolicyEngine();

    const decision = engine.validate({
      toolName: "ioc.extractor",
      executionCount: 0,
      policy: {
        deniedTools: ["ioc.extractor"]
      }
    });

    expect(decision.allowed).toBe(false);
    expect(decision.reason).toMatch(/denied/i);
  });

  it("blocks tool after max executions", () => {
    const engine = new PolicyEngine();

    const decision = engine.validate({
      toolName: "ioc.extractor",
      executionCount: 2,
      policy: {
        maxToolExecutions: 2
      }
    });

    expect(decision.allowed).toBe(false);
    expect(decision.reason).toMatch(/max tool executions/i);
  });
});