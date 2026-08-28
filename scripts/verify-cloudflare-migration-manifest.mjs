import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";

import {
	CLOUDFLARE_MIGRATION_MANIFEST,
	CLOUDFLARE_MIGRATION_MANIFEST_DIGEST,
} from "../dist/platform/database/cloudflare-migration-manifest.js";

const filenames = (await readdir("migrations"))
	.filter((filename) => /^\d{4}_[a-z][a-z0-9_-]*\.sql$/u.test(filename))
	.sort();
const source = await Promise.all(
	filenames.map(async (filename) => {
		const sql = await readFile(`migrations/${filename}`, "utf8");
		return {
			id: Number(filename.slice(0, 4)),
			filename,
			sql,
			checksum: createHash("sha256").update(sql, "utf8").digest("hex"),
		};
	}),
);

if (JSON.stringify(source) !== JSON.stringify(CLOUDFLARE_MIGRATION_MANIFEST)) {
	throw new Error("Cloudflare migration manifest drift detected");
}

const canonical = source.map(({ id, filename, checksum }) => `${id}:${filename}:${checksum}`).join("\n");
const digest = createHash("sha256").update(canonical, "utf8").digest("hex");
if (digest !== CLOUDFLARE_MIGRATION_MANIFEST_DIGEST) {
	throw new Error("Cloudflare migration manifest digest mismatch");
}
