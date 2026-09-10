import type { SqlDatabase } from "../../shared/application/ports/sql-database.js";
import { webCryptoCapabilities } from "../crypto/capabilities.js";
import { CLOUDFLARE_MIGRATION_MANIFEST } from "./cloudflare-migration-manifest.js";
import { stateTransferTableNames } from "./state-transfer.js";

const AUDIT = "mfm_reset_audit";
const AUXILIARY = ["cf1_preflight_cache", "cf1_state_import_audit", "cf1_runtime_probe"] as const;
const DELETE_GUARDS = ["product_events_append_only_delete", "operator_actions_append_only_delete"] as const;
const TABLES: readonly string[] = [...stateTransferTableNames(), ...AUXILIARY];
const hash = (value: unknown) => webCryptoCapabilities.hashUtf8(JSON.stringify(value));
const quote = (value: string) => `"${value.replaceAll('"', '""')}"`;
export interface ResetRequest { readonly operationId: string; readonly target: string; readonly expectedDigest: string }
export interface ResetInspection {
	readonly target: string; readonly digest: string; readonly schemaDigest: string; readonly schemaVersion: number;
	readonly rowCount: number; readonly tables: readonly { readonly name: string; readonly count: number }[]; readonly quiescent: boolean;
}
export interface ResetResult {
	readonly operationId: string; readonly target: string; readonly beforeDigest: string; readonly afterDigest: string;
	readonly removedRows: number; readonly schemaVersion: number; readonly completedAt: number;
}

/** Operator-only: never called by startup, migrations or the bot application. */
export async function inspectProjectReset(database: SqlDatabase, target: string): Promise<ResetInspection> {
	return database.withTransaction(async () => {
		const schema = await database.query<{ type: string; name: string; sql: string | null }>("SELECT type, name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name");
		const tableNames = schema.filter((row) => row.type === "table").map((row) => row.name);
		if (tableNames.some((name) => name !== "__app_migrations" && name !== AUDIT && !TABLES.includes(name))) throw new Error("reset_unreviewed_table");
		const migrations = await database.query<{ id: number; filename: string; checksum: string }>("SELECT id, filename, checksum FROM __app_migrations ORDER BY id");
		if (migrations.length < 11 || migrations.length > CLOUDFLARE_MIGRATION_MANIFEST.length || migrations.some((m, index) => {
			const expected = CLOUDFLARE_MIGRATION_MANIFEST[index];
			return m.id !== expected?.id || m.filename !== expected.filename || m.checksum !== expected.checksum;
		})) throw new Error("reset_unreviewed_schema");
		const data = [];
		for (const name of TABLES.filter((table) => tableNames.includes(table))) {
			const columns = await database.query<{ name: string; pk: number }>(`PRAGMA table_info(${quote(name)})`);
			const keys = columns.filter((column) => column.pk > 0).sort((a, b) => a.pk - b.pk);
			if (keys.length === 0) throw new Error("reset_unreviewed_schema");
			const rows = await database.query(`SELECT * FROM ${quote(name)} ORDER BY ${keys.map((key) => quote(key.name)).join(", ")}`);
			data.push({ name, count: rows.length, digest: hash(rows) });
		}
		const pending = await database.query<{ count: number }>("SELECT count(*) AS count FROM outbox_deliveries WHERE status NOT IN ('sent', 'permanent_failed', 'cancelled')");
		const receipts = await database.query<{ count: number }>("SELECT count(*) AS count FROM command_receipts WHERE status <> 'completed'");
		if ((await database.query("PRAGMA foreign_key_check")).length !== 0) throw new Error("reset_integrity_failed");
		const schemaDigest = hash(schema.filter((row) => row.name !== AUDIT && row.name !== `sqlite_autoindex_${AUDIT}_1`));
		return { target, schemaDigest, schemaVersion: migrations.length, digest: hash({ schemaDigest, migrations, data }),
			rowCount: data.reduce((sum, table) => sum + table.count, 0), tables: data.map(({ name, count }) => ({ name, count })),
			quiescent: pending[0]?.count === 0 && receipts[0]?.count === 0 };
	});
}

export async function resetProjectDatabase(database: SqlDatabase, actualTarget: string, request: ResetRequest): Promise<ResetResult> {
	if (request.target !== actualTarget) throw new Error("reset_target_mismatch");
	if (!/^[a-z0-9-]{8,80}$/u.test(request.operationId) || !/^[0-9a-f]{64}$/u.test(request.expectedDigest)) throw new Error("reset_invalid_request");
	return database.withTransaction(async () => {
		const auditExists = await database.query("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?", [AUDIT]);
		if (auditExists.length > 0) {
			const rows = await database.query<{ result_json: string }>(`SELECT result_json FROM ${AUDIT} WHERE id = 1`);
			if (rows[0]) {
				const result = JSON.parse(rows[0].result_json) as ResetResult;
				if (result.operationId !== request.operationId || result.target !== actualTarget || result.beforeDigest !== request.expectedDigest) throw new Error("reset_already_completed");
				return result;
			}
		}
		const before = await inspectProjectReset(database, actualTarget);
		if (before.digest !== request.expectedDigest) throw new Error("reset_digest_mismatch");
		if (!before.quiescent) throw new Error("reset_delivery_not_quiescent");
		const guards = await database.query<{ name: string; sql: string }>("SELECT name, sql FROM sqlite_master WHERE type = 'trigger' AND name IN (?, ?) ORDER BY name", DELETE_GUARDS);
		// These two append-only guards are suspended and restored in the same transaction.
		for (const guard of guards) await database.execute(`DROP TRIGGER ${quote(guard.name)}`);
		for (const table of [...before.tables].reverse()) await database.execute(`DELETE FROM ${quote(table.name)}`);
		for (const guard of guards) await database.execute(guard.sql);
		const after = await inspectProjectReset(database, actualTarget);
		if (after.rowCount !== 0 || after.schemaDigest !== before.schemaDigest) throw new Error("reset_verification_failed");
		const result: ResetResult = { operationId: request.operationId, target: actualTarget, beforeDigest: before.digest, afterDigest: after.digest,
			removedRows: before.rowCount, schemaVersion: before.schemaVersion, completedAt: Date.now() };
		await database.execute(`CREATE TABLE IF NOT EXISTS ${AUDIT} (id INTEGER PRIMARY KEY CHECK (id = 1), result_json TEXT NOT NULL CHECK (json_valid(result_json)))`);
		await database.execute(`INSERT INTO ${AUDIT} (id, result_json) VALUES (1, ?)`, [JSON.stringify(result)]);
		return result;
	});
}
