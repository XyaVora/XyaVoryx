import { z } from "zod";
import * as net from "node:net";
import type { XyaVoryxTool } from "@xyavoryx/core";

const inputSchema = z.object({
  scanRange: z.string().optional()
});

export interface PortAnomaly {
  port: number;
  service: string;
  severity: "low" | "medium" | "high";
  riskDescription: string;
  cwe: string[];
  owasp: string[];
}

export interface LocalPortAnalyzerOutput {
  listeningPorts: number[];
  anomalies: PortAnomaly[];
}

const COMMON_PORTS = [
  { port: 21, service: "FTP", severity: "medium", desc: "FTP is unencrypted and transmits credentials in cleartext.", cwe: ["CWE-319"], owasp: ["A02:2021-Cryptographic Failures"] },
  { port: 22, service: "SSH", severity: "low", desc: "SSH service is active. Ensure strong password/key based access.", cwe: ["CWE-521"], owasp: ["A07:2021-Identification and Authentication Failures"] },
  { port: 23, service: "Telnet", severity: "medium", desc: "Telnet protocol is obsolete, unencrypted, and highly insecure.", cwe: ["CWE-319"], owasp: ["A02:2021-Cryptographic Failures"] },
  { port: 25, service: "SMTP", severity: "low", desc: "Local mail server detected. Check for relay vulnerabilities.", cwe: ["CWE-668"], owasp: ["A05:2021-Security Misconfiguration"] },
  { port: 53, service: "DNS", severity: "low", desc: "DNS service active. Ensure protection against amplification attacks.", cwe: ["CWE-400"], owasp: ["A05:2021-Security Misconfiguration"] },
  { port: 80, service: "HTTP", severity: "low", desc: "Unencrypted web server detected. Consider HTTPS redirect.", cwe: ["CWE-319"], owasp: ["A02:2021-Cryptographic Failures"] },
  { port: 110, service: "POP3", severity: "medium", desc: "POP3 email server transmits passwords in cleartext.", cwe: ["CWE-319"], owasp: ["A02:2021-Cryptographic Failures"] },
  { port: 143, service: "IMAP", severity: "medium", desc: "IMAP email server transmits passwords in cleartext.", cwe: ["CWE-319"], owasp: ["A02:2021-Cryptographic Failures"] },
  { port: 443, service: "HTTPS", severity: "low", desc: "Secure web server active.", cwe: [], owasp: [] },
  { port: 445, service: "SMB / Active Directory", severity: "medium", desc: "SMB service listening. Check for EternalBlue or guest access.", cwe: ["CWE-269"], owasp: ["A01:2021-Broken Access Control"] },
  { port: 1433, service: "Microsoft SQL Server", severity: "medium", desc: "MSSQL Database service listening locally.", cwe: ["CWE-521"], owasp: ["A07:2021-Identification and Authentication Failures"] },
  { port: 1521, service: "Oracle Database", severity: "medium", desc: "Oracle Database service listening locally.", cwe: ["CWE-521"], owasp: ["A07:2021-Identification and Authentication Failures"] },
  { port: 3000, service: "Node Development Server", severity: "low", desc: "Local web app dev port active.", cwe: [], owasp: [] },
  { port: 3306, service: "MySQL Database", severity: "medium", desc: "MySQL Database service listening locally.", cwe: ["CWE-521"], owasp: ["A07:2021-Identification and Authentication Failures"] },
  { port: 5432, service: "PostgreSQL Database", severity: "medium", desc: "PostgreSQL Database service listening locally.", cwe: ["CWE-521"], owasp: ["A07:2021-Identification and Authentication Failures"] },
  { port: 6379, service: "Redis Cache Store", severity: "medium", desc: "Redis listening. Ensure binding has bind-address or password auth.", cwe: ["CWE-306"], owasp: ["A07:2021-Identification and Authentication Failures"] },
  { port: 8080, service: "Web Alternative port (8080)", severity: "low", desc: "Alternative web service active.", cwe: [], owasp: [] },
  { port: 9200, service: "ElasticSearch Search Engine", severity: "medium", desc: "ElasticSearch active. Ensure indices have role-based authorization.", cwe: ["CWE-306"], owasp: ["A01:2021-Broken Access Control"] },
  { port: 27017, service: "MongoDB Database", severity: "medium", desc: "MongoDB Database service listening locally.", cwe: ["CWE-306"], owasp: ["A07:2021-Identification and Authentication Failures"] }
];

export const LocalPortAnalyzerTool: XyaVoryxTool<z.infer<typeof inputSchema>, LocalPortAnalyzerOutput> = {
  name: "local.port.analyzer",
  description: "Identify listening network ports and map local services to spot insecure open connection interfaces.",
  inputSchema,
  metadata: {
    tags: ["network", "port", "security", "scanner"],
    capabilities: ["scan-listening-ports", "probe-tcp"],
    riskLevel: "medium",
    requiresNetwork: true,
    requiresFilesystem: false
  },
  async run(input) {
    const listeningPorts: number[] = [];
    const anomalies: PortAnomaly[] = [];

    // Parse custom port list if scanRange is provided (e.g. "80,443,3000")
    let portsToScan = COMMON_PORTS.map(p => p.port);
    if (input.scanRange) {
      try {
        const parsed = input.scanRange.split(",").map(p => parseInt(p.trim(), 10)).filter(p => !isNaN(p));
        if (parsed.length > 0) {
          portsToScan = parsed;
        }
      } catch (err) {
        // Fall back to standard ports
      }
    }

    // Probes local ports concurrently with socket timeout limit
    const promises = portsToScan.map(async (port) => {
      const isOpen = await checkPort(port);
      if (isOpen) {
        listeningPorts.push(port);

        // Populate anomalies if it maps to common ports with warnings
        const mapped = COMMON_PORTS.find(p => p.port === port);
        if (mapped && (mapped.severity !== "low" || mapped.desc.includes("active"))) {
          anomalies.push({
            port,
            service: mapped.service,
            severity: mapped.severity as "low" | "medium" | "high",
            riskDescription: mapped.desc,
            cwe: mapped.cwe,
            owasp: mapped.owasp
          });
        } else if (!mapped) {
          // Unmapped port
          anomalies.push({
            port,
            service: "Unknown Service",
            severity: "low",
            riskDescription: `Custom listening port detected active. Verify service identity.`,
            cwe: ["CWE-668"],
            owasp: ["A05:2021-Security Misconfiguration"]
          });
        }
      }
    });

    await Promise.all(promises);

    // Sort outputs
    listeningPorts.sort((a, b) => a - b);
    anomalies.sort((a, b) => a.port - b.port);

    return {
      listeningPorts,
      anomalies
    };
  }
};

function checkPort(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    
    socket.setTimeout(200);
    
    socket.on("connect", () => {
      socket.destroy();
      resolve(true);
    });

    socket.on("timeout", () => {
      socket.destroy();
      resolve(false);
    });

    socket.on("error", () => {
      socket.destroy();
      resolve(false);
    });

    socket.connect(port, "127.0.0.1");
  });
}
