import { describe, expect, test } from "vitest";

import {
	formatPreid,
	getCommitCountSinceMergeBase,
	getCommitCountSinceFileChange,
	isPrerelease,
	listRemoteBranchNames,
	listTagNames,
	matchesBranchPattern,
	parsePreidBranches,
	parseStableTagMajor,
	resolvePreid,
	resolveTag,
	resolveVersionConflict,
	sanitizeBranchName,
	stripPreid,
	isLatestStableMajor,
} from "../src/utils";

const DEFAULT_STABLE_BRANCHES = ["^v\\d+$", "^\\d+\\.x$"];

describe("sanitizeBranchName", () => {
	test.each([
		["feature/e2e", "e2e"],
		["feature/invoice/pro", "invoice-pro"],
		["HOTFIX/Tax Fix", "tax-fix"],
		["chore///release__proof", "release-proof"],
		[`feature/${"safe-branch-".repeat(15)}safe-branch`, `${"safe-branch-".repeat(15)}safe-branch`],
	])("sanitizes %s", (branch, expected) => {
		expect(sanitizeBranchName(branch)).toBe(expected);
	});

	test("rejects an empty result", () => {
		expect(() => sanitizeBranchName("feature/---")).toThrow("usable branch slug");
	});
});

test("formats a branch-qualified preid", () => {
	expect(formatPreid("{preid}-{branch}", "demo", "e2e")).toBe("demo-e2e");
});

test("formats a dot-separated preid without a branch placeholder", () => {
	expect(formatPreid("{preid}", "rc.preview", "")).toBe("rc.preview");
});

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
		expect(isPrerelease(input)).toBe(expected);
	});
});

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
		expect(parsePreidBranches(input)).toEqual(expected);
	});
});

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
		expect(matchesBranchPattern(branch, patterns)).toBe(expected);
	});
});

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
		expect(resolvePreid(input)).toBe(expected);
	});
});

describe("stripPreid", () => {
	test.each([
		{ name: "no preid — unchanged", version: "1.0.0", expected: "1.0.0" },
		{ name: "rc.0 suffix stripped", version: "1.0.0-rc.0", expected: "1.0.0" },
		{ name: "next.99 suffix stripped", version: "2.3.4-next.99", expected: "2.3.4" },
		{ name: "dev suffix stripped", version: "0.1.2-dev.7", expected: "0.1.2" },
	])("given $name - should be $expected", ({ version, expected }) => {
		expect(stripPreid(version)).toBe(expected);
	});
});

describe("getCommitCountSinceFileChange", () => {
	test("returns commit count since file last changed", () => {
		let call = 0;
		const execFn = (): string => (call++ === 0 ? "abc123def\n" : "5\n");
		expect(getCommitCountSinceFileChange("package.json", execFn)).toBe(5);
	});

	test("returns 0 when file never committed (empty sha)", () => {
		expect(getCommitCountSinceFileChange("package.json", () => "")).toBe(0);
	});

	test("returns 0 when HEAD is the version bump commit (count = 0)", () => {
		let call = 0;
		const execFn = (): string => (call++ === 0 ? "abc123def\n" : "0\n");
		expect(getCommitCountSinceFileChange("package.json", execFn)).toBe(0);
	});

	test("returns 0 on git error", () => {
		expect(
			getCommitCountSinceFileChange("package.json", () => {
				throw new Error("not a git repo");
			}),
		).toBe(0);
	});

	test("includes -G flag in git log command when diffPattern is provided", () => {
		const commands: string[] = [];
		let call = 0;
		const execFn = (cmd: string): string => {
			commands.push(cmd);
			return call++ === 0 ? "abc123def\n" : "3\n";
		};
		expect(getCommitCountSinceFileChange("package.json", execFn, '"version":')).toBe(3);
		expect(commands[0]).toContain("-G '\"version\":'");
		expect(commands[0]).not.toContain("-G 'undefined'");
	});

	test("omits -G flag when no diffPattern", () => {
		const commands: string[] = [];
		let call = 0;
		const execFn = (cmd: string): string => {
			commands.push(cmd);
			return call++ === 0 ? "abc123def\n" : "2\n";
		};
		getCommitCountSinceFileChange("package.json", execFn);
		expect(commands[0]).not.toContain("-G");
	});
});

