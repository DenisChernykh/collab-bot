import type { SqlDatabase, SqlValue } from "../../shared/application/ports/sql-database.js";
import { webCryptoCapabilities } from "../crypto/capabilities.js";

export const STATE_TRANSFER_VERSION = 1 as const;
export const STATE_TRANSFER_SCHEMA_VERSION = 15 as const;
export const STATE_TRANSFER_AUDIT_TABLE = "cf1_state_import_audit" as const;

const PRODUCT_TABLES = [
	"telegram_users",
	"telegram_actions",
	"command_receipts",
	"processed_updates",
	"outbox_deliveries",
	"product_events",
	"profiles",
	"profile_platforms",
	"profile_topics",
	"profile_sessions",
	"mfm_profiles",
	"mfm_profile_spheres",
	"mfm_profile_specializations",
	"mfm_profile_open_to",
	"onboarding_sessions",
	"collaborations",
	"collaboration_topics",
	"collaboration_sessions",
	"channel_publications",
	"browse_sessions",
	"applications",
	"operator_actions",
] as const;

export type StateTransferTableName = (typeof PRODUCT_TABLES)[number];

export interface StateTransferColumn {
	readonly name: string;
	readonly type: string;
	readonly notNull: boolean;
	readonly primaryKey: number;
}

export type StateTransferValue = null | string | number | {
	readonly type: "blob";
	readonly encoding: "base64url";
	readonly value: string;
};

export interface StateTransferTable {
	readonly name: StateTransferTableName;
	readonly columns: readonly StateTransferColumn[];
	readonly rowCount: number;
	readonly rows: readonly (readonly StateTransferValue[])[];
	readonly digest: string;
}

export interface StateTransferManifest {
	readonly version: typeof STATE_TRANSFER_VERSION;
	readonly schemaVersion: typeof STATE_TRANSFER_SCHEMA_VERSION;
	readonly tables: readonly StateTransferTable[];
	readonly digest: string;
}

export interface StateTransferSummary {
	readonly digest: string;
	readonly tableCount: number;
	readonly rowCount: number;
}

export class StateTransferValidationError extends Error {
	constructor() {
		super("state transfer manifest validation failed");
		this.name = "StateTransferValidationError";
	}
}

export class StateTransferConflictError extends Error {
	constructor() {
		super("state transfer target is not empty or was already imported");
		this.name = "StateTransferConflictError";
	}
}

interface SqliteTableInfoRow {
	readonly name: string;
	readonly type: string;
	readonly notnull: number;
	readonly pk: number;
}

interface SqliteCountRow {
	readonly count: number;
}

export function stateTransferTableNames(): readonly StateTransferTableName[] {
	return PRODUCT_TABLES;
}

export async function exportStateTransferManifest(database: SqlDatabase): Promise<StateTransferManifest> {
	const tables: StateTransferTable[] = [];
	for (const tableName of PRODUCT_TABLES) {
		const columns = await readColumns(database, tableName);
		if (columns.length === 0) throw new StateTransferValidationError();
		const primaryKeyColumns = columns.filter((column) => column.primaryKey > 0).sort((left, right) => left.primaryKey - right.primaryKey);
		if (primaryKeyColumns.length === 0) throw new StateTransferValidationError();
		const orderedColumns = columns.map((column) => column.name);
		const orderBy = primaryKeyColumns.map((column) => quoteIdentifier(column.name)).join(", ");
		const rows = await database.query<Record<string, unknown>>(
			`SELECT ${orderedColumns.map(quoteIdentifier).join(", ")} FROM ${quoteIdentifier(tableName)} ORDER BY ${orderBy}`,
		);
		const normalizedRows = rows.map((row) => orderedColumns.map((column) => normalizeValue(row[column])));
		const table = {
			name: tableName,
			columns,
			rowCount: normalizedRows.length,
			rows: normalizedRows,
			digest: "",
		};
		const digest = digestValue({ name: table.name, columns: table.columns, rowCount: table.rowCount, rows: table.rows });
		tables.push({ ...table, digest });
	}
	const manifestWithoutDigest = { version: STATE_TRANSFER_VERSION, schemaVersion: STATE_TRANSFER_SCHEMA_VERSION, tables };
	return { ...manifestWithoutDigest, digest: digestValue(manifestWithoutDigest) };
}

