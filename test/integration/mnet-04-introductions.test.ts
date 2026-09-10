import { expect, it } from "vitest";
import { withFreshMigratedDatabase } from "../support/migrated-database.js";
import { connectionClock, connectionProfileId, connectionsFor, seedConnectionPerson } from "../support/connections-fixture.js";
import { IntroductionService, type IntroductionView } from "../../src/modules/connections/application/index.js";
import { SqliteIntroductionRepository } from "../../src/modules/connections/infrastructure/sqlite-introduction-repository.js";
import { DatabaseBoundaryTransactionRunner } from "../../src/platform/database/transaction-runner.js";
import { SqliteOutboxDeliveryRepository } from "../../src/platform/outbox/outbox-delivery-repository.js";
import { OutboxDeliveryService } from "../../src/shared/application/outbox/outbox-service.js";
import { webCryptoCapabilities } from "../../src/platform/crypto/capabilities.js";
import type { SqlDatabase } from "../../src/shared/application/ports/sql-database.js";

function setup(database: SqlDatabase, enabled = true) {
	const transactions = new DatabaseBoundaryTransactionRunner(database);
	return new IntroductionService(new SqliteIntroductionRepository(database), transactions, connectionClock, webCryptoCapabilities, new OutboxDeliveryService(new SqliteOutboxDeliveryRepository(database), transactions, connectionClock), "collab_bot", enabled);
}
function proof(view: IntroductionView) { if (view.kind === "unavailable") throw new Error("no fixture session"); return { generation: view.session.state.generation, revision: view.session.revision }; }
async function seed(database: SqlDatabase) {
	for (const id of [1, 2, 3]) { await seedConnectionPerson(database, id, { language: id === 2 ? "en" : "ru" }); await database.execute("INSERT INTO mfm_discovery_settings VALUES (?, 1, 1, 1)", [connectionProfileId(id)]); }
}
async function draft(database: SqlDatabase, from = "1") {
	const api = setup(database);
	await connectionsFor(database).api.open(from, "search");
	await api.act(from, { kind: "begin" }, proof(await api.view(from)));
	return { api, view: await api.act(from, { kind: "message", value: "Hello, let's discuss a joint project." }, proof(await api.view(from))) };
}

it.each([{ message: "Привет!! 👋", characters: 10 }, { message: "👋".repeat(500), characters: 500 }])("persists a Unicode message of $characters SQL characters", async ({ message, characters }) => {
	await withFreshMigratedDatabase({ prefix: "mnet-unicode-", clock: connectionClock }, async ({ boundary }) => {
		await seed(boundary);
		await connectionsFor(boundary).api.open("1", "search");
		let api = setup(boundary);
		await api.act("1", { kind: "begin" }, proof(await api.view("1")));
		const compose = await api.view("1");
		for (const invalid of ["Привет! 👋", "👋".repeat(501)]) {
			expect(await api.act("1", { kind: "message", value: invalid }, proof(compose))).toMatchObject({ kind: "compose", notice: "invalid" });
			expect(await api.view("1")).toEqual(compose);
		}
		const confirm = await api.act("1", { kind: "message", value: message }, proof(compose));
		expect(confirm).toMatchObject({ kind: "confirm", message });
		api = setup(boundary);
		expect(await api.view("1")).toEqual(confirm);
		await api.act("1", { kind: "confirm" }, proof(confirm));
		expect(await boundary.query("SELECT message, length(message) AS characters FROM introduction_requests")).toEqual([{ message, characters }]);
		expect(await boundary.query("SELECT * FROM outbox_deliveries")).toHaveLength(1);
	});
});

