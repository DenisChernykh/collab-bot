# Collaboration Bot — solo-launch implementation plan

- Статус документа: `Approved execution registry`
- Версия: `0.5`
- Дата: `2026-08-25`
- Цель: как можно быстрее получить работающий Telegram-цикл для ручного распространения
- Ограничение: один stage за пользовательскую авторизацию, один локальный commit на unit, без push/PR/deploy

## 1. Источники и граница

Порядок источников:

1. [`docs/PRD.md`](./docs/PRD.md) — `LFR-01`–`LFR-11`, `LAC-01`–`LAC-12` и продуктовая политика;
2. [`docs/TECHNICAL_DESIGN.md`](./docs/TECHNICAL_DESIGN.md) — минимальный технический контракт;
3. [`docs/DEFERRED_PLATFORM_CAPABILITIES.md`](./docs/DEFERRED_PLATFORM_CAPABILITIES.md) — неисполняемый backlog и triggers;
4. [`tz_telegram_collaboration_bot.md`](./tz_telegram_collaboration_bot.md) — discovery-контекст.

Первый запуск рассчитан на единицы или десятки пользователей, которых автор приглашает вручную. Технический user cap не вводится. Аналитика, formal pilot, SLA и подготовка к масштабированию не требуются.

## 2. Правила исполнения

- Работа идёт вертикально: каждый stage добавляет пользовательский сценарий, а не инфраструктуру без текущего consumer.
- До runtime-изменений пишется один или несколько focused tests, доказывающих текущий acceptance result.
- Target unit: не более 12 изменённых source/test files и не более примерно 90 минут реализации. Если граница явно превышается, unit останавливается и делится до продолжения.
- Используются уже реализованные SQLite, command receipt и delivery-ledger primitives. Они не усиливаются ради гипотетических scale/operations cases.
- S1–S4 добавляют только текущий пользовательский flow и минимальную runtime composition; heartbeat/status storage, cleanup scheduler, Unix socket, backup/LaunchAgent и прочая deferred platform infrastructure не создаются без отдельной авторизации.
- Один независимый review выполняется на финальном candidate каждого stage. Reviewer ищет только launch blockers: утечку credential/неавторизованное Telegram identity disclosure, повреждение authoritative data, повторный business effect/опасную повторную Telegram mutation, поломку core journey или невозможность запустить stage.
- Style, дополнительные абстракции, гипотетический scale, Later capabilities и редкие operational hardening cases не блокируют stage. Подтверждённый blocker получает одну consolidated fix wave и focused recheck; многоциклового deep review нет.
- Evidence различает local tests, fake Telegram и real Telegram. Local/fake PASS не заявляет реальный запуск.
- Каждый stage `S1`–`S3` заканчивается ранним hands-on checkpoint: код сначала проходит fake gates, затем после отдельной авторизации запускается тот же flow в real Telegram. Отсутствие credentials не расширяет implementation scope и не разрешает откладывать runtime composition до финала.
- Credentials, BotFather, real Telegram mutations, remote/push/PR/merge/deploy и любые production actions требуют отдельной авторизации.

## 3. Статусы

| Stage | Status | Units | Наблюдаемый результат |
|---|---|---:|---|
| P0 — Repository baseline | `completed` | 2 | Репозиторий и execution rules |
| S0 — Compact foundation | `completed` | 7 | Проверенный foundation без operational platform |
| S1 — Profile vertical | `in_progress` | 2 | Реальный бот открывается, пользователь создаёт и видит профиль |
| S2 — Card publication vertical | `pending` | 2 | Автор создаёт и публикует карточку в real showcase |
| S3 — Marketplace vertical | `pending` | 2 | Два пользователя проходят отклик, решение и получают Telegram action |
| S4 — Shareable launch | `pending` | 1 | Admin hide, полный real journey и готовая к распространению ссылка |

```text
P0-01 → P0-02
  → S0-01 → S0-02 → S0-03 → S0-04 → S0-05 → S0-06 → S0-07
  → S1-01 → S1-02
  → S2-01 → S2-02
  → S3-01 → S3-02
  → S4-01
```

