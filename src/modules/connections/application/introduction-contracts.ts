import type { Language } from "../../profiles/application/index.js";
import type { ConnectionRepository } from "./ports/connection-repository.js";
import type { ConnectionSession, IntroductionTab, PublicPerson } from "./connection-model.js";

export type IntroductionStatus = "pending" | "accepted" | "rejected" | "withdrawn";
export interface IntroductionRecord {
	id: string; token: string; senderProfileId: string; recipientProfileId: string;
	message: string; status: IntroductionStatus; revision: number; createdAt: number; decidedAt: number | null;
}
export interface IntroductionRepository extends ConnectionRepository {
	getPerson(profileId: string): Promise<PublicPerson | undefined>;
	findRequest(token: string): Promise<IntroductionRecord | undefined>;
	findPair(first: string, second: string): Promise<IntroductionRecord | undefined>;
	insertRequest(record: IntroductionRecord): Promise<void>;
	decide(record: IntroductionRecord, status: Exclude<IntroductionStatus, "pending">, now: number): Promise<void>;
	listRequests(profileId: string, tab: IntroductionTab, offset: number): Promise<readonly IntroductionRecord[]>;
	getDeliveryTarget(profileId: string): Promise<{ userId: string; language: Language } | undefined>;
	getContactUrl(profileId: string): Promise<string | null>;
}
export type IntroductionAction =
	| { kind: "begin" } | { kind: "message"; value: string } | { kind: "confirm" } | { kind: "edit_message" } | { kind: "cancel" }
	| { kind: "list"; tab: IntroductionTab } | { kind: "page"; delta: -1 | 1 } | { kind: "show_request" }
	| { kind: "decide"; decision: Exclude<IntroductionStatus, "pending">; requestRevision: number };
export type IntroductionNotice = "stale" | "invalid" | "disabled" | "unavailable";
export type IntroductionView = { kind: "unavailable" } | {
	kind: "none" | "compose" | "confirm" | "request" | "list";
	language: Language; festivalEnabled: boolean; session: ConnectionSession;
	person: PublicPerson | null;
	request: Pick<IntroductionRecord, "token" | "status" | "revision" | "message"> | null;
	message: string | null; contactUrl: string | null;
	canAccept: boolean; canWithdraw: boolean; hasNext: boolean;
	notice?: IntroductionNotice;
};
