import type { Language, MfmProfileInput, MfmSphere, MfmSpecialization } from "../../domain/mfm-profile.js";
import type { OnboardingNotice } from "../../application/onboarding-service.js";
export type Translation = readonly [string, string];
export const tr = (value: Translation, language: Language): string => value[language === "ru" ? 0 : 1];
export const COPY = {
	language: ["Выберите язык / Choose your language", "Выберите язык / Choose your language"],
	affiliation: ["Вы связаны с МФМ-2026? 🌍", "Are you connected with MFM-2026? 🌍"],
	event_status: ["Как вы участвуете в МФМ-2026?", "How are you taking part in MFM-2026?"],
	intro: ["Создайте короткий профиль 👋\n\nТак другие участники смогут найти вас по интересам и понять, чем вы можете быть полезны друг другу. Это займёт пару минут.", "Create a short profile 👋\n\nHelp other participants discover your interests and see how you could help each other. It takes a couple of minutes."],
	display_name: ["Как вас представить другим?\n\nУкажите имя или название проекта.", "How should we introduce you?\n\nEnter your name or project name."],
	profile_type: ["Кого вы представляете?", "Who do you represent?"],
	location: ["Откуда вы?\n\nУкажите город и страну.", "Where are you from?\n\nEnter your city and country."],
	spheres: ["Выберите вашу профессиональную сферу\n\nМожно выбрать до 3 направлений.", "Choose your professional field\n\nSelect up to 3 fields."],
	specializations: ["Уточните специализацию\n\nМожно выбрать до 3 суммарно.", "Choose your specializations\n\nSelect up to 3 in total."],
	open_to: ["К чему вы открыты?\n\nМожно выбрать несколько вариантов.\n🌆 Прогулки и мероприятия — компания для прогулки, кофе, события или знакомства с Екатеринбургом.", "What are you open to?\n\nYou can select several options.\n🌆 Walks and events — company for a walk, coffee, an event or exploring Yekaterinburg."],
	done: ["✅ Готово", "✅ Done"], back: ["← Назад", "← Back"],
	later: ["Продолжить позже", "Continue later"], cancel: ["Отменить изменения", "Cancel changes"],
	keep: ["Оставить", "Keep this"], city: ["📍 Екатеринбург, Россия", "📍 Yekaterinburg, Russia"],
	create: ["👤 Создать профиль", "👤 Create profile"], edit: ["✏️ Изменить профиль", "✏️ Edit profile"],
	resume: ["▶️ Продолжить профиль", "▶️ Continue profile"], resumePrompt: ["Продолжим заполнение профиля? Ваши данные сохранены.", "Continue your profile? Your progress is saved."],
	paused: ["Заполнение профиля сейчас приостановлено. Ваши данные сохранены.", "Profile setup is currently paused. Your progress is saved."],
	needs_start: ["Откройте бот командой /start.\nOpen the bot with /start.", "Open the bot with /start."],
	blocked: ["Изменения для этого аккаунта недоступны.", "Changes are unavailable for this account."],
	home: ["👤 Мой профиль", "👤 My profile"], selected: ["Выбрано", "Selected"],
	typeLabel: ["Кто вы", "You represent"], locationLabel: ["Откуда", "Location"],
	spheresLabel: ["Сферы", "Fields"], specializationsLabel: ["Специализации", "Specializations"], openToLabel: ["Открыты к", "Open to"],
	help: ["«Давай вместе» — короткий профиль для знакомства и профессионального общения.\n/start — профиль или продолжение анкеты\n/language — язык\n/profile — профиль\n\nПоддержка: ", "«Давай вместе» — a short profile for meeting people and professional conversations.\n/start — profile or continue setup\n/language — language\n/profile — profile\n\nSupport: "],
} as const satisfies Record<string, Translation>;
export const NOTICES: Record<OnboardingNotice, Translation> = {
	stale: ["Эта кнопка уже неактуальна. Продолжите с текущего шага.", "This button is out of date. Continue from the current step."],
	invalid: ["Проверьте ввод. Категории выбираются кнопками; имя — до 100, город и страна — до 200 символов.", "Check your input. Use buttons for categories; name up to 100 characters, location up to 200."],
	limit: ["Можно выбрать максимум 3 варианта.", "You can select up to 3 options."],
	required: ["Выберите хотя бы один вариант.", "Select at least one option."],
	removed: ["Специализации удалённой сферы убраны из выбора.", "Specializations from the removed field have been deselected."],
	saved: ["Профиль сохранён ✅", "Profile saved ✅"],
	paused: ["Черновик сохранён. Продолжить можно в любое время через /start.", "Your draft is saved. Continue any time with /start."],
};
export const EVENT_LABELS: Record<MfmProfileInput["eventStatus"], Translation> = {
	participant: ["🌍 Участник МФМ-2026", "🌍 MFM-2026 participant"], citizen_program: ["🏙 Участник программы «Горожане»", "🏙 Citizens programme participant"], volunteer: ["💚 Волонтёр МФМ", "💚 MFM volunteer"],
};
export const TYPE_LABELS: Record<MfmProfileInput["profileType"], Translation> = {
	specialist: ["👤 Себя / специалиста", "👤 Myself / a specialist"], media: ["📣 Блог / медиа / канал", "📣 Blog / media / channel"], project: ["🚀 Проект / команду", "🚀 Project / team"], business: ["🏢 Бизнес / бренд / площадку", "🏢 Business / brand / venue"],
};
export const SPHERE_LABELS: Record<MfmSphere, Translation> = {
	public_administration: ["🏛 Государственное управление", "🏛 Public administration"], media: ["📣 Медиа", "📣 Media"], science_education: ["🎓 Наука и образование", "🎓 Science and education"], entrepreneurship: ["💼 Предпринимательство", "💼 Entrepreneurship"], digital_it: ["💻 Цифровизация и IT", "💻 Digitalization and IT"], creative_industries: ["🎨 Креативные индустрии, культура и творчество", "🎨 Creative industries, culture and arts"], civic_engagement: ["🤝 Гражданская активность", "🤝 Civic engagement"], sports_health: ["🏃 Спорт и здоровье", "🏃 Sport and health"],
};
export const SPECIALIZATION_LABELS: Record<MfmSpecialization, Translation> = {
	blogger: ["Блогер / контент-креатор", "Blogger / content creator"], journalism: ["Журналистика", "Journalism"], smm: ["SMM / соцсети", "SMM / social media"], pr: ["PR / коммуникации", "PR / communications"], photo_video: ["Фото / видео", "Photography / video"], producing: ["Продюсирование", "Producing"],
	business: ["Бизнес", "Business"], startups: ["Стартапы", "Startups"], finance: ["Финансы / инвестиции", "Finance / investment"], marketing_sales: ["Маркетинг / продажи", "Marketing / sales"], ecommerce: ["E-commerce", "E-commerce"], horeca: ["HoReCa / сервис", "HoReCa / hospitality"],
	development: ["Разработка", "Development"], ai: ["AI / нейросети", "AI / neural networks"], data: ["Data / аналитика", "Data / analytics"], product_project: ["Product / Project", "Product / Project"], ux_ui: ["UX / UI", "UX / UI"], cybersecurity: ["Кибербезопасность", "Cybersecurity"],
	design: ["Дизайн", "Design"], fashion: ["Fashion", "Fashion"], music: ["Музыка", "Music"], cinema: ["Кино / видео", "Film / video"], art: ["Искусство", "Art"], architecture: ["Архитектура", "Architecture"],
	science: ["Наука", "Science"], research: ["Исследования", "Research"], education: ["Образование", "Education"], edtech: ["EdTech", "EdTech"], teaching: ["Преподавание", "Teaching"],
	social_projects: ["Социальные проекты", "Social projects"], volunteering: ["Волонтёрство", "Volunteering"], ngo: ["НКО", "NGOs"], ecology: ["Экология", "Environment"], charity: ["Благотворительность", "Charity"],
	sport: ["Спорт", "Sport"], fitness: ["Фитнес", "Fitness"], medicine: ["Медицина / здоровье", "Medicine / health"], wellness: ["Wellness", "Wellness"],
	government: ["Государственное управление", "Public administration"], municipal: ["Муниципальные проекты", "Municipal projects"], youth_policy: ["Молодёжная политика", "Youth policy"], international: ["Международное сотрудничество", "International cooperation"],
};
export const OPEN_TO_LABELS: Record<MfmProfileInput["openTo"][number], Translation> = {
	joint_projects: ["🤝 Совместные проекты", "🤝 Joint projects"], professional_communication: ["💬 Профессиональное общение", "💬 Professional conversations"], city_and_events: ["🌆 Прогулки и мероприятия", "🌆 Walks and events"],
};
