import { describe, expect, test } from "vitest";

import { loadReleaseState, validateResolvedRelease } from "../src/release-preflight";
import type { ReleasePreflightClient } from "../src/release-preflight";

const EXPECTED_SHA = "a".repeat(40);
const OTHER_SHA = "b".repeat(40);

interface ApiError extends Error {
	status?: number;
}

function apiError(message: string, status?: number): ApiError {
	return Object.assign(new Error(message), { status });
}

function createClient(overrides: Partial<ReleasePreflightClient> = {}): ReleasePreflightClient {
	return {
		getRef: async ref => {
			if (ref === "heads/main") {
				return { object: { type: "commit", sha: EXPECTED_SHA } };
			}
			throw apiError(`Reference ${ref} not found`, 404);
		},
		listTags: async page => (page === 1 ? [{ name: "v1.2.3" }] : []),
		getGitObject: async sha => ({ type: "commit", sha }),
		getReleaseByTag: async () => {
			throw apiError("Release not found", 404);
		},
		...overrides,
	};
}

const loadInput = {
	branch: "main",
	exactTag: "v1.2.3",
};

const validationInput = {
	expectedSha: EXPECTED_SHA,
	version: "1.2.3",
	exactTag: "v1.2.3",
	floatingTag: "v1",
};

describe("loadReleaseState", () => {
	test("loads every tag page and the current branch head", async () => {
		const pages: number[] = [];
		const client = createClient({
			listTags: async page => {
				pages.push(page);
				return page === 1 ? [{ name: "v1.2.3" }] : page === 2 ? [{ name: "v2.0.0" }] : [];
			},
		});

		await expect(loadReleaseState(loadInput, client)).resolves.toEqual({
			branchSha: EXPECTED_SHA,
			tags: ["v1.2.3", "v2.0.0"],
			exactTagCommit: null,
			existingRelease: null,
		});
		expect(pages).toEqual([1, 2, 3]);
	});

	test("resolves a lightweight exact tag", async () => {
		const client = createClient({
			getRef: async ref => {
				if (ref === "heads/main") {
					return { object: { type: "commit", sha: EXPECTED_SHA } };
				}
				if (ref === "tags/v1.2.3") {
					return { object: { type: "commit", sha: EXPECTED_SHA } };
				}
				throw apiError(`Reference ${ref} not found`, 404);
			},
		});

		await expect(loadReleaseState(loadInput, client)).resolves.toMatchObject({ exactTagCommit: EXPECTED_SHA });
	});

	test("peels an annotated exact tag to its commit", async () => {
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
				return { type: "tag", tag: "v1.2.3", object: { type: "commit", sha: EXPECTED_SHA } };
			},
		});

		await expect(loadReleaseState(loadInput, client)).resolves.toMatchObject({ exactTagCommit: EXPECTED_SHA });
	});

	test("rejects an annotated tag cycle", async () => {
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
			getGitObject: async () => ({ type: "tag", object: { type: "tag", sha: tagObjectSha } }),
		});

		await expect(loadReleaseState(loadInput, client)).rejects.toThrow("cycle");
	});

	test("treats only a 404 exact tag and release as absent", async () => {
		await expect(loadReleaseState(loadInput, createClient())).resolves.toMatchObject({
			exactTagCommit: null,
			existingRelease: null,
		});
	});

	test.each([
		["authentication", apiError("Bad credentials", 401)],
		["authorization", apiError("Resource not accessible", 403)],
		["rate limit", apiError("API rate limit exceeded", 429)],
		["timeout", apiError("Request timed out")],
		["transport", new TypeError("fetch failed")],
		["unknown", new Error("unexpected failure")],
	])("propagates %s failures instead of treating the tag as absent", async (_name, error) => {
		await expect(loadReleaseState(loadInput, createClient({ getRef: async () => Promise.reject(error) }))).rejects.toBe(error);
	});

	test.each([
		["authentication", apiError("Bad credentials", 401)],
		["authorization", apiError("Resource not accessible", 403)],
		["rate limit", apiError("API rate limit exceeded", 429)],
		["timeout", apiError("Request timed out")],
		["transport", new TypeError("fetch failed")],
		["unknown", new Error("unexpected failure")],
	])("propagates %s failures when loading the exact tag", async (_name, error) => {
		const client = createClient({
			getRef: async ref => (ref === "heads/main" ? { object: { type: "commit", sha: EXPECTED_SHA } } : Promise.reject(error)),
		});

		await expect(loadReleaseState(loadInput, client)).rejects.toBe(error);
	});

	test.each([
		["authentication", apiError("Bad credentials", 401)],
		["authorization", apiError("Resource not accessible", 403)],
		["rate limit", apiError("API rate limit exceeded", 429)],
		["timeout", apiError("Request timed out")],
		["transport", new TypeError("fetch failed")],
		["unknown", new Error("unexpected failure")],
	])("propagates %s failures when loading the existing release", async (_name, error) => {
		await expect(loadReleaseState(loadInput, createClient({ getReleaseByTag: async () => Promise.reject(error) }))).rejects.toBe(error);
	});

	test.each([
		["branch reference", createClient({ getRef: async () => ({ object: { type: "commit", sha: "not-a-sha" } }) })],
		["tag page", createClient({ listTags: async () => [{ name: 42 }] })],
		[
			"annotated tag object",
			createClient({
				getRef: async ref =>
					ref === "heads/main" ? { object: { type: "commit", sha: EXPECTED_SHA } } : { object: { type: "tag", sha: "c".repeat(40) } },
				getGitObject: async () => ({ type: "tag", object: { type: "commit", sha: 42 } }),
			}),
		],
		["release", createClient({ getReleaseByTag: async () => ({ draft: false, prerelease: "false" }) })],
	])("rejects malformed %s responses", async (_name, client) => {
		await expect(loadReleaseState(loadInput, client)).rejects.toThrow();
	});
});

