import { defineConfig } from "vitest/config"

export default defineConfig({
	test: {
		clearMocks: true,
		environment: "node",
		include: ["__tests__/**/*.test.ts"],
		coverage: {
			provider: "v8",
			reporter: ["json-summary", "text", "lcov"],
			include: ["src/**"]
		}
	}
})
