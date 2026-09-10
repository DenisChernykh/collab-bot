import type { Bot, BotError } from "grammy";

import { CallbackActionService } from "../../shared/application/commands/callback-action.js";
import { DurableCommandExecutor } from "../../shared/application/commands/command-executor.js";
import { RequireActiveActor } from "../../shared/application/commands/require-active-actor.js";
import { DeliveryRunner } from "../../shared/application/outbox/delivery-runner.js";
import { OUTBOX_DELIVERY_KINDS } from "../../shared/application/ports/outbox-delivery-store.js";
import type { Clock } from "../../shared/application/ports/clock.js";
import type { SqlDatabase } from "../../shared/application/ports/sql-database.js";
import { registerTelegramRouter } from "../telegram/telegram-router.js";
import type { AppConfig } from "../../config/parse-config.js";
import { hashCanonicalInput } from "../../platform/crypto/canonical-input-hash.js";
import { webCryptoCapabilities } from "../../platform/crypto/capabilities.js";
import { RandomClaimTokenGenerator } from "../../platform/crypto/claim-token.js";
import { NodeOpaqueTokenCodec } from "../../platform/crypto/ingress-codecs.js";
import { NodeSqlDatabase } from "../../platform/database/node-sql-database.js";
import { SqliteCallbackActionRepository } from "../../platform/database/callback-action-repository.js";
import type { NodeSqlDatabaseSource } from "../../platform/database/node-sql-database.js";
import { SqliteDurableCommandStore } from "../../platform/database/durable-command-repository.js";
import { SqliteOutboxDeliveryRepository } from "../../platform/outbox/outbox-delivery-repository.js";
import { SqliteTelegramUserRepository } from "../../platform/database/telegram-user-repository.js";
import { DatabaseBoundaryTransactionRunner } from "../../platform/database/transaction-runner.js";
import { SafeLogger } from "../../platform/logging/safe-logger.js";
import { GrammyTelegramTransport } from "../../platform/telegram/grammy-telegram-transport.js";
import { SystemProviderDeadline } from "../../platform/time/provider-deadline.js";
import { createApplicationsFeature } from "../../modules/applications/index.js";
import { createCollaborationsFeature } from "../../modules/collaborations/index.js";
import { createMarketplaceFeature } from "../../modules/marketplace/index.js";
import { createModerationFeature } from "../../modules/moderation/index.js";
import { createProfilesFeature } from "../../modules/profiles/index.js";
import { createConnectionsFeature } from "../../modules/connections/index.js";
import type { BotRuntimeLifecycleOperations } from "../lifecycle/bot-lifecycle.js";
import { DeliveryWorker } from "../lifecycle/delivery-worker.js";
import { preflightShowcase } from "./showcase-preflight.js";

export const ALLOWED_UPDATES = ["message", "callback_query"] as const;

export interface BotApplicationCompositionOptions {
	readonly config: AppConfig;
	readonly clock: Clock;
	readonly bot: Bot;
	readonly boundary?: NodeSqlDatabaseSource;
	readonly database?: SqlDatabase;
	readonly migrate?: () => Promise<unknown>;
	readonly closeResources?: () => Promise<void>;
	readonly showcaseCapability?: { readonly canPublish: boolean; readonly reason: string | null };
	readonly logSink?: (line: string) => void;
}

export interface ComposedBotApplication {
	readonly bot: Bot;
	readonly boundary?: NodeSqlDatabaseSource;
	readonly lifecycle: BotRuntimeLifecycleOperations;
	readonly showcaseCapability: () => { readonly canPublish: boolean; readonly reason: string | null };
	readonly runDeliveryCycleOnce: () => Promise<unknown>;
}

export function assertBotIdentity(
	botInfo: { readonly id: number | string; readonly username?: string },
	expected: Pick<AppConfig, "expectedBotId" | "expectedBotUsername">,
): void {
	if (String(botInfo.id) !== expected.expectedBotId || botInfo.username?.replace(/^@+/, "") !== expected.expectedBotUsername) {
		throw new Error("Telegram bot identity mismatch");
	}
}

