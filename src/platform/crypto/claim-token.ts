import { randomBytes } from "node:crypto";

import type { ClaimTokenGenerator } from "../../shared/application/ports/claim-token.js";

export class RandomClaimTokenGenerator implements ClaimTokenGenerator {
	generate(): string {
		return `claim-${randomBytes(24).toString("base64url")}`;
	}
}
