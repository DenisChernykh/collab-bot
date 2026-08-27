export interface ApplicationStart {
	readonly publicToken: string;
	readonly source: "feed" | "deep_link";
}

export type ApplicationsCallback =
	| { readonly kind: "own_applications" }
	| { readonly kind: "start_application"; readonly start: ApplicationStart };

export function parseApplicationsCallback(data: string): ApplicationsCallback | undefined {
	if (data === "application:own") return { kind: "own_applications" };
	const start = parseApplicationStart(data);
	return start === undefined ? undefined : { kind: "start_application", start };
}

export function applicationStartCallback(source: ApplicationStart["source"], publicToken: string): string {
	return `application:start:${source === "feed" ? "f" : "d"}:${publicToken}`;
}

function parseApplicationStart(data: string): ApplicationStart | undefined {
	const match = /^application:start:(f|d):([A-Za-z0-9_-]{22})$/.exec(data);
	if (match?.[1] === undefined || match[2] === undefined) return undefined;
	return { publicToken: match[2], source: match[1] === "f" ? "feed" : "deep_link" };
}
