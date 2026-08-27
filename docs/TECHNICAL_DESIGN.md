# Collaboration Bot — Technical Design

- Статус: `Approved for solo-launch implementation`
- Версия: `0.5`
- Дата: `2026-08-26`
- Product source of truth: `docs/PRD.md`

## 1. Назначение и границы

Документ определяет реализационный контракт MVP Collaboration Bot:

- архитектурную форму;
- зависимости и версии;
- модули и допустимые направления связей;
- хранение и инварианты;
- Telegram ingress и outbound delivery;
- восстановление после сбоев;
- эксплуатацию на одном Mac;
- тестовую трассировку;
- последовательность реализации ИИ-агентом.

Документ не реализует приложение и не изменяет продуктовый scope. При противоречии с [PRD](./PRD.md) приоритет имеет PRD.

В MVP отсутствуют HTTP API, Mini App, веб-приложение, PostgreSQL, Redis, BullMQ, Docker и интеграция с Giveaway Bot.

Далее `Giveaway Bot` означает действующий бот розыгрышей из repository `gift-bot`; это один продукт, а не два разных бота.

### 1.1. Граница первого запуска

Первый запуск рассчитан на ручное распространение и единицы или десятки пользователей без технического user cap. Его единственная цель — быстро провести реального пользователя по `LFR-01`–`LFR-11` из PRD. Масштабирование, аналитика и полноценная операционная платформа не являются предварительными условиями.

Обязательный технический минимум:

- secrets не находятся в Git, БД, тестовых данных или логах;
- один вручную управляемый Node.js process и одна SQLite;
- миграции, foreign keys и базовая проверка целостности;
- повтор Telegram update/callback не дублирует бизнес-решение;
- Telegram network call не выполняется внутри SQLite transaction;
- после accepted только паре вычисляется Telegram direct action; до этого Telegram identity не раскрывается;
- ошибки видны в безопасных JSON logs, а процесс можно вручную перезапустить;
- перед изменением реальных данных допускается ручная копия SQLite-файла при остановленном процессе.

Heartbeat/status storage, scheduled cleanup/retention, exact Unix-socket admission, automated backup/restore, LaunchAgent tooling, completion reminders, product analytics и сложные moderation races отложены. Детальные разделы ниже сохраняют проектные решения для возможного продолжения, но не расширяют scope первого запуска. Канонический список и условия возврата находятся в [`DEFERRED_PLATFORM_CAPABILITIES.md`](./DEFERRED_PLATFORM_CAPABILITIES.md).

## 2. Архитектурное решение

### 2.1. Decision

Создать новый независимый TypeScript-проект в текущем репозитории.

Приложение является модульным монолитом в одном Node.js-процессе:

`Telegram Bot API → grammY adapter → application/domain → SQLite`.

«Бизнес-логика отдельно от Telegram» означает разделение по портам и слоям, а не отдельный сетевой backend-процесс.

### 2.2. Стек

| Компонент | Контракт MVP |
|---|---|
| Node.js | `>=24.18.0 <25` |
| pnpm | `>=11.15.1 <12`; packageManager `pnpm@11.15.1` |
| TypeScript | ESM, strict; ветка `5.9.x` |
| Telegram | `grammy 1.45.x`, long polling |
| ORM/schema | `drizzle-orm 0.45.x` и `drizzle-kit 0.31.x` |
| SQLite | встроенный `node:sqlite` / `DatabaseSync` |
| Dates | `date-fns 4.x` и `date-fns-tz 3.x` |
| Tests | `vitest 4.x` |
| Lint | ESLint 9 + typescript-eslint 8 |

Версии взяты из текущего [gift-bot/package.json](/Users/denischernykh/projects/gift-bot/package.json) и при bootstrap закрепляются lockfile. Перед dependency-changing командами исполнитель обязан проверить `node --version`, `pnpm --version` и будущий `package.json`.

