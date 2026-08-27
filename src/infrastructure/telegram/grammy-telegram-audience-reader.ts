import { GrammyError, HttpError, type Bot } from "grammy";

import {
	TelegramAudienceLookupError,
	type TelegramAudienceReader,
	type TelegramAudienceTarget,
} from "../../application/profiles/profile-audience-service.js";

export class GrammyTelegramAudienceReader implements TelegramAudienceReader {
	constructor(private readonly bot: Pick<Bot, "api">) {}

	async getChatMemberCount(target: TelegramAudienceTarget, signal: AbortSignal): Promise<number> {
		try {
			return await this.bot.api.getChatMemberCount(target.value, signal as never);
		} catch (error) {
			if (error instanceof GrammyError) {
				if (error.error_code === 429) throw new TelegramAudienceLookupError("rate_limited");
				if (error.error_code === 403) throw new TelegramAudienceLookupError("forbidden");
				if (error.error_code === 400) {
					throw new TelegramAudienceLookupError(/not found/i.test(error.description) ? "not_found" : "invalid_target");
				}
				throw new TelegramAudienceLookupError("unknown");
			}
			if (error instanceof HttpError) throw new TelegramAudienceLookupError("network");
			throw new TelegramAudienceLookupError("unknown");
		}
	}
}