## 4. Завершённый ledger

Подробное evidence предыдущей редакции остаётся доступно в соответствующих commits.

| Unit | Commit | Результат |
|---|---|---|
| P0-01 | `34c9ea22875041328fcc86f0681ab8d4189072b8` | safe repository baseline |
| P0-02 | `7d03b764d01088051ba667fab5b2dfd1d59c2b82` | README и agent protocol |
| S0-01 | `651c04f649472135dbd60a98d2d8bb1d30660f90` | strict toolchain и pure config |
| S0-02 | `1746c13bbbd938995afd79f8dbf0c640ed295f1d` | safe domain/runtime primitives |
| S0-03 | `add02a1f96f406e03a1f1f5c70114a67c969188e` | SQLite migration boundary |
| S0-04 | `cdbbcf0419bcafed8f0f9af71766bddb2fc9ad7d` | ingress idempotency |
| S0-05 | `c269771612978f9ba981f02238e9255793a30a2d` | atomic outbox и historical product-event store |
| S0-06 | `5c7c4c9223131ecd2c7a4a4b50e19f1ae7fbdcc3` | fenced delivery recovery |

`product_events` уже существует как foundation primitive из `S0-05`, но первый запуск не обязан писать события или строить funnel. Удалять рабочий committed код ради rebaseline не требуется.

## 5. Активный unit

### S0-07 — Закрыть foundation по solo-launch boundary

- **Status:** `completed`
- **Objective:** Убрать operational overengineering из critical path, синхронизировать документы и подтвердить, что committed `S0-01`–`S0-06` достаточно для начала profile vertical.
- **Requirements:** PRD §3.3, §6, `LFR-10`–`LFR-11`; TD §1.1, §22 S0.
- **Dependencies:** `S0-06` completed.
- **Read first:** PRD §3.3, §6, §19.1, §20.1; TD §1.1, §2.4, §13, §22; deferred-capabilities document.
- **Preconditions:** `main` at unique `S0-06`; no remote; Node `>=24.18.0 <25`; pnpm `>=11.15.1 <12`; overengineered uncommitted candidate preserved recoverably before replacement.
- **Scope:** `docs/PRD.md`, `docs/TECHNICAL_DESIGN.md`, `docs/DEFERRED_PLATFORM_CAPABILITIES.md`, `README.md`, `AGENTS.md`, this plan. No runtime/schema/test implementation.
- **Do not touch:** committed source, migrations, package dependencies, real Telegram, credentials, LaunchAgent, backup/restore or another repository.
- **Invariants:** S0-01–S0-06 commits remain unchanged; no staged source/migration/test diff; Later items do not block S1; no claim of deployed/production-ready behavior.
- **Tests first:** Documentation checklist: solo audience/no cap, manual distribution, exact launch flow, deferred list/triggers, one-review policy and stage commands.
- **Verification:** `node --version`; `pnpm --version`; `pnpm check`; `pnpm db:verify`; `git diff --check`; exact changed-file check; relative-link check; `git diff --name-only HEAD -- src migrations test package.json pnpm-lock.yaml`; staged secret scan.
- **Review:** One Sol max read-only review limited to contradictions that could reintroduce deferred scope or remove a launch-critical safety invariant.
- **Exit criteria:** S0/S0-07 `completed`; aggregate gates green; documents agree; only documentation changed; one local commit `S0-07: rebaseline foundation for solo launch`; clean tree; no remote.
- **Completion evidence:**
  - Commit SHA: `SELF`
  - Changed files: `AGENTS.md`, `IMPLEMENTATION_PLAN.md`, `README.md`, `docs/PRD.md`, `docs/TECHNICAL_DESIGN.md`, `docs/DEFERRED_PLATFORM_CAPABILITIES.md`; no source, migration, test, package or lockfile changes.
  - Focused checks: preflight confirmed `main` at unique `S0-06` `5c7c4c9223131ecd2c7a4a4b50e19f1ae7fbdcc3`, no remote, Node `v24.18.0`, pnpm `11.15.1`; solo audience/manual distribution/no-cap, LFR/LAC traceability, Later triggers, relative-link and stale-mandatory-assertion audits passed.
  - Aggregate checks: `pnpm check` PASS; `pnpm db:verify` PASS; `git diff --check` PASS; forbidden source/migration/test/package diff empty; staged secret scan PASS.
  - Acceptance evidence: PRD first-launch scope is `LFR-01`–`LFR-11` and `LAC-01`–`LAC-12`; manual distribution and exact launch handoff are documented; deferred platform capabilities have explicit triggers; TD preserves the accepted S0-05 `product_events` schema primitive without making analytics mandatory; no deployed, production-ready, scale or SLA claim is made.
  - Review result: `Sol max — PASS (solo-launch boundary and early hands-on sequencing; no in-scope blockers)`.
  - Notes/deviations: Before S1, a user-directed amendment moved minimal runtime composition to S1, added separately authorized real checkpoints after S1–S3, and made S4 the shareable launch; no runtime/source changes were made. Previous 40-file runtime-health/cleanup/socket candidate is preserved in the named local Git stash `stash@{0}` and is not part of the launch candidate. No migration, test, package, lockfile, credential, remote or production files changed.
