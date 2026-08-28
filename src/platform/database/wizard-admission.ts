import type { WizardAdmission, WizardKind } from "../../shared/application/ports/wizard-admission.js";
import { resolveSqlDatabase, type SqlDatabaseInput } from "./node-sql-database.js";
import type { SqlDatabase } from "../../shared/application/ports/sql-database.js";

export class SqliteWizardAdmission implements WizardAdmission {
	private readonly database: SqlDatabase;

	constructor(source: SqlDatabaseInput) {
		this.database = resolveSqlDatabase(source);
	}

	async assertAvailable(kind: WizardKind, telegramUserId: string, now: number): Promise<void> {
		const sql = kind === "profile"
			? "SELECT 1 AS present FROM collaboration_sessions WHERE telegram_user_id = ? AND expires_at > ? LIMIT 1"
			: "SELECT 1 AS present FROM profile_sessions WHERE telegram_user_id = ? AND expires_at > ? LIMIT 1";
		const rows = await this.database.query<{ present: unknown }>(sql, [telegramUserId, now]);
		if (rows.length > 0) throw new Error("another wizard is already active");
	}
}
