import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { assertPrivateEnvFile } from "../runtime/bootstrap/private-runtime-paths.js";

const TELEGRAM_API_BASE = "https://api.telegram.org";
const ALLOWED_UPDATES = ["message", "callback_query"] as const;

export type RelayConfigInput = Record<string, string | undefined>;

export interface RelayConfig {
	readonly botToken: string;
	readonly workerUrl: string;
	readonly webhookSecret: string;
	readonly pollTimeoutSeconds: number;
	readonly retryDelayMs: number;
}

export interface RelayDependencies {
	readonly fetch?: (input: string, init?: RequestInit) => Promise<Response>;
	readonly sleep?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
	readonly log?: (event: "relay_poll" | "relay_forward" | "relay_step_failed", detail: string) => void;
}

export function parseRelayConfig(input: RelayConfigInput): RelayConfig {
	const botToken = required(input.RELAY_BOT_TOKEN, "RELAY_BOT_TOKEN");
	const webhookSecret = required(input.TELEGRAM_WEBHOOK_SECRET, "TELEGRAM_WEBHOOK_SECRET");
	const workerUrl = required(input.LOCAL_WORKER_URL, "LOCAL_WORKER_URL");
	let parsedWorkerUrl: URL;
	try {
		parsedWorkerUrl = new URL(workerUrl);
	} catch {
		throw new Error("LOCAL_WORKER_URL must be an absolute HTTP(S) URL");
	}
	if (!/^https?:$/u.test(parsedWorkerUrl.protocol) || !new Set(["localhost", "127.0.0.1", "[::1]"]).has(parsedWorkerUrl.hostname) || parsedWorkerUrl.username !== "" || parsedWorkerUrl.password !== "" || parsedWorkerUrl.search !== "" || parsedWorkerUrl.hash !== "") {
		throw new Error("LOCAL_WORKER_URL must be a loopback HTTP(S) URL without credentials or query parameters");
	}
	const pollTimeoutSeconds = boundedInteger(input.RELAY_POLL_TIMEOUT_SECONDS ?? "25", "RELAY_POLL_TIMEOUT_SECONDS", 1, 50);
	const retryDelayMs = boundedInteger(input.RELAY_RETRY_DELAY_MS ?? "1000", "RELAY_RETRY_DELAY_MS", 100, 60_000);
	return {
		botToken,
		workerUrl: parsedWorkerUrl.toString().replace(/\/$/u, ""),
		webhookSecret,
		pollTimeoutSeconds,
		retryDelayMs,
	};
}

export async function loadRelayConfigFromEnvFile(envFilePath: string): Promise<RelayConfig> {
	await assertPrivateEnvFile(envFilePath);
	if (typeof process.loadEnvFile !== "function") throw new Error("Node runtime lacks process.loadEnvFile");
	process.loadEnvFile(envFilePath);
	return parseRelayConfig({
		RELAY_BOT_TOKEN: process.env.RELAY_BOT_TOKEN,
		LOCAL_WORKER_URL: process.env.LOCAL_WORKER_URL,
		TELEGRAM_WEBHOOK_SECRET: process.env.TELEGRAM_WEBHOOK_SECRET,
		RELAY_POLL_TIMEOUT_SECONDS: process.env.RELAY_POLL_TIMEOUT_SECONDS,
		RELAY_RETRY_DELAY_MS: process.env.RELAY_RETRY_DELAY_MS,
	});
}

export function parseRelayArguments(args: readonly string[]): string {
	if (args.length === 1 && args[0]?.startsWith("--env-file=")) {
		const value = args[0].slice("--env-file=".length);
		if (value !== "") return value;
	}
	if (args.length === 2 && args[0] === "--env-file" && args[1] !== undefined && args[1] !== "") return args[1];
	throw new Error("usage: cloudflare-relay --env-file <absolute-private-file>");
}

