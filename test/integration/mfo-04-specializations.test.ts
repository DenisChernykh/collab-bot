import { expect, it } from "vitest";
import { OnboardingService, type OnboardingAction } from "../../src/modules/profiles/application/onboarding-service.js";
import { ProfileService } from "../../src/modules/profiles/application/profile-service.js";
import { SqliteOnboardingRepository } from "../../src/modules/profiles/infrastructure/sqlite-onboarding-repository.js";
import { SqliteProfileRepository } from "../../src/modules/profiles/infrastructure/sqlite-profile-repository.js";
import { webCryptoCapabilities } from "../../src/platform/crypto/capabilities.js";
import { DatabaseBoundaryTransactionRunner } from "../../src/platform/database/transaction-runner.js";
import { FakeClock } from "../support/fake-clock.js";
import { withFreshMigratedDatabase } from "../support/migrated-database.js";

const contact = { kind: "telegram_group" as const, url: "https://t.me/public_group", username: "public_group", telegramChatId: "-100200", title: "Public group" };

it("edits only optional specializations after completion and preserves the profile and contact", async () => {
	const clock = new FakeClock(300);
	await withFreshMigratedDatabase({ prefix: "mfo-specializations-", clock }, async ({ boundary }) => {
		await boundary.execute("INSERT INTO telegram_users (telegram_user_id, display_name, status, experience, preferred_language, created_at, updated_at) VALUES ('1', 'Saved', 'active', 'mfm', 'en', 1, 1)");
		const profiles = new SqliteProfileRepository(boundary);
		await profiles.createInitial("1", "Saved", 1);
		const repository = new SqliteOnboardingRepository(boundary);
		await repository.saveProfile("1", { eventStatus: "volunteer", displayName: "Saved", profileType: "media", locationText: "Belgrade, Serbia", spheres: ["media", "digital_it"], specializations: ["blogger"], openTo: ["professional_communication"], about: null }, 2, contact);
		const transactions = new DatabaseBoundaryTransactionRunner(boundary);
		const service = new OnboardingService(repository, new ProfileService(profiles, transactions, clock), transactions, clock, webCryptoCapabilities, false);
		const before = await repository.getProfile("1");

		let view = await service.improveSpecializations("1");
		expect(view).toMatchObject({ kind: "step", session: { state: { step: "enrichment_specializations", editing: true, draft: { specializations: ["blogger"], openTo: ["professional_communication"] } } } });
		const act = async (action: OnboardingAction) => {
			if (view.kind !== "step") throw new Error("expected specialization step");
			view = await service.act("1", action, { generation: view.session.state.generation, revision: view.session.revision });
			return view;
		};
		await act({ kind: "page", value: "1" });
		await act({ kind: "choice", value: "ai" });
		await act({ kind: "choice", value: "blogger" });
		if (view.kind !== "step") throw new Error("expected specialization step");
		const savedToken = { generation: view.session.state.generation, revision: view.session.revision };
		expect(await act({ kind: "next" })).toMatchObject({ kind: "home", notice: "saved", profile: { specializations: ["ai"], openTo: ["professional_communication"], contact } });
		const after = await repository.getProfile("1");
		expect(after).toMatchObject({ completedAt: before?.completedAt, revision: (before?.revision ?? 0) + 1, specializations: ["ai"], openTo: ["professional_communication"], contact });
		expect(await service.act("1", { kind: "next" }, savedToken)).toMatchObject({ kind: "home", notice: "stale", profile: { revision: after?.revision } });

		view = await service.improveSpecializations("1");
		await act({ kind: "choice", value: "ai" });
		expect(await act({ kind: "next" })).toMatchObject({ kind: "home", profile: { specializations: [], openTo: ["professional_communication"], contact } });
		view = await service.improveSpecializations("1");
		await act({ kind: "choice", value: "blogger" });
		expect(await act({ kind: "cancel" })).toMatchObject({ kind: "home", profile: { specializations: [], openTo: ["professional_communication"], contact } });
	});
});
