import * as fs from "node:fs";
import * as path from "node:path";
import * as readline from "node:readline";
import type { PolicyValidationInput, XyaVoryxEvent, AgentConfig } from "@xyavoryx/core";
import { FileMemoryStore } from "@xyavoryx/memory";
import {
  GeminiLLMProvider,
  OpenAILLMProvider,
  AnthropicLLMProvider,
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

  if (process.env.ANTHROPIC_API_KEY) {
    providerName = "Anthropic Claude";
    llmProvider = new AnthropicLLMProvider({
      apiKey: process.env.ANTHROPIC_API_KEY,
      model: "claude-3-5-sonnet-latest"
    });
  } else if (process.env.GEMINI_API_KEY) {
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
    console.log(`${colors.fgYellow}⚠️ No ANTHROPIC_API_KEY, GEMINI_API_KEY, or OPENAI_API_KEY found in .env file.`);
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

  // Type /help tip in starting interface
  console.log(`${colors.fgGray}Type ${colors.fgCyan}/help${colors.reset} to list all interactive slash commands, or enter a security task to begin.\n`);

  // Start the interactive shell loop
  const sessionId = "repl-session-" + Math.floor(Math.random() * 1000000);
  const caseIds: string[] = [];

  while (true) {
    const inputPrompt = await askQuestion(`\n${colors.fgCyan}${colors.bright}xyavoryx-shell>${colors.reset} `);
    const task = inputPrompt.trim();
    
    if (!task) {
      continue;
    }

    // Check for Slash Commands
    if (task.startsWith("/")) {
      const command = task.toLowerCase();
      if (command === "/exit" || command === "/quit") {
        console.log(`${colors.fgCyan}Goodbye!${colors.reset}`);
        break;
      }

      if (command === "/help") {
        console.log(`\n${colors.fgCyan}${colors.bright}❓ XYAVORYX SHELL COMMANDS & DOCUMENTATION:${colors.reset}`);
        console.log(`${colors.fgGray}================================================================================${colors.reset}`);
        console.log(`  ${colors.fgCyan}/help${colors.reset}       - Display this colorized interactive help panel`);
        console.log(`  ${colors.fgCyan}/findings${colors.reset}   - List all security vulnerabilities / findings discovered so far`);
        console.log(`  ${colors.fgCyan}/history${colors.reset}    - Trace chronological log/timeline of executed system tools`);
        console.log(`  ${colors.fgCyan}/session${colors.reset}    - Print information about current LLM config, ID, & storage`);
        console.log(`  ${colors.fgCyan}/clear${colors.reset}      - Refresh console interface and reprint ASCII logo`);
        console.log(`  ${colors.fgCyan}/exit${colors.reset} or ${colors.fgCyan}/quit${colors.reset}- Exit XyaVoryx AI CLI Shell gracefully`);
        console.log(`\n${colors.fgMagenta}${colors.bright}REGISTERED SECURITY TOOLS IN SHELL:${colors.reset}`);
        console.log(`${colors.fgGray}--------------------------------------------------------------------------------${colors.reset}`);
        console.log(`  - ${colors.fgCyan}shell.executor${colors.reset}       [HIGH risk] Runs CLI commands (governed by Policy Guard)`);
        console.log(`  - ${colors.fgCyan}file.system${colors.reset}          [MED risk]  Lists directories, reads/writes files`);
        console.log(`  - ${colors.fgCyan}ioc.extractor${colors.reset}        [LOW risk]  Parses IPs, MD5/SHA hashes, domains`);
        console.log(`  - ${colors.fgCyan}email.header.analyzer${colors.reset}[LOW risk]  Audits SPF, DKIM, DMARC headers`);
        console.log(`  - ${colors.fgCyan}stacktrace.parser${colors.reset}    [LOW risk]  Extracts source files and line positions`);
        console.log(`  - ${colors.fgCyan}test.output.parser${colors.reset}   [LOW risk]  Processes vitest / test suites execution results`);
        console.log(`${colors.fgGray}================================================================================${colors.reset}`);
        continue;
      }

      if (command === "/findings") {
        console.log(`\n${colors.fgCyan}${colors.bright}🎯 SECURITY FINDINGS IN CURRENT SESSION:${colors.reset}`);
        console.log(`${colors.fgGray}--------------------------------------------------------------------------------${colors.reset}`);
        
        const findings: any[] = [];
        for (const cid of caseIds) {
          const caseFindings = await memoryStore.getFindings(cid);
          findings.push(...caseFindings);
        }
        
        if (findings.length === 0) {
          console.log(`  ${colors.fgYellow}No security findings discovered yet in this session.${colors.reset}`);
        } else {
          // Format headers
          console.log(
            `  ${colors.bright}${"Severity".padEnd(8)} | ${"Title".padEnd(30)} | ${"Source Tool".padEnd(15)} | ${"Description"}${colors.reset}`
          );
          console.log(`${colors.fgGray}--------------------------------------------------------------------------------${colors.reset}`);
          for (const f of findings) {
            let sevColor = colors.fgGreen;
            if (f.severity === "high") {
              sevColor = colors.fgRed;
            } else if (f.severity === "medium") {
              sevColor = colors.fgYellow;
            }
            
            const paddedSev = f.severity.toUpperCase().padEnd(8);
            const paddedTitle = f.title.padEnd(30).substring(0, 30);
            const paddedTool = (f.sourceTool ?? "unknown").padEnd(15).substring(0, 15);
            const descCut = f.description.substring(0, 40);

            console.log(
              `  ${sevColor}${colors.bright}${paddedSev}${colors.reset} | ${paddedTitle} | ${paddedTool} | ${colors.fgGray}${descCut}${colors.reset}`
            );
          }
        }
        console.log(`${colors.fgGray}--------------------------------------------------------------------------------${colors.reset}`);
        console.log(`  ${colors.bright}Total findings: ${findings.length}${colors.reset}`);
        continue;
      }

      if (command === "/history") {
        console.log(`\n${colors.fgCyan}${colors.bright}⚙️  TOOL EXECUTION TIMELINE:${colors.reset}`);
        console.log(`${colors.fgGray}--------------------------------------------------------------------------------${colors.reset}`);
        
        const toolHistory: any[] = [];
        for (const cid of caseIds) {
          const caseHistory = await memoryStore.getExecutionHistory(cid);
          toolHistory.push(...caseHistory);
        }
        
        if (toolHistory.length === 0) {
          console.log(`  ${colors.fgYellow}No tools have been executed in this session yet.${colors.reset}`);
        } else {
          console.log(
            `  ${colors.bright}${"Tool Name".padEnd(15)} | ${"Status".padEnd(9)} | ${"Duration".padEnd(8)} | ${"Error / Payload Snippet"}${colors.reset}`
          );
          console.log(`${colors.fgGray}--------------------------------------------------------------------------------${colors.reset}`);
          for (const record of toolHistory) {
            let statusColor = colors.fgGreen;
            if (record.status === "failed") {
              statusColor = colors.fgRed;
            } else if (record.status === "blocked") {
              statusColor = colors.fgYellow;
            }
            
            const detailSnippet = record.error 
              ? `${colors.fgRed}${record.error}${colors.reset}` 
              : JSON.stringify(record.input).substring(0, 45);

            console.log(
              `  ${colors.fgMagenta}${record.tool.padEnd(15).substring(0, 15)}${colors.reset} | ` +
              `${statusColor}${record.status.padEnd(9)}${colors.reset} | ` +
              `${colors.fgCyan}${String(record.durationMs + "ms").padEnd(8)}${colors.reset} | ` +
              `${colors.fgGray}${detailSnippet}${colors.reset}`
            );
          }
        }
        console.log(`${colors.fgGray}--------------------------------------------------------------------------------${colors.reset}`);
        continue;
      }

      if (command === "/session") {
        console.log(`\n${colors.fgCyan}${colors.bright}📂 ACTIVE SESSION STATUS & CONFIGURATION:${colors.reset}`);
        console.log(`${colors.fgGray}--------------------------------------------------------------------------------${colors.reset}`);
        console.log(`  ${colors.fgGray}Session ID:${colors.reset}       ${colors.fgCyan}${sessionId}${colors.reset}`);
        console.log(`  ${colors.fgGray}LLM Provider:${colors.reset}     ${colors.fgGreen}${providerName}${colors.reset}`);
        console.log(`  ${colors.fgGray}Active Model:${colors.reset}     ${colors.fgWhite}${process.env.ANTHROPIC_API_KEY ? "claude-3-5-sonnet-latest" : process.env.GEMINI_API_KEY ? "gemini-2.5-flash" : process.env.OPENAI_API_KEY ? "gpt-4o-mini" : "Mock"}${colors.reset}`);
        console.log(`  ${colors.fgGray}Memory Directory:${colors.reset} ${colors.fgCyan}${path.resolve(process.cwd(), ".xyavoryx-memory")}${colors.reset}`);
        console.log(`  ${colors.fgGray}Agent Goal:${colors.reset}       Investigate security incidents, audit system configurations, analyze files autonomously.`);
        console.log(`  ${colors.fgGray}Total Tasks Run:${colors.reset}  ${caseIds.length}`);
        console.log(`${colors.fgGray}--------------------------------------------------------------------------------${colors.reset}`);
        continue;
      }

      if (command === "/clear") {
        console.clear();
        console.log(`${colors.fgCyan}${colors.bright}`);
        console.log("██╗  ██╗██╗   ██╗ █████╗ ██╗   ██╗ ██████╗ ██████╗ ██╗   ██╗██╗  ██╗");
        console.log("╚██╗██╔╝╚██╗ ██╔╝██╔══██╗██║   ██║██╔═══██╗██╔══██╗╚██╗ ██╔╝╚██╗██╔╝");
        console.log(" ╚███╔╝  ╚████╔╝ ███████║██║   ██║██║   ██║██████╔╝ ╚████╔╝  ╚███╔╝ ");
        console.log(" ██╔██╗   ╚██╔╝  ██╔══██║╚██╗ ██╔╝██║   ██║██╔══██╗  ╚██╔╝   ██╔██╗ ");
        console.log("██╔╝ ██╗   ██║   ██║  ██║ ╚████╔╝ ╚██████╔╝██║  ██║   ██║   ██╔╝ ██╗");
        console.log("╚═╝  ╚═╝   ╚═╝   ╚═╝  ╚═╝  ╚═══╝   ╚═════╝ ╚═╝  ╚═╝   ╚═╝  ╚═╝  ╚═╝");
        console.log(`               PERSONAL SECURITY & SYSTEM AI AGENT${colors.reset}\n`);
        console.log(`${colors.fgGray}LLM Provider: ${colors.fgGreen}${providerName}${colors.reset}`);
        console.log(`${colors.fgGray}Persistent storage initialized in: ${colors.fgCyan}.xyavoryx-memory${colors.reset}`);
        console.log(`${colors.fgGray}Type ${colors.fgCyan}/help${colors.reset} to list all interactive slash commands, or enter a security task to begin.\n`);
        continue;
      }

      console.log(`${colors.fgRed}⚠️  Unknown slash command: ${colors.bright}${task}${colors.reset}`);
      console.log(`Type ${colors.fgCyan}/help${colors.reset} to see all available commands.`);
      continue;
    }

    // Run Security Agent with Context Carry-Over
    const previousObservations: string[] = [];
    const previousFindings: string[] = [];

    for (const cid of caseIds) {
      const caseObs = await memoryStore.getObservations(cid);
      for (const obs of caseObs) {
        if (obs.type === "tool.output" && obs.data) {
          previousObservations.push(`[${obs.data.tool}] ${JSON.stringify(obs.data.output)}`);
        } else {
          previousObservations.push(obs.message);
        }
      }
      
      const caseFinds = await memoryStore.getFindings(cid);
      for (const f of caseFinds) {
        previousFindings.push(`[${f.severity.toUpperCase()}] ${f.title}: ${f.description}`);
      }
    }

    const runContext: Record<string, unknown> = {
      sessionId,
      previousObservations: previousObservations.slice(-20), // Carry last 20 observations to avoid context bloat
      previousFindings: previousFindings.slice(-10)
    };

    const agent = defineAgent({
      id: "personal-sec-agent",
      name: "XyaVoryx Personal Agent",
      goal: "Investigate security incidents, audit system configurations, analyze local files, and compile markdown reports autonomously.",
      tools: ["shell.executor", "file.system", "ioc.extractor", "email.header.analyzer", "stacktrace.parser", "test.output.parser"],
      policies: {
        maxToolExecutions: 10
      }
    });

    console.log(`\n${colors.dim}------------------------------------------------------------${colors.reset}`);
    const result = await runtime.runAgent(agent, {
      task,
      context: runContext
    });
    console.log(`${colors.dim}------------------------------------------------------------${colors.reset}`);

    caseIds.push(result.caseId);

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
