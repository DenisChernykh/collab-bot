import { describe, expect, it } from "vitest";

import { ApplicationService } from "../../src/modules/applications/application/application-feature.js";
import type {
	OutboxDeliveryRecord,
	OutboxDeliveryStore,
} from "../../src/shared/application/ports/outbox-delivery-store.js";
import type { TransactionRunner } from "../../src/shared/application/ports/transaction-runner.js";
import { FakeClock } from "../support/fake-clock.js";

const NOW = 1_700_000_100_000;
const COLLABORATION_ID = "11111111-1111-4111-8111-111111111111";
const AUTHOR_PROFILE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const APPLICANT_A_PROFILE_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const APPLICANT_B_PROFILE_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const APPLICATION_A_ID = "22222222-2222-4222-8222-222222222222";
const APPLICATION_B_ID = "33333333-3333-4333-8333-333333333333";
const PUBLIC_TOKEN = "AAAAAAAAAAAAAAAAAAAAAA";

describe("S3-04 application decisions", () => {
	it("accepts one pending application, advances the public projection, and creates only pairwise contact intents", async () => {
		const fixture = decisionFixture({ slotsTotal: 2 });
		const result = await fixture.service.decide({
			telegramUserId: "100",
			applicationId: APPLICATION_A_ID,
			decision: "accept",
			occurredAt: NOW,
		});

		expect(result).toMatchObject({
			ok: true,
			applicationId: APPLICATION_A_ID,
			applicationStatus: "accepted",
			collaborationId: COLLABORATION_ID,
			collaborationStatus: "published",
			acceptedCount: 1,
			projectionRevision: 9,
		});
		expect(fixture.store.application(APPLICATION_A_ID)).toMatchObject({
			status: "accepted",
			decidedByProfileId: AUTHOR_PROFILE_ID,
			decidedAt: NOW,
		});
		expect(fixture.store.collaboration()).toMatchObject({ status: "published", matchedAt: null, projectionRevision: 9 });

		const deliveries = fixture.outbox.records();
		expect(deliveries.map((delivery) => delivery.idempotencyKey).sort()).toEqual([
			`application:${APPLICATION_A_ID}:accepted:applicant:v1`,
			`application:${APPLICATION_A_ID}:accepted:author:v1`,
			`channel:${COLLABORATION_ID}:projection:9`,
		].sort());
		const authorDm = requireDelivery(deliveries, `application:${APPLICATION_A_ID}:accepted:author:v1`);
		const applicantDm = requireDelivery(deliveries, `application:${APPLICATION_A_ID}:accepted:applicant:v1`);
		const projection = requireDelivery(deliveries, `channel:${COLLABORATION_ID}:projection:9`);
		expect(authorDm).toMatchObject({ kind: "dm_send", recipientChatId: "100" });
		expect(applicantDm).toMatchObject({ kind: "dm_send", recipientChatId: "200" });
		expect(singleButtonUrl(authorDm)).toBe("https://t.me/candidate_a");
		expect(singleButtonUrl(applicantDm)).toBe("tg://user?id=100");
		expect(projection).toMatchObject({ kind: "channel_edit", recipientChatId: "-100777", messageId: 77 });
		expect(projection.payload.method === "edit" ? projection.payload.text : "").toContain("Осталось мест: 1");
		expect(JSON.stringify(deliveries)).not.toContain("callback_data");
		expect(JSON.stringify(authorDm)).not.toContain("300");
	});

	it("fills the last slot exactly once, matches the collaboration, and closes every other pending application", async () => {
		const fixture = decisionFixture({ slotsTotal: 1 });
		const result = await fixture.service.decide({
			telegramUserId: "100",
			applicationId: APPLICATION_A_ID,
			decision: "accept",
			occurredAt: NOW,
		});

		expect(result).toMatchObject({
			ok: true,
			applicationStatus: "accepted",
			collaborationStatus: "matched",
			acceptedCount: 1,
			projectionRevision: 9,
		});
		expect(fixture.store.application(APPLICATION_A_ID).status).toBe("accepted");
		expect(fixture.store.application(APPLICATION_B_ID).status).toBe("closed");
		expect(fixture.store.acceptedCount()).toBe(1);
		expect(fixture.store.pendingCount()).toBe(0);
		expect(fixture.store.collaboration()).toMatchObject({
			status: "matched",
			matchedAt: NOW,
			projectionRevision: 9,
		});
		expect(fixture.outbox.records().map((delivery) => delivery.idempotencyKey)).toContain(
			`application:${APPLICATION_B_ID}:closed:v1`,
		);
		expect(fixture.outbox.records().filter((delivery) => delivery.kind === "channel_edit")).toHaveLength(1);
	});

	it("notifies every accepted pair when a later accept fills the last slot", async () => {
		const fixture = decisionFixture({ slotsTotal: 2 });
		fixture.store.seedAccepted(APPLICATION_A_ID, NOW - 1);

		expect(await fixture.service.decide({
			telegramUserId: "100",
			applicationId: APPLICATION_B_ID,
			decision: "accept",
			occurredAt: NOW,
		})).toMatchObject({
			ok: true,
			applicationStatus: "accepted",
			collaborationStatus: "matched",
			acceptedCount: 2,
		});

		const keys = fixture.outbox.records().map((delivery) => delivery.idempotencyKey);
		expect(keys).toEqual(expect.arrayContaining([
			`collaboration:${COLLABORATION_ID}:matched:author:${APPLICATION_A_ID}:v1`,
			`collaboration:${COLLABORATION_ID}:matched:applicant:${APPLICATION_A_ID}:v1`,
			`collaboration:${COLLABORATION_ID}:matched:author:${APPLICATION_B_ID}:v1`,
			`collaboration:${COLLABORATION_ID}:matched:applicant:${APPLICATION_B_ID}:v1`,
		]));
		for (const key of keys.filter((key) => key.includes(":matched:"))) {
			const delivery = requireDelivery(fixture.outbox.records(), key);
			expect(delivery.payload.method === "send" ? delivery.payload.text : "").toContain("Набор завершён");
		}
	});

	it("rejects only the selected application and does not change capacity or the showcase projection", async () => {
		const fixture = decisionFixture({ slotsTotal: 2 });
		const result = await fixture.service.decide({
			telegramUserId: "100",
			applicationId: APPLICATION_A_ID,
			decision: "reject",
			occurredAt: NOW,
		});

		expect(result).toMatchObject({
			ok: true,
			applicationStatus: "rejected",
			collaborationStatus: "published",
			acceptedCount: 0,
			projectionRevision: 8,
		});
		expect(fixture.store.application(APPLICATION_A_ID)).toMatchObject({
			status: "rejected",
			decidedByProfileId: AUTHOR_PROFILE_ID,
			decidedAt: NOW,
		});
		expect(fixture.store.application(APPLICATION_B_ID).status).toBe("pending");
		expect(fixture.store.collaboration()).toMatchObject({ status: "published", matchedAt: null, projectionRevision: 8 });
		expect(fixture.outbox.records()).toHaveLength(1);
		expect(fixture.outbox.records()[0]).toMatchObject({
			idempotencyKey: `application:${APPLICATION_A_ID}:rejected:v1`,
			kind: "dm_send",
			recipientChatId: "200",
		});
		expect(JSON.stringify(fixture.outbox.records()[0])).not.toMatch(/candidate_a|tg:\/\/user\?id=100/);
	});

	it("requires one accepted partner for manual completion, then matches and closes the remaining pending applications", async () => {
		const fixture = decisionFixture({ slotsTotal: 3 });
		expect(await fixture.service.completeRecruitment({
			telegramUserId: "100",
			collaborationId: COLLABORATION_ID,
			occurredAt: NOW,
		})).toEqual({ ok: false, code: "no_accepted" });
		expect(fixture.outbox.records()).toEqual([]);

		fixture.store.seedAccepted(APPLICATION_A_ID, NOW - 1);
		const result = await fixture.service.completeRecruitment({
			telegramUserId: "100",
			collaborationId: COLLABORATION_ID,
			occurredAt: NOW,
		});

		expect(result).toMatchObject({
			ok: true,
			collaborationId: COLLABORATION_ID,
			collaborationStatus: "matched",
			acceptedCount: 1,
			projectionRevision: 9,
		});
		expect(fixture.store.application(APPLICATION_B_ID).status).toBe("closed");
		expect(fixture.store.collaboration()).toMatchObject({ status: "matched", matchedAt: NOW, projectionRevision: 9 });
		expect(fixture.outbox.records().map((delivery) => delivery.idempotencyKey).sort()).toEqual([
			`application:${APPLICATION_B_ID}:closed:v1`,
			`channel:${COLLABORATION_ID}:projection:9`,
			`collaboration:${COLLABORATION_ID}:matched:applicant:${APPLICATION_A_ID}:v1`,
			`collaboration:${COLLABORATION_ID}:matched:author:${APPLICATION_A_ID}:v1`,
		].sort());
	});

	it("rolls the decision, capacity, and all intents back when an outbox insert fails", async () => {
		const fixture = decisionFixture({ slotsTotal: 1 });
		fixture.outbox.failNextInsert();

		await expect(fixture.service.decide({
			telegramUserId: "100",
			applicationId: APPLICATION_A_ID,
			decision: "accept",
			occurredAt: NOW,
		})).rejects.toThrow("injected outbox failure");

		expect(fixture.store.application(APPLICATION_A_ID)).toMatchObject({ status: "pending", decidedByProfileId: null, decidedAt: null });
		expect(fixture.store.application(APPLICATION_B_ID).status).toBe("pending");
		expect(fixture.store.collaboration()).toMatchObject({ status: "published", matchedAt: null, projectionRevision: 8 });
		expect(fixture.outbox.records()).toEqual([]);
	});

	it("recomputes a contact only for the exact accepted pair and fails closed on corrupt identity", async () => {
		const fixture = decisionFixture({ slotsTotal: 2 });
		fixture.store.seedAccepted(APPLICATION_A_ID, NOW - 2);
		fixture.store.seedAccepted(APPLICATION_B_ID, NOW - 1);

		expect(await fixture.service.getPairContact("100", APPLICATION_A_ID)).toMatchObject({
			ok: true,
			url: "https://t.me/candidate_a",
		});
		expect(await fixture.service.getPairContact("200", APPLICATION_A_ID)).toMatchObject({
			ok: true,
			url: "tg://user?id=100",
		});
		expect(await fixture.service.getPairContact("300", APPLICATION_A_ID)).toEqual({
			ok: false,
			code: "contact_unavailable",
		});

		fixture.store.setIdentity("100", { telegramUserId: "not-a-decimal-id", username: "bad username" });
		expect(await fixture.service.getPairContact("200", APPLICATION_A_ID)).toEqual({
			ok: false,
			code: "contact_unavailable",
		});
	});
});