- **Stop conditions:** A committed S0 regression appears, a real secret is found, required safety depends on discarded code, or docs cannot agree without a new product decision.

## 6. Следующие stages

### S1 — Profile vertical

#### S1-01 — Profile state and privacy boundary

- **Status:** `completed`
- **Objective:** Persist one active profile with public fields/platform and separate private contact.
- **Requirements:** `LFR-01`, `LFR-10`; `LAC-01`, private-contact part of `LAC-05`.
- **Dependencies:** `S0-07`.
- **Read first:** PRD §4–§7, §19.1, §20.1; TD profile schema/value types and §22 S1.
- **Scope:** Minimal profile migration, domain/application repository and focused SQLite tests.
- **Do not touch:** grammY UI, cards, analytics, multi-profile history UI, native channel picker (the picker and its fallback belong to S1-02).
- **Invariants:** Decimal Telegram IDs remain strings/bigints without unsafe Number conversion; public projection never contains private contact; exactly one active profile per Telegram user.
- **Tests first:** create/read/edit, duplicate update replay, public/private projection, restart persistence.
- **Verification:** focused unit/integration tests, fresh and previous-version migration checks, `pnpm db:verify`, `pnpm check`, `git diff --check`, and staged secret scan.
- **Exit criteria:** Profile state and privacy checks pass; one commit `S1-01: persist private-safe user profiles`.
- **Evidence:**
  - Commit SHA: `SELF`
  - Changed files: `migrations/0003_s1-01-profile-state.sql`, `src/domain/profiles/profile.ts`, `src/application/ports/profile-repository.ts`, `src/application/profiles/profile-service.ts`, `src/infrastructure/database/drizzle-schema.ts`, `src/infrastructure/database/profile-repository.ts`, `test/integration/s1-01-profile.test.ts`, `test/unit/s1-01-profile-domain.test.ts`, and S0 migration-fixture adjustments in `test/integration/s0-05-outbox.test.ts` and `test/runtime/s0-06-delivery.test.ts`.
  - Preflight: `main` at `8f1e91d` before this unit, no remote, clean tree, Node `v24.18.1`, pnpm `11.15.1`.
  - Focused checks: profile domain `4 passed`; profile integration `5 passed`; fresh migration and previous-version upgrade are covered by the profile integration suite.
  - Aggregate checks: `pnpm db:verify` PASS; `pnpm check` PASS (`unit 26`, `integration 30`, `runtime 21`, build); `git diff --check` PASS; secret scan PASS.
  - Acceptance evidence: `profiles`/`profile_platforms`/`profile_topics` persist the profile aggregate; partial unique index leaves exactly one active profile per Telegram user; create/read/edit/restart/replay pass; public projection has no `privateContact`; a 21-digit Telegram ID remains a string; platform URL, topic, audience and private-contact validation pass.
  - Review/deviations: focused read-only launch-blocker review found no S1-01 blocker; stage-final independent review remains at the S1 gate after S1-02. Existing S0-05/S0-06 tests now use explicit two-migration fixtures so their historical foundation assertions remain valid after adding migration 0003.
