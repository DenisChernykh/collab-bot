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
	it("accepts application-to-domain dependencies", () => {
		const result = cruiseFixture("valid-layer-flow");
		expect(`${result.stdout}${result.stderr}`).toContain("no dependency violations found");
		expect(result.status).toBe(0);
	});

	it("rejects domain imports from infrastructure", () => {
		const result = cruiseFixture("domain-imports-infrastructure");
		expect(`${result.stdout}${result.stderr}`).toContain("domain-must-not-import-outer-layers");
		expect(result.status).toBeGreaterThan(0);
	});

	it("rejects application imports from runtime", () => {
		const result = cruiseFixture("application-imports-runtime");
		expect(`${result.stdout}${result.stderr}`).toContain("application-must-not-import-outer-layers");
		expect(result.status).toBeGreaterThan(0);
	});
});