interface IdentitySnapshot {
	readonly telegramUserId: string;
	readonly username: string | null;
}

interface CollaborationState {
	readonly id: string;
	readonly publicToken: string;
	readonly authorProfileId: string;
	readonly authorTelegramUserId: string;
	readonly title: string;
	readonly format: "joint_content";
	readonly targetProfileType: "any";
	readonly topics: readonly ["city"];
	readonly offerText: string;
	readonly expectationText: string;
	readonly slotsTotal: number;
	readonly responseDeadlineAt: number;
	readonly eventDateLocal: null;
	readonly cityCode: "ekaterinburg";
	status: "published" | "matched";
	readonly version: number;
	projectionRevision: number;
	readonly publishedAt: number;
	matchedAt: number | null;
	updatedAt: number;
	readonly publication: {
		readonly status: "published";
		readonly channelChatId: string;
		readonly messageId: number;
	};
}

interface ApplicationState {
	readonly id: string;
	readonly collaborationId: string;
	readonly applicantProfileId: string;
	readonly applicantTelegramUserId: string;
	readonly message: string;
	status: "pending" | "accepted" | "rejected" | "closed";
	decidedByProfileId: string | null;
	decidedAt: number | null;
	readonly createdAt: number;
}

class InMemoryApplicationDecisionStore {
	private collaborationState: CollaborationState;
	private applicationStates: Map<string, ApplicationState>;
	private identityStates = new Map<string, IdentitySnapshot>([
		["100", { telegramUserId: "100", username: null }],
		["200", { telegramUserId: "200", username: "candidate_a" }],
		["300", { telegramUserId: "300", username: "candidate_b" }],
	]);