- **Stop conditions:** Requires product fields beyond PRD, native Telegram network, or more than one profile.

#### S1-02 — Main menu and profile wizard

- **Status:** `completed`
- **Objective:** Let a user complete, view and edit the profile from `/start` through fake tests and the same manually runnable real Telegram bot.
- **Requirements:** `LFR-01`, `LFR-10`; `LAC-01`, `LAC-08`–`LAC-09`.
- **Dependencies:** `S1-01`.
- **Scope:** Minimal grammY long-polling entrypoint, config/migration wiring, `getMe` identity check, basic one-shot SIGINT/SIGTERM shutdown, fake adapter, menu/profile wizard and restart journey. For `telegram_channel`, use Telegram's native channel request first and a manual public-URL fallback when Telegram returns no username or the user declines.
- **Do not touch:** Showcase/channel capability, card flows, product events, generic form/runtime framework, heartbeat/status DB, Unix socket, cleanup scheduler, LaunchAgent or backup automation. Never write a real token into repository files, fixtures, SQLite or logs.
- **Execution exception:** By explicit user direction, the approved native channel request + manual fallback is in S1-02 even though it may exceed the default 12 source/test files or roughly 90-minute unit target. Keep it as this single unit; do not add another S1 unit or widen the rest of the runtime scope.
- **Invariants:** Profile creation is deferred until user chooses create/apply; duplicate callback returns current state; logs redact raw contact/input.
- **Tests first:** `/start`, create/edit/view, cancel/resume, duplicate callback, restart, startup order, wrong expected bot identity and basic signal shutdown.
- **Verification:** focused fake-adapter/runtime journey, `pnpm check`, one stage-final critical review; after separate credentials/network authorization, manual real Telegram `/start → create → view → edit → restart` checkpoint.
- **Exit criteria:** The compiled app is manually runnable and the profile flow passes fake gates. With separately authorized credentials, the author can touch the same flow in Telegram immediately after S1; one commit `S1-02: run profile flow in Telegram bot`.
- **Evidence (final local candidate):**
  - Commit SHA: `SELF` — local commit subject: `S1-02: run profile flow in Telegram bot`.
  - Changed files: `migrations/0004_s1-02-profile-sessions.sql`, `src/application/ports/profile-session-repository.ts`, `src/application/ports/telegram-user-writer.ts`, `src/bot/profile-bot.ts`, `src/cli/bot.ts`, `src/infrastructure/database/drizzle-schema.ts`, `src/infrastructure/database/profile-session-repository.ts`, `src/infrastructure/database/telegram-user-repository.ts`, `src/infrastructure/testing/fake-telegram-api.ts`, `src/runtime/bot-runtime.ts`, `package.json`, `test/integration/s1-02-profile-session.test.ts`, `test/e2e-fake/s1-02-profile-bot.test.ts`, `test/runtime/s1-02-runtime.test.ts`, and this plan evidence. Existing `DurableCommandExecutor`/pure config parser were reused without semantic changes.
  - Scope note: the candidate exceeds the default 12 source/test-file and roughly 90-minute target because the explicitly approved native `request_chat`/`ChatShared` actor/session-bound picker plus canonical manual `https://t.me/<username>` fallback is in this single S1-02 unit; no third S1 unit was created.
  - Focused checks: durable session fresh/reopen/TTL and previous S1-01 fixture upgrade; fake grammY `/start → /profile → create → native picker without username → manual canonical URL → apply → duplicate callback → cancel/resume → edit`; stale/foreign actor-bound callbacks and delete-failure rollback/retry; private-chat guard; runtime identity, env-file/database 0600/regular-file preflight, migration-before-`getMe`, allowed updates and lifecycle shutdown with signal-before-start and blocking in-flight drain.
  - Aggregate checks: `pnpm check` PASS — unit `26`, integration `33`, runtime `27`, build; `pnpm test:e2e:fake` PASS — `1`; `pnpm db:verify` PASS; focused previous-version upgrade and fresh/reopen migration tests PASS; `pnpm typecheck`/`pnpm lint` PASS; `git diff --check` PASS. Secret-pattern scan PASS for credential-shaped values; the only token-like fixture is the literal `fake-token` in the local fake env/API tests.
  - Acceptance evidence: profile session is versioned, SQLite-durable, TTL-bound and survives close/reopen; profile and session mutation execute inside the existing `DurableCommandExecutor` transaction and `command_receipts`/`processed_updates`, with Bot API replies deferred until commit; `/start` does not create a profile; private contact is only shown in own view; unimplemented menu entries are neutral and do not enter cards/events; no showcase capability check, real credentials, network or Telegram smoke was used.
  - Review/deviations: Sol max first review was `BLOCK` on five findings: mutable-clock Telegram `occurredAt`, unbound stale callbacks, swallowed apply storage errors, database privacy/SQL CHECK parity, and incomplete lifecycle/drain proof. Consolidated fixes and regression tests were added; the explicitly authorized second minimal fake-E2E wave then proved UI resume after a real close/reopen and saved-profile view after a second real close/reopen, without widening S1-02 or adding a unit. Final Sol max review is `PASS`; no real Telegram, credentials, network or Telegram smoke is claimed. Telegram `occurredAt` is payload-stable across clock advance/restart; mutation callbacks bind actor via the session owner plus generation/revision; apply lets storage/invariant failures roll back the existing durable receipt transaction; parent/database privacy is enforced before migrations and Drizzle/migration checks match; lifecycle is one-shot with onStart/running, failure-safe stop, signal-before-start rejection and blocking drain. The explicit env-file path is preflighted as a regular current-user-owned mode `0600` file; startup applies migrations before `getMe`, checks exact bot id/username, installs `bot.catch`, then starts polling only with `message` and `callback_query`.
