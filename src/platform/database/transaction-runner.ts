import type { TransactionRunner } from "../../shared/application/ports/transaction-runner.js";
import { resolveSqlDatabase, type SqlDatabaseInput } from "./node-sql-database.js";
import type { SqlDatabase } from "../../shared/application/ports/sql-database.js";

export class DatabaseBoundaryTransactionRunner implements TransactionRunner {
	private readonly database: SqlDatabase;

	constructor(source: SqlDatabaseInput) {
		this.database = resolveSqlDatabase(source);
	}

	withTransaction<T>(work: () => T | PromiseLike<T>): Promise<T> {
		return this.database.withTransaction(() => work());
	}
}
