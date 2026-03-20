# Version Builder

A GitHub Action that generates a semantic version number based on an input
version (or `package.json`), the current branch, and the number of commits
since `package.json` last changed.
It appends a preid suffix (e.g. `dev.5`) on designated branches and emits
both semver and non-semver variants as outputs.

## How It Works

- If the `version` input is not provided, the action reads `version` from the
  repository's `package.json`.
- Any existing pre-release suffix on the incoming version is stripped before
  processing (e.g. `1.0.0-rc.0` → base `1.0.0`), so re-running on the same
  base version never produces a double-preid like `1.0.0-rc.0-rc.5`.
- The branch is checked against the following rules **in order**:
  1. `force-stable: true` → always stable, regardless of branch.
  2. `force-preid: true` → always pre-release, uses the mapped preid for the branch or falls back to `preid`.
  3. Exact match in `preid-branches` → pre-release with the mapped preid (e.g. `main` → `rc`, `develop` → `dev`).
  4. Matches a `stable-branches` regex pattern (e.g. `v1`, `1.x`) → stable.
  5. **All other branches** → pre-release with the default `preid` (e.g. `feature/foo` → `dev`).
- When pre-release, the commit count since the last `package.json` change is
  appended: `1.5.6` → `1.5.6-dev.5`. The counter resets to `0` on every
  version bump.
- When stable, the version is emitted unchanged: `1.5.6`
- A `tag` output is always emitted: pre-release builds use the preid label
  (e.g. `rc`, `dev`); stable builds emit `latest` for the highest semver
  branch and `v{major}-lts` for older ones (detected via `git ls-remote`).

## Inputs

| Input                 | Required | Default                                    | Description                                                                                                                                                            |
| --------------------- | -------- | ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `version`             | No       | _(reads `package.json`)_                   | Base version to use (e.g. `1.5.6`). Any existing preid suffix is stripped automatically.                                                                               |
| `preid`               | No       | `dev`                                      | Default prerelease identifier used when no branch-specific mapping is defined.                                                                                         |
| `preid-branches`      | No       | `main:rc,master:rc,develop:dev,vnext:next` | Comma-separated list of branches (with optional `branch:preid` mapping) that trigger preid versioning. Plain name uses the global `preid`.                             |
| `stable-branches`     | No       | `^v\d+$,^\d+\.x$`                          | Comma-separated regex patterns for branches that are always stable (e.g. `v1`, `2.x`). Any branch not in `preid-branches` and not matching here falls back to `preid`. |
| `preid-num-delimiter` | No       | `.`                                        | Delimiter between the preid and the counter (e.g. `dev.5` or `dev-5`).                                                                                                 |
| `force-preid`         | No       | `false`                                    | Forces preid versioning regardless of the current branch.                                                                                                              |
| `force-stable`        | No       | `false`                                    | Forces stable versioning regardless of the current branch.                                                                                                             |

## Outputs

| Output         | Example       | Description                                                                                               |
| -------------- | ------------- | --------------------------------------------------------------------------------------------------------- |
| `version`      | `1.5.6-dev.5` | Full semver with preid, or plain version when stable.                                                     |
| `baseVersion`  | `1.5.6`       | Base version without any pre-release suffix (from the `version` input or `package.json`).                 |
| `fileVersion`  | `1.5.6.5`     | 4-part numeric version for non-semver consumers (e.g. .NET assembly version); plain version when stable.  |
| `majorVersion` | `1`           | Major version segment.                                                                                    |
| `minorVersion` | `5`           | Minor version segment.                                                                                    |
| `patchVersion` | `6`           | Patch version segment.                                                                                    |
| `preid`        | `dev`         | The preid string when pre-release, otherwise an empty string.                                             |
| `preidCounter` | `5`           | The numeric counter appended after the preid (e.g. `5` for `-dev.5`), otherwise an empty string.          |
| `isPrerelease` | `true`        | Whether the generated version is a prerelease.                                                            |
| `tag`          | `latest`      | Dist-tag for the build: preid label when pre-release (e.g. `rc`), `latest` or `v{major}-lts` when stable. |

## Branch Behavior (defaults)

| Branch            | Result                        |
| ----------------- | ----------------------------- |
| `main`            | `1.5.6-rc.5` (explicit map)   |
| `master`          | `1.5.6-rc.5` (explicit map)   |
| `develop`         | `1.5.6-dev.5` (explicit map)  |
| `vnext`           | `1.5.6-next.5` (explicit map) |
| `feature/my-feat` | `1.5.6-dev.5` (fallback)      |
| `workflow`        | `1.5.6-dev.5` (fallback)      |
| `v1`, `v2`        | `1.5.6` (stable pattern)      |
| `1.x`, `12.x`     | `1.5.6` (stable pattern)      |

## Usage

```yaml
steps:
  - name: Checkout
    uses: actions/checkout@v4
    with:
      fetch-depth: 0 # required for accurate commit counting

  - name: Build version
    id: version
    uses: sketch7/version-builder-action@v3
    with:
      version: "1.5.6" # optional — omit to read from package.json
      preid: "dev" # optional, default fallback preid
      preid-branches: "main:rc,master:rc,develop:dev,vnext:next" # optional
      stable-branches: "^v\\d+$,^\\d+\\.x$" # optional

  - name: Use outputs
    run: |
      echo "Version:          ${{ steps.version.outputs.version }}"
      echo "File version:     ${{ steps.version.outputs.fileVersion }}"
      echo "Preid:            ${{ steps.version.outputs.preid }}"
      echo "Preid counter:    ${{ steps.version.outputs.preidCounter }}"
      echo "Tag:              ${{ steps.version.outputs.tag }}"
      echo "Is pre-release:   ${{ steps.version.outputs.isPrerelease }}"
```

### Force stable on a preid branch

```yaml
- name: Build version (stable)
  uses: sketch7/version-builder-action@v3
  with:
    force-stable: "true"
```

### Force preid on any branch

```yaml
- name: Build version (always preid)
  uses: sketch7/version-builder-action@v3
  with:
    force-preid: "true"
    preid: "rc"
```

### Custom stable branch patterns

```yaml
- name: Build version
  uses: sketch7/version-builder-action@v3
  with:
    stable-branches: "^v\\d+$,^\\d+\\.x$,^hotfix/.*$"
```

## Publishing a New Release

Releases are handled entirely by the
[Release workflow](.github/workflows/release.yml) — no local tooling needed.

1. **Bump the version** — update `version` in `package.json`, commit, and push
   to `main`.
1. **Trigger the workflow** — go to **Actions → Release → Run workflow** and
   click **Run**.

The workflow will automatically:

- Read the version from `package.json` on the triggered branch.
- Create the exact semver tag (e.g. `v1.2.3`) and update the floating major
  tag (e.g. `v1`).
- Create the `v1` branch if it doesn't exist yet, or update it for
  minor/patch releases within the same major.
- Publish a GitHub Release with auto-generated release notes.
