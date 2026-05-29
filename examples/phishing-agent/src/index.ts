import {
  createXyaVoryx,
  defineAgent,
  EmailHeaderAnalyzerTool,
  FileMemoryStore,
  IOCExtractorTool,
  InMemoryStore,
  type MemoryStore,
  MockLLMProvider
} from "@xyavoryx/sdk";

function buildMemoryStore(): MemoryStore {
  if (process.env.XYAVORYX_MEMORY_BACKEND === "file") {
    const baseDir = process.env.XYAVORYX_MEMORY_DIR ?? ".xyavoryx-data/phishing-agent";
    return new FileMemoryStore({ baseDir });
  }

  return new InMemoryStore();
}

async function main(): Promise<void> {
  const runtime = createXyaVoryx({
    memory: buildMemoryStore()
  });

  runtime.registerProvider(new MockLLMProvider());
  runtime.registerTool(EmailHeaderAnalyzerTool);
  runtime.registerTool(IOCExtractorTool);

  const phishingAgent = defineAgent({
    id: "phishing-investigator",
    name: "Phishing Investigator",
    goal: "Analyze suspicious email artifacts deterministically.",
    tools: ["email.header.analyzer", "ioc.extractor"],
    workflow: [
      {
        id: "email-header-analysis",
        tool: "email.header.analyzer",
        inputFrom: "rawInput",
        inputKey: "rawEmail"
      },
      {
        id: "ioc-extraction",
        tool: "ioc.extractor",
        inputFrom: "rawInput",
        inputKey: "text"
      }
    ],
    policies: {
      allowNetwork: false,
      allowFilesystem: false,
      maxToolExecutions: 10,
      deniedTools: []
    }
  });

  const sampleEmail = [
    "From: Security Team <security-alerts@contoso-payments.com>",
    "To: Employee <employee@contoso.com>",
    "Subject: Urgent password reset required",
    "Return-Path: <mailer@external-sender.net>",
    "Received: from unknown-host (192.168.1.10) by mail-gateway.contoso.com",
    "Authentication-Results: mx.contoso.com; spf=fail smtp.mailfrom=contoso-payments.com; dkim=none; dmarc=fail",
    "",
    "Please verify account at https://contoso-login-security.example/reset?token=abc",
    "Contact attacker@evil-domain.example for support",
    "Suspicious hash: d41d8cd98f00b204e9800998ecf8427e"
  ].join("\n");

  const result = await runtime.runAgent(phishingAgent, {
    task: "Investigate suspicious phishing email",
    rawInput: sampleEmail
  });

  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error("phishing-agent failed", error);
  process.exitCode = 1;
});
