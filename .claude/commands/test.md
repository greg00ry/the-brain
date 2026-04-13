Run tests for "$ARGUMENTS" (`core`, `adapter-sqlite`, `adapter-mongo`, `cli`, or `all`).

## Package paths

- `core` → `packages/core`
- `adapter-sqlite` → `packages/adapter-sqlite`
- `adapter-mongo` → `packages/adapter-mongo`
- `cli` → `packages/cli`
- `all` or no argument → repo root

## Steps

1. `cd` into the correct directory and run `npm test`.
2. Report: tests passed, tests failed, total duration.
3. If any tests fail, show the failing test names and error messages.

Do not fix failing tests unless explicitly asked.
