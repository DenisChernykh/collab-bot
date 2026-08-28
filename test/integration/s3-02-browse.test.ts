import { copyFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
	BROWSE_SESSION_TTL_MS,
	BrowseSessionStaleError,
	CollaborationBrowseService,
} from "../../src/modules/marketplace/index.js";
import { DatabaseBoundary } from "../../src/platform/database/database-boundary.js";
import { SqliteCollaborationBrowseRepository } from "../../src/modules/marketplace/infrastructure/sqlite-collaboration-browse-repository.js";
import { MigrationRunner, MigrationSource } from "../../src/platform/database/migrations.js";
import { DatabaseBoundaryTransactionRunner } from "../../src/platform/database/transaction-runner.js";
import { FakeClock } from "../support/fake-clock.js";

const migrationsPath = fileURLToPath(new URL("../../migrations/", import.meta.url));
const NOW = 1_700_000_000_000;
const TOKENS = {
	first: "AAAAAAAAAAAAAAAAAAAAAA",
	second: "BBBBBBBBBBBBBBBBBBBBBB",
	third: "CCCCCCCCCCCCCCCCCCCCCC",
	exact: "DDDDDDDDDDDDDDDDDDDDDD",
	own: "EEEEEEEEEEEEEEEEEEEEEE",
	hidden: "FFFFFFFFFFFFFFFFFFFFFF",
	past: "GGGGGGGGGGGGGGGGGGGGGG",
	expired: "HHHHHHHHHHHHHHHHHHHHHH",
	matched: "IIIIIIIIIIIIIIIIIIIIII",
	completed: "JJJJJJJJJJJJJJJJJJJJJJ",
	cancelled: "KKKKKKKKKKKKKKKKKKKKKK",
	publishing: "LLLLLLLLLLLLLLLLLLLLLL",
	failed: "MMMMMMMMMMMMMMMMMMMMMM",
} as const;

