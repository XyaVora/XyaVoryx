import type { Finding } from "@xyavoryx/core";
import { DockerComposeRemediator } from "./docker-compose-remediator";
import { LocalPortRemediator } from "./local-port-remediator";

export interface MitigationProposal {
  diff: string;
  apply: () => Promise<void>;
}

export class MitigationEngine {
  static proposeFix(finding: Finding, customPath?: string): MitigationProposal | null {
    // 1. Docker Compose Auditor remediations
    if (finding.sourceTool === "docker.auditor" && finding.evidence) {
      const proposal = DockerComposeRemediator.proposeRemediation(
        finding.title,
        finding.evidence,
        customPath
      );
      if (proposal) return proposal;
    }

    // 2. Local Port Analyzer remediations
    if (finding.sourceTool === "local.port.analyzer") {
      // Extract port number from finding data, title, or description
      let port: number | null = null;
      if (finding.data && typeof finding.data.port === "number") {
        port = finding.data.port;
      } else {
        // Extract using regex match, e.g. "port: 3306" or "port 3306"
        const portMatch = finding.title.match(/port\s*:\s*([0-9]+)/i) ?? 
                          finding.description.match(/\bport\s+([0-9]+)\b/i) ??
                          finding.title.match(/\b([0-9]+)\b/);
        if (portMatch) {
          port = parseInt(portMatch[1], 10);
        }
      }

      if (port && !isNaN(port)) {
        const proposal = LocalPortRemediator.proposeRemediation(port);
        if (proposal) return proposal;
      }
    }

    return null;
  }
}
