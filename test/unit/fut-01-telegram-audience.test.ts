import { GrammyError, HttpError } from "grammy";
import { afterEach, describe, expect, it, vi } from "vitest";

import type {
	ProfileAudienceWriter,
	TelegramAudienceReader,
	TelegramAudienceTarget,
} from "../../src/application/profiles/profile-audience-service.js";
import { TelegramAudienceLookupError } from "../../src/application/profiles/profile-audience-service.js";
import { PROVIDER_DEADLINE_MS } from "../../src/application/ports/provider-deadline.js";
import { ProfileAudienceService } from "../../src/application/profiles/profile-audience-service.js";
import type { ProfileRecord } from "../../src/domain/profiles/profile.js";
import { GrammyTelegramAudienceReader } from "../../src/runtime/bot-runtime.js";
import { FakeClock } from "../../src/infrastructure/time/fake-clock.js";
import { SystemProviderDeadline } from "../../src/infrastructure/time/provider-deadline.js";

const NOW = 1_700_000_000_000;

describe("FUT-01 Telegram audience service", () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	it("prefers the exact decimal chat ID and makes one conditional write", async () => {
		const reader = new StubReader(321);
		const writer = new StubWriter(true);
		const service = createService(reader, writer);
		const plan = service.plan(profile({
			telegramChatId: "-1009007199254740993",
		}), "allow");

		expect(plan).toMatchObject({
			profileId: "profile-1",
			platformId: "platform-1",
			target: { kind: "chat_id", value: "-1009007199254740993" },
		});
		await expect(service.execute(plan!)).resolves.toEqual({ kind: "applied", audienceSize: 321 });
		expect(reader.targets).toEqual([{ kind: "chat_id", value: "-1009007199254740993" }]);
		expect(writer.inputs).toEqual([{
			profileId: "profile-1",
			platformId: "platform-1",
			audienceSize: 321,
			observedAt: NOW,
		}]);
	});

	it("uses one @username call only when no valid channel ID is available", async () => {
		const reader = new StubReader(42);
		const service = createService(reader);

		const plan = service.plan(profile({ telegramChatId: "invalid" }), "allow");
		expect(plan?.target).toEqual({ kind: "username", value: "@alice_channel" });
		await service.execute(plan!);
		expect(reader.targets).toEqual([{ kind: "username", value: "@alice_channel" }]);
	});

	it("fails closed for suppression, an existing value, a non-canonical platform, or multiple eligible platforms", () => {
		const service = createService(new StubReader(1));
		const eligible = profile();

		expect(service.plan(eligible, "suppress")).toBeUndefined();
		expect(service.plan(profile({ audienceSize: 10 }), "allow")).toBeUndefined();
		expect(service.plan(profile({ url: "https://t.me/another_channel" }), "allow")).toBeUndefined();
		expect(service.plan({
			...eligible,
			platforms: [eligible.platforms[0]!, { ...eligible.platforms[0]!, id: "platform-2" }],
		}, "allow")).toBeUndefined();
		expect(service.plan({
			...eligible,
			type: "venue_or_brand",
		}, "allow")).toBeDefined();
	});

	it("does not fall back to username after an ID lookup failure", async () => {
		const reader = new StubReader(new TelegramAudienceLookupError("forbidden"));
		const service = createService(reader);
		const plan = service.plan(profile({ telegramChatId: "-100123" }), "allow");

		await expect(service.execute(plan!)).resolves.toEqual({ kind: "unavailable" });
		expect(reader.targets).toEqual([{ kind: "chat_id", value: "-100123" }]);
	});

	it.each([-1, 1.5, Number.MAX_SAFE_INTEGER + 1, Number.NaN])(
		"rejects an invalid provider count %s without writing",
		async (count) => {
			const writer = new StubWriter(true);
			const service = createService(new StubReader(count), writer);
			await expect(service.execute(service.plan(profile(), "allow")!)).resolves.toEqual({ kind: "unavailable" });
			expect(writer.inputs).toEqual([]);
		},
	);

	it("accepts a zero audience snapshot", async () => {
		const writer = new StubWriter(true);
		const service = createService(new StubReader(0), writer);

		await expect(service.execute(service.plan(profile(), "allow")!)).resolves.toEqual({ kind: "applied", audienceSize: 0 });
		expect(writer.inputs).toHaveLength(1);
	});

	it("bounds the provider call with the shared 15-second deadline", async () => {
		vi.useFakeTimers();
		const reader: TelegramAudienceReader = {
			getChatMemberCount: (_target, signal) => new Promise((_resolve, reject) => {
				signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
			}),
		};
		const service = createService(reader);
		const result = service.execute(service.plan(profile(), "allow")!);

		await vi.advanceTimersByTimeAsync(PROVIDER_DEADLINE_MS);
		await expect(result).resolves.toEqual({ kind: "unavailable" });
	});

	it("reports a stale conditional write without claiming success", async () => {
		const service = createService(new StubReader(9), new StubWriter(false));
		await expect(service.execute(service.plan(profile(), "allow")!)).resolves.toEqual({ kind: "stale" });
	});
});

