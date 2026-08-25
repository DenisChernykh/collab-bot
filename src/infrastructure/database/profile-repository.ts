import { generateUuid } from "../crypto/tokens.js";
import type { ProfileRepository } from "../../application/ports/profile-repository.js";
import type {
	ProfileInput,
	ProfilePlatformRecord,
	ProfileRecord,
	PublicProfileRecord,
} from "../../domain/profiles/profile.js";
import {
	parsePlatformType,
	parseProfileType,
	parseTopic,
	type Topic,
} from "../../domain/value-objects/enums.js";
import type { DatabaseBoundary } from "./database-boundary.js";

interface ProfileRow {
	id?: unknown;
	telegram_user_id?: unknown;
	type?: unknown;
	display_name?: unknown;
	description?: unknown;
	city_code?: unknown;
	status?: unknown;
	created_at?: unknown;
	updated_at?: unknown;
}

interface PlatformRow {
	id?: unknown;
	profile_id?: unknown;
	platform_type?: unknown;
	url?: unknown;
	title?: unknown;
	username?: unknown;
	telegram_chat_id?: unknown;
	audience_size?: unknown;
}

interface TopicRow {
	topic?: unknown;
}

export class SqliteProfileRepository implements ProfileRepository {
	constructor(private readonly boundary: DatabaseBoundary) {}

	async findActiveByTelegramUserId(telegramUserId: string): Promise<ProfileRecord | undefined> {
		const rows = await this.boundary.query<ProfileRow>(
			"SELECT id, telegram_user_id, type, display_name, description, city_code, status, created_at, updated_at FROM profiles WHERE telegram_user_id = ? AND status = 'active'",
			[telegramUserId],
		);
		const row = rows[0];
		return row === undefined ? undefined : this.readAggregate(row);
	}

	async findPublicById(profileId: string): Promise<PublicProfileRecord | undefined> {
		const rows = await this.boundary.query<ProfileRow>(
			"SELECT id, telegram_user_id, type, display_name, description, city_code, status, created_at, updated_at FROM profiles WHERE id = ? AND status = 'active'",
			[profileId],
		);
		const row = rows[0];
		if (row === undefined) return undefined;
		const aggregate = await this.readAggregate(row);
		return toPublicProfile(aggregate);
	}

	async create(telegramUserId: string, input: ProfileInput, now: number): Promise<ProfileRecord> {
		const id = generateUuid();
		await this.boundary.execute(
			"INSERT INTO profiles (id, telegram_user_id, type, display_name, description, city_code, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?)",
			[id, telegramUserId, input.type, input.displayName, input.description, "ekaterinburg", now, now],
		);
		await this.replaceChildren(id, input);
		const created = await this.findActiveByTelegramUserId(telegramUserId);
		if (created === undefined) throw new Error("created profile could not be reloaded");
		return created;
	}

	async update(telegramUserId: string, input: ProfileInput, now: number): Promise<ProfileRecord> {
		const existing = await this.findActiveByTelegramUserId(telegramUserId);
		if (existing === undefined) throw new Error("active profile could not be reloaded");
		await this.boundary.execute(
			"UPDATE profiles SET type = ?, display_name = ?, description = ?, city_code = ?, updated_at = ? WHERE id = ? AND status = 'active'",
			[input.type, input.displayName, input.description, "ekaterinburg", now, existing.id],
		);
		await this.replaceChildren(existing.id, input);
		const updated = await this.findActiveByTelegramUserId(telegramUserId);
		if (updated === undefined) throw new Error("updated profile could not be reloaded");
		return updated;
	}

