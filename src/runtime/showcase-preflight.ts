import type { Bot } from "grammy";
import type { AppConfig } from "../config/parse-config.js";
import type { ShowcaseCapability } from "../modules/collaborations/index.js";

export async function preflightShowcase(bot: Bot, config: Pick<AppConfig, "showcaseChannelId" | "showcaseChannelUsername">): Promise<ShowcaseCapability> {
	try {
		const chat = await bot.api.getChat(config.showcaseChannelId);
		if (String(chat.id) !== config.showcaseChannelId || chat.type !== "channel" || normalize(chat.username) !== normalize(config.showcaseChannelUsername)) return { canPublish: false, reason: "showcase channel identity mismatch" };
		const member = await bot.api.getChatMember(chat.id, bot.botInfo.id);
		if (member.status === "creator") return { canPublish: true, reason: null };
		if (member.status !== "administrator" || member.can_post_messages !== true || member.can_edit_messages !== true || member.can_delete_messages !== true) return { canPublish: false, reason: "showcase bot capabilities are insufficient" };
		return { canPublish: true, reason: null };
	} catch {
		return { canPublish: false, reason: "showcase preflight failed" };
	}
}

function normalize(value: string | undefined): string {
	return (value ?? "").replace(/^@+/, "").toLowerCase();
}
