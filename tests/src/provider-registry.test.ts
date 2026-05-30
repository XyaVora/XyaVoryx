import { describe, expect, it } from "vitest";
import { ProviderRegistry } from "../../packages/runtime/src/provider-registry";
import type { LLMProvider } from "../../packages/core/src";

describe("ProviderRegistry", () => {
  it("registers and retrieves providers", () => {
    const registry = new ProviderRegistry();
    const mockProvider: LLMProvider = {
      name: "mock-llm",
      initialize: async () => {},
      generate: async () => ({ text: "hello" })
    };

    registry.register(mockProvider);
    expect(registry.get("mock-llm")).toBe(mockProvider);
    expect(registry.list()).toEqual([mockProvider]);
  });

  it("throws on duplicate registration", () => {
    const registry = new ProviderRegistry();
    const mockProvider: LLMProvider = {
      name: "mock-llm",
      initialize: async () => {},
      generate: async () => ({ text: "hello" })
    };

    registry.register(mockProvider);
    expect(() => registry.register(mockProvider)).toThrow(/provider already registered/i);
  });
});
