/** Temporary maintenance entrypoint for the explicitly authorized MFM reset.
 * Deploy only to the inspected existing Worker; restore its exact prior version.
 * It does not import the bot, apply migrations, process updates or deliver messages.
 */
import { CloudflareSqlDatabase } from "./platform/database/cloudflare-sql-database.js";
import { inspectProjectReset, resetProjectDatabase, UnreviewedResetTablesError, type ResetRequest } from "./platform/database/project-reset.js";
import { constantTimeEqual } from "./runtime/cloudflare/webhook.js";

interface ResetEnvironment {
	readonly COLLABORATION_STATE: {
		idFromName(name: string): DurableObjectId;
		get(id: DurableObjectId): { fetch(request: Request): Promise<Response> };
	};
	readonly DEPLOYMENT_ENVIRONMENT?: string;
	readonly OPERATIONS_TOKEN?: string;
	readonly RESET_AUTH_TOKEN?: string;
	readonly BOT_TOKEN?: string;
	readonly EXPECTED_BOT_ID?: string;
	readonly EXPECTED_BOT_USERNAME?: string;
	readonly RESET_OPERATION_ID?: string;
}
const PRIMARY = "collaboration-bot-primary";
const REHEARSAL = "collaboration-bot-cf2-03-rehearsal";
const json = (body: object, status = 200) => Response.json(body, { status, headers: { "cache-control": "no-store" } });

export class CollaborationBotState implements DurableObject {
	constructor(private readonly state: DurableObjectState, private readonly environment: ResetEnvironment) {}
	async alarm(): Promise<void> { await this.state.storage.deleteAlarm(); }
	async fetch(request: Request): Promise<Response> {
		if (!this.environment.RESET_OPERATION_ID) return json({ error: "reset_disabled" }, 403);
		const target = `${this.environment.DEPLOYMENT_ENVIRONMENT}:${this.state.id.toString()}`;
		const database = new CloudflareSqlDatabase(this.state.storage);
		const path = new URL(request.url).pathname;
		if (await this.state.storage.getAlarm() !== null) return json({ error: "reset_alarm_not_quiescent" }, 409);
		try {
			if (path === "/inspect" && request.method === "GET") return json(await inspectProjectReset(database, target));
			if (path !== "/reset" || request.method !== "POST") return json({ error: "not_found" }, 404);
			if (request.headers.get("content-type")?.split(";", 1)[0] !== "application/json") return json({ error: "unsupported_media_type" }, 415);
			const length = Number(request.headers.get("content-length"));
			if (length > 2048) return json({ error: "request_too_large" }, 413);
			const reader = request.body?.getReader();
			if (!reader) return json({ error: "reset_invalid_request" }, 400);
			let raw = "";
			let bytes = 0;
			const decoder = new TextDecoder();
			for (;;) {
				const part = await reader.read();
				if (part.done) break;
				bytes += part.value.byteLength;
				if (bytes > 2048) { await reader.cancel(); return json({ error: "request_too_large" }, 413); }
				raw += decoder.decode(part.value, { stream: true });
			}
			raw += decoder.decode();
			const input: unknown = JSON.parse(raw);
			if (!input || typeof input !== "object" || !("operationId" in input) || input.operationId !== this.environment.RESET_OPERATION_ID
				|| !("target" in input) || typeof input.target !== "string" || !("expectedDigest" in input) || typeof input.expectedDigest !== "string") return json({ error: "reset_invalid_request" }, 400);
			return json(await resetProjectDatabase(database, target, input as ResetRequest));
		} catch (error) {
			if (error instanceof UnreviewedResetTablesError) return json({ error: error.message, tableNames: error.tableNames }, 409);
			const message = error instanceof Error && /^reset_[a-z_]+$/u.test(error.message) ? error.message : "reset_failed";
			return json({ error: message }, 409);
		}
	}
}

export default {
	async fetch(request: Request, environment: ResetEnvironment): Promise<Response> {
		const path = new URL(request.url).pathname;
		if (path === "/health/live") return json({ status: "maintenance", environment: environment.DEPLOYMENT_ENVIRONMENT });
		if (path === "/telegram/webhook") return json({ error: "maintenance" }, 503);
		const token = environment.RESET_AUTH_TOKEN ?? environment.OPERATIONS_TOKEN;
		if (!token || !constantTimeEqual(request.headers.get("authorization"), `Bearer ${token}`)) return json({ error: "unauthorized" }, 401);
		if (!environment.RESET_OPERATION_ID || !["staging", "production"].includes(environment.DEPLOYMENT_ENVIRONMENT ?? "")) return json({ error: "reset_disabled" }, 403);
		if (path === "/ops/reset/webhook-state" && request.method === "GET") {
			try {
				if (!environment.BOT_TOKEN) throw new Error("unconfigured");
				const read = async (method: string) => {
					const response = await fetch(`https://api.telegram.org/bot${environment.BOT_TOKEN}/${method}`);
					const body = await response.json() as { ok: boolean; result: Record<string, unknown> };
					if (!response.ok || !body.ok) throw new Error("unavailable");
					return body.result;
				};
				const identity = await read("getMe");
				const webhook = await read("getWebhookInfo");
				return json({ botMatches: String(identity.id) === environment.EXPECTED_BOT_ID && identity.username === environment.EXPECTED_BOT_USERNAME,
					webhookMatches: webhook.url === `${new URL(request.url).origin}/telegram/webhook`,
					pendingUpdates: webhook.pending_update_count, maxConnections: webhook.max_connections, hasLastError: webhook.last_error_date !== undefined });
			} catch { return json({ error: "webhook_inspection_failed" }, 503); }
		}
		const routes = new Map([
			["/ops/reset/inspect", { name: PRIMARY, path: "/inspect" }], ["/ops/reset/apply", { name: PRIMARY, path: "/reset" }],
			["/ops/reset/rehearsal/inspect", { name: REHEARSAL, path: "/inspect" }], ["/ops/reset/rehearsal/apply", { name: REHEARSAL, path: "/reset" }],
		]);
		const route = routes.get(path);
		if (!route || (route.name === REHEARSAL && environment.DEPLOYMENT_ENVIRONMENT !== "staging")) return json({ error: "not_found" }, 404);
		const id = environment.COLLABORATION_STATE.idFromName(route.name);
		return environment.COLLABORATION_STATE.get(id).fetch(new Request(new URL(route.path, request.url), request));
	},
};
