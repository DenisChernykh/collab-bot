import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { createFakeBotRuntime } from "../support/fake-bot-runtime.js";
import { callbackForUser, privateMessageForUser, callbackData } from "../support/fake-telegram.js";
import { encodeMfmCallback } from "../../src/modules/profiles/presentation/telegram/mfm-callback-codec.js";
import { SqliteOnboardingRepository } from "../../src/modules/profiles/infrastructure/sqlite-onboarding-repository.js";
import type { OnboardingAction } from "../../src/modules/profiles/application/onboarding-service.js";
import { FakeClock } from "../support/fake-clock.js";

async function withJourney(work: (run: Awaited<ReturnType<typeof journey>>) => Promise<void>) {
	const dir = await mkdtemp(join(tmpdir(), "mfm-recovery-"));
	const run = await journey(join(dir, "app.sqlite"));
	try { await work(run); } finally { await run.runtime().shutdown(); await rm(dir, { recursive: true, force: true }); }
}
async function journey(databasePath: string) {
	const clock = new FakeClock(1_700_000_000_000);
	let fixture = await createFakeBotRuntime({ databasePath, clock, mfmFeatureEnabled: true });
	let sequence = 50_000;
	const session = () => new SqliteOnboardingRepository(fixture.runtime.boundary).getSession("42");
	const text = async (value: string) => { await fixture.runtime.bot.handleUpdate({ update_id: ++sequence, message: privateMessageForUser(sequence, 42, value, undefined, "Lucas") }); };
	const event = async (action: OnboardingAction) => {
		const current = await session();
		if (current === undefined) throw new Error("no session");
		return { update_id: ++sequence, callback_query: callbackForUser(sequence, 42, encodeMfmCallback(action, current)) };
	};
	const act = async (action: OnboardingAction) => { const update = await event(action); await fixture.runtime.bot.handleUpdate(update); return update; };
	return {
		runtime: () => fixture.runtime, fake: () => fixture.fake, session, text, act, event,
		async restart(enabled: boolean) { await fixture.runtime.shutdown(); fixture = await createFakeBotRuntime({ databasePath, clock, fake: fixture.fake, mfmFeatureEnabled: enabled }); },
		async fields() {
			await text("/start"); await act({ kind: "language", value: "en" }); await act({ kind: "affiliation", value: "yes" });
			await act({ kind: "choice", value: "citizen_program" }); await act({ kind: "next" }); await act({ kind: "keep" });
			await act({ kind: "choice", value: "project" }); await text("Astana, Kazakhstan");
		},
	};
}

it("restores drafts across restarts, rejects category text and enforces limits without losing selections", () => withJourney(async (j) => {
	await j.fields();
	const before = await j.session();
	await j.text("My custom field");
	expect(await j.session()).toEqual(before);
	for (const value of ["media", "digital_it", "entrepreneurship"]) await j.act({ kind: "choice", value });
	await j.act({ kind: "choice", value: "sports_health" });
	expect((await j.session())?.state.draft.spheres).toEqual(["media", "digital_it", "entrepreneurship"]);
	const persisted = await j.session();
	await j.restart(false);
	await j.text("/start");
	expect(String(j.fake().lastMessage()?.text)).toContain("paused");
	expect(await j.session()).toEqual(persisted);
	await j.text("/language"); await j.act({ kind: "language", value: "ru" });
	expect(String(j.fake().lastMessage()?.text)).toContain("приостановлено");
	await j.restart(true); await j.text("/start");
	expect(String(j.fake().lastMessage()?.text)).toContain("Продолжим");
	expect((await j.session())?.state.draft).toEqual(persisted?.state.draft);
	await j.act({ kind: "next" });
	await j.act({ kind: "next" });
	expect((await j.session())?.state.step).toBe("specializations");
	for (const value of ["blogger", "ai", "finance"]) await j.act({ kind: "choice", value });
	await j.act({ kind: "choice", value: "data" });
	expect((await j.session())?.state.draft.specializations).toEqual(["blogger", "ai", "finance"]);
	await j.act({ kind: "next" }); await j.act({ kind: "next" });
	expect((await j.session())?.state.step).toBe("open_to");
	await j.act({ kind: "choice", value: "city_and_events" }); await j.act({ kind: "next" });
	await j.restart(false); await j.text("/start");
	expect(String(j.fake().lastMessage()?.text)).toContain("Мой профиль");
	expect(String(j.fake().lastMessage()?.text)).not.toMatch(/МФМ|Горожане/);
}));

