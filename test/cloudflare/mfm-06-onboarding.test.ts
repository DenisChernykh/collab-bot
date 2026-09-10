/// <reference types="@cloudflare/vitest-plugin/types" />
import { env } from "cloudflare:workers";
import { evictDurableObject, runInDurableObject } from "cloudflare:test";
import { Bot } from "grammy";
import { expect, it } from "vitest";
import { CloudflareSqlDatabase } from "../../src/platform/database/cloudflare-sql-database.js";
import { exportStateTransferManifest, importStateTransferManifest } from "../../src/platform/database/state-transfer.js";
import { composeBotApplication } from "../../src/runtime/composition/bot-application.js";
import { SqliteOnboardingRepository } from "../../src/modules/profiles/infrastructure/sqlite-onboarding-repository.js";
import { encodeMfmCallback } from "../../src/modules/profiles/presentation/telegram/mfm-callback-codec.js";
import type { OnboardingAction } from "../../src/modules/profiles/application/onboarding-service.js";
import { FakeClock } from "../support/fake-clock.js";
import { createFakeTelegramApi, FAKE_BOT_TOKEN, privateMessageForUser, callbackForUser } from "../support/fake-telegram.js";

it("runs the composed MFM journey atomically in workerd and transfers profiles, choices and drafts after eviction", async () => {
	const stub = env.COLLABORATION_STATE.get(env.COLLABORATION_STATE.idFromName("mfm-06-journey"));
	// Drain the response so it cannot keep the object alive during eviction.
	const schema = await stub.fetch("https://local/__cf1/schema");
	expect(schema.status).toBe(200);
	expect(await schema.json()).toMatchObject({ migrationCount: 18, integrity: "ok" });
	await runInDurableObject(stub, async (_instance, state) => {
		const database = new CloudflareSqlDatabase(state.storage);
		const repository = new SqliteOnboardingRepository(database);
		const fake = createFakeTelegramApi();
		const bot = new Bot(FAKE_BOT_TOKEN, { client: { fetch: fake.fetch } });
		const app = composeBotApplication({ database, bot, clock: new FakeClock(1_700_000_000_000), config: {
			mfmFeatureEnabled: true, botToken: FAKE_BOT_TOKEN, expectedBotId: "777", expectedBotUsername: "collab_bot",
			adminTelegramIds: [], showcaseChannelId: "-1001", showcaseChannelUsername: "showcase", databasePath: "unused",
			logLevel: "info", timeZone: "Asia/Yekaterinburg", helpContact: "@helpdesk",
		} });
		await app.lifecycle.initializeIdentity();
		let sequence = 90_000;
		const message = async (id: number, text: string) => bot.handleUpdate({ update_id: ++sequence, message: privateMessageForUser(sequence, id, text, undefined, "Example Person") });
		const event = async (id: number, action: OnboardingAction) => {
			const session = await repository.getSession(String(id));
			if (!session) throw new Error("missing session");
			return { update_id: ++sequence, callback_query: callbackForUser(sequence, id, encodeMfmCallback(action, session)) };
		};
		const act = async (id: number, action: OnboardingAction) => bot.handleUpdate(await event(id, action));
		for (const id of [41, 42, 43]) {
			await message(id, "/start");
			await act(id, { kind: "language", value: id === 41 ? "ru" : "en" });
			await act(id, { kind: "affiliation", value: "yes" });
			await act(id, { kind: "choice", value: "participant" });
			await act(id, { kind: "keep" });
			await act(id, { kind: "choice", value: "specialist" }); await act(id, { kind: "city" });
			if (id === 43) continue; // The transfer must retain an unfinished draft too.
			await act(id, { kind: "choice", value: "digital_it" }); await act(id, { kind: "next" });
			await act(id, { kind: "choice", value: "joint_projects" }); await act(id, { kind: "next" });
			await act(id, { kind: "next" });
			const update = await event(id, { kind: "next" });
			if (id === 41) {
				const before = await repository.getSession(String(id));
				const calls = fake.calls.length;
				await database.execute("CREATE TRIGGER mfm_failure BEFORE INSERT ON mfm_profile_spheres BEGIN SELECT RAISE(ABORT, 'injected MFM failure'); END");
				await expect(bot.handleUpdate(update)).rejects.toThrow("injected MFM failure");
				expect(await repository.getSession(String(id))).toEqual(before);
				expect(await repository.getProfile(String(id))).toBeUndefined();
				expect(await database.query("SELECT * FROM processed_updates WHERE update_id = ?", [update.update_id])).toEqual([]);
				expect(fake.calls).toHaveLength(calls);
				await database.execute("DROP TRIGGER mfm_failure");
			}
			await bot.handleUpdate(update); await bot.handleUpdate(update);
			expect(await repository.getProfile(String(id))).toMatchObject({ revision: 1, spheres: ["digital_it"], openTo: ["joint_projects"], about: null });
		}
		// The shortened flow keeps both profiles discoverable without optional detail rows.
		expect(await database.query("SELECT m.profile_id FROM mfm_profiles m JOIN mfm_profile_spheres s ON s.profile_id = m.profile_id WHERE m.event_status = ? AND s.sphere = ?", ["participant", "digital_it"])).toHaveLength(2);
	});
	await evictDurableObject(stub);
	const manifest = await runInDurableObject(stub, (_instance, state) => exportStateTransferManifest(new CloudflareSqlDatabase(state.storage)));
	const target = env.COLLABORATION_STATE.get(env.COLLABORATION_STATE.idFromName("mfm-06-transfer"));
	expect(await (await target.fetch("https://local/__cf1/schema")).json()).toMatchObject({ migrationCount: 18, integrity: "ok" });
	await runInDurableObject(target, async (_instance, state) => {
		const database = new CloudflareSqlDatabase(state.storage);
		await importStateTransferManifest(database, manifest);
		const repository = new SqliteOnboardingRepository(database);
		expect(await repository.getUser("41")).toMatchObject({ language: "ru", experience: "mfm" });
		expect(await repository.getProfile("42")).toMatchObject({ openTo: ["joint_projects"], about: null });
		expect(await repository.getSession("43")).toMatchObject({ state: { step: "spheres", draft: { eventStatus: "participant", displayName: "Example Person" } } });
		expect((await exportStateTransferManifest(database)).digest).toBe(manifest.digest);
		expect(await database.query("PRAGMA foreign_key_check")).toEqual([]);
	});
});
