import { describe, expect, it } from "vitest";

import { SqliteOutboxDeliveryRepository } from "../../src/infrastructure/database/outbox-delivery-repository.js";
import { DatabaseBoundaryTransactionRunner } from "../../src/platform/database/transaction-runner.js";
import { FakeClock } from "../support/fake-clock.js";
import { createModerationFeature } from "../../src/modules/moderation/index.js";
import { withFreshMigratedDatabase } from "../support/migrated-database.js";

const NOW = 1_700_000_000_000;
const ADMIN_ID = "900123456789";
const AUTHOR_ID = "100123456789";
const PROFILE_ID = "11111111-0000-4000-8000-000000000001";
const COLLABORATION_ID = "aaaaaaaa-0000-4000-8000-000000000003";
const PUBLIC_TOKEN = "AAAAAAAAAAAAAAAAAAAAAA";

describe("R2-10A moderation composition", () => {
	it("keeps hide, audit and channel-delete intent inside one factory-composed transaction", async () => {
		const clock = new FakeClock(NOW);
		await withFreshMigratedDatabase({ prefix: "moderation-feature-", clock }, async ({ boundary }) => {
			await boundary.execute(
				"INSERT INTO telegram_users (telegram_user_id, username, display_name, status, blocked_at, created_at, updated_at) VALUES (?, NULL, 'Admin', 'active', NULL, ?, ?)",
				[ADMIN_ID, NOW, NOW],
			);
			await boundary.execute(
				"INSERT INTO telegram_users (telegram_user_id, username, display_name, status, blocked_at, created_at, updated_at) VALUES (?, NULL, 'Author', 'active', NULL, ?, ?)",
				[AUTHOR_ID, NOW, NOW],
			);
			await boundary.execute(
				"INSERT INTO profiles (id, telegram_user_id, type, display_name, city_code, status, created_at, updated_at, description) VALUES (?, ?, 'blogger', 'Author', 'ekaterinburg', 'active', ?, ?, NULL)",
				[PROFILE_ID, AUTHOR_ID, NOW, NOW],
			);
			await boundary.execute(
				"INSERT INTO collaborations (id, public_token, author_profile_id, format, target_profile_type, title, offer_text, expectation_text, slots_total, response_deadline_at, event_date_local, city_code, status, version, projection_revision, created_at, updated_at, published_at, first_application_at, matched_at) VALUES (?, ?, ?, 'joint_content', 'blogger', 'Test card', 'Offer text for the candidate.', 'Expected contribution text.', 1, ?, NULL, 'ekaterinburg', 'published', 1, 0, ?, ?, ?, NULL, NULL)",
				[COLLABORATION_ID, PUBLIC_TOKEN, PROFILE_ID, NOW + 86_400_000, NOW, NOW, NOW],
			);
			await boundary.execute(
				"INSERT INTO channel_publications (collaboration_id, channel_chat_id, message_id, status, rendered_terms_version, rendered_projection_revision, rendered_hash, current_attempt_no, last_delivery_id, last_error_kind, updated_at) VALUES (?, '-1001', 701, 'published', 1, 0, ?, 1, NULL, NULL, ?)",
				[COLLABORATION_ID, "a".repeat(64), NOW],
			);
			const transactions = new DatabaseBoundaryTransactionRunner(boundary);
			const feature = createModerationFeature({
				boundary,
				outboxStore: new SqliteOutboxDeliveryRepository(boundary),
				transactions,
				clock,
				botUsername: "collab_bot",
				adminTelegramIds: [ADMIN_ID],
			});

			const result = await feature.api.hide({
				adminTelegramUserId: ADMIN_ID,
				commandId: "telegram:update:1",
				deepLink: `https://t.me/collab_bot?start=c_${PUBLIC_TOKEN}`,
				reason: "Hide from showcase",
			});

			expect(result).toMatchObject({ ok: true, collaborationId: COLLABORATION_ID });
			expect(await boundary.query("SELECT status FROM collaborations WHERE id = ?", [COLLABORATION_ID])).toEqual([{ status: "hidden" }]);
			expect(await boundary.query("SELECT count(*) AS count FROM operator_actions")).toEqual([{ count: 1 }]);
			expect(await boundary.query("SELECT kind, status FROM outbox_deliveries")).toEqual([{ kind: "channel_delete", status: "prepared" }]);
		});
	});
});
