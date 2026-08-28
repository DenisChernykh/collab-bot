import type {
	CanonicalInputHasher,
	OpaqueTokenCodec,
} from "../../shared/application/ports/ingress-crypto.js";
import type { CanonicalInput } from "../../application/commands/canonical-input.js";
import { hashCanonicalInput } from "./canonical-input-hash.js";
import { generateCallbackToken, hashOpaqueToken } from "./tokens.js";

export class Sha256CanonicalInputHasher implements CanonicalInputHasher {
	hash(input: CanonicalInput): string {
		return hashCanonicalInput(input);
	}
}

export class NodeOpaqueTokenCodec implements OpaqueTokenCodec {
	generateCallbackToken(): string {
		return generateCallbackToken();
	}

	hash(token: string): string {
		return hashOpaqueToken(token);
	}
}