	constructor(slotsTotal: number) {
		this.collaborationState = {
			id: COLLABORATION_ID,
			publicToken: PUBLIC_TOKEN,
			authorProfileId: AUTHOR_PROFILE_ID,
			authorTelegramUserId: "100",
			title: "Совместный городской материал",
			format: "joint_content",
			targetProfileType: "any",
			topics: ["city"],
			offerText: "Предлагаю вместе подготовить городской материал.",
			expectationText: "Ищу партнёра для съёмки и совместной публикации.",
			slotsTotal,
			responseDeadlineAt: NOW + 86_400_000,
			eventDateLocal: null,
			cityCode: "ekaterinburg",
			status: "published",
			version: 1,
			projectionRevision: 8,
			publishedAt: NOW - 10_000,
			matchedAt: null,
			updatedAt: NOW - 10_000,
			publication: { status: "published", channelChatId: "-100777", messageId: 77 },
		};
		this.applicationStates = new Map([
			[APPLICATION_A_ID, applicationState(APPLICATION_A_ID, APPLICANT_A_PROFILE_ID, "200", NOW - 2_000)],
			[APPLICATION_B_ID, applicationState(APPLICATION_B_ID, APPLICANT_B_PROFILE_ID, "300", NOW - 1_000)],
		]);
	}

