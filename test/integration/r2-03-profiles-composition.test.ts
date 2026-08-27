import { describe, expect, it } from "vitest";

import { DatabaseBoundaryTransactionRunner } from "../../src/infrastructure/database/transaction-runner.js";
import { SqliteTelegramUserRepository } from "../../src/infrastructure/database/telegram-user-repository.js";
import { FakeClock } from "../support/fake-clock.js";
import { SystemProviderDeadline } from "../../src/infrastructure/time/provider-deadline.js";
import { createProfilesFeature } from "../../src/modules/profiles/index.js";
import { withFreshMigratedDatabase } from "../support/migrated-database.js";

describe("R2-03 profiles composition", () => {
	it("owns profile persistence, sessions and audience service behind one factory", async () => {
		const clock = new FakeClock(1_700_000_000_000);
		await withFreshMigratedDatabase({ prefix: "profiles-feature-", clock }, async ({ boundary }) => {
			await new SqliteTelegramUserRepository(boundary).upsert({
				telegramUserId: "100",
				displayName: "Alice",
				updatedAt: clock.now().getTime(),
			});
			const feature = createProfilesFeature({
				boundary,
				transactions: new DatabaseBoundaryTransactionRunner(boundary),
				clock,
				deadline: new SystemProviderDeadline(),
				telegramBot: { api: { getChatMemberCount: async () => 10 } } as never,
			});

			const created = await feature.api.create("100", {
				type: "blogger",
				displayName: "Alice",
				description: "Local projects",
				topics: [],
				platforms: [{ platformType: "telegram", url: "https://t.me/alice_local" }],
			});

			expect(await feature.api.getOwn("100")).toEqual(created);
			expect(feature.sessions).toHaveProperty("findActive");
			expect(feature.audience).toHaveProperty("execute");
		});
	});
});
