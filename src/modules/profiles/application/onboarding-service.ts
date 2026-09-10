import type { Clock } from "../../../shared/application/ports/clock.js";
import type { CryptoCapabilities } from "../../../shared/application/ports/crypto.js";
import type { TransactionRunner } from "../../../shared/application/ports/transaction-runner.js";
import { DomainValidationError } from "../../../shared/domain/value-objects/enums.js";
import { MFM_EVENT_STATUSES, MFM_OPEN_TO, MFM_PROFILE_TYPES, MFM_SPHERES, mfmAbout, mfmText, mfmValue, validateMfmContact, validateMfmProfile, type Language, type MfmContact, type MfmDraft, type MfmProfileRecord } from "../domain/mfm-profile.js";
import type { ExperienceUser, OnboardingRepository, OnboardingSession, OnboardingState, OnboardingStep } from "./ports/onboarding-repository.js";
import type { ProfileService } from "./profile-service.js";

export type OnboardingNotice = "stale" | "invalid" | "limit" | "required" | "saved" | "paused";
type ViewContext = { readonly language: Language; readonly festivalEnabled: boolean; readonly notice?: OnboardingNotice };
export type OnboardingView = ViewContext & (
	| { readonly kind: "classic"; readonly pendingStart?: string }
	| { readonly kind: "step"; readonly session: OnboardingSession }
	| { readonly kind: "home"; readonly profile: MfmProfileRecord }
	| { readonly kind: "paused" | "needs_start" | "blocked" }
);
export interface OnboardingToken { readonly generation: string; readonly revision: number; }
export type OnboardingAction =
	| { readonly kind: "language" | "affiliation" | "choice" | "text"; readonly value: string }
	| { readonly kind: "next" | "back" | "keep" | "city" | "clear" | "cancel" };
const FLOW: readonly OnboardingStep[] = ["affiliation", "event_status", "display_name", "profile_type", "location", "spheres", "open_to", "contact", "about"];

export class OnboardingService {
	constructor(
		private readonly repository: OnboardingRepository,
		private readonly profiles: Pick<ProfileService, "getOwn" | "ensureFromTelegram">,
		private readonly transactions: TransactionRunner,
		private readonly clock: Clock,
		private readonly crypto: CryptoCapabilities,
		readonly enabled: boolean,
	) {}

	async view(userId: string, notice?: OnboardingNotice): Promise<OnboardingView> {
		const user = await this.repository.getUser(userId);
		const context = { language: user?.language ?? "ru", festivalEnabled: this.enabled, ...(notice === undefined ? {} : { notice }) };
		if (user === undefined) return { ...context, kind: "needs_start" };
		if (user.status !== "active") return { ...context, kind: "blocked" };
		const session = await this.repository.getSession(userId);
		if (session?.state.step === "language") return { ...context, kind: "step", session };
		if (user.experience === "classic") return { ...context, kind: "classic" };
		const profile = user.experience === "mfm" ? await this.repository.getProfile(userId) : undefined;
		if (user.experience === "mfm" && !this.enabled && profile === undefined) return { ...context, kind: "paused" };
		if (session !== undefined) return { ...context, kind: "step", session };
		if (profile !== undefined) return { ...context, kind: "home", profile };
		return { ...context, kind: "needs_start" };
	}

	async start(userId: string, telegramName: string, pendingStart?: string): Promise<OnboardingView> {
		return this.transactions.withTransaction(async () => {
			const user = await this.repository.getUser(userId);
			if (user?.status !== "active") return this.view(userId);
			const profile = await this.profiles.ensureFromTelegram(userId, telegramName);
			const current = await this.repository.getSession(userId);
			if (user.experience === "classic") return { ...await this.view(userId), ...(pendingStart === undefined || pendingStart === "" ? {} : { pendingStart }) };
			if (user.experience === "undecided" && !this.enabled && user.language !== null) return this.finishClassic(userId, user, current?.state.pendingStart ?? pendingStart);
			if (current !== undefined || await this.repository.getProfile(userId) !== undefined) return this.view(userId);
			if (user.experience === "mfm") return this.view(userId);
			let draft: MfmDraft = {};
			try { draft = { displayName: mfmText(profile.displayName, 100) }; } catch { /* User supplies a shorter name. */ }
			await this.save(userId, {
				...this.initial(user.language === null ? "language" : "affiliation", draft),
				...(pendingStart === undefined || pendingStart.length === 0 || pendingStart.length > 64 ? {} : { pendingStart }),
			});
			return this.view(userId);
		});
	}

