import { execFileSync } from "node:child_process";
import { posix } from "node:path";
import { isDeepStrictEqual } from "node:util";

export interface BumpContext {
	eventName: string;
	ref: string;
	defaultBranch: string;
	before: string;
	sha: string;
	packageJsonPath: string;
	cwd?: string;
}

function object(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error("Expected JSON object");
	}
	return value as Record<string, unknown>;
}

function stripLockVersion(lock: Record<string, unknown>, version: string): void {
	if (lock.version !== version) {
		throw new Error("Lockfile version does not match package");
	}
	delete lock.version;
	if (lock.packages !== undefined) {
		const packages = object(lock.packages);
		const root = object(packages[""]);
		if (root.version !== version) {
			throw new Error("Lockfile root version does not match package");
		}
		delete root.version;
	}
}

export function isVersionOnlyBump(context: BumpContext): boolean {
	const { eventName, ref, defaultBranch, before, sha, cwd } = context;
	const packageJsonPath = posix.normalize(context.packageJsonPath);
	const commit = /^(?!0+$)[0-9a-f]{40}(?:[0-9a-f]{24})?$/;
	if (
		eventName !== "push" ||
		!defaultBranch ||
		ref !== `refs/heads/${defaultBranch}` ||
		!commit.test(before) ||
		!commit.test(sha) ||
		packageJsonPath.includes("\\") ||
		posix.isAbsolute(packageJsonPath) ||
		packageJsonPath.split("/").includes("..")
	) {
		return false;
	}
	const git = (...args: string[]): string => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
	try {
		// A version-only bump cannot add/remove files or alter executable/symlink modes.
		if (git("diff", "--summary", "--no-renames", before, sha, "--").trim()) {
			return false;
		}
		const locks = ["package-lock.json", "npm-shrinkwrap.json"].map(file => posix.join(posix.dirname(packageJsonPath), file));
		const changed = git("diff", "--name-only", "--no-renames", "-z", before, sha, "--").split("\0").filter(Boolean);
		if (!changed.includes(packageJsonPath) || changed.some(file => file !== packageJsonPath && !locks.includes(file))) {
			return false;
		}
		const read = (revision: string, file: string): Record<string, unknown> => object(JSON.parse(git("show", `${revision}:${file}`)));
		const oldPackage = read(before, packageJsonPath);
		const newPackage = read(sha, packageJsonPath);
		const { version: oldVersion } = oldPackage;
		const { version: newVersion } = newPackage;
		if (typeof oldVersion !== "string" || !/^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/.test(oldVersion)) {
			return false;
		}
		const [major, minor = "0"] = oldVersion.split(".");
		const nextVersion = `${major}.${BigInt(minor) + 1n}.0`;
		if (newVersion !== nextVersion) {
			return false;
		}
		delete oldPackage.version;
		delete newPackage.version;
		if (!isDeepStrictEqual(oldPackage, newPackage)) {
			return false;
		}
		for (const file of changed.filter(name => locks.includes(name))) {
			const oldLock = read(before, file);
			const newLock = read(sha, file);
			stripLockVersion(oldLock, oldVersion);
			stripLockVersion(newLock, nextVersion);
			if (!isDeepStrictEqual(oldLock, newLock)) {
				return false;
			}
		}
		return true;
	} catch {
		// Uncertain history or metadata must never suppress a real release.
		return false;
	}
}