it("choosing No keeps the base profile and starts the unchanged classic completion", () => withJourney(async (j) => {
	await j.text("/start");
	const before = await j.runtime().boundary.query("SELECT id FROM profiles");
	await j.act({ kind: "language", value: "en" }); await j.act({ kind: "affiliation", value: "no" });
	expect(String(j.fake().lastMessage()?.text)).toContain("Добро пожаловать");
	expect(await j.runtime().boundary.query("SELECT preferred_language, experience FROM telegram_users")).toEqual([{ preferred_language: "en", experience: "classic" }]);
	expect(await j.session()).toBeUndefined();
	await j.runtime().bot.handleUpdate({ update_id: 70_000, callback_query: callbackForUser(70_000, 42, "collaboration:start") });
	await j.runtime().bot.handleUpdate({ update_id: 70_001, callback_query: callbackForUser(70_001, 42, callbackData(j.fake(), "profile:type:blogger")) });
	await j.runtime().bot.handleUpdate({ update_id: 70_002, callback_query: callbackForUser(70_002, 42, callbackData(j.fake(), "profile:keep_name")) });
	await j.text("-"); await j.text("-");
	await j.runtime().bot.handleUpdate({ update_id: 70_003, callback_query: callbackForUser(70_003, 42, callbackData(j.fake(), "profile:platform:other")) });
	await j.text("https://example.com"); await j.text("-");
	await j.runtime().bot.handleUpdate({ update_id: 70_004, callback_query: callbackForUser(70_004, 42, callbackData(j.fake(), "profile:apply")) });
	expect(await j.runtime().boundary.query("SELECT id FROM profiles")).toEqual(before);
	expect(await j.runtime().boundary.query("SELECT author_profile_id FROM collaborations")).toHaveLength(1);
	expect(await j.runtime().boundary.query("SELECT * FROM mfm_profiles")).toEqual([]);
}));

it("defaults new users to language then classic when the feature is off", () => withJourney(async (j) => {
	await j.restart(false); await j.text("/start"); await j.act({ kind: "language", value: "en" });
	expect(await j.runtime().boundary.query("SELECT experience FROM telegram_users")).toEqual([{ experience: "classic" }]);
	await j.restart(true); await j.text("/start");
	expect(String(j.fake().lastMessage()?.text)).toContain("Добро пожаловать");
	expect(await j.session()).toBeUndefined();
}));

it("rolls back the final profile, session and receipt before any Telegram reply and permits one retry", () => withJourney(async (j) => {
	await j.fields(); await j.act({ kind: "choice", value: "digital_it" }); await j.act({ kind: "next" });
	await j.act({ kind: "choice", value: "ai" }); await j.act({ kind: "next" }); await j.act({ kind: "choice", value: "joint_projects" });
	const update = await j.event({ kind: "next" });
	const before = await j.session();
	const count = j.fake().calls.length;
	await j.runtime().boundary.execute("CREATE TRIGGER mfm_final_failure BEFORE INSERT ON mfm_profile_open_to BEGIN SELECT RAISE(ABORT, 'injected final failure'); END");
	await expect(j.runtime().bot.handleUpdate(update)).rejects.toThrow("injected final failure");
	expect(await j.session()).toEqual(before);
	expect(j.fake().calls).toHaveLength(count);
	expect(await j.runtime().boundary.query("SELECT * FROM mfm_profiles")).toEqual([]);
	expect(await j.runtime().boundary.query("SELECT * FROM processed_updates WHERE update_id = ?", [update.update_id])).toEqual([]);
	await j.runtime().boundary.execute("DROP TRIGGER mfm_final_failure");
	await j.runtime().bot.handleUpdate(update); await j.runtime().bot.handleUpdate(update);
	expect(await j.runtime().boundary.query("SELECT revision FROM mfm_profiles")).toEqual([{ revision: 1 }]);
}));

it("keeps the completed profile visible until an edited draft is saved once with the feature disabled", () => withJourney(async (j) => {
	await j.fields(); await j.act({ kind: "choice", value: "digital_it" }); await j.act({ kind: "next" });
	await j.act({ kind: "choice", value: "ai" }); await j.act({ kind: "next" });
	await j.act({ kind: "choice", value: "joint_projects" }); await j.act({ kind: "next" });
	const repository = new SqliteOnboardingRepository(j.runtime().boundary);
	const before = await repository.getProfile("42");
	await j.restart(false);
	await j.runtime().bot.handleUpdate({ update_id: 80_000, callback_query: callbackForUser(80_000, 42, "mfm:edit") });
	await j.text("Updated project"); await j.act({ kind: "choice", value: "business" });
	await j.text("Belgrade, Serbia"); await j.act({ kind: "next" }); await j.act({ kind: "next" });
	expect(await new SqliteOnboardingRepository(j.runtime().boundary).getProfile("42")).toEqual(before);
	const save = await j.act({ kind: "next" }); await j.runtime().bot.handleUpdate(save);
	expect(await new SqliteOnboardingRepository(j.runtime().boundary).getProfile("42")).toMatchObject({
		profileId: before?.profileId, completedAt: before?.completedAt, revision: 2,
		displayName: "Updated project", profileType: "business", locationText: "Belgrade, Serbia",
	});
	expect(await j.session()).toBeUndefined();
	expect(String(j.fake().lastMessage()?.text)).not.toContain("MFM");
}));
