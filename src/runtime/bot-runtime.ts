import { access, chmod, lstat, open } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";

import { Bot, type BotError } from "grammy";

import type { AppConfig } from "../config/parse-config.js";
import type { Clock } from "../application/ports/clock.js";
import { parseConfig } from "../config/parse-config.js";
import { registerProfileBot } from "../bot/profile-bot.js";
import { DurableCommandExecutor } from "../application/commands/command-executor.js";
import { hashCanonicalInput } from "../infrastructure/crypto/canonical-input-hash.js";
import { ProfileService } from "../application/profiles/profile-service.js";
import { DatabaseBoundary } from "../infrastructure/database/database-boundary.js";
import { MigrationRunner, MigrationSource } from "../infrastructure/database/migrations.js";
import { SqliteProfileRepository } from "../infrastructure/database/profile-repository.js";
import { SqliteProfileSessionRepository } from "../infrastructure/database/profile-session-repository.js";
import { SqliteCollaborationRepository } from "../infrastructure/database/collaboration-repository.js";
import { SqliteCollaborationSessionRepository } from "../infrastructure/database/collaboration-session-repository.js";
import { CollaborationDraftService } from "../application/collaborations/collaboration-draft-service.js";
import { SqliteDurableCommandStore } from "../infrastructure/database/durable-command-repository.js";
import { DatabaseBoundaryTransactionRunner } from "../infrastructure/database/transaction-runner.js";
import { SqliteTelegramUserRepository } from "../infrastructure/database/telegram-user-repository.js";
import { SafeLogger } from "../infrastructure/logging/safe-logger.js";
import { SystemClock } from "../infrastructure/time/system-clock.js";
import { SqliteOutboxDeliveryRepository } from "../infrastructure/database/outbox-delivery-repository.js";
import { SqliteCollaborationPublicationRepository } from "../infrastructure/database/collaboration-publication-repository.js";
import { CollaborationPublicationService } from "../application/collaborations/collaboration-publication-service.js";
import { CollaborationBrowseService } from "../application/collaborations/collaboration-browse-service.js";
import { SqliteCollaborationBrowseRepository } from "../infrastructure/database/collaboration-browse-repository.js";
import { DeliveryRunner } from "../application/outbox/delivery-runner.js";
import { SystemProviderDeadline } from "../infrastructure/time/provider-deadline.js";
import { RandomClaimTokenGenerator } from "../infrastructure/crypto/claim-token.js";
import { GrammyTelegramTransport } from "../infrastructure/telegram/grammy-telegram-transport.js";
import { OUTBOX_DELIVERY_KINDS } from "../application/ports/outbox-delivery-store.js";
import { preflightShowcase } from "./showcase-preflight.js";

export const ALLOWED_UPDATES = ["message", "callback_query"] as const;

export function assertBotIdentity(
	botInfo: { readonly id: number | string; readonly username?: string },
	expected: Pick<AppConfig, "expectedBotId" | "expectedBotUsername">,
): void {
	if (String(botInfo.id) !== expected.expectedBotId || botInfo.username?.replace(/^@+/, "") !== expected.expectedBotUsername) {
		throw new Error("Telegram bot identity mismatch");
	}
}

export interface BotRuntime {
	readonly bot: Bot;
	readonly boundary: DatabaseBoundary;
	readonly start: () => Promise<void>;
	readonly shutdown: () => Promise<void>;
}

export interface BotRuntimeOptions {
	readonly config: AppConfig;
	readonly migrationsDirectory: string;
	readonly clock?: Clock;
	readonly bot?: Bot;
	readonly botFactory?: (token: string) => Bot;
	readonly databaseFactory?: (databasePath: string) => DatabaseBoundary;
	readonly logSink?: (line: string) => void;
}