Drizzle документирует нативную поддержку `node:sqlite`: [Drizzle — Node SQLite](https://orm.drizzle.team/docs/sqlite/connect-node-sqlite). Контракт `DatabaseSync` и `enableDefensive` проверен по ветке [Node.js 24.18 SQLite](https://nodejs.org/download/release/v24.18.0/docs/api/sqlite.html).

### 2.3. Рассмотренные альтернативы

| Вариант | Решение | Причина |
|---|---|---|
| Доработать действующий Giveaway Bot | отклонён | общий process/token/DB связывает два продукта и повышает blast radius |
| Полностью скопировать Giveaway Bot | отклонён | копия принесёт giveaway-схему, миграции и production identity |
| Копировать Planner | отклонён | большая продуктовая модель и PostgreSQL/worker topology не соответствуют нагрузке |
| Копировать nest-js-starter | отклонён | Nest, Prisma, PostgreSQL, auth Redis и web contracts не нужны MVP |
| Новый проект на лёгком стеке Giveaway Bot | выбран | минимум сервисов, знакомые механизмы и почти нулевая стоимость размещения |

### 2.4. Допустимое переиспользование

Из `gift-bot` разрешено адаптировать после отдельного source review:

- сериализованную SQLite transaction boundary;
- миграционный bootstrap;
- JSON logger;
- генерацию и хеширование opaque token;
- in-flight update tracker и graceful shutdown;
- классификацию Telegram API errors;
- fake Bot API test harness;
- общие идеи delivery ledger.

Запрещено переносить:

- giveaway tables и migrations;
- giveaway domain/application services;
- Telegram wizard и callback payloads розыгрышей;
- production username, assets и service labels;
- LaunchAgent-файлы без полного переименования и нового preflight;
- существующую SQLite;
- `.git` и историю другого проекта.

Общий npm-пакет не создаётся. Небольшое контролируемое дублирование дешевле преждевременного shared dependency.

## 3. Топология

### 3.1. Runtime

```text
Telegram Bot API
  │
  │ getUpdates / sendMessage / editMessage / deleteMessage
  ▼
Collaboration Bot — один Node.js process
  ├── Telegram ingress adapter
  ├── application use cases
  ├── domain policies
  ├── SQLite repositories
  ├── delivery runner
  ├── deadline/completion runner (Later)
  └── JSON logs
  │
  ▼
отдельный collaboration-bot.sqlite

Showcase Telegram Channel
  ▲
  └── channel publication adapter
```

Long polling не требует публичного HTTPS, домена или reverse proxy и подходит для одного малонагруженного instance: [grammY — long polling](https://grammy.dev/guide/deployment-types#long-polling-vs-webhooks).

### 3.2. Process roles

В MVP существует один process role `app`. Он последовательно:

1. загружает и валидирует конфигурацию;
2. открывает SQLite и применяет миграции;
3. проверяет production bot identity через `getMe`;
4. проверяет showcase channel и права;
5. восстанавливает уже реализованную durable delivery work;
6. запускает delivery runner;
7. запускает long polling;
8. при SIGINT/SIGTERM прекращает polling и новую delivery work, затем закрывает SQLite.

Отдельный migrator process и worker в MVP отсутствуют. Миграции также доступны явной командой для update-flow.

### 3.3. Later: automated availability boundary

Первый запуск выполняется вручную и не обещает фоновую доступность. Следующее описание относится к будущему LaunchAgent-варианту.

Mac LaunchAgent работает только после входа пользователя в GUI-сессию и пока Mac не спит и не выключен.

После простоя:

- Telegram updates забираются long polling;
- дедлайны обрабатываются catch-up проходом;
- подготовленные доставки продолжаются по durable state;
- `ambiguous` send не повторяется автоматически.

SLA и high availability не заявляются.

### 3.4. Later: single-instance admission

В первом запуске автор вручную обеспечивает запуск ровно одного process. Описанный ниже Unix-socket механизм не реализуется до появления повторяющихся конфликтов запуска или автоматического supervisor-а.

До открытия SQLite runtime захватывает Unix domain socket `.../CollaborationBot/run/collaboration-bot.sock` через `node:net`. Это защищает и от второго LaunchAgent, и от ручного запуска:

1. successful `listen(socketPath)` даёт ownership до shutdown;
2. при `EADDRINUSE` process пытается подключиться: successful connect означает live owner и startup fail closed;
3. только `ECONNREFUSED` разрешает stale recovery; process проверяет exact configured path, `lstat().isSocket()`, current-user ownership и отсутствие symlink, удаляет только этот stale socket и один раз повторяет `listen`;
4. clean shutdown закрывает server и удаляет только свой socket path.

Любая другая ошибка доступа/типа пути является startup fatal; broad cleanup `run/` не выполняется.

## 4. Слои и зависимости

### 4.1. Слои

```text
bootstrap/runtime
       │
       ├── adapters/telegram
       ├── infrastructure/sqlite
       └── application
                │
                ▼
              domain
```

Правила:

- `domain` не импортирует grammY, Drizzle, SQLite, process/env или Telegram types;
- `application` импортирует domain и объявляет порты;
- adapters/infrastructure реализуют порты;
- bootstrap создаёт зависимости и владеет lifecycle;
- модуль не обращается к таблице другого модуля в обход application port/use case;
- Telegram handlers не принимают продуктовые решения.

### 4.2. Модули

| Модуль | Ответственность |
|---|---|
| `profiles` | профиль, темы и публичные площадки; pairwise Telegram identity action вычисляется отдельно из `telegram_users` |
| `collaborations` | draft, публикация, версия условий, slots и lifecycle |
| `applications` | отклик, решение, атомарное заполнение slots |
| `moderation` | hide/restore, block/unblock и audit |
| `showcase-publication` | render, send/edit/delete и reconciliation |
| `notifications` | durable direct-message delivery |
| `analytics` | идемпотентные product events и read-only funnel |
| `telegram-runtime` | polling, sessions, callbacks, menus и graceful shutdown |

### 4.3. Межмодульные зависимости

- `applications` читает profile visibility и collaboration state через порты.
- `collaborations` не знает grammY и не вызывает Bot API.
- Application transaction создаёт бизнес-изменение, delivery intents и product events.
- `showcase-publication` проецирует collaboration read model в Telegram-канал.
- `moderation` оркестрирует profiles, collaborations, applications и publication через application ports.
- `analytics` принимает только безопасные структурированные события.

## 5. Application interfaces

### 5.1. Command envelope

Каждая изменяющая команда получает tagged actor, чтобы user/admin/runner commands не подделывали Telegram identity друг друга:

```ts
type CommandActor =
  | { kind: "telegram_user"; telegramUserId: string }
  | { kind: "admin"; telegramUserId: string }
  | {
      kind: "runner";
      runner: "delivery" | "deadline" | "completion_reminder" | "cleanup";
    };

interface CommandContext {
  commandId: string;
  telegramUpdateId?: number;
  actor: CommandActor;
  occurredAt: Date;
}
```

`commandId` детерминирован для Telegram update/callback и уникален для operator/runner work. Каждая mutation создаёт durable `command_receipt`; повтор с тем же input hash возвращает сохранённый результат и не повторяет эффект. Тот же `commandId` с другим input hash является conflict и ничего не меняет.

Все commands из Telegram user source проходят единый `RequireActiveActor` до модульной политики. Это одинаково охватывает profile/draft/publish/edit/apply/withdraw/accept/reject/close/cancel/complete/report; runner и allowlisted admin commands имеют отдельную policy. Blocked actor может выполнить только `/start`, `/help`, own-history queries и уже разрешённый accepted pairwise-contact query; остальные entrypoints возвращают один нейтральный blocked result.

### 5.2. Основные commands

| Command | Результат |
|---|---|
| `UpsertTelegramUser` | актуальный identity snapshot |
| `CreateProfile` / `UpdateProfile` | профиль без закрытого контакта в public result |
| `StartCollaborationDraft` | draft и wizard session |
| `UpdateCollaborationDraft` | новая draft version |
| `CancelCollaborationDraft` | транзакционное удаление draft/topics/session |
| `PublishCollaboration` | publication run; итог `published` или диагностируемая ошибка |
| `RetryFailedPublication` | новая attempt только после доказанного known failure без созданного поста |
| `EditPublishedCollaboration` | staged revision до первого application |
| `ReconcilePublishedEdit` | повтор known-target edit и apply/rollback pending revision |
| `ReconcilePublicationFound` | проверка и attach найденного showcase message |
| `ConfirmOrphanRemovedAndRetry` | новая publication attempt после ручной сверки |
| `ReconcileHiddenDeletion` | повтор delete известного старого message |
| `CancelCollaboration` | terminal state и delivery intents |
| `CompleteRecruitment` | `matched` при ≥1 accepted |
| `SubmitApplication` | `pending` application |
| `WithdrawApplication` | `withdrawn` |
| `DecideApplication` | `accepted` или `rejected` |
| `CompleteCollaboration` | `completed` и completion prompts |
| `ReportCompletion` | pairwise result |
| `HideCollaboration` / `RestoreCollaboration` | moderation result |
| `BlockUser` / `UnblockUser` | user status и cascade |
| `ExpireDueCollaborations` | matched/expired transitions |
| `DispatchDueDeliveries` | delivery outcomes |

### 5.3. Queries

- `GetOwnProfile`;
- `GetPublicProfile`;
- `GetCollaborationByPublicToken`;
- `BrowseCollaborations`;
- `ListOwnCollaborations`;
- `ListOwnApplications`;
- `GetApplicationDecisionView`;
- `ListAdminIncidents`;
- `CalculatePilotFunnel`.

Query DTO не возвращает Telegram identity до подтверждённого `accepted`. Pairwise contact view после accepted вычисляет action для второй стороны: `https://t.me/<current_username>` в приоритете, иначе inline `tg://user?id=<telegram_user_id>`. Если identity отсутствует или повреждена, adapter fail closed; request-contact handshake, relay и история переписки не входят в S3.

### 5.4. Domain value types

Enums и справочники берутся только из PRD:

- `ProfileType`;
- `CollaborationFormat`;
- `TargetProfileType`;
- `Topic`;
- `PlatformType`;
- `CollaborationStatus`;
- `ApplicationStatus`;
- `CompletionResult` со значениями `happened` и `did_not_happen`.

Справочники объявляются один раз в domain и используются validation/render/schema mapping.

## 6. Идентификаторы и время

### 6.1. IDs

- Telegram user/channel IDs хранятся как decimal `TEXT`, чтобы не зависеть от JavaScript number precision.
- Внутренние IDs создаются `crypto.randomUUID()` и хранятся как `TEXT`.
- Public collaboration token: 128 random bits, base64url без padding, уникальный.
- Callback token: 128 random bits, base64url, в callback передаётся только короткий prefix и token.
- Delivery/event idempotency key имеет уникальный индекс.

Public token не даёт права на изменение и поэтому может храниться в открытом виде. Callback token хранится только в виде hash.

### 6.2. Время

- Все timestamps хранятся в UTC как integer milliseconds.
- Wizard строго парсит календарный ввод `DD.MM.YYYY` в `Asia/Yekaterinburg`.
- Дедлайн означает конец выбранного local day — 23:59:59.999 `Asia/Yekaterinburg`; этот instant конвертируется в UTC ms и хранится в `response_deadline_at`.
- Пользовательская mutation допустима при `occurredAt <= response_deadline_at`; deadline work становится due только при `now > response_deadline_at`.
- Дата проведения не имеет времени и хранится как ISO local date `YYYY-MM-DD` в `event_date_local`; она сравнивается с local calendar date дедлайна, а не с UTC instant.
- Все timestamps показываются в `Asia/Yekaterinburg`; pure event date показывается без timezone conversion.
- Clock является application port; тесты используют fake clock.

## 7. SQLite contract

### 7.1. Connection

При открытии обязательны:

```sql
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;
PRAGMA busy_timeout = 5000;
```

`DatabaseSync.enableDefensive(true)` включается до application work.

Один `DatabaseBoundary` сериализует операции и транзакции внутри process. Вложенные repositories используют текущий transaction context, а не открывают новую транзакцию.

### 7.2. Transaction rules

- Изменение бизнес-состояния, product event и delivery intent записываются в одной транзакции.
- Telegram API никогда не вызывается внутри открытой SQLite transaction.
- Внешний вызов использует заранее сохранённый durable intent.
- Repository не выполняет implicit commit.
- Любое ограничение, которое возможно выразить в SQL, закрепляется FK, UNIQUE, CHECK или trigger.
- Cross-table invariants, которые нельзя выразить CHECK, проверяются use case и adversarial integration test.

### 7.3. Migrations

- Drizzle schema является typed mapping, SQL migrations — применяемая история.
- Существующие migrations не редактируются после принятия.
- Startup применяет pending migrations до polling.
- Update-flow отдельно выполняет `pnpm db:migrate` и останавливается при ошибке.
- Каждая migration проверяется на fresh database и upgrade fixture предыдущей версии.
- Destructive migration требует отдельного backup/restore rehearsal; явно авторизованное privacy-positive удаление чувствительного contact-поля является исключением: удалённые значения не копируются в legacy/backup table, а upgrade rehearsal доказывает сохранение всех остальных authoritative rows.
- Migration `0005_s1-03-telegram-first-contact.sql` также очищает `$.draft.privateContact` во всех `profile_sessions` и нормализует legacy `private_contact` в table/JSON step к `review` в одной migration transaction; generation, request ID, revision, expiry, timestamps и остальные draft fields сохраняются.

## 8. Data model

### 8.1. `telegram_users`

| Поле | Контракт |
|---|---|
| `telegram_user_id TEXT PK` | decimal Telegram ID |
| `username TEXT NULL` | последний snapshot |
| `display_name TEXT NOT NULL` | последний snapshot |
| `status TEXT NOT NULL` | `active` или `blocked` |
| `blocked_at INTEGER NULL` | UTC ms |
| `created_at / updated_at INTEGER` | UTC ms |

Block является identity policy. Внутренняя причина хранится только в append-only operator audit.

### 8.2. `profiles`

| Поле | Контракт |
|---|---|
| `id TEXT PK` | UUID |
| `telegram_user_id TEXT FK` | владелец |
| `type TEXT` | `ProfileType` CHECK |
| `display_name TEXT` | 2–100 |
| `description TEXT NULL` | NULL либо 10–500 |
| `city_code TEXT` | CHECK = `ekaterinburg` |
| `status TEXT` | `active` или `archived` |
| `created_at / updated_at INTEGER` | UTC ms |

Обычного UNIQUE на `telegram_user_id` нет: связь 1:N и история archived-профилей разрешены. MVP-инвариант «один active profile» защищают и use case, и частичный SQL-индекс:

```sql
CREATE UNIQUE INDEX profiles_one_active_per_user
ON profiles (telegram_user_id)
WHERE status = 'active';
```

Для будущих нескольких active profiles индекс снимается отдельной migration одновременно с появлением profile switcher.

Минимально завершённый active profile требует `type`, `display_name`, город и хотя бы одну platform. `description`, topics и `audience_size` являются необязательным enrichment: обычный create/edit wizard позволяет пропустить или очистить их, а public renderer опускает отсутствующие поля и не подставляет заглушки. Существующая таблица `profiles` переводится на nullable description data-preserving migration с сохранением IDs, active-index и всех внешних ссылок; существующие непустые значения не переписываются.

Все поля active profile редактируемы. Изменение profile type или других полей не отменяет существующие collaborations/applications и не запускает их ретроактивную validation: eligibility фиксируется в момент `SubmitApplication`. Все последующие public projections используют текущий profile; accepted pairwise query вычисляет Telegram action из актуального `telegram_users` snapshot.

### 8.3. `profile_platforms`

| Поле | Контракт |
|---|---|
| `id TEXT PK` | UUID |
| `profile_id TEXT FK` | owner, cascade delete |
| `platform_type TEXT` | `PlatformType` |
| `url TEXT` | canonical public URL |
| `title TEXT NULL` | display snapshot |
| `username TEXT NULL` | normalized without `@` |
| `telegram_chat_id TEXT NULL` | only Telegram channel |
| `audience_size INTEGER NULL` | CHECK ≥ 0 |

Хотя бы одна platform обеспечивается use case/integration test.

Public URL валидируется как абсолютный `https` URL длиной не более 2048 UTF-16 code units без credentials. Для ручного Telegram fallback допускается только канонический `https://t.me/<public_username>` с одним username path segment; invite-ссылки, `joinchat`, `+` links и private links отклоняются. Для остальных platform types MVP не проверяет соответствие hostname выбранной метке, чтобы не вводить хрупкий внешний справочник.

### 8.4. `profile_topics`

Composite PK `(profile_id, topic)`. CHECK на канонический `Topic`. Use case ограничивает количество 0–3; отсутствие rows означает, что пользователь ещё не добавил необязательные тематики.

### 8.5. `collaborations`

| Поле | Контракт |
|---|---|
| `id TEXT PK` | UUID |
| `public_token TEXT NULL UNIQUE` | opaque read-only lookup; создаётся перед publish |
| `author_profile_id TEXT FK` | owner |
| `format TEXT NULL` | `CollaborationFormat` |
| `target_profile_type TEXT NULL` | `TargetProfileType` |
| `title TEXT NULL` | 5–100 |
| `offer_text TEXT NULL` | 10–1000 |
| `expectation_text TEXT NULL` | 10–1000 |
| `slots_total INTEGER NULL` | CHECK 1–10 |
| `response_deadline_at INTEGER NULL` | publish mutation требует `occurredAt <= response_deadline_at`; runner считает due только при `now > response_deadline_at` |
| `event_date_local TEXT NULL` | ISO `YYYY-MM-DD`, не раньше local deadline date |
| `city_code TEXT NULL` | CHECK = `ekaterinburg` |
| `status TEXT` | `CollaborationStatus` |
| `version INTEGER` | active terms version; starts 1, monotonic |
| `projection_revision INTEGER` | монотонная версия любого public render |
| `pending_revision_json TEXT NULL` | валидированные proposed fields и topics |
| `pending_revision_version INTEGER NULL` | следующая terms version |
| `first_application_at INTEGER NULL` | once set, never cleared |
| `hidden_from_status TEXT NULL` | required for hidden |
| `published_at / matched_at / completed_at INTEGER NULL` | lifecycle |
| `cancelled_at / expired_at / hidden_at INTEGER NULL` | lifecycle/moderation |
| `created_at / updated_at INTEGER` | UTC ms |

Поля условий и topics могут быть неполными только в `draft`. Условные CHECK/trigger требуют для любого иного status не-NULL обязательные поля, `public_token`, 1–3 topics и все диапазоны PRD. `pending_revision_json` содержит полный versioned snapshot всех рендерящихся условий и списка topics; CHECK требует, чтобы оба pending-поля были NULL или оба заполнены. Пока pending snapshot есть, mutations карточки блокируются.

`version` меняется только при активации новых условий; `projection_revision` увеличивается также при каждом accepted count, status и visibility change. Количество accepted не дублируется: оно считается из `applications` в той же serialized transaction.

### 8.6. `collaboration_topics`

Composite PK `(collaboration_id, topic)`. Use case обеспечивает 1–3 темы.

### 8.7. `applications`

| Поле | Контракт |
|---|---|
| `id TEXT PK` | UUID |
| `collaboration_id TEXT FK` | target |
| `applicant_profile_id TEXT FK` | candidate |
| `message TEXT` | 10–500 |
| `collaboration_version INTEGER` | условия на момент отправки |
| `status TEXT` | `ApplicationStatus` |
| `decided_by_profile_id TEXT NULL` | author for accept/reject |
| `created_at INTEGER NOT NULL` | UTC ms |
| `decided_at INTEGER NULL` | UTC ms |

UNIQUE `(collaboration_id, applicant_profile_id)` запрещает второй отклик. CHECK запрещает неизвестные statuses. Self-application проверяется use case.

### 8.8. `completion_reports`

| Поле | Контракт |
|---|---|
| `id TEXT PK` | UUID |
| `application_id TEXT FK` | только accepted |
| `reporter_profile_id TEXT FK` | author или applicant |
| `result TEXT` | `happened` или `did_not_happen` |
| `created_at INTEGER` | UTC ms |

UNIQUE `(application_id, reporter_profile_id)`. Pairwise confirmation создаётся один раз, когда оба допустимых reporter имеют `happened`.

### 8.9. `telegram_sessions`

| Поле | Контракт |
|---|---|
| `telegram_user_id TEXT PK/FK` | один активный session |
| `flow_type TEXT` | profile, collaboration, browse, moderation |
| `step TEXT` | канонический step |
| `state_json TEXT` | versioned, validated payload |
| `revision INTEGER` | optimistic UI version |
| `expires_at / updated_at INTEGER` | UTC ms |

TTL считается от `updated_at`: browse — 24 часа, profile wizard — 30 суток, collaboration wizard — 30 суток, moderation — 1 час. Solo-launch browse state содержит только текущие filters, keyset cursor, revision и TTL; долговременная история просмотров и analytics не сохраняются. Expired profile/moderation/browse session удаляется. Expired collaboration session обрабатывается через ту же транзакционную cancel policy, что и ручная `Отмена`, чтобы не оставить orphan draft.

### 8.10. `telegram_actions`

| Поле | Контракт |
|---|---|
| `token_hash TEXT PK` | SHA-256 opaque callback token |
| `actor_telegram_user_id TEXT FK` | binding |
| `action_type TEXT` | allowlisted action |
| `entity_id TEXT NULL` | target |
| `expected_version INTEGER NULL` | stale guard |
| `mode TEXT` | `one_shot` или `reusable` |
| `expires_at INTEGER` | UTC ms |
| `consumed_at INTEGER NULL` | one-shot result |
| `result_json TEXT NULL` | safe replay result |

Callback payload имеет форму `cb_<token>` и помещается в Telegram limit 64 bytes.

### 8.11. `command_receipts`

| Поле | Контракт |
|---|---|
| `command_id TEXT PK` | idempotency identity |
| `source TEXT` | `telegram`, `operator` или `runner` |
| `telegram_update_id INTEGER NULL` | ingress correlation |
| `input_hash TEXT` | hash каноничной команды |
| `status TEXT` | `in_progress` или `completed` |
| `result_json TEXT NULL` | versioned safe replay result |
| `created_at INTEGER NOT NULL` | UTC ms |
| `completed_at INTEGER NULL` | UTC ms |

Однотранзакционная mutation вставляет receipt, бизнес-эффект, outbox/events и `completed` result в одной transaction. При crash они все откатываются. `in_progress` используется только для явно многофазного operator-flow; recovery не повторяет внешний эффект, а показывает incident. Outbound runner replay опирается на delivery ledger, а не на незавершённый receipt.

### 8.12. `processed_updates`

| Поле | Контракт |
|---|---|
| `update_id INTEGER PK` | Telegram update |
| `command_id TEXT UNIQUE FK` | ссылка на replay result |
| `processed_at INTEGER` | UTC ms |

Update и receipt вставляются в одной transaction с effect/outbox/events. Cleanup обеих таблиц оставляет минимум последние 7 суток и последние 50 000 Telegram IDs; связанные незавершённые operator receipts не удаляются.

### 8.13. `channel_publications`

| Поле | Контракт |
|---|---|
| `collaboration_id TEXT PK/FK` | projection owner |
| `channel_chat_id TEXT` | configured showcase |
| `message_id INTEGER NULL` | known Telegram ID |
| `status TEXT` | publication state |
| `rendered_terms_version INTEGER` | active collaboration terms version |
| `rendered_projection_revision INTEGER` | exact public generation |
| `rendered_hash TEXT` | exact render checksum |
| `current_attempt_no INTEGER` | monotonic publication generation |
| `last_delivery_id TEXT NULL` | ledger link |
| `last_error_kind TEXT NULL` | safe classification |
| `updated_at INTEGER` | UTC ms |

Publication statuses:

- `prepared`;
- `sending`;
- `published`;
- `sync_pending`;
- `sync_ambiguous`;
- `failed`;
- `deleted`;
- `delete_unconfirmed`.

### 8.14. `publication_attempts`

| Поле | Контракт |
|---|---|
| `id TEXT PK` | UUID |
| `collaboration_id TEXT FK` | owner |
| `attempt_no INTEGER` | monotonic per collaboration |
| `kind TEXT` | `initial`, `retry`, `restore` или `reconcile` |
| `projection_revision INTEGER` | render generation |
| `status TEXT` | attempt lifecycle |
| `candidate_message_id INTEGER NULL` | admin-provided reconciliation target |
| `confirmed_message_id INTEGER NULL` | known successful target |
| `started_at / finished_at INTEGER NULL` | UTC ms |

UNIQUE `(collaboration_id, attempt_no)`. Statuses: `prepared`, `dispatching`, `succeeded`, `known_failed`, `ambiguous`, `superseded` и `cancelled`. Новая attempt запрещена, пока предыдущая `ambiguous` не закрыта аудируемым reconciliation-решением.

### 8.15. `outbox_deliveries`

| Поле | Контракт |
|---|---|
| `id TEXT PK` | UUID |
| `idempotency_key TEXT UNIQUE` | semantic effect identity |
| `kind TEXT` | DM send, channel send/edit/delete |
| `recipient_chat_id TEXT` | decimal ID |
| `message_id INTEGER NULL` | edit/delete or successful send |
| `payload_json TEXT` | versioned rendered payload |
| `status TEXT` | delivery state |
| `attempt_count INTEGER` | CHECK ≥ 0 |
| `claim_token TEXT NULL` | fencing token текущего dispatch |
| `dispatch_started_at INTEGER NULL` | stale recovery boundary |
| `request_deadline_at INTEGER NULL` | provider-call deadline |
| `next_attempt_at INTEGER NULL` | retry schedule |
| `telegram_retry_after INTEGER NULL` | 429 |
| `last_error_kind TEXT NULL` | safe classification |
| `created_at / updated_at INTEGER` | UTC ms |

Delivery statuses:

- `prepared`;
- `dispatching`;
- `sent`;
- `retryable_failed`;
- `ambiguous`;
- `permanent_failed`;
- `superseded`;
- `cancelled`.

`cancelled` является terminal outcome для intent, про который до provider call доказано, что он больше не должен отправляться. Он не применяется к `dispatching`/`ambiguous` delivery. `superseded` остаётся отдельным terminal outcome для intent, который новая authoritative state сделала неактуальным: например, старая projection revision заменена новой либо unclaimed completion reminder заменён итоговым report.

### 8.16. `operator_actions`

Append-only audit только изменяющих admin-команд:

- action ID;
- actor kind `admin` и Telegram ID;
- action type;
- target user/collaboration;
- internal reason длиной 1–500 символов;
- before/after safe state;
- command ID;
- created_at.

Action types: `hide_collaboration`, `restore_collaboration`, `block_user`, `unblock_user`, `retry_failed_publication`, `reconcile_publication_found`, `confirm_orphan_removed_and_retry`, `reconcile_published_edit_apply`, `reconcile_published_edit_rollback` и `reconcile_hidden_deletion`. Audit row создаётся в той же transaction, что command receipt и state transition. Author-initiated safe retry доказывается собственным `command_receipt` и не записывается в admin-only `operator_actions`.

### 8.17. Later: `product_events`

Append-only:

- event ID;
- event type from PRD;
- idempotency key UNIQUE;
- actor/profile/collaboration/application IDs nullable;
- safe attributes JSON;
- occurred_at.

Raw user content, contacts and tokens are forbidden.

### 8.18. Later: `runtime_health`

Одна singleton-row хранит только operational state: `process_started_at`, `last_heartbeat_at`, `last_poll_at`, `last_deadline_pass_at`, `showcase_capability`, `showcase_checked_at`, `last_graceful_shutdown_at`, `last_backup_at` и `updated_at`. Runtime обновляет heartbeat не чаще раза в 30 секунд. Это позволяет команде `status` отличать persisted last-known state от live PID check. Старый timestamp не выдаётся за текущую готовность.

## 9. Core atomic workflows

### 9.1. `CancelCollaborationDraft`

В одной transaction use case проверяет actor/ownership и `draft`, записывает completed command receipt, удаляет `collaboration_topics`, связанную collaboration wizard-session и сам `collaborations` row. Ни outbox, ни новый product event не создаются; уже записанный `collaboration_draft_started` остаётся и позволяет увидеть незавершённый flow. Повтор возвращает тот же safe result из receipt.

### 9.2. `SubmitApplication`

Telegram adapter разрешает открыть карточку и нажать `Откликнуться` без профиля. Если active profile отсутствует, mutation ещё не начинается: durable profile session сохраняет typed continuation на collaboration и source, запускает quick mode с обязательными `type → display_name → platform`, сохраняет минимально завершённый profile и затем повторно открывает ввод application message. Description, topics и audience в quick mode не запрашиваются. После restart flow продолжается с сохранённого шага; после завершения target повторно проходит текущие guards.

В одной transaction:

1. claim Telegram update и command receipt с input hash;
2. require active actor/profile;
3. load collaboration and require `published`, `occurredAt <= response_deadline_at` and healthy action state;
4. reject own profile, existing application и applicant profile type, не совпадающий с collaboration target, кроме `target_profile_type = any`;
5. count accepted and require free slot;
6. insert `pending` application with collaboration version;
7. set `first_application_at` once;
8. insert author notification intent;
9. commit.

Telegram DM отправляется после commit.

### 9.3. `WithdrawApplication`

В одной serialized transaction use case claim-ит command receipt, require active actor и applicant profile ownership, загружает application и разрешает переход только из `pending` в `withdrawn`. Collaboration, slots и уже созданные notification intents не меняются; новый product event не создаётся, поскольку такого event type нет в PRD. В race с accept/reject/close побеждает первая committed serialized transaction, а проигравшая команда возвращает актуальный safe state без изменения данных. Повтор того же command возвращает receipt result.

### 9.4. `DecideApplication: accept`

В одной serialized transaction:

1. claim command receipt;
2. require actor = collaboration author and actor not blocked;
3. require application `pending`, collaboration `published` и отсутствие pending revision/sync lock;
4. повторно require active applicant profile и незаблокированного applicant user; иначе закрыть application и вернуть `applicant_unavailable` без раскрытия контакта;
5. count accepted;
6. if count ≥ slots, return deterministic `slots_filled` without changing application;
7. set application `accepted`;
8. increment collaboration `projection_revision` и create pairwise contact notifications;
9. if new count = slots:
   - set collaboration `matched`;
   - close remaining `pending`;
   - create their notifications;
10. create channel sync intent для новой projection revision;
11. commit.

Сериализованный DatabaseBoundary делает конкурентное принятие последнего места детерминированным. Integration test обязан запускать минимум две concurrent promises.

### 9.5. `DecideApplication: reject`

Transaction проверяет ownership и `pending`, переводит один application в `rejected` и создаёт notification intent. Collaboration и slots не меняются.

### 9.6. `CompleteRecruitment`

Сериализованная transaction require active author, owned `published` collaboration, отсутствие pending revision/sync lock и минимум один `accepted`. Затем она ставит `matched_at`, переводит collaboration в `matched`, закрывает все `pending`, increment-ит `projection_revision` и атомарно создаёт projection/notification intents. Повтор возвращает completed receipt; outbound failure не откатывает `matched`.

### 9.7. `CancelCollaboration`

В одной serialized transaction:

1. require active author и owned collaboration в `published` или `matched`; terminal cancel разрешён даже при publication `sync_ambiguous`;
2. collaboration → `cancelled`, записать `cancelled_at`, отбросить pending terms revision и increment `projection_revision`;
3. все remaining `pending` → `closed`;
4. создать один projection edit intent, уведомления pending/accepted и product events;
5. complete command receipt и commit.

`accepted` и раскрытые контакты не меняются. Outbound failure не откатывает cancellation; прежний incident остаётся открытым, а reconciliation приводит известный пост к текущему `cancelled` render.

### 9.8. `ExpireDueCollaborations`

Runner выбирает по стабильному keyset как due `published`, так и `hidden` с `hidden_from_status = published`, и обрабатывает каждую карточку отдельной transaction:

- accepted > 0: business status → `matched`;
- accepted = 0: business status → `expired`;
- pending → `closed`;
- channel sync, notifications и events создаются атомарно.

Для hidden row меняется `hidden_from_status`, а сам `status` остаётся `hidden`; channel edit не нужен. Повтор runner безопасен по status и idempotency keys.

Отдельно runner переводит due `publication_failed` в `expired`, только если latest attempt имеет `known_failed`, `message_id` отсутствует и ни одна attempt не остаётся `ambiguous`. Unresolved ambiguous outcome никогда не истекает автоматически: сначала администратор обязан доказать наличие поста либо его отсутствие через reconciliation.

### 9.9. `BlockUser`

В одной transaction:

1. записать moderation command receipt;
2. user → `blocked`;
3. `publishing` и `publication_failed` карточки автора → `cancelled` с `cancelled_at` и increment `projection_revision`; unclaimed send attempts/deliveries → `cancelled`, а in-flight/ambiguous attempt сохраняется для fenced outcome/reconciliation;
4. активные `published` и `matched` карточки автора → `hidden` с `hidden_from_status`, `hidden_at`, очисткой pending terms revision и increment `projection_revision`;
5. уже `hidden` карточки остаются hidden; их unclaimed restore attempts/deliveries → `cancelled`, in-flight restore остаётся для fenced outcome;
6. pending applications на эти карточки → `closed`;
7. все pending applications, отправленные любым принадлежащим блокируемому пользователю профилем на чужие карточки, → `closed`;
8. создать delete intents для известных showcase posts;
9. создать безопасные notifications, audit и events, затем commit.

Accepted application и completion report не изменяются. `UnblockUser` меняет только identity policy и не воскрешает `closed` applications или hidden cards.

### 9.10. `HideCollaboration` / `RestoreCollaboration`

Hide разрешён для любого бизнес-статуса с известным showcase post: `published`, `matched`, `completed`, `cancelled` и `expired`. Transaction сохраняет его в `hidden_from_status`, ставит `hidden`, закрывает pending, increment проекции и создаёт delete intent/audit. Деловые accepted и contacts не меняются.

Restore require active author для любого `hidden_from_status`, publication `deleted` и для target `published` — `occurredAt <= response_deadline_at`. Затем он создаёт новую publication attempt, но до известного Telegram success collaboration остаётся `hidden`. После success она возвращается в `hidden_from_status`, очищает overlay и сохраняет новый `message_id`. Ошибка/ambiguity оставляет row hidden и создаёт incident.

### 9.11. `CompleteCollaboration` / `ReportCompletion`

`CompleteCollaboration` в serialized transaction require active author и owned `matched`, ставит `completed/completed_at`, increment-ит projection и создаёт channel edit плюс по одному outcome prompt для каждой accepted пары. `ReportCompletion` принимает ответ только от автора или applicant соответствующего `accepted` application, а UNIQUE application/reporter делает replay безопасным. `collaboration_bilateral_confirmed` создаётся ровно один раз только при двух `happened`; два отрицательных или противоречащие ответы только сохраняются.

### 9.12. `BrowseCollaborations`

Read query формирует один SQL predicate из каноничной policy PRD:

- не-`Любой` измерения соединяются AND;
- format сравнивается на точное равенство;
- topic требует membership в `collaboration_topics`;
- конкретный profile type включает exact target и `target_profile_type = any`;
- status/deadline/slots/own/already-applied/session-seen exclusions применяются последовательно в том же query;
- keyset order и cursor используют `published_at DESC, id DESC`.

Перед render каждая выбранная row повторно проходит visibility predicate; исчезнувшая из-за concurrent transition row пропускается.

`BrowseCollaborations` и deep-link lookup остаются read queries. После известного успешного Telegram `sendMessage`/`editMessageText` adapter отдельной короткой transaction вставляет `collaboration_viewed` с key `view:<command_id>:<collaboration_id>`. UNIQUE key делает duplicate update/callback безопасным; known failure или ambiguous provider outcome event не создаёт.

## 10. Telegram ingress

### 10.1. Long polling

Используется grammY `bot.start()` либо эквивалентный контролируемый runner с одним instance на token.

Обязательные свойства:

- Bot API `allowed_updates` явно задаёт типы `message` и `callback_query`;
- тип чата не фильтруется через `allowed_updates`: ingress adapter отдельно require `chat.type === "private"`, а group/channel interactions игнорируются;
- до `bot.start()` устанавливается `bot.catch`, который логирует structured error и не позволяет middleware exception остановить polling: [grammY — error handling](https://grammy.dev/guide/errors);
- каждый update имеет in-flight tracking;
- graceful shutdown вызывает `bot.stop()`, затем самостоятельно ждёт application in-flight tracker до закрытия DB, поскольку `bot.stop()` не ожидает завершения middleware: [grammY Bot API](https://grammy.dev/ref/core/bot);
- duplicate update безопасен благодаря `processed_updates`.

Long polling не является worker discovery: отдельный process не стартует автоматически.

### 10.2. Handler contract

Handler выполняет только:

1. нормализацию Telegram update;
2. разрешение actor;
3. mapping в command/query;
4. вызов application use case;
5. render результата;
6. ответ/acknowledge callback.

Validation, permissions, slots и state transitions находятся в application/domain.

### 10.3. Wizard state

- Session сохраняется после каждого успешно принятого шага.
- Текст не удаляет старое валидное состояние до успешной validation.
- `Назад` восстанавливает предыдущий typed snapshot.
- `Отмена` в profile/browse flow удаляет только session; в collaboration flow вызывает `CancelCollaborationDraft`, который удаляет draft/topics/session одной transaction. Опубликованные entities `Отмена` никогда не меняет.
- Новый flow при существующем session предлагает `Продолжить` или `Отменить текущий`.
- Unknown session schema version закрывается безопасно и предлагает начать заново.
- Deferred profile session хранит typed continuation: `{ kind: "create_collaboration" }` либо `{ kind: "submit_application", collaborationId, source, suspendedBrowseState? }`. Для `submit_application` session также фиксирует quick mode: обязательны только `type`, `display_name` и одна platform; description/topics/audience steps отсутствуют. После completion исходное действие повторно проходит текущие guards; недоступная или устаревшая target collaboration даёт безопасный актуальный result, после чего восстанавливается сохранённая browse state либо главное меню.

### 10.4. Callback safety

- Callback содержит только opaque token.
- Row повторно проверяет actor, expiry, action type и expected entity version.
- One-shot mutation сохраняет consumed result.
- Replay показывает сохранённый/актуальный результат.
- Чужой actor получает нейтральное `Кнопка недоступна`.
- Stale action получает `Экран устарел` и новую карточку.
- Ни public token, ни callback token не логируется.

### 10.5. Channel selection

Для `telegram_channel` profile бот отправляет reply keyboard с `KeyboardButtonRequestChat`:

- `chat_is_channel = true`;
- request title, username и photo;
- не требовать `bot_is_member`;
- уникальный `request_id` связан с profile wizard session.

Ответ `ChatShared` принимается только при совпавшем request ID и actor session. Telegram предупреждает, что бот может не иметь доступа к выбранному chat ID; для MVP используются переданные title/username, а отсутствие username ведёт к ручному URL fallback: [Telegram Bot API](https://core.telegram.org/bots/api).

### 10.6. Public deep links

Формат:

```text
https://t.me/<bot_username>?start=c_<public_token>
```

Telegram разрешает `A-Z a-z 0-9 _ -` и ограничивает start parameter 64 символами: [Telegram Bot Features — Deep Linking](https://core.telegram.org/bots/features).

`c_<22-char-base64url>` укладывается в limit. Deep link только читает публичную карточку; все mutations требуют actor-bound callback.

### 10.7. Rendering

- Один pure renderer принимает read model и target `bot_card`, `showcase_post` или `notification`.
- Длины считаются в UTF-16 code units до Bot API call.
- User text экранируется; formatter не допускает injection в HTML/Markdown.
- Show preview и final publish используют один render contract.
- Bot API result не логируется целиком.

## 11. Showcase publication

### 11.1. Startup capability

После `getMe` runtime проверяет configured showcase channel:

- бот видит channel;
- бот является administrator;
- доступны `can_post_messages`, `can_edit_messages` и `can_delete_messages`.

Если `getMe.id` или нормализованный `getMe.username` не совпали с `EXPECTED_BOT_ID`/`EXPECTED_BOT_USERNAME`, process fail closed до polling.

Если channel недоступен или rights неполные, process запускается в degraded режиме:

- чтение существующих данных работает;
- публикация/restore блокируются;
- admin получает диагностическое состояние;
- runner периодически перепроверяет capability.

### 11.2. Initial send

1. Transaction проверяет полноту draft и `occurredAt <= response_deadline_at`, генерирует public token, переводит draft в `publishing`, создаёт `channel_publications: prepared`, `publication_attempts: prepared` и delivery `prepared`.
2. Runner перед claim повторно проверяет deadline. Если `now > response_deadline_at` до первого network call, attempt/delivery становятся `cancelled`, collaboration — `expired`, а Telegram не вызывается.
3. Runner claim переводит delivery/publication/attempt в `dispatching/sending/dispatching` и сохраняет fencing token/deadline.
4. Transaction commit.
5. Bot API `sendMessage` вызывается без DB transaction.
6. При известном success outcome transaction всегда сохраняет returned `message_id`, но перед публикацией повторно require matching attempt generation/claim, collaboration `publishing` и active author. Если любой fence не совпал из-за concurrent block/moderation/terminal transition, outcome помечается `superseded`, для известного поста создаётся delete intent, а текущий business status не меняется. При совпавшем fence transaction закрывает attempt/delivery и повторно сравнивает deadline: при `now <= response_deadline_at` collaboration становится `published`; при `now > response_deadline_at` — сразу `expired`, не попадает в feed и создаёт terminal edit intent.

Известная retryable ошибка без создания сообщения переводит delivery в `retryable_failed` с bounded schedule, но оставляет collaboration `publishing` и ту же attempt generation. Известный permanent отказ или исчерпание пяти определённых попыток закрывает attempt как `known_failed`, delivery как `permanent_failed` и переводит collaboration в `publication_failed`.

`RetryFailedPublication` разрешён активному автору либо allowlisted admin только когда latest attempt имеет `known_failed`, `message_id` отсутствует и нет unresolved `ambiguous` attempt. При `occurredAt <= response_deadline_at` command атомарно создаёт следующую attempt/delivery generation и возвращает collaboration в `publishing`; при `occurredAt > response_deadline_at` он переводит карточку в `expired` без Bot API call. Admin retry в той же transaction пишет `operator_actions` с обязательной внутренней причиной; author retry доказывается `command_receipt` и не создаёт admin audit.

Если запрос мог дойти до Telegram, но ответ не известен:

- delivery → `ambiguous`;
- publication → `sync_ambiguous`;
- collaboration → `publication_failed`;
- автоматический retry запрещён;
- admin incident содержит внутренний UUID `collaboration_id`, channel, время и safe error kind, но не public token, callback token и не raw user text.

Администратор сверяет канал и выбирает одно из двух аудируемых действий:

- `ReconcilePublicationFound(message_id)` создаёт reconcile-attempt и делает idempotent edit каноничным render по известному channel/message. Известный success или классифицированный `message is not modified` доказывает контроль. Если автор активен и collaboration всё ещё `publication_failed`, transaction известного результата attach-ит `message_id` и ставит `published` при `now <= response_deadline_at` либо сразу `expired` при `now > response_deadline_at`. При concurrent block/cancel она только сохраняет ID и создаёт delete intent, не воскрешая карточку;
- `ConfirmOrphanRemovedAndRetry` закрывает ambiguous attempt с admin ID/reason и создаёт новую attempt generation только при `occurredAt <= response_deadline_at`. После deadline карточка становится `expired` без новой отправки.

Каждое reconciliation action атомарно пишет `operator_actions` с actor, reason и safe before/after state. Incident notification создаётся durable для каждого configured admin, а `ListAdminIncidents` по ledger/audit остаётся источником истины при недоставленной DM.

Найденный пост не привязывается просто по введённому ID: проверка Telegram-редактированием обязательна.

### 11.3. Published edit

Изменение до первого application является staged revision:

1. transaction проверяет `first_application_at IS NULL`, валидирует полный snapshot и сохраняет его в `pending_revision_json` с `pending_revision_version = version + 1`;
2. active columns/topics/version не меняются; collaboration показывается по старой active version, но submit и другие mutations временно блокируются;
3. runner редактирует известный message ID;
4. success в одной transaction заменяет active fields/topics, переводит `version` в pending version, increment-ит `projection_revision`, фиксирует rendered hash и очищает pending-поля;
5. permanent known failure очищает pending-поля и оставляет старую active version; retryable-known failure повторяется bounded, а после исчерпания также отбрасывает proposed snapshot, поскольку Telegram явно не применил edit;
6. timeout/connection loss для edit по известному message ID безопасно retryable: delivery повторяет тот же canonical proposed render до пяти раз, а `message is not modified` считается known success;
7. после исчерпания retries publication становится `sync_ambiguous`, сохраняет pending snapshot/action lock и требует `ReconcilePublishedEdit`.

Это исключает ситуацию, когда пользователь откликнулся на одну версию, а channel и bot показывают разные активные условия.

`ReconcilePublishedEdit` доступен только allowlisted admin и принимает mode `apply` или `rollback` вместе с обязательной внутренней причиной 1–500. `apply` повторяет proposed render и после known success активирует pending snapshot. `rollback` редактирует пост обратно в active render и только после known success очищает pending snapshot. Оба пути повторно проверяют current `published`, active author, `first_application_at IS NULL`, pending version и known message ID; transaction результата атомарно пишет соответствующий `operator_actions` с safe before/after и command ID. При concurrent hide/block/cancel outcome помечается superseded и business state не воскрешается.

### 11.4. Slot and terminal sync

Принятие и terminal transition не откатываются из-за showcase.

Каждое изменение остатка мест, статуса или текста increment-ит `projection_revision` и создаёт edit intent с semantic idempotency key:

`channel:<collaboration_id>:projection:<projection_revision>`.

Edit по известному message ID повторяем и coalesced: перед claim runner в одной transaction помечает более старые unclaimed edits `superseded` и отправляет только последний актуальный render. После ответа он повторно сравнивает claimed revision с current; если current выше, новейший intent остаётся due. Пока sync pending, bot card показывает источник истины из DB.

`sync_ambiguous` блокирует новые отклики, accept/reject/manual close и дальнейшее редактирование до admin reconciliation. Исключения: authoritative `CancelCollaboration`, admin hide/block и автоматический deadline всегда доступны; read-only views тоже работают. Такой terminal/moderation transition сохраняется в DB и обновляет current projection revision, но не делает blind Telegram call; reconciliation позже рендерит текущий authoritative state.

### 11.5. Hide and restore

- Hide очищает pending terms revision, создаёт delete intent по известному old `message_id` и оставляет collaboration `hidden` независимо от delivery outcome.
- Timeout/connection loss delete по known target безопасно повторяется до пяти раз; известный success и `message to delete not found` переводят publication в `deleted`.
- После исчерпания retries publication становится `delete_unconfirmed`, а admin incident предлагает `ReconcileHiddenDeletion`, который ещё раз делает idempotent delete и закрывается только known success/not-found.
- Restore запрещён, пока publication не `deleted`; после этого он никогда не переиспользует старый message ID: создаётся новая restore attempt, а collaboration остаётся `hidden` до send success.
- Restore send outcome перед сменой business status повторно require current restore attempt, `hidden`, active author и ожидаемый `hidden_from_status`. Поздний success после block/новой moderation сохраняет returned message ID, помечает attempt superseded и создаёт delete intent, но не снимает `hidden`.

## 12. Direct notifications

### 12.1. Source of truth

Notification — производная от бизнес-состояния. `Мои коллаборации` и `Мои отклики` остаются источником истины.

### 12.2. Delivery policy

- `prepared` delivery claim атомарно становится `dispatching`.
- Telegram `429` планирует retry не раньше `retry_after`.
- Определённый pre-send network отказ и явно retryable transport error повторяются с bounded exponential backoff.
- `403 bot blocked` и invalid chat являются `permanent_failed`.
- Timeout/connection loss после возможной отправки `sendMessage` является `ambiguous` и не повторяется автоматически.
- Edit/delete с известным message ID можно повторять.
- Максимум 5 определённых попыток; затем `permanent_failed` и admin incident для обязательных уведомлений.

### 12.3. Duplicate tolerance

Telegram Bot API не предоставляет application idempotency key для `sendMessage`. Система предотвращает собственные повторные intents, но признаёт остаточный риск дублирующего сообщения при внешней неоднозначности. Политика MVP выбирает пропуск повторной отправки вместо вероятного дубля; это соответствует [grammY — reliability](https://grammy.dev/advanced/reliability#duplicate-messages).

## 13. Background runners

### 13.1. Delivery runner

- запускается после recovery;
- concurrency = 1 для SQLite/минимальной нагрузки;
- выбирает due work keyset-пагинацией;
- claim и network call разделены; claim атомарно пишет случайный `claim_token`, `dispatch_started_at` и `request_deadline_at`;
- каждый Bot API call имеет 15-секундный AbortSignal deadline; timeout для send считается `ambiguous`, для edit/delete по known target — retryable;
- повторный process не захватывает terminal delivery;
- recovery считает `dispatching` stale через 60 секунд после `dispatch_started_at`; такая delivery классифицируется как `ambiguous` для send и retryable для known-target edit/delete;
- provider outcome применяется только при совпавшем `claim_token`; поздний ответ старого claim не перезаписывает recovery result.

### 13.2. Later: deadline runner

- проход при startup;
- затем не реже одного раза в минуту;
- fake clock в tests;
- одна collaboration на transaction;
- catch-up после сна Mac;
- next pass idempotent.

### 13.3. Later: completion reminder

При `completed` создаётся первый prompt всем сторонам. `Ответить позже` одной transaction завершает command receipt и создаёт ровно один scheduled outbox intent не ранее чем через 72 часа с key `completion-reminder:<application_id>:<reporter_profile_id>`. Повтор callback возвращает receipt result, а UNIQUE semantic key запрещает второй reminder. Если сторона сохраняет итоговый report до claim, ещё не отправленный reminder становится `superseded`; после первой reminder delivery новая не создаётся. Внешний cron не нужен.

### 13.4. Basic shutdown и Later hardening

Для первого запуска достаточно один раз обработать SIGINT/SIGTERM: прекратить polling, не брать новую работу и закрыть SQLite после уже выполняющейся операции. Persisted heartbeat, in-flight registry, 20-секундный watchdog и доказательство всех repeated-signal races относятся к Later.

Возможный Later hardening flow:

SIGINT/SIGTERM однократно переводит runtime в `draining`:

1. новые callbacks/commands не допускаются;
2. `bot.stop()` прекращает long polling, runners не берут новые claims;
3. все active provider calls получают abort signal;
4. application in-flight tracker ждётся до 20 секунд;
5. при успешном drain пишется runtime health, SQLite закрывается и process выходит с code 0;
6. при timeout пишется fatal safe event и process выходит с non-zero code без новых DB-операций; durable receipts/deliveries определяют recovery на следующем startup.

Повторный signal не запускает второй shutdown flow. Single-instance socket и LaunchAgent ThrottleInterval не дают новому process открыть DB до выхода старого.

### 13.5. Later: cleanup runner

Не чаще раза в сутки:

- expired telegram sessions;
- expired callback actions;
- processed updates и связанные completed command receipts по retention;
- terminal delivery payloads старше 90 дней после сохранения безопасной диагностики.

Business entities, operator audit и product events автоматически не удаляются.

## 14. Failure model

| Failure | Классификация | Поведение |
|---|---|---|
| Невалидный ввод | expected | показать правило, оставить шаг |
| Stale callback | expected | не менять state, отрендерить актуальное |
| Duplicate update | expected | вернуть/показать сохранённый result |
| Telegram 429 | retryable-known | retry after указанного времени |
| Telegram 403 blocked | permanent | terminal delivery, без падения process |
| Known 4xx | permanent/bug | не retry; безопасная диагностика |
| Network failure до send | retryable-known | bounded retry |
| Send outcome unknown | ambiguous | no blind retry; reconciliation |
| Edit/delete transient | retryable | bounded retry |
| Showcase rights lost | degraded dependency | запрет новых publish; старые данные доступны |
| SQLite busy | transient local | busy timeout, bounded retry runner |
| SQLite constraint | invariant/expected race | rollback и актуальный result |
| Migration failure | startup fatal | polling не стартует |
| Wrong bot identity | startup fatal | никакие Bot API mutations |
| Invalid production env file mode/content | startup fatal | никакие Bot API mutations |

Необработанная ошибка handler логируется с error kind и correlation IDs без user content. Process продолжает работу, если invariant/DB integrity не поставлены под сомнение; при подозрении на corruption выполняется controlled shutdown.

## 15. Security and privacy

### 15.1. Identity

- Telegram `from.id` — runtime identity.
- Username не является ключом и может измениться.
- Group/channel senders не могут выполнять user commands.
- Admin определяется только numeric IDs из env.
- Callback и wizard повторно проверяют actor.

### 15.2. Secrets

- `BOT_TOKEN` хранится только во внешнем env mode 0600.
- Token не попадает в plist, SQLite, logs, test fixtures или Git.
- Пара `EXPECTED_BOT_ID` + `EXPECTED_BOT_USERNAME` предотвращает запуск production process с чужим или giveaway token.
- Callback raw tokens не хранятся; public collaboration token не даёт mutation authority.

### 15.3. User data

- Profile не собирает и не хранит phone/email/alternate contact. Telegram identity живёт в `telegram_users` и используется для direct action только после accepted authorization.
- Приоритет action: текущий `username` → `https://t.me/<username>`; fallback — `tg://user?id=<telegram_user_id>` с явным сообщением о приватности и возможной недоступности.
- Если direct identity отсутствует или повреждена, S3 fail closed без частичного раскрытия; request-contact handshake, relay, chat history и moderation не реализуются.
- Phone `request_contact` не вызывается автоматически; alternate contacts стороны обменивают самостоятельно в Telegram.
- Logs/events не содержат raw profile description, offer, expectation, application message, phone, email или identity action payload.

Шифрование field-level отложено: на одном Mac ключ рядом с приложением не даёт достаточного выигрыша относительно сложности. При переносе на shared host решение пересматривается.

### 15.4. Content safety boundary

По решению PRD нет premode, report и product rate limits. Технические ограничения Telegram payload/concurrency и input lengths сохраняются, но не используются как продуктовый антиспам.

Admin hide является единственным enforcement первого запуска. Block/unblock относится к Later.

## 16. Configuration

### 16.1. Required production variables

S0 реализует pure parser, который принимает явный key/value input и проверяется только синтетическими fixtures: он не читает файл, не требует реальных credentials и не вызывает Telegram. Проверка exact env-file path, current-user ownership, mode 0600, production content и `getMe` identity добавляется в S1 runtime; showcase channel capabilities добавляются вместе с publication flow в S2. Отдельный `APP_ENV` не вводится.

```ini
BOT_TOKEN=<secret>
EXPECTED_BOT_ID=<numeric Telegram bot ID>
EXPECTED_BOT_USERNAME=<without @>
ADMIN_TELEGRAM_IDS=<comma-separated numeric IDs>
SHOWCASE_CHANNEL_ID=<numeric Telegram channel ID>
SHOWCASE_CHANNEL_USERNAME=<without @>
DATABASE_PATH=/Users/denischernykh/Library/Application Support/CollaborationBot/data/collaboration-bot.sqlite
LOG_LEVEL=info
TIME_ZONE=Asia/Yekaterinburg
HELP_CONTACT=<public support contact>
```

Pure parser validation в S0:

- unknown keys may warn but do not change semantics;
- all required values must exist;
- IDs parse as decimal strings without conversion to number;
- `TIME_ZONE` must equal `Asia/Yekaterinburg` in MVP;
- bot/channel usernames normalized without `@`;
- admin list non-empty and unique;
- `DATABASE_PATH` является absolute non-root path.

S1 external preflight до polling и любых Bot API mutations отдельно проверяет exact env-file path, regular-file/no-symlink, current-user ownership и mode 0600; фактический database parent не совпадает с repository root и доступен на запись. Затем `getMe.id`/normalized username сверяются с expected pair. Начиная с S2 отдельно проверяются configured channel ID и права post/edit/delete для exact showcase topology.

### 16.2. Environment boundaries

- Local development запускает Node с явным `--env-file=.env`; `.env` и `.data/` игнорируются Git.
- Production LaunchAgent передаёт absolute `--env-file=<production.env>` до compiled entrypoint; используется нативный [Node.js `--env-file`](https://nodejs.org/docs/latest-v24.x/api/cli.html#--env-fileconfig), а не `dotenv` dependency.
- Plist содержит путь к env, но не secret values.
- Приложение читает только allowlisted keys из `process.env`, затем выполняет схемную validation; implicit env-file discovery нет.

## 17. Later: macOS LaunchAgent

### 17.1. Identity and paths

| Назначение | Путь |
|---|---|
| Label | `ru.denischernykh.collaboration-bot` |
| Plist | `/Users/denischernykh/Library/LaunchAgents/ru.denischernykh.collaboration-bot.plist` |
| Backup Label | `ru.denischernykh.collaboration-bot.backup` |
| Backup Plist | `/Users/denischernykh/Library/LaunchAgents/ru.denischernykh.collaboration-bot.backup.plist` |
| App data | `/Users/denischernykh/Library/Application Support/CollaborationBot/` |
| Production env | `.../CollaborationBot/production.env` |
| SQLite | `.../CollaborationBot/data/collaboration-bot.sqlite` |
| Backups | `.../CollaborationBot/backups/` |
| Logs | `/Users/denischernykh/Library/Logs/CollaborationBot/` |
| Instance socket | `.../CollaborationBot/run/collaboration-bot.sock` |
| Backup operation socket | `.../CollaborationBot/run/backup-operations.sock` |

Ни один путь или label не совпадает с Giveaway Bot.

### 17.2. Plist contract

Bot job запускает без shell и `pnpm`:

- `ProgramArguments`: absolute Node binary, `--env-file=<absolute production.env>`, absolute compiled `dist/main.js`;
- `WorkingDirectory`: absolute Collaboration Bot checkout/release directory;
- `StandardOutPath`: `/Users/denischernykh/Library/Logs/CollaborationBot/stdout.log`;
- `StandardErrorPath`: `/Users/denischernykh/Library/Logs/CollaborationBot/stderr.log`;
- `RunAtLoad=true`;
- `KeepAlive = { SuccessfulExit = false; }`;
- `ProcessType=Background`;
- `ThrottleInterval=60`.

Backup job также не использует shell/`pnpm`: `ProgramArguments` состоят из того же absolute Node, того же `--env-file`, absolute compiled `dist/ops/backup.js` и `create-if-due`; `RunAtLoad=true`, `StartInterval=3600`, `KeepAlive=false`, stdout/stderr уходят в `backup.stdout.log`/`backup.stderr.log` того же logs directory.

`install` сначала разрешает absolute Node из текущего окружения, проверяет его версию, compiled entrypoints, directories/permissions и затем пишет эти exact значения в plist. Runtime не зависит от interactive shell, nvm или launchd `PATH` и не запускает package-manager/git commands.

### 17.3. Operations interface

Планируемые команды:

```sh
pnpm ops:launch-agent -- install
pnpm ops:launch-agent -- start
pnpm ops:launch-agent -- stop
pnpm ops:launch-agent -- restart
pnpm ops:launch-agent -- status
pnpm ops:launch-agent -- logs
pnpm ops:launch-agent -- rotate-logs
pnpm ops:launch-agent -- uninstall

pnpm ops:backup -- create
pnpm ops:backup -- create-if-due
pnpm ops:backup -- list
pnpm ops:backup -- verify <backup-file>
pnpm ops:backup -- prune
```

`install` выполняет полный preflight до записи plist/bootstrap и регистрирует два отдельных job: bot и backup. Backup job имеет `RunAtLoad=true`, `StartInterval=3600` и запускает только `create-if-due`; все backup create/verify/prune commands взаимно исключаются через `backup-operations.sock` по тому же owner/stale-socket алгоритму, что и runtime socket. `create-if-due` делает no-op, если возраст последнего проверенного snapshot меньше 23 часов. Это даёт catch-up после GUI login/сна без создания часовых копий. `status` проверяет оба label и возраст backup; `uninstall` выгружает оба job и удаляет только их plist, сохраняя env, database, backups и logs. Purge-команды нет.

### 17.4. Manual update flow

1. `status` и проверка текущих bot ID/username.
2. `stop` и подтверждение controlled shutdown.
3. `ops:backup -- create` и `verify`.
4. Если `status` показал log больше 10 MiB, выполнить `rotate-logs`.
5. Обновление checkout выполняет владелец отдельно.
6. `pnpm install` только если изменился lockfile.
7. `pnpm check`.
8. `pnpm db:migrate`.
9. `start`.
10. `status`, последние logs и Telegram smoke.

Нет автоматического `git pull`, самообновления и destructive rollback. При migration failure service остаётся stopped; restore выполняется только по явной runbook-процедуре.

### 17.5. Status and logs

`status` показывает:

- loaded/running PID;
- verified bot ID/username;
- DB path/schema version;
- showcase capability;
- last successful poll;
- pending/retryable/ambiguous/permanent delivery counts;
- last deadline pass;
- last backup and age.

PID/loaded-state читаются из launchd, counts — read-only query из SQLite, а poll/deadline/capability — из `runtime_health` вместе с возрастом. Если PID нет или heartbeat старше двух минут, status показывает `stale/stopped`, а не healthy.

`logs` читает ограниченный хвост stdout/stderr и не загружает файл целиком. Автоматической ротации в MVP нет: `status` предупреждает при stdout/stderr больше 10 MiB. `rotate-logs` fail closed, если bot запущен, и после stop переименовывает только два точных configured log files в generations `.1`–`.5` с mode 0600. Это осознанная manual-operations граница дешёвого MVP.

## 18. Later: automated backup and restore

### 18.1. Objectives

- RPO: не более 24 часов при успешном ежедневном backup.
- RTO target: 2 часа для ручного восстановления на том же Mac.
- Local backup не защищает от потери диска; Time Machine или другой off-device copy остаётся внешней операционной обязанностью.

### 18.2. Backup

`ops:backup -- create`:

1. валидирует source/target и permissions;
2. создаёт в том же backup directory уникальный несуществующий файл `.partial-<uuid>` и направляет в него согласованный SQLite snapshot через `VACUUM INTO`; команда даёт согласованный snapshot: [SQLite — VACUUM INTO](https://sqlite.org/lang_vacuum.html);
3. не копирует только main database при активном WAL;
4. выполняет `PRAGMA integrity_check` на partial snapshot, вычисляет checksum и синхронизирует файл на диск;
5. атомарно переименовывает partial snapshot в окончательное timestamped имя на том же filesystem, синхронизирует directory entry и атомарно публикует manifest со schema version, size, checksum и timestamp;
6. `list`, `verify` и retention игнорируют `.partial-*`; interrupted partial считается мусором для отдельной безопасной cleanup-операции, а не backup;
7. публикует только безопасный summary.

Режим `create-if-due` описан в контракте backup LaunchAgent выше. Retention: 14 daily snapshots. `prune` под backup-operation mutex удаляет только backup files, прошедшие строгую проверку имени/каталога. Отдельная фаза partial cleanup может удалить `.partial-<uuid>` только в exact backup directory, если entry является regular file текущего owner, не symlink и старше 24 часов; она никогда не принимает произвольный path. Production DB не является допустимой целью. Если Mac выключен или пользователь не вошёл в GUI дольше 24 часов, RPO 24 часа не гарантируется до catch-up.

### 18.3. Restore

1. остановить bot и backup job, подтвердить controlled shutdown/PID absence;
2. проверить, что production DB, `-wal` и `-shm` не имеют открытых file descriptors;
3. переместить current main DB и существующие sidecars `-wal`/`-shm` как один recoverable set в новый timestamped quarantine directory на том же filesystem;
4. проверить checksum, manifest и `integrity_check` backup;
5. установить snapshot в новый temporary data path без sidecars, открыть новой версией приложения и применить только forward migrations;
6. на открытом temporary DB выполнить `integrity_check`, read-only smoke queries и `PRAGMA wal_checkpoint(TRUNCATE)`, переключить temporary DB в `journal_mode=DELETE`, закрыть все соединения и подтвердить отсутствие/нулевой размер temporary `-wal` и отсутствие `-shm`; при неуспехе restore останавливается;
7. ещё раз require, что configured production DB path и оба sidecar path отсутствуют, затем атомарным rename на том же filesystem установить только restored main DB;
8. запустить bot и backup job, проверить status/Telegram;
9. не удалять quarantine set до отдельного подтверждения.

Restore rehearsal выполняется до публичного пилота на копии, а не на production DB.

## 19. Observability

### 19.1. Logs

JSON event содержит:

- timestamp;
- level;
- event name;
- module;
- correlation/command/update ID;
- safe entity IDs;
- outcome/error kind;
- duration.

Запрещены secrets, public/callback tokens, contact и raw user text; incident/log payload использует только внутренние UUID и safe enum/error attributes.

### 19.2. Runtime signals

Первый запуск обязан логировать `runtime_ready`, `poll_started`, `poll_failed`, delivery errors и shutdown. Остальные persisted status/heartbeat signals относятся к Later. Возможный расширенный набор:

- `runtime_ready` / `runtime_degraded`;
- `poll_started` / `poll_failed`;
- `delivery_sent` / `delivery_ambiguous` / `delivery_failed`;
- `showcase_capability_lost/restored`;
- `deadline_pass_completed`;
- `backup_created/failed`;
- `shutdown_started/completed`.

### 19.3. Later: product analytics

`CalculatePilotFunnel` является read-only query/CLI и агрегирует `product_events` и authoritative entities. Внешний analytics SDK не добавляется.

## 20. Testing strategy

### 20.1. Unit

- validators и canonical enums;
- collaboration/application transitions;
- slot policy;
- deadline policy;
- contact visibility;
- render length/escaping;
- error classification;
- delivery retry policy;
- completion bilateral confirmation.

### 20.2. SQLite integration

Каждый test использует новую temporary database и реальные migrations:

- fresh bootstrap и upgrade fixture;
- FK/CHECK/UNIQUE;
- transaction rollback;
- concurrent creation of the second active profile;
- draft cancel deletes entity/topics/session and replay is safe;
- two concurrent accepts for last slot;
- block/accept race проверяет оба serialized order: block-first закрывает без контакта, accept-first сохраняет accepted;
- duplicate update/command;
- staged edit success/failure/crash и first application freeze;
- projection revision updates every intermediate slot count;
- deadline with/without accepted;
- deadline during initial publication/reconciliation;
- cancel collaboration cascade;
- hide/restore active and terminal business states;
- block cascade;
- product event/outbox atomicity;
- session restart;
- cleanup retention;
- command receipt result replay/input-hash conflict;
- backup integrity and restore without stale WAL/SHM.

### 20.3. Telegram adapter

Fake Bot API проверяет:

- deferred profile flow;
- `request_chat` и manual fallback;
- Back/Cancel/resume;
- actor-bound and stale callbacks;
- deep link lookup;
- preview/final render parity;
- known error, 429, blocked user и ambiguous timeout;
- showcase create/edit/delete;
- ambiguous initial-send reconciliation by known message ID;
- no auto-retry ambiguous send.

### 20.4. Runtime

First-launch/runtime foundation checks:

- startup order;
- wrong bot ID/username fail closed;
- showcase degraded mode;
- recovery of prepared/retryable/dispatching work;
- provider-call timeout, stale claim fencing и superseded projection edits;

Later runtime checks:

- catch-up deadlines;
- graceful shutdown with in-flight update and delivery;
- repeated SIGTERM;
- no second polling instance in operations preflight.

### 20.5. End-to-end fake journey

Обязательный first-launch journey: `author profile → publish → applicant deep link → quick profile → apply → accept/reject → Telegram contact action → own lists → admin hide → restart`. Completion, block/unblock и analytics не входят в этот gate.

Расширенный Later journey (не является first-launch gate):

Actors:

- author;
- two candidates;
- administrator;
- fake showcase channel.

Journey:

1. author creates profile and 2-slot card;
2. publication creates one channel post;
3. both candidates enter by feed/deep link and apply;
4. author accepts both; last slot closes recruitment;
5. accepted pair получает вычисляемое Telegram contact action;
6. post changes to matched;
7. author completes; pair reports are recorded;
8. admin hides another card and blocks its author;
9. restart preserves all state and produces no duplicate effects.

S3 checkpoint выполняет steps 1–6 и restart-проверку: это core marketplace до `matched`, pairwise contact и restart. S4 выполняет обязательный first-launch journey выше, включая admin hide. Completion, block/unblock и прочие steps расширенного journey остаются Later и не требуются для локального launch candidate.

### 20.6. Real Telegram smoke

Первый запуск проверяет exact bot/channel identity и основной journey из §20.5 при ручном старте. LaunchAgent restart, backup/restore и log-rotation checks из расширенного списка ниже относятся к Later.

Перед публичным запуском на отдельном test bot/channel:

- `getMe` identity;
- channel post/edit/delete rights;
- native channel chooser on supported client и manual fallback;
- publish/deep link/apply/accept/contact;
- multi-slot;
- own lists, admin hide и restart persistence;
- подтверждение, что Giveaway Bot token/process/database/posts не затронуты.

Отдельный Later smoke, только после явного возврата capability:

- deadline catch-up after restart;
- restore/block и ambiguous failure simulation where feasible;
- LaunchAgent restart;
- backup/restore rehearsal;
- оба LaunchAgent label, backup catch-up и log-size warning/rotation.

Для Later smoke используются канонические Collaboration Bot LaunchAgent labels и paths с отдельным test bot/channel в exact external env file. Readiness evidence привязано к exact `getMe.id`, нормализованному `getMe.username`, `SHOWCASE_CHANNEL_ID` и checksum проверенного env-файла; значения сверяются с `EXPECTED_BOT_ID`/`EXPECTED_BOT_USERNAME`. Любая смена identity, channel или env checksum инвалидирует evidence и требует повторить identity/channel preflight, functional smoke и применимые Later checks. Второй постоянный test topology не создаётся.

## 21. Traceability

Для первого запуска authoritative traceability задают PRD `LFR-*`/`LAC-*` и §22 этого документа. Следующие таблицы сохраняют расширенный backlog и не добавляют launch requirements.

| PRD | Use case / owner | Data and invariant | Telegram entrypoint | Failure policy | Tests | Slice |
|---|---|---|---|---|---|---|
| FR-P01 | Create/UpdateProfile | `profiles`; partial UNIQUE active/user; nullable enrichment | `Мой профиль`, deferred create, quick application profile | duplicate/race returns current profile | unit, SQLite, adapter, E2E | S1/S3 |
| FR-P02 | profile visibility query | `profile_platforms`; Telegram identity remains in `telegram_users` | profile card, accepted result | redact identity by default; unauthorized is neutral | unit, SQLite, E2E | S1 |
| FR-P03 | channel selection adapter | platform chat ID/URL; request ID bound to session | profile wizard `request_chat` | inaccessible/missing username uses manual URL | adapter, real smoke | S1 |
| FR-C01 | draft commands | nullable `collaborations`, topics, session; cancel cascade | `/new`, Back, `/cancel`, resume | invalid input preserves step; restart resumes | SQLite, adapter, restart | S2 |
| FR-C02 | Publish/ReconcilePublication | publication/attempt/outbox ledger; known message before public | preview Publish, admin incident | known fail safe retry; ambiguous requires reconciliation | SQLite, adapter, runtime, smoke | S2 |
| FR-C03 | EditPublishedCollaboration | first_application freeze; durable pending snapshot | `Мои коллаборации` → edit | known fail keeps active; ambiguous locks | unit, SQLite, adapter | S2/S3 |
| FR-C04 | close/cancel/expire use cases | statuses, slot count query, projection revision | author actions; deadline runner | business commit survives DM/showcase failure | unit, SQLite, runtime | S3 |
| FR-S01 | BrowseCollaborations | statuses/topics + persisted browse session/keyset | `/feed`, filters, next/reset | stale item rechecked and skipped | unit, SQLite, E2E | S3 |
| FR-S02 | public-token query | UNIQUE opaque token, no mutation authority | `/start c_<token>` | unknown/hidden gives neutral unavailable | adapter, E2E, smoke | S2/S3 |
| FR-A01 | Submit/WithdrawApplication | UNIQUE card/profile; receipt; terms version | apply/withdraw callbacks | duplicate replay; closed/deadline rejected | unit, SQLite, E2E | S3 |
| FR-A02 | DecideApplication | serialized transaction, application status, slots | actor/version-bound decision callback | race returns current; blocked applicant closes | concurrency integration, E2E | S3 |
| FR-A03 | pairwise Telegram action query | accepted authorization over current `telegram_users` identity | decision result, `Мои...` | missing/corrupt identity fails closed; no relay | unit, SQLite, E2E | S3 |
| FR-O01 | Complete/ReportCompletion | UNIQUE report/application/reporter | completion callbacks/reminder | negative/mismatch saved, no confirmed event | unit, SQLite, E2E | S4 |
| FR-V01 | publication projection runner | message ID, attempts, projection revision/hash | automatic post and admin reconcile | send ambiguity no retry; edit/delete bounded | adapter, runtime, smoke | S2–S4 |
| FR-M01 | Hide/Restore | hidden overlay, operator audit, delete/restore attempt | `/admin` hide/restore | delete ambiguity stays hidden; restore waits success | SQLite, E2E, smoke | S4 |
| FR-M02 | Block/Unblock | user status, card/application cascades, audit | `/admin` block/unblock | atomic cascade; unblock revives nothing | SQLite, race E2E | S4 |
| FR-N01 | delivery runner | outbox UNIQUE key, claim token/deadline/status | automatic DMs/status views | retry known; send ambiguity terminal incident | SQLite, adapter, runtime | S0/S4 |
| FR-E01 | product-event store / analytics/funnel query | append-only product events UNIQUE key | owning flows и operator read-only command | event atomic with effect; raw content forbidden | SQLite, adapter, query snapshot | S0–S4 |
| FR-R01 | receipts/runtime/session recovery | receipts, updates, actions, sessions, runtime health | all ingress and ops status | replay exact result; bounded drain/recovery | SQLite, runtime, smoke | S0–S4 |

### 21.1. Acceptance execution map

| AC | Основное доказательство | Gate | Slice |
|---|---|---|---|
| AC-001 | no-profile deep link → quick profile → resumed application journey | fake Telegram + SQLite | S1/S3 |
| AC-002 | minimal-profile enrichment and public/private projection authorization | unit + SQLite + E2E | S1/S3 |
| AC-003 | `ChatShared` actor/request binding and URL fallback | adapter + real smoke | S1 |
| AC-004 | persisted Back/Cancel/resume preview | restart adapter test | S2 |
| AC-005 | known send stores one message before `published` | fake Bot API + SQLite | S2 |
| AC-006 | ambiguous send produces one incident and no retry | adapter + recovery runtime | S2 |
| AC-007 | staged edit success/failure plus first-application freeze | SQLite + fake Bot API | S2/S3 |
| AC-008 | filter/exclusion/keyset/session reset fixture | SQLite query snapshot | S3 |
| AC-009 | token/deep-link public-state matrix, включая hidden | adapter + E2E | S2/S4 |
| AC-010 | application guards and duplicate receipt replay | unit + SQLite | S3 |
| AC-011 | two concurrent accepts for last slot | adversarial SQLite integration | S3 |
| AC-012 | last-slot and manual-close cascades | SQLite + E2E | S3 |
| AC-013 | pairwise contact visibility matrix | unit + E2E | S3 |
| AC-014 | fake-clock deadline with/without accepted | SQLite + runtime | S3 |
| AC-015 | bilateral unique-event fixture | SQLite + E2E | S4 |
| AC-016 | active/terminal hide and success-gated restore | SQLite + fake API + smoke | S4 |
| AC-017 | block cascade with preserved accepted contact | SQLite + E2E | S4 |
| AC-018 | DM failure after committed decision | fake API + SQLite | S4 |
| AC-019 | duplicate update/callback effect counts | runtime + SQLite | S0–S4 |
| AC-020 | separate bot/channel full journey and Giveaway Bot isolation | real smoke report | S4 |
| AC-021 | draft/topics/session deletion and replay | SQLite + adapter | S2 |
| AC-022 | concurrent active-profile partial UNIQUE | adversarial SQLite integration | S1 |
| AC-023 | negative/mismatched outcome matrix | unit + SQLite | S4 |
| AC-024 | attach-or-retry reconciliation and deadline race | fake API + runtime + smoke | S2 |
| AC-025 | cancellation cascade with failed outbound | SQLite + fake API | S3 |
| AC-026 | concurrent block/accept serialization-winner policy | adversarial SQLite E2E | S4 |

Для первого запуска acceptance report использует только `LAC-01`–`LAC-12` из PRD. `AC-001`–`AC-026` выше остаются расширенным backlog; они не блокируют первый запуск, если не представлены в `LAC-*`.

## 22. Implementation slices for an AI agent

### S0. Foundation

Сохранить уже реализованный компактный foundation:

- package/toolchain contracts;
- pure config parser/validation без filesystem, credentials и Telegram;
- redacting logger;
- SQLite boundary и migration harness;
- schema-only `telegram_users` как FK foundation;
- command receipts/processed updates;
- существующий outbox/delivery ledger с claim fencing/provider deadline;
- принятый в `S0-05` schema-only `product_events` primitive без обязательной записи событий или funnel query;
- fake clock/token generator;
- базовые architecture tests.

Не добавлять в S0 новую product-event policy/emission, runtime health singleton/heartbeat, cleanup scheduler, Unix socket, LaunchAgent или backup tooling. Уже принятый `product_events` schema primitive не делает product analytics обязательной. Базовый shutdown создаётся только вместе с первым реальным bot runtime, когда у него появляется текущий consumer.

Exit: fresh DB bootstrap, lint/test/build, duplicate command test и aggregate gate без product modules.

### S1. Profile vertical

Добавить один пользовательский vertical slice:

- `/start` и главное меню;
- telegram-user snapshot;
- один profile и public platform; Telegram identity отдельно в `telegram_users`;
- create/edit/view wizard;
- минимальный grammY long-polling entrypoint, config/migration wiring, `getMe` identity check и basic signal shutdown;
- restart и duplicate-update tests на fake Telegram adapter;
- после отдельной credentials/network авторизации — ранний real Telegram profile smoke.

Не добавлять generic form/runtime framework, showcase capability, heartbeat/status storage, Unix socket, cleanup scheduler, LaunchAgent или backup automation.

Exit: `LAC-01`, профиль виден пользователю, wizard не собирает alternate contact, compiled bot можно вручную запустить и сразу потрогать в Telegram после отдельной авторизации.

### S2. Card and publication vertical

Добавить:

- draft wizard, resume/cancel и preview;
- collaboration fields и opaque deep-link token;
- публикацию в одном showcase-канале через существующий delivery ledger;
- `Мои карточки`;
- только известный `message_id` делает карточку доступной.

Не добавлять automated reconciliation UI, staged edit, deadline runner или product events.

Exit: `LAC-02`, restart draft test и safe known-failure behavior на fake Telegram API; после отдельной авторизации тот же runnable bot проходит real checkpoint публикации в showcase.

### S3. Marketplace vertical

Добавить:

- простую ленту и deep link;
- submit application, включая durable quick profile `type → display name → platform` и возврат к исходной карточке для пользователя без профиля;
- accept/reject и закрытие набора при заполнении мест или вручную;
- pairwise contact query/notification;
- `Мои отклики` и authoritative statuses.

Не добавлять completion, reminders, automatic deadline processing или analytics.

Exit: `LAC-03`–`LAC-06`, `LAC-08`–`LAC-09` и core fake journey от deep link через quick profile до контакта; после отдельной авторизации тот же flow проверяется двумя real Telegram accounts.

### S4. Minimal administration and shareable launch

Добавить allowlisted lookup/hide без restore/block/unblock и выполнить полный fake journey из `LAC-10`. Ошибка DM не откатывает принятое решение; hidden карточка исчезает из ленты и перестаёт принимать отклики. После отдельной credentials/Telegram авторизации выполнить exact bot/channel preflight, полный real journey, restart и выдать короткие manual start/stop/database-copy instructions.

Не добавлять daemon/supervisor, LaunchAgent, heartbeat/status DB, scheduled cleanup, automated backup/restore или SLA claims.

Exit: `LAC-07`, `LAC-10`, `LAC-11` на local/fake evidence и отдельно авторизованный `LAC-12` для exact bot/channel identity. После этого пользователь может вручную отправить ссылку другим людям; отдельного позднего runtime-composition stage нет.

### D1. Deferred platform capabilities

Неисполняемый backlog находится в [`DEFERRED_PLATFORM_CAPABILITIES.md`](./DEFERRED_PLATFORM_CAPABILITIES.md). Возврат к capability разрешён только по указанному там trigger или по отдельному решению автора проекта. Само наличие проектного описания не делает capability обязательной.

### 22.1. Delivery discipline

Пользователь авторизует один slice/stage за запуск. Внутри него ИИ-агент последовательно выполняет перечисленные в `IMPLEMENTATION_PLAN.md` work units: каждый unit имеет собственные focused tests, evidence и commit, но после успешного commit агент без дополнительного пользовательского запуска переходит к следующему unit того же stage. Одновременно `in_progress` могут быть только один stage и один unit; на stage gate, blocker или действии с отдельной авторизацией агент останавливается.

1. перечитывает PRD/Technical Design и выбирает IDs;
2. пишет failing focused tests;
3. реализует минимальный scope;
4. выполняет focused gates;
5. выполняет aggregate `pnpm check` перед завершением slice;
6. обновляет acceptance evidence;
7. не переносит Later/Out требования;
8. не меняет product policy молча;
9. не копирует другой repo целиком;
10. не публикует, не создаёт BotFather resources и не деплоит без отдельной авторизации.

## 23. Evolution

### 23.1. Mini App / web

Mini App добавляется как HTTP adapter к тем же application use cases. Telegram Mini App init data проверяется на adapter boundary и отображается в существующий Telegram user/profile.

Сам факт Mini App не требует немедленного PostgreSQL, если остаётся один process.

### 23.2. PostgreSQL migration triggers

Решение пересматривается, когда появляется хотя бы одно требование:

- несколько одновременно работающих application replicas;
- второй process должен независимо писать в БД;
- отдельный web/mobile backend с удалённой БД;
- high availability или online failover;
- нагрузка/latency измеримо упирается в serialized SQLite writes;
- managed backup/RPO невозможно обеспечить на Mac.

Миграция заменяет repository adapters; domain/application interfaces сохраняются. До доказанного trigger PostgreSQL не добавляется.

### 23.3. Giveaway integration

Будущая интеграция не использует shared DB:

1. Collaboration Bot создаёт одноразовый opaque handoff с expiry и actor binding.
2. Deep link открывает Giveaway Bot.
3. Giveaway Bot обменивает token через узкий authenticated API.
4. Prefill сохраняется как immutable source snapshot с `source_collaboration_id`.
5. Consume идемпотентен.

Эта схема является направлением Later, а не скрытым контрактом MVP.

### 23.4. Redis/worker

Redis, BullMQ и отдельный worker добавляются только при измеримом backlog, delayed/prioritized jobs либо необходимости process isolation. Они не требуются только потому, что существуют уведомления.

## 24. Self-review checklist

First-launch checklist:

- [ ] Пройден `LAC-10` на fake Telegram.
- [ ] Telegram direct action вычисляется только для принятой пары; до accepted identity не раскрывается.
- [ ] Duplicate update/callback не дублирует business state или delivery intent.
- [ ] Bot API не вызывается внутри SQLite transaction.
- [ ] Token, contact, raw input и opaque public/callback tokens отсутствуют в logs/fixtures/Git.
- [ ] Один process можно вручную запустить, остановить и перезапустить без потери сохранённых решений.
- [ ] Admin hide убирает карточку из authoritative feed.
- [ ] Deferred capabilities не реализованы без текущего consumer.

Расширенный Later checklist:

- [ ] Все enum совпадают с PRD.
- [ ] Все `FR-*` и `AC-*` имеют traceability.
- [ ] Ни один Telegram handler не содержит business policy.
- [ ] Application state/outbox/event пишутся атомарно.
- [ ] Draft cancellation не оставляет orphan entity/session.
- [ ] Staged edit хранит старую active и proposed version до Telegram outcome.
- [ ] Send outcome unknown никогда не blind-retry.
- [ ] Slots не могут переполниться при concurrency/replay.
- [ ] Каждое изменение slots/status имеет новую projection revision.
- [ ] Block/accept race следует serialization-winner policy: block-first закрывает без контакта, accept-first сохраняет `accepted` и возникшее право пары на контакт.
- [ ] Username/user-ID action недоступен до accepted pair.
- [ ] Showcase degradation не повреждает authoritative DB state.
- [ ] Block/hide не пытаются отозвать уже выданный Telegram action.
- [ ] Logs/events не содержат raw content, contacts или tokens.
- [ ] Production token защищён expected username preflight.
- [ ] LaunchAgent paths не пересекаются с Giveaway Bot.
- [ ] Backup учитывает WAL, а restore не оставляет старые WAL/SHM в production path.
- [ ] Mini App/PostgreSQL/Giveaway остаются Later.
- [ ] Документация не заявляет hosted, 24/7 или production evidence до реального smoke.
