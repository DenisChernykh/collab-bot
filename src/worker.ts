import { CloudflareMigrationRunner } from "./platform/database/cloudflare-migrations.js";
import { CloudflareSqlDatabase } from "./platform/database/cloudflare-sql-database.js";
import { Bot } from "grammy";

import type { AppConfig } from "./config/parse-config.js";
import { composeBotApplication } from "./runtime/composition/bot-application.js";
import { constantTimeEqual, handleTelegramWebhook } from "./runtime/cloudflare/webhook.js";
import { SystemClock } from "./platform/time/system-clock.js";

const SINGLETON_NAME = "collaboration-bot-primary";
const PREFLIGHT_TABLE = "cf1_preflight_cache";

interface CloudflareEnvironment extends Env {
	readonly BOT_TOKEN?: string;
	readonly EXPECTED_BOT_ID?: string;
	readonly EXPECTED_BOT_USERNAME?: string;
	readonly ADMIN_TELEGRAM_IDS?: string;
	readonly SHOWCASE_CHANNEL_ID?: string;
	readonly SHOWCASE_CHANNEL_USERNAME?: string;
	readonly HELP_CONTACT?: string;
	readonly TELEGRAM_WEBHOOK_SECRET?: string;
	readonly OPERATIONS_TOKEN?: string;
	readonly STATE_IMPORT_ENABLED?: string;
}

interface PreflightCache {
	readonly botId: string;
	readonly botUsername: string;
	readonly showcaseChannelId: string;
	readonly showcaseChannelUsername: string;
	readonly canPublish: boolean;
	readonly reason: string | null;
}

function json(body: Record<string, unknown>, status = 200): Response {
	return Response.json(body, {
		status,
		headers: { "cache-control": "no-store" },
	});
}

export class CollaborationBotState implements DurableObject {
	private readonly state: DurableObjectState;
	private readonly database: CloudflareSqlDatabase;
	private readonly migrations: CloudflareMigrationRunner;
	private readonly ready: Promise<void>;
	private readonly environment: CloudflareEnvironment;
	private application: ReturnType<typeof composeBotApplication> | undefined;
	private cachedPreflight: PreflightCache | undefined;
	private preflightPromise: Promise<void> | undefined;

	constructor(state: DurableObjectState, environment: CloudflareEnvironment) {
		this.state = state;
		this.environment = environment;
		this.database = new CloudflareSqlDatabase(state.storage);
		this.migrations = new CloudflareMigrationRunner(this.database);
		this.ready = state.blockConcurrencyWhile(async () => {
			await this.migrations.migrate();
			await this.ensurePreflightTable();
			const storedPreflight = await this.readPreflightCache();
			this.cachedPreflight = storedPreflight !== undefined
				&& this.hasPreflightConfiguration()
				&& this.matchesCurrentConfig(storedPreflight)
				? storedPreflight
				: undefined;
			const bot = new Bot(environment.BOT_TOKEN ?? "local-development-placeholder");
			this.application = composeBotApplication({
				bot,
				clock: new SystemClock(),
				config: createWorkerConfig(environment),
				database: this.database,
				migrate: async () => undefined,
				closeResources: async () => undefined,
				...(this.cachedPreflight === undefined ? {} : { showcaseCapability: this.cachedPreflight }),
			});
		});
	}

	async fetch(request: Request): Promise<Response> {
		const pathname = new URL(request.url).pathname;
		if (request.method === "GET" && pathname === "/__cf1/ready") {
			await this.ready;
			return json({ status: "ready", durableObject: "CollaborationBotState" });
		}
		if (pathname === "/__cf1/state/export" || pathname === "/__cf1/state/import") {
			await this.ready;
			return json({ error: "state_transfer_not_ready" }, 501);
		}
		if (request.method !== "GET" || !["/__cf1/smoke", "/__cf1/schema"].includes(pathname)) {
			if (request.method === "POST" && pathname === "/__cf1/update") return this.handleUpdate(request);
			return json({ error: "not_found" }, 404);
		}
		await this.ready;

		if (pathname === "/__cf1/schema") {
			await this.migrations.verify();
			const rows = await this.database.query<{ count: number }>(
				"SELECT count(*) AS count FROM __app_migrations",
			);
			return json({ migrationCount: rows[0]?.count ?? 0, historyTable: "__app_migrations", integrity: "ok" });
		}

		this.state.storage.sql.exec(
			"CREATE TABLE IF NOT EXISTS cf1_runtime_probe (id INTEGER PRIMARY KEY, value TEXT NOT NULL)",
		);
		this.state.storage.sql.exec(
			"INSERT INTO cf1_runtime_probe (id, value) VALUES (1, 'ready') ON CONFLICT(id) DO UPDATE SET value = excluded.value",
		);
		const row = this.state.storage.sql
			.exec<{ value: string }>("SELECT value FROM cf1_runtime_probe WHERE id = 1")
			.one();

		return json({ durableObject: "CollaborationBotState", storage: row.value });
	}