export async function runTelegramRelay(
	config: RelayConfig,
	dependencies: RelayDependencies = {},
	signal: AbortSignal = new AbortController().signal,
): Promise<void> {
	const fetcher = dependencies.fetch ?? ((input, init) => fetch(input, init));
	const sleeper = dependencies.sleep ?? sleep;
	const log = dependencies.log ?? (() => undefined);
	let offset: number | undefined;

	while (!signal.aborted) {
		let stage: "poll" | "forward" = "poll";
		try {
			const response = await fetcher(buildGetUpdatesUrl(config, offset), { method: "GET", headers: { accept: "application/json" }, signal });
			const payload = await readTelegramResponse(response);
			if (!Array.isArray(payload.result)) throw new Error("invalid update list");
			let forwarded = 0;
			for (const update of payload.result) {
				stage = "forward";
				if (!isTelegramUpdate(update)) throw new Error("invalid update");
				const workerResponse = await fetcher(buildWorkerWebhookUrl(config), {
					method: "POST",
					headers: {
						"content-type": "application/json",
						"x-telegram-bot-api-secret-token": config.webhookSecret,
					},
					body: JSON.stringify(update),
					signal,
				});
				if (workerResponse.status !== 204) throw new Error("worker rejected update");
				offset = update.update_id + 1;
				forwarded += 1;
			}
			log(forwarded === 0 ? "relay_poll" : "relay_forward", String(forwarded));
		} catch {
			if (signal.aborted) return;
			log("relay_step_failed", stage);
			await sleeper(config.retryDelayMs, signal);
		}
	}
}

function buildGetUpdatesUrl(config: RelayConfig, offset: number | undefined): string {
	const query = new URLSearchParams({
		allowed_updates: JSON.stringify(ALLOWED_UPDATES),
		limit: "100",
		timeout: String(config.pollTimeoutSeconds),
	});
	if (offset !== undefined) query.set("offset", String(offset));
	return `${TELEGRAM_API_BASE}/bot${config.botToken}/getUpdates?${query.toString()}`;
}

function buildWorkerWebhookUrl(config: RelayConfig): string {
	return `${config.workerUrl}/telegram/webhook`;
}

async function readTelegramResponse(response: Response): Promise<{ result: unknown }> {
	if (!response.ok) throw new Error("Telegram polling failed");
	let payload: unknown;
	try {
		payload = await response.json();
	} catch {
		throw new Error("Telegram polling returned malformed JSON");
	}
	if (!isRecord(payload) || payload.ok !== true || !("result" in payload)) throw new Error("Telegram polling returned an error");
	return { result: payload.result };
}

function isTelegramUpdate(value: unknown): value is { readonly update_id: number } {
	return isRecord(value) && typeof value.update_id === "number" && Number.isSafeInteger(value.update_id) && value.update_id >= 0;
}

function required(value: string | undefined, key: string): string {
	if (value === undefined || value.trim() === "") throw new Error(`${key} is required`);
	return value.trim();
}

function boundedInteger(value: string, key: string, minimum: number, maximum: number): number {
	if (!/^\d+$/u.test(value)) throw new Error(`${key} must be an integer`);
	const parsed = Number(value);
	if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) throw new Error(`${key} must be between ${minimum} and ${maximum}`);
	return parsed;
}

async function sleep(milliseconds: number, signal: AbortSignal): Promise<void> {
	await new Promise<void>((resolvePromise) => {
		const timer = setTimeout(resolvePromise, milliseconds);
		signal.addEventListener("abort", () => {
			clearTimeout(timer);
			resolvePromise();
		}, { once: true });
	});
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

async function main(): Promise<void> {
	const config = await loadRelayConfigFromEnvFile(parseRelayArguments(process.argv.slice(2)));
	const controller = new AbortController();
	const stop = (): void => controller.abort();
	process.once("SIGINT", stop);
	process.once("SIGTERM", stop);
	try {
		await runTelegramRelay(config, {}, controller.signal);
	} finally {
		process.off("SIGINT", stop);
		process.off("SIGTERM", stop);
	}
}

const entrypoint = process.argv[1] === undefined ? undefined : pathToFileURL(resolve(process.argv[1])).href;
if (entrypoint === import.meta.url) {
	main().catch(() => {
		process.stderr.write("cloudflare relay failed\n");
		process.exitCode = 1;
	});
}