- **Stop conditions:** Local implementation cannot pass without real Telegram, a new profile policy is required, or unit boundary is exceeded. The hands-on checkpoint itself pauses for separate authorization.

### S2 — Card publication vertical

#### S2-01 — Draft, preview and deep-link identity

- **Status:** `pending`
- **Objective:** Let an author create, resume, cancel and preview a collaboration draft.
- **Requirements:** `LFR-02`, `LFR-10`; draft/restart parts of `LAC-02`, `LAC-09`.
- **Dependencies:** `S1-02`.
- **Scope:** Minimal collaboration schema/domain/repository, opaque public token and fake wizard.
- **Do not touch:** showcase network, edit-after-publication, deadline runner, completion, analytics.
- **Invariants:** Draft belongs to actor; cancel is replay-safe; public token is opaque and never logged.
- **Tests first:** happy wizard, Back/Cancel/resume, invalid input, foreign actor, restart.
- **Verification:** focused unit/integration/fake-adapter tests and migration checks.
- **Exit criteria:** Exact preview and restart-safe draft flow pass; one commit `S2-01: create resumable collaboration drafts`.
- **Evidence:** Fill plan evidence and `Commit SHA: SELF`.
- **Stop conditions:** Requires new fields/policy or real channel mutation.

#### S2-02 — Known-result showcase publication and own cards

- **Status:** `pending`
- **Objective:** Publish one showcase post through the existing delivery ledger and list authoritative own cards.
- **Requirements:** `LFR-03`, `LFR-08`, `LFR-11`; `LAC-02`, own-list part of `LAC-06`.
- **Dependencies:** `S2-01`.
- **Scope:** Canonical renderer, publication use case, fake Telegram outcome handling, own-card query and wiring into the existing S1 runtime.
- **Do not touch:** automatic reconciliation UI, staged edit, post status scheduler, analytics.
- **Invariants:** No network in SQLite transaction; only known `message_id` publishes; ambiguous send is not blind-retried; failed DM/post does not invent business success.
- **Tests first:** known success, known failure, ambiguous send, duplicate publish command, own list.
- **Verification:** focused SQLite/runtime/fake tests, `pnpm check`, one stage-final critical review; after separate Telegram authorization, manual real checkpoint `create → preview → publish → showcase post → own cards`.
- **Exit criteria:** `LAC-02` passes locally and the existing bot runtime exposes the flow. With separately authorized credentials/channel, the author can publish a real test card immediately after S2; one commit `S2-02: publish and list collaboration cards`.
- **Evidence:** Fill exact evidence and `Commit SHA: SELF`.
- **Stop conditions:** Local implementation cannot pass without real Telegram or requires deferred reconciliation/status infrastructure. The hands-on checkpoint itself pauses for separate authorization.

