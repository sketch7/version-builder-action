import * as core from "@actions/core";
import * as github from "@actions/github";
import { describe, expect, test, vi } from "vitest";

import { run } from "../src/main";
import { getCommitCountSinceFileChange, getCommitCountSinceMergeBase, listTagNames } from "../src/utils";
// oxlint-disable-next-line import/no-namespace -- Required for Vitest importOriginal<typeof utils>()
import type * as utils from "../src/utils";
import { isVersionOnlyBump } from "../src/version-only-bump";

vi.mock("@actions/core");
vi.mock("../src/version-only-bump", () => ({ isVersionOnlyBump: vi.fn(() => false) }));
vi.mock("@actions/github", () => ({
	context: { ref: "refs/heads/feature/my-workflow", sha: "a".repeat(40), repo: { owner: "sketch7", repo: "version-builder-action" } },
	getOctokit: vi.fn(),
}));
vi.mock("../src/utils", async importOriginal => {
	const actual = await importOriginal<typeof utils>();
	return {
		...actual,
		getCommitCountSinceFileChange: vi.fn().mockReturnValue(0),
		getCommitCountSinceMergeBase: vi.fn().mockReturnValue(0),
		listRemoteBranchNames: vi.fn().mockReturnValue([]),
		listTagNames: vi.fn().mockReturnValue([]),
	};
});

const dataset = [
	{
		name: "pre-release branch with preid",
		input: {
			ref: "refs/heads/feature/my-workflow",
			version: "4.0.1",
			preid: "dev",
			preidBranches: "main:rc,master:rc,develop:dev",
			stableBranches: "^v\\d+$,^\\d+\\.x$",
			forcePreid: "false",
			forceStable: "false",
		},
		expected: {
			version: "4.0.1-dev.0",
			baseVersion: "4.0.1",
			fileVersion: "4.0.1.0",
			majorVersion: "4",
			minorVersion: "0",
			patchVersion: "1",
			preid: "dev",
			preidCounter: 0,
			isPrerelease: true,
			isLatest: false,
			tag: "dev",
		},
	},
	{
		name: "stable branch",
		input: {
			ref: "refs/heads/v3",
			version: "3.0.0",
			preid: "dev",
			preidBranches: "main:rc,master:rc,develop:dev",
			stableBranches: "^v\\d+$,^\\d+\\.x$",
			forcePreid: "false",
			forceStable: "false",
		},
		expected: {
			version: "3.0.0",
			baseVersion: "3.0.0",
			fileVersion: "3.0.0",
			majorVersion: "3",
			minorVersion: "0",
			patchVersion: "0",
			preid: "",
			preidCounter: "",
			isPrerelease: false,
			isLatest: true,
			tag: "latest",
		},
	},
	{
		name: "preid branch (develop -> dev)",
		input: {
			ref: "refs/heads/develop",
			version: "5.1.0",
			preid: "dev",
			preidBranches: "main:rc,master:rc,develop:dev",
			stableBranches: "^v\\d+$,^\\d+\\.x$",
			forcePreid: "false",
			forceStable: "false",
		},
		expected: {
			version: "5.1.0-dev.0",
			baseVersion: "5.1.0",
			fileVersion: "5.1.0.0",
			majorVersion: "5",
			minorVersion: "1",
			patchVersion: "0",
			preid: "dev",
			preidCounter: 0,
			isPrerelease: true,
			isLatest: false,
			tag: "dev",
		},
	},
];

const EXPECTED_SHA = "a".repeat(40);

function apiError(message: string, status?: number): Error & { status?: number } {
	return Object.assign(new Error(message), { status });
}

function tagPage(...names: string[]): {
	data: { ref: string; object: { type: "commit"; sha: string } }[];
} {
	return {
		data: names.map(name => ({ ref: `refs/tags/${name}`, object: { type: "commit", sha: EXPECTED_SHA } })),
	};
}

function releasePage(...releases: unknown[]): { data: unknown[] } {
	return { data: releases };
}

function releaseRecord(tagName: string, draft = false, prerelease = false): Record<string, unknown> {
	return { tag_name: tagName, draft, prerelease };
}

async function* tagPages(...pages: unknown[]): AsyncGenerator<unknown> {
	for (const page of pages) {
		yield page;
	}
}

