import { execFileSync, execSync } from "child_process";

const CONVENTIONAL_PREFIX = /^(?:feature|feat|fix|hotfix|bugfix|chore|spike)\/+/i;

export function sanitizeBranchName(branch: string): string {
	const slug = branch
		.replace(CONVENTIONAL_PREFIX, "")
		.toLowerCase()
		.replace(/[^a-z0-9-]+/g, "-")
		.replace(/-+/g, "-")
		.replace(/^-|-$/g, "");
	if (!slug) {
		throw new Error(`Branch '${branch}' does not produce a usable branch slug`);
	}
	return slug;
}

export function formatPreid(template: string, preid: string, branchSlug: string): string {
	const value = template.replaceAll("{preid}", preid).replaceAll("{branch}", branchSlug);
	if (!/^[0-9A-Za-z-]+$/.test(value)) {
		throw new Error(`Invalid formatted preid '${value}'`);
	}
	return value;
}

export function coerceArray<T>(value: T | T[]): T[] {
	return Array.isArray(value) ? value : [value];
}

export function isPrerelease(input: { branch: string; preidBranches: string[]; forcePreid?: boolean; forceStable?: boolean }): boolean {
	if (input.forceStable) {
		return false;
	}
	if (input.forcePreid) {
		return true;
	}
	return input.preidBranches.includes(input.branch);
}

export interface PreidBranchEntry {
	branch: string;
	/** When undefined, falls back to the global default preid. */
	preid?: string;
}

/**
 * Parses entries in the form `"branch"` or `"branch:preid"`.
 * e.g. `["main:rc", "develop:dev", "vnext:next", "feature"]`
 */
export function parsePreidBranches(entries: string[]): PreidBranchEntry[] {
	return entries.map(entry => {
		const colonIdx = entry.indexOf(":");
		if (colonIdx === -1) {
			return { branch: entry };
		}
		return { branch: entry.slice(0, colonIdx), preid: entry.slice(colonIdx + 1) };
	});
}

/**
 * Returns true when the branch matches any of the given regex patterns using RegExp.test.
 * Note: patterns are not auto-anchored; use ^ and $ in the pattern if full-string matches are required.
 */
export function matchesBranchPattern(branch: string, patterns: string[]): boolean {
	return patterns.some(pattern => new RegExp(pattern).test(branch));
}

/**
 * Resolves the preid string for the current branch.
 * Returns `null` when the version should be stable.
 *
 * Resolution order:
 * 1. `forceStable`      → stable (null)
 * 2. `forcePreid`       → mapped preid or `defaultPreid`
 * 3. Exact match in `preidBranches` → mapped preid or `defaultPreid`
 * 4. Matches a `stableBranches` pattern → stable (null)
 * 5. Fallback → `defaultPreid` (any other branch is treated as pre-release)
 */
export function resolvePreid(input: {
	branch: string;
	preidBranches: PreidBranchEntry[];
	stableBranches: string[];
	defaultPreid: string;
	forcePreid?: boolean;
	forceStable?: boolean;
}): string | null {
	if (input.forceStable) {
		return null;
	}
	if (input.forcePreid) {
		const match = input.preidBranches.find(e => e.branch === input.branch);
		return match?.preid ?? input.defaultPreid;
	}
	const match = input.preidBranches.find(e => e.branch === input.branch);
	if (match) {
		return match.preid ?? input.defaultPreid;
	}
	if (matchesBranchPattern(input.branch, input.stableBranches)) {
		return null;
	}
	return input.defaultPreid;
}

/**
 * Strips any pre-release suffix from a version string.
 * e.g. `"1.0.0-rc.0"` → `"1.0.0"`, `"1.0.0"` → `"1.0.0"`.
 */
export function stripPreid(version: string): string {
	const idx = version.indexOf("-");
	return idx === -1 ? version : version.slice(0, idx);
}

/**
 * Parses a stable branch name into a numeric version array for comparison.
 * Strips a leading `v` and treats `.x` as a terminal segment (dropped).
 * Returns `null` when no numeric version can be parsed.
 * e.g. `"v1"` → `[1]`, `"2.x"` → `[2]`, `"v3.1"` → `[3, 1]`, `"main"` → `null`.
 */
export function parseBranchVersion(branch: string): number[] | null {
	let normalized = branch.startsWith("v") ? branch.slice(1) : branch;
	normalized = normalized.replace(/\.x$/, "");
	if (!normalized) {
		return null;
	}
	const parts = normalized.split(".");
	if (parts.some(p => p === "" || !/^\d+$/.test(p))) {
		return null;
	}
	return parts.map(Number);
}

/**
 * Parses the major version from an exact stable tag matching a major tag template.
 * Stable tags must contain a complete `major.minor.patch` version with no suffix.
 */
export function parseStableTagMajor(tag: string, tagTmpl: string): number | null {
	const marker = "{major}";
	const markerIndex = tagTmpl.indexOf(marker);
	if (markerIndex === -1) {
		return null;
	}

	const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const prefix = escapeRegex(tagTmpl.slice(0, markerIndex));
	const suffix = escapeRegex(tagTmpl.slice(markerIndex + marker.length));
	const match = new RegExp(`^${prefix}(\\d+)\\.\\d+\\.\\d+${suffix}$`).exec(tag);
	return match ? Number(match[1]) : null;
}

