import type { Bot } from "grammy";

import type { Clock } from "../../../application/ports/clock.js";
import type { ProviderDeadline } from "../../../application/ports/provider-deadline.js";
import type { TransactionRunner } from "../../../application/ports/transaction-runner.js";
import type { DatabaseBoundary } from "../../../infrastructure/database/database-boundary.js";
import { ProfileAudienceService } from "../application/profile-audience-service.js";
import { ProfileService } from "../application/profile-service.js";
import { GrammyTelegramAudienceReader } from "../infrastructure/grammy-telegram-audience-reader.js";
import { SqliteProfileRepository } from "../infrastructure/sqlite-profile-repository.js";
import { SqliteProfileSessionRepository } from "../infrastructure/sqlite-profile-session-repository.js";

export interface ProfilesFeature {
	readonly api: ProfileService;
	readonly audience: ProfileAudienceService;
	readonly sessions: SqliteProfileSessionRepository;
}

export interface CreateProfilesFeatureOptions {
	readonly boundary: DatabaseBoundary;
	readonly transactions: TransactionRunner;
	readonly clock: Clock;
	readonly deadline: ProviderDeadline;
	readonly telegramBot: Pick<Bot, "api">;
}

export function createProfilesFeature(options: CreateProfilesFeatureOptions): ProfilesFeature {
	const repository = new SqliteProfileRepository(options.boundary);
	return {
		api: new ProfileService(repository, options.transactions, options.clock),
		audience: new ProfileAudienceService(
			new GrammyTelegramAudienceReader(options.telegramBot),
			repository,
			options.transactions,
			options.clock,
			options.deadline,
		),
		sessions: new SqliteProfileSessionRepository(options.boundary),
	};
}
