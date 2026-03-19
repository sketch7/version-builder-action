import * as cp from "child_process"
import * as path from "path"
import * as process from "process"
import { expect, test } from "vitest"

// shows how the runner will run a javascript action with env / stdout protocol
test("runs", () => {
	// inputs
	process.env["INPUT_PREID-BRANCHES"] = "main:rc,master:rc,develop:dev"
	process.env["INPUT_STABLE-BRANCHES"] = "^v\\d+$,^\\d+\\.x$"
	process.env["INPUT_VERSION"] = "4.0.1"
	process.env["INPUT_PREID"] = "dev"
	process.env["INPUT_FORCE-PREID"] = "false"
	process.env["INPUT_FORCE-STABLE"] = "false"
	// envs
	process.env["GITHUB_RUN_NUMBER"] = "23"
	// process.env["GITHUB_REF"] = "refs/heads/main"
	process.env["GITHUB_REF"] = "refs/heads/feature/my-workflow"
	const np = process.execPath
	const ip = path.join(__dirname, "..", "dist", "index.js")
	const options: cp.ExecFileSyncOptions = {
		env: process.env,
	}
	const result = cp.execFileSync(np, [ip], options).toString()
	console.log(result)
	expect(result).not.toBeNull()
	expect(result).toContain("::set-output name=baseVersion::4.0.1")
})
