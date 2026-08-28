/** Values supported by every SQLite runtime used by the application graph. */
export type SqlValue = null | number | bigint | string | Uint8Array;

export interface SqlExecuteResult {
	readonly changes: number;
}

export interface SqlDatabase {
	query<T>(sql: string, parameters?: readonly SqlValue[]): Promise<readonly T[]>;
	execute(sql: string, parameters?: readonly SqlValue[]): Promise<SqlExecuteResult>;
	withTransaction<T>(work: () => T | PromiseLike<T>): Promise<T>;
}
