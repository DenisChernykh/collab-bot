import { expect, it } from "vitest";
import { inspectProjectReset, resetProjectDatabase } from "../../src/platform/database/project-reset.js";
import { connectionClock, connectionProfileId, seedConnectionPerson } from "../support/connections-fixture.js";
import { withFreshMigratedDatabase } from "../support/migrated-database.js";

it("performs the authorized third reset once after both prior audits", async () => {
	await withFreshMigratedDatabase({ prefix: "mfo-reset-", clock: connectionClock }, async ({ boundary }) => {
		const target = "local:synthetic-mfo";
		const request = async (operationId: string) => ({ operationId, target, expectedDigest: (await inspectProjectReset(boundary, target)).digest });
		await expect(resetProjectDatabase(boundary, target, await request("mfo-2026-reset"))).rejects.toThrow("reset_previous_operation_missing");
		await resetProjectDatabase(boundary, target, await request("mfm-2026-reset"));
		await expect(resetProjectDatabase(boundary, target, await request("mfo-2026-reset"))).rejects.toThrow("reset_previous_operation_missing");
		await resetProjectDatabase(boundary, target, await request("mnet-2026-reset"));
		await seedConnectionPerson(boundary, 1);
		await boundary.execute("INSERT INTO mfm_profile_contacts (profile_id, kind, url, username, telegram_chat_id, title, updated_at) VALUES (?, 'external', 'https://example.com/contact', NULL, NULL, NULL, 1)", [connectionProfileId(1)]);
		const before = await inspectProjectReset(boundary, target);
		const third = { operationId: "mfo-2026-reset", target, expectedDigest: before.digest };
		const result = await resetProjectDatabase(boundary, target, third);
		expect(result).toMatchObject({ operationId: "mfo-2026-reset", target, removedRows: before.rowCount, schemaVersion: 18 });
		expect(await inspectProjectReset(boundary, target)).toMatchObject({ rowCount: 0, schemaDigest: before.schemaDigest, completedOperations: expect.arrayContaining([expect.objectContaining({ operationId: "mfm-2026-reset" }), expect.objectContaining({ operationId: "mnet-2026-reset" }), result]) });
		expect(await boundary.query("SELECT * FROM mfm_profile_contacts")).toEqual([]);
		await seedConnectionPerson(boundary, 2);
		const later = await inspectProjectReset(boundary, target);
		expect(await resetProjectDatabase(boundary, target, third)).toEqual(result);
		expect(await inspectProjectReset(boundary, target)).toEqual(later);
		await expect(resetProjectDatabase(boundary, target, { ...third, expectedDigest: later.digest })).rejects.toThrow("reset_already_completed");
	});
});
