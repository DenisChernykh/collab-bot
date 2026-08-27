import { InlineKeyboard } from "grammy";

import type { CollaborationDraftInput, CollaborationDraftState, CollaborationWizardStep } from "../../domain/collaborations/collaboration.js";
import {
	parseCollaborationFormat,
	parseTargetProfileType,
	parseTopic,
	type CollaborationFormat,
	type CollaborationStatus,
	type Topic,
} from "../../domain/value-objects/enums.js";

export const COLLABORATION_FORMAT_LABELS: Record<CollaborationFormat, string> = {
	advertising_integration: "Рекламная интеграция",
	barter: "Бартер",
	joint_giveaway: "Совместный розыгрыш",
	joint_content: "Совместный контент",
	mutual_pr: "Взаимопиар",
	event: "Мероприятие",
	other: "Другое",
};

export type CollaborationMutationKind = "format" | "target" | "back" | "cancel" | "preview" | "publish";
export interface CollaborationMutation {
	readonly kind: CollaborationMutationKind;
	readonly value?: string;
	readonly generation: string;
	readonly revision: number;
}

export function parseCollaborationMutationCallback(data: string): CollaborationMutation | undefined {
	const match = /^collaboration:(format|target|back|cancel|preview|publish)(?::([a-z_]+))?:g([a-f0-9]{16}):r(\d+)$/.exec(data);
	if (match === null || match[1] === undefined || match[3] === undefined || match[4] === undefined) return undefined;
	const revision = Number(match[4]);
	if (!Number.isSafeInteger(revision) || revision < 0) return undefined;
	return { kind: match[1] as CollaborationMutationKind, ...(match[2] === undefined ? {} : { value: match[2] }), generation: match[3], revision };
}

export function collaborationCallbackInput(mutation: CollaborationMutation): { readonly input: CollaborationDraftInput; readonly step: CollaborationWizardStep } | undefined {
	if (mutation.kind === "format" && mutation.value !== undefined) {
		const value = mutation.value === "ad" ? "advertising_integration" : mutation.value;
		try { return { input: { format: parseCollaborationFormat(value) }, step: "target_profile_type" }; } catch { return undefined; }
	}
	if (mutation.kind === "target" && mutation.value !== undefined) {
		try { return { input: { targetProfileType: parseTargetProfileType(mutation.value) }, step: "topics" }; } catch { return undefined; }
	}
	return undefined;
}

export function parseCollaborationTopics(value: string): Topic[] | undefined {
	const values = value.split(",").map((topic) => topic.trim().toLowerCase()).filter(Boolean);
	if (values.length < 1 || values.length > 3) return undefined;
	const aliases = new Map<string, Topic>([
		["лайфстайл", "lifestyle"], ["еда", "food"], ["еда и рестораны", "food"], ["красота", "beauty"], ["путешествия", "travel"],
		["город", "city"], ["события", "events"], ["семья", "family"], ["спорт", "sport"], ["бизнес", "business"], ["другое", "other"],
	]);
	try {
		const topics = values.map((topic) => aliases.get(topic) ?? parseTopic(topic));
		return new Set(topics).size === topics.length ? topics : undefined;
	} catch { return undefined; }
}

export function previousCollaborationStep(step: CollaborationWizardStep): CollaborationWizardStep | undefined {
	const order: readonly CollaborationWizardStep[] = ["format", "target_profile_type", "topics", "title", "offer", "expectation", "slots", "deadline", "event_date", "preview"];
	const index = order.indexOf(step);
	return index <= 0 ? undefined : order[index - 1];
}

export function collaborationKeyboard(state: CollaborationDraftState, revision: number, canPublish: boolean): InlineKeyboard {
	const keyboard = new InlineKeyboard();
	if (state.step === "format") {
		for (const [value, label] of [["advertising_integration", "Рекламная интеграция"], ["barter", "Бартер"], ["joint_giveaway", "Совместный розыгрыш"], ["joint_content", "Совместный контент"], ["mutual_pr", "Взаимопиар"], ["event", "Мероприятие"], ["other", "Другое"]] as const) {
			const callbackValue = value === "advertising_integration" ? "ad" : value;
			keyboard.text(label, collaborationCallback(`collaboration:format:${callbackValue}`, state, revision)).row();
		}
		keyboard.text("← В главное меню", collaborationCallback("collaboration:back", state, revision)).row();
	} else if (state.step === "target_profile_type") {
		for (const [value, label] of [["blogger", "Блогер"], ["telegram_channel", "Telegram-канал"], ["venue_or_brand", "Заведение или бренд"], ["any", "Любой партнёр"]] as const) keyboard.text(label, collaborationCallback(`collaboration:target:${value}`, state, revision)).row();
	} else if (state.step === "preview") {
		if (canPublish) keyboard.text("📣 Опубликовать", collaborationCallback("collaboration:publish", state, revision)).row();
		keyboard.text("← Назад", collaborationCallback("collaboration:back", state, revision)).row();
		keyboard.text("Отменить черновик", collaborationCallback("collaboration:cancel", state, revision));
		return keyboard;
	} else {
		keyboard.text("← Назад", collaborationCallback("collaboration:back", state, revision)).row();
	}
	keyboard.text("Отменить черновик", collaborationCallback("collaboration:cancel", state, revision));
	return keyboard;
}

export function collaborationStatusLabel(status: CollaborationStatus): string {
	return ({ draft: "черновик", publishing: "публикация запущена", published: "опубликована", publication_failed: "ошибка публикации", expired: "истекла", matched: "совпадение", completed: "завершена", cancelled: "отменена", hidden: "скрыта" } as Record<string, string>)[status] ?? status;
}

function collaborationCallback(action: string, state: CollaborationDraftState, revision: number): string {
	return `${action}:g${state.generation}:r${revision}`;
}
