import type { BrowseSessionRecord } from "../../application/ports/collaboration-browse-repository.js";

export type BrowseMutationKind = "next" | "reset" | "filters" | "filter" | "set";

export interface BrowseMutation {
	readonly kind: BrowseMutationKind;
	readonly dimension?: "target" | "format" | "topic";
	readonly value?: string;
	readonly generation: string;
	readonly revision: number;
}

export interface ApplicationStart {
	readonly publicToken: string;
	readonly source: "feed" | "deep_link";
}

export type MarketplaceCallback =
	| { readonly kind: "open_feed" }
	| { readonly kind: "own_applications" }
	| { readonly kind: "browse"; readonly mutation: BrowseMutation }
	| { readonly kind: "start_application"; readonly start: ApplicationStart };

export function parseMarketplaceCallback(data: string): MarketplaceCallback | undefined {
	if (data === "browse:start") return { kind: "open_feed" };
	if (data === "application:own") return { kind: "own_applications" };
	const mutation = parseBrowseMutation(data);
	if (mutation !== undefined) return { kind: "browse", mutation };
	const start = parseApplicationStart(data);
	return start === undefined ? undefined : { kind: "start_application", start };
}

export function browseCallback(action: string, session: BrowseSessionRecord): string {
	return `${action}:${session.generation}:${session.revision.toString(36)}`;
}

export function applicationStartCallback(source: ApplicationStart["source"], publicToken: string): string {
	return `application:start:${source === "feed" ? "f" : "d"}:${publicToken}`;
}

function parseBrowseMutation(data: string): BrowseMutation | undefined {
	let match = /^b:(n|r|fs):([0-9a-f]{16}):([0-9a-z]+)$/.exec(data);
	if (match?.[1] !== undefined && match[2] !== undefined && match[3] !== undefined) {
		const revision = parseBase36Revision(match[3]);
		const kind = ({ n: "next", r: "reset", fs: "filters" } as const)[match[1] as "n" | "r" | "fs"];
		return revision === undefined ? undefined : { kind, generation: match[2], revision };
	}
	match = /^b:f:(t|f|o):([0-9a-f]{16}):([0-9a-z]+)$/.exec(data);
	if (match?.[1] !== undefined && match[2] !== undefined && match[3] !== undefined) {
		const revision = parseBase36Revision(match[3]);
		const dimension = parseBrowseDimensionCode(match[1]);
		return revision === undefined || dimension === undefined ? undefined : { kind: "filter", dimension, generation: match[2], revision };
	}
	match = /^b:s:(t|f|o):([a-z_]+):([0-9a-f]{16}):([0-9a-z]+)$/.exec(data);
	if (match?.[1] !== undefined && match[2] !== undefined && match[3] !== undefined && match[4] !== undefined) {
		const revision = parseBase36Revision(match[4]);
		const dimension = parseBrowseDimensionCode(match[1]);
		return revision === undefined || dimension === undefined ? undefined : { kind: "set", dimension, value: match[2], generation: match[3], revision };
	}
	return undefined;
}

function parseApplicationStart(data: string): ApplicationStart | undefined {
	const match = /^application:start:(f|d):([A-Za-z0-9_-]{22})$/.exec(data);
	if (match?.[1] === undefined || match[2] === undefined) return undefined;
	return { publicToken: match[2], source: match[1] === "f" ? "feed" : "deep_link" };
}

function parseBase36Revision(value: string): number | undefined {
	const revision = Number.parseInt(value, 36);
	return Number.isSafeInteger(revision) && revision >= 0 ? revision : undefined;
}

function parseBrowseDimensionCode(value: string): NonNullable<BrowseMutation["dimension"]> | undefined {
	if (value === "t") return "target";
	if (value === "f") return "format";
	if (value === "o") return "topic";
	return undefined;
}
