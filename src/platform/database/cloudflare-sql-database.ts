import type { SqlDatabase, SqlValue } from "../../shared/application/ports/sql-database.js";

interface CloudflareSqlCursor {
	toArray(): Record<string, unknown>[];
	readonly rowsWritten: number;
}

interface CloudflareSqlStorage {
	exec(query: string, ...bindings: unknown[]): CloudflareSqlCursor;
}

interface CloudflareDurableObjectStorage {
	readonly sql: CloudflareSqlStorage;
	transaction<T>(closure: () => Promise<T>): Promise<T>;
}

/** SqlDatabase adapter for SQLite-backed Durable Object storage. */
export class CloudflareSqlDatabase implements SqlDatabase {
	private transactionDepth = 0;
	private rollbackOnly = false;

	constructor(private readonly storage: CloudflareDurableObjectStorage) {}

	query<T>(sql: string, parameters: readonly SqlValue[] = []): Promise<readonly T[]> {
		const rows = this.storage.sql.exec(sql, ...parameters.map(toCloudflareBinding));
		return Promise.resolve(rows.toArray() as T[]);
	}

	async execute(sql: string, parameters: readonly SqlValue[] = []): Promise<{ readonly changes: number }> {
		const cursor = this.storage.sql.exec(sql, ...parameters.map(toCloudflareBinding));
		cursor.toArray();
		const rowsWritten = cursor.rowsWritten;
		if (rowsWritten === 0) return { changes: 0 };
		const logicalChanges = this.storage.sql.exec("SELECT changes() AS changes").toArray()[0]?.changes;
		return { changes: typeof logicalChanges === "number" ? logicalChanges : rowsWritten };
	}

	async withTransaction<T>(work: () => T | PromiseLike<T>): Promise<T> {
		if (this.transactionDepth > 0) {
			return this.runNestedTransaction(work);
		}

		this.transactionDepth = 1;
		this.rollbackOnly = false;
		try {
			return await this.storage.transaction(async () => {
				const result = await work();
				if (this.rollbackOnly) {
					throw new Error("transaction marked rollback-only");
				}
				return result;
			});
		} finally {
			this.transactionDepth = 0;
			this.rollbackOnly = false;
		}
	}

	private async runNestedTransaction<T>(work: () => T | PromiseLike<T>): Promise<T> {
		try {
			return await work();
		} catch (error) {
			this.rollbackOnly = true;
			throw error;
		}
	}
}

function toCloudflareBinding(value: SqlValue): ArrayBuffer | string | number | null {
	if (value === null || typeof value === "string" || typeof value === "number") return value;
	if (typeof value === "bigint") {
		throw new Error("Cloudflare SQLite bindings do not support bigint values");
	}
	return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) as ArrayBuffer;
}
