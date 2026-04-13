---
name: publish
description: Publish an npm package from this monorepo — bump version, build, publish, commit, push.
disable-model-invocation: true
argument-hint: [core|adapter-sqlite|adapter-mongo|cli]
allowed-tools: Bash, Read, Edit
---

Publish the package specified in $ARGUMENTS (e.g. `core`, `adapter-sqlite`, `adapter-mongo`, `cli`).

## Steps

1. Resolve the package path:
   - `core` → `packages/core`
   - `adapter-sqlite` → `packages/adapter-sqlite`
   - `adapter-mongo` → `packages/adapter-mongo`
   - `cli` → `packages/cli`

2. Run `npm version patch` in that directory. This bumps package.json.

3. Run `npm publish` — `prepublishOnly` script runs `npm run build` automatically, so do NOT run build separately.

4. In the repo root, commit the version bump:
   ```
   git add packages/<name>/package.json
   git commit -m "chore(<name>): bump to <new-version>"
   ```

5. Run `git push`.

6. Report the published version and npm URL: `https://www.npmjs.com/package/@the-brain/<name>`

## Rules

- Never run `npm run build` manually before publish — `prepublishOnly` does it.
- Never publish without running tests first. If tests haven't been run this session, run `npm test` in the package directory first and wait for them to pass.
- If no package is specified in $ARGUMENTS, ask which one before doing anything.
