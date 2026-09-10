import type { SqlDatabase } from "../../shared/application/ports/sql-database.js";
import { webCryptoCapabilities } from "../crypto/capabilities.js";
import { CLOUDFLARE_MIGRATION_MANIFEST } from "./cloudflare-migration-manifest.js";
import { stateTransferTableNames } from "./state-transfer.js";

const RESET_AUDITS = {
	"mfm-2026-reset": "mfm_reset_audit",
	"mnet-2026-reset": "mnet_reset_audit",
	"mfo-2026-reset": "mfo_reset_audit",
	"mfo-2026-hotfix-reset": "mfo_hotfix_reset_audit",
	"mfp-2026-reset": "mfp_reset_audit",
} as const;
const RESET_PREREQUISITES: Readonly<Record<keyof typeof RESET_AUDITS, readonly (keyof typeof RESET_AUDITS)[]>> = {
	"mfm-2026-reset": [],
	"mnet-2026-reset": ["mfm-2026-reset"],
	"mfo-2026-reset": ["mfm-2026-reset", "mnet-2026-reset"],
	"mfo-2026-hotfix-reset": ["mfm-2026-reset", "mnet-2026-reset", "mfo-2026-reset"],
	"mfp-2026-reset": ["mfm-2026-reset", "mnet-2026-reset", "mfo-2026-reset"],
};
const AUDITS: readonly string[] = Object.values(RESET_AUDITS);
const AUXILIARY = ["cf1_preflight_cache", "cf1_state_import_audit", "cf1_runtime_probe"] as const;
const DELETE_GUARDS = ["product_events_append_only_delete", "operator_actions_append_only_delete"] as const;
const TABLES: readonly string[] = [...stateTransferTableNames(), ...AUXILIARY];
const hash = (value: unknown) => webCryptoCapabilities.hashUtf8(JSON.stringify(value));
const quote = (value: string) => `"${value.replaceAll('"', '""')}"`;
export class UnreviewedResetTablesError extends Error {
	constructor(readonly tableNames: readonly string[]) { super("reset_unreviewed_table"); }
}
export interface ResetRequest { readonly operationId: string; readonly target: string; readonly expectedDigest: string }
export interface ResetInspection {
	readonly target: string; readonly digest: string; readonly schemaDigest: string; readonly schemaVersion: number;
	readonly rowCount: number; readonly tables: readonly { readonly name: string; readonly count: number }[]; readonly quiescent: boolean;
	readonly completedOperations: readonly ResetResult[];
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
		// Cloudflare owns _cf_METADATA (alarm/PITR bookkeeping); never query or delete its rows.
		const unknown = tableNames.filter((name) => name !== "__app_migrations" && !AUDITS.includes(name) && name !== "_cf_METADATA" && !TABLES.includes(name));
		if (unknown.length > 0) throw new UnreviewedResetTablesError(unknown);
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
		const schemaDigest = hash(schema.filter((row) => !AUDITS.includes(row.name)));
		const completedOperations: ResetResult[] = [];
		for (const audit of AUDITS) {
			const result = await readResetResult(database, audit);
			if (result !== undefined) completedOperations.push(result);
		}
		return { target, schemaDigest, schemaVersion: migrations.length, digest: hash({ schemaDigest, migrations, data }),
			rowCount: data.reduce((sum, table) => sum + table.count, 0), tables: data.map(({ name, count }) => ({ name, count })),
			quiescent: pending[0]?.count === 0 && receipts[0]?.count === 0, completedOperations };
	});
}

export async function resetProjectDatabase(database: SqlDatabase, actualTarget: string, request: ResetRequest): Promise<ResetResult> {
	if (request.target !== actualTarget) throw new Error("reset_target_mismatch");
	if (!/^[a-z0-9-]{8,80}$/u.test(request.operationId) || !/^[0-9a-f]{64}$/u.test(request.expectedDigest)) throw new Error("reset_invalid_request");
	if (!Object.hasOwn(RESET_AUDITS, request.operationId)) throw new Error("reset_unsupported_operation");
	const audit = RESET_AUDITS[request.operationId as keyof typeof RESET_AUDITS];
	return database.withTransaction(async () => {
		for (const previousOperation of RESET_PREREQUISITES[request.operationId as keyof typeof RESET_AUDITS]) {
			const previous = await readResetResult(database, RESET_AUDITS[previousOperation]);
			if (previous === undefined || previous.operationId !== previousOperation) throw new Error("reset_previous_operation_missing");
			if (previous.target !== actualTarget) throw new Error("reset_target_mismatch");
		}
		const recorded = await readResetResult(database, audit);
		if (recorded !== undefined) {
			if (recorded.operationId !== request.operationId || recorded.target !== actualTarget || recorded.beforeDigest !== request.expectedDigest) throw new Error("reset_already_completed");
			return recorded;
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
		await database.execute(`CREATE TABLE IF NOT EXISTS ${audit} (id INTEGER PRIMARY KEY CHECK (id = 1), result_json TEXT NOT NULL CHECK (json_valid(result_json)))`);
		await database.execute(`INSERT INTO ${audit} (id, result_json) VALUES (1, ?)`, [JSON.stringify(result)]);
		return result;
	});
}

async function readResetResult(database: SqlDatabase, audit: string): Promise<ResetResult | undefined> {
	const exists = await database.query("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?", [audit]);
	if (exists.length === 0) return undefined;
	const [row] = await database.query<{ result_json: string }>(`SELECT result_json FROM ${quote(audit)} WHERE id = 1`);
	return row === undefined ? undefined : JSON.parse(row.result_json) as ResetResult;
}
