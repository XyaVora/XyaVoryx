import { z } from "zod";
import type { Logger } from "./logger";
import type { MemoryStore } from "./memory";

export type ToolRiskLevel = "low" | "medium" | "high";

export interface ToolMetadata {
  tags?: string[];
  capabilities?: string[];
  riskLevel?: ToolRiskLevel;
  requiresNetwork?: boolean;
  requiresFilesystem?: boolean;
  timeoutMs?: number;
}

export interface ToolContext {
  agentId: string;
  sessionId: string;
  caseId: string;
  memory: MemoryStore;
  logger: Logger;
  signal?: AbortSignal;
}

export interface XyaVoryxTool<I = unknown, O = unknown> {
  name: string;
  description: string;
  inputSchema: z.ZodType<I>;
  metadata?: ToolMetadata;
  run(input: I, context: ToolContext): Promise<O>;
}