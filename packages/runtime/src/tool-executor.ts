import type { ToolContext, XyaVoryxTool } from "@xyavoryx/core";

export class ToolExecutor {
  async execute<I, O>(
    tool: XyaVoryxTool<I, O>,
    rawInput: unknown,
    context: ToolContext,
    timeoutMs?: number
  ): Promise<O> {
    const parsedInput = tool.inputSchema.parse(rawInput);

    // Phase 1 keeps execution deterministic and does not enforce wall-clock timeouts.
    void timeoutMs;

    return tool.run(parsedInput, context);
  }
}