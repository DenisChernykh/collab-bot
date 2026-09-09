import type { OnboardingAction, OnboardingToken } from "../../application/onboarding-service.js";
import type { OnboardingSession } from "../../application/ports/onboarding-repository.js";
import { MFM_EVENT_STATUSES, MFM_PROFILE_TYPES, MFM_SPHERES, MFM_SPECIALIZATIONS, MFM_OPEN_TO } from "../../domain/mfm-profile.js";
const VALUES: readonly string[] = [...new Set(["ru", "en", "yes", "no", ...MFM_EVENT_STATUSES, ...MFM_PROFILE_TYPES, ...MFM_SPHERES, ...Object.values(MFM_SPECIALIZATIONS).flat(), ...MFM_OPEN_TO, "0", "1", "2"])];
const KINDS = ["language", "affiliation", "choice", "page", "next", "back", "keep", "city", "cancel"] as const;
export function encodeMfmCallback(action: OnboardingAction, session: OnboardingSession): string {
	if (action.kind === "text") throw new Error("free text cannot be a callback");
	const value = "value" in action ? VALUES.indexOf(action.value) : 0;
	if (value < 0) throw new Error("unsupported callback value");
	const result = `m:${session.state.generation}:${session.revision}:${KINDS.indexOf(action.kind).toString(36)}:${value.toString(36)}`;
	if (result.length > 64) throw new Error("callback too long");
	return result;
}
export function decodeMfmCallback(value: string): { readonly action: OnboardingAction; readonly token: OnboardingToken } | undefined {
	const match = /^m:([a-f0-9]{16}):([1-9]\d*):([0-9a-z]):([0-9a-z]{1,2})$/.exec(value);
	if (match === null || value.length > 64) return undefined;
	const generation = match[1]!;
	const revision = Number(match[2]);
	const kind = KINDS[parseInt(match[3]!, 36)];
	const code = parseInt(match[4]!, 36);
	if (!Number.isSafeInteger(revision) || kind === undefined) return undefined;
	const token = { generation, revision };
	if (kind === "next" || kind === "back" || kind === "keep" || kind === "city" || kind === "cancel") return code === 0 ? { action: { kind }, token } : undefined;
	const selected = VALUES[code];
	return selected === undefined ? undefined : { action: { kind, value: selected }, token };
}
