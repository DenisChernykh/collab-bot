import { base64UrlEncode, webCryptoCapabilities } from "./capabilities.js";

export function generateUuid(): string {
	return webCryptoCapabilities.uuid();
}

export function generatePublicToken(): string {
	return generate128BitToken();
}

export function generateCallbackToken(): string {
	return generate128BitToken();
}

function generate128BitToken(): string {
	return base64UrlEncode(webCryptoCapabilities.randomBytes(16));
}

export function hashOpaqueToken(token: string): string {
	return webCryptoCapabilities.hashUtf8(token);
}
