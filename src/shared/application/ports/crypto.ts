export interface CryptoCapabilities {
	uuid(): string;
	randomBytes(length: number): Uint8Array;
	hashUtf8(value: string): string;
}
