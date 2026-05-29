#!/usr/bin/env node
import * as fs from "node:fs";
import * as path from "node:path";
import * as readline from "node:readline";
import type { PolicyValidationInput, XyaVoryxEvent, AgentConfig } from "@xyavoryx/core";
import { FileMemoryStore } from "@xyavoryx/memory";
import {
  GeminiLLMProvider,
  OpenAILLMProvider,
  AnthropicLLMProvider,
  MockLLMProvider,
  OllamaLLMProvider
} from "@xyavoryx/providers";
import {
  ShellExecutorTool,
  FileSystemTool,
  IOCExtractorTool,
  EmailHeaderAnalyzerTool,
  StacktraceParserTool,
  TestOutputParserTool,
  LogSecurityParserTool
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

const HISTORY_FILE = path.resolve(process.cwd(), ".xyavoryx-history");
let cliHistory: string[] = [];

function initHistory(): void {
  try {
    if (fs.existsSync(HISTORY_FILE)) {
      cliHistory = fs.readFileSync(HISTORY_FILE, "utf8")
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(line => line.length > 0);
    }
  } catch (err) {
    // Ignore
  }
}

function appendToHistory(line: string): void {
  if (!line || cliHistory.includes(line)) return;
  cliHistory.push(line);
  try {
    fs.appendFileSync(HISTORY_FILE, line + "\n", "utf8");
  } catch (err) {
    // Ignore
  }
}

function askQuestion(query: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    history: [...cliHistory].reverse()
  });
  return new Promise((resolve) =>
    rl.question(query, (answer) => {
      rl.close();
      resolve(answer.trim());
    })
  );
}

