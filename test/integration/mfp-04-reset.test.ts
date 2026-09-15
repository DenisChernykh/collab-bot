import { expect, it } from "vitest";
import { inspectProjectReset, resetProjectDatabase } from "../../src/platform/database/project-reset.js";
import { withFreshMigratedDatabase } from "../support/migrated-database.js";
import { connectionClock, seedConnectionPerson } from "../support/connections-fixture.js";

it("clears the current schema once with the exact production-profile operation and keeps prior audits", async () => {
	await withFreshMigratedDatabase({ prefix: "mfp-reset-", clock: connectionClock }, async ({ boundary }) => {
		const target = "production:synthetic-primary";
		for (const operationId of ["mfm-2026-reset", "mnet-2026-reset", "mfo-2026-reset"]) {
			const before = await inspectProjectReset(boundary, target);
			await resetProjectDatabase(boundary, target, { operationId, target, expectedDigest: before.digest });
		}
		await seedConnectionPerson(boundary, 1, { about: "A concise public profile summary." });
		const before = await inspectProjectReset(boundary, target);
		const request = { operationId: "mfp-2026-reset", target, expectedDigest: before.digest };
		const result = await resetProjectDatabase(boundary, target, request);
		expect(result).toMatchObject({ operationId: "mfp-2026-reset", schemaVersion: 19, removedRows: before.rowCount });
		expect(await resetProjectDatabase(boundary, target, request)).toEqual(result);
		expect(await inspectProjectReset(boundary, target)).toMatchObject({ schemaVersion: 19, rowCount: 0, completedOperations: expect.arrayContaining([expect.objectContaining({ operationId: "mfp-2026-reset" })]) });
		expect(await boundary.query("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE '%reset_audit' ORDER BY name")).toEqual([
			{ name: "mfm_reset_audit" }, { name: "mfo_reset_audit" }, { name: "mfp_reset_audit" }, { name: "mnet_reset_audit" },
		]);
	});
});
