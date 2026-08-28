const SINGLETON_NAME = "collaboration-bot-primary";

function json(body: Record<string, unknown>, status = 200): Response {
	return Response.json(body, {
		status,
		headers: { "cache-control": "no-store" },
	});
}

export class CollaborationBotState implements DurableObject {
	private readonly state: DurableObjectState;

	constructor(state: DurableObjectState) {
		this.state = state;
	}

	async fetch(request: Request): Promise<Response> {
		if (request.method !== "GET" || new URL(request.url).pathname !== "/__cf1/smoke") {
			return json({ error: "not_found" }, 404);
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
}

export default {
	async fetch(request: Request, environment: Env): Promise<Response> {
		const url = new URL(request.url);
		if (request.method === "GET" && url.pathname === "/health/live") {
			return json({ status: "ok", runtime: "cloudflare-local" });
		}

		if (request.method === "GET" && url.pathname === "/__cf1/smoke") {
			const objectId = environment.COLLABORATION_STATE.idFromName(SINGLETON_NAME);
			return environment.COLLABORATION_STATE.get(objectId).fetch(
				new Request(new URL("/__cf1/smoke", request.url), request),
			);
		}

		return json({ error: "not_found" }, 404);
	},
};
