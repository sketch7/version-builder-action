import * as core from "@actions/core"
import * as github from "@actions/github"
import { readFile } from "fs/promises"
import { coerceArray, matchesBranchPattern, parsePreidBranches, resolvePreid, resolveTag, stripPreid } from "./utils"

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
	const token = core.getInput("token")

	if (!version) {
		const repoPkgJson = JSON.parse(await readFile("./package.json", "utf8"))
		version = repoPkgJson.version
	}
	const baseVersion = stripPreid(version)
	let nonSemverVersion = baseVersion

	const preidBranches = parsePreidBranches(
		preidBranchesInput ? coerceArray(preidBranchesInput.split(",")) : ["main:rc", "master:rc", "develop:dev", "vnext:next"],
	)
	const stableBranches = stableBranchesInput ? coerceArray(stableBranchesInput.split(",")) : ["^v\\d+$", "^\\d+\\.x$"]

	core.info(
		`forcePreid: ${forcePreid}, Branch: ${branch}, contextRef: ${github.context.ref}, version: ${version}, runNumber: ${runNumber}, preidBranches: ${JSON.stringify(preidBranches)}, stableBranches: ${JSON.stringify(stableBranches)}`,
	)

	let versionSuffix: string | undefined
	const versionSegments = baseVersion.split(".")
	const [major, minor, patch] = versionSegments

	const resolvedPreid = resolvePreid({ branch, preidBranches, stableBranches, defaultPreid, forcePreid, forceStable })
	const isPreRel = resolvedPreid !== null
	if (isPreRel) {
		core.debug("Use preid for branch")
		versionSuffix = `${resolvedPreid}${preidDelimiter}${runNumber}`

		if (versionSegments.length === 3) {
			nonSemverVersion = `${baseVersion}.${runNumber}`
		}
	}

	const buildVersion = versionSuffix ? `${baseVersion}-${versionSuffix}` : version
	const preidOutput = isPreRel ? resolvedPreid : ""

	let stableBranchNames: string[] = []
	if (!isPreRel && token) {
		const octokit = github.getOctokit(token)
		for await (const response of octokit.paginate.iterator(octokit.rest.repos.listBranches, {
			owner: github.context.repo.owner,
			repo: github.context.repo.repo,
			per_page: 100,
		})) {
			for (const b of response.data) {
				if (matchesBranchPattern(b.name, stableBranches)) {
					stableBranchNames.push(b.name)
				}
			}
		}
	}
	const tag = resolveTag({ resolvedPreid, branch, stableBranchNames })

	core.notice(`Version: ${buildVersion}, nonSemverVersion: ${nonSemverVersion}, tag: ${tag}`)
	core.setOutput("version", buildVersion)
	core.setOutput("nonSemverVersion", nonSemverVersion) // omits the preid and returns just numbers e.g. '1.0.0'
	core.setOutput("majorVersion", major)
	core.setOutput("minorVersion", minor)
	core.setOutput("patchVersion", patch)
	core.setOutput("preid", preidOutput)
	core.setOutput("isPrerelease", isPreRel)
	core.setOutput("tag", tag)
}
