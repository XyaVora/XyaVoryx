# Contributing

Thank you for contributing to XyaVoryx.

## Commit Convention

XyaVoryx follows Conventional Commits.

Commit message format:

```text
type(scope): message
```

Allowed `type` values:

- `feat`
- `fix`
- `docs`
- `test`
- `refactor`
- `chore`
- `build`
- `ci`
- `perf`
- `security`

Examples:

- `feat(runtime): complete deterministic Phase 1 foundation`
- `fix(policy): enforce denied tool precedence`
- `docs(readme): improve quickstart instructions`
- `test(runtime): add execution trace coverage`
- `refactor(core): simplify workflow interfaces`
- `ci(workflows): add pnpm test pipeline`

## Branch Protection Baseline

Public and private repositories should enforce PR-only merge to `main` with required status checks.

Required checks:

- `ci-foundation`
- `bugbot-review`
- `evaluation-trend`
- `windows-sanity`

For release-related pull requests, also require:

- `release-preflight`
