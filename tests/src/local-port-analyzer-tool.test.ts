import { describe, expect, it } from "vitest";
import * as net from "node:net";
import { LocalPortAnalyzerTool } from "../../packages/tools/src/local-port-analyzer-tool";

describe("LocalPortAnalyzerTool", () => {
  it("probes specific listening port correctly", async () => {
    // Spin up a temporary local TCP server
    const server = net.createServer();
    const testPort = 12345;
    
    await new Promise<void>((resolve) => {
      server.listen(testPort, "127.0.0.1", () => {
        resolve();
      });
    });

    try {
      const output = await LocalPortAnalyzerTool.run({ scanRange: String(testPort) }, {} as never);
      expect(output.listeningPorts).toContain(testPort);
      expect(output.anomalies.length).toBe(1);
      expect(output.anomalies[0].service).toBe("Unknown Service");
    } finally {
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
    }
  });
});
