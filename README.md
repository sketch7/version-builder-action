# Version Builder

A GitHub Action that generates a semantic version number based on an input
version (or `package.json`), the current branch, and the GitHub run number.
It appends a preid suffix (e.g. `dev.123`) on designated branches and emits
both semver and non-semver variants as outputs.

## How It Works

- If the `version` input is not provided, the action reads `version` from the
  repository's `package.json`.
- The branch is checked against the following rules **in order**:
  1. `force-stable: true` → always stable, regardless of branch.
  2. `force-preid: true` → always pre-release, uses the mapped preid for the branch or falls back to `preid`.
  3. Exact match in `preid-branches` → pre-release with the mapped preid (e.g. `main` → `rc`, `develop` → `dev`).
  4. Matches a `stable-branches` regex pattern (e.g. `v1`, `1.x`) → stable.
  5. **All other branches** → pre-release with the default `preid` (e.g. `feature/foo` → `dev`).
- When pre-release, the run number is appended: `1.5.6` → `1.5.6-dev.123`
- When stable, the version is emitted unchanged: `1.5.6`

## Inputs

| Input                 | Required | Default                         | Description                                                                                                                                                            |
| --------------------- | -------- | ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `version`             | No       | _(reads `package.json`)_        | Base version to use (e.g. `1.5.6`).                                                                                                                                    |
| `preid`               | No       | `dev`                           | Default prerelease identifier used when no branch-specific mapping is defined.                                                                                         |
| `preid-branches`      | No       | `main:rc,master:rc,develop:dev` | Comma-separated list of branches (with optional `branch:preid` mapping) that trigger preid versioning. Plain name uses the global `preid`.                             |
| `stable-branches`     | No       | `^v\d+$,^\d+\.x$`               | Comma-separated regex patterns for branches that are always stable (e.g. `v1`, `2.x`). Any branch not in `preid-branches` and not matching here falls back to `preid`. |
| `preid-num-delimiter` | No       | `.`                             | Delimiter between the preid and the run number (e.g. `dev.123` or `dev-123`).                                                                                          |
| `force-preid`         | No       | `false`                         | Forces preid versioning regardless of the current branch.                                                                                                              |
| `force-stable`        | No       | `false`                         | Forces stable versioning regardless of the current branch.                                                                                                             |

## Outputs

| Output             | Example         | Description                                                                 |
| ------------------ | --------------- | --------------------------------------------------------------------------- |
| `version`          | `1.5.6-dev.123` | Full semver with preid, or plain version when stable.                       |
| `nonSemverVersion` | `1.5.6.123`     | Version with run number but without preid label; plain version when stable. |
| `majorVersion`     | `1`             | Major version segment.                                                      |
| `minorVersion`     | `5`             | Minor version segment.                                                      |
| `patchVersion`     | `6`             | Patch version segment.                                                      |
| `preid`            | `dev`           | The preid string when pre-release, otherwise an empty string.               |
| `isPrerelease`     | `true`          | Whether the generated version is a prerelease.                              |

## Branch Behavior (defaults)

| Branch            | Result                         |
| ----------------- | ------------------------------ |
| `main`            | `1.5.6-rc.123` (explicit map)  |
| `master`          | `1.5.6-rc.123` (explicit map)  |
| `develop`         | `1.5.6-dev.123` (explicit map) |
| `feature/my-feat` | `1.5.6-dev.123` (fallback)     |
| `workflow`        | `1.5.6-dev.123` (fallback)     |
| `v1`, `v2`        | `1.5.6` (stable pattern)       |
| `1.x`, `12.x`     | `1.5.6` (stable pattern)       |

## Usage

```yaml
steps:
  - name: Checkout
    uses: actions/checkout@v4

  - name: Build version
    id: version
    uses: sketch7/version-builder-action@v1
    with:
      version: "1.5.6" # optional — omit to read from package.json
      preid: "dev" # optional, default fallback preid
      preid-branches: "main:rc,master:rc,develop:dev,vnext:next" # optional
      stable-branches: "^v\\d+$,^\\d+\\.x$" # optional

  - name: Use outputs
    run: |
      echo "Version:          ${{ steps.version.outputs.version }}"
      echo "Non-semver:       ${{ steps.version.outputs.nonSemverVersion }}"
      echo "Preid:            ${{ steps.version.outputs.preid }}"
      echo "Is pre-release:   ${{ steps.version.outputs.isPrerelease }}"
```

### Force stable on a preid branch

```yaml
- name: Build version (stable)
  uses: sketch7/version-builder-action@v1
  with:
    force-stable: "true"
```

### Force preid on any branch

```yaml
- name: Build version (always preid)
  uses: sketch7/version-builder-action@v1
  with:
    force-preid: "true"
    preid: "rc"
```

### Custom stable branch patterns

```yaml
- name: Build version
  uses: sketch7/version-builder-action@v1
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