	async findSubmissionContext(): Promise<undefined> { return undefined; }
	async insertPending(): Promise<void> { throw new Error("not used by S3-04 unit tests"); }
	async setFirstApplicationAt(): Promise<boolean> { throw new Error("not used by S3-04 unit tests"); }

	async findDecisionContext(telegramUserId: string, applicationId: string): Promise<unknown> {
		const application = this.applicationStates.get(applicationId);
		return application === undefined ? undefined : this.context(telegramUserId, application);
	}

	async findRecruitmentContext(telegramUserId: string, collaborationId: string): Promise<unknown> {
		return collaborationId !== this.collaborationState.id ? undefined : {
			actorStatus: "active",
			actorTelegramUserId: telegramUserId,
			authorProfileId: this.collaborationState.authorProfileId,
			collaboration: structuredClone(this.collaborationState),
			acceptedCount: this.acceptedCount(),
		};
	}

	async updateApplicationDecision(input: {
		readonly applicationId: string;
		readonly status: "accepted" | "rejected";
		readonly decidedByProfileId: string;
		readonly decidedAt: number;
	}): Promise<boolean> {
		const current = this.applicationStates.get(input.applicationId);
		if (current === undefined || current.status !== "pending") return false;
		current.status = input.status;
		current.decidedByProfileId = input.decidedByProfileId;
		current.decidedAt = input.decidedAt;
		return true;
	}

	async closePendingApplications(collaborationId: string): Promise<readonly unknown[]> {
		const closed: unknown[] = [];
		for (const application of this.applicationStates.values()) {
			if (application.collaborationId !== collaborationId || application.status !== "pending") continue;
			application.status = "closed";
			closed.push({
				application: structuredClone(application),
				applicantIdentity: structuredClone(this.identityStates.get(application.applicantTelegramUserId)),
			});
		}
		return closed;
	}

