export interface CryptoCapabilities {
	uuid(): string;
	randomBytes(length: number): Uint8Array;
	randomHex(length: number): string;
	randomBase64Url(length: number): string;
	hashUtf8(value: string): string;
}
