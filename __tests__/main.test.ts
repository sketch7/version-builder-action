import * as cp from "child_process"
import * as path from "path"
import * as process from "process"
import { describe, expect, test } from "vitest"
import {
	getCommitCountSinceFileChange,
	isPrerelease,
	listRemoteBranchNames,
	matchesBranchPattern,
	parsePreidBranches,
	parseBranchVersion,
	resolvePreid,
	resolveTag,
	stripPreid,
} from "../src/utils"

const DEFAULT_STABLE_BRANCHES = ["^v\\d+$", "^\\d+\\.x$"]

describe("isPrerelease", () => {
	test.each([
		// prerelease
		{
			name: "Preid branch match",
			input: {
				branch: "master",
				preidBranches: ["master", "develop"],
				forcePreid: false,
				forceStable: false,
			},
			expected: true,
		},
		{
			name: "Force preid",
			input: {
				branch: "ci",
				preidBranches: ["master", "develop"],
				forcePreid: true,
				forceStable: false,
			},
			expected: true,
		},
		{
			name: "Force stable > force preid",
			input: {
				branch: "ci",
				preidBranches: ["master", "develop"],
				forcePreid: true,
				forceStable: true,
			},
			expected: false,
		},
		// stable
		{
			name: "Non matching preid branch",
			input: {
				branch: "master",
				preidBranches: ["develop"],
				forcePreid: false,
				forceStable: false,
			},
			expected: false,
		},
		{
			name: "Force stable",
			input: {
				branch: "master",
				preidBranches: ["master"],
				forcePreid: false,
				forceStable: true,
			},
			expected: false,
		},
	])("given $name - should be $expected", ({ input, expected }) => {
		expect(isPrerelease(input)).toBe(expected)
	})
})

describe("parsePreidBranches", () => {
	test.each([
		{
			name: "plain branch names",
			input: ["main", "master", "develop"],
			expected: [{ branch: "main" }, { branch: "master" }, { branch: "develop" }],
		},
		{
			name: "branch:preid mappings",
			input: ["main:rc", "master:rc", "develop:dev", "vnext:next"],
			expected: [
				{ branch: "main", preid: "rc" },
				{ branch: "master", preid: "rc" },
				{ branch: "develop", preid: "dev" },
				{ branch: "vnext", preid: "next" },
			],
		},
		{
			name: "mixed plain and mapped",
			input: ["main:rc", "develop"],
			expected: [{ branch: "main", preid: "rc" }, { branch: "develop" }],
		},
	])("given $name - should parse correctly", ({ input, expected }) => {
		expect(parsePreidBranches(input)).toEqual(expected)
	})
})

describe("matchesBranchPattern", () => {
	test.each([
		{ name: "v1 matches ^v\\d+$", branch: "v1", patterns: ["^v\\d+$"], expected: true },
		{ name: "v12 matches ^v\\d+$", branch: "v12", patterns: ["^v\\d+$"], expected: true },
		{ name: "1.x matches ^\\d+\\.x$", branch: "1.x", patterns: ["^\\d+\\.x$"], expected: true },
		{ name: "12.x matches ^\\d+\\.x$", branch: "12.x", patterns: ["^\\d+\\.x$"], expected: true },
		{ name: "main does not match stable patterns", branch: "main", patterns: DEFAULT_STABLE_BRANCHES, expected: false },
		{ name: "feature/foo does not match stable patterns", branch: "feature/foo", patterns: DEFAULT_STABLE_BRANCHES, expected: false },
		{ name: "v1-beta does not match ^v\\d+$", branch: "v1-beta", patterns: ["^v\\d+$"], expected: false },
		{ name: "empty patterns always false", branch: "main", patterns: [], expected: false },
	])("given $name - should be $expected", ({ branch, patterns, expected }) => {
		expect(matchesBranchPattern(branch, patterns)).toBe(expected)
	})
})