function mockPreflightInputs(overrides: Record<string, string> = {}): void {
	vi.mocked(github).context = {
		ref: "refs/heads/v3",
		sha: EXPECTED_SHA,
		repo: { owner: "sketch7", repo: "version-builder-action" },
	} as typeof github.context;
	vi.mocked(core.getInput).mockImplementation((name: string) => {
		const map: Record<string, string> = {
			version: "3.0.0",
			preid: "dev",
			"preid-branches": "main:rc,master:rc,develop:dev",
			"stable-branches": "^v\\d+$,^\\d+\\.x$",
			"preid-num-delimiter": ".",
			"on-version-conflict": "bump-patch",
			"tag-tmpl": "v{major}",
			"release-preflight": "true",
			"github-token": "test-token",
			...overrides,
		};
		return map[name] ?? "";
	});
	vi.mocked(core.getBooleanInput).mockImplementation(name => name === "release-preflight");
}

function mockOctokit(
	overrides: {
		pages?: unknown[];
		releasePages?: unknown[];
		branchSha?: string;
		listError?: Error;
		releaseError?: Error;
		getRef?: (ref: string) => Promise<unknown>;
	} = {},
): { paginate: { iterator: ReturnType<typeof vi.fn> }; tagIterator: ReturnType<typeof vi.fn>; releaseIterator: ReturnType<typeof vi.fn> } {
	const listMatchingRefs = vi.fn();
	const listReleases = vi.fn();
	const tagIterator = vi.fn(() => {
		if (overrides.listError) {
			return failingTagPages(overrides.listError);
		}
		return tagPages(...(overrides.pages ?? [tagPage("v3.0.0"), tagPage("v3.0.1", "v4.0.0")]));
	});
	const releaseIterator = vi.fn(() => {
		if (overrides.releaseError) {
			return failingTagPages(overrides.releaseError);
		}
		return tagPages(...(overrides.releasePages ?? [releasePage(releaseRecord("v9.0.0")), releasePage(releaseRecord("v8.0.0"))]));
	});
	const octokit = {
		paginate: {
			iterator: vi.fn((endpoint: unknown) => {
				if (endpoint === listMatchingRefs) {
					return tagIterator();
				}
				return releaseIterator();
			}),
		},
		rest: {
			git: {
				listMatchingRefs,
				getRef: vi.fn(async ({ ref }: { ref: string }) => {
					if (overrides.getRef) {
						return { data: await overrides.getRef(ref) };
					}
					if (ref.startsWith("heads/")) {
						return { data: { object: { type: "commit", sha: overrides.branchSha ?? EXPECTED_SHA } } };
					}
					if (["tags/v3.0.0", "tags/v3.0.1", "tags/v4.0.0"].includes(ref)) {
						return { data: { object: { type: "commit", sha: "b".repeat(40) } } };
					}
					throw apiError(`Reference ${ref} not found`, 404);
				}),
				getTag: vi.fn(),
			},
			repos: {
				listReleases,
			},
		},
	};
	vi.mocked(github.getOctokit).mockReturnValue(octokit as never);
	return { ...octokit, tagIterator, releaseIterator };
}

async function* failingTagPages(error: Error): AsyncGenerator<unknown> {
	yield* tagPages();
	throw error;
}