	async language(userId: string): Promise<OnboardingView> {
		return this.transactions.withTransaction(async () => {
			const user = await this.repository.getUser(userId);
			if (user?.status !== "active") return this.view(userId);
			if (user.experience === "undecided" && await this.profiles.getOwn(userId) === undefined) return { kind: "needs_start", language: user.language ?? "ru", festivalEnabled: this.enabled };
			const current = await this.repository.getSession(userId);
			if (current?.state.step === "language") return this.view(userId);
			await this.save(userId, current === undefined
				? { ...this.initial("language", {}), returnStep: user.experience === "undecided" ? "affiliation" : "home" }
				: { ...current.state, step: "language", returnStep: current.state.step });
			return this.view(userId);
		});
	}

	async edit(userId: string): Promise<OnboardingView> {
		return this.transactions.withTransaction(async () => {
			const user = await this.repository.getUser(userId);
			if (user?.status !== "active" || user.experience !== "mfm") return this.view(userId);
			if (await this.repository.getSession(userId) !== undefined) return this.view(userId);
			const profile = await this.repository.getProfile(userId);
			if (profile === undefined) return this.view(userId);
			await this.save(userId, { ...this.initial("display_name", profile), contact: profile.contact, editing: true });
			return this.view(userId);
		});
	}

	async cancel(userId: string): Promise<OnboardingView> {
		return this.transactions.withTransaction(async () => {
			const user = await this.repository.getUser(userId);
			if (user?.status !== "active") return this.view(userId);
			const session = await this.repository.getSession(userId);
			if (session?.state.editing || session?.state.returnStep === "home") {
				await this.repository.deleteSession(userId);
				return this.view(userId);
			}
			return this.view(userId, "paused");
		});
	}

	async act(userId: string, action: OnboardingAction, expected: OnboardingToken): Promise<OnboardingView> {
		return this.transactions.withTransaction(async () => {
			const user = await this.repository.getUser(userId);
			if (user?.status !== "active") return this.view(userId);
			const current = await this.repository.getSession(userId);
			if (current === undefined || current.revision !== expected.revision || current.state.generation !== expected.generation) return this.view(userId, "stale");
			if (!this.enabled && current.state.step !== "language") {
				if (user.experience === "undecided") return this.finishClassic(userId, user, current.state.pendingStart);
				if (user.experience === "mfm" && await this.repository.getProfile(userId) === undefined) return this.view(userId);
			}
			if (action.kind === "cancel") return this.cancel(userId);
			try { return await this.advance(userId, user, current.state, action); }
			catch (error) {
				if (error instanceof DomainValidationError) return this.view(userId, "invalid");
				throw error;
			}
		});
	}

	async selectContact(userId: string, contact: MfmContact, expected: OnboardingToken): Promise<OnboardingView> {
		return this.transactions.withTransaction(async () => {
			const user = await this.repository.getUser(userId);
			if (user?.status !== "active") return this.view(userId);
			const current = await this.repository.getSession(userId);
			if (current === undefined || current.revision !== expected.revision || current.state.generation !== expected.generation) return this.view(userId, "stale");
			if (current.state.step !== "contact") return this.view(userId, "invalid");
			if (!this.enabled && user.experience === "mfm" && await this.repository.getProfile(userId) === undefined) return this.view(userId);
			try {
				await this.save(userId, { ...current.state, step: "about", contact: validateMfmContact(contact) });
				return this.view(userId);
			}
			catch (error) {
				if (error instanceof DomainValidationError) return this.view(userId, "invalid");
				throw error;
			}
		});
	}