	async listAcceptedApplications(collaborationId: string): Promise<readonly unknown[]> {
		return [...this.applicationStates.values()]
			.filter((application) => application.collaborationId === collaborationId && application.status === "accepted")
			.map((application) => ({
				application: structuredClone(application),
				applicantIdentity: structuredClone(this.identityStates.get(application.applicantTelegramUserId)),
			}));
	}

	async updateCollaborationDecision(input: {
		readonly collaborationId: string;
		readonly expectedProjectionRevision: number;
		readonly status: "published" | "matched";
		readonly matchedAt: number | null;
		readonly projectionRevision: number;
		readonly updatedAt: number;
	}): Promise<boolean> {
		if (input.collaborationId !== this.collaborationState.id || input.expectedProjectionRevision !== this.collaborationState.projectionRevision) return false;
		this.collaborationState.status = input.status;
		this.collaborationState.matchedAt = input.matchedAt;
		this.collaborationState.projectionRevision = input.projectionRevision;
		this.collaborationState.updatedAt = input.updatedAt;
		return true;
	}

	async supersedeOlderProjectionDeliveries(): Promise<number> { return 0; }

	async findPairContactContext(telegramUserId: string, applicationId: string): Promise<unknown> {
		const application = this.applicationStates.get(applicationId);
		if (application === undefined || application.status !== "accepted") return undefined;
		if (telegramUserId === this.collaborationState.authorTelegramUserId) {
			return { authorized: true, counterpartIdentity: structuredClone(this.identityStates.get(application.applicantTelegramUserId)) };
		}
		if (telegramUserId === application.applicantTelegramUserId) {
			return { authorized: true, counterpartIdentity: structuredClone(this.identityStates.get(this.collaborationState.authorTelegramUserId)) };
		}
		return undefined;
	}

	application(id: string): ApplicationState {
		const value = this.applicationStates.get(id);
		if (value === undefined) throw new Error("fixture application is missing");
		return structuredClone(value);
	}

	collaboration(): CollaborationState { return structuredClone(this.collaborationState); }
	acceptedCount(): number { return [...this.applicationStates.values()].filter((application) => application.status === "accepted").length; }
	pendingCount(): number { return [...this.applicationStates.values()].filter((application) => application.status === "pending").length; }

	seedAccepted(applicationId: string, decidedAt: number): void {
		const application = this.applicationStates.get(applicationId);
		if (application === undefined) throw new Error("fixture application is missing");
		application.status = "accepted";
		application.decidedByProfileId = AUTHOR_PROFILE_ID;
		application.decidedAt = decidedAt;
	}

	setIdentity(ownerTelegramUserId: string, identity: IdentitySnapshot): void {
		this.identityStates.set(ownerTelegramUserId, structuredClone(identity));
	}

	snapshot(): unknown {
		return {
			collaboration: structuredClone(this.collaborationState),
			applications: structuredClone([...this.applicationStates.entries()]),
			identities: structuredClone([...this.identityStates.entries()]),
		};
	}

	restore(snapshot: unknown): void {
		const state = snapshot as {
			collaboration: CollaborationState;
			applications: [string, ApplicationState][];
			identities: [string, IdentitySnapshot][];
		};
		this.collaborationState = structuredClone(state.collaboration);
		this.applicationStates = new Map(structuredClone(state.applications));
		this.identityStates = new Map(structuredClone(state.identities));
	}

	private context(telegramUserId: string, application: ApplicationState): unknown {
		return {
			actorStatus: "active",
			actorTelegramUserId: telegramUserId,
			authorProfileId: this.collaborationState.authorProfileId,
			authorIdentity: structuredClone(this.identityStates.get(this.collaborationState.authorTelegramUserId)),
			applicantProfileStatus: "active",
			applicantActorStatus: "active",
			applicantIdentity: structuredClone(this.identityStates.get(application.applicantTelegramUserId)),
			application: structuredClone(application),
			collaboration: structuredClone(this.collaborationState),
			acceptedCount: this.acceptedCount(),
		};
	}
}

