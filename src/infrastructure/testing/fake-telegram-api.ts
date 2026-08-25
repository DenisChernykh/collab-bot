import type { UserFromGetMe } from "grammy/types";

export interface FakeTelegramCall {
	readonly method: string;
	readonly payload: Record<string, unknown>;
}
export interface FakeTelegramMarkup {
	readonly inline_keyboard?: readonly (readonly Record<string, unknown>[])[];
	readonly keyboard?: readonly (readonly Record<string, unknown>[])[];
}

export interface FakeTelegramApiOptions {
	readonly token: string;
	readonly botInfo: UserFromGetMe;
	readonly showcaseChannel?: { readonly id: string; readonly username: string; readonly type?: "channel" | "group" };
	readonly showcaseMember?: { readonly status: "creator" | "administrator" | "member"; readonly can_post_messages?: boolean; readonly can_edit_messages?: boolean; readonly can_delete_messages?: boolean };
}

/** A local Bot API surface for grammY handleUpdate tests. It never opens a network socket. */
export class FakeTelegramApi {
	readonly calls: FakeTelegramCall[] = [];
	private nextMessageId = 1;
	private readonly token: string;
	private readonly botInfo: UserFromGetMe;
	private readonly showcaseChannel: { readonly id: string; readonly username: string; readonly type: "channel" | "group" };
	private readonly showcaseMember: { readonly status: "creator" | "administrator" | "member"; readonly can_post_messages?: boolean; readonly can_edit_messages?: boolean; readonly can_delete_messages?: boolean };

	constructor(options: FakeTelegramApiOptions) {
		this.token = options.token;
		this.botInfo = options.botInfo;
		this.showcaseChannel = { type: "channel", ...(options.showcaseChannel ?? { id: "-1001", username: "showcase" }) };
		this.showcaseMember = options.showcaseMember ?? { status: "administrator", can_post_messages: true, can_edit_messages: true, can_delete_messages: true };
	}

	readonly fetch = async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]): Promise<Response> => {
		const url = String(input);
		const method = url.split("/").at(-1) ?? "unknown";
		const payload = await readPayload(init?.body);
		this.calls.push({ method, payload });
		if (!url.includes(`/bot${this.token}/`)) {
			return response({ ok: false, error_code: 401, description: "fake token mismatch" });
		}
		switch (method) {
			case "getMe":
				return response({ ok: true, result: this.botInfo });
			case "sendMessage":
				return response({ ok: true, result: {
					message_id: this.nextMessageId++,
					date: 1_700_000_000,
					chat: { id: payload.chat_id ?? 0, type: "private" },
					text: payload.text ?? "",
					reply_markup: parseMarkup(payload.reply_markup),
				} });
			case "getChat":
				return response({ ok: true, result: { id: this.showcaseChannel.id, type: this.showcaseChannel.type, username: this.showcaseChannel.username } });
			case "getChatMember":
				return response({ ok: true, result: { user: this.botInfo, ...this.showcaseMember } });
			case "editMessageText":
			case "deleteMessage":
				return response({ ok: true, result: true });
			case "answerCallbackQuery":
				return response({ ok: true, result: true });
			case "getUpdates":
				return response({ ok: true, result: [] });
			default:
				return response({ ok: true, result: true });
		}
	};

	lastMessage(): { text?: unknown; reply_markup?: FakeTelegramMarkup } | undefined {
		const call = [...this.calls].reverse().find((candidate) => candidate.method === "sendMessage");
		if (call === undefined) return undefined;
		const markup = parseMarkup(call.payload.reply_markup);
		return markup === undefined ? { text: call.payload.text } : { text: call.payload.text, reply_markup: markup };
	}
}

async function readPayload(body: unknown): Promise<Record<string, unknown>> {
	if (body === null || body === undefined) return {};
	if (typeof body === "string") return parseBodyString(body);
	if (body instanceof URLSearchParams) return Object.fromEntries(body.entries());
	if (typeof FormData !== "undefined" && body instanceof FormData) {
		return Object.fromEntries([...body.entries()].map(([key, value]) => [key, typeof value === "string" ? value : value.name]));
	}
	return {};
}

function parseBodyString(body: string): Record<string, unknown> {
	try {
		const parsed = JSON.parse(body) as unknown;
		return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
	} catch {
		return Object.fromEntries(new URLSearchParams(body).entries());
	}
}

function parseMarkup(value: unknown): FakeTelegramMarkup | undefined {
	if (typeof value !== "string") return value as Record<string, unknown> | undefined;
	try {
		const parsed = JSON.parse(value) as unknown;
		return typeof parsed === "object" && parsed !== null ? parsed as FakeTelegramMarkup : undefined;
	} catch {
		return undefined;
	}
}

function response(body: unknown): Response {
	return new Response(JSON.stringify(body), {
		status: 200,
		headers: { "content-type": "application/json" },
	});
}