export async function createBotRuntime(options: BotRuntimeOptions): Promise<BotRuntime> {
	await ensurePrivateDatabasePath(options.config.databasePath);
	const clock = options.clock ?? new SystemClock();
	const boundary = (options.databaseFactory ?? ((path) => new DatabaseBoundary(path)))(options.config.databasePath);
	try {
		const source = await MigrationSource.fromDirectory(options.migrationsDirectory);
		await new MigrationRunner(source, clock).migrate(boundary);
		const bot = options.bot ?? (options.botFactory ?? ((token) => new Bot(token)))(options.config.botToken);
		const userRepository = new SqliteTelegramUserRepository(boundary);
		const transactionRunner = new DatabaseBoundaryTransactionRunner(boundary);
		const profileSessionRepository = new SqliteProfileSessionRepository(boundary);
		const collaborationDraftService = new CollaborationDraftService(
			new SqliteCollaborationRepository(boundary),
			new SqliteCollaborationSessionRepository(boundary),
			transactionRunner,
			clock,
			profileSessionRepository,
		);
		const capability = { canPublish: false, reason: "showcase preflight has not run" as string | null };
		const outboxStore = new SqliteOutboxDeliveryRepository(boundary);
		const collaborationPublicationService = new CollaborationPublicationService(
			new SqliteCollaborationRepository(boundary),
			new SqliteCollaborationPublicationRepository(boundary),
			new SqliteCollaborationSessionRepository(boundary),
			outboxStore,
			transactionRunner,
			clock,
			capability,
			options.config.showcaseChannelId,
			options.config.expectedBotUsername,
		);
		const collaborationBrowseService = new CollaborationBrowseService(
			new SqliteCollaborationBrowseRepository(boundary),
			transactionRunner,
			clock,
		);
		const durableCommandExecutor = new DurableCommandExecutor(transactionRunner, new SqliteDurableCommandStore(boundary), { hash: hashCanonicalInput }, clock);
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
		registerProfileBot(bot, {
			profileService: new ProfileService(
				new SqliteProfileRepository(boundary),
				transactionRunner,
				clock,
			),
				sessionRepository: profileSessionRepository,
			telegramUserRepository: userRepository,
			durableCommandExecutor,
			clock,
				helpContact: options.config.helpContact,
				collaborationDraftService,
				collaborationPublicationService,
				collaborationBrowseService,
		});
		const logger = new SafeLogger((entry) => options.logSink?.(JSON.stringify(entry)), clock, "bot");
		bot.catch((error: BotError) => {
			logger.error("update_failed", error, { updateId: String(error.ctx.update.update_id) });
		});
		await bot.init();
		assertBotIdentity(bot.botInfo, options.config);

		type LifecycleState = "ready" | "starting" | "running" | "failed" | "stopping" | "stopped";
		let lifecycle: LifecycleState = "ready";
		const deliveryRunner = new DeliveryRunner(outboxStore, new GrammyTelegramTransport(bot), new SystemProviderDeadline(), new RandomClaimTokenGenerator(), clock, async (result) => {
			if (result.deliveryId !== undefined) await collaborationPublicationService.projectDelivery(result.deliveryId, outboxStore);
		}, () => capability.canPublish ? OUTBOX_DELIVERY_KINDS : ["dm_send"]);
		let deliveryLoopStop = false;
		let deliveryLoopPromise: Promise<void> | undefined;
		const startDeliveryLoop = (): void => {
			deliveryLoopStop = false;
			deliveryLoopPromise = (async () => {
				await deliveryRunner.recoverStale();
				await collaborationPublicationService.projectTerminalOutcomes(outboxStore);
				while (!deliveryLoopStop) {
					if (capability.canPublish) await collaborationPublicationService.cancelExpiredPrepared();
					await deliveryRunner.runOnce();
					await new Promise<void>((resolve) => { const timer = setTimeout(resolve, 250); timer.unref?.(); });
				}
			})();
		};
		let shutdownPromise: Promise<void> | undefined;
		const shutdown = async (): Promise<void> => {
			if (shutdownPromise !== undefined) return shutdownPromise;
			if (lifecycle === "stopped") return;
			const shouldStopPolling = lifecycle === "starting" || lifecycle === "running";
			lifecycle = "stopping";
			shutdownPromise = (async () => {
				deliveryLoopStop = true;
				if (shouldStopPolling) {
					try {
						await bot.stop();
					} catch (error) {
						logger.error("poll_stop_failed", error);
					}
				}
				if (deliveryLoopPromise !== undefined) await deliveryLoopPromise;
				if (inFlight > 0) await new Promise<void>((resolveDrain) => { drainResolve = resolveDrain; });
				await boundary.close();
				lifecycle = "stopped";
			})();
			return shutdownPromise;
		};
		const start = async (): Promise<void> => {
			if (lifecycle !== "ready") {
				throw new Error("bot runtime cannot start after shutdown or a previous start");
			}
			lifecycle = "starting";
			logger.info("runtime_ready");
			try {
				const preflight = await preflightShowcase(bot, options.config);
				capability.canPublish = preflight.canPublish;
				capability.reason = preflight.reason;
				startDeliveryLoop();
				await bot.start({
					allowed_updates: ALLOWED_UPDATES,
					onStart: () => {
						if (lifecycle === "starting") lifecycle = "running";
						logger.info("poll_started");
					},
				});
				if (lifecycle === "starting") lifecycle = "running";
			} catch (error) {
				lifecycle = "failed";
				await shutdown();
				throw error;
			}
		};
		return { bot, boundary, start, shutdown };
	} catch (error) {
		await boundary.close();
		throw error;
	}
}

