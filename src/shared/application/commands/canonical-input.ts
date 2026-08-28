export type CanonicalInput =
	| null
	| boolean
	| number
	| string
	| readonly CanonicalInput[]
	| { readonly [key: string]: CanonicalInput };

export function canonicalizeInput(value: unknown): string {
	return canonicalize(value, new Set<object>());
}

function canonicalize(value: unknown, seen: Set<object>): string {
	if (value === null) {
		return "null";
	}
	if (typeof value === "string" || typeof value === "boolean") {
		return JSON.stringify(value);
	}
	if (typeof value === "number") {
		if (!Number.isFinite(value)) {
			throw new TypeError("canonical input numbers must be finite");
		}
		return JSON.stringify(value);
	}
	if (typeof value !== "object") {
		throw new TypeError("canonical input must contain JSON values only");
	}
	if (seen.has(value)) {
		throw new TypeError("canonical input cannot contain cycles");
	}
	seen.add(value);
	try {
		if (Array.isArray(value)) {
			return `[${value.map((item) => canonicalize(item, seen)).join(",")}]`;
		}
		const prototype = Object.getPrototypeOf(value);
		if (prototype !== Object.prototype && prototype !== null) {
			throw new TypeError("canonical input must contain plain objects");
		}
		const entries = Object.entries(value).sort(([left], [right]) => {
			if (left < right) return -1;
			if (left > right) return 1;
			return 0;
		});
		return `{${entries
			.map(([key, item]) => `${JSON.stringify(key)}:${canonicalize(item, seen)}`)
			.join(",")}}`;
	} finally {
		seen.delete(value);
	}
}
