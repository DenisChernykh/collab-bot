import type { SqlDatabase, SqlExecuteResult, SqlValue } from "../../shared/application/ports/sql-database.js";

export interface NodeSqlDatabaseSource {
	readonly databasePath: string;
	query<T>(sql: string, parameters?: readonly SqlValue[]): Promise<readonly T[]>;
	execute(sql: string, parameters?: readonly SqlValue[]): Promise<SqlExecuteResult>;
	withTransaction<T>(work: (() => T | PromiseLike<T>) | ((context: unknown) => T | PromiseLike<T>)): Promise<T>;
	close(): Promise<void>;
}

export type SqlDatabaseInput = SqlDatabase | NodeSqlDatabaseSource;

export function resolveSqlDatabase(input: SqlDatabaseInput): SqlDatabase {
	return "databasePath" in input ? new NodeSqlDatabase(input) : input;
}

/** Runtime-neutral repository facade backed by the serialized node:sqlite boundary. */
export class NodeSqlDatabase implements SqlDatabase {
	constructor(private readonly boundary: NodeSqlDatabaseSource) {}

	async query<T>(sql: string, parameters: readonly SqlValue[] = []): Promise<readonly T[]> {
		return this.boundary.query<T>(sql, parameters);
	}

	async execute(sql: string, parameters: readonly SqlValue[] = []): Promise<SqlExecuteResult> {
		return this.boundary.execute(sql, parameters);
	}

	async withTransaction<T>(work: () => T | PromiseLike<T>): Promise<T> {
		return this.boundary.withTransaction(() => work());
	}

	close(): Promise<void> {
		return this.boundary.close();
	}
}
