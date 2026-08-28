export const COMMAND_SOURCES = ["telegram", "operator", "runner"] as const;
export type CommandSource = (typeof COMMAND_SOURCES)[number];

export const RUNNER_KINDS = ["delivery", "deadline", "completion_reminder", "cleanup"] as const;
export type RunnerKind = (typeof RUNNER_KINDS)[number];

export type CommandActor =
	| { readonly kind: "telegram_user"; readonly telegramUserId: string }
	| { readonly kind: "admin"; readonly telegramUserId: string }
	| { readonly kind: "runner"; readonly runner: RunnerKind };

export interface CommandContext {
	readonly commandId: string;
	readonly telegramUpdateId?: number;
	readonly actor: CommandActor;
	readonly occurredAt: Date;
}
