import { copyFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { DurableCommandExecutor } from "../../src/application/commands/command-executor.js";
import { DeliveryRunner } from "../../src/application/outbox/delivery-runner.js";
import type { ClaimTokenGenerator } from "../../src/application/ports/claim-token.js";
import type { OutboxDeliveryStore } from "../../src/application/ports/outbox-delivery-store.js";
import type { ProviderDeadline } from "../../src/application/ports/provider-deadline.js";
import { TelegramTransportError } from "../../src/application/ports/telegram-transport.js";
import { DatabaseBoundary } from "../../src/infrastructure/database/database-boundary.js";
import { hashCanonicalInput } from "../../src/infrastructure/crypto/canonical-input-hash.js";
import { SqliteDurableCommandStore } from "../../src/infrastructure/database/durable-command-repository.js";
import { MigrationRunner, MigrationSource } from "../../src/infrastructure/database/migrations.js";
import { SqliteOutboxDeliveryRepository } from "../../src/infrastructure/database/outbox-delivery-repository.js";
import { DatabaseBoundaryTransactionRunner } from "../../src/infrastructure/database/transaction-runner.js";
import { FakeTelegramTransport } from "../support/fake-telegram-transport.js";
import { FakeClock } from "../../src/infrastructure/time/fake-clock.js";
import { ApplicationService } from "../../src/modules/applications/application/application-feature.js";
import { CollaborationBrowseService } from "../../src/modules/marketplace/index.js";
import { SqliteCollaborationBrowseRepository } from "../../src/modules/marketplace/infrastructure/sqlite-collaboration-browse-repository.js";
import { createTestApplicationsFeature } from "../support/applications-feature.js";
import { withFreshMigratedDatabase } from "../support/migrated-database.js";

const migrationsPath = fileURLToPath(new URL("../../migrations/", import.meta.url));
const NOW = 1_700_000_000_000;
const DAY = 24 * 60 * 60 * 1000;
const BOT_USERNAME = "collab_bot";

const USERS = {
	author: "100123456789",
	applicant: "200987654321",
	occupant: "300123456789",
	noProfile: "400123456789",
	blocked: "500123456789",
} as const;

const CARDS = {
	eligible: cardId("1"),
	applied: cardId("2"),
	full: cardId("3"),
	mismatch: cardId("4"),
	past: cardId("5"),
	exact: cardId("6"),
	hidden: cardId("7"),
	own: cardId("8"),
} as const;

const TOKENS = {
	eligible: "AAAAAAAAAAAAAAAAAAAAAA",
	applied: "BBBBBBBBBBBBBBBBBBBBBB",
	full: "CCCCCCCCCCCCCCCCCCCCCC",
	mismatch: "DDDDDDDDDDDDDDDDDDDDDD",
	past: "EEEEEEEEEEEEEEEEEEEEEE",
	exact: "FFFFFFFFFFFFFFFFFFFFFF",
	hidden: "GGGGGGGGGGGGGGGGGGGGGG",
	own: "HHHHHHHHHHHHHHHHHHHHHH",
} as const;

class ImmediateDeadline implements ProviderDeadline {
	run<T>(_signal: AbortSignal | undefined, operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
		return operation(new AbortController().signal);
	}
}

class FixedClaim implements ClaimTokenGenerator {
	private sequence = 0;
	generate(): string {
		this.sequence += 1;
		return `application-claim-${this.sequence}`;
	}
}

describe("S3-03 application migration", () => {
	it("applies the complete fresh schema with bounded application indexes", async () => {
		const directory = await mkdtemp(join(tmpdir(), "collaboration-s3-03-fresh-"));
		const boundary = new DatabaseBoundary(join(directory, "app.sqlite"));
		try {
			const runner = new MigrationRunner(await MigrationSource.fromDirectory(migrationsPath), new FakeClock(NOW));
			expect((await runner.migrate(boundary)).applied).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
			expect((await boundary.query<{ name: string }>("PRAGMA table_info(applications)")).map((column) => column.name)).toEqual([
				"id",
				"collaboration_id",
				"applicant_profile_id",
				"message",
				"terms_version",
				"collaboration_version",
				"status",
				"decided_by_profile_id",
				"decided_at",
				"created_at",
			]);
			expect(await boundary.query("SELECT name FROM pragma_table_info('collaborations') WHERE name = 'first_application_at'")).toEqual([
				{ name: "first_application_at" },
			]);
			expect((await boundary.query<{ name: string }>(
				"SELECT name FROM sqlite_master WHERE type = 'index' AND name IN ('applications_applicant_created', 'applications_collaboration_status_created') ORDER BY name",
			)).map((row) => row.name)).toEqual([
				"applications_applicant_created",
				"applications_collaboration_status_created",
			]);
			await runner.verify(boundary);
		} finally {
			await boundary.close();
			await rm(directory, { recursive: true, force: true });
		}
	});

	it("upgrades populated 0009 data, enforces constraints, and survives close/reopen with foreign keys intact", async () => {
		const directory = await mkdtemp(join(tmpdir(), "collaboration-s3-03-upgrade-"));
		const fixturePath = join(directory, "migrations");
		const databasePath = join(directory, "app.sqlite");
		let boundary = new DatabaseBoundary(databasePath);
		const clock = new FakeClock(NOW);
		try {
			await mkdir(fixturePath);
			for (const filename of [
				"0001_s0-04-ingress-foundation.sql",
				"0002_s0-05-outbox-events.sql",
				"0003_s1-01-profile-state.sql",
				"0004_s1-02-profile-sessions.sql",
				"0005_s1-03-telegram-first-contact.sql",
				"0006_s2-01-collaboration-drafts.sql",
				"0007_s2-02-channel-publications.sql",
				"0008_s3-01-minimal-profiles.sql",
				"0009_s3-02-browse.sql",
			]) await copyFile(join(migrationsPath, filename), join(fixturePath, filename));
			const previous = new MigrationRunner(await MigrationSource.fromDirectory(fixturePath), clock);
			expect((await previous.migrate(boundary)).applied).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
			await seedUser(boundary, USERS.author, "author_private");
			await seedProfile(boundary, USERS.author, profileId(1), "blogger", {
				description: "Публичный профиль автора карточки.",
				topics: ["city"],
			});
			await seedUser(boundary, USERS.applicant, "applicant_private");
			await seedProfile(boundary, USERS.applicant, profileId(2), "blogger", {
				description: null,
				topics: [],
			});
			await insertCard(boundary, {
				id: CARDS.eligible,
				token: TOKENS.eligible,
				authorProfileId: profileId(1),
				publishedAt: NOW - 100,
			});
			await boundary.execute(
				"INSERT INTO browse_sessions (telegram_user_id, generation, target_profile_type_filter, format_filter, topic_filter, cursor_published_at, cursor_collaboration_id, revision, expires_at, updated_at) VALUES (?, 'abcdef0123456789', NULL, NULL, 'city', ?, ?, 3, ?, ?)",
				[USERS.applicant, NOW - 100, CARDS.eligible, NOW + DAY, NOW],
			);

			await copyFile(join(migrationsPath, "0010_s3-03-applications.sql"), join(fixturePath, "0010_s3-03-applications.sql"));
			const upgraded = new MigrationRunner(await MigrationSource.fromDirectory(fixturePath), clock);
			expect((await upgraded.migrate(boundary)).applied).toEqual([10]);
			expect(await boundary.query("SELECT id, telegram_user_id, description FROM profiles ORDER BY id")).toEqual([
				{ id: profileId(1), telegram_user_id: USERS.author, description: "Публичный профиль автора карточки." },
				{ id: profileId(2), telegram_user_id: USERS.applicant, description: null },
			]);
			expect(await boundary.query("SELECT id, profile_id, url FROM profile_platforms ORDER BY id")).toEqual([
				{ id: platformId(1), profile_id: profileId(1), url: "https://example.com/1" },
				{ id: platformId(2), profile_id: profileId(2), url: "https://example.com/2" },
			]);
			expect(await boundary.query("SELECT collaboration_id, topic FROM collaboration_topics")).toEqual([
				{ collaboration_id: CARDS.eligible, topic: "city" },
			]);
			expect(await boundary.query("SELECT collaboration_id, message_id, status FROM channel_publications")).toEqual([
				{ collaboration_id: CARDS.eligible, message_id: 701, status: "published" },
			]);
			expect(await boundary.query("SELECT telegram_user_id, revision, cursor_collaboration_id FROM browse_sessions")).toEqual([
				{ telegram_user_id: USERS.applicant, revision: 3, cursor_collaboration_id: CARDS.eligible },
			]);
			expect(await boundary.query("SELECT id, first_application_at FROM collaborations")).toEqual([
				{ id: CARDS.eligible, first_application_at: null },
			]);

			await insertRawApplication(boundary, {
				id: applicationId(1),
				collaborationId: CARDS.eligible,
				applicantProfileId: profileId(2),
				message: "Ровно один корректный отклик.",
			});
			await expect(insertRawApplication(boundary, {
				id: applicationId(2),
				collaborationId: CARDS.eligible,
				applicantProfileId: profileId(2),
				message: "Повторный отклик в ту же карточку.",
			})).rejects.toThrow(/unique/i);
			await expect(boundary.execute(
				"INSERT INTO applications (id, collaboration_id, applicant_profile_id, message, terms_version, collaboration_version, status, decided_by_profile_id, decided_at, created_at) VALUES (?, ?, ?, 'short', 1, 1, 'pending', NULL, NULL, ?)",
				[applicationId(3), CARDS.eligible, profileId(1), NOW],
			)).rejects.toThrow();
			await expect(boundary.execute(
				"INSERT INTO applications (id, collaboration_id, applicant_profile_id, message, terms_version, collaboration_version, status, decided_by_profile_id, decided_at, created_at) VALUES (?, ?, ?, 'Достаточно длинный некорректный статус.', 1, 1, 'unknown', NULL, NULL, ?)",
				[applicationId(4), CARDS.eligible, profileId(1), NOW],
			)).rejects.toThrow();
			await expect(boundary.execute(
				"UPDATE applications SET status = 'accepted' WHERE id = ?",
				[applicationId(1)],
			)).rejects.toThrow();
			await expect(boundary.execute(
				"UPDATE applications SET message = 'Изменённый текст уже сохранённого отклика.' WHERE id = ?",
				[applicationId(1)],
			)).rejects.toThrow(/immutable/i);
			await boundary.execute("UPDATE collaborations SET first_application_at = ? WHERE id = ?", [NOW, CARDS.eligible]);
			await expect(boundary.execute("UPDATE collaborations SET first_application_at = ? WHERE id = ?", [NOW + 1, CARDS.eligible])).rejects.toThrow(/immutable/i);
			await expect(boundary.execute("UPDATE collaborations SET first_application_at = NULL WHERE id = ?", [CARDS.eligible])).rejects.toThrow(/immutable/i);
			expect(await boundary.query("PRAGMA foreign_key_check")).toEqual([]);
			await boundary.close();
			boundary = new DatabaseBoundary(databasePath);
			await expect(upgraded.migrate(boundary)).resolves.toMatchObject({ noOp: true });
			expect(await boundary.query("SELECT id, collaboration_id, applicant_profile_id, message, status FROM applications")).toEqual([
				{
					id: applicationId(1),
					collaboration_id: CARDS.eligible,
					applicant_profile_id: profileId(2),
					message: "Ровно один корректный отклик.",
					status: "pending",
				},
			]);
			expect(await boundary.query("SELECT first_application_at FROM collaborations WHERE id = ?", [CARDS.eligible])).toEqual([
				{ first_application_at: NOW },
			]);
			expect(await boundary.query("PRAGMA foreign_key_check")).toEqual([]);
		} finally {
			await boundary.close();
			await rm(directory, { recursive: true, force: true });
		}
	});
});

describe("S3-03 application submission", () => {
	it("atomically creates one pending application, first-application time, and one privacy-safe author DM", async () => {
		await withApplicationDatabase(async (fixture) => {
			const result = await fixture.service.submit({
				telegramUserId: USERS.applicant,
				collaborationId: CARDS.eligible,
				message: "  Готов снять короткий ролик и согласовать сценарий.  ",
				occurredAt: NOW,
			});
			expect(result).toMatchObject({ ok: true, applicationId: expect.any(String), deliveryId: expect.any(String) });
			if (!result.ok) throw new Error("application should have been created");
			expect(await fixture.boundary.query(
				"SELECT id, collaboration_id, applicant_profile_id, message, terms_version, collaboration_version, status, decided_by_profile_id, decided_at, created_at FROM applications WHERE id = ?",
				[result.applicationId],
			)).toEqual([{
				id: result.applicationId,
				collaboration_id: CARDS.eligible,
				applicant_profile_id: profileId(2),
				message: "Готов снять короткий ролик и согласовать сценарий.",
				terms_version: 1,
				collaboration_version: 1,
				status: "pending",
				decided_by_profile_id: null,
				decided_at: null,
				created_at: NOW,
			}]);
			expect(await fixture.boundary.query("SELECT first_application_at FROM collaborations WHERE id = ?", [CARDS.eligible])).toEqual([
				{ first_application_at: NOW },
			]);
			const deliveries = await fixture.boundary.query<{
				id: string;
				idempotency_key: string;
				kind: string;
				recipient_chat_id: string;
				payload_json: string;
			}>("SELECT id, idempotency_key, kind, recipient_chat_id, payload_json FROM outbox_deliveries");
			expect(deliveries).toHaveLength(1);
			expect(deliveries[0]).toMatchObject({
				id: result.deliveryId,
				idempotency_key: `application:${result.applicationId}:author_dm:v1`,
				kind: "dm_send",
				recipient_chat_id: USERS.author,
			});
			const serializedPayload = deliveries[0]?.payload_json ?? "";
			expect(serializedPayload).toContain("Готов снять короткий ролик");
			expect(serializedPayload).toContain("Публичный кандидат");
			expect(serializedPayload).toContain(`https://t.me/${BOT_USERNAME}?start=c_${TOKENS.eligible}`);
			for (const privateValue of [USERS.applicant, "applicant_private", "-100200987654321", profileId(2), platformId(2)]) {
				expect(serializedPayload).not.toContain(privateValue);
			}

			expect(await fixture.service.submit({
				telegramUserId: USERS.applicant,
				collaborationId: CARDS.eligible,
				message: "Повторный отклик не должен создать эффект.",
				occurredAt: NOW,
			})).toEqual({ ok: false, code: "duplicate" });
			expect(await scalarCount(fixture.boundary, "applications", "collaboration_id = ?", [CARDS.eligible])).toBe(1);
			expect(await scalarCount(fixture.boundary, "outbox_deliveries")).toBe(1);
		});
	});

	it("returns fail-closed guards and treats the exact deadline as eligible", async () => {
		await withApplicationDatabase(async (fixture) => {
			const check = (telegramUserId: string, collaborationId: string, occurredAt = NOW) => fixture.service.checkEligibility({
				telegramUserId,
				collaborationId,
				occurredAt,
			});
			expect(await check(USERS.noProfile, CARDS.eligible)).toEqual({ ok: false, code: "profile_required" });
			expect(await check(USERS.blocked, CARDS.eligible)).toEqual({ ok: false, code: "actor_inactive" });
			expect(await check(USERS.applicant, CARDS.own)).toEqual({ ok: false, code: "own_collaboration" });
			expect(await check(USERS.applicant, CARDS.mismatch)).toEqual({ ok: false, code: "profile_type_mismatch" });
			expect(await check(USERS.applicant, CARDS.past)).toEqual({ ok: false, code: "deadline_passed" });
			expect(await check(USERS.applicant, CARDS.hidden)).toEqual({ ok: false, code: "target_unavailable" });
			expect(await check(USERS.applicant, CARDS.applied)).toEqual({ ok: false, code: "duplicate" });
			expect(await check(USERS.applicant, CARDS.full)).toEqual({ ok: false, code: "full" });
			expect(await check(USERS.applicant, CARDS.exact)).toMatchObject({ ok: true });
		});
	});

	it("rolls back the application and first-application time when author-DM intent insertion fails", async () => {
		await withApplicationDatabase(async (fixture) => {
			const realOutbox = new SqliteOutboxDeliveryRepository(fixture.boundary);
			const failingOutbox = new Proxy(realOutbox, {
				get(target, property, receiver) {
					if (property === "insert") return async (): Promise<void> => { throw new Error("synthetic outbox failure"); };
					const value: unknown = Reflect.get(target, property, receiver);
					return typeof value === "function" ? value.bind(target) : value;
				},
			}) as OutboxDeliveryStore;
			const service = createTestApplicationsFeature({
				boundary: fixture.boundary,
				clock: fixture.clock,
				outboxStore: failingOutbox,
				botUsername: BOT_USERNAME,
			}).applicationService;
			const durable = new DurableCommandExecutor(
				new DatabaseBoundaryTransactionRunner(fixture.boundary),
				new SqliteDurableCommandStore(fixture.boundary),
				{ hash: hashCanonicalInput },
				fixture.clock,
			);

			await expect(durable.execute({
				context: {
					commandId: "telegram:update:991",
					telegramUpdateId: 991,
					actor: { kind: "telegram_user", telegramUserId: USERS.applicant },
					occurredAt: new Date(NOW),
				},
				input: { kind: "message", text: "Этот отклик должен целиком откатиться." },
				effect: async () => {
					await service.submit({
						telegramUserId: USERS.applicant,
						collaborationId: CARDS.eligible,
						message: "Этот отклик должен целиком откатиться.",
						occurredAt: NOW,
					});
					return { version: 1, outcome: "completed", messageKey: "command_completed" };
				},
			})).rejects.toThrow("synthetic outbox failure");
			expect(await scalarCount(fixture.boundary, "applications", "collaboration_id = ?", [CARDS.eligible])).toBe(0);
			expect(await scalarCount(fixture.boundary, "outbox_deliveries")).toBe(0);
			expect(await fixture.boundary.query("SELECT command_id FROM command_receipts WHERE command_id = 'telegram:update:991'")).toEqual([]);
			expect(await fixture.boundary.query("SELECT update_id FROM processed_updates WHERE update_id = 991")).toEqual([]);
			expect(await fixture.boundary.query("SELECT first_application_at FROM collaborations WHERE id = ?", [CARDS.eligible])).toEqual([
				{ first_application_at: null },
			]);
		});
	});

	it.each([
		{
			name: "permanent DM failure",
			error: new TelegramTransportError({ code: "forbidden" }),
			expectedDeliveryStatus: "permanent_failed",
			expectedOutcome: "permanent_failed",
		},
		{
			name: "ambiguous DM outcome",
			error: new TelegramTransportError({ code: "connection_lost", phase: "after_possible_send" }),
			expectedDeliveryStatus: "ambiguous",
			expectedOutcome: "ambiguous",
		},
	])("keeps authoritative pending state after $name", async ({ error, expectedDeliveryStatus, expectedOutcome }) => {
		await withApplicationDatabase(async (fixture) => {
			const submitted = await fixture.service.submit({
				telegramUserId: USERS.applicant,
				collaborationId: CARDS.eligible,
				message: "Бизнес-состояние не зависит от доставки DM.",
				occurredAt: NOW,
			});
			if (!submitted.ok) throw new Error("application should have been created");
			const transport = new FakeTelegramTransport();
			transport.enqueueFailure(error);
			const runner = new DeliveryRunner(
				new SqliteOutboxDeliveryRepository(fixture.boundary),
				transport,
				new ImmediateDeadline(),
				new FixedClaim(),
				fixture.clock,
			);
			expect(await runner.runOnce()).toMatchObject({ outcome: expectedOutcome, deliveryId: submitted.deliveryId });
			expect(await fixture.boundary.query("SELECT status, decided_by_profile_id, decided_at FROM applications WHERE id = ?", [submitted.applicationId])).toEqual([
				{ status: "pending", decided_by_profile_id: null, decided_at: null },
			]);
			expect(await fixture.boundary.query("SELECT first_application_at FROM collaborations WHERE id = ?", [CARDS.eligible])).toEqual([
				{ first_application_at: NOW },
			]);
			expect(await fixture.boundary.query("SELECT status FROM outbox_deliveries WHERE id = ?", [submitted.deliveryId])).toEqual([
				{ status: expectedDeliveryStatus },
			]);
		});
	});

	it("excludes already-used and full cards from feed while leaving another eligible card visible", async () => {
		await withApplicationDatabase(async (fixture) => {
			const page = await new CollaborationBrowseService(
				new SqliteCollaborationBrowseRepository(fixture.boundary),
				new DatabaseBoundaryTransactionRunner(fixture.boundary),
				fixture.clock,
			).openFeed(USERS.applicant);
			expect(page.card?.id).toBe(CARDS.eligible);
			expect(page.card?.id).not.toBe(CARDS.applied);
			expect(page.card?.id).not.toBe(CARDS.full);
		});
	});
});

interface ApplicationFixture {
	readonly boundary: DatabaseBoundary;
	readonly clock: FakeClock;
	readonly service: ApplicationService;
}

async function withApplicationDatabase(work: (fixture: ApplicationFixture) => Promise<void>): Promise<void> {
	const clock = new FakeClock(NOW);
	await withFreshMigratedDatabase({
		prefix: "collaboration-s3-03-service-",
		clock,
	}, async ({ boundary, appliedMigrations }) => {
		expect(appliedMigrations).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
		await seedApplicationFixture(boundary);
		await work({
			boundary,
			clock,
			service: createTestApplicationsFeature({ boundary, clock, botUsername: BOT_USERNAME }).applicationService,
		});
	});
}

async function seedApplicationFixture(boundary: DatabaseBoundary): Promise<void> {
	await seedUser(boundary, USERS.author, "author_private");
	await seedProfile(boundary, USERS.author, profileId(1), "blogger", { description: "Публичный автор городской карточки.", topics: ["city"] });
	await seedUser(boundary, USERS.applicant, "applicant_private");
	await seedProfile(boundary, USERS.applicant, profileId(2), "blogger", {
		displayName: "Публичный кандидат",
		description: "Пишу о городской жизни и локальных проектах.",
		topics: ["city", "lifestyle"],
		telegramChatId: "-100200987654321",
	});
	await seedUser(boundary, USERS.occupant, "occupant_private");
	await seedProfile(boundary, USERS.occupant, profileId(3), "blogger", { description: null, topics: [] });
	await seedUser(boundary, USERS.noProfile, null);
	await seedUser(boundary, USERS.blocked, "blocked_private", "blocked");
	await seedProfile(boundary, USERS.blocked, profileId(5), "blogger", { description: null, topics: [] });

	await insertCard(boundary, { id: CARDS.eligible, token: TOKENS.eligible, authorProfileId: profileId(1), publishedAt: NOW + 100 });
	await insertCard(boundary, { id: CARDS.applied, token: TOKENS.applied, authorProfileId: profileId(1), publishedAt: NOW + 300 });
	await insertCard(boundary, { id: CARDS.full, token: TOKENS.full, authorProfileId: profileId(1), publishedAt: NOW + 200, slotsTotal: 1 });
	await insertCard(boundary, { id: CARDS.mismatch, token: TOKENS.mismatch, authorProfileId: profileId(1), publishedAt: NOW - 100, targetProfileType: "telegram_channel" });
	await insertCard(boundary, { id: CARDS.past, token: TOKENS.past, authorProfileId: profileId(1), publishedAt: NOW - 200, deadlineAt: NOW - 1 });
	await insertCard(boundary, { id: CARDS.exact, token: TOKENS.exact, authorProfileId: profileId(1), publishedAt: NOW - 300, deadlineAt: NOW });
	await insertCard(boundary, { id: CARDS.hidden, token: TOKENS.hidden, authorProfileId: profileId(1), publishedAt: NOW - 400, status: "hidden" });
	await insertCard(boundary, { id: CARDS.own, token: TOKENS.own, authorProfileId: profileId(2), publishedAt: NOW - 500 });

	await insertRawApplication(boundary, {
		id: applicationId(20),
		collaborationId: CARDS.applied,
		applicantProfileId: profileId(2),
		message: "Кандидат уже использовал эту карточку.",
	});
	await insertRawApplication(boundary, {
		id: applicationId(30),
		collaborationId: CARDS.full,
		applicantProfileId: profileId(3),
		message: "Этот принятый отклик занимает единственное место.",
		status: "accepted",
		decidedByProfileId: profileId(1),
		decidedAt: NOW - 10,
	});
}

interface ProfileOptions {
	readonly displayName?: string;
	readonly description: string | null;
	readonly topics: readonly string[];
	readonly telegramChatId?: string;
}

async function seedUser(
	boundary: DatabaseBoundary,
	telegramUserId: string,
	username: string | null,
	status: "active" | "blocked" = "active",
): Promise<void> {
	await boundary.execute(
		"INSERT INTO telegram_users (telegram_user_id, username, display_name, status, blocked_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
		[telegramUserId, username, `User ${telegramUserId}`, status, status === "blocked" ? NOW : null, NOW, NOW],
	);
}

async function seedProfile(
	boundary: DatabaseBoundary,
	telegramUserId: string,
	id: string,
	type: "blogger" | "telegram_channel" | "venue_or_brand",
	options: ProfileOptions,
): Promise<void> {
	const ordinal = Number.parseInt(id.slice(0, 8), 16);
	await boundary.execute(
		"INSERT INTO profiles (id, telegram_user_id, type, display_name, city_code, status, created_at, updated_at, description) VALUES (?, ?, ?, ?, 'ekaterinburg', 'active', ?, ?, ?)",
		[id, telegramUserId, type, options.displayName ?? `Profile ${ordinal}`, NOW, NOW, options.description],
	);
	await boundary.execute(
		"INSERT INTO profile_platforms (id, profile_id, platform_type, url, title, username, telegram_chat_id, audience_size) VALUES (?, ?, 'website', ?, 'Public platform', 'public_platform', ?, 12000)",
		[platformId(ordinal), id, `https://example.com/${ordinal}`, options.telegramChatId ?? null],
	);
	for (const topic of options.topics) {
		await boundary.execute("INSERT INTO profile_topics (profile_id, topic) VALUES (?, ?)", [id, topic]);
	}
}

interface CardOptions {
	readonly id: string;
	readonly token: string;
	readonly authorProfileId: string;
	readonly publishedAt: number;
	readonly status?: "published" | "hidden";
	readonly targetProfileType?: "blogger" | "telegram_channel" | "venue_or_brand" | "any";
	readonly deadlineAt?: number;
	readonly slotsTotal?: number;
}

async function insertCard(boundary: DatabaseBoundary, options: CardOptions): Promise<void> {
	const status = options.status ?? "published";
	await boundary.execute(
		"INSERT INTO collaborations (id, public_token, author_profile_id, format, target_profile_type, title, offer_text, expectation_text, slots_total, response_deadline_at, event_date_local, city_code, status, version, projection_revision, created_at, updated_at, published_at) VALUES (?, ?, ?, 'joint_content', ?, 'Городской видеопроект', 'Совместный материал для аудитории города.', 'Нужен партнёр для съёмки и согласования.', ?, ?, NULL, 'ekaterinburg', ?, 1, 0, ?, ?, ?)",
		[
			options.id,
			options.token,
			options.authorProfileId,
			options.targetProfileType ?? "blogger",
			options.slotsTotal ?? 2,
			options.deadlineAt ?? NOW + DAY,
			status === "hidden" ? "published" : status,
			NOW - DAY,
			NOW - DAY,
			options.publishedAt,
		],
	);
	if (status === "hidden") {
		await boundary.execute(
			"UPDATE collaborations SET status = 'hidden', hidden_from_status = 'published', hidden_at = ? WHERE id = ?",
			[NOW - DAY, options.id],
		);
	}
	await boundary.execute("INSERT INTO collaboration_topics (collaboration_id, topic) VALUES (?, 'city')", [options.id]);
	if (status === "published") {
		await boundary.execute(
			"INSERT INTO channel_publications (collaboration_id, channel_chat_id, message_id, status, rendered_terms_version, rendered_projection_revision, rendered_hash, current_attempt_no, last_delivery_id, last_error_kind, updated_at) VALUES (?, '-1001', ?, 'published', 1, 0, ?, 1, NULL, NULL, ?)",
			[options.id, 701, options.id.replaceAll("-", "").padEnd(64, "0").slice(0, 64), options.publishedAt],
		);
	}
}

interface RawApplicationOptions {
	readonly id: string;
	readonly collaborationId: string;
	readonly applicantProfileId: string;
	readonly message: string;
	readonly status?: "pending" | "accepted";
	readonly decidedByProfileId?: string;
	readonly decidedAt?: number;
}

async function insertRawApplication(boundary: DatabaseBoundary, options: RawApplicationOptions): Promise<void> {
	await boundary.execute(
		"INSERT INTO applications (id, collaboration_id, applicant_profile_id, message, terms_version, collaboration_version, status, decided_by_profile_id, decided_at, created_at) VALUES (?, ?, ?, ?, 1, 1, ?, ?, ?, ?)",
		[
			options.id,
			options.collaborationId,
			options.applicantProfileId,
			options.message,
			options.status ?? "pending",
			options.decidedByProfileId ?? null,
			options.decidedAt ?? null,
			NOW - 20,
		],
	);
}

async function scalarCount(
	boundary: DatabaseBoundary,
	table: "applications" | "outbox_deliveries",
	where?: string,
	parameters: readonly (string | number)[] = [],
): Promise<number> {
	const rows = await boundary.query<{ count: number }>(`SELECT count(*) AS count FROM ${table}${where === undefined ? "" : ` WHERE ${where}`}`, parameters);
	return rows[0]?.count ?? -1;
}

function profileId(value: number): string { return `${value.toString(16).padStart(8, "0")}-0000-4000-8000-000000000001`; }
function platformId(value: number): string { return `${value.toString(16).padStart(8, "0")}-0000-4000-8000-000000000002`; }
function cardId(prefix: string): string { return `${prefix.padStart(8, prefix)}-0000-4000-8000-000000000003`; }
function applicationId(value: number): string { return `${value.toString(16).padStart(8, "0")}-0000-4000-8000-000000000004`; }