function createRuntime(memoryStoreInstance: FileMemoryStore, llmProviderInstance: any): XyaVoryx {
  const r = new XyaVoryx({
    memory: memoryStoreInstance,
    approvalHook: async (input: PolicyValidationInput) => {
      console.log(`\n${colors.fgYellow}${colors.bright}[POLICY GUARD] Danger / High-Risk action requested!${colors.reset}`);
      console.log(`${colors.fgGray}Agent wishes to call tool:${colors.reset} ${colors.fgCyan}${input.toolName}${colors.reset}`);
      
      if (input.toolName === "shell.executor") {
        console.log(`${colors.fgGray}Requested command:${colors.reset} ${colors.fgRed}${colors.bright}${input.toolName}${colors.reset}`);
      }

      console.log(`${colors.fgGray}Payload:${colors.reset} ${colors.fgWhite}${JSON.stringify(input.policy || input, null, 2)}${colors.reset}`);
      
      const answer = await askQuestion(`${colors.fgYellow}${colors.bright}[CONFIRM] Allow this action? (y/N): ${colors.reset}`);
      const allowed = answer.toLowerCase() === "y" || answer.toLowerCase() === "yes";
      
      if (allowed) {
        console.log(`${colors.fgGreen}[APPROVED] Execution approved by user.${colors.reset}\n`);
      } else {
        console.log(`${colors.fgRed}[DENIED] Execution denied by user.${colors.reset}\n`);
      }
      return allowed;
    }
  });

  r.registerProvider(llmProviderInstance);
  r.registerTool(ShellExecutorTool);
  r.registerTool(FileSystemTool);
  r.registerTool(IOCExtractorTool);
  r.registerTool(EmailHeaderAnalyzerTool);
  r.registerTool(StacktraceParserTool);
  r.registerTool(TestOutputParserTool);
  r.registerTool(LogSecurityParserTool);

  // Subscribe to event bus for gorgeous console logs
  r.getEventBus().subscribe((event: XyaVoryxEvent) => {
    switch (event.type) {
      case "agent.started":
        console.log(`${colors.fgCyan}[START] Personal Agent started and planning investigation...${colors.reset}`);
        break;
      case "workflow.step_recovered": {
        const payload = event.payload as { thought?: string; action?: string; tool?: string };
        if (payload?.thought) {
          console.log(`\n${colors.fgYellow}${colors.bright}[THOUGHT] [Agent Thought]${colors.reset}`);
          console.log(`${colors.fgYellow}${payload.thought}${colors.reset}`);
        }
        if (payload?.action === "call" && payload?.tool) {
          console.log(`${colors.fgCyan}[ACTION] Calling tool:${colors.reset} ${colors.fgMagenta}${payload.tool}${colors.reset}`);
        }
        break;
      }
      case "tool.started":
        break;
      case "tool.completed": {
        const payload = event.payload as { tool?: string };
        console.log(`${colors.fgGreen}[SUCCESS] [Tool Completed] ${colors.fgGray}${payload?.tool}${colors.reset}`);
        break;
      }
      case "tool.failed": {
        const payload = event.payload as { tool?: string; error?: string };
        console.log(`${colors.fgRed}[FAILURE] [Tool Failed] ${colors.fgGray}${payload?.tool}: ${colors.fgRed}${payload?.error}${colors.reset}`);
        break;
      }
      case "policy.checked": {
        const payload = event.payload as { tool?: string; allowed?: boolean; reason?: string };
        if (payload?.allowed) {
          console.log(`${colors.fgGray}   [POLICY ALLOWED] ${payload?.tool}${colors.reset}`);
        } else {
          console.log(`${colors.fgRed}   [POLICY BLOCKED] ${payload?.tool} - ${payload?.reason}${colors.reset}`);
        }
        break;
      }
      case "observation.created": {
        const payload = event.payload as { type?: string; message?: string };
        console.log(`${colors.fgGray}   [OBSERVATION] ${colors.fgWhite}${payload?.message}${colors.reset}`);
        break;
      }
      case "finding.created": {
        const payload = event.payload as { severity?: string; title?: string };
        console.log(`${colors.fgRed}${colors.bright}   [FINDING CREATED] [${payload?.severity?.toUpperCase()}] ${payload?.title}${colors.reset}`);
        break;
      }
      case "agent.completed":
        console.log(`\n${colors.fgGreen}${colors.bright}[SUCCESS] Agent goal completed successfully!${colors.reset}`);
        break;
      case "agent.failed":
        console.log(`\n${colors.fgRed}${colors.bright}[FAILURE] Agent goal failed or aborted.${colors.reset}`);
        break;
    }
  });

  return r;
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
  let activeModel = "Mock";

  let isOllamaRunning = false;
  try {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), 300);
    const ollamaCheck = await fetch("http://localhost:11434/api/tags", { signal: controller.signal });
    clearTimeout(id);
    if (ollamaCheck.ok) {
      isOllamaRunning = true;
    }
  } catch (err) {
    // Ignore, Ollama not running
  }

  if (process.env.ANTHROPIC_API_KEY) {
    providerName = "Anthropic Claude";
    activeModel = "claude-3-5-sonnet-latest";
    llmProvider = new AnthropicLLMProvider({
      apiKey: process.env.ANTHROPIC_API_KEY,
      model: activeModel
    });
  } else if (process.env.GEMINI_API_KEY) {
    providerName = "Google Gemini";
    activeModel = "gemini-2.5-flash";
    llmProvider = new GeminiLLMProvider({
      apiKey: process.env.GEMINI_API_KEY,
      model: activeModel
    });
  } else if (process.env.OPENAI_API_KEY) {
    providerName = "OpenAI GPT";
    activeModel = "gpt-4o-mini";
    llmProvider = new OpenAILLMProvider({
      apiKey: process.env.OPENAI_API_KEY,
      model: activeModel
    });
  } else if (isOllamaRunning || process.env.OLLAMA_MODEL) {
    activeModel = process.env.OLLAMA_MODEL ?? "llama3";
    providerName = `Ollama Local (${activeModel})`;
    llmProvider = new OllamaLLMProvider({
      model: activeModel
    });
  } else {
    console.log(`${colors.fgYellow}[WARNING] No ANTHROPIC_API_KEY, GEMINI_API_KEY, or OPENAI_API_KEY found in .env file, and local Ollama server is not running.`);
    console.log(`Starting in mock/demonstration mode.${colors.reset}\n`);
    providerName = "Mock LLM";
    activeModel = "Mock";
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

  // Initialize Persistent History
  initHistory();

  // Setup memory and runtime
  let memoryStore = new FileMemoryStore({
    baseDir: path.resolve(process.cwd(), ".xyavoryx-memory")
  });

  let runtime = createRuntime(memoryStore, llmProvider);

  // Type /help tip in starting interface
  console.log(`${colors.fgGray}Type ${colors.fgCyan}/help${colors.reset} to list all interactive slash commands, or enter a security task to begin.\n`);

  // Start the interactive shell loop
  let sessionId = "repl-session-" + Math.floor(Math.random() * 1000000);
  const caseIds: string[] = [];

  while (true) {
    const inputPrompt = await askQuestion(`\n${colors.fgCyan}${colors.bright}xyavoryx-shell>${colors.reset} `);
    const task = inputPrompt.trim();
    
    if (!task) {
      continue;
    }

    // Check for Slash Commands
    if (task.startsWith("/")) {
      const parts = task.split(/\s+/);
      const command = parts[0].toLowerCase();
      const arg = parts.slice(1).join(" ").trim();

      if (command === "/exit" || command === "/quit") {
        console.log(`${colors.fgCyan}Goodbye!${colors.reset}`);
        break;
      }

      if (command === "/help") {
        console.log(`\n${colors.fgCyan}${colors.bright}[HELP] XYAVORYX SHELL COMMANDS & DOCUMENTATION:${colors.reset}`);
        console.log(`${colors.fgGray}================================================================================${colors.reset}`);
        console.log(`  ${colors.fgCyan}/help${colors.reset}               - Display this colorized interactive help panel`);
        console.log(`  ${colors.fgCyan}/findings${colors.reset}           - List all security vulnerabilities / findings discovered so far`);
        console.log(`  ${colors.fgCyan}/history${colors.reset}            - Trace chronological log/timeline of executed system tools`);
        console.log(`  ${colors.fgCyan}/session${colors.reset}            - Print information about current LLM config, ID, & storage`);
        console.log(`  ${colors.fgCyan}/save [filename]${colors.reset}    - Save current active session data to .xyavoryx-sessions/`);
        console.log(`  ${colors.fgCyan}/load <filename>${colors.reset}    - Restore session from a saved JSON session file`);
        console.log(`  ${colors.fgCyan}/export${colors.reset}            - Export professional markdown report of findings and trace`);
        console.log(`  ${colors.fgCyan}/clear${colors.reset}              - Refresh console interface and reprint ASCII logo`);
        console.log(`  ${colors.fgCyan}/exit${colors.reset} or ${colors.fgCyan}/quit${colors.reset}        - Exit XyaVoryx AI CLI Shell gracefully`);
        console.log(`\n${colors.fgMagenta}${colors.bright}REGISTERED SECURITY TOOLS IN SHELL:${colors.reset}`);
        console.log(`${colors.fgGray}--------------------------------------------------------------------------------${colors.reset}`);
        console.log(`  - ${colors.fgCyan}shell.executor${colors.reset}       [HIGH risk] Runs CLI commands (governed by Policy Guard)`);
        console.log(`  - ${colors.fgCyan}file.system${colors.reset}          [MED risk]  Lists directories, reads/writes files`);
        console.log(`  - ${colors.fgCyan}log.security.parser${colors.reset}  [LOW risk]  Analyzes Syslog, Nginx, or Windows logs for attacks`);
        console.log(`  - ${colors.fgCyan}ioc.extractor${colors.reset}        [LOW risk]  Parses IPs, MD5/SHA hashes, domains`);
        console.log(`  - ${colors.fgCyan}email.header.analyzer${colors.reset}[LOW risk]  Audits SPF, DKIM, DMARC headers`);
        console.log(`  - ${colors.fgCyan}stacktrace.parser${colors.reset}    [LOW risk]  Extracts source files and line positions`);
        console.log(`  - ${colors.fgCyan}test.output.parser${colors.reset}   [LOW risk]  Processes vitest / test suites execution results`);
        console.log(`${colors.fgGray}================================================================================${colors.reset}`);
        continue;
      }

      if (command === "/findings") {
        console.log(`\n${colors.fgCyan}${colors.bright}[FINDINGS] SECURITY FINDINGS IN CURRENT SESSION:${colors.reset}`);
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
        console.log(`\n${colors.fgCyan}${colors.bright}[TIMELINE] TOOL EXECUTION TIMELINE:${colors.reset}`);
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
        console.log(`\n${colors.fgCyan}${colors.bright}[SESSION] ACTIVE SESSION STATUS & CONFIGURATION:${colors.reset}`);
        console.log(`${colors.fgGray}--------------------------------------------------------------------------------${colors.reset}`);
        console.log(`  ${colors.fgGray}Session ID:${colors.reset}       ${colors.fgCyan}${sessionId}${colors.reset}`);
        console.log(`  ${colors.fgGray}LLM Provider:${colors.reset}     ${colors.fgGreen}${providerName}${colors.reset}`);
        console.log(`  ${colors.fgGray}Active Model:${colors.reset}     ${colors.fgGreen}${activeModel}${colors.reset}`);
        console.log(`  ${colors.fgGray}Memory Directory:${colors.reset} ${colors.fgCyan}${path.resolve(process.cwd(), ".xyavoryx-memory")}${colors.reset}`);
        console.log(`  ${colors.fgGray}Agent Goal:${colors.reset}       Investigate security incidents, audit system configurations, analyze files autonomously.`);
        console.log(`  ${colors.fgGray}Total Tasks Run:${colors.reset}  ${caseIds.length}`);
        console.log(`${colors.fgGray}--------------------------------------------------------------------------------${colors.reset}`);
        continue;
      }

      if (command === "/save") {
        const sessionName = arg || "session-" + sessionId;
        const safeSessionName = sessionName.replace(/[^a-zA-Z0-9_-]/g, "_");
        const sessionDir = path.resolve(process.cwd(), ".xyavoryx-sessions");
        if (!fs.existsSync(sessionDir)) {
          fs.mkdirSync(sessionDir, { recursive: true });
        }
        const sessionFilePath = path.resolve(sessionDir, `${safeSessionName}.json`);

        const statePath = path.resolve(process.cwd(), ".xyavoryx-memory", "state.json");
        let storeState = {};
        if (fs.existsSync(statePath)) {
          try {
            storeState = JSON.parse(fs.readFileSync(statePath, "utf8"));
          } catch (e) {
            // Ignore
          }
        }

        const saveData = {
          sessionId,
          caseIds,
          storeState
        };

        fs.writeFileSync(sessionFilePath, JSON.stringify(saveData, null, 2), "utf8");
        console.log(`\n${colors.fgGreen}[SUCCESS] Session successfully saved to: ${colors.fgCyan}${sessionFilePath}${colors.reset}`);
        continue;
      }

      if (command === "/load") {
        const sessionName = arg;
        if (!sessionName) {
          console.log(`\n${colors.fgRed}[ERROR] Please specify a session filename to load. Example: /load my_session${colors.reset}`);
          continue;
        }
        const safeSessionName = sessionName.replace(/[^a-zA-Z0-9_-]/g, "_");
        const sessionFilePath = path.resolve(process.cwd(), ".xyavoryx-sessions", `${safeSessionName}.json`);

        if (!fs.existsSync(sessionFilePath)) {
          console.log(`\n${colors.fgRed}[ERROR] Session file not found: ${colors.fgCyan}${sessionFilePath}${colors.reset}`);
          continue;
        }

        try {
          const loadedData = JSON.parse(fs.readFileSync(sessionFilePath, "utf8"));
          
          const stateDir = path.resolve(process.cwd(), ".xyavoryx-memory");
          if (!fs.existsSync(stateDir)) {
            fs.mkdirSync(stateDir, { recursive: true });
          }
          fs.writeFileSync(path.resolve(stateDir, "state.json"), JSON.stringify(loadedData.storeState, null, 2), "utf8");
          
          memoryStore = new FileMemoryStore({
            baseDir: stateDir
          });
          runtime = createRuntime(memoryStore, llmProvider);
          
          sessionId = loadedData.sessionId;
          caseIds.length = 0;
          caseIds.push(...loadedData.caseIds);
          
          console.log(`\n${colors.fgGreen}[SUCCESS] Session successfully loaded from: ${colors.fgCyan}${sessionFilePath}${colors.reset}`);
          console.log(`  Session ID: ${colors.fgCyan}${sessionId}${colors.reset}`);
          console.log(`  Cases loaded: ${colors.fgWhite}${caseIds.length}${colors.reset}`);
        } catch (err) {
          console.log(`\n${colors.fgRed}[ERROR] Failed to load session: ${err instanceof Error ? err.message : String(err)}${colors.reset}`);
        }
        continue;
      }

      if (command === "/export") {
        const findings: any[] = [];
        for (const cid of caseIds) {
          const caseFindings = await memoryStore.getFindings(cid);
          findings.push(...caseFindings);
        }

        const toolHistory: any[] = [];
        for (const cid of caseIds) {
          const caseHistory = await memoryStore.getExecutionHistory(cid);
          toolHistory.push(...caseHistory);
        }

        const reportName = `xyavoryx-report-${sessionId}.md`;
        const reportPath = path.resolve(process.cwd(), reportName);

        let md = `# XyaVoryx Security Investigation Report\n\n`;
        md += `## Session Details\n`;
        md += `- **Session ID:** \`${sessionId}\`\n`;
        md += `- **LLM Provider:** ${providerName}\n`;
        md += `- **Generated At:** ${new Date().toISOString()}\n`;
        md += `- **Total Cases Investigated:** ${caseIds.length}\n\n`;

        md += `## Executive Summary\n`;
        md += `During this active investigation session, a total of **${findings.length}** security findings were identified.\n\n`;

        md += `## [FINDINGS] Security Findings\n\n`;
        if (findings.length === 0) {
          md += `_No security findings were generated during this session._\n\n`;
        } else {
          for (const f of findings) {
            md += `### [${f.severity.toUpperCase()}] ${f.title}\n`;
            md += `- **Source Tool:** \`${f.sourceTool ?? "unknown"}\`\n`;
            md += `- **Description:** ${f.description}\n`;
            if (f.evidence) {
              md += `- **Evidence:** \`${f.evidence}\`\n`;
            }
            if (f.cwe || f.owasp) {
              md += `- **Classifications:**\n`;
              if (f.cwe) md += `  - CWE: ${f.cwe}\n`;
              if (f.owasp) md += `  - OWASP: ${f.owasp}\n`;
            }
            md += `\n`;
          }
        }

        md += `## [TIMELINE] Tool Execution History\n\n`;
        if (toolHistory.length === 0) {
          md += `_No tools were executed during this session._\n\n`;
        } else {
          md += `| Tool Name | Status | Duration | Evidence / Input |\n`;
          md += `| :--- | :--- | :--- | :--- |\n`;
          for (const r of toolHistory) {
            md += `| \`${r.tool}\` | **${r.status.toUpperCase()}** | ${r.durationMs}ms | \`${JSON.stringify(r.input).substring(0, 80)}\` |\n`;
          }
          md += `\n`;
        }

        fs.writeFileSync(reportPath, md, "utf8");
        console.log(`\n${colors.fgGreen}[SUCCESS] Professional Security Report successfully exported to: ${colors.fgCyan}${reportPath}${colors.reset}`);
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

      console.log(`${colors.fgRed}[WARNING] Unknown slash command: ${colors.bright}${task}${colors.reset}`);
      console.log(`Type ${colors.fgCyan}/help${colors.reset} to see all available commands.`);
      continue;
    }

    // Append to Persistent History
    appendToHistory(task);

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
      console.log(`\n${colors.fgGreen}${colors.bright}[REPORT] Final Security Report${colors.reset}`);
      console.log(result.report);
    }
  }
}

main().catch((error) => {
  console.error(`${colors.fgRed}Fatal error running XyaVoryx CLI:${colors.reset}`, error);
  process.exit(1);
});
