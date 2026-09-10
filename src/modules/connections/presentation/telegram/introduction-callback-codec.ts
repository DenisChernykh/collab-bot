import type { ConnectionProof, ConnectionSession, IntroductionAction } from "../../application/index.js";

const ACTIONS: Exclude<IntroductionAction, { kind: "message" | "decide" }>[] = [
	{ kind: "begin" }, { kind: "confirm" }, { kind: "edit_message" }, { kind: "cancel" },
	{ kind: "list", tab: "incoming" }, { kind: "list", tab: "sent" }, { kind: "list", tab: "accepted" },
	{ kind: "page", delta: -1 }, { kind: "page", delta: 1 }, { kind: "show_request" },
];
const DECISIONS = ["accepted", "rejected", "withdrawn"] as const;
export function encodeIntroductionCallback(action: IntroductionAction, session: ConnectionSession): string {
	if (action.kind === "message") throw new Error("message is not a callback");
	const code = action.kind === "decide" ? ACTIONS.length + DECISIONS.indexOf(action.decision) : ACTIONS.findIndex(x => JSON.stringify(x) === JSON.stringify(action));
	if (code < 0) throw new Error("invalid introduction action");
	const value = `i:${session.state.generation}:${session.revision}:${code.toString(36)}${action.kind === "decide" ? `:${action.requestRevision}` : ""}`;
	if (value.length > 64) throw new Error("introduction callback too long");
	return value;
}
export function decodeIntroductionCallback(value: string): { action: IntroductionAction; proof: ConnectionProof } | undefined {
	const match = /^i:([a-f0-9]{16}):([1-9]\d*):([0-9a-z]{1,2})(?::([1-9]\d*))?$/.exec(value);
	if (!match || value.length > 64) return undefined;
	const revision = Number(match[2]);
	if (!Number.isSafeInteger(revision)) return undefined;
	const code = parseInt(match[3]!, 36);
	const proof = { generation: match[1]!, revision };
	const simple = ACTIONS[code];
	if (simple !== undefined) return match[4] === undefined ? { action: simple, proof } : undefined;
	const decision = DECISIONS[code - ACTIONS.length];
	const requestRevision = Number(match[4]);
	return decision === undefined || !Number.isSafeInteger(requestRevision) ? undefined : { action: { kind: "decide", decision, requestRevision }, proof };
}
