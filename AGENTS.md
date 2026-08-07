# Repository Guidelines

## Project Structure & Module Organization

- `src/index.ts` is the bundle entry point; `src/main.ts` handles GitHub Action inputs and outputs, and `src/utils.ts` contains version and Git helpers.
- `__tests__/*.test.ts` contains Vitest tests aligned with the source modules.
- `dist/index.mjs` is the checked-in Node 24 bundle consumed by `action.yml`. Regenerate it from source; do not edit it directly.
- `action.yml` defines the public Action contract. Keep its inputs, outputs, defaults, and README examples synchronized with behavior.
- `.github/workflows/` contains CI and release automation. Root `*.config.ts` files configure TypeScript, Vitest, Oxlint, and tsdown.

## Build, Test, and Development Commands

Use Node 24+, pnpm 11, and `pnpm install --frozen-lockfile` for a reproducible install.

- `pnpm test` runs the Vitest suite once; `pnpm test:watch` reruns tests during development.
- `pnpm run ci-test` runs tests with V8 coverage and writes `coverage/`.
- `pnpm run lint` checks `src/` and `__tests__/` with type-aware Oxlint rules.
- `pnpm run fmt:check` verifies formatting; `pnpm run fmt` rewrites supported files with Oxfmt.
- `pnpm run build` bundles `src/index.ts` into `dist/index.mjs`; `pnpm run build:watch` rebuilds continuously.
- `pnpm run all` formats, lints, tests, and builds. Review formatting changes before committing.

## Coding Style & Naming Conventions

Write strict TypeScript and ESM. Use tabs in TypeScript, two spaces in Markdown/JSON/YAML, double quotes, semicolons, trailing commas, and LF endings. Prefer `const`, immutable data, optional chaining, nullish coalescing, explicit type-only imports, and derived types over duplicated interfaces. Use `camelCase` for functions and variables, `PascalCase` for types, and descriptive kebab-case Action input names. Keep TSDoc short, behavior-focused, and example-first.

## Testing Guidelines

Add tests under `__tests__/` using `*.test.ts`. Prefer table-driven `test.each` cases and test observable module behavior, including branch, prerelease, Git-command failure, and boundary scenarios. No numeric coverage threshold is configured, but new behavior should be covered. Run `pnpm run ci-test` before opening a PR.

## Commit & Pull Request Guidelines

Follow `<type>(<scope>): <imperative description>`, for example `fix(version): handle empty prerelease input`. Common types are `feat`, `fix`, `refactor`, `chore`, `docs`, and `ci`; use lowercase scopes and no trailing period. Do not add GitHub's `(#123)` suffix manually.

PRs should explain behavior changes, link relevant issues, and call out modified inputs or outputs. Include tests and documentation where applicable. Before submission, run `pnpm run fmt:check`, `pnpm run lint`, `pnpm run ci-test`, and `pnpm run build`, then commit any resulting `dist/` update. Screenshots are unnecessary unless workflow or Marketplace presentation changes.
