import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		passWithNoTests: false,
		projects: [
			{
				test: {
					name: "unit",
					include: ["test/unit/**/*.test.ts"],
				},
			},
			{
				test: {
					name: "integration",
					include: ["test/integration/**/*.test.ts"],
				},
			},
			{
				test: {
					name: "runtime",
					include: ["test/runtime/**/*.test.ts"],
				},
			},
			{
				test: {
					name: "e2e-fake",
					include: ["test/e2e-fake/**/*.test.ts"],
				},
			},
		],
	},
});