describe("getCommitCountSinceMergeBase", () => {
	test("passes a metacharacter ref as one inert git argument", () => {
		const calls: string[][] = [];
		const execFn = (args: string[]): string => {
			calls.push(args);
			return calls.length === 1 ? "abc123\n" : "5\n";
		};

		expect(getCommitCountSinceMergeBase("origin/main; touch injected", execFn)).toBe(5);
		expect(calls).toEqual([
			["merge-base", "origin/main; touch injected", "HEAD"],
			["rev-list", "--count", "abc123..HEAD"],
		]);
	});

	test("returns commits since the merge base and uses the merge-base sha", () => {
		const commands: string[][] = [];
		const execFn = (args: string[]): string => {
			commands.push(args);
			return commands.length === 1 ? "abc123\n" : "5\n";
		};

		expect(getCommitCountSinceMergeBase("origin/main", execFn)).toBe(5);
		expect(commands).toEqual([
			["merge-base", "origin/main", "HEAD"],
			["rev-list", "--count", "abc123..HEAD"],
		]);
	});

	test.each(["merge-base", "rev-list"])("returns 0 when %s fails", stage => {
		let call = 0;
		const execFn = (_args: string[]): string => {
			call++;
			if ((stage === "merge-base" && call === 1) || (stage === "rev-list" && call === 2)) {
				throw new Error("git failure");
			}
			return call === 1 ? "abc123\n" : "5\n";
		};

		expect(getCommitCountSinceMergeBase("origin/main", execFn)).toBe(0);
	});
});

describe("listRemoteBranchNames", () => {
	test("parses branch names from ls-remote output", () => {
		const output = ["abc123\trefs/heads/main", "def456\trefs/heads/v1", "ghi789\trefs/heads/2.x"].join("\n");
		expect(listRemoteBranchNames(() => output)).toEqual(["main", "v1", "2.x"]);
	});

	test("returns empty array when output is empty", () => {
		expect(listRemoteBranchNames(() => "")).toEqual([]);
	});

	test("returns empty array on git error", () => {
		expect(
			listRemoteBranchNames(() => {
				throw new Error("no remote");
			}),
		).toEqual([]);
	});

	test("trims and filters blank lines", () => {
		const output = "abc123\trefs/heads/v2\n\n";
		expect(listRemoteBranchNames(() => output)).toEqual(["v2"]);
	});
});

describe("listTagNames", () => {
	test("parses tag names from git tag -l output", () => {
		const output = ["v1.0.0", "v1.0.1", "v2.0.0"].join("\n");
		expect(listTagNames(() => output)).toEqual(["v1.0.0", "v1.0.1", "v2.0.0"]);
	});

	test("returns empty array when output is empty", () => {
		expect(listTagNames(() => "")).toEqual([]);
	});

	test("returns empty array on git error", () => {
		expect(
			listTagNames(() => {
				throw new Error("not a git repo");
			}),
		).toEqual([]);
	});

	test("trims and filters blank lines", () => {
		expect(listTagNames(() => "v1.0.0\n\n")).toEqual(["v1.0.0"]);
	});
});