	private async replaceChildren(profileId: string, input: ProfileInput): Promise<void> {
		await this.boundary.execute("DELETE FROM profile_platforms WHERE profile_id = ?", [profileId]);
		await this.boundary.execute("DELETE FROM profile_topics WHERE profile_id = ?", [profileId]);
		for (const platform of input.platforms) {
			await this.boundary.execute(
				"INSERT INTO profile_platforms (id, profile_id, platform_type, url, title, username, telegram_chat_id, audience_size) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
				[generateUuid(), profileId, platform.platformType, platform.url, platform.title ?? null, platform.username ?? null, platform.telegramChatId ?? null, platform.audienceSize ?? null],
			);
		}
		for (const topic of input.topics) {
			await this.boundary.execute(
				"INSERT INTO profile_topics (profile_id, topic) VALUES (?, ?)",
				[profileId, topic],
			);
		}
	}

	private async readChildren(profileId: string): Promise<{ platforms: readonly ProfilePlatformRecord[]; topics: readonly Topic[] }> {
		const platformRows = await this.boundary.query<PlatformRow>(
			"SELECT id, profile_id, platform_type, url, title, username, telegram_chat_id, audience_size FROM profile_platforms WHERE profile_id = ? ORDER BY id",
			[profileId],
		);
		const topicRows = await this.boundary.query<TopicRow>(
			"SELECT topic FROM profile_topics WHERE profile_id = ? ORDER BY topic",
			[profileId],
		);
		const platforms = platformRows.map(mapPlatformRow);
		const topics = topicRows.map((row) => parseTopic(row.topic));
		return { platforms, topics };
	}

	private async readAggregate(row: ProfileRow): Promise<ProfileRecord> {
		const base = readBase(row);
		const children = await this.readChildren(base.id);
		return { ...base, ...children };
	}
}

function readBase(row: ProfileRow): ProfileRecord {
	if (
		typeof row.id !== "string" || typeof row.telegram_user_id !== "string" ||
		typeof row.type !== "string" || typeof row.display_name !== "string" ||
		typeof row.description !== "string" || row.city_code !== "ekaterinburg" ||
		(row.status !== "active" && row.status !== "archived") ||
		!Number.isSafeInteger(row.created_at) || !Number.isSafeInteger(row.updated_at)
	) {
		throw new Error("profile row is corrupt");
	}
	const type = parseProfileType(row.type);
	return {
		id: row.id,
		telegramUserId: row.telegram_user_id,
		type,
		displayName: row.display_name,
		description: row.description,
		cityCode: "ekaterinburg",
		status: row.status,
		createdAt: row.created_at as number,
		updatedAt: row.updated_at as number,
		topics: [],
		platforms: [],
	};
}

function mapPlatformRow(row: PlatformRow): ProfilePlatformRecord {
	if (
		typeof row.id !== "string" || typeof row.platform_type !== "string" || typeof row.url !== "string" ||
		(row.title !== null && typeof row.title !== "string") || (row.username !== null && typeof row.username !== "string") ||
		(row.telegram_chat_id !== null && typeof row.telegram_chat_id !== "string") ||
		(row.audience_size !== null && !Number.isSafeInteger(row.audience_size))
	) {
		throw new Error("profile platform row is corrupt");
	}
	const platformType = parsePlatformType(row.platform_type);
	const optional: {
		title?: string;
		username?: string;
		telegramChatId?: string;
		audienceSize?: number;
	} = {};
	if (row.title !== null) optional.title = row.title;
	if (row.username !== null) optional.username = row.username;
	if (row.telegram_chat_id !== null) optional.telegramChatId = row.telegram_chat_id;
	if (row.audience_size !== null) optional.audienceSize = row.audience_size as number;
	return {
		id: row.id,
		platformType,
		url: row.url,
		...optional,
	};
}

function toPublicProfile(profile: ProfileRecord): PublicProfileRecord {
	return {
		id: profile.id,
		type: profile.type,
		displayName: profile.displayName,
		description: profile.description,
		cityCode: profile.cityCode,
		status: profile.status,
		createdAt: profile.createdAt,
		updatedAt: profile.updatedAt,
		topics: profile.topics,
		platforms: profile.platforms,
	};
}