	private async handleUpdate(request: Request): Promise<Response> {
		await this.ready;
		if (this.application === undefined) return json({ error: "handler_unavailable" }, 500);
		let update: unknown;
		try {
			update = await request.json();
		} catch {
			return json({ error: "malformed_update" }, 400);
		}
		if (!isRecord(update)) return json({ error: "malformed_update" }, 400);
		try {
			await this.ensurePreflight();
			await this.application.bot.handleUpdate(update as never);
		} catch {
			return json({ error: "handler_failure" }, 500);
		}
		return new Response(null, { status: 204 });
	}

	private async ensurePreflight(): Promise<void> {
		if (this.cachedPreflight !== undefined && this.matchesCurrentConfig(this.cachedPreflight)) return;
		if (!this.hasPreflightConfiguration()) return;
		if (this.preflightPromise !== undefined) return this.preflightPromise;
		this.preflightPromise = this.runPreflight().finally(() => {
			this.preflightPromise = undefined;
		});
		return this.preflightPromise;
	}

	private async runPreflight(): Promise<void> {
		if (this.application === undefined) throw new Error("handler_unavailable");
		await this.application.lifecycle.initializeIdentity();
		await this.application.lifecycle.preflightShowcase();
		const capability = this.application.showcaseCapability();
		const cache: PreflightCache = {
			botId: this.environment.EXPECTED_BOT_ID as string,
			botUsername: normalizeUsername(this.environment.EXPECTED_BOT_USERNAME as string),
			showcaseChannelId: this.environment.SHOWCASE_CHANNEL_ID as string,
			showcaseChannelUsername: normalizeUsername(this.environment.SHOWCASE_CHANNEL_USERNAME as string),
			canPublish: capability.canPublish,
			reason: capability.reason,
		};
		if (cache.reason === "showcase preflight failed") return;
		await this.database.withTransaction(async () => {
			await this.database.execute(`DELETE FROM ${PREFLIGHT_TABLE}`);
			await this.database.execute(
			`INSERT INTO ${PREFLIGHT_TABLE} (id, bot_id, bot_username, showcase_channel_id, showcase_channel_username, can_publish, reason, checked_at) VALUES (1, ?, ?, ?, ?, ?, ?, ?)`,
			[
				cache.botId,
				cache.botUsername,
				cache.showcaseChannelId,
				cache.showcaseChannelUsername,
				cache.canPublish ? 1 : 0,
				cache.reason,
				Date.now(),
			],
			);
		});
		this.cachedPreflight = cache;
	}

	private async ensurePreflightTable(): Promise<void> {
		await this.database.execute(`
			CREATE TABLE IF NOT EXISTS ${PREFLIGHT_TABLE} (
				id INTEGER PRIMARY KEY CHECK (id = 1),
				bot_id TEXT NOT NULL,
				bot_username TEXT NOT NULL,
				showcase_channel_id TEXT NOT NULL,
				showcase_channel_username TEXT NOT NULL,
				can_publish INTEGER NOT NULL CHECK (can_publish IN (0, 1)),
				reason TEXT,
				checked_at INTEGER NOT NULL
			)
		`);
	}

	private readPreflightCache(): Promise<PreflightCache | undefined> {
		return this.database.query<{
			bot_id: string;
			bot_username: string;
			showcase_channel_id: string;
			showcase_channel_username: string;
			can_publish: number;
			reason: string | null;
		}>(`SELECT bot_id, bot_username, showcase_channel_id, showcase_channel_username, can_publish, reason FROM ${PREFLIGHT_TABLE} WHERE id = 1`).then((rows) => {
			const row = rows[0];
			return row === undefined ? undefined : {
				botId: row.bot_id,
				botUsername: row.bot_username,
				showcaseChannelId: row.showcase_channel_id,
				showcaseChannelUsername: row.showcase_channel_username,
				canPublish: row.can_publish === 1,
				reason: row.reason,
			};
		});
	}