class InMemoryOutboxStore {
	private rows = new Map<string, OutboxDeliveryRecord>();
	private failInsert = false;

	async findById(id: string): Promise<OutboxDeliveryRecord | undefined> { return cloneDelivery(this.rows.get(id)); }
	async findByIdempotencyKey(key: string): Promise<OutboxDeliveryRecord | undefined> {
		return cloneDelivery([...this.rows.values()].find((row) => row.idempotencyKey === key));
	}
	async insert(record: OutboxDeliveryRecord): Promise<void> {
		if (this.failInsert) {
			this.failInsert = false;
			throw new Error("injected outbox failure");
		}
		this.rows.set(record.id, structuredClone(record));
	}

	failNextInsert(): void { this.failInsert = true; }
	records(): readonly OutboxDeliveryRecord[] { return [...this.rows.values()].map((row) => structuredClone(row)); }
	snapshot(): unknown { return { rows: structuredClone([...this.rows.entries()]), failInsert: this.failInsert }; }
	restore(snapshot: unknown): void {
		const value = snapshot as { rows: [string, OutboxDeliveryRecord][]; failInsert: boolean };
		this.rows = new Map(structuredClone(value.rows));
		this.failInsert = value.failInsert;
	}
}

class SnapshotTransactionRunner implements TransactionRunner {
	private depth = 0;
	constructor(private readonly participants: readonly { snapshot(): unknown; restore(value: unknown): void }[]) {}

	async withTransaction<T>(work: () => T | PromiseLike<T>): Promise<T> {
		if (this.depth > 0) return work();
		const snapshots = this.participants.map((participant) => participant.snapshot());
		this.depth += 1;
		try {
			return await work();
		} catch (error) {
			this.participants.forEach((participant, index) => participant.restore(snapshots[index]));
			throw error;
		} finally {
			this.depth -= 1;
		}
	}
}

function decisionFixture(input: { readonly slotsTotal: number }): {
	readonly service: ApplicationService;
	readonly store: InMemoryApplicationDecisionStore;
	readonly outbox: InMemoryOutboxStore;
} {
	const store = new InMemoryApplicationDecisionStore(input.slotsTotal);
	const outbox = new InMemoryOutboxStore();
	const transactions = new SnapshotTransactionRunner([store, outbox]);
	return {
		service: new ApplicationService(
			store as never,
			outbox as unknown as OutboxDeliveryStore,
			transactions,
			new FakeClock(NOW),
			"collab_bot",
		),
		store,
		outbox,
	};
}

function applicationState(
	id: string,
	applicantProfileId: string,
	applicantTelegramUserId: string,
	createdAt: number,
): ApplicationState {
	return {
		id,
		collaborationId: COLLABORATION_ID,
		applicantProfileId,
		applicantTelegramUserId,
		message: `Сообщение кандидата ${applicantTelegramUserId}`,
		status: "pending",
		decidedByProfileId: null,
		decidedAt: null,
		createdAt,
	};
}

function requireDelivery(rows: readonly OutboxDeliveryRecord[], idempotencyKey: string): OutboxDeliveryRecord {
	const value = rows.find((row) => row.idempotencyKey === idempotencyKey);
	if (value === undefined) throw new Error(`delivery ${idempotencyKey} is missing`);
	return value;
}

function singleButtonUrl(record: OutboxDeliveryRecord): string | undefined {
	if (record.payload.method === "delete") return undefined;
	return record.payload.replyMarkup?.inline_keyboard[0]?.[0]?.url;
}

function cloneDelivery(record: OutboxDeliveryRecord | undefined): OutboxDeliveryRecord | undefined {
	return record === undefined ? undefined : structuredClone(record);
}
