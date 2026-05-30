# XyaVoryx

**Personal AI Security Agent Framework** — deterministic, policy-first, and auditable.

XyaVoryx helps you run AI-powered security investigation pipelines with predictable execution, explicit policy enforcement, and full execution traces.

## Getting Started

### Quick Start (No Cloning Required)

You can run the **XyaVoryx Interactive CLI Shell** instantly using `npx` without cloning this repository:

```bash
npx @xyavoryx/cli
```

Or install it globally to use the `xyavoryx` command from any directory:

```bash
npm install -g @xyavoryx/cli
xyavoryx
```

### Development Setup (Cloning the Repository)

If you wish to contribute, build custom agents, or modify the core engine, follow these steps to set up the development environment.

#### Prerequisites

- [Node.js](https://nodejs.org/) 20 or later
- [Corepack](https://nodejs.org/api/corepack.html) enabled (ships with Node.js)

#### 1. Clone and Install

```bash
git clone https://github.com/XyaVora/XyaVoryx.git
cd XyaVoryx
corepack enable
corepack pnpm install
```

### 2. Run Setup Wizard

The interactive setup wizard will guide you through configuring your AI provider API keys and building the workspace:

```bash
npm run setup
```

The wizard will prompt you for:

| Provider | Key | Where to get it |
|----------|-----|-----------------|
| **Anthropic (Claude)** | `ANTHROPIC_API_KEY` | [console.anthropic.com](https://console.anthropic.com/) |
| **Google Gemini** | `GEMINI_API_KEY` | [aistudio.google.com](https://aistudio.google.com/apikey) |
| **OpenAI (ChatGPT)** | `OPENAI_API_KEY` | [platform.openai.com](https://platform.openai.com/api-keys) |

You can skip any provider you don't have. Keys are stored locally in a `.env` file (git-ignored).

### 3. Launch the CLI Shell

```bash
npm run cli
```

This opens the **XyaVoryx Interactive Shell** — a premium terminal REPL where you can run security investigations powered by your configured AI providers.

#### Shell Commands

| Command | Description |
|---------|-------------|
| `/help` | Show all available commands and agent capabilities |
| `/findings` | Display security findings from the current session |
| `/history` | View chronological tool execution timeline |
| `/session` | Check active LLM provider, model, and memory store |
| `/clear` | Clear the terminal with a fresh logo |
| `/exit` | Exit the shell gracefully |

Type any investigation task in natural language, and the agent will autonomously plan and execute the appropriate security tools.

## Supported AI Providers

XyaVoryx supports multiple LLM providers out of the box. Configure one or more:

- **Anthropic** — Claude 3.5 Sonnet, Claude 4 Opus, and newer models
- **Google Gemini** — Gemini 2.0 Flash, Gemini 2.5 Pro, and newer models
- **OpenAI** — GPT-4o, ChatGPT o3, GPT-5.5, and newer models

The agent will use whichever provider you configure. If multiple are set, you can switch between them in the CLI shell.

## What Can It Do?

**Example tasks you can run in the CLI:**

```
> Analyze this email header for phishing indicators: From: admin@secure-contoso.com ...
> Extract IOCs from this threat report: https://example.com/report.txt
> Parse this stack trace and identify the root cause: Error at line 42 ...
> Investigate if README.md contains any sensitive patterns
```

**Built-in Security Tools:**

| Tool | Purpose |
|------|---------|
| `email.header.analyzer` | Detect spoofing, SPF/DKIM/DMARC failures, and header anomalies |
| `ioc.extractor` | Extract IPs, domains, URLs, and email addresses from text |
| `stacktrace.parser` | Parse and normalize stack traces for root cause analysis |
| `test.output.parser` | Parse test runner output for failure patterns |

## Architecture

```
Agent Input → Planner → Policy Check → Tool Execution → Events/Trace → Report
```

**Two execution modes:**

- **Deterministic** — predefined workflow steps, no LLM dependency, fully reproducible
- **Autonomous** — LLM-driven planning with the `AutonomousPlanner`, iterates until the investigation is complete

**Key design principles:**

- Policy checks before every tool execution
- Complete event and trace records for auditability
- Pluggable memory backends (in-memory or file-based persistence)
- CI-friendly replay and evaluation gates

## Project Structure

```text
XyaVoryx/
├── packages/
│   ├── core/          # Type definitions and interfaces
│   ├── runtime/       # Agent runner, planners, policy engine
│   ├── memory/        # In-memory and file-based storage
│   ├── providers/     # LLM provider integrations
│   ├── tools/         # Built-in security analysis tools
│   └── sdk/           # High-level SDK for building agents
├── examples/
│   ├── phishing-agent/    # Email phishing investigation agent
│   └── bugbot-agent/      # PR security review agent
├── scripts/           # CLI shell, setup wizard, build tools
└── tests/             # End-to-end and unit test suites
```

## Run Examples

```bash
# Run the phishing investigation agent
corepack pnpm --filter phishing-agent start

# Run the PR security review agent
corepack pnpm --filter bugbot-agent start
```

## Development

```bash
# Build all packages
corepack pnpm -r build

# Run all tests
corepack pnpm -r test

# Run evaluation baseline
corepack pnpm eval:baseline

# Run replay consistency checks
corepack pnpm eval:replay
```

## Quality and Governance

Every pull request is automatically checked by:

- **CI Foundation** — build, test, and evaluation gates
- **Bugbot Review** — deterministic security pattern scanning
- **Evaluation Trend** — regression detection across evaluation suites
- **Windows Sanity** — cross-platform compatibility

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for development guidelines and commit conventions.

## License

MIT. See [LICENSE](./LICENSE).
