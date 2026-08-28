import type { Bot } from "grammy";

import type { Clock } from "../../../shared/application/ports/clock.js";
import type { ProviderDeadline } from "../../../shared/application/ports/provider-deadline.js";
import type { TransactionRunner } from "../../../shared/application/ports/transaction-runner.js";
import { resolveSqlDatabase, type SqlDatabaseInput } from "../../../platform/database/node-sql-database.js";
import type { SqlDatabase } from "../../../shared/application/ports/sql-database.js";
import type { ProfileSessionRepository } from "../application/ports/profile-session-repository.js";
import { ProfileAudienceService } from "../application/profile-audience-service.js";
import { ProfileService } from "../application/profile-service.js";
import { GrammyTelegramAudienceReader } from "../infrastructure/grammy-telegram-audience-reader.js";
import { SqliteProfileRepository } from "../infrastructure/sqlite-profile-repository.js";
import { SqliteProfileSessionRepository } from "../infrastructure/sqlite-profile-session-repository.js";

export interface ProfilesFeature {
	readonly api: ProfileService;
	readonly audience: ProfileAudienceService;
	readonly sessions: ProfileSessionRepository;
}

export interface CreateProfilesFeatureOptions {
	readonly boundary?: SqlDatabaseInput;
	readonly database?: SqlDatabase;
	readonly transactions: TransactionRunner;
	readonly clock: Clock;
	readonly deadline: ProviderDeadline;
	readonly telegramBot: Pick<Bot, "api">;
}

export function createProfilesFeature(options: CreateProfilesFeatureOptions): ProfilesFeature {
	const database = options.database ?? (options.boundary === undefined ? undefined : resolveSqlDatabase(options.boundary));
	if (database === undefined) throw new Error("profiles feature requires a SQL database");
	const repository = new SqliteProfileRepository(database);
	return {
		api: new ProfileService(repository, options.transactions, options.clock),
		audience: new ProfileAudienceService(
			new GrammyTelegramAudienceReader(options.telegramBot),
			repository,
			options.transactions,
			options.clock,
			options.deadline,
		),
		sessions: new SqliteProfileSessionRepository(database),
	};
}
