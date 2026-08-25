import type { CanonicalInput } from "../commands/canonical-input.js";

export interface CanonicalInputHasher {
	hash(input: CanonicalInput): string;
}

export interface OpaqueTokenCodec {
	generateCallbackToken(): string;
	hash(token: string): string;
}
