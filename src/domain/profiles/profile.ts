import {
	DomainValidationError,
	parsePlatformType,
	parseProfileType,
	parseTopic,
	type PlatformType,
	type ProfileType,
	type Topic,
} from "../value-objects/enums.js";

export const PROFILE_CITY = "ekaterinburg" as const;

export interface ProfilePlatformInput {
	readonly platformType: PlatformType;
	readonly url: string;
	readonly title?: string;
	readonly username?: string;
	readonly telegramChatId?: string;
	readonly audienceSize?: number;
}

export interface ProfileInput {
	readonly type: ProfileType;
	readonly displayName: string;
	readonly description: string;
	readonly topics: readonly Topic[];
	readonly platforms: readonly ProfilePlatformInput[];
}

export interface ProfilePlatformRecord extends ProfilePlatformInput {
	readonly id: string;
}

export interface ProfileRecord {
	readonly id: string;
	readonly telegramUserId: string;
	readonly type: ProfileType;
	readonly displayName: string;
	readonly description: string;
	readonly cityCode: typeof PROFILE_CITY;
	readonly status: "active" | "archived";
	readonly createdAt: number;
	readonly updatedAt: number;
	readonly topics: readonly Topic[];
	readonly platforms: readonly ProfilePlatformRecord[];
}

export type PublicProfileRecord = Omit<ProfileRecord, "telegramUserId">;

export function validateProfileInput(input: ProfileInput): ProfileInput {
	const type = parseProfileType(input.type);
	const displayName = requiredText(input.displayName, 2, 100, "display name");
	const description = requiredText(input.description, 10, 500, "description");
	if (!Array.isArray(input.topics) || input.topics.length < 1 || input.topics.length > 3) {
		throw new DomainValidationError("profile topics must contain between one and three values");
	}
	const topics = input.topics.map((topic) => parseTopic(topic));
	if (new Set(topics).size !== topics.length) {
		throw new DomainValidationError("profile topics must be unique");
	}
	if (!Array.isArray(input.platforms) || input.platforms.length < 1) {
		throw new DomainValidationError("profile requires at least one public platform");
	}
	const platforms = input.platforms.map(validatePlatform);
	return { type, displayName, description, topics, platforms };
}

function validatePlatform(input: ProfilePlatformInput): ProfilePlatformInput {
	const platformType = parsePlatformType(input.platformType);
	const url = requiredText(input.url, 1, 2_048, "platform URL");
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		throw new DomainValidationError("platform URL must be absolute https URL");
	}
	if (parsed.protocol !== "https:" || parsed.username !== "" || parsed.password !== "") {
		throw new DomainValidationError("platform URL must be absolute https URL without credentials");
	}
	const title = input.title === undefined ? undefined : requiredText(input.title, 1, 100, "platform title");
	const username = input.username === undefined ? undefined : normalizeUsername(input.username);
	const telegramChatId = input.telegramChatId === undefined ? undefined : normalizeTelegramChatId(input.telegramChatId);
	if (input.audienceSize !== undefined && (!Number.isSafeInteger(input.audienceSize) || input.audienceSize < 0)) {
		throw new DomainValidationError("audience size must be a non-negative safe integer");
	}
	if (platformType === "telegram") {
		if (parsed.hostname.toLowerCase() !== "t.me" || !/^\/[A-Za-z0-9_]{5,32}\/?$/.test(parsed.pathname)) {
			throw new DomainValidationError("telegram platform URL must be a public t.me username link");
		}
		if (telegramChatId !== undefined && !telegramChatId.startsWith("-")) {
			throw new DomainValidationError("telegram chat ID must identify a channel");
		}
	}
	return { platformType, url, ...(title === undefined ? {} : { title }), ...(username === undefined ? {} : { username }), ...(telegramChatId === undefined ? {} : { telegramChatId }), ...(input.audienceSize === undefined ? {} : { audienceSize: input.audienceSize }) };
}

function normalizeUsername(value: string): string {
	const normalized = value.trim().replace(/^@+/, "");
	if (!/^[A-Za-z0-9_]{1,32}$/.test(normalized)) {
		throw new DomainValidationError("platform username is invalid");
	}
	return normalized;
}

function normalizeTelegramChatId(value: string): string {
	const normalized = value.trim();
	if (!/^-?\d+$/.test(normalized)) {
		throw new DomainValidationError("telegram chat ID must be decimal string");
	}
	return normalized;
}

function requiredText(value: string, min: number, max: number, name: string): string {
	if (typeof value !== "string" || value.includes("\u0000")) {
		throw new DomainValidationError(`${name} is invalid`);
	}
	const normalized = value.trim();
	if (normalized.length < min || normalized.length > max) {
		throw new DomainValidationError(`${name} length is invalid`);
	}
	return normalized;
}
