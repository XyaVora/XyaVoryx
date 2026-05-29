import { describe, expect, it } from "vitest";
import { ToolRegistry } from "../../packages/runtime/src/tool-registry";
import { IOCExtractorTool } from "../../packages/tools/src/ioc-extractor-tool";

describe("ToolRegistry", () => {
  it("registers and retrieves tools", () => {
    const registry = new ToolRegistry();
    registry.register(IOCExtractorTool);

    expect(registry.get("ioc.extractor")?.name).toBe("ioc.extractor");
    expect(registry.list()).toHaveLength(1);
  });

  it("throws on duplicate registration", () => {
    const registry = new ToolRegistry();
    registry.register(IOCExtractorTool);

    expect(() => registry.register(IOCExtractorTool)).toThrow(/already registered/i);
  });
});