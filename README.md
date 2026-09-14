# Version Builder

A GitHub Action that generates a semantic version number based on an input
version (or `package.json`), the current branch, and a prerelease commit
counter.
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
- `preid-template` formats the resolved preid. It defaults to `{preid}`, so
  existing `main` releases remain `rc`. Use `{preid}-{branch}` to create a
  branch-qualified preview such as `demo-e2e`; `{branch}` is normalized to a
  lowercase, hyphen-separated slug. A branch slug is only required when the
  template uses `{branch}`.
- When pre-release, the counter is appended: `1.5.6` → `1.5.6-dev.5`. By
  default it counts commits since the last `package.json` version change, so it
  resets to `0` on every version bump. Set `counter-base-ref` to count commits
  since that ref's merge base with `HEAD` instead.
- The assembled prerelease suffix must be valid SemVer: dot-separated
  identifiers may contain letters, digits, and hyphens, while a numeric-only
  identifier cannot have a leading zero. For example, `rc.preview.0` and
  `01-0` are valid; `01.0` is not.
- When stable, the version is emitted unchanged: `1.5.6`
- A `tag` output is always emitted: pre-release builds use the formatted preid
  label (e.g. `rc`, `demo-e2e`); stable builds emit `latest` when their major is
  at least every stable major parsed from local tags matching `tag-tmpl`, and
  `v{major}-lts` otherwise. Only complete stable `major.minor.patch` tags
  matching the template participate; malformed and prerelease tags are ignored.
- On stable branches, when `on-version-conflict` is not `ignore` (the
  default), the exact version's local git tag, derived from `tag-tmpl`, is
  checked before it is emitted:
  `fail` stops the action if the tag already exists, `bump-patch`
  auto-increments the patch until a free tag is found. Git tags are the
  source of truth — nothing is committed back to `package.json`.
- Generated exact and floating refs are validated with the same Git ref
  restrictions used by release finalization, including rejecting refs that
  begin with `-`. SemVer numeric components remain decimal text during
  conflict, latest-major, and dist-tag decisions, so adjacent values larger
  than `Number.MAX_SAFE_INTEGER` remain distinct.
- `release-preflight` is opt-in. When enabled, it uses GitHub's live,
  paginated tag, branch, exact-tag, and release state before emitting a
  publishable plan. Its token requires `contents: write` so GitHub includes
  draft releases in the paginated release listing; the action only reads this
  state and never mutates releases. Authentication, authorization, rate-limit,
  transport, and malformed-response failures stop the action without falling
  back to local tags. When disabled (the default), no token is read and
  existing local-tag behavior is unchanged.

## Inputs

| Input                 | Required | Default                                    | Description                                                                                                                                                            |
| --------------------- | -------- | ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `version`             | No       | _(reads `package.json`)_                   | Base version to use (e.g. `1.5.6`). Any existing preid suffix is stripped automatically.                                                                               |
| `package-json-dir`    | No       | _(repo root)_                              | Directory containing `package.json`, for monorepo sub-packages e.g. `apps/client`. Leading/trailing slashes are stripped.                                              |
| `preid`               | No       | `dev`                                      | Default prerelease identifier used when no branch-specific mapping is defined.                                                                                         |
| `preid-template`      | No       | `{preid}`                                  | Template for the resolved prerelease identifier. Supports `{preid}` and `{branch}`; `{branch}` is a normalized branch slug.                                            |
| `preid-branches`      | No       | `main:rc,master:rc,develop:dev,vnext:next` | Comma-separated list of branches (with optional `branch:preid` mapping) that trigger preid versioning. Plain name uses the global `preid`.                             |
| `stable-branches`     | No       | `^v\d+$,^\d+\.x$`                          | Comma-separated regex patterns for branches that are always stable (e.g. `v1`, `2.x`). Any branch not in `preid-branches` and not matching here falls back to `preid`. |
| `preid-num-delimiter` | No       | `.`                                        | Delimiter between the preid and the counter (e.g. `dev.5` or `dev-5`).                                                                                                 |
| `counter-base-ref`    | No       | _(empty)_                                  | Git ref used to count prerelease commits since its merge base with `HEAD`; when empty, counts since the last `package.json` version change.                            |
| `force-preid`         | No       | `false`                                    | Forces preid versioning regardless of the current branch.                                                                                                              |
| `force-stable`        | No       | `false`                                    | Forces stable versioning regardless of the current branch.                                                                                                             |
| `tag-tmpl`            | No       | `v{major}`                                 | Template for parsing local stable tags to select `latest` or `v{major}-lts`, and for checking version conflicts. `{major}` is replaced with the major version number.  |
| `on-version-conflict` | No       | `ignore`                                   | Behavior when a stable version's git tag already exists: `ignore` (no check, fully backward compatible), `fail`, or `bump-patch` (auto-increments the patch).          |
| `release-preflight`   | No       | `false`                                    | Enables fail-closed live GitHub release validation. Requires `github-token`.                                                                                           |
| `github-token`        | No       | _(empty)_                                  | Token read only for enabled preflight. The calling job needs `contents: write` so paginated release listings include drafts; the action never mutates releases.        |

