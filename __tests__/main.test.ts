import * as core from "@actions/core";
import * as github from "@actions/github";
import { expect, test, vi } from "vitest";

import { run } from "../src/main";
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
	expect(core.setOutput).toHaveBeenCalledWith("tag", expected.tag);
});
