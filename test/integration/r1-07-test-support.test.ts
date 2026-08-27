import { stat } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import type { DatabaseBoundary } from "../../src/infrastructure/database/database-boundary.js";
import { FakeClock } from "../../src/infrastructure/time/fake-clock.js";
import { withFreshMigratedDatabase } from "../support/migrated-database.js";

const ALL_MIGRATIONS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13] as const;

describe("R1-07 production-like test support", () => {
	it("creates independent migrated databases on repeated runs and cleans each fixture", async () => {
		const directories: string[] = [];

		await withFreshMigratedDatabase({
			prefix: "collaboration-r1-07-repeat-",
			clock: new FakeClock(1_700_000_000_000),
		}, async (fixture) => {
			directories.push(fixture.directory);
			expect(fixture.appliedMigrations).toEqual(ALL_MIGRATIONS);
			await fixture.boundary.execute("CREATE TABLE fixture_probe (id INTEGER PRIMARY KEY)");
		});

		await withFreshMigratedDatabase({
			prefix: "collaboration-r1-07-repeat-",
			clock: new FakeClock(1_700_000_000_000),
		}, async (fixture) => {
			directories.push(fixture.directory);
			expect(fixture.appliedMigrations).toEqual(ALL_MIGRATIONS);
			expect(await fixture.boundary.query(
				"SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'fixture_probe'",
			)).toEqual([]);
		});

		expect(new Set(directories).size).toBe(2);
		for (const directory of directories) await expect(stat(directory)).rejects.toMatchObject({ code: "ENOENT" });
	});

	it("closes the boundary and removes the directory when fixture work fails", async () => {
		let failedDirectory: string | undefined;
		let failedBoundary: DatabaseBoundary | undefined;
		const failure = new Error("fixture work failed");

		await expect(withFreshMigratedDatabase({
			prefix: "collaboration-r1-07-failure-",
			clock: new FakeClock(1_700_000_000_000),
		}, async (fixture) => {
			failedDirectory = fixture.directory;
			failedBoundary = fixture.boundary;
			throw failure;
		})).rejects.toBe(failure);

		if (failedDirectory === undefined || failedBoundary === undefined) throw new Error("fixture was not created");
		const closedBoundary = failedBoundary as DatabaseBoundary;
		await expect(stat(failedDirectory)).rejects.toMatchObject({ code: "ENOENT" });
		expect(() => closedBoundary.query("SELECT 1")).toThrow(/closed/i);
	});
});
