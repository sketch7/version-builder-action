export function coerceArray<T>(value: T | T[]): T[] {
	return Array.isArray(value) ? value : [value]
}

export function isPrerelease(input: { branch: string; preidBranches: string[]; forcePreid?: boolean; forceStable?: boolean }): boolean {
	return input.forcePreid || (!input.forceStable && input.preidBranches.includes(input.branch))
}

export interface PreidBranchEntry {
	branch: string
	/** When undefined, falls back to the global default preid. */
	preid?: string
}

/**
 * Parses entries in the form `"branch"` or `"branch:preid"`.
 * e.g. `["main:rc", "develop:dev", "vnext:next", "feature"]`
 */
export function parsePreidBranches(entries: string[]): PreidBranchEntry[] {
	return entries.map(entry => {
		const colonIdx = entry.indexOf(":")
		if (colonIdx === -1) {
			return { branch: entry }
		}
		return { branch: entry.slice(0, colonIdx), preid: entry.slice(colonIdx + 1) }
	})
}

/**
 * Returns true when the branch matches any of the given regex patterns (full string test).
 */
export function matchesBranchPattern(branch: string, patterns: string[]): boolean {
	return patterns.some(pattern => new RegExp(pattern).test(branch))
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
	branch: string
	preidBranches: PreidBranchEntry[]
	stableBranches: string[]
	defaultPreid: string
	forcePreid?: boolean
	forceStable?: boolean
}): string | null {
	if (input.forceStable) return null
	if (input.forcePreid) {
		const match = input.preidBranches.find(e => e.branch === input.branch)
		return match?.preid ?? input.defaultPreid
	}
	const match = input.preidBranches.find(e => e.branch === input.branch)
	if (match) return match.preid ?? input.defaultPreid
	if (matchesBranchPattern(input.branch, input.stableBranches)) return null
	return input.defaultPreid
}
