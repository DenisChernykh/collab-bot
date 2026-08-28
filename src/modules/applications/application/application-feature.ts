import type { Clock } from "../../../shared/application/ports/clock.js";
import type { OutboxDeliveryStore } from "../../../application/ports/outbox-delivery-store.js";
import type { TransactionRunner } from "../../../shared/application/ports/transaction-runner.js";
import type {
	ApplicationDecisionInput,
	ApplicationDecisionResult,
	ApplicationEligibility,
	ApplicationEligibilityInput,
	ApplicationRecord,
	ApplicationSubmitInput,
	ApplicationSubmitResult,
	AuthorManagementView,
	CompleteRecruitmentInput,
	CompleteRecruitmentResult,
	OwnApplicationSummary,
	PairContactResult,
} from "./application-contracts.js";
import {
	CompleteRecruitmentUseCase,
	DecideApplicationUseCase,
	type CompleteRecruitmentStore,
	type DecideApplicationStore,
} from "./application-decisions.js";
import {
	GetApplicationActionVersionQuery,
	GetAuthorManagementByPublicTokenQuery,
	GetAuthorManagementQuery,
	GetPairContactQuery,
	ListAuthorManagementQuery,
	ListOwnApplicationsQuery,
	type ApplicationActionVersionReader,
	type AuthorManagementByIdReader,
	type AuthorManagementByTokenReader,
	type AuthorManagementListReader,
	type OwnApplicationsReader,
	type PairContactReader,
} from "./application-queries.js";
import {
	CheckApplicationEligibilityUseCase,
	SubmitApplicationUseCase,
	type CheckApplicationEligibilityReader,
} from "./application-submission.js";

/** Composition aggregate implemented by the feature-owned SQLite adapter; workflows consume the narrower ports above. */
export interface ApplicationSubmissionStore extends CheckApplicationEligibilityReader {
	insertPending(record: ApplicationRecord): Promise<void>;
	setFirstApplicationAt(collaborationId: string, firstApplicationAt: number): Promise<boolean>;
}

/** Composition aggregate for the feature-owned applications adapter. */
export interface ApplicationDecisionStore extends
	ApplicationSubmissionStore,
	DecideApplicationStore,
	CompleteRecruitmentStore,
	PairContactReader,
	ApplicationActionVersionReader,
	OwnApplicationsReader,
	AuthorManagementByIdReader,
	AuthorManagementByTokenReader,
	AuthorManagementListReader {}

export interface ApplicationsFeatureApi {
	checkEligibility(input: ApplicationEligibilityInput): Promise<ApplicationEligibility>;
	submit(input: ApplicationSubmitInput): Promise<ApplicationSubmitResult>;
	decide(input: ApplicationDecisionInput): Promise<ApplicationDecisionResult>;
	completeRecruitment(input: CompleteRecruitmentInput): Promise<CompleteRecruitmentResult>;
	getPairContact(telegramUserId: string, applicationId: string): Promise<PairContactResult>;
	currentActionVersion(entityId: string): Promise<number | undefined>;
	listOwnApplications(telegramUserId: string): Promise<readonly OwnApplicationSummary[]>;
	getAuthorManagement(telegramUserId: string, collaborationId: string): Promise<AuthorManagementView | undefined>;
	getAuthorManagementByPublicToken(telegramUserId: string, publicToken: string): Promise<AuthorManagementView | undefined>;
	listAuthorManagement(telegramUserId: string): Promise<readonly AuthorManagementView[]>;
}

/** Temporary flat facade that preserves every current caller while delegating to narrow workflows. */
export class ApplicationService implements ApplicationsFeatureApi {
	private readonly checkApplicationEligibility: CheckApplicationEligibilityUseCase;
	private readonly submitApplication: SubmitApplicationUseCase;
	private readonly decideApplication: DecideApplicationUseCase;
	private readonly completeApplicationRecruitment: CompleteRecruitmentUseCase;
	private readonly pairContact: GetPairContactQuery;
	private readonly actionVersion: GetApplicationActionVersionQuery;
	private readonly ownApplications: ListOwnApplicationsQuery;
	private readonly authorManagement: GetAuthorManagementQuery;
	private readonly authorManagementByPublicToken: GetAuthorManagementByPublicTokenQuery;
	private readonly authorManagementList: ListAuthorManagementQuery;

	constructor(
		store: ApplicationDecisionStore,
		outboxStore: OutboxDeliveryStore,
		transactions: TransactionRunner,
		clock: Clock,
		botUsername: string,
	) {
		this.checkApplicationEligibility = new CheckApplicationEligibilityUseCase(store, transactions);
		this.submitApplication = new SubmitApplicationUseCase(store, outboxStore, transactions, clock, botUsername);
		this.decideApplication = new DecideApplicationUseCase(store, outboxStore, transactions, clock, botUsername);
		this.completeApplicationRecruitment = new CompleteRecruitmentUseCase(store, outboxStore, transactions, clock, botUsername);
		this.pairContact = new GetPairContactQuery(store, transactions);
		this.actionVersion = new GetApplicationActionVersionQuery(store, transactions);
		this.ownApplications = new ListOwnApplicationsQuery(store, transactions);
		this.authorManagement = new GetAuthorManagementQuery(store, transactions);
		this.authorManagementByPublicToken = new GetAuthorManagementByPublicTokenQuery(store, transactions);
		this.authorManagementList = new ListAuthorManagementQuery(store, transactions);
	}

	checkEligibility(input: ApplicationEligibilityInput): Promise<ApplicationEligibility> {
		return this.checkApplicationEligibility.execute(input);
	}

	submit(input: ApplicationSubmitInput): Promise<ApplicationSubmitResult> {
		return this.submitApplication.execute(input);
	}

	decide(input: ApplicationDecisionInput): Promise<ApplicationDecisionResult> {
		return this.decideApplication.execute(input);
	}

	completeRecruitment(input: CompleteRecruitmentInput): Promise<CompleteRecruitmentResult> {
		return this.completeApplicationRecruitment.execute(input);
	}

	getPairContact(telegramUserId: string, applicationId: string): Promise<PairContactResult> {
		return this.pairContact.execute(telegramUserId, applicationId);
	}

	currentActionVersion(entityId: string): Promise<number | undefined> {
		return this.actionVersion.execute(entityId);
	}

	listOwnApplications(telegramUserId: string): Promise<readonly OwnApplicationSummary[]> {
		return this.ownApplications.execute(telegramUserId);
	}

	getAuthorManagement(telegramUserId: string, collaborationId: string): Promise<AuthorManagementView | undefined> {
		return this.authorManagement.execute(telegramUserId, collaborationId);
	}

	getAuthorManagementByPublicToken(telegramUserId: string, publicToken: string): Promise<AuthorManagementView | undefined> {
		return this.authorManagementByPublicToken.execute(telegramUserId, publicToken);
	}

	listAuthorManagement(telegramUserId: string): Promise<readonly AuthorManagementView[]> {
		return this.authorManagementList.execute(telegramUserId);
	}
}
