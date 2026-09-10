import { MFM_EVENT_STATUSES, MFM_OPEN_TO, MFM_SPECIALIZATIONS, MFM_SPHERES } from "../../../profiles/application/index.js";
import { FILTER_FIELDS, type ConnectionAction, type ConnectionProof, type ConnectionSession } from "../../application/index.js";

const ACTIONS: ConnectionAction[] = [
	...["home", "profile", "search"].map(screen => ({ kind: "open", screen }) as ConnectionAction),
	{ kind: "visibility", value: true }, { kind: "visibility", value: false },
	{ kind: "page", delta: -1 }, { kind: "page", delta: 1 }, { kind: "reset_filters" },
	...FILTER_FIELDS.map(field => ({ kind: "choose_filter", field }) as ConnectionAction),
	...FILTER_FIELDS.map(field => ({ kind: "set_filter", field, value: null }) as ConnectionAction),
	...MFM_EVENT_STATUSES.map(value => ({ kind: "set_filter", field: "eventStatus", value }) as ConnectionAction),
	...MFM_SPHERES.map(value => ({ kind: "set_filter", field: "sphere", value }) as ConnectionAction),
	...Object.values(MFM_SPECIALIZATIONS).flat().map(value => ({ kind: "set_filter", field: "specialization", value }) as ConnectionAction),
	...MFM_OPEN_TO.map(value => ({ kind: "set_filter", field: "openTo", value }) as ConnectionAction),
];
export function encodeConnectionCallback(action: ConnectionAction, session: ConnectionSession): string {
	const code = ACTIONS.findIndex(candidate => JSON.stringify(candidate) === JSON.stringify(action));
	if (code < 0) throw new Error("unsupported connection action");
	const value = `n:${session.state.generation}:${session.revision}:${code.toString(36)}`;
	if (value.length > 64) throw new Error("connection callback too long");
	return value;
}
export function decodeConnectionCallback(value: string): { action: ConnectionAction; proof: ConnectionProof } | undefined {
	const match = /^n:([a-f0-9]{16}):([1-9]\d*):([0-9a-z]{1,2})$/.exec(value);
	if (!match || value.length > 64) return undefined;
	const action = ACTIONS[parseInt(match[3]!, 36)];
	const revision = Number(match[2]);
	return action === undefined || !Number.isSafeInteger(revision) ? undefined : { action, proof: { generation: match[1]!, revision } };
}
