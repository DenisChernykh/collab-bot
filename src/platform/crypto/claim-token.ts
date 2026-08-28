import type { ClaimTokenGenerator } from "../../shared/application/ports/claim-token.js";
import { base64UrlEncode, webCryptoCapabilities } from "./capabilities.js";

export class RandomClaimTokenGenerator implements ClaimTokenGenerator {
	generate(): string {
		return `claim-${base64UrlEncode(webCryptoCapabilities.randomBytes(24))}`;
	}
}
