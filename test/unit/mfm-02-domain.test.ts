import { expect, it } from "vitest";
import { validateMfmProfile, MFM_SPECIALIZATIONS } from "../../src/modules/profiles/domain/mfm-profile.js";
const input = { eventStatus: "participant", displayName: "Lucas Almeida", profileType: "specialist", locationText: "São Paulo, Brazil", spheres: ["digital_it"], specializations: ["ai"], openTo: ["joint_projects"] };
it("validates a structured person without a classic platform or profile type", () => {
	expect(validateMfmProfile(input)).toEqual(input);
	expect(Object.values(MFM_SPECIALIZATIONS).flat()).toHaveLength(42);
});
it.each([
	{ spheres: [] }, { spheres: ["media", "media"] }, { spheres: ["media", "digital_it", "creative_industries", "entrepreneurship"] },
	{ specializations: [] }, { specializations: ["blogger"] }, { specializations: ["ai", "data", "development", "cybersecurity"] },
	{ openTo: [] }, { openTo: ["anything"] }, { profileType: "blogger" }, { eventStatus: "anything" }, { locationText: " " },
])("rejects invalid or unselected structured values %j", (patch) => expect(() => validateMfmProfile({ ...input, ...patch })).toThrow());
