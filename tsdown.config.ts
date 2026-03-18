import { defineConfig } from "tsdown"

export default defineConfig({
	entry: ["src/index.ts"],
	format: ["cjs"],
	target: "node24",
	deps: {
		alwaysBundle: [/.*/],
		onlyBundle: false
	},
	minify: false,
	sourcemap: false,
	outDir: "dist",
	outExtensions: () => ({ js: ".js" }),
	clean: true
})
