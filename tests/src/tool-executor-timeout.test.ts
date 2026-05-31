import { describe, expect, it } from "vitest";
import { ToolExecutor } from "../../packages/runtime/src/tool-executor";
import { InMemoryStore } from "../../packages/memory/src/in-memory-store";
import { ConsoleLogger } from "../../packages/runtime/src/console-logger";
import type { XyaVoryxTool } from "../../packages/core/src";
import { IOCExtractorTool } from "../../packages/tools/src/ioc-extractor-tool";

describe("ToolExecutor timeout enforcement", () => {
  it("aborts tool execution when timeout is exceeded", async () => {
    const executor = new ToolExecutor();
    const tool: XyaVoryxTool<{ text: string }, { ok: boolean }> = {
      name: "slow.tool",
      description: "Simulates a slow tool",
      inputSchema: IOCExtractorTool.inputSchema as unknown as XyaVoryxTool<{ text: string }, { ok: boolean }>["inputSchema"],
      async run(_input, context) {
        return new Promise((resolve, reject) => {
          const timer = setTimeout(() => resolve({ ok: true }), 200);
          context.signal?.addEventListener("abort", () => {
            clearTimeout(timer);
            reject(new Error("aborted"));
          });
        });
      }
    };

    await expect(
      executor.execute(
        tool,
        { text: "x" },
        {
          agentId: "a",
          sessionId: "s",
          caseId: "c",
          memory: new InMemoryStore(),
          logger: new ConsoleLogger()
        },
        20
      )
    ).rejects.toThrow(/timed out/i);
  });
});
