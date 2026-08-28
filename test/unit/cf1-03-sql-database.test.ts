import { describe, expect, it } from "vitest";

import { DatabaseBoundary } from "../../src/platform/database/database-boundary.js";
import { NodeSqlDatabase } from "../../src/platform/database/node-sql-database.js";

describe("CF1-03 node SQL database", () => {
	it("normalizes execute results while preserving query values", async () => {
		const database = new NodeSqlDatabase(new DatabaseBoundary(":memory:"));
		try {
			expect(await database.execute("CREATE TABLE records (id INTEGER PRIMARY KEY, label TEXT NOT NULL)")).toEqual({ changes: 0 });
			expect(await database.execute("INSERT INTO records (label) VALUES (?)", ["first"])).toEqual({ changes: 1 });
			expect(await database.query<{ id: number; label: string }>("SELECT id, label FROM records ORDER BY id")).toEqual([{ id: 1, label: "first" }]);
		} finally {
			await database.close();
		}
	});

	it("keeps FIFO transactions and marks a caught nested failure rollback-only", async () => {
		const database = new NodeSqlDatabase(new DatabaseBoundary(":memory:"));
		try {
			await database.execute("CREATE TABLE records (id INTEGER PRIMARY KEY, label TEXT NOT NULL)");
			const order: number[] = [];
			await Promise.all([
				database.withTransaction(async () => {
					order.push(1);
					await database.execute("INSERT INTO records (label) VALUES (?)", ["first"]);
					await new Promise((resolve) => setTimeout(resolve, 5));
					order.push(2);
				}),
				database.withTransaction(async () => {
					order.push(3);
					await database.execute("INSERT INTO records (label) VALUES (?)", ["second"]);
				}),
			]);
			expect(order).toEqual([1, 2, 3]);

			await expect(database.withTransaction(async () => {
				await database.execute("INSERT INTO records (label) VALUES (?)", ["rolled-back"]);
				try {
					await database.withTransaction(async () => {
						await database.execute("INSERT INTO records (label) VALUES (?)", ["nested"]);
						throw new Error("nested failure");
					});
				} catch (error) {
					expect(error).toMatchObject({ message: "nested failure" });
				}
			})).rejects.toThrow("transaction marked rollback-only");
			expect(await database.query<{ label: string }>("SELECT label FROM records ORDER BY id")).toEqual([
				{ label: "first" },
				{ label: "second" },
			]);
		} finally {
			await database.close();
		}
	});

	it("rejects operations after lifecycle close", async () => {
		const database = new NodeSqlDatabase(new DatabaseBoundary(":memory:"));
		await database.close();
		await expect(database.query("SELECT 1")).rejects.toThrow("database boundary is closed");
	});
});
