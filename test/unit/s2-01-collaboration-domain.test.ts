import { describe, expect, it } from "vitest";

import { validateCollaborationDraftInput } from "../../src/domain/collaborations/collaboration.js";
import { renderCollaborationCard } from "../../src/application/collaborations/collaboration-renderer.js";
import { DomainValidationError } from "../../src/domain/value-objects/enums.js";

const now = new Date("2023-11-14T10:00:00.000Z").getTime();

describe("S2-01 collaboration domain", () => {
	it("validates draft fields and Yekaterinburg calendar boundaries", () => {
		expect(validateCollaborationDraftInput({
			format: "joint_content",
			targetProfileType: "blogger",
			topics: ["city", "food"],
			title: "Городской проект",
			offerText: "Снимем и опубликуем совместный материал.",
			expectationText: "Нужен партнёр, который согласует участие.",
			slotsTotal: 2,
			responseDeadlineDate: "20.11.2023",
			eventDateLocal: "25.11.2023",
		}, now)).toMatchObject({ responseDeadlineAt: expect.any(Number) });
	});

	it("rejects invalid lengths, dates and duplicate topics", () => {
		expect(() => validateCollaborationDraftInput({ title: "bad" }, now)).toThrow(DomainValidationError);
		expect(() => validateCollaborationDraftInput({ topics: ["city", "city"] }, now)).toThrow("unique");
		expect(() => validateCollaborationDraftInput({ responseDeadlineDate: "15.11.2023", eventDateLocal: "14.11.2023" }, now)).toThrow("event date");
		expect(() => validateCollaborationDraftInput({ responseDeadlineDate: "20.02.2024" }, now)).toThrow("90 days");
	});

	it("keeps persisted deadline snapshots valid through the local deadline day", () => {
		const persisted = validateCollaborationDraftInput({ responseDeadlineDate: "20.11.2023" }, now);
		if (persisted.responseDeadlineAt === undefined) throw new Error("expected normalized deadline");
		const deadlineDay = new Date("2023-11-20T07:00:00.000Z").getTime();
		expect(validateCollaborationDraftInput({ responseDeadlineDate: "20.11.2023", responseDeadlineAt: persisted.responseDeadlineAt }, deadlineDay, { allowPersistedDeadline: true })).toMatchObject({ responseDeadlineAt: persisted.responseDeadlineAt });
		expect(() => validateCollaborationDraftInput({ responseDeadlineDate: "20.11.2023" }, deadlineDay)).toThrow("future date");
	});

	it("renders escaped preview without identity tokens and enforces UTF-16 length", () => {
		const rendered = renderCollaborationCard({ title: "<script>", offerText: "Offer & details", expectationText: "A safe partner.", topics: ["city"] });
		expect(rendered).toContain("&lt;script&gt;");
		expect(rendered).toContain("Offer &amp; details");
		expect(rendered).not.toContain("public_token");
	});
});