	private hasPreflightConfiguration(): boolean {
		return this.environment.BOT_TOKEN !== undefined && this.environment.BOT_TOKEN !== "local-development-placeholder"
			&& this.environment.EXPECTED_BOT_ID !== undefined && this.environment.EXPECTED_BOT_USERNAME !== undefined
			&& this.environment.SHOWCASE_CHANNEL_ID !== undefined && this.environment.SHOWCASE_CHANNEL_USERNAME !== undefined;
	}

	private matchesCurrentConfig(cache: PreflightCache): boolean {
		return cache.botId === this.environment.EXPECTED_BOT_ID
			&& cache.botUsername === normalizeUsername(this.environment.EXPECTED_BOT_USERNAME)
			&& cache.showcaseChannelId === this.environment.SHOWCASE_CHANNEL_ID
			&& cache.showcaseChannelUsername === normalizeUsername(this.environment.SHOWCASE_CHANNEL_USERNAME);
	}
}

export default {
	async fetch(request: Request, environment: Env): Promise<Response> {
		const url = new URL(request.url);
		if (request.method === "GET" && url.pathname === "/health/live") {
			return json({ status: "ok", runtime: "cloudflare-local" });
		}

		if (url.pathname === "/telegram/webhook") {
			const runtimeEnvironment = environment as CloudflareEnvironment;
			return handleTelegramWebhook(request, runtimeEnvironment.TELEGRAM_WEBHOOK_SECRET, async (update) => {
				const objectId = runtimeEnvironment.COLLABORATION_STATE.idFromName(SINGLETON_NAME);
				const response = await runtimeEnvironment.COLLABORATION_STATE.get(objectId).fetch(
					new Request(new URL("/__cf1/update", request.url), {
						method: "POST",
						headers: { "content-type": "application/json" },
						body: JSON.stringify(update),
					}),
				);
				if (!response.ok) throw new Error("durable update failed");
			});
		}

		if (url.pathname === "/ops/ready" || url.pathname === "/ops/state/export" || url.pathname === "/ops/state/import") {
			const runtimeEnvironment = environment as CloudflareEnvironment;
			if (!isOperationsRequestAuthorized(request, runtimeEnvironment.OPERATIONS_TOKEN)) return json({ error: "unauthorized" }, 401);
			if (url.pathname === "/ops/state/import" && runtimeEnvironment.STATE_IMPORT_ENABLED !== "true") return json({ error: "state_import_disabled" }, 403);
			const objectId = runtimeEnvironment.COLLABORATION_STATE.idFromName(SINGLETON_NAME);
			const response = await runtimeEnvironment.COLLABORATION_STATE.get(objectId).fetch(
				new Request(new URL(`/__cf1${url.pathname.slice(4)}`, request.url), { method: request.method, headers: request.headers, body: request.method === "POST" ? request.body : null }),
			);
			return new Response(response.body, { status: response.status, headers: response.headers });
		}

		return json({ error: "not_found" }, 404);
	},
};

function createWorkerConfig(environment: CloudflareEnvironment): AppConfig {
	return {
		botToken: environment.BOT_TOKEN ?? "local-development-placeholder",
		expectedBotId: environment.EXPECTED_BOT_ID ?? "0",
		expectedBotUsername: environment.EXPECTED_BOT_USERNAME ?? "local_bot",
		adminTelegramIds: parseIds(environment.ADMIN_TELEGRAM_IDS),
		showcaseChannelId: environment.SHOWCASE_CHANNEL_ID ?? "0",
		showcaseChannelUsername: environment.SHOWCASE_CHANNEL_USERNAME ?? "local_channel",
		databasePath: "collaboration-bot-state",
		logLevel: "info",
		timeZone: "Asia/Yekaterinburg",
		helpContact: environment.HELP_CONTACT ?? "@collaboration_bot_support",
	};
}

function isOperationsRequestAuthorized(request: Request, expectedToken: string | undefined): boolean {
	if (expectedToken === undefined || expectedToken === "") return false;
	const authorization = request.headers.get("authorization");
	const presented = authorization?.startsWith("Bearer ") === true ? authorization.slice("Bearer ".length) : null;
	return constantTimeEqual(presented, expectedToken);
}

function parseIds(value: string | undefined): readonly string[] {
	return value === undefined ? [] : value.split(",").map((item) => item.trim()).filter((item) => item !== "");
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function normalizeUsername(value: string | undefined): string {
	return (value ?? "").replace(/^@+/, "").toLowerCase();
}
