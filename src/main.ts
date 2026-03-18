import * as core from "@actions/core"
import * as github from "@actions/github"
import { readFile } from "fs/promises"
import { coerceArray, parsePreidBranches, resolvePreid } from "./utils"

export async function run(): Promise<void> {
	const branch = github.context.ref.replace("refs/heads/", "")
	const runNumber = github.context.runNumber

	let version = core.getInput("version")
	const defaultPreid = core.getInput("preid") || "dev"
	const preidDelimiter = core.getInput("preid-num-delimiter") || "."
	const preidBranchesInput = core.getInput("preid-branches")
	const stableBranchesInput = core.getInput("stable-branches")
	const forcePreid = core.getBooleanInput("force-preid")
	const forceStable = core.getBooleanInput("force-stable")

	if (!version) {
		const repoPkgJson = JSON.parse(await readFile("./package.json", "utf8"))
		version = repoPkgJson.version
	}
	let nonSemverVersion = version

	const preidBranches = parsePreidBranches(
		preidBranchesInput ? coerceArray(preidBranchesInput.split(",")) : ["main:rc", "master:rc", "develop:dev", "vnext:next"],
	)
	const stableBranches = stableBranchesInput ? coerceArray(stableBranchesInput.split(",")) : ["^v\\d+$", "^\\d+\\.x$"]

	core.info(
		`forcePreid: ${forcePreid}, Branch: ${branch}, contextRef: ${github.context.ref}, version: ${version}, runNumber: ${runNumber}, preidBranches: ${JSON.stringify(preidBranches)}, stableBranches: ${JSON.stringify(stableBranches)}`,
	)

	let versionSuffix: string | undefined
	const versionSegments = version.split(".")
	const [major, minor, patch] = versionSegments

	const resolvedPreid = resolvePreid({ branch, preidBranches, stableBranches, defaultPreid, forcePreid, forceStable })
	const isPreRel = resolvedPreid !== null
	if (isPreRel) {
		core.debug("Use preid for branch")
		// todo: handle version with existing preid e.g. 1.0.0-rc.1 and increment the number instead of always starting from 1
		versionSuffix = `${resolvedPreid}${preidDelimiter}${runNumber}`

		if (versionSegments.length === 3) {
			nonSemverVersion = `${version}.${runNumber}`
		}
	}

	const buildVersion = versionSuffix ? `${version}-${versionSuffix}` : version
	const preidOutput = isPreRel ? resolvedPreid : ""
	// todo: add tag output similar to preid however it considers stable branches as well e.g. v1 and v2, when v2 is latest will be latest and v1 will be v1-lts

	core.notice(`Version: ${buildVersion}, nonSemverVersion: ${nonSemverVersion}`)
	core.setOutput("version", buildVersion)
	core.setOutput("nonSemverVersion", nonSemverVersion) // omits the preid and returns just numbers e.g. '1.0.0'
	core.setOutput("majorVersion", major)
	core.setOutput("minorVersion", minor)
	core.setOutput("patchVersion", patch)
	core.setOutput("preid", preidOutput)
	core.setOutput("isPrerelease", isPreRel)
}
