import * as core from "@actions/core";
import * as github from "@actions/github";
import { describe, expect, test, vi } from "vitest";

import { run } from "../src/main";
import { getCommitCountSinceFileChange, listTagNames } from "../src/utils";
// oxlint-disable-next-line import/no-namespace -- Required for Vitest importOriginal<typeof utils>()
import type * as utils from "../src/utils";

vi.mock("@actions/core");
vi.mock("@actions/github", () => ({
	context: { ref: "refs/heads/feature/my-workflow" },
}));
vi.mock("../src/utils", async importOriginal => {
	const actual = await importOriginal<typeof utils>();
	return {
		...actual,
		getCommitCountSinceFileChange: vi.fn().mockReturnValue(0),
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
