## Summary

Short 1-2 sentence summary of the change.

## What changed

- Bullet list of changes

## How to test

1. Copy commands
2. Expected output

## Risk

Low / Medium / High -- note if it touches runtime behavior, policy enforcement, or public API.

## Self-check

Tick only the boxes that apply, but every applicable box must be ticked. Bugbot
uses project rules from `.cursor/BUGBOT.md` and CI workflows in `.github/workflows/`.

- [ ] If this PR changes public API surface (core/runtime/sdk exports or signatures), docs were updated (`README.md`, `docs/`, and/or `SYSTEM_DESIGN.md`) and backward compatibility was reviewed.
- [ ] If this PR adds a new runtime component under `packages/runtime/src`, event/trace determinism was validated and execution ordering remains deterministic.
- [ ] If this PR adds or changes a tool under `packages/tools/src`, input is validated by Zod and tool behavior is deterministic/local-first.
- [ ] If this PR changes workflow execution behavior, policy enforcement still runs before tool execution and blocked behavior is covered by tests.
- [ ] If this PR introduces recovery or branching logic, loop/transition safety is bounded and invalid references are handled deterministically.
- [ ] No new runtime dependencies were added without clear justification in "What changed".
- [ ] Tests were added/updated for new behavior, and full workspace checks pass locally:
  - `corepack pnpm -r build`
  - `corepack pnpm -r test`

## Related

Closes #NN
