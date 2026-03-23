import { defineConfig } from "oxlint";

export default defineConfig({
	plugins: ["typescript"],
	env: {
		node: true,
	},
	categories: {
		correctness: "warn",
		suspicious: "warn",
	},
	rules: {
		"no-console": "off",
		"no-process-exit": "off",
		"no-var": "error",
		"prefer-const": "error",
		eqeqeq: "error",
		"no-unused-vars": "off",
		"typescript/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
		"typescript/consistent-type-imports": ["error", { prefer: "type-imports" }],
		"typescript/no-explicit-any": "warn",
	},
});
