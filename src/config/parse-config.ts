const REQUIRED_KEYS = [
	"BOT_TOKEN",
	"EXPECTED_BOT_ID",
	"EXPECTED_BOT_USERNAME",
	"ADMIN_TELEGRAM_IDS",
	"SHOWCASE_CHANNEL_ID",
	"SHOWCASE_CHANNEL_USERNAME",
	"DATABASE_PATH",
	"LOG_LEVEL",
	"TIME_ZONE",
	"HELP_CONTACT",
] as const;

type RequiredKey = (typeof REQUIRED_KEYS)[number];

export type ConfigInput = Record<string, string | undefined>;

export interface AppConfig {
	readonly mfmFeatureEnabled?: boolean;
	readonly botToken: string;
	readonly expectedBotId: string;
	readonly expectedBotUsername: string;
	readonly adminTelegramIds: readonly string[];
	readonly showcaseChannelId: string;
	readonly showcaseChannelUsername: string;
	readonly databasePath: string;
	readonly logLevel: string;
	readonly timeZone: "Asia/Yekaterinburg";
	readonly helpContact: string;
}

export interface ConfigWarning {
	readonly code: "unknown_key";
	readonly key: string;
}

export interface ConfigIssue {
	readonly code: "missing" | "empty" | "invalid" | "duplicate";
	readonly key: string;
	readonly message: string;
}

export class ConfigValidationError extends Error {
	readonly issues: readonly ConfigIssue[];

	constructor(issues: readonly ConfigIssue[]) {
		super(issues.map((issue) => `${issue.key}: ${issue.message}`).join("; "));
		this.name = "ConfigValidationError";
		this.issues = issues;
	}
}

export interface ParseConfigResult {
	readonly config: AppConfig;
	readonly warnings: readonly ConfigWarning[];
}

const DECIMAL_ID = /^-?\d+$/;

function requiredValue(
	input: ConfigInput,
	key: RequiredKey,
	issues: ConfigIssue[],
): string | undefined {
	const value = input[key];
	if (value === undefined) {
		issues.push({ code: "missing", key, message: "required value is missing" });
		return undefined;
	}

	if (typeof value !== "string" || value.trim() === "") {
		issues.push({ code: "empty", key, message: "required value is empty" });
		return undefined;
	}

	return value.trim();
}

function decimalId(
	value: string | undefined,
	key: RequiredKey,
	issues: ConfigIssue[],
): string | undefined {
	if (value === undefined) {
		return undefined;
	}
	if (!DECIMAL_ID.test(value)) {
		issues.push({ code: "invalid", key, message: "must be a decimal string" });
		return undefined;
	}
	return value;
}

function username(
	value: string | undefined,
	key: RequiredKey,
	issues: ConfigIssue[],
): string | undefined {
	if (value === undefined) {
		return undefined;
	}
	const normalized = value.replace(/^@+/, "");
	if (normalized === "") {
		issues.push({ code: "invalid", key, message: "must contain a username" });
		return undefined;
	}
	return normalized;
}

function adminIds(
	value: string | undefined,
	issues: ConfigIssue[],
): readonly string[] | undefined {
	if (value === undefined) {
		return undefined;
	}

	const ids = value.split(",").map((item) => item.trim());
	if (ids.some((id) => !DECIMAL_ID.test(id))) {
		issues.push({
			code: "invalid",
			key: "ADMIN_TELEGRAM_IDS",
			message: "must be a non-empty comma-separated list of decimal strings",
		});
		return undefined;
	}

	const uniqueIds = new Set(ids);
	if (uniqueIds.size !== ids.length) {
		issues.push({
			code: "duplicate",
			key: "ADMIN_TELEGRAM_IDS",
			message: "contains duplicate admin IDs",
		});
		return undefined;
	}

	return ids;
}

function absoluteNonRootPath(
	value: string | undefined,
	issues: ConfigIssue[],
): string | undefined {
	if (value === undefined) {
		return undefined;
	}
	if (!value.startsWith("/") || value === "/") {
		issues.push({
			code: "invalid",
			key: "DATABASE_PATH",
			message: "must be an absolute non-root path",
		});
		return undefined;
	}
	return value;
}

export function parseConfig(input: ConfigInput): ParseConfigResult {
	const issues: ConfigIssue[] = [];
	const knownKeys = new Set<string>([...REQUIRED_KEYS, "MFM_FEATURE_ENABLED"]);
	const warnings = Object.keys(input)
		.filter((key) => !knownKeys.has(key))
		.sort()
		.map((key): ConfigWarning => ({ code: "unknown_key", key }));

	const botToken = requiredValue(input, "BOT_TOKEN", issues);
	const expectedBotId = decimalId(
		requiredValue(input, "EXPECTED_BOT_ID", issues),
		"EXPECTED_BOT_ID",
		issues,
	);
	const expectedBotUsername = username(
		requiredValue(input, "EXPECTED_BOT_USERNAME", issues),
		"EXPECTED_BOT_USERNAME",
		issues,
	);
	const adminTelegramIds = adminIds(
		requiredValue(input, "ADMIN_TELEGRAM_IDS", issues),
		issues,
	);
	const showcaseChannelId = decimalId(
		requiredValue(input, "SHOWCASE_CHANNEL_ID", issues),
		"SHOWCASE_CHANNEL_ID",
		issues,
	);
	const showcaseChannelUsername = username(
		requiredValue(input, "SHOWCASE_CHANNEL_USERNAME", issues),
		"SHOWCASE_CHANNEL_USERNAME",
		issues,
	);
	const databasePath = absoluteNonRootPath(
		requiredValue(input, "DATABASE_PATH", issues),
		issues,
	);
	const logLevel = requiredValue(input, "LOG_LEVEL", issues);
	const timeZone = requiredValue(input, "TIME_ZONE", issues);
	const helpContact = requiredValue(input, "HELP_CONTACT", issues);

	if (timeZone !== undefined && timeZone !== "Asia/Yekaterinburg") {
		issues.push({
			code: "invalid",
			key: "TIME_ZONE",
			message: "must equal Asia/Yekaterinburg",
		});
	}

	if (
		issues.length > 0 ||
		botToken === undefined ||
		expectedBotId === undefined ||
		expectedBotUsername === undefined ||
		adminTelegramIds === undefined ||
		showcaseChannelId === undefined ||
		showcaseChannelUsername === undefined ||
		databasePath === undefined ||
		logLevel === undefined ||
		timeZone !== "Asia/Yekaterinburg" ||
		helpContact === undefined
	) {
		throw new ConfigValidationError(issues);
	}

	return {
		config: {
			mfmFeatureEnabled: parseMfmFeatureEnabled(input.MFM_FEATURE_ENABLED),
			botToken,
			expectedBotId,
			expectedBotUsername,
			adminTelegramIds,
			showcaseChannelId,
			showcaseChannelUsername,
			databasePath,
			logLevel,
			timeZone,
			helpContact,
		},
		warnings,
	};
}

export function parseMfmFeatureEnabled(value: string | undefined): boolean {
	if (value === undefined || value === "false") return false;
	if (value === "true") return true;
	throw new ConfigValidationError([{ code: "invalid", key: "MFM_FEATURE_ENABLED", message: "must be true or false" }]);
}
