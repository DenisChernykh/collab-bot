import { expect, it } from "vitest";
import { parseDeliveryPayload, serializeDeliveryPayload } from "../../src/shared/application/outbox/delivery-payload.js";

it("allows only exact introduction bot links through the existing one-button delivery contract", () => {
	const payload = (url: string) => ({ version: 1, method: "send", text: "Synthetic introduction", replyMarkup: { inline_keyboard: [[{ text: "Open introduction", url }]] } });
	const token = "a".repeat(22);
	const valid = payload(`https://t.me/collab_bot?start=n_${token}`);
	expect(parseDeliveryPayload(serializeDeliveryPayload(valid))).toEqual(valid);
	for (const url of [`https://evil.example/collab_bot?start=n_${token}`, `https://t.me/collab_bot?start=n_${token}&extra=1`, `https://t.me/collab_bot?start=n_${token}x`, `https://t.me/collab_bot?start=x_${token}`]) expect(() => serializeDeliveryPayload(payload(url))).toThrow();
});
