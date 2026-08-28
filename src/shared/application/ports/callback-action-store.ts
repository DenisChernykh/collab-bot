export type CallbackActionMode = "one_shot" | "reusable";

export interface CallbackActionRecord {
	readonly tokenHash: string;
	readonly actorTelegramUserId: string;
	readonly actionType: string;
	readonly entityId: string | null;
	readonly expectedVersion: number | null;
	readonly mode: CallbackActionMode;
	readonly expiresAt: number;
	readonly consumedAt: number | null;
	readonly resultJson: string | null;
}

export interface CallbackActionStore {
	findByTokenHash(tokenHash: string): Promise<CallbackActionRecord | undefined>;
	insert(record: CallbackActionRecord): Promise<void>;
	consume(tokenHash: string, consumedAt: number, resultJson: string): Promise<void>;
	deleteExpired(now: number): Promise<number>;
}

export class CallbackActionStoreCorruptError extends Error {
	constructor() {
		super("callback action store row is corrupt");
		this.name = "CallbackActionStoreCorruptError";
	}
}
