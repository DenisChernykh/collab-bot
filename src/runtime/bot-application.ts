import type { Bot, BotError } from "grammy";

import { CallbackActionService } from "../application/commands/callback-action.js";
import { DurableCommandExecutor } from "../application/commands/command-executor.js";
import { RequireActiveActor } from "../application/commands/require-active-actor.js";
import { DeliveryRunner } from "../application/outbox/delivery-runner.js";
import { OUTBOX_DELIVERY_KINDS } from "../application/ports/outbox-delivery-store.js";
import type { Clock } from "../application/ports/clock.js";
import { registerTelegramRouter } from "../presentation/telegram/telegram-router.js";
import type { AppConfig } from "../config/parse-config.js";
import { hashCanonicalInput } from "../infrastructure/crypto/canonical-input-hash.js";
import { RandomClaimTokenGenerator } from "../infrastructure/crypto/claim-token.js";
import { NodeOpaqueTokenCodec } from "../infrastructure/crypto/ingress-codecs.js";
import { SqliteCallbackActionRepository } from "../infrastructure/database/callback-action-repository.js";
import type { DatabaseBoundary } from "../infrastructure/database/database-boundary.js";
import { SqliteDurableCommandStore } from "../infrastructure/database/durable-command-repository.js";
import { SqliteOutboxDeliveryRepository } from "../infrastructure/database/outbox-delivery-repository.js";
import { SqliteTelegramUserRepository } from "../infrastructure/database/telegram-user-repository.js";
import { DatabaseBoundaryTransactionRunner } from "../infrastructure/database/transaction-runner.js";
import { SafeLogger } from "../infrastructure/logging/safe-logger.js";
import { GrammyTelegramTransport } from "../infrastructure/telegram/grammy-telegram-transport.js";
import { SystemProviderDeadline } from "../infrastructure/time/provider-deadline.js";
import { createApplicationsFeature } from "../modules/applications/index.js";
import { createCollaborationsFeature } from "../modules/collaborations/index.js";
import { createMarketplaceFeature } from "../modules/marketplace/index.js";
import { createModerationFeature } from "../modules/moderation/index.js";
import { createProfilesFeature } from "../modules/profiles/index.js";
import type { BotRuntimeLifecycleOperations } from "./bot-lifecycle.js";
import { DeliveryWorker } from "./delivery-worker.js";
import { preflightShowcase } from "./showcase-preflight.js";

export const ALLOWED_UPDATES = ["message", "callback_query"] as const;

export interface BotApplicationCompositionOptions {
	readonly config: AppConfig;
	readonly clock: Clock;
	readonly bot: Bot;
	readonly boundary: DatabaseBoundary;
	readonly migrate: () => Promise<unknown>;
	readonly logSink?: (line: string) => void;
}

export interface ComposedBotApplication {
	readonly bot: Bot;
	readonly boundary: DatabaseBoundary;
	readonly lifecycle: BotRuntimeLifecycleOperations;
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
	const userRepository = new SqliteTelegramUserRepository(boundary);
	const transactionRunner = new DatabaseBoundaryTransactionRunner(boundary);
	const capability = { canPublish: false, reason: "showcase preflight has not run" as string | null };
	const outboxStore = new SqliteOutboxDeliveryRepository(boundary);
	const profilesFeature = createProfilesFeature({
		boundary,
		transactions: transactionRunner,
		clock,
		deadline: new SystemProviderDeadline(),
		telegramBot: bot,
	});
	const collaborationsFeature = createCollaborationsFeature({
		boundary,
		transactions: transactionRunner,
		clock,
		outboxStore,
		capability,
		channelChatId: options.config.showcaseChannelId,
		botUsername: options.config.expectedBotUsername,
		profileSessions: profilesFeature.sessions,
	});
	const marketplaceFeature = createMarketplaceFeature({
		boundary,
		transactions: transactionRunner,
		clock,
	});
	const applicationsFeature = createApplicationsFeature({
		boundary,
		outboxStore,
		transactions: transactionRunner,
		clock,
		botUsername: options.config.expectedBotUsername,
	});
	const moderationFeature = createModerationFeature({
		boundary,
		outboxStore,
		transactions: transactionRunner,
		clock,
		botUsername: options.config.expectedBotUsername,
		adminTelegramIds: options.config.adminTelegramIds,
	});
	const durableCommandExecutor = new DurableCommandExecutor(transactionRunner, new SqliteDurableCommandStore(boundary), { hash: hashCanonicalInput }, clock);
	const callbackActionService = new CallbackActionService({
		transactionRunner,
		clock,
		executor: durableCommandExecutor,
		repository: new SqliteCallbackActionRepository(boundary),
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
		profileService: profilesFeature.api,
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
	const deliveryWorker = new DeliveryWorker({
		canPublish: () => capability.canPublish,
		recoverStale: () => deliveryRunner.recoverStale(),
		projectTerminalOutcomes: () => collaborationsFeature.publication.projectTerminalOutcomes(outboxStore),
		cancelExpiredPrepared: () => collaborationsFeature.publication.cancelExpiredPrepared(),
		supersedeStaleProjections: () => applicationsFeature.projectionMaintenance.supersedeStaleProjectionDeliveries(clock.now().getTime()),
		runOnce: () => deliveryRunner.runOnce(),
	});

	const lifecycle: BotRuntimeLifecycleOperations = {
		migrate: async () => { await options.migrate(); },
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
		closeResources: () => boundary.close(),
		onRuntimeReady: () => { logger.info("runtime_ready"); },
		onPollingStarted: () => { logger.info("poll_started"); },
		onPollingStopFailed: (error) => { logger.error("poll_stop_failed", error); },
	};

	return { bot, boundary, lifecycle };
}