### Future capability (non-blocking)

#### FUT-01 — Telegram-only automatic audience count

- **Status:** `future` — отдельная узкая карточка между S2 и S3; не является stage, не добавляется в граф зависимостей и не меняет ровно две S1 units.
- **Objective:** После успешного сохранения профиля без явно введённого размера аудитории best-effort получить число подписчиков canonical public Telegram-канала через Bot API и сохранить происхождение значения.
- **Requirements:** PRD §7.2–§7.3 и TD §8.3, §10; только Telegram-канал с canonical public username и доступным chat identity.
- **Dependencies:** `S1-02` для canonical URL/native `ChatShared` identity; существующие profile platform repository и `Clock`. Не блокирует S3 и не требует showcase capability.
- **Scope:** Application port/adaptor для `getChatMemberCount`; один вызов после commit успешного create/update профиля, только когда `audience_size` отсутствует и есть canonical Telegram username плюс `telegram_chat_id` (предпочтительно) или `@username` (fallback). Вызов выполняется вне SQLite transaction; успех записывается короткой атомарной transaction.
- **Schema contract:** Текущая `profile_platforms` содержит только `audience_size`, поэтому provenance/timestamp ещё не совместимы с текущей схемой как хранимые поля. Эта карточка включает только additive migration со nullable `audience_source` (`manual` | `telegram_api`) и `audience_observed_at` (UTC integer milliseconds, non-negative); существующие rows остаются валидными. Manual input записывает `manual`, успешный Bot API count — `telegram_api`; явное manual значение не перезаписывается автоматикой.
- **Failure policy:** `getChatMemberCount` errors, no access, private/inaccessible channel, missing username/chat identity и unknown/invalid channel — fail soft: профиль и session не откатываются, текущий manual value сохраняется, пользователь может ввести значение вручную. Для non-Telegram HTTPS не делается Bot API call и сохраняется explicit manual entry.
- **Do not touch:** Instagram, VK, TikTok, YouTube и другие platform integrations; OAuth; scraping; scheduler, worker, periodic refresh, background polling, auto-retry loop, showcase permissions или изменение S1 evidence.
- **Tests first:** failing unit tests для eligibility/target precedence и classifier; fresh/upgrade SQLite migration tests для nullable provenance/checks; fake Bot API success by chat ID and `@username`, 403/no-access/private failure, duplicate command and manual-value preservation; fake profile E2E proving automatic fill and manual fallback; no-network assertion for non-Telegram.
- **Acceptance:** Eligible canonical Telegram platform makes at most one user-triggered post-commit lookup per profile save when audience is missing; successful non-negative count is persisted with `source=telegram_api` and timestamp; manual and non-Telegram paths remain explicit; failure is visible only as safe fallback and never creates a partial profile mutation. Local/fake evidence must not claim real Telegram accuracy.
- **Verification/evidence:** focused unit/SQLite/fake E2E, fresh and upgrade migrations, `pnpm db:verify`, `pnpm check`, `git diff --check`, changed-file and secret scans. Real Bot API count comparison, access/no-access behavior and exact bot identity are a separately authorized real-Telegram checkpoint; no credentials/network are part of the local card.
- **Stop conditions:** source/timestamp cannot be added without destructive migration; the API requires a policy beyond best-effort manual fallback; implementation needs periodic refresh, another platform integration, OAuth/scraping, real credentials/network for local acceptance, or a new product field/policy.

### C-01 — Telegram-first contact correction (post-S1, pre-S3)

