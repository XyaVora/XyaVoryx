import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { DockerAuditorTool } from "../../packages/tools/src/docker-auditor-tool";

describe("DockerAuditorTool", () => {
  it("detects privileged containers and exposed ports in docker-compose.yml", async () => {
    const tempCompose = path.resolve(process.cwd(), "docker-compose.yml");
    const composeContent = [
      "version: '3.8'",
      "services:",
      "  database:",
      "    image: postgres:15",
      "    ports:",
      "      - '5432:5432'",
      "    environment:",
      "      - POSTGRES_PASSWORD=secretpassword123",
      "  malicious:",
      "    image: evil-service",
      "    privileged: true",
      "    network_mode: host"
    ].join("\n");

    fs.writeFileSync(tempCompose, composeContent, "utf8");

    try {
      const output = await DockerAuditorTool.run({ composeFilePath: tempCompose }, {} as never);
      expect(output.composeFileFound).toBe(true);
      
      const privileged = output.anomalies.find(a => a.type.includes("Privileged Container"));
      const exposedDb = output.anomalies.find(a => a.type.includes("Public Database Port"));
      const hostNet = output.anomalies.find(a => a.type.includes("Host Network"));
      const cleartextPass = output.anomalies.find(a => a.type.includes("Cleartext Hardcoded Secrets"));

      expect(privileged).toBeDefined();
      expect(privileged?.severity).toBe("high");

      expect(exposedDb).toBeDefined();
      expect(exposedDb?.severity).toBe("medium");

      expect(hostNet).toBeDefined();
      expect(hostNet?.severity).toBe("medium");

      expect(cleartextPass).toBeDefined();
      expect(cleartextPass?.severity).toBe("medium");
    } finally {
      if (fs.existsSync(tempCompose)) {
        fs.unlinkSync(tempCompose);
      }
    }
  });
});