## Outputs

`skip-publish` is `true` when preflight recognizes a default-branch push that
only advances the owned package to the next minor version (plus matching npm
lockfile root versions). No version outputs are emitted in that case. Gate
build/publish steps with `if: steps.version.outputs.skip-publish != 'true'`;
skip release follow-ups when the published version is empty.
Detection uses the full push range and checkout history, never a commit-message
marker. Code/dependency changes, missing history, manual runs and explicit
`version` inputs do not take this shortcut.

| Output         | Example       | Description                                                                                                                                                                                                        |
| -------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `version`      | `1.5.6-dev.5` | Full semver with preid, or plain version when stable. Patch is bumped when `on-version-conflict: bump-patch` resolved a tag collision.                                                                             |
| `baseVersion`  | `1.5.6`       | Base version without any pre-release suffix (from the `version` input or `package.json`).                                                                                                                          |
| `fileVersion`  | `1.5.6.5`     | 4-part numeric version for non-semver consumers (e.g. .NET assembly version); plain version when stable.                                                                                                           |
| `majorVersion` | `1`           | Major version segment.                                                                                                                                                                                             |
| `minorVersion` | `5`           | Minor version segment.                                                                                                                                                                                             |
| `patchVersion` | `6`           | Patch version segment.                                                                                                                                                                                             |
| `preid`        | `dev`         | The preid string when pre-release, otherwise an empty string.                                                                                                                                                      |
| `preidCounter` | `5`           | The numeric counter appended after the preid (e.g. `5` for `-dev.5`), otherwise an empty string.                                                                                                                   |
| `branchSlug`   | `my-feature`  | Normalized branch slug used by `{branch}` in `preid-template`; empty when the template does not use `{branch}`.                                                                                                    |
| `isPrerelease` | `true`        | Whether the generated version is a prerelease.                                                                                                                                                                     |
| `isLatest`     | `false`       | Whether a stable version belongs to the highest major parsed from matching stable tags; default mode uses local tags, while `release-preflight` uses live GitHub tags. Always `false` for prereleases.             |
| `tag`          | `latest`      | Dist-tag for the build: formatted preid label when pre-release (e.g. `rc`), otherwise `latest` or `v{major}-lts`; stable-major selection uses local tags by default and live GitHub tags with `release-preflight`. |
| `exactTag`     | `v1.5.6`      | Exact Git tag derived from the final validated version; set only when `release-preflight` is enabled.                                                                                                              |
| `floatingTag`  | `v1`          | Floating major Git tag derived from the final validated version; set only when `release-preflight` is enabled.                                                                                                     |

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
      echo "Branch slug:      ${{ steps.version.outputs.branchSlug }}"
      echo "Tag:              ${{ steps.version.outputs.tag }}"
      echo "Is pre-release:   ${{ steps.version.outputs.isPrerelease }}"
      echo "Is latest major:  ${{ steps.version.outputs.isLatest }}"
