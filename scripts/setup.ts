import * as fs from "node:fs";
import * as path from "node:path";
import * as readline from "node:readline";
import { spawnSync } from "node:child_process";

// ANSI escape codes for beautiful styling
const colors = {
  reset: "\x1b[0m",
  bright: "\x1b[1m",
  dim: "\x1b[2m",
  fgRed: "\x1b[31m",
  fgGreen: "\x1b[32m",
  fgYellow: "\x1b[33m",
  fgBlue: "\x1b[34m",
  fgMagenta: "\x1b[35m",
  fgCyan: "\x1b[36m",
  fgGray: "\x1b[90m"
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
  console.clear();
  console.log(`${colors.fgCyan}${colors.bright}`);
  console.log("██╗  ██╗██╗   ██╗ █████╗ ██╗   ██╗ ██████╗ ██████╗ ██╗   ██╗██╗  ██╗");
  console.log("╚██╗██╔╝╚██╗ ██╔╝██╔══██╗██║   ██║██╔═══██╗██╔══██╗╚██╗ ██╔╝╚██╗██╔╝");
  console.log(" ╚███╔╝  ╚████╔╝ ███████║██║   ██║██║   ██║██████╔╝ ╚████╔╝  ╚███╔╝ ");
  console.log(" ██╔██╗   ╚██╔╝  ██╔══██║╚██╗ ██╔╝██║   ██║██╔══██╗  ╚██╔╝   ██╔██╗ ");
  console.log("██╔╝ ██╗   ██║   ██║  ██║ ╚████╔╝ ╚██████╔╝██║  ██║   ██║   ██╔╝ ██╗");
  console.log("╚═╝  ╚═╝   ╚═╝   ╚═╝  ╚═╝  ╚═══╝   ╚═════╝ ╚═╝  ╚═╝   ╚═╝  ╚═╝  ╚═╝");
  console.log(`                 X Y A V O R Y X   S E T U P   W I Z A R D${colors.reset}\n`);

  console.log(`${colors.fgGray}Configure your personal AI Security Agent environment in seconds.${colors.reset}\n`);

  // 1. Read existing .env variables if present
  const envPath = path.resolve(process.cwd(), ".env");
  const existingVars: Record<string, string> = {};

  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) {
        continue;
      }
      const match = trimmed.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
      if (match) {
        let val = match[2] || "";
        if (val.startsWith('"') && val.endsWith('"')) {
          val = val.slice(1, -1);
        } else if (val.startsWith("'") && val.endsWith("'")) {
          val = val.slice(1, -1);
        }
        existingVars[match[1]] = val;
      }
    }
  }

  // 2. Prompt for API keys
  console.log(`${colors.bright}🔐 Step 1: Configure API Credentials${colors.reset}`);
  console.log(`${colors.fgGray}Press Enter to skip or keep the existing value in brackets [].${colors.reset}\n`);

  const prevAnthropic = existingVars["ANTHROPIC_API_KEY"] || "";
  const prevGemini = existingVars["GEMINI_API_KEY"] || "";
  const prevOpenai = existingVars["OPENAI_API_KEY"] || "";

  const displayAnthropic = prevAnthropic ? ` [${prevAnthropic.substring(0, 8)}...${prevAnthropic.slice(-4)}]` : "";
  const anthropicInput = await askQuestion(`${colors.fgCyan}👉 Enter Anthropic API Key (Claude)${displayAnthropic}: ${colors.reset}`);
  const anthropicKey = anthropicInput || prevAnthropic;

  const displayGemini = prevGemini ? ` [${prevGemini.substring(0, 8)}...${prevGemini.slice(-4)}]` : "";
  const geminiInput = await askQuestion(`${colors.fgCyan}👉 Enter Google Gemini API Key${displayGemini}: ${colors.reset}`);
  const geminiKey = geminiInput || prevGemini;

  const displayOpenai = prevOpenai ? ` [${prevOpenai.substring(0, 8)}...${prevOpenai.slice(-4)}]` : "";
  const openaiInput = await askQuestion(`${colors.fgCyan}👉 Enter OpenAI API Key (ChatGPT)${displayOpenai}: ${colors.reset}`);
  const openaiKey = openaiInput || prevOpenai;

  // 3. Write variables to .env
  const updatedVars: Record<string, string> = { ...existingVars };
  if (anthropicKey) updatedVars["ANTHROPIC_API_KEY"] = anthropicKey;
  if (geminiKey) updatedVars["GEMINI_API_KEY"] = geminiKey;
  if (openaiKey) updatedVars["OPENAI_API_KEY"] = openaiKey;

  const envLines: string[] = ["# XyaVoryx Personal Agent Environment Variables"];
  for (const [k, v] of Object.entries(updatedVars)) {
    envLines.push(`${k}=${v}`);
  }
  fs.writeFileSync(envPath, envLines.join("\n") + "\n", "utf8");

  console.log(`\n${colors.fgGreen}✅ API keys successfully saved to .env file.${colors.reset}\n`);

  // 4. Build Workspace
  console.log(`${colors.bright}🛠️  Step 2: Build Workspace Packages${colors.reset}`);
  console.log(`${colors.fgGray}Compiling TypeScript workspace configurations...${colors.reset}`);

  const buildResult = spawnSync("npx", ["pnpm", "build"], {
    shell: true,
    encoding: "utf8"
  });

  if (buildResult.status === 0) {
    console.log(`${colors.fgGreen}✅ Workspace built successfully.${colors.reset}\n`);
  } else {
    console.log(`${colors.fgRed}⚠️  Workspace build encountered an issue, but setup completed.${colors.reset}`);
    console.log(buildResult.stderr || buildResult.stdout);
  }

  // 5. Success
  console.log(`${colors.bright}🎉 Setup Complete! You are ready to start.${colors.reset}`);
  console.log(`${colors.fgGray}================================================================================${colors.reset}`);
  console.log(`To launch the premium interactive XyaVoryx CLI shell, run:`);
  console.log(`  ${colors.fgGreen}npm run cli${colors.reset}  or  ${colors.fgGreen}npx tsx scripts/xyavoryx-cli.ts${colors.reset}`);
  console.log(`\nAvailable Interactive Commands inside the shell:`);
  console.log(`  ${colors.fgCyan}/help${colors.reset}       - Show command guides`);
  console.log(`  ${colors.fgCyan}/findings${colors.reset}   - Print active security findings`);
  console.log(`  ${colors.fgCyan}/history${colors.reset}    - Trace tool execution timelines`);
  console.log(`  ${colors.fgCyan}/session${colors.reset}    - Check active LLM models`);
  console.log(`${colors.fgGray}================================================================================${colors.reset}\n`);
}

main().catch((err) => {
  console.error(`${colors.fgRed}Setup failed:${colors.reset}`, err);
  process.exit(1);
});
