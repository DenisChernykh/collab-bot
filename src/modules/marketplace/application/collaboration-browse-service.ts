import { randomBytes } from "node:crypto";

import type { Clock } from "../../../shared/application/ports/clock.js";
import type { TransactionRunner } from "../../../shared/application/ports/transaction-runner.js";
import type {
	BrowseCollaborationRecord,
	BrowseFilters,
	BrowseSessionIdentity,
	BrowseSessionRecord,
	CollaborationBrowseRepository,
} from "./ports/collaboration-browse-repository.js";
import {
	parseCollaborationFormat,
	parseProfileType,
	parseTopic,
	type CollaborationFormat,
	type ProfileType,
	type Topic,
} from "../../../shared/domain/value-objects/enums.js";

export const BROWSE_SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const BROWSE_SESSION_CLEANUP_LIMIT = 100;

export type BrowseFilterDimension = "target_profile_type" | "format" | "topic";
export type BrowseFilterValue = ProfileType | CollaborationFormat | Topic | null;

export interface BrowsePage {
	readonly card: BrowseCollaborationRecord | null;
	readonly session: BrowseSessionRecord;
}

export type DeepLinkBrowseResult =
	| { readonly kind: "card"; readonly card: BrowseCollaborationRecord; readonly actionable: boolean }
	| { readonly kind: "expired" }
	| { readonly kind: "closed" }
	| { readonly kind: "unavailable" };

export class BrowseSessionStaleError extends Error {
	constructor() {
		super("browse session is stale");
		this.name = "BrowseSessionStaleError";
	}
}

export class CollaborationBrowseService {
	constructor(
		private readonly repository: CollaborationBrowseRepository,
		private readonly transactions: TransactionRunner,
		private readonly clock: Clock,
	) {}

	openFeed(telegramUserId: string): Promise<BrowsePage> {
		return this.transactions.withTransaction(async () => {
			const now = clockMilliseconds(this.clock);
			const stored = await this.repository.findSession(telegramUserId);
			await this.repository.deleteExpiredSessions(now, BROWSE_SESSION_CLEANUP_LIMIT);
			const current = stored !== undefined && stored.expiresAt > now ? stored : freshSession(telegramUserId, now);
			return this.selectAndSave(current, now);
		});
	}

	async revalidate(page: BrowsePage): Promise<BrowsePage> {
		const selected = page.card;
		if (selected === null) return page;
		const result = await this.transactions.withTransaction(async () => {
			const now = clockMilliseconds(this.clock);
			const current = await this.requireCurrent(page.session.telegramUserId, page.session, now);
			if (current === undefined) return undefined;
			const card = await this.repository.findEligibleById({
				collaborationId: selected.id,
				viewerTelegramUserId: current.telegramUserId,
				now,
				filters: current.filters,
			});
			return card === undefined ? this.selectNextConfirmed(current, now) : { card, session: current };
		});
		if (result === undefined) throw new BrowseSessionStaleError();
		return result;
	}

	async next(telegramUserId: string, expected: BrowseSessionIdentity): Promise<BrowsePage> {
		const result = await this.transactions.withTransaction(async () => {
			const now = clockMilliseconds(this.clock);
			const current = await this.requireCurrent(telegramUserId, expected, now);
			if (current === undefined) return undefined;
			return this.selectAndSave(current, now);
		});
		if (result === undefined) throw new BrowseSessionStaleError();
		return result;
	}

	changeFilter(
		telegramUserId: string,
		expected: BrowseSessionIdentity,
		dimension: BrowseFilterDimension,
		value: BrowseFilterValue,
	): Promise<BrowsePage> {
		const normalizedValue = normalizeFilterValue(dimension, value);
		return this.changeFilterWithinTransaction(telegramUserId, expected, dimension, normalizedValue);
	}

	private async changeFilterWithinTransaction(
		telegramUserId: string,
		expected: BrowseSessionIdentity,
		dimension: BrowseFilterDimension,
		value: BrowseFilterValue,
	): Promise<BrowsePage> {
		const result = await this.transactions.withTransaction(async () => {
			const now = clockMilliseconds(this.clock);
			const current = await this.requireCurrent(telegramUserId, expected, now);
			if (current === undefined) return undefined;
			const filters = changeFilter(current.filters, dimension, value);
			return this.selectAndSave({ ...current, filters, cursor: null }, now);
		});
		if (result === undefined) throw new BrowseSessionStaleError();
		return result;
	}

	async reset(telegramUserId: string, expected: BrowseSessionIdentity): Promise<BrowsePage> {
		const result = await this.transactions.withTransaction(async () => {
			const now = clockMilliseconds(this.clock);
			const current = await this.requireCurrent(telegramUserId, expected, now);
			if (current === undefined) return undefined;
			return this.selectAndSave({ ...current, cursor: null }, now);
		});
		if (result === undefined) throw new BrowseSessionStaleError();
		return result;
	}

