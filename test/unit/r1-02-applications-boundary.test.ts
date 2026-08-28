import { describe, expect, it } from "vitest";

import {
	CheckApplicationEligibilityUseCase,
	type SubmitApplicationStore,
} from "../../src/modules/applications/application/application-submission.js";
import type {
	CompleteRecruitmentStore,
	DecideApplicationStore,
} from "../../src/modules/applications/application/application-decisions.js";
import {
	GetPairContactQuery,
} from "../../src/modules/applications/application/application-queries.js";
import type { TransactionRunner } from "../../src/shared/application/ports/transaction-runner.js";

const transactionRunner: TransactionRunner = {
	withTransaction: async <T>(work: () => T | PromiseLike<T>): Promise<T> => work(),
};

describe("R1-02 applications use-case boundaries", () => {
	it("checks eligibility through only the submission-context reader", async () => {
		const useCase = new CheckApplicationEligibilityUseCase(
			{
				findSubmissionContext: async () => ({
					actorStatus: "active",
					applicant: {
						profileId: "10000000-0000-4000-8000-000000000001",
						type: "blogger",
						displayName: "Public applicant",
						description: null,
						topics: [],
						platform: {
							platformType: "other",
							url: "https://example.com/applicant",
							title: null,
							audienceSize: null,
						},
					},
					target: {
						collaborationId: "20000000-0000-4000-8000-000000000003",
						publicToken: "AAAAAAAAAAAAAAAAAAAAAA",
						authorProfileId: "30000000-0000-4000-8000-000000000001",
						authorTelegramUserId: "300",
						authorProfileStatus: "active",
						authorActorStatus: "active",
						title: "Public collaboration",
						status: "published",
						version: 1,
						targetProfileType: "any",
						slotsTotal: 2,
						responseDeadlineAt: 2_000,
						publishedAt: 500,
						publicationStatus: "published",
						publicationMessageId: 10,
					},
					existingApplicationId: null,
					acceptedCount: 0,
				}),
			},
			transactionRunner,
		);

		await expect(useCase.execute({
			telegramUserId: "100",
			collaborationId: "20000000-0000-4000-8000-000000000003",
			occurredAt: 1_000,
		})).resolves.toMatchObject({ ok: true });
	});

	it("resolves pair contact through only the pair-contact reader", async () => {
		const query = new GetPairContactQuery(
			{
				findPairContactContext: async () => ({
					authorized: true,
					counterpartIdentity: { telegramUserId: "300", username: "public_author" },
				}),
			},
			transactionRunner,
		);

		await expect(query.execute(
			"100",
			"40000000-0000-4000-8000-000000000004",
		)).resolves.toEqual({ ok: true, url: "https://t.me/public_author" });
	});

	it("keeps submit, decision, and recruitment mutation ports independent", () => {
		const submitStore = {
			findSubmissionContext: async () => undefined,
			insertPending: async () => {},
			setFirstApplicationAt: async () => false,
		} satisfies SubmitApplicationStore;
		const decisionStore = {
			findDecisionContext: async () => undefined,
			updateApplicationDecision: async () => false,
			closePendingApplications: async () => [],
			listAcceptedApplications: async () => [],
			updateCollaborationDecision: async () => false,
			supersedeOlderProjectionDeliveries: async () => 0,
		} satisfies DecideApplicationStore;
		const recruitmentStore = {
			findRecruitmentContext: async () => undefined,
			closePendingApplications: async () => [],
			listAcceptedApplications: async () => [],
			updateCollaborationDecision: async () => false,
			supersedeOlderProjectionDeliveries: async () => 0,
		} satisfies CompleteRecruitmentStore;

		expect(submitStore).not.toHaveProperty("findDecisionContext");
		expect(decisionStore).not.toHaveProperty("findSubmissionContext");
		expect(recruitmentStore).not.toHaveProperty("updateApplicationDecision");
	});
});
