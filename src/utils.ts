export function coerceArray<T>(value: T | T[]): T[] {
	return Array.isArray(value) ? value : [value]
}

export function isPrerelease(input: {
	branch: string
	preidBranches: string[]
	isForcePreid?: boolean
	isForceStable?: boolean
}): boolean {
	return (
		input.isForcePreid ||
		(!input.isForceStable && input.preidBranches.includes(input.branch))
	)
}