describe("release preflight", () => {
	test("version-only default-branch bumps stop before version resolution", async () => {
		mockPreflightInputs({ version: "", "package-json-dir": "src/management" });
		mockOctokit();
		vi.mocked(isVersionOnlyBump).mockReturnValueOnce(true);
		await run();
		expect(core.setFailed).not.toHaveBeenCalled();
		expect(core.setOutput).toHaveBeenCalledWith("skip-publish", true);
		expect(core.setOutput).not.toHaveBeenCalledWith("version", expect.anything());
		expect(getCommitCountSinceFileChange).not.toHaveBeenCalled();
		expect(isVersionOnlyBump).toHaveBeenCalledWith(expect.objectContaining({ packageJsonPath: "src/management/package.json" }));
	});

	test("explicit versions do not invoke automatic bump detection", async () => {
		mockPreflightInputs();
		mockOctokit();
		await run();
		expect(isVersionOnlyBump).not.toHaveBeenCalled();
		expect(core.setOutput).toHaveBeenCalledWith("skip-publish", false);
		expect(core.setOutput).toHaveBeenCalledWith("version", "3.0.2");
	});

	test("enabled rejects a tag template whose generated refs begin with a dash", async () => {
		mockPreflightInputs({ "tag-tmpl": "-v{major}" });
		mockOctokit({
			getRef: async ref => {
				if (ref === "heads/v3" || ref === "tags/-v3.0.0") {
					return { object: { type: "commit", sha: EXPECTED_SHA } };
				}
				throw apiError(`Reference ${ref} not found`, 404);
			},
		});

		await run();

		expect(core.setFailed).toHaveBeenCalledWith(expect.stringContaining("Invalid Git tag"));
		expect(core.setOutput).not.toHaveBeenCalled();
	});

	test("disabled preserves local versioning without reading a token or calling GitHub", async () => {
		mockPreflightInputs({ "release-preflight": "false", "github-token": "must-not-be-read" });
		vi.mocked(core.getBooleanInput).mockReturnValue(false);
		vi.mocked(listTagNames).mockReturnValue(["v3.0.0"]);

		await run();

		expect(core.getInput).not.toHaveBeenCalledWith("github-token");
		expect(github.getOctokit).not.toHaveBeenCalled();
		expect(listTagNames).toHaveBeenCalledOnce();
		expect(core.setOutput).toHaveBeenCalledWith("version", "3.0.1");
		expect(core.setOutput).not.toHaveBeenCalledWith("exactTag", expect.anything());
	});

	test.each([
		["a non-branch ref", "refs/tags/v3", EXPECTED_SHA],
		["a noncanonical commit SHA", "refs/heads/v3", "not-a-sha"],
		["a 41-character commit SHA", "refs/heads/v3", "a".repeat(41)],
		["a 63-character commit SHA", "refs/heads/v3", "a".repeat(63)],
	])("enabled rejects %s before calling GitHub", async (_name, ref, sha) => {
		mockPreflightInputs();
		vi.mocked(github).context = {
			ref,
			sha,
			repo: { owner: "sketch7", repo: "version-builder-action" },
		} as typeof github.context;

		await run();

		expect(core.setFailed).toHaveBeenCalledOnce();
		expect(github.getOctokit).not.toHaveBeenCalled();
		expect(core.setOutput).not.toHaveBeenCalled();
	});

	test("enabled rejects a missing token before emitting outputs or calling GitHub", async () => {
		mockPreflightInputs({ "github-token": "" });

		await run();

		expect(core.setFailed).toHaveBeenCalledWith("github-token is required when release-preflight is enabled");
		expect(github.getOctokit).not.toHaveBeenCalled();
		expect(core.setOutput).not.toHaveBeenCalled();
	});

	test("enabled rejects a stable version whose vN branch has another major", async () => {
		mockPreflightInputs({ version: "2.0.0" });
		const octokit = mockOctokit();

		await run();

		expect(core.setFailed).toHaveBeenCalledWith(expect.stringContaining("Stable branch 'v3' must match resolved version major '2'"));
		expect(octokit.tagIterator).not.toHaveBeenCalled();
		expect(core.setOutput).not.toHaveBeenCalled();
	});

	test("disabled calculation preserves a stable vN branch with another major", async () => {
		mockPreflightInputs({ version: "2.0.0", "release-preflight": "false" });
		vi.mocked(core.getBooleanInput).mockReturnValue(false);
		vi.mocked(listTagNames).mockReturnValue([]);

		await run();

		expect(core.setFailed).not.toHaveBeenCalled();
		expect(github.getOctokit).not.toHaveBeenCalled();
		expect(core.setOutput).toHaveBeenCalledWith("version", "2.0.0");
	});

	test("preflight preserves a forced prerelease preview on a mismatched stable branch", async () => {
		mockPreflightInputs({ version: "2.0.0", "force-preid": "true" });
		vi.mocked(core.getBooleanInput).mockImplementation(name => name === "release-preflight" || name === "force-preid");
		const octokit = mockOctokit();

		await run();

		expect(core.setFailed).not.toHaveBeenCalled();
		expect(core.setOutput).toHaveBeenCalledWith("version", "2.0.0-dev.0");
		expect(core.setOutput).toHaveBeenCalledWith("isPrerelease", true);
		expect(octokit.tagIterator).not.toHaveBeenCalled();
	});

	test("enabled resolves a stable bump from paginated live tags and emits validated release tags", async () => {
		mockPreflightInputs();
		const octokit = mockOctokit();
		vi.mocked(listTagNames).mockReturnValue(["v99.0.0"]);

		await run();

		expect(github.getOctokit).toHaveBeenCalledWith("test-token");
		expect(octokit.tagIterator).toHaveBeenCalledOnce();
		expect(listTagNames).not.toHaveBeenCalled();
		expect(core.setOutput).toHaveBeenCalledWith("version", "3.0.2");
		expect(core.setOutput).toHaveBeenCalledWith("isLatest", false);
		expect(core.setOutput).toHaveBeenCalledWith("exactTag", "v3.0.2");
		expect(core.setOutput).toHaveBeenCalledWith("floatingTag", "v3");
	});

	test.each(["bump-patch", "fail"])("enabled recovers a matching exact tag before applying the %s conflict policy", async onVersionConflict => {
		mockPreflightInputs({ "on-version-conflict": onVersionConflict });
		const octokit = mockOctokit({
			getRef: async ref => {
				if (ref === "heads/v3" || ref === "tags/v3.0.0") {
					return { object: { type: "commit", sha: EXPECTED_SHA } };
				}
				throw apiError(`Reference ${ref} not found`, 404);
			},
			releasePages: [],
		});

		await run();

		expect(core.setFailed).not.toHaveBeenCalled();
		expect(core.setOutput).toHaveBeenCalledWith("version", "3.0.0");
		expect(core.setOutput).toHaveBeenCalledWith("baseVersion", "3.0.0");
		expect(core.setOutput).toHaveBeenCalledWith("patchVersion", "0");
		expect(core.setOutput).toHaveBeenCalledWith("exactTag", "v3.0.0");
		expect(octokit.tagIterator).toHaveBeenCalledOnce();
	});

	test("enabled rejects a completed exact release even with the ignore conflict policy", async () => {
		mockPreflightInputs({ "on-version-conflict": "ignore" });
		mockOctokit({
			getRef: async ref => {
				if (ref === "heads/v3" || ref === "tags/v3.0.0") {
					return { object: { type: "commit", sha: EXPECTED_SHA } };
				}
				throw apiError(`Reference ${ref} not found`, 404);
			},
			releasePages: [releasePage(releaseRecord("v3.0.0"))],
		});

		await run();

		expect(core.setFailed).toHaveBeenCalledWith(expect.stringContaining("already released"));
		expect(core.setOutput).not.toHaveBeenCalled();
	});

	test.each([false, true])("retries an allocated hotfix without creating another version (completed=%s)", async completed => {
		mockPreflightInputs();
		mockOctokit({
			pages: [tagPage("v3.0.0", "v3.0.1")],
			releasePages: completed ? [releasePage(releaseRecord("v3.0.1"))] : [],
			getRef: async ref => {
				if (ref === "heads/v3" || ref === "tags/v3.0.1") {
					return { object: { type: "commit", sha: EXPECTED_SHA } };
				}
				if (ref === "tags/v3.0.0") {
					return { object: { type: "commit", sha: "b".repeat(40) } };
				}
				throw apiError("missing", 404);
			},
		});
		await run();
		if (completed) {
			expect(core.setFailed).toHaveBeenCalledWith(expect.stringContaining("already released"));
			expect(core.setOutput).not.toHaveBeenCalled();
		} else {
			expect(core.setFailed).not.toHaveBeenCalled();
			expect(core.setOutput).toHaveBeenCalledWith("version", "3.0.1");
		}
	});

	test.each(["bump-patch", "fail"])("enabled applies %s when the candidate tag targets another commit", async onVersionConflict => {
		mockPreflightInputs({ "on-version-conflict": onVersionConflict });
		mockOctokit({
			pages: [tagPage("v3.0.0", "v3.0.1")],
			getRef: async ref => {
				if (ref === "heads/v3") {
					return { object: { type: "commit", sha: EXPECTED_SHA } };
				}
				if (ref === "tags/v3.0.0" || ref === "tags/v3.0.1") {
					return { object: { type: "commit", sha: "b".repeat(40) } };
				}
				throw apiError(`Reference ${ref} not found`, 404);
			},
		});

		await run();

		if (onVersionConflict === "bump-patch") {
			expect(core.setFailed).not.toHaveBeenCalled();
			expect(core.setOutput).toHaveBeenCalledWith("version", "3.0.2");
		} else {
			expect(core.setFailed).toHaveBeenCalledWith(expect.stringContaining("Tag 'v3.0.0' already exists"));
			expect(core.setOutput).not.toHaveBeenCalled();
		}
	});

	test("enabled validates and emits tags for a prerelease without consulting stable tags", async () => {
		mockPreflightInputs({ "release-preflight": "true" });
		vi.mocked(github).context = {
			ref: "refs/heads/main",
			sha: EXPECTED_SHA,
			repo: { owner: "sketch7", repo: "version-builder-action" },
		} as typeof github.context;
		const octokit = mockOctokit();

		await run();

		expect(octokit.tagIterator).not.toHaveBeenCalled();
		expect(octokit.releaseIterator).toHaveBeenCalledOnce();
		expect(listTagNames).not.toHaveBeenCalled();
		expect(core.setOutput).toHaveBeenCalledWith("version", "3.0.0-rc.0");
		expect(core.setOutput).toHaveBeenCalledWith("exactTag", "v3.0.0-rc.0");
		expect(core.setOutput).toHaveBeenCalledWith("floatingTag", "v3");
	});

	test("enabled rejects a stale branch before emitting any outputs", async () => {
		mockPreflightInputs();
		mockOctokit({ branchSha: "b".repeat(40) });

		await run();

		expect(core.setFailed).toHaveBeenCalledWith(expect.stringContaining("current branch head"));
		expect(core.setOutput).not.toHaveBeenCalled();
	});

	test("enabled reports a live API failure without falling back to local tags", async () => {
		mockPreflightInputs();
		const error = apiError("API rate limit exceeded", 429);
		mockOctokit({ listError: error });
		vi.mocked(listTagNames).mockReturnValue([]);

		await run();

		expect(core.setFailed).toHaveBeenCalledWith("API rate limit exceeded");
		expect(listTagNames).not.toHaveBeenCalled();
		expect(core.setOutput).not.toHaveBeenCalled();
	});
});

