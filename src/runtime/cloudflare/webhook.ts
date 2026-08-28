const MAX_WEBHOOK_BYTES = 1_048_576;

export type DurableWebhookHandler = (update: Record<string, unknown>) => Promise<void>;

export function constantTimeEqual(actual: string | null, expected: string): boolean {
	const actualBytes = new TextEncoder().encode(actual ?? "");
	const expectedBytes = new TextEncoder().encode(expected);
	let mismatch = actualBytes.length ^ expectedBytes.length;
	const length = Math.max(actualBytes.length, expectedBytes.length);
	for (let index = 0; index < length; index += 1) {
		mismatch |= (actualBytes[index] ?? 0) ^ (expectedBytes[index] ?? 0);
	}
	return mismatch === 0;
}

export async function handleTelegramWebhook(
	request: Request,
	expectedSecret: string | undefined,
	dispatch: DurableWebhookHandler,
): Promise<Response> {
	if (request.method !== "POST") return errorResponse(405);
	if (!isJsonContentType(request.headers.get("content-type"))) return errorResponse(415);
	if (expectedSecret === undefined || expectedSecret === "" || !constantTimeEqual(request.headers.get("x-telegram-bot-api-secret-token"), expectedSecret)) {
		return errorResponse(401);
	}

	let body: string;
	try {
		body = await readBody(request);
	} catch (error) {
		if (error instanceof RequestTooLargeError) return errorResponse(413);
		return errorResponse(400);
	}

	let update: unknown;
	try {
		update = JSON.parse(body);
	} catch {
		return errorResponse(400);
	}
	if (!isTelegramUpdate(update)) return errorResponse(400);

	try {
		await dispatch(update);
	} catch {
		return errorResponse(500);
	}
	return new Response(null, { status: 204 });
}

function isJsonContentType(value: string | null): boolean {
	return value?.split(";", 1)[0]?.trim().toLowerCase() === "application/json";
}

async function readBody(request: Request): Promise<string> {
	const contentLength = request.headers.get("content-length");
	if (contentLength !== null && /^\d+$/u.test(contentLength) && Number(contentLength) > MAX_WEBHOOK_BYTES) {
		throw new RequestTooLargeError();
	}
	const reader = request.body?.getReader();
	if (reader === undefined) return "";
	const chunks: Uint8Array[] = [];
	let total = 0;
	try {
		while (true) {
			const next = await reader.read();
			if (next.done) break;
			const chunk = next.value;
			total += chunk.byteLength;
			if (total > MAX_WEBHOOK_BYTES) throw new RequestTooLargeError();
			chunks.push(chunk);
		}
	} finally {
		reader.releaseLock();
	}
	const body = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		body.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(body);
}

function isTelegramUpdate(value: unknown): value is Record<string, unknown> {
	if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
	const updateId = (value as { readonly update_id?: unknown }).update_id;
	return typeof updateId === "number" && Number.isSafeInteger(updateId) && updateId >= 0;
}

class RequestTooLargeError extends Error {}

function errorResponse(status: number): Response {
	return new Response(null, { status, headers: { "cache-control": "no-store" } });
}
