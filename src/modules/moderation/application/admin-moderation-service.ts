import type { Clock } from "../../../shared/application/ports/clock.js";
import type { CryptoCapabilities } from "../../../shared/application/ports/crypto.js";
import {
	HIDEABLE_COLLABORATION_STATUSES,
	type AdminModerationRepository,
	type AdminModerationStatus,
	type HideableCollaborationStatus,
} from "./ports/admin-moderation-repository.js";
import type { TransactionRunner } from "../../../shared/application/ports/transaction-runner.js";
import type { OutboxDeliveryService } from "../../../shared/application/outbox/outbox-service.js";

const TELEGRAM_USER_ID = /^[0-9]+$/;
const PUBLIC_TOKEN = /^[A-Za-z0-9_-]{22}$/;
const COMMAND_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

export type AdminLookupResult =
	| { readonly ok: true; readonly title: string; readonly status: AdminModerationStatus }
	| { readonly ok: false; readonly code: "forbidden" | "invalid_link" | "not_found" };

export type AdminHideResult =
	| {
		readonly ok: true;
		readonly collaborationId: string;
		readonly title: string;
		readonly previousStatus: HideableCollaborationStatus;
		readonly projectionRevision: number;
	}
	| {
		readonly ok: false;
		readonly code: "forbidden" | "invalid_link" | "invalid_reason" | "not_found" | "unavailable" | "already_hidden";
	};

export interface AdminModerationServiceOptions {
	readonly repository: AdminModerationRepository;
	readonly outbox: OutboxDeliveryService;
	readonly transactions: TransactionRunner;
	readonly clock: Clock;
	readonly crypto: CryptoCapabilities;
	readonly botUsername: string;
	readonly adminTelegramIds: readonly string[];
}

export class AdminModerationService {
	private readonly repository: AdminModerationRepository;
	private readonly outbox: OutboxDeliveryService;
	private readonly transactions: TransactionRunner;
	private readonly clock: Clock;
	private readonly crypto: CryptoCapabilities;
	private readonly botUsername: string;
	private readonly admins: ReadonlySet<string>;

	constructor(options: AdminModerationServiceOptions) {
		if (options.botUsername.length === 0 || options.adminTelegramIds.some((id) => !TELEGRAM_USER_ID.test(id))) {
			throw new RangeError("admin moderation configuration is invalid");
		}
		this.repository = options.repository;
		this.outbox = options.outbox;
		this.transactions = options.transactions;
		this.clock = options.clock;
		this.crypto = options.crypto;
		this.botUsername = options.botUsername;
		this.admins = new Set(options.adminTelegramIds);
	}

	isAdminTelegramUserId(telegramUserId: string): boolean {
		return TELEGRAM_USER_ID.test(telegramUserId) && this.admins.has(telegramUserId);
	}

	async lookup(input: { readonly adminTelegramUserId: string; readonly deepLink: string }): Promise<AdminLookupResult> {
		if (!this.isAdminTelegramUserId(input.adminTelegramUserId)) return { ok: false, code: "forbidden" };
		const token = this.parseCanonicalDeepLink(input.deepLink);
		if (token === undefined) return { ok: false, code: "invalid_link" };
		const target = await this.transactions.withTransaction(() => this.repository.findByPublicToken(token));
		if (target === undefined) return { ok: false, code: "not_found" };
		return { ok: true, title: target.title, status: target.status };
	}

	async hide(input: {
		readonly adminTelegramUserId: string;
		readonly commandId: string;
		readonly deepLink: string;
		readonly reason: string;
	}): Promise<AdminHideResult> {
		if (!this.isAdminTelegramUserId(input.adminTelegramUserId)) return { ok: false, code: "forbidden" };
		const token = this.parseCanonicalDeepLink(input.deepLink);
		if (token === undefined) return { ok: false, code: "invalid_link" };
		const reason = input.reason.trim();
		if (reason.includes("\0") || codePointLength(reason) < 1 || codePointLength(reason) > 500) {
			return { ok: false, code: "invalid_reason" };
		}
		if (!COMMAND_ID.test(input.commandId)) return { ok: false, code: "unavailable" };
		const hiddenAt = clockMilliseconds(this.clock);

		return this.transactions.withTransaction(async () => {
			const target = await this.repository.findByPublicToken(token);
			if (target === undefined) return { ok: false, code: "not_found" };
			if (target.status === "hidden") return { ok: false, code: "already_hidden" };
			if (!isHideableStatus(target.status) || target.channelChatId === null || target.messageId === null) {
				return { ok: false, code: "unavailable" };
			}
			const projectionRevision = target.projectionRevision + 1;
			if (!Number.isSafeInteger(projectionRevision) || projectionRevision < 1) {
				throw new RangeError("collaboration projection revision is unsafe");
			}
			const hidden = await this.repository.markHidden({
				collaborationId: target.collaborationId,
				expectedStatus: target.status,
				expectedProjectionRevision: target.projectionRevision,
				hiddenAt,
			});
			if (!hidden) return { ok: false, code: "unavailable" };
			await this.repository.closePendingApplications(target.collaborationId);
			await this.repository.supersedeOlderProjectionDeliveries({
				collaborationId: target.collaborationId,
				beforeProjectionRevision: projectionRevision,
				updatedAt: hiddenAt,
			});
			const delivery = await this.outbox.createWithinTransaction({
				id: this.crypto.uuid(),
				idempotencyKey: `channel:${target.collaborationId}:hide:${projectionRevision}`,
				kind: "channel_delete",
				recipientChatId: target.channelChatId,
				messageId: target.messageId,
				payload: { version: 1, method: "delete" },
			});
			await this.repository.attachDeleteDelivery({
				collaborationId: target.collaborationId,
				deliveryId: delivery.id,
				updatedAt: hiddenAt,
			});
			await this.repository.appendAction({
				id: this.crypto.uuid(),
				actorTelegramUserId: input.adminTelegramUserId,
				collaborationId: target.collaborationId,
				reason,
				commandId: input.commandId,
				beforeStateJson: JSON.stringify({ status: target.status, projectionRevision: target.projectionRevision }),
				afterStateJson: JSON.stringify({ status: "hidden", projectionRevision }),
				createdAt: hiddenAt,
			});
			return {
				ok: true,
				collaborationId: target.collaborationId,
				title: target.title,
				previousStatus: target.status,
				projectionRevision,
			};
		});
	}

	private parseCanonicalDeepLink(value: string): string | undefined {
		const match = /^https:\/\/t\.me\/([A-Za-z0-9_]{5,32})\?start=c_([A-Za-z0-9_-]{22})$/.exec(value);
		if (match === null || match[1] !== this.botUsername || !PUBLIC_TOKEN.test(match[2] ?? "")) return undefined;
		return match[2];
	}
}

function isHideableStatus(status: AdminModerationStatus): status is HideableCollaborationStatus {
	return HIDEABLE_COLLABORATION_STATUSES.includes(status as HideableCollaborationStatus);
}

function codePointLength(value: string): number {
	return Array.from(value).length;
}

function clockMilliseconds(clock: Clock): number {
	const value = clock.now().getTime();
	if (!Number.isSafeInteger(value) || value < 0) throw new RangeError("admin moderation clock returned an unsafe timestamp");
	return value;
}