it("persists confirmed drafts, commits one unordered request and localized DM, discloses only to the accepted active pair", async () => {
	await withFreshMigratedDatabase({ prefix: "mnet-request-", clock: connectionClock }, async ({ boundary }) => {
		await seed(boundary);
		await boundary.execute("INSERT INTO mfm_profile_contacts (profile_id, kind, url, username, telegram_chat_id, title, updated_at) VALUES (?, 'external', 'https://example.com/sender', NULL, NULL, NULL, 1)", [connectionProfileId(1)]);
		await boundary.execute("INSERT INTO mfm_profile_contacts (profile_id, kind, url, username, telegram_chat_id, title, updated_at) VALUES (?, 'telegram_group', 'https://t.me/recipient_group', 'recipient_group', '-100200', 'Recipient group', 1)", [connectionProfileId(2)]);
		await boundary.execute("INSERT INTO mfm_profile_contacts (profile_id, kind, url, username, telegram_chat_id, title, updated_at) VALUES (?, 'telegram_channel', 'https://t.me/public_channel', 'public_channel', '-100300', 'Public channel', 1)", [connectionProfileId(3)]);
		await boundary.execute("UPDATE mfm_discovery_settings SET visible = 0 WHERE profile_id = ?", [connectionProfileId(1)]);
		const { api, view } = await draft(boundary);
		expect(view).toMatchObject({ kind: "confirm" });
		expect(await setup(boundary).view("1")).toEqual(view);
		const sent = await api.act("1", { kind: "confirm" }, proof(view));
		expect(sent).toMatchObject({ kind: "request", request: { status: "pending" }, contactUrl: null });
		if (sent.kind === "unavailable" || !sent.request) throw new Error("request missing");
		const token = sent.request.token;
		await api.act("1", { kind: "confirm" }, proof(view));
		expect(await boundary.query("SELECT * FROM introduction_requests")).toHaveLength(1);
		const [dm] = await boundary.query<{ payload_json: string; recipient_chat_id: string }>("SELECT payload_json, recipient_chat_id FROM outbox_deliveries");
		expect(dm?.recipient_chat_id).toBe("2"); expect(dm?.payload_json).toContain("New introduction"); expect(dm?.payload_json).not.toContain("private_person");
		expect(await api.openRequest("3", token)).toMatchObject({ notice: "unavailable", request: null, contactUrl: null });
		const recipient = await api.openRequest("2", token);
		expect(recipient).toMatchObject({ request: { status: "pending" }, canAccept: true, contactUrl: null });
		await boundary.execute("UPDATE mfm_discovery_settings SET visible = 1 WHERE profile_id = ?", [connectionProfileId(1)]);
		const reverse = await draft(boundary, "2");
		expect(reverse.view).toMatchObject({ kind: "request", request: { token, status: "pending" } });
		expect(await boundary.query("SELECT * FROM introduction_requests")).toHaveLength(1);
		expect(await api.act("1", { kind: "decide", decision: "accepted", requestRevision: 1 }, proof(await api.view("1")))).toMatchObject({ notice: "unavailable", contactUrl: null });
		await boundary.execute("UPDATE mfm_discovery_settings SET visible = 0");
		const beforeDecision = await api.view("2");
		await boundary.execute("CREATE TRIGGER fail_decision_dm BEFORE INSERT ON outbox_deliveries BEGIN SELECT RAISE(ABORT, 'injected decision failure'); END");
		await expect(api.act("2", { kind: "decide", decision: "accepted", requestRevision: 1 }, proof(beforeDecision))).rejects.toThrow("injected decision failure");
		expect(await api.view("2")).toEqual(beforeDecision);
		expect(await boundary.query("SELECT status FROM introduction_requests")).toEqual([{ status: "pending" }]);
		await boundary.execute("DROP TRIGGER fail_decision_dm");
		const accepted = await setup(boundary, false).act("2", { kind: "decide", decision: "accepted", requestRevision: 1 }, proof(await api.view("2")));
		expect(accepted).toMatchObject({ request: { status: "accepted" }, contactUrl: "https://example.com/sender" });
		expect(await boundary.query("SELECT kind FROM outbox_deliveries")).toEqual([{ kind: "dm_send" }, { kind: "dm_send" }, { kind: "dm_send" }]);
		expect(await api.openRequest("1", token)).toMatchObject({ contactUrl: "https://t.me/recipient_group" });
		await boundary.execute("DELETE FROM mfm_profile_contacts WHERE profile_id = ?", [connectionProfileId(2)]);
		await boundary.execute("UPDATE telegram_users SET username = NULL WHERE telegram_user_id = '2'");
		expect(await api.openRequest("1", token)).toMatchObject({ contactUrl: "tg://user?id=2" });
		expect(await api.act("1", { kind: "list", tab: "accepted" }, proof(await api.view("1")))).toMatchObject({ kind: "list", request: { status: "accepted" }, contactUrl: null });
		await api.act("2", { kind: "decide", decision: "rejected", requestRevision: 1 }, proof(accepted));
		expect(await boundary.query("SELECT status, revision FROM introduction_requests")).toEqual([{ status: "accepted", revision: 2 }]);
		await boundary.execute("UPDATE telegram_users SET status = 'blocked', blocked_at = 2 WHERE telegram_user_id = '2'");
		expect(await api.openRequest("1", token)).toMatchObject({ contactUrl: null, notice: "unavailable" });
		expect(await api.openRequest("2", token)).toMatchObject({ kind: "unavailable" });
		const channelToken = "C".repeat(22);
		await boundary.execute("INSERT INTO introduction_requests VALUES ('30000000-0000-4000-8000-000000000001', ?, ?, ?, 'Synthetic channel introduction', 'pending', 1, 3, NULL)", [channelToken, connectionProfileId(1), connectionProfileId(3)]);
		expect(await api.openRequest("1", channelToken)).toMatchObject({ request: { status: "pending" }, contactUrl: null });
		await boundary.execute("UPDATE introduction_requests SET status = 'accepted', revision = 2, decided_at = 4 WHERE public_token = ?", [channelToken]);
		expect(await api.openRequest("1", channelToken)).toMatchObject({ request: { status: "accepted" }, contactUrl: "https://t.me/public_channel" });
	});
});