describe("S3-02 collaboration browse state", () => {
	it("upgrades 0008 with immutable publication time and a bounded browse session", async () => {
		const directory = await mkdtemp(join(tmpdir(), "collaboration-s3-02-upgrade-"));
		const fixture = join(directory, "migrations");
		const databasePath = join(directory, "app.sqlite");
		let boundary = new DatabaseBoundary(databasePath);
		const clock = new FakeClock(NOW);
		try {
			await mkdir(fixture);
			for (const filename of [
				"0001_s0-04-ingress-foundation.sql",
				"0002_s0-05-outbox-events.sql",
				"0003_s1-01-profile-state.sql",
				"0004_s1-02-profile-sessions.sql",
				"0005_s1-03-telegram-first-contact.sql",
				"0006_s2-01-collaboration-drafts.sql",
				"0007_s2-02-channel-publications.sql",
				"0008_s3-01-minimal-profiles.sql",
			]) await copyFile(join(migrationsPath, filename), join(fixture, filename));
			const previous = await MigrationSource.fromDirectory(fixture);
			expect((await new MigrationRunner(previous, clock).migrate(boundary)).applied).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
			await seedProfile(boundary, "100", profileId(100));
			await insertLegacyCard(boundary, {
				id: cardId("1"), token: TOKENS.first, authorProfileId: profileId(100), status: "published",
			});
			await insertLegacyCard(boundary, {
				id: cardId("2"), token: TOKENS.failed, authorProfileId: profileId(100), status: "publication_failed",
			});
			await insertLegacyCard(boundary, {
				id: cardId("3"), token: TOKENS.expired, authorProfileId: profileId(100), status: "expired",
			});
			await boundary.execute(
				"INSERT INTO channel_publications (collaboration_id, channel_chat_id, message_id, status, rendered_terms_version, rendered_projection_revision, rendered_hash, current_attempt_no, last_delivery_id, last_error_kind, updated_at) VALUES (?, '-1001', 41, 'published', 1, 0, ?, 1, NULL, NULL, ?)",
				[cardId("1"), "a".repeat(64), NOW - 500],
			);
			await boundary.execute(
				"INSERT INTO channel_publications (collaboration_id, channel_chat_id, message_id, status, rendered_terms_version, rendered_projection_revision, rendered_hash, current_attempt_no, last_delivery_id, last_error_kind, updated_at) VALUES (?, '-1001', NULL, 'failed', 1, 0, ?, 1, NULL, 'network', ?)",
				[cardId("2"), "b".repeat(64), NOW - 400],
			);
			await boundary.execute(
				"INSERT INTO channel_publications (collaboration_id, channel_chat_id, message_id, status, rendered_terms_version, rendered_projection_revision, rendered_hash, current_attempt_no, last_delivery_id, last_error_kind, updated_at) VALUES (?, '-1001', 42, 'published', 1, 0, ?, 1, NULL, NULL, ?)",
				[cardId("3"), "c".repeat(64), NOW - 300],
			);

			await copyFile(join(migrationsPath, "0009_s3-02-browse.sql"), join(fixture, "0009_s3-02-browse.sql"));
			const upgraded = await MigrationSource.fromDirectory(fixture);
			expect((await new MigrationRunner(upgraded, clock).migrate(boundary)).applied).toEqual([9]);
			expect(await boundary.query("SELECT id, published_at FROM collaborations ORDER BY id")).toEqual([
				{ id: cardId("1"), published_at: NOW - 500 },
				{ id: cardId("2"), published_at: null },
				{ id: cardId("3"), published_at: NOW - 300 },
			]);
			expect(await boundary.query("SELECT id, telegram_user_id FROM profiles")).toEqual([{ id: profileId(100), telegram_user_id: "100" }]);
			expect(await boundary.query("SELECT id, profile_id, url FROM profile_platforms")).toEqual([{ id: platformId(100), profile_id: profileId(100), url: "https://example.com/100" }]);
			expect(await boundary.query("SELECT collaboration_id, message_id, status, updated_at FROM channel_publications ORDER BY collaboration_id")).toEqual([
				{ collaboration_id: cardId("1"), message_id: 41, status: "published", updated_at: NOW - 500 },
				{ collaboration_id: cardId("2"), message_id: null, status: "failed", updated_at: NOW - 400 },
				{ collaboration_id: cardId("3"), message_id: 42, status: "published", updated_at: NOW - 300 },
			]);
			expect(await boundary.query("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'profiles_one_active_per_user'")).toEqual([{ name: "profiles_one_active_per_user" }]);
			expect(await boundary.query("SELECT collaboration_id, topic FROM collaboration_topics ORDER BY collaboration_id")).toEqual([
				{ collaboration_id: cardId("1"), topic: "city" },
				{ collaboration_id: cardId("2"), topic: "city" },
				{ collaboration_id: cardId("3"), topic: "city" },
			]);
			expect(await boundary.query("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'browse_sessions'")).toEqual([{ name: "browse_sessions" }]);
			expect(await boundary.query("SELECT name FROM sqlite_master WHERE type = 'index' AND name IN ('collaborations_feed_order', 'browse_sessions_expiry') ORDER BY name")).toEqual([
				{ name: "browse_sessions_expiry" },
				{ name: "collaborations_feed_order" },
			]);
			await expect(boundary.execute("UPDATE collaborations SET published_at = ? WHERE id = ?", [NOW, cardId("1")])).rejects.toThrow(/immutable/i);
			await expect(boundary.execute("UPDATE collaborations SET published_at = NULL WHERE id = ?", [cardId("1")])).rejects.toThrow(/immutable/i);
			expect(await boundary.query("PRAGMA foreign_key_check")).toEqual([]);
			await boundary.close();
			boundary = new DatabaseBoundary(databasePath);
			await expect(new MigrationRunner(upgraded, clock).migrate(boundary)).resolves.toMatchObject({ noOp: true });
			expect(await boundary.query("SELECT id, published_at FROM collaborations ORDER BY id")).toEqual([
				{ id: cardId("1"), published_at: NOW - 500 },
				{ id: cardId("2"), published_at: null },
				{ id: cardId("3"), published_at: NOW - 300 },
			]);
			expect(await boundary.query("SELECT id, profile_id FROM profile_platforms")).toEqual([{ id: platformId(100), profile_id: profileId(100) }]);
			expect(await boundary.query("SELECT collaboration_id, message_id, status FROM channel_publications ORDER BY collaboration_id")).toEqual([
				{ collaboration_id: cardId("1"), message_id: 41, status: "published" },
				{ collaboration_id: cardId("2"), message_id: null, status: "failed" },
				{ collaboration_id: cardId("3"), message_id: 42, status: "published" },
			]);
		} finally {
			await boundary.close();
			await rm(directory, { recursive: true, force: true });
		}
	});

	it("combines filters with AND and advances by published_at plus id without repeats", async () => {
		await withBrowseDatabase(async (boundary, clock) => {
			await seedBrowseFixture(boundary);
			const service = browseService(boundary, clock);

			const noProfile = await service.openFeed("999");
			expect(noProfile.card?.id).toBe(cardId("f"));

			const first = await service.openFeed("200");
			expect(first.card?.id).toBe(cardId("f"));
			const second = await service.next("200", first.session);
			expect(second.card?.id).toBe(cardId("e"));
			await expect(service.next("200", first.session)).rejects.toBeInstanceOf(BrowseSessionStaleError);

			const target = await service.changeFilter("200", second.session, "target_profile_type", "telegram_channel");
			expect(target.card?.id).toBe(cardId("e"));
			expect(target.session.filters).toEqual({ targetProfileType: "telegram_channel", format: null, topic: null });
			const impossibleAnd = await service.changeFilter("200", target.session, "format", "joint_content");
			expect(impossibleAnd.card).toBeNull();
			const anyType = await service.changeFilter("200", impossibleAnd.session, "target_profile_type", null);
			expect(anyType.card?.id).toBe(cardId("d"));
			const withTopic = await service.changeFilter("200", anyType.session, "topic", "food");
			expect(withTopic.card?.id).toBe(cardId("d"));
			const reset = await service.reset("200", withTopic.session);
			expect(reset.card?.id).toBe(cardId("d"));
			expect(reset.session.filters).toEqual(withTopic.session.filters);

			const exactDeadline = await service.openFeed("999");
			expect(exactDeadline.card?.id).toBe(cardId("e"));
			const third = await service.next("999", exactDeadline.session);
			expect(third.card?.id).toBe(cardId("d"));
			const boundaryCard = await service.next("999", third.session);
			expect(boundaryCard.card?.id).toBe(cardId("a"));
		});
	});

	it("excludes the viewer's own cards without hiding them from other users", async () => {
		await withBrowseDatabase(async (boundary, clock) => {
			await seedBrowseFixture(boundary);
			await seedUser(boundary, "998");
			const service = browseService(boundary, clock);

			const authorFeed = await service.openFeed("200");
			const authorFiltered = await service.changeFilter("200", authorFeed.session, "format", "mutual_pr");
			expect(authorFiltered.card).toBeNull();

			const outsiderFeed = await service.openFeed("998");
			const outsiderFiltered = await service.changeFilter("998", outsiderFeed.session, "format", "mutual_pr");
			expect(outsiderFiltered.card?.id).toBe(cardId("9"));
		});
	});

	it("revalidates a selected row and skips it after a concurrent visibility transition", async () => {
		await withBrowseDatabase(async (boundary, clock) => {
			await seedBrowseFixture(boundary);
			const service = browseService(boundary, clock);

			const selected = await service.openFeed("999");
			expect(selected.card?.id).toBe(cardId("f"));
			await boundary.execute(
				"UPDATE collaborations SET status = 'hidden', hidden_from_status = 'published', hidden_at = ?, updated_at = ? WHERE id = ?",
				[NOW, NOW, cardId("f")],
			);

			const revalidated = await service.revalidate(selected);
			expect(revalidated.card?.id).toBe(cardId("e"));
			expect(revalidated.session.revision).toBeGreaterThan(selected.session.revision);
		});
	});

	it("persists the current cursor across restart and resets filters after 24 hours of inactivity", async () => {
		const directory = await mkdtemp(join(tmpdir(), "collaboration-s3-02-restart-"));
		const databasePath = join(directory, "app.sqlite");
		const clock = new FakeClock(NOW);
		let boundary = new DatabaseBoundary(databasePath);
		try {
			await new MigrationRunner(await MigrationSource.fromDirectory(migrationsPath), clock).migrate(boundary);
			await seedBrowseFixture(boundary);
			await seedUser(boundary, "998");
			let service = browseService(boundary, clock);
			const first = await service.openFeed("999");
			const filtered = await service.changeFilter("999", first.session, "topic", "food");
			expect(filtered.card?.id).toBe(cardId("e"));
			const abandoned = await service.openFeed("998");
			await service.changeFilter("998", abandoned.session, "format", "joint_content");
			await boundary.close();

			boundary = new DatabaseBoundary(databasePath);
			service = browseService(boundary, clock);
			const resumed = await service.openFeed("999");
			expect(resumed.card?.id).toBe(cardId("d"));
			expect(resumed.session.filters.topic).toBe("food");
			const previousExpiry = resumed.session.expiresAt;
			clock.advanceBy(BROWSE_SESSION_TTL_MS);
			const fresh = await service.openFeed("999");
			expect(fresh.card?.id).toBe(cardId("f"));
			expect(fresh.session.filters).toEqual({ targetProfileType: null, format: null, topic: null });
			expect(fresh.session.generation).not.toBe(resumed.session.generation);
			expect(fresh.session.expiresAt).toBe(clock.now().getTime() + BROWSE_SESSION_TTL_MS);
			expect(fresh.session.expiresAt).toBeGreaterThan(previousExpiry);
			expect(await boundary.query("SELECT telegram_user_id FROM browse_sessions WHERE telegram_user_id = '998'")).toEqual([]);

			clock.set(NOW);
			const recreated = await service.openFeed("998");
			expect(recreated.session.revision).toBe(abandoned.session.revision);
			expect(recreated.session.generation).not.toBe(abandoned.session.generation);
			const recreatedRow = await boundary.query("SELECT generation, cursor_collaboration_id, revision FROM browse_sessions WHERE telegram_user_id = '998'");
			await expect(service.next("998", abandoned.session)).rejects.toBeInstanceOf(BrowseSessionStaleError);
			expect(await boundary.query("SELECT generation, cursor_collaboration_id, revision FROM browse_sessions WHERE telegram_user_id = '998'")).toEqual(recreatedRow);
		} finally {
			await boundary.close();
			await rm(directory, { recursive: true, force: true });
		}
	});

	it("opens strict public tokens without touching browse state and classifies unavailable cards safely", async () => {
		await withBrowseDatabase(async (boundary, clock) => {
			await seedBrowseFixture(boundary);
			await insertBrowseCard(boundary, { id: cardId("8"), token: TOKENS.expired, authorProfileId: profileId(100), status: "expired", publishedAt: NOW - 10 });
			await insertBrowseCard(boundary, { id: cardId("7"), token: TOKENS.matched, authorProfileId: profileId(100), status: "matched", publishedAt: NOW - 10 });
			await insertBrowseCard(boundary, { id: cardId("6"), token: TOKENS.completed, authorProfileId: profileId(100), status: "completed", publishedAt: NOW - 10 });
			await insertBrowseCard(boundary, { id: cardId("5"), token: TOKENS.cancelled, authorProfileId: profileId(100), status: "cancelled", publishedAt: NOW - 10 });
			await insertBrowseCard(boundary, { id: cardId("4"), token: TOKENS.publishing, authorProfileId: profileId(100), status: "publishing", publishedAt: null });
			await insertBrowseCard(boundary, { id: cardId("3"), token: TOKENS.failed, authorProfileId: profileId(100), status: "publication_failed", publishedAt: null });
			const service = browseService(boundary, clock);

			expect(await service.openDeepLink("999", `c_${TOKENS.first}`)).toMatchObject({ kind: "card", actionable: true, card: { id: cardId("f") } });
			expect(await service.openDeepLink("100", `c_${TOKENS.first}`)).toMatchObject({ kind: "card", actionable: false });
			expect(await service.openDeepLink("999", `c_${TOKENS.past}`)).toEqual({ kind: "expired" });
			expect(await service.openDeepLink("999", `c_${TOKENS.expired}`)).toEqual({ kind: "expired" });
			for (const token of [TOKENS.matched, TOKENS.completed, TOKENS.cancelled]) {
				expect(await service.openDeepLink("999", `c_${token}`)).toEqual({ kind: "closed" });
			}
			for (const parameter of [`c_${TOKENS.hidden}`, `c_${TOKENS.publishing}`, `c_${TOKENS.failed}`, "c_short", `c_${"Z".repeat(22)}`]) {
				expect(await service.openDeepLink("999", parameter)).toEqual({ kind: "unavailable" });
			}
			expect(await boundary.query("SELECT telegram_user_id FROM browse_sessions WHERE telegram_user_id = '999'")).toEqual([]);
		});
	});
});

