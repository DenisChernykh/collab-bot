import { describe, expect, it } from "vitest";

import { DatabaseBoundary } from "../../src/platform/database/database-boundary.js";
import { SqliteOutboxDeliveryRepository } from "../../src/platform/outbox/outbox-delivery-repository.js";
import { DatabaseBoundaryTransactionRunner } from "../../src/platform/database/transaction-runner.js";
import { webCryptoCapabilities } from "../../src/platform/crypto/capabilities.js";
import { FakeClock } from "../support/fake-clock.js";
import { createApplicationsFeature } from "../../src/modules/applications/index.js";
import { SqliteApplicationsRepository } from "../../src/modules/applications/infrastructure/sqlite-applications-repository.js";
import { SqliteCollaborationBrowseRepository } from "../../src/modules/marketplace/infrastructure/sqlite-collaboration-browse-repository.js";

describe("R1-03 applications persistence ownership", () => {
	it("keeps browse queries separate from the feature-owned applications adapter", async () => {
		const boundary = new DatabaseBoundary(":memory:");
		try {
			const browse = new SqliteCollaborationBrowseRepository(boundary);
			const applications = new SqliteApplicationsRepository(boundary);
			const feature = createApplicationsFeature({
				boundary,
				outboxStore: new SqliteOutboxDeliveryRepository(boundary),
				transactions: new DatabaseBoundaryTransactionRunner(boundary),
				clock: new FakeClock(0),
				crypto: webCryptoCapabilities,
				botUsername: "collab_bot",
			});

			expect(browse).toHaveProperty("findNextEligible");
			expect(browse).not.toHaveProperty("findSubmissionContext");
			expect(browse).not.toHaveProperty("findCurrentActionVersion");
			expect(applications).toHaveProperty("findSubmissionContext");
			expect(applications).toHaveProperty("findCurrentActionVersion");
			expect(feature.api).toBe(feature.applicationService);
			expect(feature.projectionMaintenance).toHaveProperty("supersedeStaleProjectionDeliveries");
		} finally {
			await boundary.close();
		}
	});
});
