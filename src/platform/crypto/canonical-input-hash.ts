import { canonicalizeInput, type CanonicalInput } from "../../shared/application/commands/canonical-input.js";
import { webCryptoCapabilities } from "./capabilities.js";

export function hashCanonicalInput(input: CanonicalInput): string {
	return webCryptoCapabilities.hashUtf8(canonicalizeInput(input));
}
