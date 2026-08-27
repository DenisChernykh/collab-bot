import type { ProductEventRecord } from "../outbox/product-event-contracts.js";

export interface ProductEventStore {
	findByIdempotencyKey(idempotencyKey: string): Promise<ProductEventRecord | undefined>;
	append(record: ProductEventRecord): Promise<void>;
}

export class ProductEventStoreCorruptError extends Error {
	constructor() {
		super("product event row is corrupt");
		this.name = "ProductEventStoreCorruptError";
	}
}

export class ProductEventStoreConflictError extends Error {
	constructor() {
		super("product event store conflict");
		this.name = "ProductEventStoreConflictError";
	}
}

export class ProductEventStoreIdConflictError extends Error {
	constructor() {
		super("product event ID already exists");
		this.name = "ProductEventStoreIdConflictError";
	}
}
