# Copilot Instructions — version-builder-action

## Project Overview

A **GitHub Action** (Node 24, TypeScript) that generates or modifies semantic version numbers based on the current branch name, GitHub run number, and configuration flags. It is distributed as a single bundled `dist/index.js` file committed to the repository.

## Tech Stack

- **Runtime**: Node.js 24+, pnpm 10
- **Language**: TypeScript 5 (strict mode, ES2022, ESNext modules, `bundler` resolution)
- **Build**: tsdown — bundles all deps into `dist/index.js` (no `node_modules` at runtime)
- **Tests**: Vitest 4 + `@vitest/coverage-v8`
- **Lint**: oxlint
- **Format**: oxfmt

## Key Commands

```sh
pnpm run build          # Compile TypeScript → dist/index.js
pnpm run test           # Run unit tests (single pass)
pnpm run test:watch     # Run tests in watch mode
pnpm run ci-test        # Run tests with v8 coverage (CI)
pnpm run lint           # Lint src/ and __tests__/
pnpm run format:write   # Auto-format with oxfmt
pnpm run all            # format → lint → test → build (full pre-push pipeline)
```

## Architecture

```
src/index.ts    — Action entry point; wraps run() with try/catch + core.setFailed()
src/main.ts     — Core logic: reads version input (or package.json), builds semver with preid
src/utils.ts    — Shared helpers: coerceArray(), isPrerelease()
__tests__/      — Vitest tests (parametrized datasets)
action.yml      — Action metadata: inputs, outputs, Node 24 runtime → dist/index.js
dist/index.js   — Compiled bundle (MUST be committed; referenced by action.yml)
```

## Conventions

- **Imports**: Named imports (`import { readFile } from "fs/promises"`); namespace imports for `@actions/*` (`import * as core from "@actions/core"`)
- **Types**: No `any`; use strict interfaces; prefer inline object types for small shapes
- **Tests**: Parametrized with a typed dataset array `{ name, input, expected }[]`, iterate with `test(\`given ${name}...\`)`; mock env vars via `process.env["INPUT_*"]`
- **No floating promises**: wrap top-level async calls; the `run()` in `index.ts` uses `// eslint-disable-line` for the action runtime

## Critical Notes

1. **`dist/index.js` must be committed** — GitHub Actions executes it directly; it is not installed from npm.
2. **All dependencies are bundled** — `tsdown.config.ts` uses `alwaysBundle: [/.*/]`; do not add runtime `require()` of external packages without verifying bundling.
3. **Node 24 only** — `action.yml` declares `using: node24`; do not downgrade.
4. **Default preid branches** — `["main", "master", "develop"]` if `preid-branches` input is omitted (see `src/main.ts`).
5. **After any logic change, run `pnpm run all`** to ensure format, lint, tests, and build all pass before committing.
