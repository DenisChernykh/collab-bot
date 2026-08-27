import { Composer, InlineKeyboard, type Context } from "grammy";

import { DomainValidationError, type CollaborationFormat, type Topic } from "../../../../domain/value-objects/enums.js";
import {
	COLLABORATION_FORMAT_LABELS,
	renderCollaborationCard,
} from "../../../collaborations/index.js";
import { PROFILE_TYPE_LABELS, TOPIC_LABELS } from "../../../profiles/index.js";
import {
	BrowseSessionStaleError,
	type BrowseCollaborationRecord,
	type BrowseFilterDimension,
	type BrowseFilterValue,
	type BrowsePage,
	type BrowseSessionRecord,
	type CollaborationBrowseService,
} from "../../application/index.js";
import {
	browseCallback,
	parseMarketplaceCallback,
	type BrowseMutation,
} from "./marketplace-callback-codec.js";

export type ApplicationStartSource = "feed" | "deep_link";

export type ApplicationTargetResolution =
	| { readonly kind: "card"; readonly collaborationId: string }
	| { readonly kind: "handled" };

export interface MarketplaceTelegramFeatureOptions {
	readonly browseService?: CollaborationBrowseService;
	readonly menuKeyboard: () => InlineKeyboard;
	readonly applicationStartCallback: (source: ApplicationStartSource, publicToken: string) => string;
}

export interface MarketplaceTelegramFeature {
	readonly composer: Composer<Context>;
	routeStart(ctx: Context, userId: string, startParameter: string): Promise<boolean>;
	routeCommand(ctx: Context, userId: string, command: string | undefined): Promise<boolean>;
	resolveApplicationTarget(ctx: Context, userId: string, publicToken: string): Promise<ApplicationTargetResolution>;
	renderApplicationTarget(ctx: Context, userId: string, publicToken: string): Promise<void>;
}

export function createMarketplaceTelegramFeature(options: MarketplaceTelegramFeatureOptions): MarketplaceTelegramFeature {
	const composer = new Composer<Context>();
	composer.on("callback_query:data", async (ctx, next) => {
		const callback = parseMarketplaceCallback(ctx.callbackQuery.data);
		if (callback === undefined || ctx.from === undefined) {
			await next();
			return;
		}
		const userId = String(ctx.from.id);
		if (callback.kind === "open_feed") {
			await openFeed(ctx, options, userId);
			return;
		}
		await handleBrowseMutation(ctx, options, userId, callback.mutation);
	});

	return {
		composer,
		routeStart: async (ctx, userId, startParameter) => {
			if (!startParameter.startsWith("c_")) return false;
			await renderDeepLink(ctx, options, userId, startParameter);
			return true;
		},
		routeCommand: async (ctx, userId, command) => {
			if (command !== "/feed") return false;
			await openFeed(ctx, options, userId);
			return true;
		},
		resolveApplicationTarget: async (ctx, userId, publicToken) => {
			const result = await openDeepLink(options, userId, `c_${publicToken}`);
			if (result?.kind === "card") return { kind: "card", collaborationId: result.card.id };
			await renderDeepLinkResult(ctx, options, result ?? { kind: "unavailable" });
			return { kind: "handled" };
		},
		renderApplicationTarget: async (ctx, userId, publicToken) => {
			await renderDeepLinkResult(ctx, options, await openDeepLink(options, userId, `c_${publicToken}`) ?? { kind: "unavailable" });
		},
	};
}

async function openFeed(ctx: Context, options: MarketplaceTelegramFeatureOptions, userId: string): Promise<void> {
	if (options.browseService === undefined) {
		await ctx.reply("Этот раздел пока готовится.", { reply_markup: options.menuKeyboard() });
		return;
	}
	try {
		await renderBrowsePage(ctx, options, await options.browseService.openFeed(userId));
	} catch (error) {
		if (error instanceof BrowseSessionStaleError) {
			await ctx.reply("Экран ленты устарел. Откройте ленту снова.", { reply_markup: new InlineKeyboard().text("Открыть ленту", "browse:start") });
			return;
		}
		throw error;
	}
}

async function handleBrowseMutation(ctx: Context, options: MarketplaceTelegramFeatureOptions, userId: string, mutation: BrowseMutation): Promise<void> {
	const service = options.browseService;
	if (service === undefined) {
		await ctx.reply("Этот раздел пока готовится.", { reply_markup: options.menuKeyboard() });
		return;
	}
	try {
		switch (mutation.kind) {
			case "next": await renderBrowsePage(ctx, options, await service.next(userId, mutation)); return;
			case "reset": await renderBrowsePage(ctx, options, await service.reset(userId, mutation)); return;
			case "filters": await renderBrowseFilterDimensions(ctx, await service.touch(userId, mutation)); return;
			case "filter": {
				if (mutation.dimension === undefined) throw new BrowseSessionStaleError();
				await renderBrowseFilterValues(ctx, await service.touch(userId, mutation), mutation.dimension);
				return;
			}
			case "set": {
				const dimension = toBrowseFilterDimension(mutation.dimension);
				if (dimension === undefined || mutation.value === undefined) throw new BrowseSessionStaleError();
				const value: BrowseFilterValue = mutation.value === "any" ? null : mutation.value as BrowseFilterValue;
				await renderBrowsePage(ctx, options, await service.changeFilter(userId, mutation, dimension, value));
				return;
			}
		}
	} catch (error) {
		if (error instanceof BrowseSessionStaleError || error instanceof DomainValidationError) {
			await ctx.reply("Экран ленты устарел. Откройте ленту снова.", { reply_markup: new InlineKeyboard().text("Открыть ленту", "browse:start") });
			return;
		}
		throw error;
	}
}

