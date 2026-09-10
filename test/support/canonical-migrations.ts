import { readdirSync } from "node:fs";

// Fixture boot checks follow the SQL files; focused upgrade tests pin their starting schema.
export const CURRENT_MIGRATION_IDS = readdirSync(new URL("../../migrations/", import.meta.url))
	.filter((name) => /^\d{4}_.+\.sql$/u.test(name))
	.sort()
	.map((name) => Number(name.slice(0, 4)));
export const CURRENT_SCHEMA_VERSION = CURRENT_MIGRATION_IDS.length;