test.each(dataset)("given $name - outputs should match expected", async ({ input, expected }) => {
	vi.mocked(github).context = { ref: input.ref } as typeof github.context;
	vi.mocked(core.getInput).mockImplementation((name: string) => {
		const map: Record<string, string> = {
			version: input.version,
			preid: input.preid,
			"preid-branches": input.preidBranches,
			"stable-branches": input.stableBranches,
			"preid-num-delimiter": ".",
		};
		return map[name] ?? "";
	});
	vi.mocked(core.getBooleanInput).mockImplementation((name: string) => {
		if (name === "force-preid") {
			return input.forcePreid === "true";
		}
		if (name === "force-stable") {
			return input.forceStable === "true";
		}
		return false;
	});

	if (!expected.isPrerelease) {
		vi.mocked(listTagNames).mockReturnValue(["v3.0.0"]);
	}

	await run();

	expect(core.setOutput).toHaveBeenCalledWith("version", expected.version);
	expect(core.setOutput).toHaveBeenCalledWith("baseVersion", expected.baseVersion);
	expect(core.setOutput).toHaveBeenCalledWith("fileVersion", expected.fileVersion);
	expect(core.setOutput).toHaveBeenCalledWith("majorVersion", expected.majorVersion);
	expect(core.setOutput).toHaveBeenCalledWith("minorVersion", expected.minorVersion);
	expect(core.setOutput).toHaveBeenCalledWith("patchVersion", expected.patchVersion);
	expect(core.setOutput).toHaveBeenCalledWith("preid", expected.preid);
	expect(core.setOutput).toHaveBeenCalledWith("preidCounter", expected.preidCounter);
	expect(core.setOutput).toHaveBeenCalledWith("isPrerelease", expected.isPrerelease);
	expect(core.setOutput).toHaveBeenCalledWith("isLatest", expected.isLatest);
	expect(core.setOutput).toHaveBeenCalledWith("tag", expected.tag);
});

