import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, expect, test } from "vitest";

import { isVersionOnlyBump } from "../src/version-only-bump";

const directories: string[] = [];
afterEach(() => {
	for (const directory of directories.splice(0)) {
		rmSync(directory, { recursive: true, force: true });
	}
});

function fixture(packageJsonPath = "package.json"): {
	cwd: string;
	git: (...args: string[]) => string;
	write: (path: string, content: unknown) => void;
	commit: () => string;
	before: string;
	packageJsonPath: string;
} {
	const cwd = mkdtempSync(join(tmpdir(), "version-bump-"));
	directories.push(cwd);
	const git = (...args: string[]): string => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
	const write = (path: string, content: unknown): void => {
		mkdirSync(dirname(join(cwd, path)), { recursive: true });
		writeFileSync(join(cwd, path), JSON.stringify(content));
	};
	const commit = (): string => {
		git("add", ".");
		git("-c", "user.name=Test", "-c", "user.email=test@example.test", "commit", "-qm", "test");
		return git("rev-parse", "HEAD");
	};
	git("init", "-q");
	write(packageJsonPath, { name: "test", version: "1.2.3", dependencies: { example: "1" } });
	const before = commit();
	return { cwd, git, write, commit, before, packageJsonPath };
}

test("recognizes a next-minor-only push, including nested version ownership", () => {
	for (const path of ["package.json", "src/management/package.json"]) {
		const f = fixture(path);
		f.write(path, { name: "test", version: "1.3.0", dependencies: { example: "1" } });
		expect(isVersionOnlyBump({ ...f, eventName: "push", ref: "refs/heads/main", defaultBranch: "main", sha: f.commit() })).toBe(true);
	}
});

test.each([
	{ name: "dependency change", version: "1.3.0", dependency: "2" },
	{ name: "patch bump", version: "1.2.4", dependency: "1" },
	{ name: "major bump", version: "2.0.0", dependency: "1" },
])("does not skip $name", ({ version, dependency }) => {
	const f = fixture();
	f.write("package.json", { name: "test", version, dependencies: { example: dependency } });
	expect(isVersionOnlyBump({ ...f, eventName: "push", ref: "refs/heads/main", defaultBranch: "main", sha: f.commit() })).toBe(false);
});

test("checks the entire push range, not only the final bump commit", () => {
	const f = fixture();
	f.write("code.json", { changed: true });
	f.commit();
	f.write("package.json", { name: "test", version: "1.3.0", dependencies: { example: "1" } });
	const sha = f.commit();
	expect(isVersionOnlyBump({ ...f, eventName: "push", ref: "refs/heads/main", defaultBranch: "main", sha })).toBe(false);
});

test("does not skip file-mode changes bundled with a version bump", () => {
	const f = fixture();
	f.write("package.json", { name: "test", version: "1.3.0", dependencies: { example: "1" } });
	f.git("add", ".");
	f.git("update-index", "--chmod=+x", "package.json");
	f.git("-c", "user.name=Test", "-c", "user.email=test@example.test", "commit", "-qm", "bump and mode");
	expect(isVersionOnlyBump({ ...f, eventName: "push", ref: "refs/heads/main", defaultBranch: "main", sha: f.git("rev-parse", "HEAD") })).toBe(false);
});

test.each(["package-lock.json", "npm-shrinkwrap.json"])("allows only root-version updates in %s", file => {
	const f = fixture();
	const lock = (version: string, dependency = "1"): Record<string, unknown> => ({
		version,
		lockfileVersion: 3,
		packages: { "": { version }, "node_modules/example": { version: dependency } },
	});
	f.write(file, lock("1.2.3"));
	const before = f.commit();
	f.write("package.json", { name: "test", version: "1.3.0", dependencies: { example: "1" } });
	f.write(file, lock("1.3.0"));
	const context = { ...f, before, eventName: "push", ref: "refs/heads/main", defaultBranch: "main", sha: f.commit() };
	expect(isVersionOnlyBump(context)).toBe(true);
	f.write(file, lock("1.3.0", "2"));
	expect(isVersionOnlyBump({ ...context, sha: f.commit() })).toBe(false);
});

test("rejects an added lockfile and unavailable history", () => {
	const f = fixture();
	f.write("package.json", { name: "test", version: "1.3.0", dependencies: { example: "1" } });
	f.write("package-lock.json", { version: "1.3.0" });
	const context = { ...f, eventName: "push", ref: "refs/heads/main", defaultBranch: "main", sha: f.commit() };
	expect(isVersionOnlyBump(context)).toBe(false);
	expect(isVersionOnlyBump({ ...context, before: "f".repeat(40) })).toBe(false);
});

test("never skips PRs, manual runs, other branches or branch creation", () => {
	const f = fixture();
	f.write("package.json", { name: "test", version: "1.3.0", dependencies: { example: "1" } });
	const context = { ...f, eventName: "push", ref: "refs/heads/main", defaultBranch: "main", sha: f.commit() };
	for (const override of [
		{ eventName: "pull_request" },
		{ eventName: "workflow_dispatch" },
		{ ref: "refs/heads/v1" },
		{ defaultBranch: "" },
		{ before: "0".repeat(40) },
	]) {
		expect(isVersionOnlyBump({ ...context, ...override })).toBe(false);
	}
});