describe("resolvePreid", () => {
	test.each([
		// --- explicit preid-branch matches ---
		{
			name: "main returns rc (explicit map)",
			input: {
				branch: "main",
				preidBranches: parsePreidBranches(["main:rc", "master:rc", "develop:dev", "vnext:next"]),
				stableBranches: DEFAULT_STABLE_BRANCHES,
				defaultPreid: "dev",
				forcePreid: false,
				forceStable: false,
			},
			expected: "rc",
		},
		{
			name: "develop returns dev (explicit map)",
			input: {
				branch: "develop",
				preidBranches: parsePreidBranches(["main:rc", "master:rc", "develop:dev", "vnext:next"]),
				stableBranches: DEFAULT_STABLE_BRANCHES,
				defaultPreid: "dev",
				forcePreid: false,
				forceStable: false,
			},
			expected: "dev",
		},
		{
			name: "vnext returns next (explicit map)",
			input: {
				branch: "vnext",
				preidBranches: parsePreidBranches(["main:rc", "master:rc", "develop:dev", "vnext:next"]),
				stableBranches: DEFAULT_STABLE_BRANCHES,
				defaultPreid: "dev",
				forcePreid: false,
				forceStable: false,
			},
			expected: "next",
		},
		{
			name: "plain branch entry uses defaultPreid",
			input: {
				branch: "develop",
				preidBranches: parsePreidBranches(["main:rc", "develop"]),
				stableBranches: DEFAULT_STABLE_BRANCHES,
				defaultPreid: "alpha",
				forcePreid: false,
				forceStable: false,
			},
			expected: "alpha",
		},
		// --- stable branch patterns ---
		{
			name: "v1 matches stable pattern returns null",
			input: {
				branch: "v1",
				preidBranches: parsePreidBranches(["main:rc", "develop:dev"]),
				stableBranches: DEFAULT_STABLE_BRANCHES,
				defaultPreid: "dev",
				forcePreid: false,
				forceStable: false,
			},
			expected: null,
		},
		{
			name: "2.x matches stable pattern returns null",
			input: {
				branch: "2.x",
				preidBranches: parsePreidBranches(["main:rc", "develop:dev"]),
				stableBranches: DEFAULT_STABLE_BRANCHES,
				defaultPreid: "dev",
				forcePreid: false,
				forceStable: false,
			},
			expected: null,
		},
		{
			name: "custom stable pattern hotfix/* returns null",
			input: {
				branch: "hotfix/1.0",
				preidBranches: parsePreidBranches(["main:rc", "develop:dev"]),
				stableBranches: ["^hotfix/.*$"],
				defaultPreid: "dev",
				forcePreid: false,
				forceStable: false,
			},
			expected: null,
		},
		// --- fallback default preid ---
		{
			name: "unmatched branch falls back to defaultPreid",
			input: {
				branch: "feature/my-feat",
				preidBranches: parsePreidBranches(["main:rc", "develop:dev"]),
				stableBranches: DEFAULT_STABLE_BRANCHES,
				defaultPreid: "dev",
				forcePreid: false,
				forceStable: false,
			},
			expected: "dev",
		},
		{
			name: "workflow branch falls back to defaultPreid",
			input: {
				branch: "workflow",
				preidBranches: parsePreidBranches(["main:rc", "develop:dev"]),
				stableBranches: DEFAULT_STABLE_BRANCHES,
				defaultPreid: "dev",
				forcePreid: false,
				forceStable: false,
			},
			expected: "dev",
		},
		// --- force flags ---
		{
			name: "force-preid on unmatched branch uses defaultPreid",
			input: {
				branch: "hotfix/123",
				preidBranches: parsePreidBranches(["main:rc", "develop:dev"]),
				stableBranches: DEFAULT_STABLE_BRANCHES,
				defaultPreid: "dev",
				forcePreid: true,
				forceStable: false,
			},
			expected: "dev",
		},
		{
			name: "force-preid on matched branch uses mapped preid",
			input: {
				branch: "main",
				preidBranches: parsePreidBranches(["main:rc", "develop:dev"]),
				stableBranches: DEFAULT_STABLE_BRANCHES,
				defaultPreid: "dev",
				forcePreid: true,
				forceStable: false,
			},
			expected: "rc",
		},
		{
			name: "force-preid overrides stable pattern",
			input: {
				branch: "v1",
				preidBranches: parsePreidBranches(["main:rc", "develop:dev"]),
				stableBranches: DEFAULT_STABLE_BRANCHES,
				defaultPreid: "dev",
				forcePreid: true,
				forceStable: false,
			},
			expected: "dev",
		},
		{
			name: "force-stable returns null even for preid branch",
			input: {
				branch: "main",
				preidBranches: parsePreidBranches(["main:rc", "develop:dev"]),
				stableBranches: DEFAULT_STABLE_BRANCHES,
				defaultPreid: "dev",
				forcePreid: false,
				forceStable: true,
			},
			expected: null,
		},
		{
			name: "force-stable wins over force-preid",
			input: {
				branch: "main",
				preidBranches: parsePreidBranches(["main:rc", "develop:dev"]),
				stableBranches: DEFAULT_STABLE_BRANCHES,
				defaultPreid: "dev",
				forcePreid: true,
				forceStable: true,
			},
			expected: null,
		},
	])("given $name - should return $expected", ({ input, expected }) => {
		expect(resolvePreid(input)).toBe(expected)
	})
})

describe("stripPreid", () => {
	test.each([
		{ name: "no preid — unchanged", version: "1.0.0", expected: "1.0.0" },
		{ name: "rc.0 suffix stripped", version: "1.0.0-rc.0", expected: "1.0.0" },
		{ name: "next.99 suffix stripped", version: "2.3.4-next.99", expected: "2.3.4" },
		{ name: "dev suffix stripped", version: "0.1.2-dev.7", expected: "0.1.2" },
	])("given $name - should be $expected", ({ version, expected }) => {
		expect(stripPreid(version)).toBe(expected)
	})
})

