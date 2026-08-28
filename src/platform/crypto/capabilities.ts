import { sha256 } from "@noble/hashes/sha2.js";

import type { CryptoCapabilities } from "../../shared/application/ports/crypto.js";

export interface SecureRandomSource {
	randomUUID(): string;
	getRandomValues<T extends Uint8Array>(array: T): T;
}

const HEX = "0123456789abcdef";
const UTF8 = new TextEncoder();

function requireLength(length: number): void {
	if (!Number.isSafeInteger(length) || length < 1 || length > 65_536) {
		throw new Error("random byte length must be an integer from 1 to 65536");
	}
}

function bytesToHex(bytes: Uint8Array): string {
	let result = "";
	for (const byte of bytes) {
		result += HEX.charAt(byte >> 4) + HEX.charAt(byte & 0x0f);
	}
	return result;
}

export function base64UrlEncode(bytes: Uint8Array): string {
	let binary = "";
	for (const byte of bytes) {
		binary += String.fromCharCode(byte);
	}
	return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

export function createCryptoCapabilities(
	runtimeCrypto: SecureRandomSource = globalThis.crypto,
): CryptoCapabilities {
	return Object.freeze({
		uuid: (): string => runtimeCrypto.randomUUID(),
		randomBytes: (length: number): Uint8Array => {
			requireLength(length);
			return runtimeCrypto.getRandomValues(new Uint8Array(length));
		},
		hashUtf8: (value: string): string => bytesToHex(sha256(UTF8.encode(value))),
	});
}

export const webCryptoCapabilities = createCryptoCapabilities();
