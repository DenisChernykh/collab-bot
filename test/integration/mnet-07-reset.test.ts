import { expect, it } from "vitest";
import { inspectProjectReset, resetProjectDatabase } from "../../src/platform/database/project-reset.js";
import { withFreshMigratedDatabase } from "../support/migrated-database.js";
import { connectionClock, connectionProfileId, seedConnectionPerson } from "../support/connections-fixture.js";

it("rehearses a distinct second reset, keeps both audits and protects new data from every exact retry", async () => {
	await withFreshMigratedDatabase({ prefix: "mnet-reset-", clock: connectionClock }, async ({ boundary }) => {
		const target = "local:synthetic-mnet";
		const first = { operationId: "mfm-2026-reset", target, expectedDigest: (await inspectProjectReset(boundary, target)).digest };
		const firstResult = await resetProjectDatabase(boundary, target, first);
		const firstAudit = await boundary.query("SELECT * FROM mfm_reset_audit");
		await seedConnectionPerson(boundary, 1); await seedConnectionPerson(boundary, 2);
		await boundary.execute("INSERT INTO mfm_discovery_settings VALUES (?, 1, 1, 1)", [connectionProfileId(1)]);
		await boundary.execute("INSERT INTO introduction_requests VALUES (?, ?, ?, ?, ?, 'accepted', 2, 1, 2)", ["00000000-0000-4000-8000-000000000001", "a".repeat(22), connectionProfileId(1), connectionProfileId(2), "Synthetic introduction"]);
		const inspect = () => inspectProjectReset(boundary, target);
		const before = await inspect();
		const second = { operationId: "mnet-2026-reset", target, expectedDigest: before.digest };
		await expect(resetProjectDatabase(boundary, "local:wrong", second)).rejects.toThrow("reset_target_mismatch");
		await expect(resetProjectDatabase(boundary, target, { ...second, expectedDigest: "f".repeat(64) })).rejects.toThrow("reset_digest_mismatch");
		await boundary.execute("INSERT INTO outbox_deliveries (id, idempotency_key, kind, recipient_chat_id, payload_json, status, attempt_count, created_at, updated_at) VALUES ('00000000-0000-4000-8000-000000000002', 'second-reset-guard', 'dm_send', '1', '{}', 'prepared', 0, 1, 1)");
		await expect(resetProjectDatabase(boundary, target, { ...second, expectedDigest: (await inspect()).digest })).rejects.toThrow("reset_delivery_not_quiescent");
		await boundary.execute("DELETE FROM outbox_deliveries");
		await boundary.execute("CREATE TRIGGER mnet_reset_failure BEFORE DELETE ON telegram_users BEGIN SELECT RAISE(ABORT, 'injected second reset failure'); END");
		const guarded = await inspect();
		await expect(resetProjectDatabase(boundary, target, { ...second, expectedDigest: guarded.digest })).rejects.toThrow("injected second reset failure");
		expect(await inspect()).toEqual(guarded);
		expect(await boundary.query("SELECT * FROM mfm_reset_audit")).toEqual(firstAudit);
		expect(await boundary.query("SELECT name FROM sqlite_master WHERE name = 'mnet_reset_audit'")).toEqual([]);
		await boundary.execute("DROP TRIGGER mnet_reset_failure");
		const result = await resetProjectDatabase(boundary, target, second);
		expect(result).toMatchObject({ operationId: second.operationId, removedRows: before.rowCount, schemaVersion: 18 });
		expect(await inspect()).toMatchObject({ rowCount: 0, schemaDigest: before.schemaDigest });
		expect(await boundary.query("SELECT * FROM mfm_reset_audit")).toEqual(firstAudit);
		expect(await boundary.query("SELECT result_json FROM mnet_reset_audit")).toEqual([{ result_json: JSON.stringify(result) }]);
		expect(await boundary.query("SELECT count(*) AS count FROM __app_migrations")).toEqual([{ count: 18 }]);
		await seedConnectionPerson(boundary, 3);
		const later = await inspect();
		expect(await resetProjectDatabase(boundary, target, first)).toEqual(firstResult);
		expect(await resetProjectDatabase(boundary, target, second)).toEqual(result);
		expect(await inspect()).toEqual(later);
		await expect(resetProjectDatabase(boundary, target, { ...second, expectedDigest: later.digest })).rejects.toThrow("reset_already_completed");
		await expect(resetProjectDatabase(boundary, target, { ...second, operationId: "unapproved-third-reset" })).rejects.toThrow("reset_unsupported_operation");
	});
});

it("requires the prior project reset before the separately authorized second operation", async () => {
	await withFreshMigratedDatabase({ prefix: "mnet-reset-prior-", clock: connectionClock }, async ({ boundary }) => {
		const before = await inspectProjectReset(boundary, "local:synthetic-mnet");
		await expect(resetProjectDatabase(boundary, before.target, { operationId: "mnet-2026-reset", target: before.target, expectedDigest: before.digest })).rejects.toThrow("reset_previous_operation_missing");
		expect(await inspectProjectReset(boundary, before.target)).toEqual(before);
	});
});
