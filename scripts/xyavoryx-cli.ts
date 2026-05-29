import * as fs from "node:fs";
import * as path from "node:path";
import * as readline from "node:readline";
import type { PolicyValidationInput, XyaVoryxEvent, AgentConfig } from "@xyavoryx/core";
import { FileMemoryStore } from "@xyavoryx/memory";
import {
  GeminiLLMProvider,
  OpenAILLMProvider,
  MockLLMProvider
} from "@xyavoryx/providers";
import {
  ShellExecutorTool,
  FileSystemTool,
  IOCExtractorTool,
  EmailHeaderAnalyzerTool,
  StacktraceParserTool,
  TestOutputParserTool
} from "@xyavoryx/tools";
import { XyaVoryx } from "@xyavoryx/runtime";

// Simple defineAgent helper to avoid circular dependency on @xyavoryx/sdk
function defineAgent(agent: AgentConfig): AgentConfig {
  return agent;
}

// Helper to manually load .env file without external dependencies
function loadEnv(): void {
  const envPath = path.resolve(process.cwd(), ".env");
  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) {
        continue;
      }
      const match = trimmed.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
      if (match) {
        const key = match[1];
        let value = match[2] || "";
        if (value.startsWith('"') && value.endsWith('"')) {
          value = value.slice(1, -1);
        } else if (value.startsWith("'") && value.endsWith("'")) {
          value = value.slice(1, -1);
        }
        process.env[key] = value;
      }
    }
  }
}

// ANSI escape codes for beautiful styling
const colors = {
  reset: "\x1b[0m",
  bright: "\x1b[1m",
  dim: "\x1b[2m",
  underscore: "\x1b[4m",
  blink: "\x1b[5m",
  reverse: "\x1b[7m",
  hidden: "\x1b[8m",

  fgBlack: "\x1b[30m",
  fgRed: "\x1b[31m",
  fgGreen: "\x1b[32m",
  fgYellow: "\x1b[33m",
  fgBlue: "\x1b[34m",
  fgMagenta: "\x1b[35m",
  fgCyan: "\x1b[36m",
  fgWhite: "\x1b[37m",
  fgGray: "\x1b[90m",

  bgBlack: "\x1b[40m",
  bgRed: "\x1b[41m",
  bgGreen: "\x1b[42m",
  bgYellow: "\x1b[43m",
  bgBlue: "\x1b[44m",
  bgMagenta: "\x1b[45m",
  bgCyan: "\x1b[46m",
  bgWhite: "\x1b[47m"
};

function askQuestion(query: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  return new Promise((resolve) =>
    rl.question(query, (answer) => {
      rl.close();
      resolve(answer.trim());
    })
  );
}