- **Status:** `completed`
- **Objective:** Убрать обязательный private/alternate contact из profile wizard и storage; после будущего S3 acceptance оставить прямой Telegram action как единственный канонический контактный путь.
- **Dependencies:** Existing `S1-02` profile wizard and `telegram_users` current identity snapshot. This is a bounded correction, not a third S1 unit and not a new stage dependency.
- **Scope:** PRD/TD/plan contract update; S1 domain/input/repository/Drizzle mapping; `audience → review` wizard transition; session step/draft validation; migration `0005_s1-03-telegram-first-contact.sql` dropping `profiles.private_contact` and existing values without legacy/backup copy, removing `$.draft.privateContact` from every profile session, converting legacy table/JSON `private_contact` steps to `review`, and preserving profile/platform/topic/session metadata; fresh/upgrade/fake regression tests.
- **S3 contract only:** After an accepted pair, S3 will render «Написать в Telegram», preferring `https://t.me/<current_username>` and falling back to inline `tg://user?id=<telegram_user_id>` with explicit privacy/failure behavior. If identity is unavailable, S3 may add a one-shot «Попросить контакт» handshake. No in-bot relay, history, moderation, automatic phone request or pre-match disclosure is implemented here.
- **Invariants:** New/current profile flow never asks for or writes phone/email/alternate contact; public profile remains separate from `telegram_users`; migration preserves all non-contact authoritative data; S3 remains pending and no S3 buttons are implemented in this correction.
- **Tests first:** domain validation without contact; fresh schema without `private_contact`; v4→v5 upgrade with valid legacy `private_contact` and `review` sessions for distinct users plus profile/platform/topic data; close/reopen `SqliteProfileSessionRepository` reads and raw JSON cleanup; profile aggregate read; fake `/start → create → native/manual platform → audience → review → apply → view/edit`; no contact prompt/assertion.
- **Verification:** focused profile/migration/fake E2E, `pnpm db:verify`, `pnpm check`, `git diff --check`, exact changed-file and secret scans. No live DB migration, live bot process, credentials, real Telegram network or S3 contact action was used.
- **Evidence:** Commit SHA `SELF`; historical S1-01/S1-02 evidence above remains historical evidence for the pre-correction contract and is not silently rewritten. Sol max cycle 1 found a migration blocker because legacy session JSON/step cleanup was missing; the follow-up adds atomic cleanup and close/reopen/raw-JSON regression evidence. This card records the explicit post-S1 product/schema correction.
- **Stop conditions:** Migration cannot prove non-contact data preservation; any implementation needs legacy contact storage/sentinel, pre-match identity disclosure, in-bot relay/history/moderation, automatic phone collection, or S3 decision logic.

### S3 — Marketplace vertical

#### S3-01 — Feed, deep link and application

- **Status:** `pending`
- **Objective:** Let another user find an eligible card and submit one application.
- **Requirements:** `LFR-04`–`LFR-05`, `LFR-10`; `LAC-03`, `LAC-08`.
- **Dependencies:** `S2-02`.
- **Scope:** Simple feed, basic filters, deep-link query, application submit and author notification intent.
- **Do not touch:** saved browse analytics/session history, withdraw, recommendations, deadline runner.
- **Invariants:** Own/hidden/closed/full cards reject applications; private contact remains absent; duplicate command creates no second application/intent.
- **Tests first:** feed eligibility, deep link, submit guards, duplicate replay, notification failure independence.
- **Verification:** focused unit/SQLite/fake tests.
- **Exit criteria:** `LAC-03` passes; one commit `S3-01: browse cards and submit applications`.
- **Evidence:** Fill exact evidence and `Commit SHA: SELF`.
- **Stop conditions:** Requires analytics, recommendation policy or real Telegram before the stage-final authorized checkpoint.

#### S3-02 — Decisions, capacity, Telegram contact action and own applications

