import { expect, it } from "vitest";
import { renderOnboarding } from "../../src/modules/profiles/presentation/telegram/mfm-presentation.js";
import { decodeMfmCallback } from "../../src/modules/profiles/presentation/telegram/mfm-callback-codec.js";
import { MFM_SPECIALIZATIONS, MFM_SPHERES } from "../../src/modules/profiles/domain/mfm-profile.js";
import type { OnboardingView } from "../../src/modules/profiles/application/onboarding-service.js";

it.each(["ru", "en"] as const)("renders selected choices and bounded callbacks in %s", (language) => {
	const view: OnboardingView = { kind: "step", language, festivalEnabled: true, session: { state: { version: 1, generation: "a".repeat(16), step: "spheres", draft: { spheres: ["media"] }, editing: false, page: 0 }, revision: 12, updatedAt: 100 } };
	const rendered = renderOnboarding(view);
	const buttons = rendered.keyboard.inline_keyboard.flat();
	expect(buttons.some((b) => b.text.startsWith("✅") && /Медиа|Media/.test(b.text))).toBe(true);
	for (const b of buttons) {
		if (!("callback_data" in b)) continue;
		expect(Buffer.byteLength(b.callback_data)).toBeLessThanOrEqual(64);
		expect(decodeMfmCallback(b.callback_data)).toBeDefined();
	}
	for (const sphere of MFM_SPHERES) {
		const rendered = renderOnboarding({ ...view, session: { ...view.session, state: { ...view.session.state, step: "specializations", draft: { spheres: [sphere] } } } });
		expect(rendered.keyboard.inline_keyboard.flat().filter((b) => "callback_data" in b && decodeMfmCallback(b.callback_data)?.action.kind === "choice")).toHaveLength(MFM_SPECIALIZATIONS[sphere].length);
		expect(rendered.text).not.toContain("undefined");
	}
});
it("keeps menus out of incomplete and paused profiles", () => {
	const rendered = renderOnboarding({ kind: "paused", language: "en", festivalEnabled: false });
	expect(rendered.text).not.toMatch(/MFM|МФМ|collaboration/);
	expect(rendered.keyboard.inline_keyboard.flat()).toEqual([]);
	expect(decodeMfmCallback("m:a:NaN:c:0")).toBeUndefined();
});