async function renderBrowsePage(ctx: Context, options: MarketplaceTelegramFeatureOptions, page: BrowsePage): Promise<void> {
	const current = options.browseService === undefined ? page : await options.browseService.revalidate(page);
	if (current.card === null) {
		await ctx.reply("Подходящих карточек пока нет. Измените фильтры или покажите выдачу сначала.", { reply_markup: browseEmptyKeyboard(current.session) });
		return;
	}
	await ctx.reply(renderCollaborationCard(current.card), { parse_mode: "HTML", reply_markup: browseCardKeyboard(options, current.card, current.session) });
}

async function renderDeepLink(ctx: Context, options: MarketplaceTelegramFeatureOptions, userId: string, startParameter: string): Promise<void> {
	await renderDeepLinkResult(ctx, options, await openDeepLink(options, userId, startParameter) ?? { kind: "unavailable" });
}

function openDeepLink(options: MarketplaceTelegramFeatureOptions, userId: string, startParameter: string) {
	return options.browseService?.openDeepLink(userId, startParameter);
}

async function renderDeepLinkResult(
	ctx: Context,
	options: MarketplaceTelegramFeatureOptions,
	result: Awaited<ReturnType<CollaborationBrowseService["openDeepLink"]>>,
): Promise<void> {
	switch (result.kind) {
		case "card": await ctx.reply(renderCollaborationCard(result.card), { parse_mode: "HTML", reply_markup: deepLinkCardKeyboard(options, result.card, result.actionable) }); return;
		case "expired": await ctx.reply("Срок откликов истёк.", { reply_markup: options.menuKeyboard() }); return;
		case "closed": await ctx.reply("Предложение закрыто.", { reply_markup: options.menuKeyboard() }); return;
		case "unavailable": await ctx.reply("Предложение недоступно.", { reply_markup: options.menuKeyboard() }); return;
	}
}

async function renderBrowseFilterDimensions(ctx: Context, session: BrowseSessionRecord): Promise<void> {
	const target = session.filters.targetProfileType === null ? "Любой" : PROFILE_TYPE_LABELS[session.filters.targetProfileType];
	const format = session.filters.format === null ? "Любой" : COLLABORATION_FORMAT_LABELS[session.filters.format];
	const topic = session.filters.topic === null ? "Любая" : TOPIC_LABELS[session.filters.topic];
	const keyboard = new InlineKeyboard()
		.text(`Тип: ${target}`, browseCallback("b:f:t", session)).row()
		.text(`Формат: ${format}`, browseCallback("b:f:f", session)).row()
		.text(`Тема: ${topic}`, browseCallback("b:f:o", session)).row()
		.text("Показать сначала", browseCallback("b:r", session));
	await ctx.reply("Настройте фильтры. Выбранные измерения применяются вместе.", { reply_markup: keyboard });
}

async function renderBrowseFilterValues(ctx: Context, session: BrowseSessionRecord, dimension: NonNullable<BrowseMutation["dimension"]>): Promise<void> {
	const keyboard = new InlineKeyboard();
	if (dimension === "target") {
		for (const [value, label] of [["any", "Любой"], ["blogger", "Блогер"], ["telegram_channel", "Telegram-канал"], ["venue_or_brand", "Заведение или бренд"]] as const) keyboard.text(label, browseCallback(`b:s:t:${value}`, session)).row();
	} else if (dimension === "format") {
		keyboard.text("Любой", browseCallback("b:s:f:any", session)).row();
		for (const [value, label] of Object.entries(COLLABORATION_FORMAT_LABELS) as [CollaborationFormat, string][]) keyboard.text(label, browseCallback(`b:s:f:${value}`, session)).row();
	} else {
		keyboard.text("Любая", browseCallback("b:s:o:any", session)).row();
		for (const [value, label] of Object.entries(TOPIC_LABELS) as [Topic, string][]) keyboard.text(label, browseCallback(`b:s:o:${value}`, session)).row();
	}
	await ctx.reply("Выберите значение фильтра:", { reply_markup: keyboard });
}

function toBrowseFilterDimension(value: BrowseMutation["dimension"]): BrowseFilterDimension | undefined {
	if (value === "target") return "target_profile_type";
	if (value === "format" || value === "topic") return value;
	return undefined;
}

function browseCardKeyboard(options: MarketplaceTelegramFeatureOptions, card: BrowseCollaborationRecord, session: BrowseSessionRecord): InlineKeyboard {
	const keyboard = new InlineKeyboard();
	if (card.publicToken !== null) keyboard.text("Откликнуться", options.applicationStartCallback("feed", card.publicToken)).row();
	return keyboard
		.text("Дальше", browseCallback("b:n", session)).row()
		.text("Фильтры", browseCallback("b:fs", session)).row()
		.text("Показать сначала", browseCallback("b:r", session));
}

function browseEmptyKeyboard(session: BrowseSessionRecord): InlineKeyboard {
	return new InlineKeyboard()
		.text("Фильтры", browseCallback("b:fs", session)).row()
		.text("Показать сначала", browseCallback("b:r", session)).row()
		.text("← В главное меню", "menu:home");
}

function deepLinkCardKeyboard(options: MarketplaceTelegramFeatureOptions, card: BrowseCollaborationRecord, actionable: boolean): InlineKeyboard {
	const keyboard = new InlineKeyboard();
	if (actionable && card.publicToken !== null) keyboard.text("Откликнуться", options.applicationStartCallback("deep_link", card.publicToken)).row();
	return keyboard.text("Открыть ленту", "browse:start").row().text("← В главное меню", "menu:home");
}
