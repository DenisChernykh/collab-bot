import type { Language, MfmProfileInput, MfmSphere } from "../../domain/mfm-profile.js";
import type { OnboardingNotice } from "../../application/onboarding-service.js";
export type Translation = readonly [string, string];
export const tr = (value: Translation, language: Language): string => value[language === "ru" ? 0 : 1];
export const COPY = {
	language: ["Выберите язык / Choose your language", "Выберите язык / Choose your language"],
	affiliation: ["Вы связаны с МФМ-2026? 🌍", "Are you connected with MFM-2026? 🌍"],
	event_status: ["Как вы участвуете в МФМ-2026?", "How are you taking part in MFM-2026?"],
	intro: ["Создайте короткий профиль 👋\n\nТак другие участники смогут найти вас по интересам и понять, чем вы можете быть полезны друг другу. Это займёт пару минут.", "Create a short profile 👋\n\nHelp other participants discover your interests and see how you could help each other. It takes a couple of minutes."],
	display_name: ["Как вас представить другим?", "How should we introduce you?"],
	displayNameCurrent: ["Сейчас", "Current"],
	displayNameHint: ["Если хотите изменить, напишите ниже имя или название проекта.", "To change it, send your name or project name below."],
	profile_type: ["Кого или что вы представляете?\n\nВыберите основной вариант.", "Who or what do you represent?\n\nChoose the main option."],
	location: ["Откуда вы?\n\nУкажите город и страну.", "Where are you from?\n\nEnter your city and country."],
	spheres: ["В каких сферах вы работаете или развиваете проекты?\n\nВыберите до 3 направлений.\n\nОни помогут другим участникам находить вас для знакомств и коллабораций.", "What fields do you work in or build projects in?\n\nChoose up to 3 fields.\n\nThey help other participants find you for networking and collaborations."],
	open_to: ["К чему вы открыты?\n\nМожно выбрать несколько вариантов.\n🌆 Прогулки и мероприятия — компания для прогулки, кофе, события или знакомства с Екатеринбургом.", "What are you open to?\n\nYou can select several options.\n🌆 Walks and events — company for a walk, coffee, an event or exploring Yekaterinburg."],
	contact: ["Как с вами связаться?\n\nДобавьте Telegram или другую ссылку, чтобы участники могли написать вам после знакомства.", "How can people contact you?\n\nAdd Telegram or another link so participants can message you after connecting."],
	contactTelegram: ["✈️ Использовать мой Telegram", "✈️ Use my Telegram"],
	contactChannel: ["📣 Добавить канал", "📣 Add a channel"],
	contactGroup: ["👥 Добавить группу", "👥 Add a group"],
	contactOther: ["🔗 Указать другую ссылку", "🔗 Add another link"],
	contactPublicLink: ["Отправьте публичную ссылку в формате https://… Закрытые ссылки-приглашения не подходят.", "Send a public link in the https://… format. Private invitation links are not supported."],
	contactStale: ["Этот выбор чата уже неактуален. Используйте кнопки текущего шага.", "This chat selection is out of date. Use the buttons from the current step."],
	contactSelected: ["✅ Добавлено", "✅ Added"],
	contactSkipped: ["Контакт пропущен.", "Contact skipped."],
	contactClosed: ["Выбор контакта закрыт.", "Contact selection closed."],
	about: ["Расскажите о себе\n\nКоротко опишите себя, опыт или проекты — от 10 до 500 символов.", "Tell us about yourself\n\nBriefly describe yourself, your experience or projects — 10 to 500 characters."],
	aboutCurrent: ["Сейчас", "Current"],
	done: ["✅ Готово", "✅ Done"], back: ["← Назад", "← Back"],
	continue: ["Продолжить →", "Continue →"], skip: ["Пропустить", "Skip"], ofThree: ["из 3", "of 3"],
	later: ["Продолжить позже", "Continue later"], cancel: ["Отменить изменения", "Cancel changes"],
	keep: ["✓ Оставить как есть", "✓ Keep as is"], clear: ["Очистить", "Clear"], city: ["📍 Екатеринбург, Россия", "📍 Yekaterinburg, Russia"],
	create: ["👤 Создать профиль", "👤 Create profile"], edit: ["✏️ Изменить профиль", "✏️ Edit profile"],
	resume: ["▶️ Продолжить профиль", "▶️ Continue profile"], resumePrompt: ["Продолжим заполнение профиля? Ваши данные сохранены.", "Continue your profile? Your progress is saved."],
	paused: ["Заполнение профиля сейчас приостановлено. Ваши данные сохранены.", "Profile setup is currently paused. Your progress is saved."],
	needs_start: ["Откройте бот командой /start.\nOpen the bot with /start.", "Open the bot with /start."],
	blocked: ["Изменения для этого аккаунта недоступны.", "Changes are unavailable for this account."],
	home: ["👤 Мой профиль", "👤 My profile"], selected: ["Выбрано", "Selected"],
	typeLabel: ["Кто вы", "You represent"], locationLabel: ["Откуда", "Location"],
	spheresLabel: ["Сферы", "Fields"], openToLabel: ["Открыты к", "Open to"], aboutLabel: ["О себе", "About"],
	help: ["«Давай вместе» — короткий профиль для знакомства и профессионального общения.\n/start — профиль или продолжение анкеты\n/language — язык\n/profile — профиль\n\nПоддержка: ", "«Давай вместе» — a short profile for meeting people and professional conversations.\n/start — profile or continue setup\n/language — language\n/profile — profile\n\nSupport: "],
} as const satisfies Record<string, Translation>;
export const NOTICES: Record<OnboardingNotice, Translation> = {
	stale: ["Эта кнопка уже неактуальна. Продолжите с текущего шага.", "This button is out of date. Continue from the current step."],
	invalid: ["Проверьте ввод. Имя — до 100, город — до 200, «О себе» — от 10 до 500 символов.", "Check your input. Name up to 100, location up to 200, About from 10 to 500 characters."],
	limit: ["Можно выбрать до 3 направлений.", "You can select up to 3 fields."],
	required: ["Выберите хотя бы один вариант.", "Select at least one option."],
	saved: ["Профиль сохранён ✅", "Profile saved ✅"],
	paused: ["Черновик сохранён. Продолжить можно в любое время через /start.", "Your draft is saved. Continue any time with /start."],
};
export const EVENT_LABELS: Record<MfmProfileInput["eventStatus"], Translation> = {
	participant: ["🌍 Участник МФМ-2026", "🌍 MFM-2026 participant"], citizen_program: ["🏙 Участник программы «Горожане»", "🏙 Citizens programme participant"], volunteer: ["💚 Волонтёр МФМ", "💚 MFM volunteer"],
};
export const TYPE_LABELS: Record<MfmProfileInput["profileType"], Translation> = {
	specialist: ["👤 Себя / свою экспертизу", "👤 Myself / my expertise"], media: ["📣 Блог / медиа / канал", "📣 Blog / media / channel"], project: ["🚀 Проект / сообщество / команду", "🚀 Project / community / team"], business: ["🏢 Бизнес / бренд / организацию", "🏢 Business / brand / organization"],
};
export const SPHERE_LABELS: Record<MfmSphere, Translation> = {
	public_administration: ["🏛 Государство и управление", "🏛 Government and public administration"], media: ["📣 Медиа и коммуникации", "📣 Media and communications"], science_education: ["🎓 Наука и образование", "🎓 Science and education"], entrepreneurship: ["💼 Бизнес и предпринимательство", "💼 Business and entrepreneurship"], digital_it: ["💻 IT и технологии", "💻 IT and technology"], creative_industries: ["🎨 Культура и креатив", "🎨 Culture and creative industries"], civic_engagement: ["🤝 Общественные проекты и НКО", "🤝 Community projects and NGOs"], sports_health: ["🏃 Спорт и здоровье", "🏃 Sport and health"],
};
export const OPEN_TO_LABELS: Record<MfmProfileInput["openTo"][number], Translation> = {
	joint_projects: ["🤝 Совместные проекты", "🤝 Joint projects"], professional_communication: ["💬 Профессиональное общение", "💬 Professional conversations"], city_and_events: ["🌆 Прогулки и мероприятия", "🌆 Walks and events"],
};
