import { describe, expect, test } from "vitest";

import { loadLiveTags, loadResolvedReleaseState, validateResolvedRelease } from "../src/release-preflight";
import type { ReleasePreflightClient } from "../src/release-preflight";

const EXPECTED_SHA = "a".repeat(40);
const OTHER_SHA = "b".repeat(40);

interface ApiError extends Error {
	status?: number;
}

function apiError(message: string, status?: number): ApiError {
	return Object.assign(new Error(message), { status });
}

function tagPage(...names: string[]): { data: { ref: string; node_id: string; url: string; object: { type: string; sha: string; url: string } }[] } {
	return {
		data: names.map(name => ({
			ref: `refs/tags/${name}`,
			node_id: "MDM6UmVmMQ==",
			url: `https://api.github.com/repos/octocat/example/git/ref/tags/${name}`,
			object: { type: "commit", sha: EXPECTED_SHA, url: `https://api.github.com/repos/octocat/example/git/commits/${EXPECTED_SHA}` },
		})),
	};
}

function releaseRecord(tagName: string, draft = false, prerelease = false): Record<string, unknown> {
	return {
		url: `https://api.github.com/repos/octocat/example/releases/${tagName}`,
		assets_url: `https://api.github.com/repos/octocat/example/releases/${tagName}/assets`,
		upload_url: `https://uploads.github.com/repos/octocat/example/releases/${tagName}/assets{?name,label}`,
		html_url: `https://github.com/octocat/example/releases/tag/${tagName}`,
		id: 1,
		node_id: "MDc6UmVsZWFzZTE=",
		tag_name: tagName,
		target_commitish: "main",
		name: tagName,
		body: "Release notes",
		draft,
		prerelease,
		created_at: "2026-09-05T12:00:00Z",
		published_at: draft ? null : "2026-09-05T12:00:00Z",
		assets: [],
		tarball_url: `https://api.github.com/repos/octocat/example/tarball/${tagName}`,
		zipball_url: `https://api.github.com/repos/octocat/example/zipball/${tagName}`,
	};
}

function releasePage(...releases: unknown[]): { data: unknown[] } {
	return { data: releases };
}

function annotatedTag(target: { type: string; sha: string }): {
	node_id: string;
	tag: string;
	sha: string;
	url: string;
	message: string;
	tagger: { date: string; email: string; name: string };
	object: { type: string; sha: string; url: string };
	verification: { verified: boolean; reason: string; signature: null; payload: null; verified_at: null };
} {
	return {
		node_id: "MDM6VGFnMQ==",
		tag: "v1.2.3",
		sha: "c".repeat(40),
		url: `https://api.github.com/repos/octocat/example/git/tags/${"c".repeat(40)}`,
		message: "Release v1.2.3",
		tagger: { date: "2026-09-05T12:00:00Z", email: "release@example.com", name: "Release Bot" },
		object: { ...target, url: `https://api.github.com/repos/octocat/example/git/${target.type}s/${target.sha}` },
		verification: { verified: false, reason: "unsigned", signature: null, payload: null, verified_at: null },
	};
}

async function* tagPages(...pages: unknown[]): AsyncGenerator<unknown> {
	for (const page of pages) {
		yield page;
	}
}

async function* failingTagPages(error: Error, ...pages: unknown[]): AsyncGenerator<unknown> {
	yield* tagPages(...pages);
	throw error;
}

function createClient(overrides: Partial<ReleasePreflightClient> = {}): ReleasePreflightClient {
	return {
		getRef: async ref => {
			if (ref === "heads/main") {
				return { object: { type: "commit", sha: EXPECTED_SHA } };
			}
			throw apiError(`Reference ${ref} not found`, 404);
		},
		listTagPages: () => tagPages(tagPage("v1.2.3")),
		getGitObject: async sha => ({ type: "commit", sha }),
		listReleasePages: () => tagPages(releasePage()),
		...overrides,
	};
}

