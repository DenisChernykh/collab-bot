import type { TransactionRunner } from "../../../shared/application/ports/transaction-runner.js";
import type {
	AuthorManagementView,
	OwnApplicationSummary,
	PairContactContext,
	PairContactResult,
	PublicApplicantSnapshot,
} from "./application-contracts.js";
import {
	ACTION_ENTITY,
	PUBLIC_TOKEN,
	TELEGRAM_USER_ID,
	UUID,
	telegramContactUrl,
} from "./application-policy.js";

export interface PairContactReader {
	findPairContactContext(
		telegramUserId: string,
		applicationId: string,
	): Promise<PairContactContext | undefined>;
}

export class GetPairContactQuery {
	constructor(
		private readonly reader: PairContactReader,
		private readonly transactions: TransactionRunner,
	) {}

	async execute(telegramUserId: string, applicationId: string): Promise<PairContactResult> {
		if (!TELEGRAM_USER_ID.test(telegramUserId) || !UUID.test(applicationId)) {
			return { ok: false, code: "contact_unavailable" };
		}
		return this.transactions.withTransaction(async () => {
			const context = await this.reader.findPairContactContext(telegramUserId, applicationId);
			if (context === undefined) return { ok: false, code: "contact_unavailable" };
			if (!context.authorized) return { ok: false, code: context.reason };
			const url = telegramContactUrl(context.counterpartIdentity);
			return url === undefined
				? { ok: false, code: "contact_unavailable" }
				: { ok: true, url };
		});
	}
}

export interface ApplicationActionVersionReader {
	findCurrentActionVersion(entityId: string): Promise<number | undefined>;
}

export class GetApplicationActionVersionQuery {
	constructor(
		private readonly reader: ApplicationActionVersionReader,
		private readonly transactions: TransactionRunner,
	) {}

	async execute(entityId: string): Promise<number | undefined> {
		if (!ACTION_ENTITY.test(entityId)) return undefined;
		const version = await this.transactions.withTransaction(() => this.reader.findCurrentActionVersion(entityId));
		return Number.isSafeInteger(version) && (version as number) >= 0 ? version : undefined;
	}
}

export interface OwnApplicationsReader {
	listOwnApplications(telegramUserId: string): Promise<readonly OwnApplicationSummary[]>;
}

export class ListOwnApplicationsQuery {
	constructor(
		private readonly reader: OwnApplicationsReader,
		private readonly transactions: TransactionRunner,
	) {}

	async execute(telegramUserId: string): Promise<readonly OwnApplicationSummary[]> {
		if (!TELEGRAM_USER_ID.test(telegramUserId)) return [];
		const rows = await this.transactions.withTransaction(() => this.reader.listOwnApplications(telegramUserId));
		return rows.map(sanitizeOwnApplication);
	}
}

export interface AuthorManagementByIdReader {
	findAuthorManagement(telegramUserId: string, collaborationId: string): Promise<AuthorManagementView | undefined>;
}

export class GetAuthorManagementQuery {
	constructor(
		private readonly reader: AuthorManagementByIdReader,
		private readonly transactions: TransactionRunner,
	) {}

	async execute(telegramUserId: string, collaborationId: string): Promise<AuthorManagementView | undefined> {
		if (!TELEGRAM_USER_ID.test(telegramUserId) || !UUID.test(collaborationId)) return undefined;
		const row = await this.transactions.withTransaction(() => this.reader.findAuthorManagement(telegramUserId, collaborationId));
		return row === undefined ? undefined : sanitizeAuthorManagement(row);
	}
}

export interface AuthorManagementByTokenReader {
	findAuthorManagementByPublicToken(telegramUserId: string, publicToken: string): Promise<AuthorManagementView | undefined>;
}

export class GetAuthorManagementByPublicTokenQuery {
	constructor(
		private readonly reader: AuthorManagementByTokenReader,
		private readonly transactions: TransactionRunner,
	) {}

	async execute(telegramUserId: string, publicToken: string): Promise<AuthorManagementView | undefined> {
		if (!TELEGRAM_USER_ID.test(telegramUserId) || !PUBLIC_TOKEN.test(publicToken)) return undefined;
		const row = await this.transactions.withTransaction(() => this.reader.findAuthorManagementByPublicToken(telegramUserId, publicToken));
		return row === undefined ? undefined : sanitizeAuthorManagement(row);
	}
}

export interface AuthorManagementListReader {
	listAuthorManagement(telegramUserId: string): Promise<readonly AuthorManagementView[]>;
}

export class ListAuthorManagementQuery {
	constructor(
		private readonly reader: AuthorManagementListReader,
		private readonly transactions: TransactionRunner,
	) {}

	async execute(telegramUserId: string): Promise<readonly AuthorManagementView[]> {
		if (!TELEGRAM_USER_ID.test(telegramUserId)) return [];
		const rows = await this.transactions.withTransaction(() => this.reader.listAuthorManagement(telegramUserId));
		return rows.map(sanitizeAuthorManagement);
	}
}

function sanitizeOwnApplication(value: OwnApplicationSummary): OwnApplicationSummary {
	return {
		applicationId: value.applicationId,
		collaborationId: value.collaborationId,
		collaborationTitle: value.collaborationTitle,
		collaborationStatus: value.collaborationStatus,
		status: value.status,
		createdAt: value.createdAt,
	};
}

function sanitizeAuthorManagement(value: AuthorManagementView): AuthorManagementView {
	return {
		collaborationId: value.collaborationId,
		publicToken: value.publicToken,
		title: value.title,
		status: value.status,
		slotsTotal: value.slotsTotal,
		acceptedCount: value.acceptedCount,
		projectionRevision: value.projectionRevision,
		applications: value.applications.map((application) => ({
			applicationId: application.applicationId,
			message: application.message,
			status: application.status,
			createdAt: application.createdAt,
			applicant: sanitizePublicApplicant(application.applicant),
		})),
	};
}

function sanitizePublicApplicant(value: PublicApplicantSnapshot): PublicApplicantSnapshot {
	return {
		type: value.type,
		displayName: value.displayName,
		description: value.description,
		topics: [...value.topics],
		platform: {
			platformType: value.platform.platformType,
			url: value.platform.url,
			title: value.platform.title,
			audienceSize: value.platform.audienceSize,
		},
	};
}
