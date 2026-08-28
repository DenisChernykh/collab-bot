export type WizardKind = "profile" | "collaboration";

export interface WizardAdmission {
	assertAvailable(kind: WizardKind, telegramUserId: string, now: number): Promise<void>;
}