export async function importStateTransferManifest(
	database: SqlDatabase,
	manifest: unknown,
	clock: () => number = () => Date.now(),
): Promise<StateTransferSummary> {
	const checked = validateManifest(manifest);
	return database.withTransaction(async () => {
		const auditRows = await database.query<{ digest: string }>(
			`SELECT digest FROM ${quoteIdentifier(STATE_TRANSFER_AUDIT_TABLE)} WHERE id = 1`,
		);
		if (auditRows.length > 0) throw new StateTransferConflictError();
		await verifyTargetSchema(database, checked);
		for (const table of checked.tables) {
			const countRows = await database.query<SqliteCountRow>(`SELECT count(*) AS count FROM ${quoteIdentifier(table.name)}`);
			if (countRows[0]?.count !== 0) throw new StateTransferConflictError();
		}
		for (const table of checked.tables) {
			const columns = table.columns.map((column) => quoteIdentifier(column.name)).join(", ");
			const placeholders = table.columns.map(() => "?").join(", ");
			for (const row of table.rows) {
				await database.execute(
					`INSERT INTO ${quoteIdentifier(table.name)} (${columns}) VALUES (${placeholders})`,
					row.map(toSqlValue),
				);
			}
		}
		const importedAt = clock();
		if (!Number.isSafeInteger(importedAt) || importedAt < 0) throw new StateTransferValidationError();
		await database.execute(
			`INSERT INTO ${quoteIdentifier(STATE_TRANSFER_AUDIT_TABLE)} (id, digest, imported_at) VALUES (1, ?, ?)`,
			[checked.digest, importedAt],
		);
		return {
			digest: checked.digest,
			tableCount: checked.tables.length,
			rowCount: checked.tables.reduce((total, table) => total + table.rowCount, 0),
		};
	});
}

export function validateManifest(value: unknown): StateTransferManifest {
	if (!isRecord(value) || value.version !== STATE_TRANSFER_VERSION || value.schemaVersion !== STATE_TRANSFER_SCHEMA_VERSION || !Array.isArray(value.tables) || typeof value.digest !== "string") {
		throw new StateTransferValidationError();
	}
	if (!isHexDigest(value.digest) || value.tables.length !== PRODUCT_TABLES.length) throw new StateTransferValidationError();
	const tables = value.tables.map((table, index) => validateTable(table, PRODUCT_TABLES[index]));
	const expectedDigest = digestValue({ version: STATE_TRANSFER_VERSION, schemaVersion: STATE_TRANSFER_SCHEMA_VERSION, tables });
	if (expectedDigest !== value.digest) throw new StateTransferValidationError();
	return { version: STATE_TRANSFER_VERSION, schemaVersion: STATE_TRANSFER_SCHEMA_VERSION, tables, digest: value.digest };
}

async function verifyTargetSchema(database: SqlDatabase, manifest: StateTransferManifest): Promise<void> {
	for (const table of manifest.tables) {
		const actual = await readColumns(database, table.name);
		if (JSON.stringify(actual) !== JSON.stringify(table.columns)) throw new StateTransferValidationError();
	}
}

async function readColumns(database: SqlDatabase, tableName: StateTransferTableName): Promise<readonly StateTransferColumn[]> {
	const rows = await database.query<SqliteTableInfoRow>(`PRAGMA table_info(${quoteIdentifier(tableName)})`);
	return rows.map((row) => ({ name: row.name, type: row.type, notNull: row.notnull === 1, primaryKey: row.pk }));
}

