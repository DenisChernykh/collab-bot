import type { TransactionRunner } from "../../shared/application/ports/transaction-runner.js";
import { DatabaseBoundary } from "./database-boundary.js";

export class DatabaseBoundaryTransactionRunner implements TransactionRunner {
	constructor(private readonly boundary: DatabaseBoundary) {}

	withTransaction<T>(work: () => T | PromiseLike<T>): Promise<T> {
		return this.boundary.withTransaction(() => work());
	}
}
