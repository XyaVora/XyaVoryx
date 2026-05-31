import type { AgentConfig } from "@xyavoryx/core";

export const PHISHING_PLAYBOOK: AgentConfig = {
  id: "playbook-phishing",
  name: "Phishing Investigation Playbook",
  description: "Standard playbook to analyze suspicious emails, parse authentication headers (SPF, DKIM, DMARC), and extract malicious Indicators of Compromise (IOCs).",
  goal: "Analyze suspicious email headers and extract embedded threat indicators.",
  tools: ["email.header.analyzer", "ioc.extractor"],
  workflow: [
    {
      id: "step-analyze-email-headers",
      tool: "email.header.analyzer",
      inputFrom: "rawInput",
      inputKey: "rawEmail"
    },
    {
      id: "step-extract-email-iocs",
      tool: "ioc.extractor",
      inputFrom: "rawInput",
      inputKey: "text"
    }
  ],
  policies: {
    maxToolExecutions: 5
  }
};

export const LOG_SECURITY_PLAYBOOK: AgentConfig = {
  id: "playbook-log-security",
  name: "Log Security Incident Playbook",
  description: "Standard playbook to parse web (Nginx), system (Syslog), or Windows security logs to detect brute-force attacks, SQL Injection, XSS, or path traversals, and then extract malicious IOCs.",
  goal: "Detect security anomalies in system logs and collect associated threat indicators.",
  tools: ["log.security.parser", "ioc.extractor"],
  workflow: [
    {
      id: "step-parse-security-logs",
      tool: "log.security.parser",
      inputFrom: "rawInput",
      inputKey: "logContent"
    },
    {
      id: "step-extract-log-iocs",
      tool: "ioc.extractor",
      inputFrom: "rawInput",
      inputKey: "text"
    }
  ],
  policies: {
    maxToolExecutions: 5
  }
};

export const PORT_SECURITY_PLAYBOOK: AgentConfig = {
  id: "playbook-port-security",
  name: "Port Security Remediation Playbook",
  description: "Standard playbook to scan local network ports to discover active listening sockets, analyze potential exposure risks, and automatically remediate or close unauthorized open ports.",
  goal: "Discover open listening network ports and remediate unauthorized exposing sockets.",
  tools: ["local.port.analyzer", "local.port.remediator"],
  workflow: [
    {
      id: "step-analyze-exposed-ports",
      tool: "local.port.analyzer",
      inputFrom: "literal",
      literalInput: {}
    },
    {
      id: "step-remediate-exposed-ports",
      tool: "local.port.remediator",
      inputFrom: "stepOutput",
      inputKey: "exposedPorts"
    }
  ],
  policies: {
    maxToolExecutions: 5
  }
};
