import { MFM_EVENT_STATUSES, MFM_OPEN_TO, MFM_SPHERES, mfmValue, type Language, type MfmProfileInput, type MfmSphere } from "../../profiles/application/index.js";

export interface SearchFilters {
	eventStatus?: MfmProfileInput["eventStatus"];
	sphere?: MfmSphere;
	openTo?: MfmProfileInput["openTo"][number];
}
export const FILTER_FIELDS = ["eventStatus", "sphere", "openTo"] as const;
export type FilterField = typeof FILTER_FIELDS[number];
export type ConnectionScreen = "home" | "profile" | "search" | "filter";
export type IntroductionTab = "incoming" | "sent" | "accepted";
export type IntroductionNavigation =
	| { screen: "compose"; targetProfileId: string; message?: string }
	| { screen: "confirm"; targetProfileId: string; message: string }
	| { screen: "request"; token: string }
	| { screen: "list"; tab: IntroductionTab; offset: number };
export interface ConnectionState {
	version: 1;
	generation: string;
	screen: ConnectionScreen;
	filters: SearchFilters;
	offset: number;
	filterField?: FilterField;
	introduction?: IntroductionNavigation;
}
export interface ConnectionSession { state: ConnectionState; revision: number; updatedAt: number }
export interface ConnectionProof { generation: string; revision: number }
export type PublicPerson = MfmProfileInput & { profileId: string };
export interface ConnectionActor { userId: string; language: Language; profile: PublicPerson }
export type ConnectionNotice = "stale" | "invalid" | "disabled";
export type ConnectionView = { kind: "unavailable" } | {
	kind: ConnectionScreen;
	language: Language;
	festivalEnabled: boolean;
	visible: boolean;
	profile: PublicPerson;
	session: ConnectionSession;
	person: PublicPerson | null;
	hasNext: boolean;
	notice?: ConnectionNotice;
};
export type ConnectionAction =
	| { kind: "open"; screen: "home" | "profile" | "search" }
	| { kind: "visibility"; value: boolean }
	| { kind: "page"; delta: -1 | 1 }
	| { kind: "choose_filter"; field: FilterField }
	| { kind: "set_filter"; field: FilterField; value: string | null }
	| { kind: "reset_filters" };

export function filterChoices(field: FilterField): readonly string[] {
	switch (field) {
		case "eventStatus": return MFM_EVENT_STATUSES;
		case "sphere": return MFM_SPHERES;
		case "openTo": return MFM_OPEN_TO;
	}
}
export function parseConnectionState(value: unknown): ConnectionState {
	if (typeof value !== "object" || value === null) throw new Error("invalid connection state");
	const v = value as Record<string, unknown>;
	if (v.version !== 1 || typeof v.generation !== "string" || !/^[a-f0-9]{16}$/.test(v.generation) || !Number.isSafeInteger(v.offset) || (v.offset as number) < 0 || typeof v.filters !== "object" || v.filters === null) throw new Error("unsupported connection state");
	const raw = v.filters as Record<string, unknown>;
	const filters: SearchFilters = {};
	if (raw.eventStatus !== undefined) filters.eventStatus = mfmValue(raw.eventStatus, MFM_EVENT_STATUSES);
	if (raw.sphere !== undefined) filters.sphere = mfmValue(raw.sphere, MFM_SPHERES);
	if (raw.openTo !== undefined) filters.openTo = mfmValue(raw.openTo, MFM_OPEN_TO);
	return { version: 1, generation: v.generation, screen: mfmValue(v.screen, ["home", "profile", "search", "filter"]), filters, offset: v.offset as number,
		...(v.filterField === undefined || v.filterField === "specialization" ? {} : { filterField: mfmValue(v.filterField, FILTER_FIELDS) }),
		...(v.introduction === undefined ? {} : { introduction: parseIntroductionNavigation(v.introduction) }) };
}

export function isValidIntroductionMessage(message: string): boolean {
	// SQLite length(TEXT) counts Unicode code points, rather than UTF-16 units.
	const length = [...message].length;
	return message.trim() === message && length >= 10 && length <= 500 && !message.includes("\u0000");
}

function parseIntroductionNavigation(value: unknown): IntroductionNavigation {
	if (typeof value !== "object" || value === null) throw new Error("invalid introduction navigation");
	const v = value as Record<string, unknown>;
	if (v.screen === "list" && Number.isSafeInteger(v.offset) && (v.offset as number) >= 0) return { screen: "list", tab: mfmValue(v.tab, ["incoming", "sent", "accepted"]), offset: v.offset as number };
	if (v.screen === "request" && typeof v.token === "string" && /^[A-Za-z0-9_-]{22}$/.test(v.token)) return { screen: "request", token: v.token };
	if ((v.screen === "compose" || v.screen === "confirm") && typeof v.targetProfileId === "string" && /^[a-f0-9-]{36}$/.test(v.targetProfileId)) {
		if (v.message !== undefined && (typeof v.message !== "string" || !isValidIntroductionMessage(v.message))) throw new Error("invalid introduction draft");
		if (v.screen === "confirm") { if (typeof v.message !== "string") throw new Error("missing introduction message"); return { screen: "confirm", targetProfileId: v.targetProfileId, message: v.message }; }
		return { screen: "compose", targetProfileId: v.targetProfileId, ...(v.message === undefined ? {} : { message: v.message as string }) };
	}
	throw new Error("unsupported introduction navigation");
}
