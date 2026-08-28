import { randomBytes } from "node:crypto";

import type { TransactionRunner } from "../../../shared/application/ports/transaction-runner.js";
import type { ProfileSessionRepository } from "../../profiles/application/index.js";
import type { CollaborationRepository } from "./ports/collaboration-repository.js";
import type { CollaborationSessionRecord, CollaborationSessionRepository } from "./ports/collaboration-session-repository.js";
import {
	COLLABORATION_SESSION_TTL_MS,
	COLLABORATION_SESSION_VERSION,
	validateCollaborationDraftInput,
	validateCompleteCollaborationDraft,
	type CollaborationDraftInput,
	type CollaborationDraftState,
	type CollaborationRecord,
	type CollaborationWizardStep,
} from "../domain/collaboration.js";
import type { Clock } from "../../../shared/application/ports/clock.js";
import { DomainValidationError } from "../../../shared/domain/value-objects/enums.js";

export class CollaborationProfileRequiredError extends Error {
	constructor() { super("active profile is required before creating a collaboration"); this.name = "CollaborationProfileRequiredError"; }
}

export class CollaborationWizardConflictError extends Error {
	constructor() { super("another wizard is already active"); this.name = "CollaborationWizardConflictError"; }
}

export class CollaborationDraftStaleError extends Error {
	constructor() { super("collaboration draft action is stale"); this.name = "CollaborationDraftStaleError"; }
}

export interface CollaborationDraftStartResult {
	readonly draft: CollaborationRecord;
	readonly session: CollaborationSessionRecord;
	readonly resumed: boolean;
}

export class CollaborationDraftService {
	constructor(
		private readonly repository: CollaborationRepository,
		private readonly sessions: CollaborationSessionRepository,
		private readonly transactionRunner: TransactionRunner,
		private readonly clock: Clock,
		private readonly profileSessions?: ProfileSessionRepository,
	) {}

	async start(telegramUserId: string): Promise<CollaborationDraftStartResult> {
		const now = clockMilliseconds(this.clock);
		return this.transactionRunner.withTransaction(async () => {
			if (this.profileSessions !== undefined && await this.profileSessions.findActive(telegramUserId, now) !== undefined) throw new CollaborationWizardConflictError();
			let draft = await this.repository.findDraftByTelegramUserId(telegramUserId);
			const resumed = draft !== undefined;
			if (draft === undefined) {
				try { draft = await this.repository.createDraft(telegramUserId, now); } catch (error) {
					if (error instanceof Error && /active profile/i.test(error.message)) throw new CollaborationProfileRequiredError();
					throw error;
				}
			}
			let session = await this.sessions.findActive(telegramUserId, now);
			if (session !== undefined && session.collaborationId !== draft.id) throw new CollaborationWizardConflictError();
			if (session === undefined) {
				const state: CollaborationDraftState = { version: COLLABORATION_SESSION_VERSION, generation: randomBytes(8).toString("hex"), step: firstStep(draft), ...draftToInput(draft) };
				session = await this.saveSession({ telegramUserId, collaborationId: draft.id, state, revision: 1, expiresAt: now + COLLABORATION_SESSION_TTL_MS, updatedAt: now });
			}
			return { draft, session, resumed };
		});
	}

	async saveStep(telegramUserId: string, expected: Pick<CollaborationSessionRecord, "collaborationId" | "revision" | "state">, input: CollaborationDraftInput, nextStep: CollaborationWizardStep): Promise<CollaborationDraftStartResult> {
		const now = clockMilliseconds(this.clock);
		const outcome = await this.transactionRunner.withTransaction(async (): Promise<{ readonly result: CollaborationDraftStartResult } | { readonly error: DomainValidationError | CollaborationDraftStaleError }> => {
			const current = await this.sessions.findActive(telegramUserId, now);
			if (current === undefined || current.collaborationId !== expected.collaborationId || current.revision !== expected.revision || current.state.generation !== expected.state.generation) return { error: new CollaborationDraftStaleError() };
			const merged = { ...stateToInput(current.state), ...input };
			if (input.eventDateLocal === null) delete (merged as { eventDateLocal?: unknown }).eventDateLocal;
			const validationOptions = { allowPersistedDeadline: input.responseDeadlineDate === undefined };
			let normalized: CollaborationDraftInput;
			try {
				normalized = nextStep === "preview" ? validateCompleteCollaborationDraft(merged, now, validationOptions) : validateCollaborationDraftInput(merged, now, validationOptions);
			} catch (error) {
				if (error instanceof DomainValidationError) return { error };
				throw error;
			}
			const draft = await this.repository.replaceDraft(telegramUserId, current.collaborationId, normalized, now);
			const state: CollaborationDraftState = { version: COLLABORATION_SESSION_VERSION, generation: current.state.generation, step: nextStep, ...sessionInput(normalized) };
			const session = await this.saveSession({ telegramUserId, collaborationId: draft.id, state, revision: current.revision + 1, expiresAt: now + COLLABORATION_SESSION_TTL_MS, updatedAt: now });
			return { result: { draft, session, resumed: true } };
		});
		if ("error" in outcome) throw outcome.error;
		return outcome.result;
	}

