import { defineConfig } from "tsup"

export default defineConfig({
	entry: ["src/index.ts"],
	format: ["cjs"],
	target: "node24",
	bundle: true,
	noExternal: [/.*/],
	minify: false,
	sourcemap: true,
	outDir: "dist",
	clean: true
})