async function main(): Promise<void> {
  loadEnv();

  console.clear();
  console.log(`${colors.fgCyan}${colors.bright}`);
  console.log("██╗  ██╗██╗   ██╗ █████╗ ██╗   ██╗ ██████╗ ██████╗ ██╗   ██╗██╗  ██╗");
  console.log("╚██╗██╔╝╚██╗ ██╔╝██╔══██╗██║   ██║██╔═══██╗██╔══██╗╚██╗ ██╔╝╚██╗██╔╝");
  console.log(" ╚███╔╝  ╚████╔╝ ███████║██║   ██║██║   ██║██████╔╝ ╚████╔╝  ╚███╔╝ ");
  console.log(" ██╔██╗   ╚██╔╝  ██╔══██║╚██╗ ██╔╝██║   ██║██╔══██╗  ╚██╔╝   ██╔██╗ ");
  console.log("██╔╝ ██╗   ██║   ██║  ██║ ╚████╔╝ ╚██████╔╝██║  ██║   ██║   ██╔╝ ██╗");
  console.log("╚═╝  ╚═╝   ╚═╝   ╚═╝  ╚═╝  ╚═══╝   ╚═════╝ ╚═╝  ╚═╝   ╚═╝  ╚═╝  ╚═╝");
  console.log(`               PERSONAL SECURITY & SYSTEM AI AGENT${colors.reset}\n`);

  // Detect and select LLM Provider
  let llmProvider: any;
  let providerName = "";

  if (process.env.GEMINI_API_KEY) {
    providerName = "Google Gemini";
    llmProvider = new GeminiLLMProvider({
      apiKey: process.env.GEMINI_API_KEY,
      model: "gemini-2.5-flash"
    });
  } else if (process.env.OPENAI_API_KEY) {
    providerName = "OpenAI GPT";
    llmProvider = new OpenAILLMProvider({
      apiKey: process.env.OPENAI_API_KEY,
      model: "gpt-4o-mini"
    });
  } else {
    console.log(`${colors.fgYellow}⚠️ No GEMINI_API_KEY or OPENAI_API_KEY found in .env file.`);
    console.log(`Starting in mock/demonstration mode.${colors.reset}\n`);
    providerName = "Mock LLM";
    llmProvider = new MockLLMProvider({
      defaultResponse: JSON.stringify({
        thought: "I need to inspect the directory structure first.",
        action: "call",
        tool: "file.system",
        input: { operation: "list", path: "." }
      })
    });
  }

  console.log(`${colors.fgGray}LLM Provider: ${colors.fgGreen}${providerName}${colors.reset}`);
  console.log(`${colors.fgGray}Persistent storage initialized in: ${colors.fgCyan}.xyavoryx-memory${colors.reset}\n`);

  // Setup memory and runtime
  const memoryStore = new FileMemoryStore({
    baseDir: path.resolve(process.cwd(), ".xyavoryx-memory")
  });

  // Setup interactive policy approval hook
  const runtime = new XyaVoryx({
    memory: memoryStore,
    approvalHook: async (input: PolicyValidationInput) => {
      console.log(`\n${colors.fgYellow}${colors.bright}🛡️ [Policy Guard] Danger / High-Risk action requested!${colors.reset}`);
      console.log(`${colors.fgGray}Agent wishes to call tool:${colors.reset} ${colors.fgCyan}${input.toolName}${colors.reset}`);
      
      if (input.toolName === "shell.executor") {
        console.log(`${colors.fgGray}Requested command:${colors.reset} ${colors.fgRed}${colors.bright}${input.toolName}${colors.reset}`);
      }

      console.log(`${colors.fgGray}Payload:${colors.reset} ${colors.fgWhite}${JSON.stringify(input.policy || input, null, 2)}${colors.reset}`);
      
      const answer = await askQuestion(`${colors.fgYellow}${colors.bright}👉 Allow this action? (y/N): ${colors.reset}`);
      const allowed = answer.toLowerCase() === "y" || answer.toLowerCase() === "yes";
      
      if (allowed) {
        console.log(`${colors.fgGreen}✅ Execution approved by user.${colors.reset}\n`);
      } else {
        console.log(`${colors.fgRed}❌ Execution denied by user.${colors.reset}\n`);
      }
      return allowed;
    }
  });

  // Register providers and tools
  runtime.registerProvider(llmProvider);
  runtime.registerTool(ShellExecutorTool);
  runtime.registerTool(FileSystemTool);
  runtime.registerTool(IOCExtractorTool);
  runtime.registerTool(EmailHeaderAnalyzerTool);
  runtime.registerTool(StacktraceParserTool);
  runtime.registerTool(TestOutputParserTool);

  // Subscribe to event bus for gorgeous console logs
  runtime.getEventBus().subscribe((event: XyaVoryxEvent) => {
    switch (event.type) {
      case "agent.started":
        console.log(`${colors.fgCyan}🚀 Personal Agent started and planning investigation...${colors.reset}`);
        break;
      case "workflow.step_recovered": {
        const payload = event.payload as { thought?: string; action?: string; tool?: string };
        if (payload?.thought) {
          console.log(`\n${colors.fgYellow}${colors.bright}[💭 Agent Thought]${colors.reset}`);
          console.log(`${colors.fgYellow}${payload.thought}${colors.reset}`);
        }
        if (payload?.action === "call" && payload?.tool) {
          console.log(`${colors.fgCyan}⚙️  [Action] Calling tool:${colors.reset} ${colors.fgMagenta}${payload.tool}${colors.reset}`);
        }
        break;
      }
      case "tool.started":
        break;
      case "tool.completed": {
        const payload = event.payload as { tool?: string };
        console.log(`${colors.fgGreen}✅  [Tool Completed] ${colors.fgGray}${payload?.tool}${colors.reset}`);
        break;
      }
      case "tool.failed": {
        const payload = event.payload as { tool?: string; error?: string };
        console.log(`${colors.fgRed}💥  [Tool Failed] ${colors.fgGray}${payload?.tool}: ${colors.fgRed}${payload?.error}${colors.reset}`);
        break;
      }
      case "policy.checked": {
        const payload = event.payload as { tool?: string; allowed?: boolean; reason?: string };
        if (payload?.allowed) {
          console.log(`${colors.fgGray}   [🛡️ Policy Allowed] ${payload?.tool}${colors.reset}`);
        } else {
          console.log(`${colors.fgRed}   [❌ Policy Blocked] ${payload?.tool} - ${payload?.reason}${colors.reset}`);
        }
        break;
      }
      case "observation.created": {
        const payload = event.payload as { type?: string; message?: string };
        console.log(`${colors.fgGray}   [👁️ Observation] ${colors.fgWhite}${payload?.message}${colors.reset}`);
        break;
      }
      case "finding.created": {
        const payload = event.payload as { severity?: string; title?: string };
        console.log(`${colors.fgRed}${colors.bright}   [🎯 Finding Created] [${payload?.severity?.toUpperCase()}] ${payload?.title}${colors.reset}`);
        break;
      }
      case "agent.completed":
        console.log(`\n${colors.fgGreen}${colors.bright}✨ Agent goal completed successfully!${colors.reset}`);
        break;
      case "agent.failed":
        console.log(`\n${colors.fgRed}${colors.bright}❌ Agent goal failed or aborted.${colors.reset}`);
        break;
    }
  });

  // Start the interactive shell loop
  while (true) {
    const task = await askQuestion(`\n${colors.bright}🤖 Enter your task for the Security Agent (or type 'exit'): ${colors.reset}`);
    
    if (task.toLowerCase() === "exit") {
      console.log(`${colors.fgCyan}Goodbye!${colors.reset}`);
      break;
    }

    if (!task) {
      continue;
    }

    const agent = defineAgent({
      id: "personal-sec-agent",
      name: "XyaVoryx Personal Agent",
      goal: "Investigate security incidents, audit system configurations, analyze local files, and compile markdown reports autonomously.",
      tools: ["shell.executor", "file.system", "ioc.extractor", "email.header.analyzer", "stacktrace.parser"],
      policies: {
        maxToolExecutions: 10
      }
    });

    console.log(`\n${colors.dim}------------------------------------------------------------${colors.reset}`);
    const result = await runtime.runAgent(agent, {
      task
    });
    console.log(`${colors.dim}------------------------------------------------------------${colors.reset}`);

    if (result.report) {
      console.log(`\n${colors.fgGreen}${colors.bright}[📝 Final Security Report]${colors.reset}`);
      console.log(result.report);
    }
  }
}

main().catch((error) => {
  console.error(`${colors.fgRed}Fatal error running XyaVoryx CLI:${colors.reset}`, error);
  process.exit(1);
});
