import * as core from "@actions/core";

import { run } from "./main";

run().catch(error => {
	const message = error instanceof Error ? error.message : String(error ?? "Unknown error");
	core.setFailed(message);
});
