import { createHash, randomBytes, randomUUID } from "node:crypto";

export function generateUuid(): string {
	return randomUUID();
}

export function generatePublicToken(): string {
	return generate128BitToken();
}

export function generateCallbackToken(): string {
	return generate128BitToken();
}

function generate128BitToken(): string {
	return randomBytes(16).toString("base64url");
}

export function hashOpaqueToken(token: string): string {
	return createHash("sha256").update(token, "utf8").digest("hex");
}
