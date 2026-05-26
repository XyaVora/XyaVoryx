import { describe, expect, it } from "vitest";
import { PolicyProfileRegistry } from "../../packages/runtime/src/policy-profile-registry";

describe("PolicyProfileRegistry", () => {
  it("resolves built-in profiles", () => {
    const registry = new PolicyProfileRegistry();
    const strict = registry.resolve("strict");

    expect(strict).toBeDefined();
    expect(strict?.allowNetwork).toBe(false);
    expect(strict?.allowFilesystem).toBe(false);
    expect(strict?.maxToolExecutions).toBe(1);
  });

  it("merges profile with overrides deterministically", () => {
    const registry = new PolicyProfileRegistry();

    const policy = registry.resolve("investigation", {
      allowedTools: ["ioc.extractor"],
      deniedTools: ["email.header.analyzer"],
      maxToolExecutions: 2
    });

    expect(policy?.allowNetwork).toBe(false);
    expect(policy?.allowFilesystem).toBe(false);
    expect(policy?.allowedTools).toEqual(["ioc.extractor"]);
    expect(policy?.deniedTools).toEqual(["email.header.analyzer"]);
    expect(policy?.maxToolExecutions).toBe(2);
  });

  it("throws when profile does not exist", () => {
    const registry = new PolicyProfileRegistry();

    expect(() => registry.resolve("missing-profile")).toThrow(/unknown policy profile/i);
  });
});
