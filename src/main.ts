// oxlint-disable max-statements
// oxlint-disable import/prefer-default-export
import * as core from "@actions/core";
import * as github from "@actions/github";
import { readFile } from "fs/promises";

import {
	coerceArray,
	formatPreid,
	getCommitCountSinceFileChange,
	getCommitCountSinceMergeBase,
	isLatestStableMajor,
	listTagNames,
	parsePreidBranches,
	resolvePreid,
	resolveTag,
	resolveVersionConflict,
	sanitizeBranchName,
	stripPreid,
} from "./utils";
import type { VersionConflictMode } from "./utils";

function getExistingTags(isPreRel: boolean): string[] {
	if (isPreRel) {
		return [];
	}
	return listTagNames();
}

function getBranchSlug(preidTemplate: string, branch: string): string {
	return preidTemplate.includes("{branch}") ? sanitizeBranchName(branch) : "";
}

function getFormattedPreid(preidTemplate: string, resolvedPreid: string | null, branchSlug: string): string | null {
	return resolvedPreid === null ? null : formatPreid(preidTemplate, resolvedPreid, branchSlug);
}

function getPreidCounter(isPreRel: boolean, counterBaseRef: string, packageJsonPath: string): number {
	if (!isPreRel) {
		return 0;
	}
	return counterBaseRef ? getCommitCountSinceMergeBase(counterBaseRef) : getCommitCountSinceFileChange(packageJsonPath, undefined, '"version":');
}

export async function run(): Promise<void> {
	const branch = github.context.ref.replace("refs/heads/", "");

	let version = core.getInput("version");
	const packageJsonDir = core.getInput("package-json-dir").replace(/^\/+|\/+$/g, "");
	const packageJsonPath = packageJsonDir ? `${packageJsonDir}/package.json` : "package.json";
	const defaultPreid = core.getInput("preid") || "dev";
	const preidDelimiter = core.getInput("preid-num-delimiter") || ".";
	const preidTemplate = core.getInput("preid-template") || "{preid}";
	const counterBaseRef = core.getInput("counter-base-ref");
	const preidBranchesInput = core.getInput("preid-branches");
	const stableBranchesInput = core.getInput("stable-branches");
	const forcePreid = core.getBooleanInput("force-preid");
	const forceStable = core.getBooleanInput("force-stable");
	const onVersionConflict = (core.getInput("on-version-conflict") || "ignore") as VersionConflictMode;
	const tagTmpl = core.getInput("tag-tmpl") || "v{major}";

	if (!version) {
		const repoPkgJson = JSON.parse(await readFile(packageJsonPath, "utf8"));
		({ version } = repoPkgJson);
	}
	let baseVersion = stripPreid(version);
	let fileVersion = baseVersion;

	const preidBranches = parsePreidBranches(
		preidBranchesInput ? coerceArray(preidBranchesInput.split(",")) : ["main:rc", "master:rc", "develop:dev", "vnext:next"],
	);
	const stableBranches = stableBranchesInput ? coerceArray(stableBranchesInput.split(",")) : ["^v\\d+$", "^\\d+\\.x$"];

	let versionSuffix: string | undefined;
	const versionSegments = baseVersion.split(".");
	const [major, minor, initialPatch] = versionSegments;
	let patch = initialPatch;

	const resolvedPreid = resolvePreid({ branch, preidBranches, stableBranches, defaultPreid, forcePreid, forceStable });
	const isPreRel = resolvedPreid !== null;
	const branchSlug = getBranchSlug(preidTemplate, branch);
	const formattedPreid = getFormattedPreid(preidTemplate, resolvedPreid, branchSlug);
	const existingTags = getExistingTags(isPreRel);
	const commitCount = getPreidCounter(isPreRel, counterBaseRef, packageJsonPath);
	core.info(
		`forcePreid: ${forcePreid}, Branch: ${branch}, contextRef: ${github.context.ref}, version: ${version}, commitCount: ${commitCount}, preidBranches: ${JSON.stringify(preidBranches)}, stableBranches: ${JSON.stringify(stableBranches)}`,
	);

	if (isPreRel) {
		core.debug("Use preid for branch");
		versionSuffix = `${formattedPreid}${preidDelimiter}${commitCount}`;

		if (versionSegments.length === 3) {
			fileVersion = `${baseVersion}.${commitCount}`;
		}
	} else if (versionSegments.length === 3) {
		try {
			const result = resolveVersionConflict({
				major: Number(major),
				minor: Number(minor),
				patch: Number(patch),
				tagTmpl,
				mode: onVersionConflict,
				existingTags: onVersionConflict === "ignore" ? [] : existingTags,
			});
			const { baseVersion: bumpedVersion, bumped } = result;
			if (bumped) {
				core.notice(`Version tag conflict for ${baseVersion}. Auto-bumped patch → ${bumpedVersion}`);
				baseVersion = bumpedVersion;
				fileVersion = bumpedVersion;
				patch = String(result.patch);
			}
		} catch (err) {
			core.setFailed((err as Error).message);
			return;
		}
	}

	const buildVersion = versionSuffix ? `${baseVersion}-${versionSuffix}` : baseVersion;
	const preidOutput = formattedPreid ?? "";

	const isLatest = isPreRel ? false : isLatestStableMajor(Number(major), existingTags, tagTmpl);
	const tag = resolveTag({ resolvedPreid: formattedPreid, currentMajor: Number(major), isLatest });

	core.notice(`Version: ${buildVersion}, fileVersion: ${fileVersion}, tag: ${tag}`);
	core.setOutput("version", buildVersion);
	core.setOutput("baseVersion", baseVersion);
	core.setOutput("fileVersion", fileVersion); // 4-part numeric version e.g. '1.0.0.5' on pre-release, '1.0.0' on stable
	core.setOutput("majorVersion", major);
	core.setOutput("minorVersion", minor);
	core.setOutput("patchVersion", patch);
	core.setOutput("preid", preidOutput);
	core.setOutput("preidCounter", isPreRel ? commitCount : "");
	core.setOutput("branchSlug", branchSlug);
	core.setOutput("isPrerelease", isPreRel);
	core.setOutput("isLatest", isLatest);
	core.setOutput("tag", tag);
}
