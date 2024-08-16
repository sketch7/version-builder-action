import * as core from "@actions/core"

import { run } from "./main"

// eslint-disable-next-line @typescript-eslint/no-floating-promises
try {
	run()
} catch (error) {
	if (error instanceof Error) core.setFailed(error.message)
}
