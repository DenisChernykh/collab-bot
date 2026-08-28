import type { WizardAdmission, WizardKind } from "../../shared/application/ports/wizard-admission.js";
import type { DatabaseBoundary } from "./database-boundary.js";

export class SqliteWizardAdmission implements WizardAdmission {
	constructor(private readonly boundary: DatabaseBoundary) {}

	async assertAvailable(kind: WizardKind, telegramUserId: string, now: number): Promise<void> {
		const sql = kind === "profile"
			? "SELECT 1 AS present FROM collaboration_sessions WHERE telegram_user_id = ? AND expires_at > ? LIMIT 1"
			: "SELECT 1 AS present FROM profile_sessions WHERE telegram_user_id = ? AND expires_at > ? LIMIT 1";
		const rows = await this.boundary.query<{ present: unknown }>(sql, [telegramUserId, now]);
		if (rows.length > 0) throw new Error("another wizard is already active");
	}
}