it("rolls back request and draft transitions with failed notification, rechecks visibility/flag, and cancels only the message", async () => {
	await withFreshMigratedDatabase({ prefix: "mnet-atomic-", clock: connectionClock }, async ({ boundary }) => {
		await seed(boundary);
		const { api, view } = await draft(boundary);
		await boundary.execute("CREATE TRIGGER fail_intro_dm BEFORE INSERT ON outbox_deliveries BEGIN SELECT RAISE(ABORT, 'injected intro failure'); END");
		await expect(api.act("1", { kind: "confirm" }, proof(view))).rejects.toThrow("injected intro failure");
		expect(await api.view("1")).toEqual(view); expect(await boundary.query("SELECT * FROM introduction_requests")).toEqual([]);
		await boundary.execute("DROP TRIGGER fail_intro_dm");
		expect(await setup(boundary, false).act("1", { kind: "confirm" }, proof(view))).toMatchObject({ notice: "disabled" });
		await boundary.execute("UPDATE mfm_discovery_settings SET visible = 0 WHERE profile_id = ?", [connectionProfileId(2)]);
		expect(await api.act("1", { kind: "confirm" }, proof(view))).toMatchObject({ notice: "unavailable" });
		expect(await boundary.query("SELECT * FROM introduction_requests")).toEqual([]);
		const cancelled = await api.act("1", { kind: "cancel" }, proof(await api.view("1")));
		expect(cancelled).toMatchObject({ kind: "none", session: { state: { screen: "search", filters: {} } } });
		if (cancelled.kind !== "unavailable") expect(cancelled.session.state.introduction).toBeUndefined();
	});
});

it.each(["rejected", "withdrawn"] as const)("allows only the correct pending %s decision, retains lists and prevents resubmission", async decision => {
	await withFreshMigratedDatabase({ prefix: "mnet-decision-", clock: connectionClock }, async ({ boundary }) => {
		await seed(boundary); const { api, view } = await draft(boundary);
		const sent = await api.act("1", { kind: "confirm" }, proof(view));
		if (sent.kind === "unavailable" || !sent.request) throw new Error("missing request");
		const actor = decision === "withdrawn" ? "1" : "2";
		const wrong = decision === "withdrawn" ? "2" : "1";
		await api.openRequest(wrong, sent.request.token);
		expect(await api.act(wrong, { kind: "decide", decision, requestRevision: 1 }, proof(await api.view(wrong)))).toMatchObject({ notice: "unavailable" });
		await api.openRequest(actor, sent.request.token);
		expect(await api.act(actor, { kind: "decide", decision, requestRevision: 1 }, proof(await api.view(actor)))).toMatchObject({ request: { status: decision }, contactUrl: null });
		expect(await api.act("1", { kind: "list", tab: "sent" }, proof(await api.view("1")))).toMatchObject({ kind: "list", request: { status: decision } });
		expect(await api.act("2", { kind: "list", tab: "incoming" }, proof(await api.view("2")))).toMatchObject({ kind: "list", request: { status: decision } });
		expect((await draft(boundary)).view).toMatchObject({ kind: "request", request: { status: decision } });
		expect(await boundary.query("SELECT * FROM introduction_requests")).toHaveLength(1);
	});
});