	async cancel(telegramUserId: string, expected?: Pick<CollaborationSessionRecord, "collaborationId" | "revision" | "state">): Promise<boolean> {
		const now = clockMilliseconds(this.clock);
		return this.transactionRunner.withTransaction(async () => {
			const current = await this.sessions.findActive(telegramUserId, now);
			const draft = await this.repository.findDraftByTelegramUserId(telegramUserId);
			if (expected !== undefined && (current === undefined ? draft?.id !== expected.collaborationId : current.collaborationId !== expected.collaborationId || current.revision !== expected.revision || current.state.generation !== expected.state.generation)) throw new CollaborationDraftStaleError();
			const collaborationId = current?.collaborationId ?? draft?.id ?? expected?.collaborationId;
			if (collaborationId === undefined) return false;
			await this.sessions.delete(telegramUserId);
			await this.repository.deleteDraft(telegramUserId, collaborationId);
			return true;
		});
	}

	findDraft(telegramUserId: string): Promise<CollaborationRecord | undefined> { return this.repository.findDraftByTelegramUserId(telegramUserId); }
	findSession(telegramUserId: string): Promise<CollaborationSessionRecord | undefined> { return this.sessions.findActive(telegramUserId, clockMilliseconds(this.clock)); }

	private async saveSession(record: CollaborationSessionRecord): Promise<CollaborationSessionRecord> {
		await this.sessions.save(record);
		return record;
	}
}

function stateToInput(state: CollaborationDraftState): CollaborationDraftInput {
	const input = { ...state } as Record<string, unknown>;
	delete input.version;
	delete input.generation;
	delete input.step;
	return input as CollaborationDraftInput;
}

function draftToInput(draft: CollaborationRecord): CollaborationDraftInput {
	return {
		...(draft.format === null ? {} : { format: draft.format }),
		...(draft.targetProfileType === null ? {} : { targetProfileType: draft.targetProfileType }),
		...(draft.topics.length === 0 ? {} : { topics: draft.topics }),
		...(draft.title === null ? {} : { title: draft.title }),
		...(draft.offerText === null ? {} : { offerText: draft.offerText }),
		...(draft.expectationText === null ? {} : { expectationText: draft.expectationText }),
		...(draft.slotsTotal === null ? {} : { slotsTotal: draft.slotsTotal }),
		...(draft.responseDeadlineAt === null ? {} : { responseDeadlineAt: draft.responseDeadlineAt, responseDeadlineDate: new Intl.DateTimeFormat("ru-RU", { timeZone: "Asia/Yekaterinburg", day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(draft.responseDeadlineAt)) }),
		...(draft.eventDateLocal === null ? {} : { eventDateLocal: isoDateToInput(draft.eventDateLocal) }),
	};
}

function isoDateToInput(value: string): string {
	const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
	return match === null ? value : `${match[3]}.${match[2]}.${match[1]}`;
}

function sessionInput(input: CollaborationDraftInput): CollaborationDraftInput {
	return input.eventDateLocal === undefined || input.eventDateLocal === null
		? input
		: { ...input, eventDateLocal: isoDateToInput(input.eventDateLocal) };
}

function firstStep(draft: CollaborationRecord): CollaborationWizardStep {
	if (draft.format === null) return "format";
	if (draft.targetProfileType === null) return "target_profile_type";
	if (draft.topics.length === 0) return "topics";
	if (draft.title === null) return "title";
	if (draft.offerText === null) return "offer";
	if (draft.expectationText === null) return "expectation";
	if (draft.slotsTotal === null) return "slots";
	if (draft.responseDeadlineAt === null) return "deadline";
	return "event_date";
}

function clockMilliseconds(clock: Clock): number {
	const value = clock.now().getTime();
	if (!Number.isSafeInteger(value) || value < 0) throw new RangeError("collaboration clock returned an unsafe timestamp");
	return value;
}
