import { describe, expect, it } from "vitest";

import { SqliteOutboxDeliveryRepository } from "../../src/infrastructure/database/outbox-delivery-repository.js";
import { SqliteTelegramUserRepository } from "../../src/infrastructure/database/telegram-user-repository.js";
import { DatabaseBoundaryTransactionRunner } from "../../src/infrastructure/database/transaction-runner.js";
import { FakeClock } from "../support/fake-clock.js";
import { SystemProviderDeadline } from "../../src/platform/time/provider-deadline.js";
import { createCollaborationsFeature } from "../../src/modules/collaborations/index.js";
import { createProfilesFeature } from "../../src/modules/profiles/index.js";
import { withFreshMigratedDatabase } from "../support/migrated-database.js";

describe("R2-07A collaborations composition", () => {
	it("owns draft, publication and session persistence behind one factory", async () => {
		const clock = new FakeClock(1_700_000_000_000);
		await withFreshMigratedDatabase({ prefix: "collaborations-feature-", clock }, async ({ boundary }) => {
			const transactions = new DatabaseBoundaryTransactionRunner(boundary);
			await new SqliteTelegramUserRepository(boundary).upsert({
				telegramUserId: "100",
				displayName: "Alice",
				updatedAt: clock.now().getTime(),
			});
			const profiles = createProfilesFeature({
				boundary,
				transactions,
				clock,
				deadline: new SystemProviderDeadline(),
				telegramBot: { api: { getChatMemberCount: async () => 10 } } as never,
			});
			await profiles.api.create("100", {
				type: "blogger",
				displayName: "Alice",
				description: "Local projects",
				topics: [],
				platforms: [{ platformType: "telegram", url: "https://t.me/alice_local" }],
			});

			const feature = createCollaborationsFeature({
				boundary,
				transactions,
				clock,
				outboxStore: new SqliteOutboxDeliveryRepository(boundary),
				capability: { canPublish: false, reason: "test" },
				channelChatId: "-100123",
				botUsername: "collab_test_bot",
				profileSessions: profiles.sessions,
			});

			const started = await feature.draft.start("100");

			expect(started.resumed).toBe(false);
			expect(await feature.draft.findSession("100")).toEqual(started.session);
			expect(feature.publication).toHaveProperty("publish");
			expect(feature.sessions).toHaveProperty("findActive");
		});
	});
});
