import * as core from '@actions/core'
import * as github from '@actions/github'
import {readFile} from 'fs/promises'

async function run(): Promise<void> {
  const branch = github.context.ref
  const runNumber = github.context.runNumber

  let version = core.getInput('version')
  if (!version) {
    const repoPkgJson = JSON.parse(await readFile('./package.json', 'utf8'))
    version = repoPkgJson.version
  }
  const branchesInput = core.getInput('branches')

  // todo: configurable suffix for branches e.g. master=rc, develop=dev
  const branches = branchesInput
    ? coerceArray(branchesInput.split(','))
    : ['main', 'master', 'develop']

  const preId = core.getInput('preid') || 'dev'
  const preIdDelimiter = core.getInput('preidNumDelimiter') || '.'

  core.info(
    `Branch: ${branch}, Version: ${version}, RunNumber: ${runNumber}, Branches: ${branches}`
  )

  let versionSuffix: string | undefined

  if (branches.includes(branch)) {
    core.debug('Use suffix for branch')
    versionSuffix = `${preId}${preIdDelimiter}${runNumber}`
  }
  // todo: hotfix branches

  const buildVersion = versionSuffix ? `${version}-${versionSuffix}` : version

  core.notice(`Version: ${buildVersion}, nonSemverVersion: ${version}`)
  core.setOutput('version', buildVersion)
  core.setOutput('nonSemverVersion', version) // omits the preid and returns just numbers e.g. '1.0.0'
}

try {
  run()
} catch (error) {
  if (error instanceof Error) core.setFailed(error.message)
}

function coerceArray<T>(value: T | T[]): T[] {
  return Array.isArray(value) ? value : [value]
}
