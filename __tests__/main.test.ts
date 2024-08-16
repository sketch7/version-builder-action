import * as process from "process"
import * as cp from "child_process"
import * as path from "path"
import { expect, test, describe } from "@jest/globals"
import { isPrerelease } from "../src/utils"

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

describe("isPrerelease", () => {
	const dataset = [
		// prerelease
		{
			name: "Preid branch match",
			input: {
				branch: "master",
				preidBranches: ["master", "develop"],
				isForcePreid: false,
				isForceStable: false
			},
			expected: true
		},
		{
			name: "Force preid",
			input: {
				branch: "ci",
				preidBranches: ["master", "develop"],
				isForcePreid: true,
				isForceStable: false
			},
			expected: true
		},
		{
			name: "Force preid > force stable",
			input: {
				branch: "ci",
				preidBranches: ["master", "develop"],
				isForcePreid: true,
				isForceStable: true
			},
			expected: true
		},
		// stable
		{
			name: "Non matching preid branch",
			input: {
				branch: "master",
				preidBranches: ["develop"],
				isForcePreid: false,
				isForceStable: false
			},
			expected: false
		},
		{
			name: "Force stable",
			input: {
				branch: "master",
				preidBranches: ["master"],
				isForcePreid: false,
				isForceStable: true
			},
			expected: false
		}
	]

	dataset.forEach(({ name, input, expected }) => {
		test(`given ${name} (${JSON.stringify(input)}) should be ${expected}`, () => {
			expect(isPrerelease(input)).toBe(expected)
		})
	})
})

// shows how the runner will run a javascript action with env / stdout protocol
test("test runs", () => {
	// inputs
	// process.env['INPUT_PREID-BRANCHES'] = 'master2' // should be false
	process.env["INPUT_PREID-BRANCHES"] =
		"master,develop,feature/resusable-workflow" // should be true
	process.env["INPUT_VERSION"] = "4.0.1"
	process.env["INPUT_PREID"] = "rc"
	process.env["INPUT_FORCE-PREID"] = "false"
	process.env["INPUT_FORCE-STABLE"] = "false"
	// envs
	process.env["GITHUB_RUN_NUMBER"] = "23"
	process.env["GITHUB_REF"] = "master"
	const np = process.execPath
	const ip = path.join(__dirname, "..", "dist", "index.js")
	const options: cp.ExecFileSyncOptions = {
		env: process.env
	}
	console.log(cp.execFileSync(np, [ip], options).toString())
})