- **Status:** `pending`
- **Objective:** Let the author accept/reject, close recruitment and expose a pairwise Telegram contact action; show authoritative application statuses.
- **Requirements:** `LFR-06`–`LFR-08`, `LFR-11`; `LAC-04`–`LAC-06`, `LAC-08`–`LAC-09`.
- **Dependencies:** `S3-01`.
- **Scope:** Decision transaction, slot guard, manual close, accepted-pair Telegram action (username link, user-ID fallback or one-shot request), own-application list and intents.
- **Do not touch:** completion, reminders, automatic deadline, block/unblock or block/accept policy.
- **Invariants:** Capacity never exceeds slots; Telegram action only for accepted pair; no pre-match identity disclosure or in-bot relay; DM failure never rolls back decision; replay returns current result.
- **Tests first:** accept/reject, last slot, manual close, Telegram action visibility/fallback matrix, failed DM, restart/replay.
- **Verification:** focused unit/SQLite/fake tests, core fake journey, `pnpm check`, one stage-final critical review; after separate Telegram authorization, manual two-account checkpoint `browse → apply → accept/reject → contact → own lists`.
- **Exit criteria:** `LAC-04`–`LAC-06` pass and the same flow is wired into the runnable bot. With separately authorized accounts, the author can touch the core product immediately after S3; one commit `S3-02: decide applications and reveal pair contacts`.
- **Evidence:** Fill exact evidence and `Commit SHA: SELF`.
- **Stop conditions:** Telegram action privacy/fallback cannot be proven, implementation needs automatic phone collection/in-bot relay, or scope requires Later lifecycle.

### S4 — Shareable launch

#### S4-01 — Simple admin hide, real smoke and shareable handoff

- **Status:** `pending`
- **Objective:** Add the minimum moderation escape hatch, prove the complete flow and hand the author a bot link that can be shared manually.
- **Requirements:** `LFR-09`; `LAC-07`, `LAC-10`–`LAC-12`.
- **Dependencies:** `S3-02`.
- **Scope:** Allowlisted lookup/hide, hide delivery intent, full fake journey, exact bot/channel preflight, separately authorized real journey and concise manual start/stop/restart/database-copy handoff.
- **Do not touch:** restore, block/unblock, cascades, analytics, completion, scheduler, status/heartbeat, backup/LaunchAgent.
- **Invariants:** Non-admin cannot hide; hidden card is absent from feed and rejects applications; contact already revealed is not revoked; Telegram delete failure does not make the card visible in authoritative feed.
- **Tests first:** admin/non-admin, hide active card, failed delete, feed/apply guards, full fake journey and a real-smoke checklist with abort conditions before external mutations.
- **Verification:** focused tests, full fake journey, migrations, `pnpm check`, staged secret scan and one critical review; then, after separate credentials/Telegram authorization, exact identity/channel and full real journey through admin hide and restart.
- **Exit criteria:** `LAC-01`–`LAC-12` pass at their applicable local/fake/real evidence level; the author has the exact manual command and may share the bot link; one commit `S4-01: prove shareable collaboration journey`.
- **Evidence:** Fill exact evidence and `Commit SHA: SELF`.
- **Stop conditions:** Requires block/restore policy, wrong bot/channel identity, missing explicit real-Telegram authorization, non-green local gate or risk to another bot.

## 7. Git и evidence

Перед каждым unit: branch/HEAD/status/remote, predecessor Task-ID, Node/pnpm contract и complete card review. Перед commit: exact diff, focused checks, applicable aggregate gate, secret scan и evidence.

Commit subject: `<ID>: <short measurable result>`. Внутри commit использовать `Commit SHA: SELF`; authoritative SHA после commit:

```sh
git log --format='%H' --grep='^<ID>:' -n 1
```

Push, remote, PR, merge, deploy, credentials и real Telegram не следуют из обычного stage launch.

## 8. Определения готовности

- **Foundation complete:** `S0` завершён; это не пользовательский бот.
- **Hands-on increment:** после каждого из `S1`–`S3` compiled bot уже содержит новый flow; после отдельной авторизации его сразу проверяют в real Telegram, не откладывая integration до финала.
- **Local launch candidate:** `S4` и `LAC-01`–`LAC-11` зелёные на fake Telegram.
- **Manual first launch:** `S4`, отдельно авторизованный `LAC-12` и exact bot/channel checkpoint пройдены; ссылку можно отправлять людям.
- **Production ready / 24/7 / scalable:** не является целью этого плана и не заявляется.

Следующая команда после завершения `S0-07`:

```text
Выполни этап S1 по IMPLEMENTATION_PLAN.md
```
