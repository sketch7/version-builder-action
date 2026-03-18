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
 * Resolves the preid string for the current branch.
 * Returns `null` when the version should be stable.
 */
export function resolvePreid(input: {
	branch: string
	preidBranches: PreidBranchEntry[]
	defaultPreid: string
	forcePreid?: boolean
	forceStable?: boolean
}): string | null {
	if (input.forcePreid) {
		const match = input.preidBranches.find(e => e.branch === input.branch)
		return match?.preid ?? input.defaultPreid
	}
	if (input.forceStable) {
		return null
	}
	const match = input.preidBranches.find(e => e.branch === input.branch)
	if (!match) {
		return null
	}
	return match.preid ?? input.defaultPreid
}
