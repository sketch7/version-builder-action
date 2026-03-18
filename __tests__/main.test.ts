import * as cp from "child_process"
import * as path from "path"
import * as process from "process"
import { describe, expect, test } from "vitest"
import { isPrerelease, parsePreidBranches, resolvePreid } from "../src/utils"

describe("isPrerelease", () => {
	test.each([
		// prerelease
		{
			name: "Preid branch match",
			input: {
				branch: "master",
				preidBranches: ["master", "develop"],
				isForcePreid: false,
				isForceStable: false,
			},
			expected: true,
		},
		{
			name: "Force preid",
			input: {
				branch: "ci",
				preidBranches: ["master", "develop"],
				isForcePreid: true,
				isForceStable: false,
			},
			expected: true,
		},
		{
			name: "Force preid > force stable",
			input: {
				branch: "ci",
				preidBranches: ["master", "develop"],
				isForcePreid: true,
				isForceStable: true,
			},
			expected: true,
		},
		// stable
		{
			name: "Non matching preid branch",
			input: {
				branch: "master",
				preidBranches: ["develop"],
				isForcePreid: false,
				isForceStable: false,
			},
			expected: false,
		},
		{
			name: "Force stable",
			input: {
				branch: "master",
				preidBranches: ["master"],
				isForcePreid: false,
				isForceStable: true,
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

describe("resolvePreid", () => {
	test.each([
		{
			name: "main returns rc",
			input: {
				branch: "main",
				preidBranches: parsePreidBranches(["main:rc", "master:rc", "develop:dev", "vnext:next"]),
				defaultPreid: "dev",
				isForcePreid: false,
				isForceStable: false,
			},
			expected: "rc",
		},
		{
			name: "develop returns dev",
			input: {
				branch: "develop",
				preidBranches: parsePreidBranches(["main:rc", "master:rc", "develop:dev", "vnext:next"]),
				defaultPreid: "dev",
				isForcePreid: false,
				isForceStable: false,
			},
			expected: "dev",
		},
		{
			name: "vnext returns next",
			input: {
				branch: "vnext",
				preidBranches: parsePreidBranches(["main:rc", "master:rc", "develop:dev", "vnext:next"]),
				defaultPreid: "dev",
				isForcePreid: false,
				isForceStable: false,
			},
			expected: "next",
		},
		{
			name: "unmatched branch returns null (stable)",
			input: {
				branch: "feature/my-feat",
				preidBranches: parsePreidBranches(["main:rc", "develop:dev"]),
				defaultPreid: "dev",
				isForcePreid: false,
				isForceStable: false,
			},
			expected: null,
		},
		{
			name: "plain branch entry uses defaultPreid",
			input: {
				branch: "develop",
				preidBranches: parsePreidBranches(["main:rc", "develop"]),
				defaultPreid: "alpha",
				isForcePreid: false,
				isForceStable: false,
			},
			expected: "alpha",
		},
		{
			name: "force-preid on unmatched branch uses defaultPreid",
			input: {
				branch: "hotfix/123",
				preidBranches: parsePreidBranches(["main:rc", "develop:dev"]),
				defaultPreid: "dev",
				isForcePreid: true,
				isForceStable: false,
			},
			expected: "dev",
		},
		{
			name: "force-preid on matched branch uses mapped preid",
			input: {
				branch: "main",
				preidBranches: parsePreidBranches(["main:rc", "develop:dev"]),
				defaultPreid: "dev",
				isForcePreid: true,
				isForceStable: false,
			},
			expected: "rc",
		},
		{
			name: "force-stable returns null",
			input: {
				branch: "main",
				preidBranches: parsePreidBranches(["main:rc", "develop:dev"]),
				defaultPreid: "dev",
				isForcePreid: false,
				isForceStable: true,
			},
			expected: null,
		},
		{
			name: "force-preid wins over force-stable",
			input: {
				branch: "main",
				preidBranches: parsePreidBranches(["main:rc", "develop:dev"]),
				defaultPreid: "dev",
				isForcePreid: true,
				isForceStable: true,
			},
			expected: "rc",
		},
	])("given $name - should return $expected", ({ input, expected }) => {
		expect(resolvePreid(input)).toBe(expected)
	})
})

// shows how the runner will run a javascript action with env / stdout protocol
test("runs", () => {
	// inputs
	process.env["INPUT_PREID-BRANCHES"] = "main:rc,master:rc,develop:dev,feature/resusable-workflow:dev"
	process.env["INPUT_VERSION"] = "4.0.1"
	process.env["INPUT_PREID"] = "rc"
	process.env["INPUT_FORCE-PREID"] = "false"
	process.env["INPUT_FORCE-STABLE"] = "false"
	// envs
	process.env["GITHUB_RUN_NUMBER"] = "23"
	process.env["GITHUB_REF"] = "master"
	const np = process.execPath
	const ip = path.join(__dirname, "..", "dist", "index.js")
	const options: cp.ExecFileSyncOptions = {
		env: process.env,
	}
	const result = cp.execFileSync(np, [ip], options).toString()
	console.log(result)
	expect(result).not.toBeNull()
})
