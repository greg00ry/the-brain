---
name: publish
description: Publish an npm package from this monorepo — bump version, build, publish, tag, push, trigger GitHub Release.
disable-model-invocation: true
argument-hint: [core|adapter-sqlite|adapter-mongo|cli]
allowed-tools: Bash, Read
---

Publish the package specified in $ARGUMENTS (e.g. `core`, `adapter-sqlite`, `adapter-mongo`, `cli`).

## Package paths

- `core` → `packages/core`
- `adapter-sqlite` → `packages/adapter-sqlite`
- `adapter-mongo` → `packages/adapter-mongo`
- `cli` → `packages/cli`

## Steps

1. Run tests first. If tests haven't passed this session, run `npm test` in the package directory and wait for them to pass before continuing.

2. In the package directory, bump version without creating a git tag:
   ```bash
   npm version patch --no-git-tag-version
   ```
   Read the new version from package.json after this step.

3. Publish to npm (`prepublishOnly` runs `npm run build` automatically):
   ```bash
   npm publish
   ```

4. In the repo root, commit the version bump:
   ```bash
   git add packages/<name>/package.json
   git commit -m "chore(<name>): bump to <version>"
   ```

5. Create a scoped git tag and push everything:
   ```bash
   git tag <name>-v<version>
   git push
   git push origin <name>-v<version>
   ```
   Example: `git tag core-v0.2.23` then `git push origin core-v0.2.23`

6. Report: published version, npm URL (`https://www.npmjs.com/package/@the-brain/<name>`), and confirm the tag was pushed (GitHub Action will create the Release automatically).

## Rules

- Never run `npm run build` manually — `prepublishOnly` handles it.
- Never use `npm version patch` without `--no-git-tag-version` — tags must follow the `<name>-v<version>` format.
- If no package is specified in $ARGUMENTS, ask before doing anything.
