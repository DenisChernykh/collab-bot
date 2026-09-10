import type { Clock } from "../../../shared/application/ports/clock.js";
import type { CryptoCapabilities } from "../../../shared/application/ports/crypto.js";
import type { TransactionRunner } from "../../../shared/application/ports/transaction-runner.js";
import { filterChoices, parseConnectionState, type ConnectionAction, type ConnectionActor, type ConnectionNotice, type ConnectionProof, type ConnectionSession, type ConnectionView } from "./connection-model.js";
import type { ConnectionRepository } from "./ports/connection-repository.js";

export class ConnectionService {
	constructor(private readonly repository: ConnectionRepository, private readonly transactions: TransactionRunner, private readonly clock: Clock, private readonly crypto: CryptoCapabilities, private readonly enabled: boolean) {}
	view(userId: string): Promise<ConnectionView> { return this.run(userId); }
	open(userId: string, screen: "home" | "profile" | "search"): Promise<ConnectionView> { return this.run(userId, { kind: "open", screen }); }
	act(userId: string, action: ConnectionAction, proof: ConnectionProof): Promise<ConnectionView> { return this.run(userId, action, proof); }
	private run(userId: string, action?: ConnectionAction, proof?: ConnectionProof): Promise<ConnectionView> {
		return this.transactions.withTransaction(async () => {
			const actor = await this.repository.getActor(userId);
			if (actor === undefined) return { kind: "unavailable" };
			let session = await this.repository.getSession(userId) ?? await this.repository.saveSession(userId, { version: 1, generation: this.crypto.randomHex(8), screen: "home", filters: {}, offset: 0 }, this.clock.now().getTime());
			if (proof !== undefined && (proof.generation !== session.state.generation || proof.revision !== session.revision)) return this.render(actor, session, "stale");
			if (action !== undefined) {
				if (!this.enabled && !(action.kind === "visibility" && !action.value) && !(action.kind === "open" && action.screen !== "search")) return this.render(actor, session, "disabled");
				const next = { ...session.state, filters: { ...session.state.filters } };
				delete next.introduction;
				switch (action.kind) {
					case "open": next.screen = action.screen; break;
					case "visibility": await this.repository.setVisible(actor.profile.profileId, action.value, this.clock.now().getTime()); break;
					case "choose_filter": next.screen = "filter"; next.filterField = action.field; break;
					case "page": {
						if (next.screen !== "search" || (action.delta === 1 && !(await this.repository.search(actor.profile.profileId, next.filters, next.offset)).hasNext)) return this.render(actor, session, "invalid");
						next.offset = Math.max(0, next.offset + action.delta); break;
					}
					case "reset_filters": next.filters = {}; next.offset = 0; next.screen = "search"; break;
					case "set_filter": {
						if (action.value !== null && !filterChoices(action.field, next.filters).includes(action.value)) return this.render(actor, session, "invalid");
						const raw = { ...next.filters, [action.field]: action.value ?? undefined };
						next.filters = parseConnectionState({ ...next, filters: raw }).filters; next.offset = 0; next.screen = "search"; break;
					}
				}
				session = await this.repository.saveSession(userId, next, this.clock.now().getTime());
			}
			return this.render(actor, session);
		});
	}
	private async render(actor: ConnectionActor, session: ConnectionSession, notice?: ConnectionNotice): Promise<ConnectionView> {
		const disabledScreen = !this.enabled && (session.state.screen === "search" || session.state.screen === "filter");
		const kind = disabledScreen ? "home" : session.state.screen;
		const page = kind === "search" ? await this.repository.search(actor.profile.profileId, session.state.filters, session.state.offset) : { person: null, hasNext: false };
		const message = notice ?? (disabledScreen ? "disabled" : undefined);
		return { kind, language: actor.language, festivalEnabled: this.enabled, visible: await this.repository.isVisible(actor.profile.profileId), profile: actor.profile, session, ...page, ...(message === undefined ? {} : { notice: message }) };
	}
}
