import * as core from "@actions/core"
import * as github from "@actions/github"
import { readFile } from "fs/promises"
import { coerceArray, isPrerelease } from "./utils"

export async function run(): Promise<void> {
	const branch = github.context.ref.replace("refs/heads/", "")
	const runNumber = github.context.runNumber

	let version = core.getInput("version")
	const preid = core.getInput("preid") || "dev"
	const preidDelimiter = core.getInput("preid-num-delimiter") || "."
	const preidBranchesInput = core.getInput("preid-branches")
	const isForcePreid = core.getBooleanInput("force-preid")
	const isForceStable = core.getBooleanInput("force-stable")

	if (!version) {
		const repoPkgJson = JSON.parse(await readFile("./package.json", "utf8"))
		version = repoPkgJson.version
	}
	let nonSemverVersion = version

	// todo: configurable preid for branches e.g. master=rc, develop=dev
	const preidBranches = preidBranchesInput
		? coerceArray(preidBranchesInput.split(","))
		: ["main", "master", "develop"]

	core.info(
		`isForcePreid: ${isForcePreid}, Branch: ${branch}, ContextRef: ${github.context.ref}, Version: ${version}, RunNumber: ${runNumber}, PreidBranches: ${preidBranches}`
	)

	let versionSuffix: string | undefined
	const versionSegments = version.split(".")
	const [major, minor, patch] = versionSegments

	const isPreRel = isPrerelease({
		branch,
		preidBranches,
		isForcePreid,
		isForceStable
	})
	if (isPreRel) {
		core.debug("Use preid for branch")
		versionSuffix = `${preid}${preidDelimiter}${runNumber}`

		if (versionSegments.length === 3) {
			nonSemverVersion = `${version}.${runNumber}`
		}
	}
	// todo: hotfix branches

	const buildVersion = versionSuffix ? `${version}-${versionSuffix}` : version

	core.notice(`Version: ${buildVersion}, nonSemverVersion: ${nonSemverVersion}`)
	core.setOutput("version", buildVersion)
	core.setOutput("nonSemverVersion", nonSemverVersion) // omits the preid and returns just numbers e.g. '1.0.0'
	core.setOutput("majorVersion", major)
	core.setOutput("minorVersion", minor)
	core.setOutput("patchVersion", patch)
	core.setOutput("isPrerelease", isPreRel)
}