describe("FUT-01 grammY audience adapter", () => {
	it("passes a string target and AbortSignal to getChatMemberCount", async () => {
		const getChatMemberCount = vi.fn().mockResolvedValue(55);
		const reader = new GrammyTelegramAudienceReader({ api: { getChatMemberCount } } as never);
		const signal = new AbortController().signal;

		await expect(reader.getChatMemberCount({ kind: "chat_id", value: "-1009007199254740993" }, signal)).resolves.toBe(55);
		expect(getChatMemberCount).toHaveBeenCalledWith("-1009007199254740993", signal);
	});

	it.each([
		[400, "Bad Request: chat not found", "not_found"],
		[400, "Bad Request: chat_id is invalid", "invalid_target"],
		[403, "Forbidden: bot is not a member", "forbidden"],
		[429, "Too Many Requests", "rate_limited"],
		[500, "Internal Server Error", "unknown"],
	] as const)("classifies Telegram API %s without exposing its description", async (code, description, expectedCode) => {
		const getChatMemberCount = vi.fn().mockRejectedValue(grammyError(code, description));
		const reader = new GrammyTelegramAudienceReader({ api: { getChatMemberCount } } as never);

		const error = await reader.getChatMemberCount({ kind: "username", value: "@alice_channel" }, new AbortController().signal)
			.catch((caught: unknown) => caught);
		expect(error).toMatchObject({ code: expectedCode });
		expect(String(error)).not.toContain(description);
	});

	it("classifies grammY HTTP failures as network failures", async () => {
		const getChatMemberCount = vi.fn().mockRejectedValue(new HttpError("network request failed", new Error("socket closed")));
		const reader = new GrammyTelegramAudienceReader({ api: { getChatMemberCount } } as never);

		await expect(reader.getChatMemberCount({ kind: "username", value: "@alice_channel" }, new AbortController().signal))
			.rejects.toMatchObject({ code: "network" });
	});
});

class StubReader implements TelegramAudienceReader {
	readonly targets: TelegramAudienceTarget[] = [];

	constructor(private readonly result: number | Error) {}

	async getChatMemberCount(target: TelegramAudienceTarget): Promise<number> {
		this.targets.push(target);
		if (this.result instanceof Error) throw this.result;
		return this.result;
	}
}

class StubWriter implements ProfileAudienceWriter {
	readonly inputs: Array<{ profileId: string; platformId: string; audienceSize: number; observedAt: number }> = [];

	constructor(private readonly stored = true) {}

	async storeTelegramAudienceIfMissing(input: { profileId: string; platformId: string; audienceSize: number; observedAt: number }): Promise<boolean> {
		this.inputs.push(input);
		return this.stored;
	}
}

function createService(reader: TelegramAudienceReader, writer: ProfileAudienceWriter = new StubWriter()): ProfileAudienceService {
	return new ProfileAudienceService(
		reader,
		writer,
		{ withTransaction: (work) => Promise.resolve(work()) },
		new FakeClock(NOW),
		new SystemProviderDeadline(),
	);
}

function profile(platform: Partial<ProfileRecord["platforms"][number]> = {}): ProfileRecord {
	return {
		id: "profile-1",
		telegramUserId: "100",
		type: "blogger",
		displayName: "Alice",
		description: null,
		cityCode: "ekaterinburg",
		status: "active",
		createdAt: NOW,
		updatedAt: NOW,
		topics: [],
		platforms: [{
			id: "platform-1",
			platformType: "telegram",
			url: "https://t.me/alice_channel",
			username: "alice_channel",
			...platform,
		}],
	};
}

function grammyError(errorCode: number, description: string): GrammyError {
	return new GrammyError(
		"Telegram API call failed",
		{ ok: false, error_code: errorCode, description },
		"getChatMemberCount",
		{},
	);
}
