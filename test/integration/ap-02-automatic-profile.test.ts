import { expect, it } from "vitest";

import { ProfileService } from "../../src/modules/profiles/index.js";
import { SqliteProfileRepository } from "../../src/modules/profiles/infrastructure/sqlite-profile-repository.js";
import { SqliteCollaborationRepository } from "../../src/modules/collaborations/infrastructure/sqlite-collaboration-repository.js";
import { SqliteApplicationsRepository } from "../../src/modules/applications/infrastructure/sqlite-applications-repository.js";
import { DatabaseBoundaryTransactionRunner } from "../../src/platform/database/transaction-runner.js";
import { SqliteTelegramUserRepository } from "../../src/platform/database/telegram-user-repository.js";
import { FakeClock } from "../support/fake-clock.js";
import { withFreshMigratedDatabase } from "../support/migrated-database.js";

it("persists one initial profile and completes it in place without publishing Telegram identity", async () => {
	const clock = new FakeClock(1_700_000_000_000);
	await withFreshMigratedDatabase({ prefix: "collaboration-ap-02-", clock }, async ({ boundary }) => {
		const users = new SqliteTelegramUserRepository(boundary);
		await users.upsert({ telegramUserId: "100", username: "private_user", displayName: "Telegram Name", updatedAt: clock.now().getTime() });
		const repository = new SqliteProfileRepository(boundary);
		const service = new ProfileService(repository, new DatabaseBoundaryTransactionRunner(boundary), clock);
		const initial = await service.ensureFromTelegram("100", "Telegram Name");
		expect(initial).toMatchObject({ type: null, displayName: "Telegram Name", description: null, topics: [], platforms: [], status: "active" });
		expect(await service.getPublic(initial.id)).toBeUndefined();
		clock.advanceBy(1_000);
		expect(await service.ensureFromTelegram("100", "Changed Telegram Name")).toEqual(initial);
		expect((await boundary.query("SELECT id FROM profiles"))).toHaveLength(1);
		const collaborations = new SqliteCollaborationRepository(boundary);
		await expect(collaborations.createDraft("100", clock.now().getTime())).rejects.toThrow(/active profile is required/);
		const context = await new SqliteApplicationsRepository(boundary).findSubmissionContext("100", "11111111-1111-4111-8111-111111111111");
		expect(context?.applicant).toBeNull();
		const completed = await service.create("100", {
			type: "blogger", displayName: "Chosen Name", description: null, topics: [],
			platforms: [{ platformType: "website", url: "https://example.com" }],
		});
		expect(completed).toMatchObject({ id: initial.id, createdAt: initial.createdAt, displayName: "Chosen Name", type: "blogger" });
		expect(await service.ensureFromTelegram("100", "Third Telegram Name")).toEqual(completed);
		expect(await service.getPublic(initial.id)).not.toHaveProperty("telegramUserId");
		expect(JSON.stringify(await service.getPublic(initial.id))).not.toContain("private_user");
		expect((await collaborations.createDraft("100", clock.now().getTime())).authorProfileId).toBe(initial.id);
		await expect(service.create("100", { ...completed, type: "blogger" })).rejects.toThrow(/active profile already exists/);
	});
});

it("keeps short Telegram names as real initial data while requiring a valid completed name", async () => {
	const clock = new FakeClock(1_700_000_000_000);
	await withFreshMigratedDatabase({ prefix: "collaboration-ap-02-short-name-", clock }, async ({ boundary }) => {
		await new SqliteTelegramUserRepository(boundary).upsert({ telegramUserId: "200", displayName: "A", updatedAt: clock.now().getTime() });
		const service = new ProfileService(new SqliteProfileRepository(boundary), new DatabaseBoundaryTransactionRunner(boundary), clock);
		const initial = await service.ensureFromTelegram("200", "A");
		expect(initial.displayName).toBe("A");
		await expect(service.update("200", { type: "blogger", displayName: "A", description: null, topics: [], platforms: [{ platformType: "website", url: "https://example.com" }] })).rejects.toThrow(/display name/);
		expect(await service.getOwn("200")).toEqual(initial);
	});
});
