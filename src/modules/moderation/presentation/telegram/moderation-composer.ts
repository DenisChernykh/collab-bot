import type { Context } from "grammy";

import type { CanonicalInput } from "../../../../application/commands/canonical-input.js";
import type { CommandActor } from "../../../../application/commands/command-contracts.js";
import { collaborationStatusLabel } from "../../../collaborations/index.js";
import type { AdminModerationService } from "../../application/admin-moderation-service.js";

export interface ModerationTelegramFeatureOptions {
	readonly moderationService?: AdminModerationService;
	readonly replyUnknownCommand: (ctx: Context) => Promise<unknown>;
}

export interface ModerationTelegramFeature {
	resolveActor(input: CanonicalInput, telegramUserId: string): CommandActor;
	routeCommand(ctx: Context, userId: string, command: string | undefined, text: string): Promise<boolean>;
}

export function createModerationTelegramFeature(options: ModerationTelegramFeatureOptions): ModerationTelegramFeature {
	return {
		resolveActor: (input, telegramUserId) => {
			if (isAdminCommandInput(input) && options.moderationService?.isAdminTelegramUserId(telegramUserId) === true) {
				return { kind: "admin", telegramUserId };
			}
			return { kind: "telegram_user", telegramUserId };
		},
		routeCommand: async (ctx, userId, command, text) => {
			if (command !== "/admin") return false;
			if (options.moderationService?.isAdminTelegramUserId(userId) !== true) {
				await options.replyUnknownCommand(ctx);
				return true;
			}
			await handleAdminCommand(ctx, options, userId, text);
			return true;
		},
	};
}

function isAdminCommandInput(input: CanonicalInput): boolean {
	if (input === null || typeof input !== "object" || Array.isArray(input)) return false;
	const record = input as { readonly kind?: unknown; readonly text?: unknown };
	if (record.kind !== "message" || typeof record.text !== "string") return false;
	return record.text.trim().split(/\s+/, 1)[0]?.toLowerCase() === "/admin";
}

async function handleAdminCommand(
	ctx: Context,
	options: ModerationTelegramFeatureOptions,
	userId: string,
	text: string,
): Promise<void> {
	const moderation = options.moderationService;
	if (moderation === undefined) {
		await options.replyUnknownCommand(ctx);
		return;
	}
	const body = text.trim().slice("/admin".length).trim();
	if (body === "") {
		await ctx.reply("Укажите полную ссылку на карточку. Для скрытия используйте: /admin hide <ссылка> <причина>.");
		return;
	}
	if (body.toLowerCase() === "hide" || body.toLowerCase().startsWith("hide ")) {
		const hideBody = body.slice("hide".length).trim();
		const separator = hideBody.search(/\s/);
		if (separator < 0) {
			await ctx.reply("Укажите полную ссылку и внутреннюю причину скрытия от 1 до 500 символов.");
			return;
		}
		const deepLink = hideBody.slice(0, separator);
		const reason = hideBody.slice(separator).trim();
		const updateId = getUpdateId(ctx);
		if (updateId === undefined) return;
		const result = await moderation.hide({
			adminTelegramUserId: userId,
			commandId: `telegram:update:${updateId}`,
			deepLink,
			reason,
		});
		if (result.ok) {
			await ctx.reply("Карточка скрыта. Публикация поставлена на удаление.");
			return;
		}
		switch (result.code) {
			case "invalid_reason":
				await ctx.reply("Причина после удаления пробелов должна содержать от 1 до 500 символов.");
				return;
			case "already_hidden":
				await ctx.reply("Карточка уже скрыта.");
				return;
			case "invalid_link":
				await ctx.reply("Не удалось распознать ссылку на карточку этого бота.");
				return;
			case "not_found":
				await ctx.reply("Карточка не найдена.");
				return;
			case "forbidden":
				await options.replyUnknownCommand(ctx);
				return;
			case "unavailable":
				await ctx.reply("Эту карточку сейчас нельзя скрыть.");
				return;
		}
	}
	if (/\s/.test(body)) {
		await ctx.reply("Укажите одну полную ссылку на карточку.");
		return;
	}
	const result = await moderation.lookup({ adminTelegramUserId: userId, deepLink: body });
	if (result.ok) {
		await ctx.reply(`Карточка найдена.\nНазвание: ${result.title}\nСтатус: ${collaborationStatusLabel(result.status)}`);
		return;
	}
	if (result.code === "forbidden") {
		await options.replyUnknownCommand(ctx);
		return;
	}
	await ctx.reply(result.code === "invalid_link" ? "Не удалось распознать ссылку на карточку этого бота." : "Карточка не найдена.");
}

function getUpdateId(ctx: Context): number | undefined {
	const updateId = ctx.update.update_id;
	return Number.isSafeInteger(updateId) && updateId >= 0 ? updateId : undefined;
}
