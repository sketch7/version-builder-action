import { parseCanonicalVersion, validateGitTag } from "./utils";

const COMMIT_SHA = /^[0-9a-f]{40,64}$/;

export interface ExistingRelease {
	draft: boolean;
	prerelease: boolean;
}

export interface ReleaseState {
	branchSha: string;
	tags: string[];
	exactTagCommit: string | null;
	existingRelease: ExistingRelease | null;
}

export interface ReleaseValidation {
	exactTag: string;
	floatingTag: string;
	exactTagExists: boolean;
}

export interface LoadReleaseStateInput {
	branch: string;
	exactTag: string;
}

export interface ValidateResolvedReleaseInput {
	expectedSha: string;
	version: string;
	exactTag: string;
	floatingTag: string;
}

/**
 * Small GitHub boundary for live preflight checks.
 *
 * The Action adapter maps Octokit responses into these raw Git-object shapes so
 * the release policy can be tested without an Octokit dependency.
 */
export interface ReleasePreflightClient {
	getRef: (ref: string) => Promise<unknown>;
	listTags: (page: number) => Promise<unknown>;
	getGitObject: (sha: string) => Promise<unknown>;
	getReleaseByTag: (tag: string) => Promise<unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function isNotFound(error: unknown): boolean {
	return isRecord(error) && error.status === 404;
}

function readSha(value: unknown, label: string): string {
	if (typeof value !== "string" || !COMMIT_SHA.test(value)) {
		throw new Error(`Malformed ${label} SHA from GitHub`);
	}
	return value;
}

function readObjectReference(value: unknown, label: string): { type: "commit" | "tag"; sha: string } {
	if (!isRecord(value) || !isRecord(value.object)) {
		throw new Error(`Malformed ${label} object from GitHub`);
	}

	const { type, sha } = value.object;
	if (type !== "commit" && type !== "tag") {
		throw new Error(`Malformed ${label} object type from GitHub`);
	}
	return { type, sha: readSha(sha, label) };
}

function readAnnotatedTag(value: unknown): { type: "commit" | "tag"; sha: string } {
	if (!isRecord(value) || value.type !== "tag" || !isRecord(value.object)) {
		throw new Error("Malformed annotated tag object from GitHub");
	}

	const { type, sha } = value.object;
	if (type !== "commit" && type !== "tag") {
		throw new Error("Malformed annotated tag target type from GitHub");
	}
	return { type, sha: readSha(sha, "annotated tag target") };
}

async function resolveTagCommit(client: ReleasePreflightClient, exactTag: string): Promise<string | null> {
	let reference: unknown;
	try {
		reference = await client.getRef(`tags/${exactTag}`);
	} catch (error) {
		if (isNotFound(error)) {
			return null;
		}
		throw error;
	}

	let object = readObjectReference(reference, "exact tag reference");
	const visited = new Set<string>();
	while (object.type === "tag") {
		if (visited.has(object.sha)) {
			throw new Error(`Annotated tag '${exactTag}' contains a cycle`);
		}
		visited.add(object.sha);
		// oxlint-disable-next-line no-await-in-loop -- The next object SHA comes from this response.
		object = readAnnotatedTag(await client.getGitObject(object.sha));
	}
	return object.sha;
}

async function loadTags(client: ReleasePreflightClient): Promise<string[]> {
	const tags: string[] = [];
	for (let page = 1; ; page++) {
		// oxlint-disable-next-line no-await-in-loop -- An empty response ends sequential pagination.
		const response = await client.listTags(page);
		if (!Array.isArray(response)) {
			throw new Error("Malformed tag page from GitHub");
		}
		if (response.length === 0) {
			return tags;
		}

		for (const tag of response) {
			if (!isRecord(tag) || typeof tag.name !== "string" || tag.name.length === 0) {
				throw new Error("Malformed tag entry from GitHub");
			}
			tags.push(tag.name);
		}
	}
}

async function loadExistingRelease(client: ReleasePreflightClient, exactTag: string): Promise<ExistingRelease | null> {
	try {
		const response = await client.getReleaseByTag(exactTag);
		if (!isRecord(response) || typeof response.draft !== "boolean" || typeof response.prerelease !== "boolean") {
			throw new Error("Malformed release response from GitHub");
		}
		return { draft: response.draft, prerelease: response.prerelease };
	} catch (error) {
		if (isNotFound(error)) {
			return null;
		}
		throw error;
	}
}

export async function loadReleaseState(input: LoadReleaseStateInput, client: ReleasePreflightClient): Promise<ReleaseState> {
	const branchReference = readObjectReference(await client.getRef(`heads/${input.branch}`), "branch reference");
	if (branchReference.type !== "commit") {
		throw new Error("Malformed branch reference target from GitHub");
	}

	const [tags, exactTagCommit, existingRelease] = await Promise.all([
		loadTags(client),
		resolveTagCommit(client, input.exactTag),
		loadExistingRelease(client, input.exactTag),
	]);
	return { branchSha: branchReference.sha, tags, exactTagCommit, existingRelease };
}

export function validateResolvedRelease(input: ValidateResolvedReleaseInput, state: ReleaseState): ReleaseValidation {
	const canonicalVersion = parseCanonicalVersion(input.version);
	validateGitTag(input.exactTag);
	validateGitTag(input.floatingTag);
	const expectedSha = readSha(input.expectedSha, "expected commit");

	if (state.branchSha !== expectedSha) {
		throw new Error(`Release SHA '${expectedSha}' is not the current branch head`);
	}
	if (state.exactTagCommit !== null && state.exactTagCommit !== expectedSha) {
		throw new Error(`Exact tag '${input.exactTag}' points to another commit`);
	}
	if (state.existingRelease !== null) {
		if (state.exactTagCommit === null) {
			throw new Error(`existing release for '${input.exactTag}' has no matching exact tag`);
		}
		if (state.existingRelease.draft || state.existingRelease.prerelease !== canonicalVersion.isPrerelease) {
			throw new Error(`existing release for '${input.exactTag}' is not a matching published release`);
		}
	}

	return {
		exactTag: input.exactTag,
		floatingTag: input.floatingTag,
		exactTagExists: state.exactTagCommit !== null,
	};
}