export async function loadConfigFromEnvFile(envFilePath: string): Promise<AppConfig> {
	await assertPrivateEnvFile(envFilePath);
	if (typeof process.loadEnvFile !== "function") throw new Error("Node runtime lacks process.loadEnvFile");
	process.loadEnvFile(envFilePath);
	const values: Record<string, string | undefined> = {};
	for (const key of ["BOT_TOKEN", "EXPECTED_BOT_ID", "EXPECTED_BOT_USERNAME", "ADMIN_TELEGRAM_IDS", "SHOWCASE_CHANNEL_ID", "SHOWCASE_CHANNEL_USERNAME", "DATABASE_PATH", "LOG_LEVEL", "TIME_ZONE", "HELP_CONTACT"]) values[key] = process.env[key];
	return parseConfig(values).config;
}

export async function assertPrivateEnvFile(envFilePath: string): Promise<void> {
	if (!isAbsolute(envFilePath)) throw new Error("env-file path must be absolute");
	const info = await lstat(envFilePath);
	if (!info.isFile()) throw new Error("env-file path must be a regular file");
	if (process.getuid !== undefined && info.uid !== process.getuid()) throw new Error("env-file must be owned by the current user");
	if ((info.mode & 0o777) !== 0o600) throw new Error("env-file mode must be 0600");
}

export async function ensurePrivateDatabasePath(databasePath: string): Promise<void> {
	if (!isAbsolute(databasePath) || resolve(databasePath) === "/") throw new Error("database path must be an absolute non-root path");
	const parent = resolve(dirname(databasePath));
	if (parent === resolve(process.cwd())) throw new Error("database parent must not be the repository root");
	const parentInfo = await lstat(parent);
	if (!parentInfo.isDirectory() || (parentInfo.mode & 0o777) !== 0o700) {
		throw new Error("database parent must be the current user's private 0700 directory");
	}
	if (process.getuid !== undefined && parentInfo.uid !== process.getuid()) {
		throw new Error("database parent must be owned by the current user");
	}
	await access(parent, constants.W_OK);
	try {
		await assertPrivateDatabaseFile(databasePath);
	} catch (error) {
		if (!isErrno(error, "ENOENT")) throw error;
		const handle = await open(databasePath, "wx", 0o600);
		await handle.close();
		await chmod(databasePath, 0o600);
		await assertPrivateDatabaseFile(databasePath);
	}
}

function isErrno(error: unknown, code: string): boolean {
	return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === code;
}

async function assertPrivateDatabaseFile(databasePath: string): Promise<void> {
	const info = await lstat(databasePath);
	if (!info.isFile()) throw new Error("database path must be a regular file");
	if (process.getuid !== undefined && info.uid !== process.getuid()) throw new Error("database must be owned by the current user");
	if ((info.mode & 0o777) !== 0o600) throw new Error("database mode must be 0600");
}