function withReleasePages(client: ReleasePreflightClient, ...pages: unknown[]): ReleasePreflightClient {
	return Object.assign(client, { listReleasePages: () => tagPages(...pages) });
}

const loadInput = { branch: "main", exactTag: "v1.2.3" };
const validationInput = { expectedSha: EXPECTED_SHA, version: "1.2.3", tagTmpl: "v{major}" };

describe("loadLiveTags", () => {
	test("loads every Octokit paginator page before version resolution", async () => {
		const client = createClient({
			listTagPages: () => tagPages(tagPage("v1.2.3"), tagPage("v2.0.0")),
		});

		await expect(loadLiveTags(client)).resolves.toEqual(["v1.2.3", "v2.0.0"]);
	});

	test("rejects a paginator failure after an earlier tag page", async () => {
		const error = apiError("API rate limit exceeded", 429);
		const client = createClient({
			listTagPages: () => failingTagPages(error, tagPage("v1.2.3")),
		});

		await expect(loadLiveTags(client)).rejects.toBe(error);
	});

	test("rejects malformed paginator data", async () => {
		const client = createClient({
			listTagPages: () => tagPages({ data: [{ ref: 42 }] }),
		});

		await expect(loadLiveTags(client)).rejects.toThrow("Malformed tag entry");
	});
});

