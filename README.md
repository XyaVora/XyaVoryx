# XyaVoryx

[![GitHub Release](https://img.shields.io/github/v/release/XyaVora/XyaVoryx)](https://github.com/XyaVora/XyaVoryx/releases)
[![License](https://img.shields.io/github/license/XyaVora/XyaVoryx)](./LICENSE)
[![CI](https://img.shields.io/github/actions/workflow/status/XyaVora/XyaVoryx/windows-sanity.yml?branch=main&label=ci)](https://github.com/XyaVora/XyaVoryx/actions)

Deterministic AI agent runtime for security and engineering workflows.

XyaVoryx is built for teams that need reproducible execution, explicit policy gates, and auditable traces instead of autonomous, opaque agent behavior.

## Three Lines

- What it is: A deterministic runtime and SDK for controlled AI agent workflows.
- Pain it solves: Converts ad hoc agent runs into repeatable, policy-enforced execution with trace evidence.
- Use in 30 seconds: install dependencies, run an example agent, inspect events and traces.

## Core Principles

- Deterministic by default.
- Policy check before every tool call.
- Structured event stream and trace log for replay.
- Local-first operation without mandatory cloud dependencies.

## Choose Your Path

| Path | Who it is for | Command |
| --- | --- | --- |
| Quick Start | Use built-in agents and runtime as-is | `corepack pnpm --filter phishing-agent start` |
| Build from Source | Extend runtime, tools, or SDK | `corepack pnpm build` |

## Prerequisites

- Node.js 20+
- pnpm via Corepack

## Quick Start

Install and validate:

```bash
corepack pnpm install
corepack pnpm build
corepack pnpm test
```

Run built-in examples:

```bash
corepack pnpm --filter phishing-agent start
corepack pnpm --filter bugbot-agent start
```

Run evaluation gates:

```bash
corepack pnpm eval:baseline
corepack pnpm eval:replay
corepack pnpm eval:snapshot
corepack pnpm eval:trend -- --base <base.json> --head <head.json>
```

## Runtime Architecture

Execution flow:

`input -> deterministic planner -> policy engine -> tool executor -> event bus -> trace recorder -> output`

Main runtime components:

- `XyaVoryx`
- `AgentRunner`
- `DeterministicPlanner`
- `PolicyEngine`
- `ToolRegistry`
- `ProviderRegistry`
- `ToolExecutor`
- `EventBus`
- `TraceRecorder`
- `InMemoryStore` (default), `FileMemoryStore` (optional)

## Built-in Tools

- `email.header.analyzer`
- `ioc.extractor`
- `stacktrace.parser`
- `test.output.parser`

All built-in tools use schema validation and deterministic execution semantics.

## What XyaVoryx Does and Does Not Do

Does:

- Run deterministic workflows with tool-level policy enforcement.
- Emit structured runtime events and execution traces.
- Support replay-style evaluation for regression checks.

Does not:

- Act as a chatbot wrapper.
- Use free-form autonomous runtime planning in baseline mode.
- Require API keys for local deterministic examples.

## Security Posture

- Deterministic non-autonomous baseline.
- Explicit allow/deny controls in runtime policy engine.
- No mandatory cloud dependency for core execution.
- Public mirror is exported from private source-of-truth via a controlled release pipeline.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for development workflow and commit convention.
