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
		getReleaseByTag: async () => {
			throw apiError("Release not found", 404);
		},
		...overrides,
	};
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
	test("does not load tags again after resolution", async () => {
		let tagPagesRead = false;
		const client = createClient({
			listTagPages: () => {
				tagPagesRead = true;
				return tagPages(tagPage("v1.2.3"));
			},
		});

		await expect(loadResolvedReleaseState(loadInput, client)).resolves.toEqual({
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
		await expect(loadResolvedReleaseState(loadInput, createClient({ getReleaseByTag: async () => Promise.reject(error) }))).rejects.toBe(error);
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
		["release", createClient({ getReleaseByTag: async () => ({ draft: false, prerelease: "false" }) })],
	])("rejects malformed %s responses", async (_name, client) => {
		await expect(loadResolvedReleaseState(loadInput, client)).rejects.toThrow();
	});
});

describe("validateResolvedRelease", () => {
	test("derives matching exact and floating tags from the canonical version", () => {
		expect(
			validateResolvedRelease(validationInput, {
				branchSha: EXPECTED_SHA,
				exactTagCommit: EXPECTED_SHA,
				existingRelease: { draft: false, prerelease: false },
			}),
		).toEqual({ exactTag: "v1.2.3", floatingTag: "v1", exactTagExists: true });
	});

	test("rejects a stale branch", () => {
		expect(() =>
			validateResolvedRelease(validationInput, {
				branchSha: OTHER_SHA,
				exactTagCommit: null,
				existingRelease: null,
			}),
		).toThrow("current branch head");
	});

	test("rejects an exact tag pointing to another commit", () => {
		expect(() =>
			validateResolvedRelease(validationInput, {
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
				branchSha: EXPECTED_SHA,
				exactTagCommit: EXPECTED_SHA,
				existingRelease,
			}),
		).toThrow("existing release");
	});

	test("rejects an existing release without its exact tag", () => {
		expect(() =>
			validateResolvedRelease(validationInput, {
				branchSha: EXPECTED_SHA,
				exactTagCommit: null,
				existingRelease: { draft: false, prerelease: false },
			}),
		).toThrow("no matching exact tag");
	});

	test("derives prerelease tags and requires a prerelease release", () => {
		expect(
			validateResolvedRelease(
				{ ...validationInput, version: "1.2.3-rc.4" },
				{
					branchSha: EXPECTED_SHA,
					exactTagCommit: EXPECTED_SHA,
					existingRelease: { draft: false, prerelease: true },
				},
			),
		).toEqual({ exactTag: "v1.2.3-rc.4", floatingTag: "v1", exactTagExists: true });
	});
});
