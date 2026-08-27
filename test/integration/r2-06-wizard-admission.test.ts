import { describe, expect, it } from "vitest";

import { DatabaseBoundaryTransactionRunner } from "../../src/infrastructure/database/transaction-runner.js";
import { SqliteTelegramUserRepository } from "../../src/infrastructure/database/telegram-user-repository.js";
import { SqliteWizardAdmission } from "../../src/infrastructure/database/wizard-admission.js";
import { FakeClock } from "../../src/infrastructure/time/fake-clock.js";
import { ProfileService } from "../../src/modules/profiles/application/index.js";
import { SqliteProfileRepository } from "../../src/modules/profiles/infrastructure/sqlite-profile-repository.js";
import { SqliteProfileSessionRepository } from "../../src/modules/profiles/infrastructure/sqlite-profile-session-repository.js";
import { SqliteCollaborationRepository } from "../../src/infrastructure/database/collaboration-repository.js";
import { SqliteCollaborationSessionRepository } from "../../src/infrastructure/database/collaboration-session-repository.js";
import { withFreshMigratedDatabase } from "../support/migrated-database.js";

describe("R2-06 shared wizard admission", () => {
	it("atomically rejects profile and collaboration sessions while the other wizard is active", async () => {
		const clock = new FakeClock(1_700_000_000_000);
		await withFreshMigratedDatabase({ prefix: "wizard-admission-", clock }, async ({ boundary }) => {
			await new SqliteTelegramUserRepository(boundary).upsert({ telegramUserId: "100", displayName: "Alice", updatedAt: clock.now().getTime() });
			await new ProfileService(new SqliteProfileRepository(boundary), new DatabaseBoundaryTransactionRunner(boundary), clock).create("100", {
				type: "blogger", displayName: "Alice", description: "Local creator profile.", topics: [],
				platforms: [{ platformType: "website", url: "https://example.com/alice" }],
			});
			const collaboration = await new SqliteCollaborationRepository(boundary).createDraft("100", clock.now().getTime());
			const admission = new SqliteWizardAdmission(boundary);
			const profiles = new SqliteProfileSessionRepository(boundary, admission);
			const collaborations = new SqliteCollaborationSessionRepository(boundary, admission);
			const common = { telegramUserId: "100", revision: 1, expiresAt: clock.now().getTime() + 60_000, updatedAt: clock.now().getTime() };

			await profiles.save({ ...common, state: { version: 1, generation: "aaaaaaaaaaaaaaaa", step: "type", draft: {} } });
			await expect(collaborations.save({
				...common,
				collaborationId: collaboration.id,
				state: { version: 1, generation: "bbbbbbbbbbbbbbbb", step: "format" },
			})).rejects.toThrow("another wizard is already active");

			await profiles.delete("100");
			await collaborations.save({
				...common,
				collaborationId: collaboration.id,
				state: { version: 1, generation: "bbbbbbbbbbbbbbbb", step: "format" },
			});
			await expect(profiles.save({ ...common, state: { version: 1, generation: "aaaaaaaaaaaaaaaa", step: "type", draft: {} } }))
				.rejects.toThrow("another wizard is already active");

			await collaborations.delete("100");
			const concurrent = await Promise.allSettled([
				profiles.save({ ...common, state: { version: 1, generation: "cccccccccccccccc", step: "type", draft: {} } }),
				collaborations.save({
					...common,
					collaborationId: collaboration.id,
					state: { version: 1, generation: "dddddddddddddddd", step: "format" },
				}),
			]);
			expect(concurrent.map((result) => result.status).sort()).toEqual(["fulfilled", "rejected"]);
		});
	});
});
