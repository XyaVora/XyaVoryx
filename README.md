# XyaVoryx

XyaVoryx is a deterministic AI agent framework for engineering and security workflows.

It helps teams run agent-driven pipelines with predictable execution, explicit policy enforcement, and auditable traces.

## Why XyaVoryx

Most agent frameworks optimize for open-ended autonomy. XyaVoryx prioritizes operational control:

- deterministic execution order
- policy checks before every tool run
- event and trace records for every run
- CI-friendly replay and evaluation gates

This makes it practical for production workflows where reliability and reviewability matter.

## Core Capabilities

- Deterministic runtime orchestration
  - `AgentRunner`
  - `DeterministicPlanner`
  - `ToolExecutor`
- Policy-first execution model
  - allow/deny controls
  - scoped policy behavior
- Structured observability
  - event emission
  - execution trace recording
- Built-in deterministic tools
  - `email.header.analyzer`
  - `ioc.extractor`
  - `stacktrace.parser`
  - `test.output.parser`
- Evaluation pipeline
  - baseline suites
  - replay consistency checks
  - trend reporting in pull requests

## Architecture

Execution flow:

`Agent Input -> Planner -> Policy Check -> Tool Execution -> Events/Trace -> Report`

Design constraints:

- workflow steps are predefined and deterministic
- no mandatory cloud dependency for baseline execution
- no dynamic LLM planning/tool selection in baseline runtime

## Quickstart

Requirements:

- Node.js 20+
- pnpm via Corepack

```bash
corepack pnpm install
corepack pnpm -r build
corepack pnpm -r test
```

Run examples:

```bash
corepack pnpm --filter phishing-agent start
corepack pnpm --filter bugbot-agent start
```

## Project Structure

```text
packages/
  core/
  runtime/
  memory/
  providers/
  tools/
  sdk/
examples/
scripts/
tests/
```

## Quality and Governance

- PR checks: CI foundation, bugbot review, AI advisory review, evaluation trend, Windows sanity
- release flow: preflight validation, artifact checksums, provenance attestation
- contribution standard: Conventional Commits and CODEOWNERS-based review routing

## Roadmap

Current focus:

- improve AI reviewer precision and reduce false positives
- expand deterministic tool coverage
- strengthen release governance and public package ergonomics

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for contribution and commit conventions.

## License

MIT. See [LICENSE](./LICENSE).
