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
        const rawLines = content.split(/\r?\n/);

        // Process line-by-line checks for compose format
        let currentService = "";
        let insideServices = false;

        for (let idx = 0; idx < rawLines.length; idx++) {
          const rawLine = rawLines[idx];
          const line = rawLine.trim();
          if (!line) continue;

          // Check if we enter the services block
          if (/^services\s*:/i.test(rawLine)) {
            insideServices = true;
            continue;
          }

          // If we see another root level key, we exit services block
          if (insideServices && /^[a-zA-Z0-9_-]+\s*:/i.test(rawLine) && !rawLine.startsWith(" ") && !rawLine.startsWith("services")) {
            insideServices = false;
          }

          // Track current service name (indented inside services block)
          if (insideServices) {
            const serviceMatch = rawLine.match(/^(\s+)([a-zA-Z0-9_-]+)\s*:/);
            if (serviceMatch) {
              const indent = serviceMatch[1].length;
              if (indent === 2 || indent === 4) {
                const name = serviceMatch[2];
                const keywords = ["ports", "environment", "volumes", "networks", "build", "image", "deploy", "secrets", "configs"];
                if (!keywords.includes(name)) {
                  currentService = name;
                }
              }
            }
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
          const portMatch = line.match(/(?:-\s*["']?|["']?)([0-9]+):([0-9]+)["']?/);
          if (portMatch) {
            const hostPort = parseInt(portMatch[1], 10);
            const containerPort = parseInt(portMatch[2], 10);
            if ([3306, 5432, 27017, 6379, 1433, 1521].includes(hostPort) || [3306, 5432, 27017, 6379, 1433, 1521].includes(containerPort)) {
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
          const envMatch = line.match(/(?:PASSWORD|SECRET|DB_PASS|PASSWD)\s*[:=]\s*(.+)/i);
          if (envMatch) {
            let val = envMatch[1].trim();
            if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
              val = val.substring(1, val.length - 1).trim();
            }
            if (val && !val.includes("${") && val !== '""' && val !== "''" && !val.includes("secrets/") && !val.startsWith("$")) {
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
