import { z } from "zod";
import * as fs from "node:fs";
import * as path from "node:path";
import type { XyaVoryxTool } from "@xyavoryx/core";

const inputSchema = z.object({
  scanPath: z.string().optional()
});

export interface GitCredentialAnomaly {
  file: string;
  line: number;
  type: string;
  preview: string;
  cwe: string[];
  owasp: string[];
}

export interface GitCredentialScannerOutput {
  scannedFilesCount: number;
  anomalies: GitCredentialAnomaly[];
}

// Common patterns for high-fidelity credentials
const CREDENTIAL_PATTERNS = [
  {
    name: "Google API Key",
    regex: /AIzaSy[A-Za-z0-9_-]{33}/g,
    cwe: ["CWE-798"],
    owasp: ["A07:2021-Identification and Authentication Failures"]
  },
  {
    name: "AWS Access Key ID",
    regex: /\b(A3T[A-Z0-9]|AKIA|AGPA|AIDA|AROA|AIPA|ANPA|ANVA|ASIA)[A-Z0-9]{16}\b/g,
    cwe: ["CWE-798"],
    owasp: ["A07:2021-Identification and Authentication Failures"]
  },
  {
    name: "GitHub Personal Access Token",
    regex: /\bgh[oprs]_[A-Za-z0-9_]{36,251}\b/g,
    cwe: ["CWE-798"],
    owasp: ["A07:2021-Identification and Authentication Failures"]
  },
  {
    name: "Slack Bot Token",
    regex: /\bxoxb-[0-9]{11,13}-[0-9]{11,13}-[a-zA-Z0-9]{24}\b/g,
    cwe: ["CWE-798"],
    owasp: ["A07:2021-Identification and Authentication Failures"]
  },
  {
    name: "Generic Private Key",
    regex: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g,
    cwe: ["CWE-522"],
    owasp: ["A02:2021-Cryptographic Failures"]
  },
  {
    name: "Insecure Hardcoded Assignment",
    regex: /(?:password|client_secret|db_pass|secret_key|api_secret)\s*=\s*['"]([A-Za-z0-9-_+=/]{8,})['"]/gi,
    cwe: ["CWE-798"],
    owasp: ["A07:2021-Identification and Authentication Failures"]
  }
];

const EXCLUDED_DIRS = new Set([
  ".git",
  "node_modules",
  "dist",
  "dist-public",
  ".xyavoryx-sessions",
  ".xyavoryx-memory",
  ".xyavoryx-history",
  ".tmp-public-release"
]);

const BINARY_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".ico", ".pdf", ".zip", ".tar", ".gz",
  ".exe", ".dll", ".so", ".dylib", ".woff", ".woff2", ".eot", ".ttf", ".mp3",
  ".mp4", ".avi", ".mov", ".db", ".sqlite", ".bin"
]);

export const GitCredentialScannerTool: XyaVoryxTool<z.infer<typeof inputSchema>, GitCredentialScannerOutput> = {
  name: "git.credential.scanner",
  description: "Scan local workspace files recursively for leaked credentials, secrets, or hardcoded passwords.",
  inputSchema,
  metadata: {
    tags: ["git", "credential", "security", "secrets"],
    capabilities: ["detect-api-keys", "detect-private-keys", "audit-secrets"],
    riskLevel: "medium",
    requiresNetwork: false,
    requiresFilesystem: true
  },
  async run(input) {
    const startPath = resolvePath(input.scanPath ?? process.cwd());
    const anomalies: GitCredentialAnomaly[] = [];
    let scannedFilesCount = 0;

    if (!fs.existsSync(startPath)) {
      return { scannedFilesCount: 0, anomalies: [] };
    }

    const filesToScan: string[] = [];

    function collectFiles(dir: string) {
      if (filesToScan.length >= 250) return; // Safeguard

      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            if (!EXCLUDED_DIRS.has(entry.name)) {
              collectFiles(fullPath);
            }
          } else if (entry.isFile()) {
            const ext = path.extname(entry.name).toLowerCase();
            if (!BINARY_EXTENSIONS.has(ext)) {
              filesToScan.push(fullPath);
            }
          }
        }
      } catch (err) {
        // Ignore directory read errors
      }
    }

    const stat = fs.statSync(startPath);
    if (stat.isDirectory()) {
      collectFiles(startPath);
    } else if (stat.isFile()) {
      filesToScan.push(startPath);
    }

    for (const filePath of filesToScan) {
      scannedFilesCount++;
      try {
        const content = fs.readFileSync(filePath, "utf8");
        // Quick validation for null byte to avoid scanning binary files
        if (content.includes("\0")) {
          continue;
        }

        const lines = content.split(/\r?\n/);
        for (let idx = 0; idx < lines.length; idx++) {
          const line = lines[idx];
          if (!line) continue;

          for (const pattern of CREDENTIAL_PATTERNS) {
            pattern.regex.lastIndex = 0; // Reset RegExp position
            const matches = line.match(pattern.regex);
            if (matches) {
              for (const match of matches) {
                // Redact the secret for the preview output
                let preview = match;
                if (match.length > 8) {
                  preview = `${match.substring(0, 4)}...${match.substring(match.length - 4)}`;
                }

                anomalies.push({
                  file: path.relative(process.cwd(), filePath),
                  line: idx + 1,
                  type: pattern.name,
                  preview,
                  cwe: pattern.cwe,
                  owasp: pattern.owasp
                });
              }
            }
          }
        }
      } catch (err) {
        // Skip unreadable files
      }
    }

    return {
      scannedFilesCount,
      anomalies
    };
  }
};

function resolvePath(p: string): string {
  if (path.isAbsolute(p)) {
    return p;
  }
  return path.resolve(process.cwd(), p);
}