function validateTable(value: unknown, expectedName: StateTransferTableName | undefined): StateTransferTable {
	if (!isRecord(value) || value.name !== expectedName || !Array.isArray(value.columns) || !Array.isArray(value.rows) || typeof value.rowCount !== "number" || !Number.isSafeInteger(value.rowCount) || value.rowCount !== value.rows.length || typeof value.digest !== "string" || !isHexDigest(value.digest)) {
		throw new StateTransferValidationError();
	}
	const columns = value.columns.map(validateColumn);
	const rows = value.rows.map((row) => {
		if (!Array.isArray(row) || row.length !== columns.length) throw new StateTransferValidationError();
		return row.map(validateValue);
	});
	const primaryKeyIndexes = columns
		.map((column, index) => ({ index, primaryKey: column.primaryKey }))
		.filter(({ primaryKey }) => primaryKey > 0)
		.sort((left, right) => left.primaryKey - right.primaryKey)
		.map(({ index }) => index);
	for (let index = 1; index < rows.length; index += 1) {
		const previous = rows[index - 1];
		const current = rows[index];
		if (previous === undefined || current === undefined || comparePrimaryKey(previous, current, primaryKeyIndexes) > 0) throw new StateTransferValidationError();
	}
	const table = { name: value.name, columns, rowCount: value.rowCount, rows, digest: value.digest } as StateTransferTable;
	const expectedDigest = digestValue({ name: table.name, columns: table.columns, rowCount: table.rowCount, rows: table.rows });
	if (expectedDigest !== table.digest) throw new StateTransferValidationError();
	return table;
}

function comparePrimaryKey(left: readonly StateTransferValue[], right: readonly StateTransferValue[], indexes: readonly number[]): number {
	for (const index of indexes) {
		const comparison = compareTransferValues(left[index], right[index]);
		if (comparison !== 0) return comparison;
	}
	return 0;
}

function compareTransferValues(left: StateTransferValue | undefined, right: StateTransferValue | undefined): number {
	if (left === right) return 0;
	if (left === null || left === undefined) return -1;
	if (right === null || right === undefined) return 1;
	if (typeof left !== typeof right) throw new StateTransferValidationError();
	if (typeof left === "number" && typeof right === "number") return left < right ? -1 : 1;
	const leftValue = typeof left === "string" ? left : typeof left === "number" ? String(left) : left.value;
	const rightValue = typeof right === "string" ? right : typeof right === "number" ? String(right) : right.value;
	return leftValue < rightValue ? -1 : 1;
}

function validateColumn(value: unknown): StateTransferColumn {
	if (!isRecord(value) || typeof value.name !== "string" || value.name === "" || typeof value.type !== "string" || typeof value.notNull !== "boolean" || typeof value.primaryKey !== "number" || !Number.isSafeInteger(value.primaryKey) || value.primaryKey < 0) throw new StateTransferValidationError();
	return { name: value.name, type: value.type, notNull: value.notNull, primaryKey: value.primaryKey };
}

function validateValue(value: unknown): StateTransferValue {
	if (value === null || typeof value === "string" || (typeof value === "number" && Number.isSafeInteger(value))) return value;
	if (isRecord(value) && value.type === "blob" && value.encoding === "base64url" && typeof value.value === "string" && /^[A-Za-z0-9_-]*$/u.test(value.value)) return { type: "blob", encoding: "base64url", value: value.value };
	throw new StateTransferValidationError();
}

function normalizeValue(value: unknown): StateTransferValue {
	if (value === null || typeof value === "string") return value;
	if (typeof value === "number" && Number.isSafeInteger(value)) return value;
	if (typeof value === "bigint") {
		const number = Number(value);
		if (Number.isSafeInteger(number)) return number;
	}
	if (value instanceof ArrayBuffer) return blobValue(new Uint8Array(value));
	if (ArrayBuffer.isView(value)) return blobValue(new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
	throw new StateTransferValidationError();
}

function toSqlValue(value: StateTransferValue): SqlValue {
	if (value === null || typeof value === "string" || typeof value === "number") return value;
	return decodeBase64Url(value.value);
}

function blobValue(value: Uint8Array): StateTransferValue {
	let binary = "";
	for (const byte of value) binary += String.fromCharCode(byte);
	return { type: "blob", encoding: "base64url", value: btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "") };
}

function decodeBase64Url(value: string): Uint8Array {
	const padded = value.replaceAll("-", "+").replaceAll("_", "/") + "=".repeat((4 - value.length % 4) % 4);
	const binary = atob(padded);
	return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function digestValue(value: unknown): string {
	return webCryptoCapabilities.hashUtf8(JSON.stringify(value));
}

function quoteIdentifier(value: string): string {
	return `"${value.replaceAll('"', '""')}"`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isHexDigest(value: string): boolean {
	return /^[0-9a-f]{64}$/u.test(value);
}
