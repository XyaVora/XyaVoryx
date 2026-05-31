import type { ToolContext, XyaVoryxTool } from "@xyavoryx/core";

export class ToolExecutor {
  async execute<I, O>(
    tool: XyaVoryxTool<I, O>,
    rawInput: unknown,
    context: ToolContext,
    timeoutMs?: number
  ): Promise<O> {
    const parsedInput = tool.inputSchema.parse(rawInput);
    const timeout = typeof timeoutMs === "number" && timeoutMs > 0 ? Math.floor(timeoutMs) : undefined;

    if (!timeout) {
      return tool.run(parsedInput, context);
    }

    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new Error(`Tool execution timed out after ${timeout}ms: ${tool.name}`));
      }, timeout);
      timer.unref?.();
    });

    try {
      return await Promise.race([
        tool.run(parsedInput, {
          ...context,
          signal: controller.signal
        }),
        timeoutPromise
      ]);
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  }
}
