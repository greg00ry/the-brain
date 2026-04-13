---
name: test
description: Run tests for a specific package or all packages in the monorepo.
disable-model-invocation: true
argument-hint: [core|adapter-sqlite|adapter-mongo|cli|all]
allowed-tools: Bash
---

Run tests for $ARGUMENTS.

## Package paths

- `core` → `packages/core`
- `adapter-sqlite` → `packages/adapter-sqlite`
- `adapter-mongo` → `packages/adapter-mongo`
- `cli` → `packages/cli`
- `all` or no argument → repo root (runs all packages)

## Steps

1. `cd` into the correct directory.
2. Run `npm test`.
3. Report: how many tests passed, how many failed, total duration.
4. If any tests fail, show the failing test names and error messages — do not just say "tests failed".

## Rules

- Do not fix failing tests unless the user explicitly asks.
- Do not run `npm run build` before tests — vitest handles TypeScript directly.
