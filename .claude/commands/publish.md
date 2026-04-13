Publish the npm package "$ARGUMENTS" from this monorepo.

## Package paths

- `core` → `packages/core`
- `adapter-sqlite` → `packages/adapter-sqlite`
- `adapter-mongo` → `packages/adapter-mongo`
- `cli` → `packages/cli`

## Steps

1. Run `npm test` in the package directory. Wait for all tests to pass before continuing.

2. Bump version without creating a git tag:
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

6. Report: published version, npm URL (`https://www.npmjs.com/package/@the-brain/<name>`), confirm tag pushed (GitHub Action will create the Release automatically).

## Rules

- Never run `npm run build` manually — `prepublishOnly` handles it.
- Always use `--no-git-tag-version` — tags must follow the `<name>-v<version>` format.
- If no package is specified, ask before doing anything.