test("preview templates use the branch slug and merge-base counter", async () => {
	vi.mocked(github).context = { ref: "refs/heads/feature/e2e" } as typeof github.context;
	vi.mocked(core.getInput).mockImplementation((name: string) => {
		const map: Record<string, string> = {
			version: "1.3.0",
			preid: "demo",
			"preid-template": "{preid}-{branch}",
			"counter-base-ref": "origin/main",
			"preid-branches": "main:rc,master:rc,develop:dev",
			"stable-branches": "^v\\d+$,^\\d+\\.x$",
			"preid-num-delimiter": ".",
		};
		return map[name] ?? "";
	});
	vi.mocked(core.getBooleanInput).mockReturnValue(false);
	vi.mocked(getCommitCountSinceMergeBase).mockReturnValue(1);

	await run();

	expect(core.setOutput).toHaveBeenCalledWith("version", "1.3.0-demo-e2e.1");
	expect(core.setOutput).toHaveBeenCalledWith("preid", "demo-e2e");
	expect(core.setOutput).toHaveBeenCalledWith("branchSlug", "e2e");
	expect(core.setOutput).toHaveBeenCalledWith("preidCounter", 1);
});

test("stable versions in an older major use the LTS tag and report isLatest false", async () => {
	vi.mocked(github).context = { ref: "refs/heads/v3" } as typeof github.context;
	vi.mocked(core.getInput).mockImplementation((name: string) => {
		const map: Record<string, string> = {
			version: "3.0.0",
			preid: "dev",
			"preid-branches": "main:rc,master:rc,develop:dev",
			"stable-branches": "^v\\d+$,^\\d+\\.x$",
			"preid-num-delimiter": ".",
		};
		return map[name] ?? "";
	});
	vi.mocked(core.getBooleanInput).mockReturnValue(false);
	vi.mocked(listTagNames).mockReturnValue(["v3.0.0", "v4.0.0"]);

	await run();

	expect(core.setOutput).toHaveBeenCalledWith("isLatest", false);
	expect(core.setOutput).toHaveBeenCalledWith("tag", "v3-lts");
});