export function composeBotApplication(options: BotApplicationCompositionOptions): ComposedBotApplication {
	const { bot, boundary, clock } = options;
	const crypto = webCryptoCapabilities;
	const database = options.database ?? (boundary === undefined ? undefined : new NodeSqlDatabase(boundary));
	if (database === undefined) throw new Error("bot application requires a SQL database");
	const userRepository = new SqliteTelegramUserRepository(database);
	const transactionRunner = new DatabaseBoundaryTransactionRunner(database);
	const capability = {
		canPublish: options.showcaseCapability?.canPublish ?? false,
		reason: options.showcaseCapability === undefined ? "showcase preflight has not run" : options.showcaseCapability.reason,
	};
	const outboxStore = new SqliteOutboxDeliveryRepository(database);
	const connectionsFeature = createConnectionsFeature({ database, transactions: transactionRunner, clock, crypto, mfmFeatureEnabled: options.config.mfmFeatureEnabled ?? false });
	const profilesFeature = createProfilesFeature({
		mfmFeatureEnabled: options.config.mfmFeatureEnabled ?? false,
		crypto,
		database,
		transactions: transactionRunner,
		clock,
		deadline: new SystemProviderDeadline(),
		telegramBot: bot,
	});
	const collaborationsFeature = createCollaborationsFeature({
		database,
		transactions: transactionRunner,
		clock,
		crypto,
		outboxStore,
		capability,
		channelChatId: options.config.showcaseChannelId,
		botUsername: options.config.expectedBotUsername,
		profileSessions: profilesFeature.sessions,
	});
	const marketplaceFeature = createMarketplaceFeature({
		database,
		transactions: transactionRunner,
		clock,
		crypto,
	});
	const applicationsFeature = createApplicationsFeature({
		database,
		outboxStore,
		transactions: transactionRunner,
		clock,
		crypto,
		botUsername: options.config.expectedBotUsername,
	});
	const moderationFeature = createModerationFeature({
		database,
		outboxStore,
		transactions: transactionRunner,
		clock,
		crypto,
		botUsername: options.config.expectedBotUsername,
		adminTelegramIds: options.config.adminTelegramIds,
	});
	const durableCommandExecutor = new DurableCommandExecutor(transactionRunner, new SqliteDurableCommandStore(database), { hash: hashCanonicalInput }, clock);
	const callbackActionService = new CallbackActionService({
		transactionRunner,
		clock,
		executor: durableCommandExecutor,
		repository: new SqliteCallbackActionRepository(database),
		actorGuard: new RequireActiveActor(userRepository),
		allowedActionTypes: new Set(["application.accept", "application.reject", "collaboration.close"]),
		currentVersion: (entityId) => applicationsFeature.api.currentActionVersion(entityId),
		tokenCodec: new NodeOpaqueTokenCodec(),
	});

	let inFlight = 0;
	let drainResolve: (() => void) | undefined;
	bot.use(async (_ctx, next) => {
		inFlight += 1;
		try {
			await next();
		} finally {
			inFlight -= 1;
			if (inFlight === 0) drainResolve?.();
		}
	});
	registerTelegramRouter(bot, {
		connectionService: connectionsFeature.api,
		profileService: profilesFeature.api,
		onboardingService: profilesFeature.onboarding,
		profileAudienceService: profilesFeature.audience,
		sessionRepository: profilesFeature.sessions,
		telegramUserRepository: userRepository,
		durableCommandExecutor,
		clock,
		helpContact: options.config.helpContact,
		collaborationDraftService: collaborationsFeature.draft,
		collaborationPublicationService: collaborationsFeature.publication,
		collaborationBrowseService: marketplaceFeature.browse,
		applicationService: applicationsFeature.api,
		callbackActionService,
		adminModerationService: moderationFeature.api,
	});
	const logger = new SafeLogger((entry) => options.logSink?.(JSON.stringify(entry)), clock, "bot");
	bot.catch((error: BotError) => {
		logger.error("update_failed", error, { updateId: String(error.ctx.update.update_id) });
	});

	const deliveryRunner = new DeliveryRunner(outboxStore, new GrammyTelegramTransport(bot), new SystemProviderDeadline(), new RandomClaimTokenGenerator(), clock, async (result) => {
		if (result.deliveryId !== undefined) await collaborationsFeature.publication.projectDelivery(result.deliveryId, outboxStore);
	}, () => capability.canPublish ? OUTBOX_DELIVERY_KINDS : ["dm_send"]);
	const runDeliveryCycleOnce = async (): Promise<unknown> => {
		await deliveryRunner.recoverStale();
		await collaborationsFeature.publication.projectTerminalOutcomes(outboxStore);
		if (capability.canPublish) await collaborationsFeature.publication.cancelExpiredPrepared();
		await applicationsFeature.projectionMaintenance.supersedeStaleProjectionDeliveries(clock.now().getTime());
		return deliveryRunner.runOnce();
	};
	const deliveryWorker = new DeliveryWorker({
		canPublish: () => capability.canPublish,
		recoverStale: () => deliveryRunner.recoverStale(),
		projectTerminalOutcomes: () => collaborationsFeature.publication.projectTerminalOutcomes(outboxStore),
		cancelExpiredPrepared: () => collaborationsFeature.publication.cancelExpiredPrepared(),
		supersedeStaleProjections: () => applicationsFeature.projectionMaintenance.supersedeStaleProjectionDeliveries(clock.now().getTime()),
		runOnce: () => deliveryRunner.runOnce(),
	});

	const lifecycle: BotRuntimeLifecycleOperations = {
		migrate: async () => { await options.migrate?.(); },
		initializeIdentity: async () => {
			await bot.init();
			assertBotIdentity(bot.botInfo, options.config);
		},
		preflightShowcase: async () => {
			const preflight = await preflightShowcase(bot, options.config);
			capability.canPublish = preflight.canPublish;
			capability.reason = preflight.reason;
		},
		runDeliveryWorker: (signal) => deliveryWorker.run(signal),
		startPolling: (onStarted) => bot.start({
			allowed_updates: ALLOWED_UPDATES,
			onStart: onStarted,
		}),
		stopPolling: () => bot.stop(),
		drainUpdates: async () => {
			if (inFlight > 0) await new Promise<void>((resolveDrain) => { drainResolve = resolveDrain; });
		},
		closeResources: () => options.closeResources?.() ?? boundary?.close() ?? Promise.resolve(),
		onRuntimeReady: () => { logger.info("runtime_ready"); },
		onPollingStarted: () => { logger.info("poll_started"); },
		onPollingStopFailed: (error) => { logger.error("poll_stop_failed", error); },
	};

	const composed = { bot, lifecycle, runDeliveryCycleOnce, showcaseCapability: () => ({ ...capability }) };
	return boundary === undefined ? composed : { ...composed, boundary };
}
