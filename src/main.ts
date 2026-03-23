import * as core from "@actions/core";
import * as github from "@actions/github";
import { readFile } from "fs/promises";

import {
	coerceArray,
	getCommitCountSinceFileChange,
	listRemoteBranchNames,
	matchesBranchPattern,
	parsePreidBranches,
	resolvePreid,
	resolveTag,
	stripPreid,
} from "./utils";

export async function run(): Promise<void> {
	const branch = github.context.ref.replace("refs/heads/", "");

	let version = core.getInput("version");
	const defaultPreid = core.getInput("preid") || "dev";
	const preidDelimiter = core.getInput("preid-num-delimiter") || ".";
	const preidBranchesInput = core.getInput("preid-branches");
	const stableBranchesInput = core.getInput("stable-branches");
	const forcePreid = core.getBooleanInput("force-preid");
	const forceStable = core.getBooleanInput("force-stable");

	if (!version) {
		const repoPkgJson = JSON.parse(await readFile("./package.json", "utf8"));
		version = repoPkgJson.version;
	}
	const baseVersion = stripPreid(version);
	let fileVersion = baseVersion;

	const preidBranches = parsePreidBranches(
		preidBranchesInput ? coerceArray(preidBranchesInput.split(",")) : ["main:rc", "master:rc", "develop:dev", "vnext:next"],
	);
	const stableBranches = stableBranchesInput ? coerceArray(stableBranchesInput.split(",")) : ["^v\\d+$", "^\\d+\\.x$"];

	let versionSuffix: string | undefined;
	const versionSegments = baseVersion.split(".");
	const [major, minor, patch] = versionSegments;

	const resolvedPreid = resolvePreid({ branch, preidBranches, stableBranches, defaultPreid, forcePreid, forceStable });
	const isPreRel = resolvedPreid !== null;
	const commitCount = isPreRel ? getCommitCountSinceFileChange("package.json", undefined, '"version":') : 0;
	core.info(
		`forcePreid: ${forcePreid}, Branch: ${branch}, contextRef: ${github.context.ref}, version: ${version}, commitCount: ${commitCount}, preidBranches: ${JSON.stringify(preidBranches)}, stableBranches: ${JSON.stringify(stableBranches)}`,
	);

	if (isPreRel) {
		core.debug("Use preid for branch");
		versionSuffix = `${resolvedPreid}${preidDelimiter}${commitCount}`;

		if (versionSegments.length === 3) {
			fileVersion = `${baseVersion}.${commitCount}`;
		}
	}

	const buildVersion = versionSuffix ? `${baseVersion}-${versionSuffix}` : baseVersion;
	const preidOutput = isPreRel ? resolvedPreid : "";

	const stableBranchNames = isPreRel ? [] : listRemoteBranchNames().filter(name => matchesBranchPattern(name, stableBranches));
	const tag = resolveTag({ resolvedPreid, branch, stableBranchNames });

	core.notice(`Version: ${buildVersion}, fileVersion: ${fileVersion}, tag: ${tag}`);
	core.setOutput("version", buildVersion);
	core.setOutput("baseVersion", baseVersion);
	core.setOutput("fileVersion", fileVersion); // 4-part numeric version e.g. '1.0.0.5' on pre-release, '1.0.0' on stable
	core.setOutput("majorVersion", major);
	core.setOutput("minorVersion", minor);
	core.setOutput("patchVersion", patch);
	core.setOutput("preid", preidOutput);
	core.setOutput("preidCounter", isPreRel ? commitCount : "");
	core.setOutput("isPrerelease", isPreRel);
	core.setOutput("tag", tag);
}