/**
 * Returns true when the current major is at least as high as every stable major in `tags`.
 * Prerelease and malformed tags are ignored.
 */
export function isLatestStableMajor(currentMajor: number, tags: string[], tagTmpl: string): boolean {
	return tags.every(tag => {
		const major = parseStableTagMajor(tag, tagTmpl);
		return major === null || major <= currentMajor;
	});
}

/**
 * Resolves the dist-tag string for the current build.
 * Pre-release builds use their resolved preid; stable builds use `latest` for the highest
 * stable major and a version-specific LTS tag otherwise.
 */
export function resolveTag(input: { resolvedPreid: string | null; currentMajor: number; isLatest: boolean }): string {
	if (input.resolvedPreid !== null) {
		return input.resolvedPreid;
	}
	return input.isLatest ? "latest" : `v${input.currentMajor}-lts`;
}

/**
 * Counts commits on HEAD since the last commit that touched `filePath`.
 * When `diffPattern` is provided (a regex passed to git's `-G` flag), only commits where the diff
 * contains a line matching the pattern are considered — e.g., pass `'"version":'` to reset only
 * when the `version` property itself changed, not just when the file was touched.
 * Returns 0 when no matching commit is found, when HEAD is that commit, or if git is unavailable.
 */
export function getCommitCountSinceFileChange(
	filePath: string,
	execFn: (cmd: string) => string = cmd => execSync(cmd, { encoding: "utf8" }),
	diffPattern?: string,
): number {
	try {
		const patternFlag = diffPattern ? ` -G '${diffPattern}'` : "";
		const sha = execFn(`git log --follow -n 1 --pretty=format:%H${patternFlag} -- ${filePath}`).trim();
		if (!sha) {
			return 0;
		}
		const count = execFn(`git rev-list --count ${sha}..HEAD`).trim();
		return parseInt(count, 10) || 0;
	} catch {
		return 0;
	}
}

export function getCommitCountSinceMergeBase(
	baseRef: string,
	execFn: (args: string[]) => string = args => execFileSync("git", args, { encoding: "utf8" }),
): number {
	try {
		const mergeBase = execFn(["merge-base", baseRef, "HEAD"]).trim();
		const count = execFn(["rev-list", "--count", `${mergeBase}..HEAD`]).trim();
		return parseInt(count, 10) || 0;
	} catch {
		return 0;
	}
}

/**
 * Lists all remote branch names from `origin` via `git ls-remote --heads origin`.
 * Returns an empty array if git is unavailable or the remote cannot be reached.
 */
export function listRemoteBranchNames(execFn: (cmd: string) => string = cmd => execSync(cmd, { encoding: "utf8" })): string[] {
	try {
		const output = execFn("git ls-remote --heads origin");
		return output
			.split("\n")
			.map(line => /refs\/heads\/(?<branch>.+)$/.exec(line)?.groups?.branch?.trim() ?? null)
			.filter((name): name is string => name !== null && name.length > 0);
	} catch {
		return [];
	}
}

/**
 * Lists all local tag names via `git tag -l`. Assumes tags are already fetched locally
 * (actions/checkout with fetch-depth: 0 fetches tags by default).
 * Returns an empty array if git is unavailable.
 */
export function listTagNames(execFn: (cmd: string) => string = cmd => execSync(cmd, { encoding: "utf8" })): string[] {
	try {
		return execFn("git tag -l")
			.split("\n")
			.map(t => t.trim())
			.filter(Boolean);
	} catch {
		return [];
	}
}

export type VersionConflictMode = "ignore" | "fail" | "bump-patch";

export interface VersionConflictResult {
	baseVersion: string;
	patch: number;
	bumped: boolean;
}

/**
 * Resolves a stable `major.minor.patch` version against existing git tags.
 * `mode: "ignore"` returns the version unchanged (default, non-breaking).
 * `mode: "bump-patch"` increments the patch until a free tag is found.
 * `mode: "fail"` throws when the exact tag already exists.
 */
export function resolveVersionConflict(input: {
	major: number;
	minor: number;
	patch: number;
	tagTmpl: string;
	mode: VersionConflictMode;
	existingTags: string[];
}): VersionConflictResult {
	const { major, minor, tagTmpl, mode, existingTags } = input;
	let { patch } = input;

	if (mode === "ignore") {
		return { baseVersion: `${major}.${minor}.${patch}`, patch, bumped: false };
	}

	const [prefix] = tagTmpl.split("{major}");
	const tagSet = new Set(existingTags);
	const exactTag = `${prefix}${major}.${minor}.${patch}`;
	if (!tagSet.has(exactTag)) {
		return { baseVersion: `${major}.${minor}.${patch}`, patch, bumped: false };
	}

	if (mode === "fail") {
		throw new Error(`Tag '${exactTag}' already exists. Bump the version and retry, or use on-version-conflict: bump-patch to auto-increment.`);
	}

	do {
		patch++;
	} while (tagSet.has(`${prefix}${major}.${minor}.${patch}`));
	return { baseVersion: `${major}.${minor}.${patch}`, patch, bumped: true };
}
