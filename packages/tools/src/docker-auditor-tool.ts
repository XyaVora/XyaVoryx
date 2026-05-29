import { z } from "zod";
import * as fs from "node:fs";
import * as path from "node:path";
import type { XyaVoryxTool } from "@xyavoryx/core";

const inputSchema = z.object({
  composeFilePath: z.string().optional()
});

export interface DockerAnomaly {
  file: string;
  type: string;
  severity: "low" | "medium" | "high" | "critical";
  evidence: string;
  cwe: string[];
  owasp: string[];
}

export interface DockerAuditorOutput {
  composeFileFound: boolean;
  auditedFile: string | null;
  anomalies: DockerAnomaly[];
}

export const DockerAuditorTool: XyaVoryxTool<z.infer<typeof inputSchema>, DockerAuditorOutput> = {
  name: "docker.auditor",
  description: "Audit docker-compose configurations or Docker environment files for privilege and network exposure vulnerabilities.",
  inputSchema,
  metadata: {
    tags: ["docker", "container", "security", "auditor"],
    capabilities: ["audit-privileged-containers", "audit-compose", "detect-exposed-ports"],
    riskLevel: "medium",
    requiresNetwork: false,
    requiresFilesystem: true
  },
  async run(input) {
    const anomalies: DockerAnomaly[] = [];
    let composeFileFound = false;
    let auditedFile: string | null = null;

    // Search for docker-compose files in process.cwd() or custom path
    const searchPath = input.composeFilePath 
      ? path.resolve(process.cwd(), input.composeFilePath) 
      : process.cwd();

    let targetFilePath = "";
    if (fs.existsSync(searchPath)) {
      const stat = fs.statSync(searchPath);
      if (stat.isFile()) {
        targetFilePath = searchPath;
      } else if (stat.isDirectory()) {
        const candidates = ["docker-compose.yml", "docker-compose.yaml", "compose.yml", "compose.yaml"];
        for (const cand of candidates) {
          const check = path.join(searchPath, cand);
          if (fs.existsSync(check)) {
            targetFilePath = check;
            break;
          }
        }
      }
    }

    if (targetFilePath && fs.existsSync(targetFilePath)) {
      composeFileFound = true;
      auditedFile = path.relative(process.cwd(), targetFilePath);
      try {
        const content = fs.readFileSync(targetFilePath, "utf8");
        const lines = content.split(/\r?\n/).map(line => line.trim());

        // Process line-by-line checks for compose format
        let currentService = "";
        for (let idx = 0; idx < lines.length; idx++) {
          const line = lines[idx];
          if (!line) continue;

          // Track current service scope simple parser
          const serviceMatch = line.match(/^([a-zA-Z0-9_-]+):$/);
          if (serviceMatch && idx > 0 && lines[idx - 1] === "services:") {
            currentService = serviceMatch[1];
          }

          // Privileged mode check (High)
          if (/privileged\s*:\s*true/i.test(line)) {
            anomalies.push({
              file: auditedFile,
              type: `Privileged Container Privilege Abuse Risk [${currentService || "unknown"}]`,
              severity: "high",
              evidence: `Line ${idx + 1}: ${line}`,
              cwe: ["CWE-250"],
              owasp: ["A01:2021-Broken Access Control"]
            });
          }

          // Host Network Mode (Medium)
          if (/network_mode\s*:\s*(["']?host["']?)/i.test(line)) {
            anomalies.push({
              file: auditedFile,
              type: `Host Network Mode Privilege Risks [${currentService || "unknown"}]`,
              severity: "medium",
              evidence: `Line ${idx + 1}: ${line}`,
              cwe: ["CWE-668"],
              owasp: ["A01:2021-Broken Access Control"]
            });
          }

          // Public Database Port exposure (Medium)
          // Look for direct port mapping exposing MySQL 3306 or Postgres 5432 publicly without localhost restriction
          // e.g. "3306:3306" or "- 5432:5432"
          const portMatch = line.match(/(?:-\s*["']?|["']?)([0-9]+):([0-9]+)["']?/);
          if (portMatch) {
            const hostPort = parseInt(portMatch[1], 10);
            const containerPort = parseInt(portMatch[2], 10);
            if ([3306, 5432, 27017, 6379, 1433, 1521].includes(hostPort) || [3306, 5432, 27017, 6379, 1433, 1521].includes(containerPort)) {
              // Ensure it is not binding only to 127.0.0.1
              if (!line.includes("127.0.0.1")) {
                anomalies.push({
                  file: auditedFile,
                  type: `Public Database Port Exposure [${currentService || "unknown"}]`,
                  severity: "medium",
                  evidence: `Line ${idx + 1}: ${line}`,
                  cwe: ["CWE-668"],
                  owasp: ["A05:2021-Security Misconfiguration"]
                });
              }
            }
          }

          // Insecure Cleartext Credential Environment Variable (Medium)
          // e.g. "MYSQL_ROOT_PASSWORD=secret" or "POSTGRES_PASSWORD: secret"
          if (/(?:PASSWORD|SECRET|DB_PASS|PASSWD)\s*[:=]\s*(.+)/i.test(line)) {
            const val = line.substring(line.indexOf(":") + 1).trim();
            if (val && !val.includes("${") && val !== '""' && val !== "''" && !val.includes("secrets/")) {
              anomalies.push({
                file: auditedFile,
                type: `Insecure Cleartext Hardcoded Secrets [${currentService || "unknown"}]`,
                severity: "medium",
                evidence: `Line ${idx + 1}: ${line}`,
                cwe: ["CWE-798"],
                owasp: ["A07:2021-Identification and Authentication Failures"]
              });
            }
          }
        }
      } catch (err) {
        // Skip unreadable files
      }
    }

    return {
      composeFileFound,
      auditedFile,
      anomalies
    };
  }
};
