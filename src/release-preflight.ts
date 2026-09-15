import { compareDecimalStrings, formatReleaseTags, parseCanonicalVersion, validateGitTag } from "./utils";

const COMMIT_SHA = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;
const TAG_REF_PREFIX = "refs/tags/";

export interface ExistingRelease {
	draft: boolean;
	prerelease: boolean;
}

export interface ReleaseState {
	exactTag: string;
	branchSha: string;
	exactTagCommit: string | null;
	existingRelease: ExistingRelease | null;
}

export interface ReleaseValidation {
	exactTag: string;
	floatingTag: string;
	exactTagExists: boolean;
}

export interface LoadResolvedReleaseStateInput {
	branch: string;
	exactTag: string;
}

export interface ValidateResolvedReleaseInput {
	expectedSha: string;
	version: string;
	tagTmpl: string;
}

/**
 * GitHub boundary for live release preflight checks.
 *
 * `listTagPages` and `listReleasePages` accept Octokit's paginator directly.
 * `getRef` and `getGitObject` return each endpoint's `.data`, keeping policy
 * independent of Octokit types.
 */
export interface ReleasePreflightClient {
	getRef: (ref: string) => Promise<unknown>;
	listTagPages: () => AsyncIterable<unknown>;
	getGitObject: (sha: string) => Promise<unknown>;
	listReleasePages: () => AsyncIterable<unknown>;
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

function readPage(value: unknown, label: string): unknown[] {
	if (Array.isArray(value)) {
		return value;
	}
	if (isRecord(value) && Array.isArray(value.data)) {
		return value.data;
	}
	throw new Error(`Malformed ${label} page from GitHub`);
}

function readTagName(value: unknown): string {
	if (!isRecord(value)) {
		throw new Error("Malformed tag entry from GitHub");
	}
	if (typeof value.name === "string" && value.name.length > 0) {
		return value.name;
	}
	if (typeof value.ref === "string" && value.ref.startsWith(TAG_REF_PREFIX) && value.ref.length > TAG_REF_PREFIX.length) {
		return value.ref.slice(TAG_REF_PREFIX.length);
	}
	throw new Error("Malformed tag entry from GitHub");
}

function readRelease(value: unknown): { tagName: string; release: ExistingRelease } {
	if (
		!isRecord(value) ||
		typeof value.tag_name !== "string" ||
		value.tag_name.length === 0 ||
		typeof value.draft !== "boolean" ||
		typeof value.prerelease !== "boolean"
	) {
		throw new Error("Malformed release entry from GitHub");
	}
	return { tagName: value.tag_name, release: { draft: value.draft, prerelease: value.prerelease } };
}

/** Loads the authoritative complete tag set before resolving a release version. */
export async function loadLiveTags(client: ReleasePreflightClient): Promise<string[]> {
	const tags: string[] = [];
	for await (const page of client.listTagPages()) {
		for (const tag of readPage(page, "tag")) {
			tags.push(readTagName(tag));
		}
	}
	return tags;
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
		object = readObjectReference(await client.getGitObject(object.sha), "annotated tag");
	}
	return object.sha;
}

async function loadExistingRelease(client: ReleasePreflightClient, exactTag: string): Promise<ExistingRelease | null> {
	let matchingRelease: ExistingRelease | null = null;
	for await (const page of client.listReleasePages()) {
		for (const value of readPage(page, "release")) {
			const { tagName, release } = readRelease(value);
			if (tagName !== exactTag) {
				continue;
			}
			if (matchingRelease !== null) {
				throw new Error(`Ambiguous releases for '${exactTag}'`);
			}
			matchingRelease = release;
		}
	}
	return matchingRelease;
}

/** Inspects only the state that can be evaluated after the exact version is resolved. */
export async function loadResolvedReleaseState(input: LoadResolvedReleaseStateInput, client: ReleasePreflightClient): Promise<ReleaseState> {
	validateGitTag(input.exactTag);
	const branchReference = readObjectReference(await client.getRef(`heads/${input.branch}`), "branch reference");
	if (branchReference.type !== "commit") {
		throw new Error("Malformed branch reference target from GitHub");
	}

	const [exactTagCommit, existingRelease] = await Promise.all([
		resolveTagCommit(client, input.exactTag),
		loadExistingRelease(client, input.exactTag),
	]);
	return { exactTag: input.exactTag, branchSha: branchReference.sha, exactTagCommit, existingRelease };
}

/** Finds an already allocated stable version for this commit before allocating another patch. */
export async function findReleaseAtCommit(
	input: ValidateResolvedReleaseInput & { branch: string },
	tags: string[],
	client: ReleasePreflightClient,
): Promise<{ version: string; state: ReleaseState } | null> {
	const base = parseCanonicalVersion(input.version);
	formatReleaseTags(input.version, input.tagTmpl);
	const [prefix, suffix] = input.tagTmpl.split("{major}");
	const versions = tags
		.flatMap(tag => {
			if (!tag.startsWith(prefix) || !tag.endsWith(suffix)) {
				return [];
			}
			try {
				const candidate = parseCanonicalVersion(tag.slice(prefix.length, suffix ? -suffix.length : undefined));
				return !candidate.isPrerelease &&
					candidate.major === base.major &&
					candidate.minor === base.minor &&
					compareDecimalStrings(candidate.patch, base.patch) >= 0
					? [candidate]
					: [];
			} catch {
				return [];
			}
		})
		.sort((left, right) => compareDecimalStrings(right.patch, left.patch));
	for (const candidate of versions) {
		const { exactTag } = formatReleaseTags(candidate.version, input.tagTmpl);
		// oxlint-disable-next-line no-await-in-loop -- Stop at the matching allocation; API failures must propagate.
		if ((await resolveTagCommit(client, exactTag)) !== input.expectedSha) {
			continue;
		}
		// oxlint-disable-next-line no-await-in-loop -- Inspect release state only for a matching commit.
		const state = await loadResolvedReleaseState({ branch: input.branch, exactTag }, client);
		validateResolvedRelease({ ...input, version: candidate.version }, state);
		return { version: candidate.version, state };
	}
	return null;
}

export function validateResolvedRelease(input: ValidateResolvedReleaseInput, state: ReleaseState): ReleaseValidation {
	const canonicalVersion = parseCanonicalVersion(input.version);
	const { exactTag, floatingTag } = formatReleaseTags(canonicalVersion.version, input.tagTmpl);
	const expectedSha = readSha(input.expectedSha, "expected commit");

	if (state.branchSha !== expectedSha) {
		throw new Error(`Release SHA '${expectedSha}' is not the current branch head`);
	}
	if (state.exactTag !== exactTag) {
		throw new Error(`Resolved exact tag '${exactTag}' does not match the inspected exact tag '${state.exactTag}'`);
	}
	if (state.exactTagCommit !== null && state.exactTagCommit !== expectedSha) {
		throw new Error(`Exact tag '${exactTag}' points to another commit`);
	}
	if (state.existingRelease !== null) {
		if (state.exactTagCommit === null) {
			throw new Error(`existing release for '${exactTag}' has no matching exact tag`);
		}
		if (state.existingRelease.draft || state.existingRelease.prerelease !== canonicalVersion.isPrerelease) {
			throw new Error(`existing release for '${exactTag}' is not a matching published release`);
		}
		throw new Error(`Version '${input.version}' is already released from this commit`);
	}

	return { exactTag, floatingTag, exactTagExists: state.exactTagCommit !== null };
}