describe("loadResolvedReleaseState", () => {
	test.each([39, 41, 63, 65])("rejects a %i-character branch SHA from GitHub", async length => {
		const client = createClient({
			getRef: async () => ({ object: { type: "commit", sha: "a".repeat(length) } }),
		});

		await expect(loadResolvedReleaseState(loadInput, client)).rejects.toThrow("Malformed branch reference SHA");
	});

	test("accepts a 64-character branch SHA", async () => {
		const sha = "a".repeat(64);
		const client = createClient({ getRef: async () => ({ object: { type: "commit", sha } }) });
		const state = await loadResolvedReleaseState(loadInput, client);

		expect(validateResolvedRelease({ ...validationInput, expectedSha: sha }, state)).toMatchObject({ exactTag: "v1.2.3" });
	});

	test("loads a matching release from a later paginated release page", async () => {
		const client = withReleasePages(createClient(), releasePage(releaseRecord("v9.0.0")), releasePage(releaseRecord("v1.2.3")));

		await expect(loadResolvedReleaseState(loadInput, client)).resolves.toMatchObject({ existingRelease: { draft: false, prerelease: false } });
	});

	test("surfaces a visible draft release so validation rejects it", async () => {
		const client = withReleasePages(createClient(), releasePage(releaseRecord("v1.2.3", true)));
		const state = await loadResolvedReleaseState(loadInput, client);

		expect(() => validateResolvedRelease(validationInput, { ...state, exactTagCommit: EXPECTED_SHA })).toThrow("existing release");
	});

	test("rejects duplicate exact-tag releases as ambiguous", async () => {
		const client = withReleasePages(createClient(), releasePage(releaseRecord("v1.2.3")), releasePage(releaseRecord("v1.2.3", true)));

		await expect(loadResolvedReleaseState(loadInput, client)).rejects.toThrow(/ambiguous/i);
	});

	test("rejects an uninspectable release page instead of treating the release as absent", async () => {
		const client = withReleasePages(createClient(), { data: { tag_name: "v1.2.3", draft: true, prerelease: false } });

		await expect(loadResolvedReleaseState(loadInput, client)).rejects.toThrow("Malformed release page");
	});

	test("propagates release pagination failures after an earlier page", async () => {
		const error = apiError("API rate limit exceeded", 429);
		const client = Object.assign(createClient(), {
			listReleasePages: () => failingTagPages(error, releasePage(releaseRecord("v9.0.0"))),
		}) as ReleasePreflightClient;

		await expect(loadResolvedReleaseState(loadInput, client)).rejects.toBe(error);
	});

	test("does not load tags again after resolution", async () => {
		let tagPagesRead = false;
		const client = createClient({
			listTagPages: () => {
				tagPagesRead = true;
				return tagPages(tagPage("v1.2.3"));
			},
		});

		await expect(loadResolvedReleaseState(loadInput, client)).resolves.toEqual({
			exactTag: "v1.2.3",
			branchSha: EXPECTED_SHA,
			exactTagCommit: null,
			existingRelease: null,
		});
		expect(tagPagesRead).toBe(false);
	});

	test("resolves a lightweight exact tag", async () => {
		const client = createClient({
			getRef: async ref => {
				if (ref === "heads/main" || ref === "tags/v1.2.3") {
					return { object: { type: "commit", sha: EXPECTED_SHA } };
				}
				throw apiError(`Reference ${ref} not found`, 404);
			},
		});

		await expect(loadResolvedReleaseState(loadInput, client)).resolves.toMatchObject({ exactTagCommit: EXPECTED_SHA });
	});

	test("peels a real git.getTag data response to its commit", async () => {
		const tagObjectSha = "c".repeat(40);
		const client = createClient({
			getRef: async ref => {
				if (ref === "heads/main") {
					return { object: { type: "commit", sha: EXPECTED_SHA } };
				}
				if (ref === "tags/v1.2.3") {
					return { object: { type: "tag", sha: tagObjectSha } };
				}
				throw apiError(`Reference ${ref} not found`, 404);
			},
			getGitObject: async sha => {
				expect(sha).toBe(tagObjectSha);
				return annotatedTag({ type: "commit", sha: EXPECTED_SHA });
			},
		});

		await expect(loadResolvedReleaseState(loadInput, client)).resolves.toMatchObject({ exactTagCommit: EXPECTED_SHA });
	});

	test("rejects an annotated tag cycle", async () => {
		const tagObjectSha = "c".repeat(40);
		const client = createClient({
			getRef: async ref =>
				ref === "heads/main" ? { object: { type: "commit", sha: EXPECTED_SHA } } : { object: { type: "tag", sha: tagObjectSha } },
			getGitObject: async () => annotatedTag({ type: "tag", sha: tagObjectSha }),
		});

		await expect(loadResolvedReleaseState(loadInput, client)).rejects.toThrow("cycle");
	});

	test("propagates a git.getTag failure", async () => {
		const error = new TypeError("fetch failed");
		const client = createClient({
			getRef: async ref =>
				ref === "heads/main" ? { object: { type: "commit", sha: EXPECTED_SHA } } : { object: { type: "tag", sha: "c".repeat(40) } },
			getGitObject: async () => Promise.reject(error),
		});

		await expect(loadResolvedReleaseState(loadInput, client)).rejects.toBe(error);
	});

	test("treats only a 404 exact tag and release as absent", async () => {
		await expect(loadResolvedReleaseState(loadInput, createClient())).resolves.toMatchObject({ exactTagCommit: null, existingRelease: null });
	});

	test.each([
		["authentication", apiError("Bad credentials", 401)],
		["authorization", apiError("Resource not accessible", 403)],
		["rate limit", apiError("API rate limit exceeded", 429)],
		["timeout", apiError("Request timed out")],
		["transport", new TypeError("fetch failed")],
		["unknown", new Error("unexpected failure")],
	])("propagates %s failures for branch, exact tag, and existing release reads", async (_name, error) => {
		await expect(loadResolvedReleaseState(loadInput, createClient({ getRef: async () => Promise.reject(error) }))).rejects.toBe(error);

		const exactTagClient = createClient({
			getRef: async ref => (ref === "heads/main" ? { object: { type: "commit", sha: EXPECTED_SHA } } : Promise.reject(error)),
		});
		await expect(loadResolvedReleaseState(loadInput, exactTagClient)).rejects.toBe(error);
		await expect(loadResolvedReleaseState(loadInput, createClient({ listReleasePages: () => failingTagPages(error) }))).rejects.toBe(error);
	});

	test.each([
		["branch reference", createClient({ getRef: async () => ({ object: { type: "commit", sha: "not-a-sha" } }) })],
		[
			"annotated tag object",
			createClient({
				getRef: async ref =>
					ref === "heads/main" ? { object: { type: "commit", sha: EXPECTED_SHA } } : { object: { type: "tag", sha: "c".repeat(40) } },
				getGitObject: async () => ({ object: { type: "commit", sha: 42 } }),
			}),
		],
		["release", createClient({ listReleasePages: () => tagPages(releasePage({ tag_name: "v1.2.3", draft: false, prerelease: "false" })) })],
	])("rejects malformed %s responses", async (_name, client) => {
		await expect(loadResolvedReleaseState(loadInput, client)).rejects.toThrow();
	});
});

