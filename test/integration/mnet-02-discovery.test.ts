import { expect, it } from "vitest";
import { withFreshMigratedDatabase } from "../support/migrated-database.js";
import { connectionClock, connectionProfileId, connectionsFor, seedConnectionPerson } from "../support/connections-fixture.js";
import type { ConnectionView, ConnectionAction } from "../../src/modules/connections/application/index.js";

function proof(view: ConnectionView) { if (view.kind === "unavailable") throw new Error("unavailable fixture"); return { generation: view.session.state.generation, revision: view.session.revision }; }

it("discovers completed MFM people by default with optional filters, never implicit intent matching", async () => {
	await withFreshMigratedDatabase({ prefix: "mnet-search-", clock: connectionClock }, async ({ boundary }) => {
		for (const id of [1, 2, 3]) await seedConnectionPerson(boundary, id, { eventStatus: id === 2 ? "volunteer" : "participant", openTo: [id === 3 ? "professional_communication" : "joint_projects"] });
		await seedConnectionPerson(boundary, 4, { experience: "classic" });
		await seedConnectionPerson(boundary, 5, { incomplete: true });
		await seedConnectionPerson(boundary, 6, { blocked: true });
		const { api } = connectionsFor(boundary);
		const act = async (id: string, action: ConnectionAction) => api.act(id, action, proof(await api.view(id)));
		expect(await api.view("1")).toMatchObject({ kind: "home", visible: true });
		await boundary.execute("INSERT INTO mfm_discovery_settings VALUES (?, 1, 1, 1)", [connectionProfileId(6)]);
		const first = await api.open("1", "search");
		expect(first).toMatchObject({ kind: "search", person: { profileId: connectionProfileId(2) }, hasNext: true });
		expect(JSON.stringify(first)).not.toContain("private_person");
		expect(await act("1", { kind: "page", delta: 1 })).toMatchObject({ person: { profileId: connectionProfileId(3), openTo: ["professional_communication"] }, hasNext: false });
		expect(await act("1", { kind: "set_filter", field: "openTo", value: "joint_projects" })).toMatchObject({ person: { profileId: connectionProfileId(2) }, hasNext: false });
		expect(await act("1", { kind: "set_filter", field: "eventStatus", value: "participant" })).toMatchObject({ person: null });
		expect(await act("1", { kind: "reset_filters" })).toMatchObject({ person: { profileId: connectionProfileId(2) }, hasNext: true });
		await act("1", { kind: "set_filter", field: "sphere", value: "digital_it" });
		expect(await act("1", { kind: "set_filter", field: "specialization", value: "ai" })).toMatchObject({ person: { profileId: connectionProfileId(2) } });
		const changed = await act("1", { kind: "set_filter", field: "sphere", value: "media" });
		expect(changed).toMatchObject({ person: null });
		if (changed.kind !== "unavailable") expect(changed.session.state.filters.specialization).toBeUndefined();
		for (const id of ["4", "5", "6"]) expect(await api.open(id, "search")).toMatchObject({ kind: "unavailable" });
	});
});

it("persists navigation and rejects stolen/stale callbacks or arbitrary categories without mutation", async () => {
	await withFreshMigratedDatabase({ prefix: "mnet-session-", clock: connectionClock }, async ({ boundary }) => {
		await seedConnectionPerson(boundary, 1, { language: "en" }); await seedConnectionPerson(boundary, 2);
		const { api } = connectionsFor(boundary);
		const old = await api.view("1"); const other = await api.view("2");
		const current = await api.open("1", "profile");
		expect(await api.act("1", { kind: "visibility", value: true }, proof(old))).toMatchObject({ visible: true, notice: "stale" });
		expect(await api.act("1", { kind: "visibility", value: true }, proof(other))).toMatchObject({ visible: true, notice: "stale" });
		expect(await api.act("1", { kind: "set_filter", field: "sphere", value: "free text" }, proof(current))).toMatchObject({ notice: "invalid" });
		expect((await connectionsFor(boundary).api.view("1"))).toEqual(current);
		const filtered = await api.act("1", { kind: "set_filter", field: "sphere", value: "digital_it" }, proof(current));
		expect(await connectionsFor(boundary).api.view("1")).toEqual(filtered);
		expect(await boundary.query("SELECT * FROM mfm_discovery_settings")).toEqual([]);
	});
});

it("feature shutdown preserves consent and navigation, blocks discovery/enabling, permits hiding", async () => {
	await withFreshMigratedDatabase({ prefix: "mnet-flag-", clock: connectionClock }, async ({ boundary }) => {
		await seedConnectionPerson(boundary, 1);
		const { api } = connectionsFor(boundary);
		await api.open("1", "search");
		const disabled = connectionsFor(boundary, false).api;
		expect(await disabled.view("1")).toMatchObject({ kind: "home", visible: true, festivalEnabled: false, notice: "disabled" });
		expect(await disabled.open("1", "search")).toMatchObject({ kind: "home", notice: "disabled" });
		const hidden = await disabled.act("1", { kind: "visibility", value: false }, proof(await disabled.view("1")));
		expect(hidden).toMatchObject({ visible: false });
		expect(await disabled.act("1", { kind: "visibility", value: true }, proof(hidden))).toMatchObject({ visible: false, notice: "disabled" });
		expect(await api.open("1", "search")).toMatchObject({ kind: "search" });
	});
});
