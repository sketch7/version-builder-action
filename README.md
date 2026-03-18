# Version Builder

A GitHub Action that generates a semantic version number based on an input
version (or `package.json`), the current branch, and the GitHub run number.
It appends a preid suffix (e.g. `dev.123`) on designated branches and emits
both semver and non-semver variants as outputs.

## How It Works

- If the `version` input is not provided, the action reads `version` from the
  repository's `package.json`.
- When the current branch is in the `preid-branches` list (or `force-preid` is
  `true`), the run number is appended as a prerelease identifier:
  `1.5.6` → `1.5.6-dev.123`
- On all other branches (or when `force-stable` is `true`) the version is
  emitted unchanged: `1.5.6`
- `force-preid` takes precedence over `force-stable`.

## Inputs

| Input                 | Required | Default                  | Description                                                                   |
| --------------------- | -------- | ------------------------ | ----------------------------------------------------------------------------- |
| `version`             | No       | _(reads `package.json`)_ | Base version to use (e.g. `1.5.6`).                                           |
| `preid`               | No       | `dev`                    | Prerelease identifier to append (e.g. `dev`, `rc`).                           |
| `preid-branches`      | No       | `main,master,develop`    | Comma-separated list of branches that trigger preid versioning.               |
| `preid-num-delimiter` | No       | `.`                      | Delimiter between the preid and the run number (e.g. `dev.123` or `dev-123`). |
| `force-preid`         | No       | `false`                  | Forces preid versioning regardless of the current branch.                     |
| `force-stable`        | No       | `false`                  | Forces stable versioning regardless of the current branch.                    |

## Outputs

| Output             | Example         | Description                                                                 |
| ------------------ | --------------- | --------------------------------------------------------------------------- |
| `version`          | `1.5.6-dev.123` | Full semver with preid, or plain version when stable.                       |
| `nonSemverVersion` | `1.5.6.123`     | Version with run number but without preid label; plain version when stable. |
| `majorVersion`     | `1`             | Major version segment.                                                      |
| `minorVersion`     | `5`             | Minor version segment.                                                      |
| `patchVersion`     | `6`             | Patch version segment.                                                      |
| `tag`              | `dev`           | The preid string when pre-release, otherwise an empty string.               |
| `isPrerelease`     | `true`          | Whether the generated version is a prerelease.                              |

## Usage

```yaml
steps:
  - name: Checkout
    uses: actions/checkout@v4

  - name: Build version
    id: version
    uses: sketch7/version-builder-action@v1
    with:
      version: "1.5.6"           # optional — omit to read from package.json
      preid: "dev"               # optional
      preid-branches: "main,master,develop"  # optional

  - name: Use outputs
    run: |
      echo "Version:          ${{ steps.version.outputs.version }}"
      echo "Non-semver:       ${{ steps.version.outputs.nonSemverVersion }}"
      echo "Tag:              ${{ steps.version.outputs.tag }}"
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

## Publishing a New Release

This project includes a helper script, [`script/release`](./script/release),
that streamlines tagging and pushing new releases.

1. **Retrieve the latest tag** — the script fetches the most recent SemVer tag
   from local repository data.
1. **Prompt for a new tag** — enter a new tag in `vX.X.X` format. Remember to
   update `version` in `package.json` before running the script.
1. **Tag the release** — the script tags the commit and syncs the major tag
   (e.g. `v1`) with the new release tag (e.g. `v1.2.0`). For a new major
   version it automatically creates a `releases/v#` branch for the previous
   major.
1. **Push to remote** — commits, tags, and branches are pushed. Then create a
   GitHub Release so consumers can reference the new tag.
