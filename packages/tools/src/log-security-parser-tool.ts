import { z } from "zod";
import type { XyaVoryxTool } from "@xyavoryx/core";

const inputSchema = z.object({
  logContent: z.string(),
  logType: z.enum(["syslog", "nginx", "windows"]).optional()
});

export interface LogSecurityAnomaly {
  type: string;
  severity: "low" | "medium" | "high" | "critical";
  evidence: string;
  cwe: string[];
  owasp: string[];
}

export interface LogSecurityParserOutput {
  detectedType: "syslog" | "nginx" | "windows";
  anomalies: LogSecurityAnomaly[];
}

export const LogSecurityParserTool: XyaVoryxTool<z.infer<typeof inputSchema>, LogSecurityParserOutput> = {
  name: "log.security.parser",
  description: "Analyze system, web, or Windows security logs for attacks and anomalies.",
  inputSchema,
  metadata: {
    tags: ["log", "parser", "security", "analyst"],
    capabilities: ["detect-sql-injection", "detect-xss", "detect-brute-force", "detect-path-traversal"],
    riskLevel: "low",
    requiresNetwork: false,
    requiresFilesystem: false
  },
  async run(input) {
    const lines = input.logContent.split(/\r?\n/).map(line => line.trim()).filter(line => line.length > 0);
    
    // Auto-detect log type if not provided
    let detectedType = input.logType;
    if (!detectedType) {
      let nginxCount = 0;
      let syslogCount = 0;
      let windowsCount = 0;

      for (const line of lines) {
        if (/GET|POST|PUT|DELETE|HTTP\/\d/i.test(line)) {
          nginxCount++;
        }
        if (/sshd|sudo|cron|systemd/i.test(line)) {
          syslogCount++;
        }
        if (/EventID|4625|4624|Security-Auditing|ActiveDirectory/i.test(line)) {
          windowsCount++;
        }
      }

      if (nginxCount >= syslogCount && nginxCount >= windowsCount && nginxCount > 0) {
        detectedType = "nginx";
      } else if (windowsCount >= syslogCount && windowsCount >= nginxCount && windowsCount > 0) {
        detectedType = "windows";
      } else {
        detectedType = "syslog";
      }
    }

    const anomalies: LogSecurityAnomaly[] = [];

    // Analyze line by line
    for (const line of lines) {
      if (detectedType === "nginx") {
        // Path Traversal (High)
        if (/(\.\.\/|\.\.\\|%2e%2e%2f|%2e%2e%5c|etc\/passwd|boot\.ini)/i.test(line)) {
          anomalies.push({
            type: "Path Traversal / LFI Attempt",
            severity: "high",
            evidence: line,
            cwe: ["CWE-22"],
            owasp: ["A01:2021-Broken Access Control"]
          });
        }
        // SQL Injection (High)
        else if (/(\%27|'|UNION|SELECT|INSERT|UPDATE|DELETE|DROP|--|OR\s+\d+=\d+)/i.test(line)) {
          anomalies.push({
            type: "SQL Injection Pattern Detected",
            severity: "high",
            evidence: line,
            cwe: ["CWE-89"],
            owasp: ["A03:2021-Injection"]
          });
        }
        // XSS (Medium)
        else if (/(<script|%3Cscript|javascript:|onload|onerror)/i.test(line)) {
          anomalies.push({
            type: "Cross-Site Scripting (XSS) Pattern Detected",
            severity: "medium",
            evidence: line,
            cwe: ["CWE-79"],
            owasp: ["A03:2021-Injection"]
          });
        }
        // Web Brute Force / Scanning (401 / 403 / 404 scanning behavior)
        else if (/(?: 401 | 403 | 404 )\d+$/i.test(line) || /wp-login\.php|xmlrpc\.php|admin\/config/i.test(line)) {
          anomalies.push({
            type: "Web Scanning or Unauthorized Access Attempt",
            severity: "medium",
            evidence: line,
            cwe: ["CWE-307", "CWE-200"],
            owasp: ["A07:2021-Identification and Authentication Failures"]
          });
        }
      } else if (detectedType === "syslog") {
        // Sudo / Privilege Escalation Attempts (High)
        if (/sudo:.*auth failure|sudo:.*NOT in sudoers|PAM.*auth.*failure/i.test(line)) {
          anomalies.push({
            type: "Unauthorized Privilege Escalation Attempt (sudo)",
            severity: "high",
            evidence: line,
            cwe: ["CWE-269"],
            owasp: ["A01:2021-Broken Access Control"]
          });
        }
        // SSH / Syslog Failed Logins (Medium)
        else if (/Failed password for|authentication failure|Failed keyboard-interactive/i.test(line)) {
          anomalies.push({
            type: "Failed System Login Attempt",
            severity: "medium",
            evidence: line,
            cwe: ["CWE-307"],
            owasp: ["A07:2021-Identification and Authentication Failures"]
          });
        }
      } else if (detectedType === "windows") {
        // Windows Account Lockout (Event ID 4740) (High)
        if (/EventID:?\s*4740|A\s+user\s+account\s+was\s+locked\s+out/i.test(line)) {
          anomalies.push({
            type: "Windows User Account Lockout Event (Event 4740)",
            severity: "high",
            evidence: line,
            cwe: ["CWE-307"],
            owasp: ["A07:2021-Identification and Authentication Failures"]
          });
        }
        // Windows Failed Logon (Event ID 4625) (Medium)
        else if (/EventID:?\s*4625|An\s+account\s+failed\s+to\s+log\s+on/i.test(line)) {
          anomalies.push({
            type: "Windows Account Logon Failure (Event 4625)",
            severity: "medium",
            evidence: line,
            cwe: ["CWE-307"],
            owasp: ["A07:2021-Identification and Authentication Failures"]
          });
        }
      }
    }

    return {
      detectedType,
      anomalies
    };
  }
};
