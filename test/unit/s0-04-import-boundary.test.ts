import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

async function sourceFiles(directory: string): Promise<string[]> {
	const entries = await readdir(directory, { recursive: true });
	return entries
		.filter((entry) => entry.endsWith(".ts"))
		.map((entry) => join(directory, entry));
}

describe("application import boundary", () => {
	it("keeps application and domain independent from infrastructure/runtime implementations", async () => {
		const roots = [
			fileURLToPath(new URL("../../src/application/", import.meta.url)),
			fileURLToPath(new URL("../../src/domain/", import.meta.url)),
		];
		const files = (await Promise.all(roots.map((root) => sourceFiles(root)))).flat();
		const forbidden = /infrastructure|node:sqlite|drizzle-orm/;
		for (const file of files) {
			expect(await readFile(file, "utf8"), file).not.toMatch(forbidden);
		}
	});
});