describe("validateResolvedRelease", () => {
	test("permits recovery when the exact tag and release already match", () => {
		expect(
			validateResolvedRelease(validationInput, {
				branchSha: EXPECTED_SHA,
				tags: ["v1.2.3"],
				exactTagCommit: EXPECTED_SHA,
				existingRelease: { draft: false, prerelease: false },
			}),
		).toEqual({ exactTag: "v1.2.3", floatingTag: "v1", exactTagExists: true });
	});

	test("rejects a stale branch", () => {
		expect(() =>
			validateResolvedRelease(validationInput, {
				branchSha: OTHER_SHA,
				tags: [],
				exactTagCommit: null,
				existingRelease: null,
			}),
		).toThrow("current branch head");
	});

	test("rejects an exact tag pointing to another commit", () => {
		expect(() =>
			validateResolvedRelease(validationInput, {
				branchSha: EXPECTED_SHA,
				tags: ["v1.2.3"],
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
				tags: ["v1.2.3"],
				exactTagCommit: EXPECTED_SHA,
				existingRelease,
			}),
		).toThrow("existing release");
	});

	test("rejects an existing release without its exact tag", () => {
		expect(() =>
			validateResolvedRelease(validationInput, {
				branchSha: EXPECTED_SHA,
				tags: [],
				exactTagCommit: null,
				existingRelease: { draft: false, prerelease: false },
			}),
		).toThrow("no matching exact tag");
	});

	test("requires an existing prerelease release to be marked prerelease", () => {
		expect(
			validateResolvedRelease(
				{ ...validationInput, version: "1.2.3-rc.4", exactTag: "v1.2.3-rc.4" },
				{
					branchSha: EXPECTED_SHA,
					tags: ["v1.2.3-rc.4"],
					exactTagCommit: EXPECTED_SHA,
					existingRelease: { draft: false, prerelease: true },
				},
			),
		).toEqual({ exactTag: "v1.2.3-rc.4", floatingTag: "v1", exactTagExists: true });
	});
});
