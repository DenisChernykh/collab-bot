import type { CanonicalInput } from "../../../application/commands/canonical-input.js";

export interface CanonicalInputHasher {
	hash(input: CanonicalInput): string;
}

export interface OpaqueTokenCodec {
	generateCallbackToken(): string;
	hash(token: string): string;
}
