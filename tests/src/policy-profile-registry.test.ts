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

  it("registers and retrieves custom profiles", () => {
    const registry = new PolicyProfileRegistry({
      customSeed: {
        allowNetwork: true,
        allowFilesystem: false
      }
    });

    registry.register("customRegistered", {
      allowNetwork: false,
      allowFilesystem: true,
      maxToolExecutions: 5
    });

    const seed = registry.get("customSeed");
    expect(seed).toBeDefined();
    expect(seed?.allowNetwork).toBe(true);

    const reg = registry.get("customRegistered");
    expect(reg).toBeDefined();
    expect(reg?.allowFilesystem).toBe(true);
    expect(reg?.maxToolExecutions).toBe(5);
  });

  it("merges tool and step scoped policies cleanly", () => {
    const registry = new PolicyProfileRegistry();
    registry.register("baseProfile", {
      allowNetwork: false,
      allowFilesystem: false,
      toolPolicies: {
        "shell.executor": {
          allowFilesystem: true,
          maxToolExecutions: 3
        }
      }
    });

    const resolved = registry.resolve("baseProfile", {
      toolPolicies: {
        "shell.executor": {
          allowNetwork: true,
          maxToolExecutions: 5
        },
        "network.tool": {
          allowNetwork: true
        }
      }
    });

    expect(resolved).toBeDefined();
    const shellPolicy = resolved?.toolPolicies?.["shell.executor"];
    expect(shellPolicy?.allowFilesystem).toBe(true);
    expect(shellPolicy?.allowNetwork).toBe(true);
    expect(shellPolicy?.maxToolExecutions).toBe(5);

    const netPolicy = resolved?.toolPolicies?.["network.tool"];
    expect(netPolicy?.allowNetwork).toBe(true);
  });

  it("merges string lists for allowed and denied tools deterministically", () => {
    const registry = new PolicyProfileRegistry();
    registry.register("baseProfile", {
      allowedTools: ["ioc.extractor", "email.header.analyzer"],
      deniedTools: ["shell.executor"]
    });

    const resolved = registry.resolve("baseProfile", {
      allowedTools: ["stacktrace.parser", "ioc.extractor"],
      deniedTools: ["local.port.analyzer"]
    });

    expect(resolved?.allowedTools?.sort()).toEqual(["email.header.analyzer", "ioc.extractor", "stacktrace.parser"].sort());
    expect(resolved?.deniedTools?.sort()).toEqual(["local.port.analyzer", "shell.executor"].sort());
  });
});
