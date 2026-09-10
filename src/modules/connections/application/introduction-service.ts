import type { Clock } from "../../../shared/application/ports/clock.js";
import type { CryptoCapabilities } from "../../../shared/application/ports/crypto.js";
import type { TransactionRunner } from "../../../shared/application/ports/transaction-runner.js";
import type { OutboxDeliveryService } from "../../../shared/application/outbox/outbox-service.js";
import type { ConnectionActor, ConnectionProof, ConnectionSession } from "./connection-model.js";
import type { IntroductionAction, IntroductionNotice, IntroductionRecord, IntroductionRepository, IntroductionView } from "./introduction-contracts.js";
import { introductionNotification } from "./introduction-notification.js";

export class IntroductionService {
	constructor(private readonly repository: IntroductionRepository, private readonly transactions: TransactionRunner, private readonly clock: Clock, private readonly crypto: CryptoCapabilities, private readonly outbox: OutboxDeliveryService, private readonly botUsername: string, private readonly enabled: boolean) {}
	view(userId: string): Promise<IntroductionView> { return this.run(userId); }
	openRequest(userId: string, token: string): Promise<IntroductionView> { return this.run(userId, undefined, undefined, token); }
	act(userId: string, action: IntroductionAction, proof: ConnectionProof): Promise<IntroductionView> { return this.run(userId, action, proof); }
	private run(userId: string, action?: IntroductionAction, proof?: ConnectionProof, token?: string): Promise<IntroductionView> {
		return this.transactions.withTransaction(async () => {
			const actor = await this.repository.getActor(userId);
			if (actor === undefined) return { kind: "unavailable" };
			let session = await this.repository.getSession(userId) ?? await this.repository.saveSession(userId, { version: 1, generation: this.crypto.randomHex(8), screen: "home", filters: {}, offset: 0 }, this.clock.now().getTime());
			if (proof !== undefined && (proof.generation !== session.state.generation || proof.revision !== session.revision)) return this.render(actor, session, "stale");
			const next = { ...session.state };
			if (token !== undefined) {
				const request = /^[A-Za-z0-9_-]{22}$/.test(token) ? await this.repository.findRequest(token) : undefined;
				if (request === undefined || !this.isPair(actor, request)) return this.empty(actor, session, "unavailable");
				next.introduction = { screen: "request", token };
			}
			if (action !== undefined) {
				const nav = next.introduction;
				if (!this.enabled && ["begin", "message", "confirm", "edit_message"].includes(action.kind)) return this.render(actor, session, "disabled");
				switch (action.kind) {
					case "begin": {
						if (next.screen !== "search") return this.render(actor, session, "invalid");
						const target = (await this.repository.search(actor.profile.profileId, next.filters, next.offset)).person;
						if (target === null) return this.render(actor, session, "unavailable");
						const existing = await this.repository.findPair(actor.profile.profileId, target.profileId);
						next.introduction = existing === undefined ? { screen: "compose", targetProfileId: target.profileId } : { screen: "request", token: existing.token }; break;
					}
					case "message": {
						if (nav?.screen !== "compose") return this.render(actor, session);
						const message = action.value.trim();
						if (message.length < 10 || message.length > 500 || message.includes("\u0000")) return this.render(actor, session, "invalid");
						next.introduction = { screen: "confirm", targetProfileId: nav.targetProfileId, message }; break;
					}
					case "edit_message": if (nav?.screen !== "confirm") return this.render(actor, session, "invalid"); next.introduction = { ...nav, screen: "compose" }; break;
					case "confirm": {
						if (nav?.screen !== "confirm") return this.render(actor, session, "stale");
						const target = await this.repository.getPerson(nav.targetProfileId);
						if (target === undefined || target.profileId === actor.profile.profileId || !await this.repository.isVisible(target.profileId)) return this.render(actor, session, "unavailable");
						let request = await this.repository.findPair(actor.profile.profileId, target.profileId);
						if (request === undefined) {
							request = { id: this.crypto.uuid(), token: this.crypto.randomBase64Url(16), senderProfileId: actor.profile.profileId, recipientProfileId: target.profileId, message: nav.message, status: "pending", revision: 1, createdAt: this.clock.now().getTime(), decidedAt: null };
							await this.repository.insertRequest(request);
							await this.notify(request, target.profileId, actor.profile.displayName);
						}
						next.introduction = { screen: "request", token: request.token }; break;
					}
					case "cancel": delete next.introduction; break;
					case "list": next.introduction = { screen: "list", tab: action.tab, offset: 0 }; break;
					case "page": {
						if (nav?.screen !== "list") return this.render(actor, session, "invalid");
						if (action.delta === 1 && (await this.repository.listRequests(actor.profile.profileId, nav.tab, nav.offset)).length < 2) return this.render(actor, session, "invalid");
						next.introduction = { ...nav, offset: Math.max(0, nav.offset + action.delta) }; break;
					}
					case "show_request": {
						if (nav?.screen !== "list") return this.render(actor, session, "invalid");
						const [request] = await this.repository.listRequests(actor.profile.profileId, nav.tab, nav.offset);
						if (request === undefined) return this.render(actor, session, "unavailable");
						next.introduction = { screen: "request", token: request.token }; break;
					}
					case "decide": {
						if (nav?.screen !== "request") return this.render(actor, session, "invalid");
						const request = await this.repository.findRequest(nav.token);
						if (request === undefined || !this.isPair(actor, request)) return this.empty(actor, session, "unavailable");
						if (request.status !== "pending" || request.revision !== action.requestRevision) return this.render(actor, session, "stale");
						const permitted = action.decision === "withdrawn" ? request.senderProfileId === actor.profile.profileId : request.recipientProfileId === actor.profile.profileId;
						const otherId = this.otherId(actor, request);
						const counterpart = await this.repository.getPerson(otherId);
						if (!permitted || counterpart === undefined) return this.render(actor, session, "unavailable");
						const now = this.clock.now().getTime();
						await this.repository.decide(request, action.decision, now);
						const decided = { ...request, status: action.decision, revision: request.revision + 1, decidedAt: now };
						await this.notify(decided, request.senderProfileId, actor.profile.displayName);
						if (action.decision === "accepted") await this.notify(decided, request.recipientProfileId, counterpart.displayName);
						break;
					}
				}
			}
			if (token !== undefined || action !== undefined) session = await this.repository.saveSession(userId, next, this.clock.now().getTime());
			return this.render(actor, session);
		});
	}
	private isPair(actor: ConnectionActor, r: IntroductionRecord): boolean { return actor.profile.profileId === r.senderProfileId || actor.profile.profileId === r.recipientProfileId; }
	private otherId(actor: ConnectionActor, r: IntroductionRecord): string { return actor.profile.profileId === r.senderProfileId ? r.recipientProfileId : r.senderProfileId; }
	private empty(actor: ConnectionActor, session: ConnectionSession, notice?: IntroductionNotice): Exclude<IntroductionView, { kind: "unavailable" }> {
		return { kind: "none", language: actor.language, festivalEnabled: this.enabled, session, person: null, request: null, message: null, contactUrl: null, canAccept: false, canWithdraw: false, hasNext: false, ...(notice === undefined ? {} : { notice }) };
	}
	private async render(actor: ConnectionActor, session: ConnectionSession, notice?: IntroductionNotice): Promise<IntroductionView> {
		const result = this.empty(actor, session, notice);
		const nav = session.state.introduction;
		if (nav === undefined) return result;
		if (nav.screen === "compose" || nav.screen === "confirm") {
			if (!this.enabled) return { ...result, notice: notice ?? "disabled" };
			const person = await this.repository.getPerson(nav.targetProfileId);
			return person === undefined ? { ...result, notice: "unavailable" } : { ...result, kind: nav.screen, person, message: nav.message ?? null };
		}
		const rows = nav.screen === "list" ? await this.repository.listRequests(actor.profile.profileId, nav.tab, nav.offset) : [];
		const request = nav.screen === "list" ? rows[0] : await this.repository.findRequest(nav.token);
		if (request === undefined) return { ...result, kind: nav.screen, ...(nav.screen === "request" ? { notice: "unavailable" as const } : {}) };
		if (!this.isPair(actor, request)) return { ...result, notice: "unavailable" };
		const person = await this.repository.getPerson(this.otherId(actor, request));
		if (person === undefined) return { ...result, kind: nav.screen, hasNext: rows.length > 1, notice: "unavailable" };
		return { ...result, kind: nav.screen, person, request: { token: request.token, status: request.status, revision: request.revision, message: request.message }, hasNext: rows.length > 1,
			contactUrl: nav.screen === "request" && request.status === "accepted" ? await this.repository.getContactUrl(person.profileId) : null,
			canAccept: nav.screen === "request" && request.status === "pending" && request.recipientProfileId === actor.profile.profileId,
			canWithdraw: nav.screen === "request" && request.status === "pending" && request.senderProfileId === actor.profile.profileId };
	}
	private async notify(request: IntroductionRecord, recipientProfileId: string, senderName: string): Promise<void> {
		const recipient = await this.repository.getDeliveryTarget(recipientProfileId);
		if (recipient === undefined) throw new Error("introduction delivery target unavailable");
		await this.outbox.createWithinTransaction({ id: this.crypto.uuid(), idempotencyKey: `introduction:${request.id}:${request.status}:${recipientProfileId}:v1`, kind: "dm_send", recipientChatId: recipient.userId, payload: introductionNotification(request, senderName, recipient.language, this.botUsername) });
	}
}
