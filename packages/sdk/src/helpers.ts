import type { AgentConfig, XyaVoryxTool } from "@xyavoryx/core";
import { InMemoryStore } from "@xyavoryx/memory";
import { XyaVoryx, type XyaVoryxOptions } from "@xyavoryx/runtime";

export function defineTool<TTool extends XyaVoryxTool>(tool: TTool): TTool {
  return tool;
}

export function defineAgent<TAgent extends AgentConfig>(agent: TAgent): TAgent {
  return agent;
}

export function createXyaVoryx(options?: Omit<XyaVoryxOptions, "memory"> & { memory?: XyaVoryxOptions["memory"] }): XyaVoryx {
  return new XyaVoryx({
    ...options,
    memory: options?.memory ?? new InMemoryStore()
  });
}