async function withBrowseDatabase(work: (boundary: DatabaseBoundary, clock: FakeClock) => Promise<void>): Promise<void> {
	const directory = await mkdtemp(join(tmpdir(), "collaboration-s3-02-browse-"));
	const boundary = new DatabaseBoundary(join(directory, "app.sqlite"));
	const clock = new FakeClock(NOW);
	try {
		await new MigrationRunner(await MigrationSource.fromDirectory(migrationsPath), clock).migrate(boundary);
		await work(boundary, clock);
	} finally {
		await boundary.close();
		await rm(directory, { recursive: true, force: true });
	}
}

function browseService(boundary: DatabaseBoundary, clock: FakeClock): CollaborationBrowseService {
	return new CollaborationBrowseService(
		new SqliteCollaborationBrowseRepository(boundary),
		new DatabaseBoundaryTransactionRunner(boundary),
		clock,
	);
}

async function seedBrowseFixture(boundary: DatabaseBoundary): Promise<void> {
	for (const userId of ["100", "101", "102", "200"]) await seedProfile(boundary, userId, profileId(Number(userId)));
	await seedUser(boundary, "999");
	await insertBrowseCard(boundary, { id: cardId("9"), token: TOKENS.own, authorProfileId: profileId(200), status: "published", publishedAt: NOW + 100, format: "mutual_pr", title: "Own card" });
	await insertBrowseCard(boundary, { id: cardId("c"), token: TOKENS.hidden, authorProfileId: profileId(100), status: "hidden", publishedAt: NOW + 600, title: "Hidden newest" });
	await insertBrowseCard(boundary, { id: cardId("b"), token: TOKENS.past, authorProfileId: profileId(101), status: "published", publishedAt: NOW + 600, deadlineAt: NOW - 1, title: "Past newest" });
	await insertBrowseCard(boundary, { id: cardId("f"), token: TOKENS.first, authorProfileId: profileId(100), status: "published", publishedAt: NOW + 400, targetProfileType: "blogger", format: "barter", topics: ["city"], title: "First eligible" });
	await insertBrowseCard(boundary, { id: cardId("e"), token: TOKENS.second, authorProfileId: profileId(101), status: "published", publishedAt: NOW + 400, targetProfileType: "any", format: "barter", topics: ["city", "food"], title: "Second eligible" });
	await insertBrowseCard(boundary, { id: cardId("d"), token: TOKENS.third, authorProfileId: profileId(102), status: "published", publishedAt: NOW + 300, targetProfileType: "blogger", format: "joint_content", topics: ["food"], title: "Third eligible" });
	await insertBrowseCard(boundary, { id: cardId("a"), token: TOKENS.exact, authorProfileId: profileId(102), status: "published", publishedAt: NOW + 200, deadlineAt: NOW, targetProfileType: "venue_or_brand", format: "event", topics: ["events"], title: "Exact deadline" });
}

