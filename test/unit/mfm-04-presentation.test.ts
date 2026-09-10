import { expect, it } from "vitest";
import { renderOnboarding } from "../../src/modules/profiles/presentation/telegram/mfm-presentation.js";
import { decodeMfmCallback } from "../../src/modules/profiles/presentation/telegram/mfm-callback-codec.js";
import type { OnboardingView } from "../../src/modules/profiles/application/onboarding-service.js";

it.each(["ru", "en"] as const)("renders selected choices and bounded callbacks in %s", (language) => {
	const view: OnboardingView = { kind: "step", language, festivalEnabled: true, session: { state: { version: 1, generation: "a".repeat(16), step: "spheres", draft: { spheres: ["media"] }, editing: false, page: 0 }, revision: 12, updatedAt: 100 } };
	const rendered = renderOnboarding(view);
	if (!("inline_keyboard" in rendered.keyboard)) throw new Error("expected inline keyboard");
	const buttons = rendered.keyboard.inline_keyboard.flat();
	expect(buttons.some((b) => b.text.startsWith("✅") && /Медиа|Media/.test(b.text))).toBe(true);
	for (const b of buttons) {
		if (!("callback_data" in b)) continue;
		expect(Buffer.byteLength(b.callback_data)).toBeLessThanOrEqual(64);
		expect(decodeMfmCallback(b.callback_data)).toBeDefined();
	}
	expect(rendered.text).not.toContain("undefined");
	expect(rendered.text).toContain(language === "ru" ? "Выбрано: 1 из 3" : "Selected: 1 of 3");
	expect(buttons).toContainEqual(expect.objectContaining({ text: language === "ru" ? "Продолжить →" : "Continue →" }));
	const contact = renderOnboarding({ ...view, session: { ...view.session, state: { ...view.session.state, step: "contact" } } });
	const pickerButtons = (contact.keyboard as { keyboard?: { request_chat?: { chat_is_channel: boolean; request_id: number } }[][] }).keyboard?.flat() ?? [];
	expect(pickerButtons.filter((button) => button.request_chat !== undefined).map((button) => button.request_chat?.chat_is_channel)).toEqual([true, false]);
	expect(new Set(pickerButtons.flatMap((button) => button.request_chat?.request_id ?? []))).toHaveLength(2);
});
it("keeps menus out of incomplete and paused profiles", () => {
	const rendered = renderOnboarding({ kind: "paused", language: "en", festivalEnabled: false });
	expect(rendered.text).not.toMatch(/MFM|МФМ|collaboration/);
	if (!("inline_keyboard" in rendered.keyboard)) throw new Error("expected inline keyboard");
	expect(rendered.keyboard.inline_keyboard.flat()).toEqual([]);
	expect(decodeMfmCallback("m:a:NaN:c:0")).toBeUndefined();
});
