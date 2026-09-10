import { expect, it } from "vitest";
import { OnboardingService, type OnboardingAction, type OnboardingToken, type OnboardingView } from "../../src/modules/profiles/application/onboarding-service.js";
import { ProfileService } from "../../src/modules/profiles/application/profile-service.js";
import { SqliteOnboardingRepository } from "../../src/modules/profiles/infrastructure/sqlite-onboarding-repository.js";
import { SqliteProfileRepository } from "../../src/modules/profiles/infrastructure/sqlite-profile-repository.js";
import { webCryptoCapabilities } from "../../src/platform/crypto/capabilities.js";
import { DatabaseBoundaryTransactionRunner } from "../../src/platform/database/transaction-runner.js";
import { FakeClock } from "../support/fake-clock.js";
import { withFreshMigratedDatabase } from "../support/migrated-database.js";

const groupContact = { kind: "telegram_group" as const, url: "https://t.me/public_group", username: "public_group", telegramChatId: "-100200", title: "Public group" };

it("completes the short durable path, bounds spheres and saves or skips one contact atomically", async () => {
	const clock = new FakeClock(100);
	await withFreshMigratedDatabase({ prefix: "mfo-fast-", clock }, async ({ boundary }) => {
		const repository = new SqliteOnboardingRepository(boundary);
		const transactions = new DatabaseBoundaryTransactionRunner(boundary);
		const create = () => new OnboardingService(repository, new ProfileService(new SqliteProfileRepository(boundary), transactions, clock), transactions, clock, webCryptoCapabilities, true);
		let service = create();
		let view: OnboardingView = { kind: "needs_start", language: "en", festivalEnabled: true };
		const act = async (userId: string, action: OnboardingAction) => {
			if (view.kind !== "step") throw new Error("expected onboarding step");
			view = await service.act(userId, action, token(view));
			return view;
		};
		const reachRequiredFlow = async (userId: string, name: string) => {
			await boundary.execute("INSERT INTO telegram_users (telegram_user_id, display_name, status, created_at, updated_at) VALUES (?, ?, 'active', 1, 1)", [userId, name]);
			view = await service.start(userId, name);
			await act(userId, { kind: "language", value: "en" });
			await act(userId, { kind: "affiliation", value: "yes" });
			expect(await act(userId, { kind: "choice", value: "participant" })).toMatchObject({ session: { state: { step: "display_name" } } });
			expect(await act(userId, { kind: "keep" })).toMatchObject({ session: { state: { step: "profile_type" } } });
			expect(await act(userId, { kind: "choice", value: "specialist" })).toMatchObject({ session: { state: { step: "location" } } });
			expect(await act(userId, { kind: "text", value: "Yekaterinburg, Russia" })).toMatchObject({ session: { state: { step: "spheres" } } });
		};

		await reachRequiredFlow("1", "Lucas");
		await act("1", { kind: "choice", value: "media" });
		await act("1", { kind: "choice", value: "digital_it" });
		await act("1", { kind: "choice", value: "creative_industries" });
		expect(await act("1", { kind: "choice", value: "entrepreneurship" })).toMatchObject({ notice: "limit", session: { state: { draft: { spheres: ["media", "digital_it", "creative_industries"] } } } });
		await act("1", { kind: "choice", value: "creative_industries" });
		const contactView = await act("1", { kind: "next" });
		expect(contactView).toMatchObject({ session: { state: { step: "contact", draft: { spheres: ["media", "digital_it"] } } } });
		if (contactView.kind !== "step") throw new Error("expected contact step");
		const contactToken = token(contactView);
		view = await service.selectContact("1", groupContact, contactToken);
		expect(view).toMatchObject({ kind: "home", notice: "saved", profile: { contact: groupContact, specializations: [], openTo: [] } });
		expect(await service.selectContact("1", groupContact, contactToken)).toMatchObject({ kind: "home", notice: "stale" });
		expect(await boundary.query("SELECT kind FROM mfm_profile_contacts")).toEqual([{ kind: "telegram_group" }]);

		service = create();
		await reachRequiredFlow("2", "Maya");
		await act("2", { kind: "choice", value: "science_education" });
		await act("2", { kind: "next" });
		expect(await act("2", { kind: "next" })).toMatchObject({ kind: "home", profile: { contact: null, specializations: [], openTo: [] } });

		await reachRequiredFlow("3", "Rollback");
		await act("3", { kind: "choice", value: "sports_health" });
		await act("3", { kind: "next" });
		if (view.kind !== "step") throw new Error("expected contact step");
		const rollbackToken = token(view);
		await boundary.execute("CREATE TRIGGER mfo_session_delete_fail BEFORE DELETE ON onboarding_sessions BEGIN SELECT RAISE(ABORT, 'synthetic session delete failure'); END");
		await expect(service.act("3", { kind: "next" }, rollbackToken)).rejects.toThrow("synthetic session delete failure");
		expect(await repository.getProfile("3")).toBeUndefined();
		expect(await repository.getSession("3")).toMatchObject({ state: { step: "contact" } });
		await boundary.execute("DROP TRIGGER mfo_session_delete_fail");
		expect(await service.act("3", { kind: "next" }, rollbackToken)).toMatchObject({ kind: "home" });
	});
});

