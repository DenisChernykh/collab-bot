import { expect, it } from "vitest";
import { withFreshMigratedDatabase } from "../support/migrated-database.js";
import { connectionClock, connectionsFor, seedConnectionPerson } from "../support/connections-fixture.js";
import { SqliteOnboardingRepository } from "../../src/modules/profiles/infrastructure/sqlite-onboarding-repository.js";

it("discovery exposes only the confirmed photo and keeps existing visibility/privacy gates", async () => {
 await withFreshMigratedDatabase({ prefix: "mph-discovery-", clock: connectionClock }, async ({ boundary }) => {
  await seedConnectionPerson(boundary, 1); await seedConnectionPerson(boundary, 2);
  const repo = new SqliteOnboardingRepository(boundary); const person = (await repo.getProfile("2"))!;
  const photo = { fileId: "public_photo", botId: "777" };
  await repo.saveProfile("2", { ...person, photo }, 3);
  await repo.saveSession("2", { version: 1, generation: "a".repeat(16), step: "photo", draft: { ...person, photo }, editing: true, photoCandidate: { ...photo, fileId: "private_candidate" } }, 4);
  const { api } = connectionsFor(boundary); const view = await api.open("1", "search");
  expect(view).toMatchObject({ person: { photo } });
  expect(JSON.stringify(view)).not.toContain("private_candidate"); expect(JSON.stringify(view)).not.toContain("private_person");
  await repo.saveProfile("2", { ...person, photo: null }, 5);
  expect(await api.view("1")).toMatchObject({ person: { photo: null } });
  await boundary.execute("INSERT INTO mfm_discovery_settings VALUES (?, 0, 1, 5)", [person.profileId]);
  expect(await api.view("1")).toMatchObject({ person: null });
 });
});
