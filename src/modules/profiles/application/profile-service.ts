import type { Clock } from "../../../shared/application/ports/clock.js";
import type { TransactionRunner } from "../../../shared/application/ports/transaction-runner.js";
import type { ProfileRepository } from "./ports/profile-repository.js";
import {
	isCompleteProfile,
	validateInitialProfileName,
	validateProfileInput,
	type ProfileInput,
	type ProfileRecord,
	type PublicProfileRecord,
} from "../domain/profile.js";

export type { ProfileInput } from "../domain/profile.js";

export class ProfileAlreadyExistsError extends Error {
	constructor() {
		super("active profile already exists");
		this.name = "ProfileAlreadyExistsError";
	}
}

export class ProfileNotFoundError extends Error {
	constructor() {
		super("active profile was not found");
		this.name = "ProfileNotFoundError";
	}
}

export class ProfileService {
	constructor(
		private readonly repository: ProfileRepository,
		private readonly transactionRunner: TransactionRunner,
		private readonly clock: Clock,
	) {}

	async ensureFromTelegram(telegramUserId: string, displayName: string): Promise<ProfileRecord> {
		return this.transactionRunner.withTransaction(async () => {
			const existing = await this.repository.findActiveByTelegramUserId(telegramUserId);
			if (existing !== undefined) return existing;
			return this.repository.createInitial(telegramUserId, validateInitialProfileName(displayName), clockMilliseconds(this.clock));
		});
	}

	async create(telegramUserId: string, input: ProfileInput): Promise<ProfileRecord> {
		const normalized = validateProfileInput(input);
		const now = clockMilliseconds(this.clock);
		return this.transactionRunner.withTransaction(async () => {
			const existing = await this.repository.findActiveByTelegramUserId(telegramUserId);
			if (existing !== undefined) {
				if (!isCompleteProfile(existing)) return this.repository.update(telegramUserId, normalized, now);
				throw new ProfileAlreadyExistsError();
			}
			try {
				return await this.repository.create(telegramUserId, normalized, now);
			} catch (error) {
				if (isUniqueConstraintError(error)) {
					throw new ProfileAlreadyExistsError();
				}
				throw error;
			}
		});
	}

	async update(telegramUserId: string, input: ProfileInput): Promise<ProfileRecord> {
		const normalized = validateProfileInput(input);
		const now = clockMilliseconds(this.clock);
		return this.transactionRunner.withTransaction(async () => {
			const existing = await this.repository.findActiveByTelegramUserId(telegramUserId);
			if (existing === undefined) {
				throw new ProfileNotFoundError();
			}
			return this.repository.update(telegramUserId, normalized, now);
		});
	}

	getOwn(telegramUserId: string): Promise<ProfileRecord | undefined> {
		return this.repository.findActiveByTelegramUserId(telegramUserId);
	}

	getPublic(profileId: string): Promise<PublicProfileRecord | undefined> {
		return this.repository.findPublicById(profileId);
	}
}

function isUniqueConstraintError(error: unknown): boolean {
	return error instanceof Error && /unique constraint failed/i.test(error.message);
}

function clockMilliseconds(clock: Clock): number {
	const milliseconds = clock.now().getTime();
	if (!Number.isSafeInteger(milliseconds) || milliseconds < 0) {
		throw new RangeError("profile clock returned an unsafe timestamp");
	}
	return milliseconds;
}