it("preserves optional profile data while editing and normalizes removed legacy steps without losing drafts", async () => {
	const clock = new FakeClock(200);
	await withFreshMigratedDatabase({ prefix: "mfo-legacy-", clock }, async ({ boundary }) => {
		await boundary.execute("INSERT INTO telegram_users (telegram_user_id, display_name, status, experience, preferred_language, created_at, updated_at) VALUES ('1', 'Saved', 'active', 'mfm', 'en', 1, 1)");
		const profiles = new SqliteProfileRepository(boundary);
		await profiles.createInitial("1", "Saved", 1);
		const repository = new SqliteOnboardingRepository(boundary);
		await repository.saveProfile("1", { eventStatus: "volunteer", displayName: "Saved", profileType: "media", locationText: "Belgrade, Serbia", spheres: ["media"], specializations: ["blogger"], openTo: ["professional_communication"], about: null }, 2, groupContact);
		const transactions = new DatabaseBoundaryTransactionRunner(boundary);
		let service = new OnboardingService(repository, new ProfileService(profiles, transactions, clock), transactions, clock, webCryptoCapabilities, true);
		let view = await service.edit("1");
		const act = async (action: OnboardingAction) => {
			if (view.kind !== "step") throw new Error("expected onboarding step");
			view = await service.act("1", action, token(view));
			return view;
		};
		await act({ kind: "text", value: "Changed" });
		await act({ kind: "choice", value: "media" });
		await act({ kind: "keep" });
		await act({ kind: "next" });
		expect(await act({ kind: "next" })).toMatchObject({ kind: "home", profile: { displayName: "Changed", specializations: ["blogger"], openTo: ["professional_communication"], contact: groupContact } });

		await boundary.execute("INSERT INTO onboarding_sessions (telegram_user_id, state_json, revision, updated_at) VALUES ('1', ?, 1, 3)", [JSON.stringify({ version: 1, generation: "a".repeat(16), step: "intro", draft: { eventStatus: "volunteer", displayName: "Legacy" }, editing: false, page: 0 })]);
		expect(await repository.getSession("1")).toMatchObject({ state: { step: "display_name", draft: { eventStatus: "volunteer", displayName: "Legacy" } } });
		await boundary.execute("UPDATE onboarding_sessions SET state_json = ?, revision = 2 WHERE telegram_user_id = '1'", [JSON.stringify({ version: 1, generation: "b".repeat(16), step: "specializations", draft: { eventStatus: "volunteer", displayName: "Legacy", profileType: "media", locationText: "Belgrade, Serbia", spheres: ["media"], specializations: ["blogger"], openTo: ["professional_communication"] }, editing: false, page: 0 })]);
		expect(await repository.getSession("1")).toMatchObject({ state: { step: "contact", draft: { specializations: ["blogger"], openTo: ["professional_communication"] } } });
		service = new OnboardingService(repository, new ProfileService(profiles, transactions, clock), transactions, clock, webCryptoCapabilities, true);
		view = await service.start("1", "Ignored");
		expect(view).toMatchObject({ session: { state: { step: "contact" } } });
		await act({ kind: "back" });
		expect(view).toMatchObject({ session: { state: { step: "spheres", draft: { specializations: ["blogger"], openTo: ["professional_communication"] } } } });
		await boundary.execute("UPDATE onboarding_sessions SET state_json = ?, revision = 4 WHERE telegram_user_id = '1'", [JSON.stringify({ version: 1, generation: "c".repeat(16), step: "language", returnStep: "open_to", draft: { eventStatus: "volunteer", displayName: "Legacy", profileType: "media", locationText: "Belgrade, Serbia", spheres: ["media"] }, editing: false, page: 0 })]);
		expect(await repository.getSession("1")).toMatchObject({ state: { step: "language", returnStep: "contact" } });
	});
});

function token(view: Extract<OnboardingView, { kind: "step" }>): OnboardingToken {
	return { generation: view.session.state.generation, revision: view.session.revision };
}