async function seedUser(boundary: DatabaseBoundary, telegramUserId: string): Promise<void> {
	await boundary.execute(
		"INSERT INTO telegram_users (telegram_user_id, username, display_name, status, blocked_at, created_at, updated_at) VALUES (?, NULL, ?, 'active', NULL, ?, ?)",
		[telegramUserId, `User ${telegramUserId}`, NOW, NOW],
	);
}

async function seedProfile(boundary: DatabaseBoundary, telegramUserId: string, id: string): Promise<void> {
	await seedUser(boundary, telegramUserId);
	await boundary.execute(
		"INSERT INTO profiles (id, telegram_user_id, type, display_name, city_code, status, created_at, updated_at, description) VALUES (?, ?, 'blogger', ?, 'ekaterinburg', 'active', ?, ?, NULL)",
		[id, telegramUserId, `Profile ${telegramUserId}`, NOW, NOW],
	);
	await boundary.execute(
		"INSERT INTO profile_platforms (id, profile_id, platform_type, url, title, username, telegram_chat_id, audience_size) VALUES (?, ?, 'website', ?, NULL, NULL, NULL, NULL)",
		[platformId(Number(telegramUserId)), id, `https://example.com/${telegramUserId}`],
	);
}

interface CardFixture {
	readonly id: string;
	readonly token: string;
	readonly authorProfileId: string;
	readonly status: "published" | "publication_failed" | "publishing" | "matched" | "completed" | "cancelled" | "expired" | "hidden";
	readonly publishedAt?: number | null;
	readonly deadlineAt?: number;
	readonly targetProfileType?: "blogger" | "telegram_channel" | "venue_or_brand" | "any";
	readonly format?: "advertising_integration" | "barter" | "joint_giveaway" | "joint_content" | "mutual_pr" | "event" | "other";
	readonly topics?: readonly ("lifestyle" | "food" | "beauty" | "travel" | "city" | "events" | "family" | "sport" | "business" | "other")[];
	readonly title?: string;
}