	async touch(telegramUserId: string, expected: BrowseSessionIdentity): Promise<BrowseSessionRecord> {
		const result = await this.transactions.withTransaction(async () => {
			const now = clockMilliseconds(this.clock);
			const current = await this.requireCurrent(telegramUserId, expected, now);
			if (current === undefined) return undefined;
			const session: BrowseSessionRecord = {
				...current,
				revision: current.revision + 1,
				expiresAt: now + BROWSE_SESSION_TTL_MS,
				updatedAt: now,
			};
			await this.repository.saveSession(session);
			return session;
		});
		if (result === undefined) throw new BrowseSessionStaleError();
		return result;
	}

	async openDeepLink(viewerTelegramUserId: string, startParameter: string): Promise<DeepLinkBrowseResult> {
		const match = /^c_([A-Za-z0-9_-]{22})$/.exec(startParameter);
		if (match?.[1] === undefined) return { kind: "unavailable" };
		const card = await this.repository.findByPublicToken(match[1]);
		if (card === undefined) return { kind: "unavailable" };
		const now = clockMilliseconds(this.clock);
		if (card.status === "published") {
			if (card.publishedAt === null || card.responseDeadlineAt === null) return { kind: "unavailable" };
			if (card.responseDeadlineAt < now) return { kind: "expired" };
			return { kind: "card", card, actionable: card.authorTelegramUserId !== viewerTelegramUserId };
		}
		if (card.status === "expired") return { kind: "expired" };
		if (card.status === "matched" || card.status === "completed" || card.status === "cancelled") return { kind: "closed" };
		return { kind: "unavailable" };
	}

	private async requireCurrent(telegramUserId: string, expected: BrowseSessionIdentity, now: number): Promise<BrowseSessionRecord | undefined> {
		if (!/^[0-9a-f]{16}$/.test(expected.generation) || !Number.isSafeInteger(expected.revision) || expected.revision < 0) return undefined;
		const current = await this.repository.findSession(telegramUserId);
		if (current === undefined || current.expiresAt <= now || current.generation !== expected.generation || current.revision !== expected.revision) return undefined;
		return current;
	}

	private async selectNextConfirmed(current: BrowseSessionRecord, now: number): Promise<BrowsePage> {
		let page = await this.selectAndSave(current, now);
		while (page.card !== null) {
			const card = await this.repository.findEligibleById({
				collaborationId: page.card.id,
				viewerTelegramUserId: page.session.telegramUserId,
				now,
				filters: page.session.filters,
			});
			if (card !== undefined) return { card, session: page.session };
			page = await this.selectAndSave(page.session, now);
		}
		return page;
	}

	private async selectAndSave(current: BrowseSessionRecord, now: number): Promise<BrowsePage> {
		const card = await this.repository.findNextEligible({
			viewerTelegramUserId: current.telegramUserId,
			now,
			filters: current.filters,
			cursor: current.cursor,
		});
		const session: BrowseSessionRecord = {
			...current,
			cursor: card?.publishedAt === null || card?.publishedAt === undefined
				? current.cursor
				: { publishedAt: card.publishedAt, collaborationId: card.id },
			revision: current.revision + 1,
			expiresAt: now + BROWSE_SESSION_TTL_MS,
			updatedAt: now,
		};
		await this.repository.saveSession(session);
		return { card: card ?? null, session };
	}
}

function freshSession(telegramUserId: string, now: number): BrowseSessionRecord {
	return {
		telegramUserId,
		generation: randomBytes(8).toString("hex"),
		filters: { targetProfileType: null, format: null, topic: null },
		cursor: null,
		revision: 0,
		expiresAt: now + BROWSE_SESSION_TTL_MS,
		updatedAt: now,
	};
}

function changeFilter(filters: BrowseFilters, dimension: BrowseFilterDimension, value: BrowseFilterValue): BrowseFilters {
	switch (dimension) {
		case "target_profile_type":
			return { ...filters, targetProfileType: value as ProfileType | null };
		case "format":
			return { ...filters, format: value as CollaborationFormat | null };
		case "topic":
			return { ...filters, topic: value as Topic | null };
	}
}

function normalizeFilterValue(dimension: BrowseFilterDimension, value: BrowseFilterValue): BrowseFilterValue {
	if (value === null) return null;
	if (dimension === "target_profile_type") return parseProfileType(value);
	if (dimension === "format") return parseCollaborationFormat(value);
	return parseTopic(value);
}

function clockMilliseconds(clock: Clock): number {
	const value = clock.now().getTime();
	if (!Number.isSafeInteger(value) || value < 0) throw new RangeError("browse clock returned an unsafe timestamp");
	return value;
}
