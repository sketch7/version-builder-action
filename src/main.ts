import * as core from '@actions/core'
import * as github from '@actions/github'
import {readFile} from 'fs/promises'

async function run(): Promise<void> {
  const branch = github.context.ref.replace('refs/heads/', '')
  const runNumber = github.context.runNumber

  let version = core.getInput('version')
  const preid = core.getInput('preid') || 'dev'
  const preidDelimiter = core.getInput('preid-num-delimiter') || '.'
  const preidBranchesInput = core.getInput('preid-branches')
  let nonSemverVersion = version

  if (!version) {
    const repoPkgJson = JSON.parse(await readFile('./package.json', 'utf8'))
    version = repoPkgJson.version
  }

  // todo: configurable preid for branches e.g. master=rc, develop=dev
  const preidBranches = preidBranchesInput
    ? coerceArray(preidBranchesInput.split(','))
    : ['main', 'master', 'develop']

  core.info(
    `Branch: ${branch}, ContextRef: ${github.context.ref}, Version: ${version}, RunNumber: ${runNumber}, PreidBranches: ${preidBranches}`
  )

  let versionSuffix: string | undefined
  const versionSegments = version.split('.')
  const [major, minor, patch] = versionSegments
  if (preidBranches.includes(branch)) {
    core.debug('Use preid for branch')
    versionSuffix = `${preid}${preidDelimiter}${runNumber}`

    if (versionSegments.length === 3) {
      nonSemverVersion = `${version}.${runNumber}`
    }
  }
  // todo: hotfix branches

  const buildVersion = versionSuffix ? `${version}-${versionSuffix}` : version

  core.notice(`Version: ${buildVersion}, nonSemverVersion: ${nonSemverVersion}`)
  core.setOutput('version', buildVersion)
  core.setOutput('nonSemverVersion', nonSemverVersion) // omits the preid and returns just numbers e.g. '1.0.0'
  core.setOutput('majorVersion', major)
  core.setOutput('minorVersion', minor)
  core.setOutput('patchVersion', patch)
}

try {
  run()
} catch (error) {
  if (error instanceof Error) core.setFailed(error.message)
}

function coerceArray<T>(value: T | T[]): T[] {
  return Array.isArray(value) ? value : [value]
}
