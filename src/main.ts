import * as core from '@actions/core'
import * as github from '@actions/github'
import {readFile} from 'fs/promises'

async function run(): Promise<void> {
  const branch = github.context.ref
  const runNumber = github.context.runNumber

  const pkgJson = JSON.parse(await readFile('./package.json', 'utf8'))
  const version = core.getInput('version')
  const versionSuffixName = core.getInput('versionSuffix') || 'dev'
  const versionSuffixDelimiter = core.getInput('versionSuffixDelimiter') || '-'

  core.info(`InputVersion: ${version}, PkgJson Version: ${pkgJson.version}`)
  core.info(`Branch: ${branch}, Version: ${version}, RunNumber: ${runNumber}`)

  let versionSuffix: string | undefined

  // branches to use suffix for
  switch (branch) {
    case 'main':
    case 'master':
    case 'develop':
      versionSuffix = `${versionSuffixName}${versionSuffixDelimiter}${runNumber}`
      break
    // todo: hotfix branches
    default:
      break
  }

  const buildVersion = versionSuffix ? `${version}-${versionSuffix}` : version

  core.notice(`Version: ${buildVersion}`)
  core.setOutput('version', buildVersion)
}

try {
  run()
} catch (error) {
  if (error instanceof Error) core.setFailed(error.message)
}
