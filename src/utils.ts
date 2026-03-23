import { execSync } from "child_process";

export function coerceArray<T>(value: T | T[]): T[] {
	return Array.isArray(value) ? value : [value];
}

export function isPrerelease(input: { branch: string; preidBranches: string[]; forcePreid?: boolean; forceStable?: boolean }): boolean {
	if (input.forceStable) return false;
	if (input.forcePreid) return true;
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
	if (input.forceStable) return null;
	if (input.forcePreid) {
		const match = input.preidBranches.find(e => e.branch === input.branch);
		return match?.preid ?? input.defaultPreid;
	}
	const match = input.preidBranches.find(e => e.branch === input.branch);
	if (match) return match.preid ?? input.defaultPreid;
	if (matchesBranchPattern(input.branch, input.stableBranches)) return null;
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
	if (!normalized) return null;
	const parts = normalized.split(".");
	if (parts.some(p => p === "" || !/^\d+$/.test(p))) return null;
	return parts.map(Number);
}

function compareVersionArrays(a: number[], b: number[]): number {
	const len = Math.max(a.length, b.length);
	for (let i = 0; i < len; i++) {
		const diff = (a[i] ?? 0) - (b[i] ?? 0);
		if (diff !== 0) return diff;
	}
	return 0;
}

/**
 * Resolves the dist-tag string for the current build.
 * - Pre-release builds → returns the `resolvedPreid` value (e.g. `"rc"`, `"dev"`).
 * - Stable builds → compares the current branch against all detected stable branches;
 *   the branch with the highest semver version emits `"latest"`, all others emit `"v{major}-lts"`.
 *   Falls back to `"latest"` when no branch versions can be parsed.
 */
export function resolveTag(input: { resolvedPreid: string | null; branch: string; stableBranchNames: string[] }): string {
	if (input.resolvedPreid !== null) return input.resolvedPreid;

	const versioned = input.stableBranchNames
		.map(name => ({ name, version: parseBranchVersion(name) }))
		.filter((e): e is { name: string; version: number[] } => e.version !== null);

	if (versioned.length === 0) return "latest";

	const highest = versioned.reduce((best, cur) => (compareVersionArrays(cur.version, best.version) > 0 ? cur : best));
	const currentVersion = parseBranchVersion(input.branch);
	if (currentVersion !== null && compareVersionArrays(currentVersion, highest.version) === 0) return "latest";
	const major = currentVersion?.[0];
	return major !== undefined ? `v${major}-lts` : "latest";
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
		if (!sha) return 0;
		const count = execFn(`git rev-list --count ${sha}..HEAD`).trim();
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
			.map(line => /refs\/heads\/(.+)$/.exec(line)?.[1]?.trim() ?? null)
			.filter((name): name is string => name !== null && name.length > 0);
	} catch {
		return [];
	}
}
