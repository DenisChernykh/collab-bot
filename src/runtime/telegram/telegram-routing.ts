import type { Context } from "grammy";

export interface TelegramTextRouteHandlers {
	routeModeration(ctx: Context, userId: string, command: string | undefined, text: string): Promise<boolean>;
	routeStart(ctx: Context, userId: string, startParameter: string): Promise<boolean>;
	renderMenu(ctx: Context, userId: string): Promise<unknown>;
	renderHelp(ctx: Context): Promise<unknown>;
	routeCollaboration(ctx: Context, userId: string, command: string | undefined): Promise<boolean>;
	routeMarketplace(ctx: Context, userId: string, command: string | undefined): Promise<boolean>;
}

export async function routeTelegramText(
	ctx: Context,
	userId: string,
	text: string,
	handlers: TelegramTextRouteHandlers,
): Promise<boolean> {
	const command = text.trim().split(/\s+/, 1)[0]?.toLowerCase();
	if (await handlers.routeModeration(ctx, userId, command, text)) return true;
	if (command === "/start") {
		const startParameter = text.trim().slice(command.length).trim();
		if (!(await handlers.routeStart(ctx, userId, startParameter))) await handlers.renderMenu(ctx, userId);
		return true;
	}
	if (command === "/help") {
		await handlers.renderHelp(ctx);
		return true;
	}
	if (await handlers.routeCollaboration(ctx, userId, command)) return true;
	return handlers.routeMarketplace(ctx, userId, command);
}