async function insertLegacyCard(boundary: DatabaseBoundary, fixture: CardFixture): Promise<void> {
	await boundary.execute(
		"INSERT INTO collaborations (id, public_token, author_profile_id, format, target_profile_type, title, offer_text, expectation_text, slots_total, response_deadline_at, event_date_local, city_code, status, version, projection_revision, created_at, updated_at) VALUES (?, ?, ?, 'barter', 'blogger', ?, 'Useful collaboration offer', 'Reliable partner expected', 2, ?, NULL, 'ekaterinburg', ?, 1, 0, ?, ?)",
		[fixture.id, fixture.token, fixture.authorProfileId, fixture.title ?? "Legacy card", fixture.deadlineAt ?? NOW + 86_400_000, fixture.status, NOW - 1000, NOW - 1000],
	);
	await boundary.execute("INSERT INTO collaboration_topics (collaboration_id, topic) VALUES (?, 'city')", [fixture.id]);
}

async function insertBrowseCard(boundary: DatabaseBoundary, fixture: CardFixture): Promise<void> {
	await boundary.execute(
		"INSERT INTO collaborations (id, public_token, author_profile_id, format, target_profile_type, title, offer_text, expectation_text, slots_total, response_deadline_at, event_date_local, city_code, status, version, projection_revision, created_at, updated_at, published_at, hidden_from_status, hidden_at) VALUES (?, ?, ?, ?, ?, ?, 'Useful collaboration offer', 'Reliable partner expected', 2, ?, NULL, 'ekaterinburg', ?, 1, 0, ?, ?, ?, ?, ?)",
		[
			fixture.id,
			fixture.token,
			fixture.authorProfileId,
			fixture.format ?? "barter",
			fixture.targetProfileType ?? "blogger",
			fixture.title ?? "Browse card",
			fixture.deadlineAt ?? NOW + 86_400_000,
			fixture.status,
			NOW - 1000,
			NOW - 1000,
			fixture.publishedAt ?? null,
			fixture.status === "hidden" ? "published" : null,
			fixture.status === "hidden" ? NOW - 1000 : null,
		],
	);
	for (const topic of fixture.topics ?? ["city"]) await boundary.execute("INSERT INTO collaboration_topics (collaboration_id, topic) VALUES (?, ?)", [fixture.id, topic]);
}

function profileId(value: number): string { return `${value.toString(16).padStart(8, "0")}-0000-4000-8000-000000000001`; }
function platformId(value: number): string { return `${value.toString(16).padStart(8, "0")}-0000-4000-8000-000000000002`; }
function cardId(prefix: string): string { return `${prefix.padStart(8, prefix)}-0000-4000-8000-000000000003`; }
