import { AsyncLocalStorage } from "node:async_hooks";
import { DatabaseSync } from "node:sqlite";

type SqlValue = null | number | bigint | string | NodeJS.ArrayBufferView;

export interface DatabaseContext {
	readonly client: DatabaseSync;
}

interface ActiveContext extends DatabaseContext {
	readonly boundary: DatabaseBoundary;
	transactionDepth: number;
	rollbackOnly: boolean;
}

export class DatabaseClosedError extends Error {
	constructor() {
		super("database boundary is closed");
		this.name = "DatabaseClosedError";
	}
}

export class TransactionRollbackOnlyError extends Error {
	constructor() {
		super("transaction marked rollback-only");
		this.name = "TransactionRollbackOnlyError";
	}
}

export class DatabaseBoundary {
	private readonly storage = new AsyncLocalStorage<ActiveContext>();
	private readonly client: DatabaseSync;
	private queueTail: Promise<void> = Promise.resolve();
	private closeRequested = false;
	private closed = false;
	private closePromise: Promise<void> | undefined;

	constructor(readonly databasePath: string) {
		this.client = new DatabaseSync(databasePath, {
			timeout: 5000,
			allowExtension: false,
			enableForeignKeyConstraints: true,
			defensive: true,
		});
		this.client.enableLoadExtension(false);
		this.client.enableDefensive(true);
		this.client.exec(
			"PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;",
		);
	}

	withClient<T>(work: (context: DatabaseContext) => T | PromiseLike<T>): Promise<T> {
		this.ensureUsable();
		const current = this.storage.getStore();
		if (current?.boundary === this) {
			return Promise.resolve(work(current));
		}

		return this.enqueue(() => {
			const context = this.createContext();
			return this.storage.run(context, () => Promise.resolve(work(context)));
		});
	}

	execute(sql: string, parameters: readonly SqlValue[] = []): Promise<unknown> {
		return this.withClient(({ client }) => client.prepare(sql).run(...parameters));
	}

	query<T>(sql: string, parameters: readonly SqlValue[] = []): Promise<readonly T[]> {
		return this.withClient(({ client }) => client.prepare(sql).all(...parameters) as T[]);
	}

	withTransaction<T>(work: (context: DatabaseContext) => T | PromiseLike<T>): Promise<T> {
		this.ensureUsable();
		const current = this.storage.getStore();
		if (current?.boundary === this && current.transactionDepth > 0) {
			return this.runNestedTransaction(current, work);
		}
		if (current?.boundary === this) {
			return this.runTransaction(current, work);
		}
		return this.withClient((context) => this.runTransaction(context as ActiveContext, work));
	}

	close(): Promise<void> {
		if (this.closePromise !== undefined) {
			return this.closePromise;
		}
		if (this.storage.getStore()?.boundary === this) {
			return Promise.reject(new Error("cannot close database inside an active operation"));
		}
		this.closeRequested = true;
		this.closePromise = this.enqueue(async () => {
			if (!this.closed) {
				this.client.close();
				this.closed = true;
			}
		});
		return this.closePromise;
	}

	private createContext(): ActiveContext {
		return {
			boundary: this,
			client: this.client,
			transactionDepth: 0,
			rollbackOnly: false,
		};
	}

	private async runTransaction<T>(
		context: ActiveContext,
		work: (context: DatabaseContext) => T | PromiseLike<T>,
	): Promise<T> {
		context.client.exec("BEGIN IMMEDIATE");
		context.transactionDepth += 1;
		try {
			const result = await work(context);
			if (context.rollbackOnly) {
				throw new TransactionRollbackOnlyError();
			}
			context.client.exec("COMMIT");
			return result;
		} catch (error) {
			try {
				context.client.exec("ROLLBACK");
			} catch {
				// Preserve the transaction's original failure.
			}
			throw error;
		} finally {
			context.transactionDepth -= 1;
		}
	}

	private async runNestedTransaction<T>(
		context: ActiveContext,
		work: (context: DatabaseContext) => T | PromiseLike<T>,
	): Promise<T> {
		try {
			return await work(context);
		} catch (error) {
			context.rollbackOnly = true;
			throw error;
		}
	}

	private ensureUsable(): void {
		if (this.closed || this.closeRequested) {
			throw new DatabaseClosedError();
		}
	}

	private enqueue<T>(operation: () => Promise<T>): Promise<T> {
		const run = this.queueTail.then(operation, operation);
		this.queueTail = run.then(
			() => undefined,
			() => undefined,
		);
		return run;
	}
}