describe("validateResolvedRelease", () => {
	test("rejects a resolved version whose exact tag was not inspected", async () => {
		const state = await loadResolvedReleaseState(loadInput, createClient());

		expect(() => validateResolvedRelease({ ...validationInput, version: "1.2.4" }, state)).toThrow("inspected exact tag");
	});

	test("rejects a loaded matching tag with a completed release", async () => {
		const client = createClient({
			getRef: async () => ({ object: { type: "commit", sha: EXPECTED_SHA } }),
			listReleasePages: () => tagPages(releasePage(releaseRecord("v1.2.3"))),
		});
		const state = await loadResolvedReleaseState(loadInput, client);

		expect(() => validateResolvedRelease(validationInput, state)).toThrow("already released");
	});

	test("derives matching exact and floating tags from the canonical version", () => {
		expect(
			validateResolvedRelease(validationInput, {
				exactTag: "v1.2.3",
				branchSha: EXPECTED_SHA,
				exactTagCommit: EXPECTED_SHA,
				existingRelease: null,
			}),
		).toEqual({ exactTag: "v1.2.3", floatingTag: "v1", exactTagExists: true });
	});

	test("rejects a stale branch", () => {
		expect(() =>
			validateResolvedRelease(validationInput, {
				exactTag: "v1.2.3",
				branchSha: OTHER_SHA,
				exactTagCommit: null,
				existingRelease: null,
			}),
		).toThrow("current branch head");
	});

	test("rejects an exact tag pointing to another commit", () => {
		expect(() =>
			validateResolvedRelease(validationInput, {
				exactTag: "v1.2.3",
				branchSha: EXPECTED_SHA,
				exactTagCommit: OTHER_SHA,
				existingRelease: null,
			}),
		).toThrow("another commit");
	});

	test.each([
		["draft", { draft: true, prerelease: false }],
		["wrong prerelease state", { draft: false, prerelease: true }],
	])("rejects a %s existing release", (_name, existingRelease) => {
		expect(() =>
			validateResolvedRelease(validationInput, {
				exactTag: "v1.2.3",
				branchSha: EXPECTED_SHA,
				exactTagCommit: EXPECTED_SHA,
				existingRelease,
			}),
		).toThrow("existing release");
	});

	test("rejects an existing release without its exact tag", () => {
		expect(() =>
			validateResolvedRelease(validationInput, {
				exactTag: "v1.2.3",
				branchSha: EXPECTED_SHA,
				exactTagCommit: null,
				existingRelease: { draft: false, prerelease: false },
			}),
		).toThrow("no matching exact tag");
	});

	test("derives prerelease tags for an unfinished release", () => {
		expect(
			validateResolvedRelease(
				{ ...validationInput, version: "1.2.3-rc.4" },
				{
					exactTag: "v1.2.3-rc.4",
					branchSha: EXPECTED_SHA,
					exactTagCommit: EXPECTED_SHA,
					existingRelease: null,
				},
			),
		).toEqual({ exactTag: "v1.2.3-rc.4", floatingTag: "v1", exactTagExists: true });
	});
});
