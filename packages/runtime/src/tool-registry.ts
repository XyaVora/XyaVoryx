import type { XyaVoryxTool } from "@xyavoryx/core";

export class ToolRegistry {
  private readonly tools = new Map<string, XyaVoryxTool>();

  register(tool: XyaVoryxTool): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`Tool already registered: ${tool.name}`);
    }
    this.tools.set(tool.name, tool);
  }

  get(name: string): XyaVoryxTool | undefined {
    return this.tools.get(name);
  }

  list(): XyaVoryxTool[] {
    return [...this.tools.values()];
  }
}