describe("resolveVersionConflict", () => {
	test.each([
		{
			name: "ignore mode returns version unchanged even if tag exists",
			input: { major: 1, minor: 0, patch: 0, tagTmpl: "v{major}", mode: "ignore" as const, existingTags: ["v1.0.0"] },
			expected: { baseVersion: "1.0.0", patch: 0, bumped: false },
		},
		{
			name: "no conflict returns version unchanged",
			input: { major: 1, minor: 0, patch: 0, tagTmpl: "v{major}", mode: "fail" as const, existingTags: ["v1.0.1"] },
			expected: { baseVersion: "1.0.0", patch: 0, bumped: false },
		},
		{
			name: "bump-patch increments once when next patch is free",
			input: { major: 1, minor: 0, patch: 0, tagTmpl: "v{major}", mode: "bump-patch" as const, existingTags: ["v1.0.0"] },
			expected: { baseVersion: "1.0.1", patch: 1, bumped: true },
		},
		{
			name: "bump-patch skips over multiple existing tags",
			input: {
				major: 1,
				minor: 0,
				patch: 0,
				tagTmpl: "v{major}",
				mode: "bump-patch" as const,
				existingTags: ["v1.0.0", "v1.0.1", "v1.0.2"],
			},
			expected: { baseVersion: "1.0.3", patch: 3, bumped: true },
		},
		{
			name: "custom tag-tmpl prefix",
			input: { major: 2, minor: 1, patch: 0, tagTmpl: "release-{major}", mode: "bump-patch" as const, existingTags: ["release-2.1.0"] },
			expected: { baseVersion: "2.1.1", patch: 1, bumped: true },
		},
	])("given $name - should be $expected", ({ input, expected }) => {
		expect(resolveVersionConflict(input)).toEqual(expected);
	});

	test("fail mode throws when the exact tag already exists", () => {
		expect(() => resolveVersionConflict({ major: 1, minor: 0, patch: 0, tagTmpl: "v{major}", mode: "fail", existingTags: ["v1.0.0"] })).toThrow(
			"Tag 'v1.0.0' already exists",
		);
	});

	test("fail mode expands a tag-template suffix", () => {
		expect(() =>
			resolveVersionConflict({ major: 1, minor: 0, patch: 0, tagTmpl: "v{major}-stable", mode: "fail", existingTags: ["v1.0.0-stable"] }),
		).toThrow("Tag 'v1.0.0-stable' already exists");
	});

	test("bump-patch expands a tag-template suffix for every candidate", () => {
		expect(
			resolveVersionConflict({
				major: 1,
				minor: 0,
				patch: 0,
				tagTmpl: "v{major}-stable",
				mode: "bump-patch",
				existingTags: ["v1.0.0-stable", "v1.0.1-stable"],
			}),
		).toEqual({ baseVersion: "1.0.2", patch: 2, bumped: true });
	});
});

describe("parseStableTagMajor", () => {
	test.each([
		["v0.0.0", "v{major}", 0],
		["v1.2.3", "v{major}", 1],
		["v02.0.0", "v{major}", null],
		["v1.02.0", "v{major}", null],
		["v1.0.03", "v{major}", null],
		["v2.0.0-rc.4", "v{major}", null],
		["v2", "v{major}", null],
		["release-3.1.0", "release-{major}", 3],
		["release+[v2.1.0]", "release+[v{major}]", 2],
	])("parses stable tag %s", (tag, template, expected) => {
		expect(parseStableTagMajor(tag, template)).toBe(expected);
	});
});

describe("isLatestStableMajor", () => {
	test("a future prerelease does not displace the current stable major", () => {
		expect(isLatestStableMajor(1, ["v1.9.0", "v2.0.0-rc.1"], "v{major}")).toBe(true);
	});

	test("an older stable major is not latest", () => {
		expect(isLatestStableMajor(1, ["v1.9.0", "v2.0.0"], "v{major}")).toBe(false);
	});

	test("selects the highest stable major from more than 100 exact tags", () => {
		const tags = Array.from({ length: 101 }, (_, index) => `v${index + 1}.0.0`);
		expect(isLatestStableMajor(101, tags, "v{major}")).toBe(true);
		expect(isLatestStableMajor(100, tags, "v{major}")).toBe(false);
	});
});

describe("resolveTag", () => {
	test.each([
		{
			name: "pre-release returns preid",
			input: { resolvedPreid: "rc", currentMajor: 1, isLatest: false },
			expected: "rc",
		},
		{
			name: "latest stable returns latest",
			input: { resolvedPreid: null, currentMajor: 2, isLatest: true },
			expected: "latest",
		},
		{
			name: "older stable returns major lts tag",
			input: { resolvedPreid: null, currentMajor: 1, isLatest: false },
			expected: "v1-lts",
		},
	])("given $name - should be $expected", ({ input, expected }) => {
		expect(resolveTag(input)).toBe(expected);
	});
});
