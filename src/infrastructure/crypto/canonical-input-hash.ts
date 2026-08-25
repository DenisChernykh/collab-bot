import { createHash } from "node:crypto";

import { canonicalizeInput, type CanonicalInput } from "../../application/commands/canonical-input.js";

export function hashCanonicalInput(input: CanonicalInput): string {
	return createHash("sha256").update(canonicalizeInput(input), "utf8").digest("hex");
}