describe("getCommitCountSinceFileChange", () => {
	test("returns commit count since file last changed", () => {
		let call = 0
		const execFn = () => (call++ === 0 ? "abc123def\n" : "5\n")
		expect(getCommitCountSinceFileChange("package.json", execFn)).toBe(5)
	})

	test("returns 0 when file never committed (empty sha)", () => {
		expect(getCommitCountSinceFileChange("package.json", () => "")).toBe(0)
	})

	test("returns 0 when HEAD is the version bump commit (count = 0)", () => {
		let call = 0
		const execFn = () => (call++ === 0 ? "abc123def\n" : "0\n")
		expect(getCommitCountSinceFileChange("package.json", execFn)).toBe(0)
	})

	test("returns 0 on git error", () => {
		expect(
			getCommitCountSinceFileChange("package.json", () => {
				throw new Error("not a git repo")
			}),
		).toBe(0)
	})
})

describe("listRemoteBranchNames", () => {
	test("parses branch names from ls-remote output", () => {
		const output = ["abc123\trefs/heads/main", "def456\trefs/heads/v1", "ghi789\trefs/heads/2.x"].join("\n")
		expect(listRemoteBranchNames(() => output)).toEqual(["main", "v1", "2.x"])
	})

	test("returns empty array when output is empty", () => {
		expect(listRemoteBranchNames(() => "")).toEqual([])
	})

	test("returns empty array on git error", () => {
		expect(
			listRemoteBranchNames(() => {
				throw new Error("no remote")
			}),
		).toEqual([])
	})

	test("trims and filters blank lines", () => {
		const output = "abc123\trefs/heads/v2\n\n"
		expect(listRemoteBranchNames(() => output)).toEqual(["v2"])
	})
})

describe("parseBranchVersion", () => {
	test.each([
		{ name: "v1", branch: "v1", expected: [1] },
		{ name: "v2", branch: "v2", expected: [2] },
		{ name: "1.x", branch: "1.x", expected: [1] },
		{ name: "12.x", branch: "12.x", expected: [12] },
		{ name: "v3.1", branch: "v3.1", expected: [3, 1] },
		{ name: "2.3", branch: "2.3", expected: [2, 3] },
		{ name: "main returns null", branch: "main", expected: null },
		{ name: "feature/foo returns null", branch: "feature/foo", expected: null },
		{ name: "develop returns null", branch: "develop", expected: null },
	])("given $name - should be $expected", ({ branch, expected }) => {
		expect(parseBranchVersion(branch)).toEqual(expected)
	})
})

describe("resolveTag", () => {
	test.each([
		// --- pre-release → returns preid ---
		{
			name: "pre-release branch returns preid rc",
			input: { resolvedPreid: "rc", branch: "main", stableBranchNames: [] },
			expected: "rc",
		},
		{
			name: "pre-release branch returns preid dev",
			input: { resolvedPreid: "dev", branch: "feature/foo", stableBranchNames: [] },
			expected: "dev",
		},
		// --- stable → latest detection ---
		{
			name: "single stable branch returns latest",
			input: { resolvedPreid: null, branch: "v2", stableBranchNames: ["v2"] },
			expected: "latest",
		},
		{
			name: "highest of multiple stable branches returns latest",
			input: { resolvedPreid: null, branch: "v2", stableBranchNames: ["v1", "v2"] },
			expected: "latest",
		},
		{
			name: "lower stable branch returns v1-lts",
			input: { resolvedPreid: null, branch: "v1", stableBranchNames: ["v1", "v2"] },
			expected: "v1-lts",
		},
		{
			name: "1.x style — highest returns latest",
			input: { resolvedPreid: null, branch: "2.x", stableBranchNames: ["1.x", "2.x"] },
			expected: "latest",
		},
		{
			name: "1.x style — lower returns v1-lts",
			input: { resolvedPreid: null, branch: "1.x", stableBranchNames: ["1.x", "2.x"] },
			expected: "v1-lts",
		},
		{
			name: "no parseable branch names falls back to latest",
			input: { resolvedPreid: null, branch: "hotfix/1.0", stableBranchNames: [] },
			expected: "latest",
		},
		{
			name: "single un-parseable stable branch falls back to latest",
			input: { resolvedPreid: null, branch: "hotfix/1.0", stableBranchNames: ["hotfix/1.0"] },
			expected: "latest",
		},
	])("given $name - should be $expected", ({ input, expected }) => {
		expect(resolveTag(input)).toBe(expected)
	})
})

// shows how the runner will run a javascript action with env / stdout protocol
test("runs", () => {
	// inputs
	process.env["INPUT_PREID-BRANCHES"] = "main:rc,master:rc,develop:dev"
	process.env["INPUT_STABLE-BRANCHES"] = "^v\\d+$,^\\d+\\.x$"
	process.env["INPUT_VERSION"] = "4.0.1"
	process.env["INPUT_PREID"] = "dev"
	process.env["INPUT_FORCE-PREID"] = "false"
	process.env["INPUT_FORCE-STABLE"] = "false"
	// envs
	process.env["GITHUB_RUN_NUMBER"] = "23"
	// process.env["GITHUB_REF"] = "refs/heads/main"
	process.env["GITHUB_REF"] = "refs/heads/feature/my-workflow"
	const np = process.execPath
	const ip = path.join(__dirname, "..", "dist", "index.js")
	const options: cp.ExecFileSyncOptions = {
		env: process.env,
	}
	const result = cp.execFileSync(np, [ip], options).toString()
	console.log(result)
	expect(result).not.toBeNull()
})