```

### Force stable on a preid branch

```yaml
- name: Build version (stable)
  uses: sketch7/version-builder-action@v3
  with:
    force-stable: "true"
```

### Main release candidate

The defaults preserve the existing main-branch release channel: `main` resolves
to `rc`, and the default template leaves it unqualified.

```yaml
- name: Build main release candidate
  id: version
  uses: sketch7/version-builder-action@v3
  with:
    version: "1.3.0"
    # On main, this yields 1.3.0-rc.5 when the counter is 5.
```

### Stable v1 and v2 releases

The default stable branch patterns treat `v1` and `v2` as stable. A stable
build never has a preid or counter. Matching local stable tags determine the
highest major: the current highest emits `latest`; an older major emits its LTS
tag (for example, `v1-lts` when matching v2 tags exist).

```yaml
- name: Build stable v1 or v2 release
  id: version
  uses: sketch7/version-builder-action@v3
  with:
    version: "2.3.0"
    # refs/heads/v2 → 2.3.0, tag latest when no matching local tag has a higher major.
    # For refs/heads/v1, set version to 1.3.0; its tag is v1-lts when matching v2 tags exist.
```

### Branch-qualified feature preview

Use a branch-qualified template with a merge-base counter for previews that
must stay distinct from one another. Fetch the full history and the base ref so
Git can calculate the merge base.

```yaml
- name: Build feature preview
  id: version
  uses: sketch7/version-builder-action@v3
  with:
    version: "1.3.0"
    preid: "demo"
    preid-template: "{preid}-{branch}"
    counter-base-ref: "origin/main"
    # refs/heads/feature/e2e with one commit since origin/main →
    # version 1.3.0-demo-e2e.1, preid demo-e2e, branchSlug e2e.
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

### Guard against re-publishing a stable version

Protects against merging two release branches before a version bump lands —
otherwise both would resolve to the same stable version and the second
publish would fail partway through the build. Opt-in; the default
(`ignore`) never checks tags, so this is fully backward compatible.

```yaml
- name: Build version
  uses: sketch7/version-builder-action@v3
  with:
    on-version-conflict: "bump-patch" # or "fail" to stop instead of bumping
```

### Preflight a package release

Use live preflight before building or publishing an immutable package. The
resolved `version` is the single authority for the rest of the release; use
`exactTag` and `floatingTag` rather than deriving tags again.

```yaml
permissions:
  # write is required so the release listing includes draft releases.
  # The action itself only reads GitHub state; it never mutates releases.
  contents: write
  packages: write

steps:
  - uses: actions/checkout@v7
    with:
      fetch-depth: 0

  - name: Resolve and preflight package release
    id: version
    uses: sketch7/version-builder-action@v3
    with:
      version: "1.5.6"
      force-stable: "true"
      on-version-conflict: "bump-patch"
      release-preflight: "true"
      github-token: ${{ github.token }}

  - name: Apply the resolved package version
    run: npm version "${{ steps.version.outputs.version }}" --allow-same-version=true --git-tag-version=false

  - name: Build
    run: npm run build

  - name: Pack
    run: npm pack

  - name: Publish the resolved package
    run: npm publish --tag "${{ steps.version.outputs.tag }}"
```

An existing exact tag is accepted only when it matches the triggering commit
and has no GitHub Release yet. Stable retries reuse that allocated version,
including an automatically bumped hotfix, instead of allocating another patch.
A completed release fails before publication, even for the same commit.
A mismatched tag, draft release, or wrong release kind also fails.
This is a breaking change: callers must finalize the version returned by
preflight and must not rerun publication for a completed release.
Preflight cannot remove races introduced by later mutations: immediately before
creating/moving Git tags or marking a release latest, revalidate the branch
head and relevant release/tag state. Do not recalculate the version during that
finalization. The action never creates, updates, or deletes Git tags or GitHub
Releases.

### Sub-package in a monorepo

```yaml
- name: Build version
  uses: sketch7/version-builder-action@v3
  with:
    package-json-dir: "apps/client"
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
