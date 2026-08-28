import { CloudflareMigrationRunner } from "./platform/database/cloudflare-migrations.js";
import { CloudflareSqlDatabase } from "./platform/database/cloudflare-sql-database.js";

const SINGLETON_NAME = "collaboration-bot-primary";

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

	constructor(state: DurableObjectState) {
		this.state = state;
		this.database = new CloudflareSqlDatabase(state.storage);
		this.migrations = new CloudflareMigrationRunner(this.database);
		this.ready = state.blockConcurrencyWhile(async () => {
			await this.migrations.migrate();
		});
	}

	async fetch(request: Request): Promise<Response> {
		const pathname = new URL(request.url).pathname;
		if (request.method !== "GET" || !["/__cf1/smoke", "/__cf1/schema"].includes(pathname)) {
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

		if (request.method === "GET" && url.pathname === "/__cf1/schema") {
			const objectId = environment.COLLABORATION_STATE.idFromName(SINGLETON_NAME);
			return environment.COLLABORATION_STATE.get(objectId).fetch(
				new Request(new URL("/__cf1/schema", request.url), request),
			);
		}

		return json({ error: "not_found" }, 404);
	},
};
