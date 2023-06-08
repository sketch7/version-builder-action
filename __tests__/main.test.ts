// import {wait} from '../src/wait'
import * as process from 'process'
import * as cp from 'child_process'
import * as path from 'path'
import {expect, test} from '@jest/globals'

// test('throws invalid number', async () => {
//   const input = parseInt('foo', 10)
//   await expect(wait(input)).rejects.toThrow('milliseconds not a number')
// })

// test('wait 500 ms', async () => {
//   const start = new Date()
//   await wait(500)
//   const end = new Date()
//   var delta = Math.abs(end.getTime() - start.getTime())
//   expect(delta).toBeGreaterThan(450)
// })

// shows how the runner will run a javascript action with env / stdout protocol
test('test runs', () => {
  // inputs
  // process.env['INPUT_BRANCHES'] = 'master2' // should be false
  process.env['INPUT_PREIDBRANCHES'] = 'master,develop,feature/resusable-workflow' // should be true
  process.env['INPUT_VERSION'] = '4.0.1'
  process.env['INPUT_PREID'] = 'rc'
  // envs
  process.env['GITHUB_RUN_NUMBER'] = '23'
  process.env['GITHUB_REF'] = 'master'
  const np = process.execPath
  const ip = path.join(__dirname, '..', 'lib', 'main.js')
  const options: cp.ExecFileSyncOptions = {
    env: process.env
  }
  console.log(cp.execFileSync(np, [ip], options).toString())
})
