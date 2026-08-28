import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

function cruiseFixture(name: string): SpawnSyncReturns<string> {
	return spawnSync(
		process.execPath,
		[
			"node_modules/dependency-cruiser/bin/dependency-cruise.mjs",
			"--config",
			".dependency-cruiser.cjs",
			"--output-type",
			"err",
			resolve(`test/fixtures/dependency-cruiser/${name}`),
		],
		{ cwd: process.cwd(), encoding: "utf8" },
	);
}

describe("dependency-cruiser architecture policy", () => {
	it("accepts shared application-to-domain dependencies", () => {
		const result = cruiseFixture("valid-layer-flow");
		expect(`${result.stdout}${result.stderr}`).toContain("no dependency violations found");
		expect(result.status).toBe(0);
	});

	it("rejects shared domain imports from platform", () => {
		const result = cruiseFixture("domain-imports-infrastructure");
		expect(`${result.stdout}${result.stderr}`).toContain("shared-domain-must-point-only-inward");
		expect(result.status).toBeGreaterThan(0);
	});

	it("rejects shared application imports from runtime", () => {
		const result = cruiseFixture("application-imports-runtime");
		expect(`${result.stdout}${result.stderr}`).toContain("shared-application-must-not-import-outer-layers");
		expect(result.status).toBeGreaterThan(0);
	});

	it("accepts cross-feature imports through a public module entrypoint", () => {
		const result = cruiseFixture("cross-module-public-entrypoint");
		expect(`${result.stdout}${result.stderr}`).toContain("no dependency violations found");
		expect(result.status).toBe(0);
	});

	it("rejects cross-feature imports into module internals", () => {
		const result = cruiseFixture("cross-module-internal-import");
		expect(`${result.stdout}${result.stderr}`).toContain("module-internals-must-not-cross-feature-boundaries");
		expect(result.status).toBeGreaterThan(0);
	});
});