test("stable action decisions preserve adjacent huge major, minor, and patch components", async () => {
	const major = "9007199254740993";
	const minor = "9007199254740993";
	const patch = "9007199254740993";
	vi.mocked(github).context = { ref: `refs/heads/v${major}` } as typeof github.context;
	vi.mocked(core.getInput).mockImplementation((name: string) => {
		const map: Record<string, string> = {
			version: `${major}.${minor}.${patch}`,
			preid: "dev",
			"preid-branches": "main:rc,master:rc,develop:dev",
			"stable-branches": "^v\\d+$,^\\d+\\.x$",
			"preid-num-delimiter": ".",
			"on-version-conflict": "fail",
			"tag-tmpl": "v{major}",
		};
		return map[name] ?? "";
	});
	vi.mocked(core.getBooleanInput).mockReturnValue(false);
	vi.mocked(listTagNames).mockReturnValue([`v${major}.${minor}.${BigInt(patch) - 1n}`, `v${BigInt(major) + 1n}.0.0`]);

	await run();

	expect(core.setFailed).not.toHaveBeenCalled();
	expect(core.setOutput).toHaveBeenCalledWith("version", `${major}.${minor}.${patch}`);
	expect(core.setOutput).toHaveBeenCalledWith("isLatest", false);
	expect(core.setOutput).toHaveBeenCalledWith("tag", `v${major}-lts`);
});

describe("prerelease suffix validation", () => {
	function mockInputs(preid: string, preidDelimiter: string): void {
		vi.mocked(github).context = { ref: "refs/heads/feature/my-workflow" } as typeof github.context;
		vi.mocked(core.getInput).mockImplementation((name: string) => {
			const map: Record<string, string> = {
				version: "1.0.0",
				preid,
				"preid-branches": "main:rc,master:rc,develop:dev",
				"stable-branches": "^v\\d+$,^\\d+\\.x$",
				"preid-num-delimiter": preidDelimiter,
			};
			return map[name] ?? "";
		});
		vi.mocked(core.getBooleanInput).mockReturnValue(false);
	}

	test("preserves dot-separated preids with the default template", async () => {
		mockInputs("rc.preview", ".");

		await run();

		expect(core.setOutput).toHaveBeenCalledWith("version", "1.0.0-rc.preview.0");
		expect(core.setOutput).toHaveBeenCalledWith("preid", "rc.preview");
	});

	test("rejects a leading-zero numeric prerelease identifier", async () => {
		mockInputs("01", ".");

		await expect(run()).rejects.toThrow("Invalid prerelease suffix '01.0'");
	});

	test("permits a leading zero when a hyphen delimiter makes the identifier nonnumeric", async () => {
		mockInputs("01", "-");

		await run();

		expect(core.setOutput).toHaveBeenCalledWith("version", "1.0.0-01-0");
	});
});

