import type { SqlDatabase, SqlExecuteResult, SqlValue } from "../../shared/application/ports/sql-database.js";
import { DatabaseBoundary } from "./database-boundary.js";

/** Runtime-neutral repository facade backed by the serialized node:sqlite boundary. */
export class NodeSqlDatabase implements SqlDatabase {
	constructor(private readonly boundary: DatabaseBoundary) {}

	async query<T>(sql: string, parameters: readonly SqlValue[] = []): Promise<readonly T[]> {
		return this.boundary.query<T>(sql, parameters);
	}

	async execute(sql: string, parameters: readonly SqlValue[] = []): Promise<SqlExecuteResult> {
		const result = await this.boundary.execute(sql, parameters) as { readonly changes?: number };
		return { changes: result.changes ?? 0 };
	}

	async withTransaction<T>(work: () => T | PromiseLike<T>): Promise<T> {
		return this.boundary.withTransaction(() => work());
	}

	close(): Promise<void> {
		return this.boundary.close();
	}
}
