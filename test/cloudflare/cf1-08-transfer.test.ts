/// <reference types="@cloudflare/vitest-plugin/types" />

import { env } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import { CloudflareSqlDatabase } from "../../src/platform/database/cloudflare-sql-database.js";
import { exportStateTransferManifest, importStateTransferManifest } from "../../src/platform/database/state-transfer.js";

describe("CF1-08 local Durable Object transfer", () => {
	it("preserves the logical digest across a local DO export/import", async () => {
		const source = env.COLLABORATION_STATE.get(env.COLLABORATION_STATE.idFromName("cf1-08-transfer-source"));
		const target = env.COLLABORATION_STATE.get(env.COLLABORATION_STATE.idFromName("cf1-08-transfer-target"));
		await source.fetch("https://local/__cf1/ready");
		const manifest = await runInDurableObject(source, async (_instance, state) => {
			const database = new CloudflareSqlDatabase(state.storage);
			await database.execute(
				"INSERT INTO telegram_users (telegram_user_id, username, display_name, status, blocked_at, created_at, updated_at) VALUES (?, ?, ?, 'active', NULL, ?, ?)",
				["8001", "transfer_user", "Transfer User", 3_000_000, 3_000_000],
			);
			return exportStateTransferManifest(database);
		});

		await target.fetch("https://local/__cf1/ready");
		const imported = await runInDurableObject(target, async (_instance, state) => {
			const database = new CloudflareSqlDatabase(state.storage);
			return importStateTransferManifest(database, manifest, () => 3_000_001);
		});
		expect(imported).toMatchObject({ digest: manifest.digest, tableCount: 17, rowCount: 1 });
		const targetManifest = await runInDurableObject(target, (_instance, state) => exportStateTransferManifest(new CloudflareSqlDatabase(state.storage)));
		expect(targetManifest.digest).toBe(manifest.digest);
	});
});