	private async advance(userId: string, user: ExperienceUser, state: OnboardingState, action: OnboardingAction): Promise<OnboardingView> {
		if (action.kind === "language" && state.step === "language") {
			const language = mfmValue(action.value, ["ru", "en"]);
			await this.repository.setUser(userId, language, user.experience);
			if (state.returnStep === "home") { await this.repository.deleteSession(userId); return this.view(userId); }
			if (user.experience === "undecided" && !this.enabled) return this.finishClassic(userId, { ...user, language }, state.pendingStart);
			const { returnStep, ...rest } = state;
			await this.save(userId, { ...rest, step: returnStep ?? "affiliation" });
			return this.view(userId);
		}
		if (action.kind === "affiliation" && state.step === "affiliation" && !state.editing) {
			mfmValue(action.value, ["yes", "no"]);
			if (action.value === "no") return this.finishClassic(userId, user, state.pendingStart);
			await this.repository.setUser(userId, user.language, "mfm");
			await this.save(userId, { ...state, step: "event_status" });
			return this.view(userId);
		}
		if (action.kind === "back") {
			const minimum = state.editing ? FLOW.indexOf("display_name") : 0;
			const index = FLOW.indexOf(state.step);
			if (index <= minimum) return this.view(userId);
			const step = FLOW[index - 1];
			if (step === undefined) return this.view(userId);
			await this.save(userId, { ...state, step });
			return this.view(userId);
		}
		if (action.kind === "next") {
			if (state.step === "spheres") return (state.draft.spheres?.length ?? 0) === 0 ? this.view(userId, "required") : this.move(userId, state, "open_to", state.draft);
			if (state.step === "open_to") return (state.draft.openTo?.length ?? 0) === 0 ? this.view(userId, "required") : this.move(userId, state, "contact", state.draft);
			if (state.step === "contact") { await this.save(userId, { ...state, step: "about", contact: state.editing ? state.contact ?? null : null }); return this.view(userId); }
			if (state.step === "about") return this.complete(userId, state, state.draft.about ?? null);
			return this.view(userId, "invalid");
		}
		if (action.kind === "clear" && state.step === "about" && state.editing) return this.complete(userId, state, null);
		if (action.kind === "city" && state.step === "location") return this.move(userId, state, "spheres", { ...state.draft, locationText: user.language === "en" ? "Yekaterinburg, Russia" : "Екатеринбург, Россия" });
		if (action.kind === "text" || action.kind === "keep") {
			if (state.step === "display_name") return this.move(userId, state, "profile_type", { ...state.draft, displayName: mfmText(action.kind === "text" ? action.value : state.draft.displayName, 100) });
			if (state.step === "location") return this.move(userId, state, "spheres", { ...state.draft, locationText: mfmText(action.kind === "text" ? action.value : state.draft.locationText, 200) });
			if (state.step === "contact" && action.kind === "text") { await this.save(userId, { ...state, step: "about", contact: validateMfmContact({ kind: "external", url: action.value }) }); return this.view(userId); }
			if (state.step === "about" && action.kind === "text") return this.complete(userId, state, mfmAbout(action.value));
			return this.view(userId, "invalid");
		}
		if (action.kind === "choice") {
			if (state.step === "event_status") return this.move(userId, state, "display_name", { ...state.draft, eventStatus: mfmValue(action.value, MFM_EVENT_STATUSES) });
			if (state.step === "profile_type") return this.move(userId, state, "location", { ...state.draft, profileType: mfmValue(action.value, MFM_PROFILE_TYPES) });
			if (state.step === "contact" && action.value === "telegram_user") { await this.save(userId, { ...state, step: "about", contact: { kind: "telegram_user" } }); return this.view(userId); }
			return this.toggle(userId, state, action.value);
		}
		return this.view(userId, "invalid");
	}

	private async toggle(userId: string, state: OnboardingState, value: string): Promise<OnboardingView> {
		let draft = state.draft;
		if (state.step === "spheres") {
			const key = mfmValue(value, MFM_SPHERES);
			const spheres = toggleChoice(draft.spheres ?? [], key);
			if (spheres === undefined) return this.view(userId, "limit");
			draft = { ...draft, spheres };
		} else if (state.step === "open_to") {
			const key = mfmValue(value, MFM_OPEN_TO);
			const openTo = toggleChoice(draft.openTo ?? [], key);
			if (openTo === undefined) return this.view(userId, "limit");
			draft = { ...draft, openTo };
		} else return this.view(userId, "invalid");
		await this.save(userId, { ...state, draft });
		return this.view(userId);
	}
	private async move(userId: string, state: OnboardingState, step: OnboardingStep, draft: MfmDraft): Promise<OnboardingView> {
		await this.save(userId, { ...state, step, draft });
		return this.view(userId);
	}
	private async complete(userId: string, state: OnboardingState, about: string | null): Promise<OnboardingView> {
		await this.repository.saveProfile(userId, validateMfmProfile({ ...state.draft, about }), this.now(), state.contact ?? null);
		await this.repository.deleteSession(userId);
		return this.view(userId, "saved");
	}
	private async finishClassic(userId: string, user: ExperienceUser, pendingStart?: string): Promise<OnboardingView> {
		await this.repository.setUser(userId, user.language, "classic");
		await this.repository.deleteSession(userId);
		return { kind: "classic", language: user.language ?? "ru", festivalEnabled: this.enabled, ...(pendingStart === undefined ? {} : { pendingStart }) };
	}
	private initial(step: OnboardingStep, draft: MfmDraft): OnboardingState { return { version: 1, generation: this.crypto.randomHex(8), step, draft, editing: false }; }
	private save(userId: string, state: OnboardingState): Promise<OnboardingSession> { return this.repository.saveSession(userId, state, this.now()); }
	private now(): number { return this.clock.now().getTime(); }
}
function toggleChoice<T extends string>(values: readonly T[], value: T): readonly T[] | undefined {
	if (values.includes(value)) return values.filter((x) => x !== value);
	return values.length >= 3 ? undefined : [...values, value];
}
