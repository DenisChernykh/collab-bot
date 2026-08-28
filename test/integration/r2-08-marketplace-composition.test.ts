import { describe, expect, it } from "vitest";

import { SqliteTelegramUserRepository } from "../../src/platform/database/telegram-user-repository.js";
import { DatabaseBoundaryTransactionRunner } from "../../src/platform/database/transaction-runner.js";
import { webCryptoCapabilities } from "../../src/platform/crypto/capabilities.js";
import { FakeClock } from "../support/fake-clock.js";
import { createMarketplaceFeature } from "../../src/modules/marketplace/index.js";
import { withFreshMigratedDatabase } from "../support/migrated-database.js";

describe("R2-08 marketplace composition", () => {
	it("owns browse-session persistence behind the marketplace factory", async () => {
		const clock = new FakeClock(1_700_000_000_000);
		await withFreshMigratedDatabase({ prefix: "marketplace-feature-", clock }, async ({ boundary }) => {
			await new SqliteTelegramUserRepository(boundary).upsert({
				telegramUserId: "200",
				displayName: "Viewer",
				updatedAt: clock.now().getTime(),
			});
			const feature = createMarketplaceFeature({
				boundary,
				transactions: new DatabaseBoundaryTransactionRunner(boundary),
				clock,
				crypto: webCryptoCapabilities,
			});

			const page = await feature.browse.openFeed("200");
			const restarted = createMarketplaceFeature({
				boundary,
				transactions: new DatabaseBoundaryTransactionRunner(boundary),
				clock,
				crypto: webCryptoCapabilities,
			});
			const resumed = await restarted.browse.openFeed("200");

			expect(page.card).toBeNull();
			expect(page.session).toMatchObject({ telegramUserId: "200", revision: 1 });
			expect(resumed.session).toMatchObject({
				generation: page.session.generation,
				revision: 2,
			});
		});
	});
});
