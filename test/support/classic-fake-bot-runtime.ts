import { createFakeBotRuntime, type FakeBotRuntimeOptions, type FakeBotRuntimeFixture } from "./fake-bot-runtime.js";

/** Legacy journeys model users enrolled in classic before the MFM migration.
 * Seed that account preference before ingress; profile creation and all business
 * actions still run through the real router and durable executor.
 */
export async function createClassicFakeBotRuntime(options: FakeBotRuntimeOptions): Promise<FakeBotRuntimeFixture> {
	const fixture = await createFakeBotRuntime(options);
	const { runtime } = fixture;
	const handle = runtime.bot.handleUpdate.bind(runtime.bot);
	runtime.bot.handleUpdate = async (update, webhookReplyEnvelope) => {
		const from = ("message" in update ? update.message?.from : undefined) ?? ("callback_query" in update ? update.callback_query?.from : undefined);
		if (from !== undefined) {
			await runtime.boundary.execute(
				"INSERT INTO telegram_users (telegram_user_id, display_name, status, created_at, updated_at, experience) VALUES (?, ?, 'active', 1, 1, 'classic') ON CONFLICT(telegram_user_id) DO UPDATE SET experience = 'classic' WHERE telegram_users.experience = 'undecided'",
				[String(from.id), from.first_name],
			);
		}
		await handle(update, webhookReplyEnvelope);
	};
	return fixture;
}