describe("on-version-conflict", () => {
	function mockInputs(overrides: { version: string; onVersionConflict?: string; tagTmpl?: string }): void {
		vi.mocked(github).context = { ref: "refs/heads/v3" } as typeof github.context;
		vi.mocked(core.getInput).mockImplementation((name: string) => {
			const map: Record<string, string> = {
				version: overrides.version,
				preid: "dev",
				"preid-branches": "main:rc,master:rc,develop:dev",
				"stable-branches": "^v\\d+$,^\\d+\\.x$",
				"preid-num-delimiter": ".",
				"on-version-conflict": overrides.onVersionConflict ?? "",
				"tag-tmpl": overrides.tagTmpl ?? "",
			};
			return map[name] ?? "";
		});
		vi.mocked(core.getBooleanInput).mockReturnValue(false);
	}

	test("ignore (default) still checks tags for latest detection", async () => {
		mockInputs({ version: "3.0.0" });
		vi.mocked(listTagNames).mockReturnValue(["v3.0.0"]);

		await run();

		expect(listTagNames).toHaveBeenCalledOnce();
		expect(core.setOutput).toHaveBeenCalledWith("version", "3.0.0");
		expect(core.setFailed).not.toHaveBeenCalled();
	});

	test("fail sets a failure message when the tag already exists", async () => {
		mockInputs({ version: "3.0.0", onVersionConflict: "fail" });
		vi.mocked(listTagNames).mockReturnValue(["v3.0.0"]);

		await run();

		expect(core.setFailed).toHaveBeenCalledWith(expect.stringContaining("Tag 'v3.0.0' already exists"));
	});

	test("fail does not fail when the tag does not exist", async () => {
		mockInputs({ version: "3.0.0", onVersionConflict: "fail" });
		vi.mocked(listTagNames).mockReturnValue([]);

		await run();

		expect(core.setFailed).not.toHaveBeenCalled();
		expect(core.setOutput).toHaveBeenCalledWith("version", "3.0.0");
	});

	test("bump-patch auto-increments patch and outputs the bumped version", async () => {
		mockInputs({ version: "3.0.0", onVersionConflict: "bump-patch" });
		vi.mocked(listTagNames).mockReturnValue(["v3.0.0", "v3.0.1"]);

		await run();

		expect(core.setOutput).toHaveBeenCalledWith("version", "3.0.2");
		expect(core.setOutput).toHaveBeenCalledWith("baseVersion", "3.0.2");
		expect(core.setOutput).toHaveBeenCalledWith("patchVersion", "2");
	});
});

describe("package-json-dir", () => {
	function mockInputs(packageJsonDir: string): void {
		vi.mocked(github).context = { ref: "refs/heads/feature/my-workflow" } as typeof github.context;
		vi.mocked(core.getInput).mockImplementation((name: string) => {
			const map: Record<string, string> = {
				version: "1.0.0",
				preid: "dev",
				"preid-branches": "main:rc,master:rc,develop:dev",
				"stable-branches": "^v\\d+$,^\\d+\\.x$",
				"preid-num-delimiter": ".",
				"package-json-dir": packageJsonDir,
			};
			return map[name] ?? "";
		});
		vi.mocked(core.getBooleanInput).mockReturnValue(false);
	}

	test.each([
		{ name: "empty (default) resolves to repo root", packageJsonDir: "", expected: "package.json" },
		{ name: "plain sub-directory", packageJsonDir: "management/blueprint", expected: "management/blueprint/package.json" },
		{ name: "leading/trailing slashes are stripped", packageJsonDir: "/management/blueprint/", expected: "management/blueprint/package.json" },
	])("given $name - uses $expected for commit counting", async ({ packageJsonDir, expected }) => {
		mockInputs(packageJsonDir);

		await run();

		expect(getCommitCountSinceFileChange).toHaveBeenCalledWith(expected, undefined, '"version":');
	});
});
