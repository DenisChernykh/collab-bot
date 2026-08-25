export interface TransactionRunner {
	withTransaction<T>(work: () => T | PromiseLike<T>): Promise<T>;
}
