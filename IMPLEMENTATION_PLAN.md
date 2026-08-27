# Collaboration Bot — solo-launch implementation plan

- Статус документа: `Approved execution registry`
- Версия: `0.9`
- Дата: `2026-08-27`
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
| S1 — Profile vertical | `completed` | 2 | Реальный бот открывается, пользователь создаёт и видит профиль |
| S2 — Card publication vertical | `completed` | 2 | Автор создаёт и публикует карточку через fake showcase transport |
| S3 — Marketplace vertical | `completed` | 4 | Два пользователя проходят отклик, решение и получают Telegram action |
| S4 — Shareable launch | `completed` | 1 | Admin hide, полный real journey и готовая к распространению ссылка |
| FUT — Telegram audience snapshot | `completed` | 1 | Best-effort снимок аудитории Telegram после сохранения профиля |
| R1 — Post-launch maintainability | `completed` | 14 | Те же пользовательские контракты с feature-owned кодом и проверяемыми границами |
| R2 — Complete feature-first layout | `in_progress` | 17 | Весь бизнес-код принадлежит явным модулям; legacy feature paths отсутствуют |

```text
P0-01 → P0-02
  → S0-01 → S0-02 → S0-03 → S0-04 → S0-05 → S0-06 → S0-07
  → S1-01 → S1-02
  → S2-01 → S2-02
  → S3-01 → S3-02 → S3-03 → S3-04 → S3-C1 → S3-C2
  → S4-01
  → FUT-01
  → R1-00 → R1-01 → R1-02 → R1-03 → R1-04
  → R1-05A → R1-05B → R1-05C
  → R1-06A → R1-06B → R1-06C → R1-07 → R1-08 → R1-09
  → R2-00 → R2-01 → R2-02 → R2-03 → R2-04
  → R2-05A → R2-05B → R2-06 → R2-07 → R2-08 → R2-09
  → R2-10 → R2-11 → R2-12 → R2-13 → R2-14 → R2-15
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
| S0-07 | `8f1e91dc88e7f0109286ea0c45b064f79fd4e76f` | solo-launch rebaseline |
| S1-01 | `226d70c46241fd80838d21493eb0568d1ed7c2f4` | persistent privacy-safe profiles |
| S1-02 | `3ef8edff006304d4df485b9cad14e6e2934d4f27`, `7f9ef7f60117c82d5313dbd6fd13a0075c793a27`, `1a24880149c681d1c720fbade743a9a3ab26e6f1` | runnable profile flow and checkpoint corrections |
| C-01 | `8ecf3ff1954bb2ef28bda97d2b4fafd3efc5cffd`, `aaa66f9bf79cfd9532829065ef786074d99d1c76` | Telegram-first contact migration and remediation |
| S2-01 | `073ab018929ceb444a1ca00c91c69d4c7f3d3ce2` | resumable collaboration drafts |
| S2-02 | `603f8a0c1749d5eb6457c8e9727595d3a4f6a06b` | known-result publication and own cards |
| S3-01 | `123307c460570e1c521d7e3e72a802011a301530` | minimal applicant profiles |
| S3-02 | `c804e7d8c85b1de87ba6fb4bf41682bf107922d5` | feed and public deep links |
| S3-03 | `b514e69383d479855c96380cfca34b676335acfc` | resumable quick-profile applications |
| S3-04 | `65890ffcdbb4c00813e1542d1e6bc37c94ed583f` | serialized decisions and pairwise contacts |
| S3-C1 | `bf9407f63398576bd8fa7dd13bcd2f209304e15e` | real-checkpoint collaboration card rendering correction |
| S3-C2 | `SELF` | explicit personal Telegram platform opt-in |
| S4-01 | `SELF` | allowlisted hide, complete fake/real journey and manual launch handoff |
| FUT-01 | `SELF` | one-time Telegram audience snapshot with internal provenance |
| R1-00 | `7593f9bc127b6900bf57ca8275467ba7214bbc5a` | decision-complete post-launch maintainability stage |
| R1-01 | `6a7bc10ed3b15f5288f746fd19a0c08424b33699` | executable import graph and cycle enforcement |
| R1-02 | `f35741ed16c6ef102a65043c82c0ae10ae57a62d` | consumer-oriented applications use cases and ports |
| R1-03 | `4803b0412c9cb8446ad8581cd7a90ca2169e20d9` | feature-owned applications persistence and composition |
| R1-04 | `256caab6c3ea27328e4d1a4488fe75a337c10bd0` | single durable Telegram ingress seam |
| R1-05A | `d31851962392747563613754a010208ad6207c8e` | feature-owned profile Telegram composer |
| R1-05B | `38978f6172fc1e9c4f9c3c9895deaebcbf63f541` | feature-owned collaboration Telegram composer |
| R1-05C | `564012baf8dbd30fb927e3418447987e556b4ea1` | feature-owned marketplace and moderation Telegram composers |
| R1-06A | `5630111cda4e5e092a7c11c0a63601330d64468a` | isolated delivery worker lifecycle |
| R1-06B | `e92d6ed2da4be12ea6fcad8c0c703eed06ecee30` | separated bot composition and runtime lifecycle |
| R1-06C | `70b928dfb57bd98261e33c2dda369eeeda199c09` | thin process, config and filesystem bootstrap boundaries |
| R1-07 | `c641f9440b0a386022c07d53813ed890842e9f4f` | consolidated production-like test support |
| R1-08 | `947c304f94fd485c8b158e0af51813dd77adf4b2` | raw SQL as the only persistence model |
| R1-09 | `411383eb96edcca3f8cef2a1b13409eac2c1d4b8` | verified maintainability candidate and schema-validator decision |
| R2-00 | `d00c821063893137c9745ed74605aa8dafdb626f` | decision-complete feature-first completion stage |
| R2-01 | `35a8456a042f8729e3dfe8e1e1bc2cfa711f63f1` | executable public-module and Telegram routing contracts |
| R2-02 | `f4a224c37ee5fed8f834a469d111c289b529a6cd` | profiles domain and application ownership |
| R2-03 | `7a1f3e787a7ff97464a71f82ba80ba285e71e256` | profiles adapters and composition ownership |
| R2-04 | `62801b068ccfa48121f9236d1c0b24aedfc931b2` | profile Telegram presentation ownership |
| R2-05A | `SELF` | collaboration domain and port ownership |

`product_events` уже существует как foundation primitive из `S0-05`, но первый запуск не обязан писать события или строить funnel. Удалять рабочий committed код ради rebaseline не требуется.

## 5. Реестр units

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

- **Status:** `completed`

#### S2-01 — Draft, preview and deep-link identity

- **Status:** `completed`
- **Objective:** Let an author create, resume, cancel and preview a collaboration draft.
- **Requirements:** `LFR-02`, `LFR-10`; draft/restart parts of `LAC-02`, `LAC-09`.
- **Dependencies:** `S1-02`.
- **Scope:** Minimal collaboration schema/domain/repository, opaque public token and fake wizard.
- **Do not touch:** showcase network, edit-after-publication, deadline runner, completion, analytics.
- **Invariants:** Draft belongs to actor; cancel is replay-safe; public token is opaque and never logged.
- **Tests first:** happy wizard, Back/Cancel/resume, invalid input, foreign actor, restart.
- **Verification:** focused unit/integration/fake-adapter tests and migration checks.
- **Exit criteria:** Exact preview and restart-safe draft flow pass; one commit `S2-01: create resumable collaboration drafts`.
- **Evidence:**
  - Commit SHA: `SELF` — local commit subject: `S2-01: create resumable collaboration drafts`.
  - Changed files: `migrations/0006_s2-01-collaboration-drafts.sql`, `src/domain/collaborations/collaboration.ts`, `src/application/collaborations/collaboration-draft-service.ts`, `src/application/collaborations/collaboration-renderer.ts`, `src/application/ports/collaboration-repository.ts`, `src/application/ports/collaboration-session-repository.ts`, `src/infrastructure/database/collaboration-repository.ts`, `src/infrastructure/database/collaboration-session-repository.ts`, `src/infrastructure/database/drizzle-schema.ts`, `src/application/ports/profile-session-repository.ts`, `src/infrastructure/database/profile-session-repository.ts`, `src/bot/profile-bot.ts`, `src/runtime/bot-runtime.ts`, `test/unit/s2-01-collaboration-domain.test.ts`, `test/integration/s2-01-collaboration.test.ts`, `test/e2e-fake/s2-01-collaboration-bot.test.ts`, and this plan evidence.
  - Focused checks: collaboration domain/renderer `4 passed`; fresh and `0005→0006` migration plus draft/session ownership/reopen/cancel integration `3 passed`; fake journey `profile → draft → preview → close/reopen → resume → /cancel`, deferred profile continuation, stale Cancel replacement-draft and profile/collaboration cross-flow guard `3 passed`; event-date Back/change/remove/restart and persisted-deadline-day close/reopen/clock-advance regressions PASS; existing fake profile suite `3 passed`.
  - Aggregate checks: `pnpm check` PASS — unit `30`, integration `41`, runtime `30`, build; final `pnpm test:e2e:fake` PASS — `6`; `pnpm db:verify` PASS; `pnpm typecheck`/`pnpm lint` PASS; `git diff --check` PASS. Staged secret-pattern scan PASS; no credentials or private database were used.
  - Acceptance evidence: additive `0006` creates `collaborations`, `collaboration_topics` and durable `collaboration_sessions`; one draft per active author profile is SQL-enforced; `public_token` is nullable and remains `NULL` through S2-01; draft/session ownership is actor-bound; generation/revision callbacks, restart resume, invalid-input preservation, Back, Cancel and replay-safe deletion pass; profile absence stores typed `create_collaboration` continuation and profile completion resumes the draft flow; renderer HTML-escapes user fields and enforces the 4096 UTF-16 limit without outputting internal/public identity values.
  - Review/deviations: Sol max review cycle 1 found three BLOCK findings: stale Cancel could delete a replacement draft, profile/collaboration sessions lacked a common transactional exclusion, and persisted ISO event dates were revalidated as DD.MM.YYYY. Consolidated fixes add actor/session-bound stale rejection, repository-level cross-flow transaction guards and explicit date-session conversion/clear semantics with regressions. Review cycle 2 found that a persisted deadline became unreachable on its deadline day; validation now distinguishes newly entered dates from a persisted snapshot valid while `now <= responseDeadlineAt`, with close/reopen and clock-advance regression. No real Telegram, credentials, showcase channel mutation, process launch, private SQLite or network smoke was used. `pnpm db:verify` and Vitest required host-capable execution because the sandbox could not write existing `dist`/`.vite-temp`; the commands themselves passed.
- **Stop conditions:** Requires new fields/policy or real channel mutation.

#### S2-02 — Known-result showcase publication and own cards

- **Status:** `completed`
- **Objective:** Publish one showcase post through the existing delivery ledger and list authoritative own cards.
- **Requirements:** `LFR-03`, `LFR-08`, `LFR-11`; `LAC-02`, own-list part of `LAC-06`.
- **Dependencies:** `S2-01`.
- **Scope:** Canonical renderer, publication use case, fake Telegram outcome handling, own-card query and wiring into the existing S1 runtime.
- **Do not touch:** automatic reconciliation UI, staged edit, post status scheduler, analytics.
- **Invariants:** No network in SQLite transaction; only known `message_id` publishes; ambiguous send is not blind-retried; failed DM/post does not invent business success.
- **Tests first:** known success, known failure, ambiguous send, duplicate publish command, own list.
- **Verification:** focused SQLite/runtime/fake tests, `pnpm check`, one stage-final critical review; after separate Telegram authorization, manual real checkpoint `create → preview → publish → showcase post → own cards`.
- **Exit criteria:** `LAC-02` passes locally and the existing bot runtime exposes the flow. With separately authorized credentials/channel, the author can publish a real test card immediately after S2; one commit `S2-02: publish and list collaboration cards`.
- **Evidence:**
  - Commit SHA: `SELF` — local commit subject: `S2-02: publish and list collaboration cards`.
  - Changed files: `migrations/0007_s2-02-channel-publications.sql`, `src/application/outbox/delivery-payload.ts`, `src/application/outbox/delivery-runner.ts`, `src/application/outbox/outbox-service.ts`, `src/application/ports/telegram-transport.ts`, `src/application/ports/outbox-delivery-store.ts`, `src/application/ports/collaboration-repository.ts`, `src/application/ports/collaboration-publication-repository.ts`, `src/application/ports/showcase-capability.ts`, `src/application/collaborations/collaboration-publication-service.ts`, `src/infrastructure/database/drizzle-schema.ts`, `src/infrastructure/database/collaboration-repository.ts`, `src/infrastructure/database/collaboration-publication-repository.ts`, `src/infrastructure/telegram/grammy-telegram-transport.ts`, `src/infrastructure/testing/fake-telegram-api.ts`, `src/runtime/showcase-preflight.ts`, `src/runtime/bot-runtime.ts`, `src/bot/profile-bot.ts`, `test/integration/s2-02-publication.test.ts`, `test/runtime/s2-02-preflight.test.ts`, and this plan evidence.
  - Focused checks: publication integration `4 passed` — atomic draft→publishing+channel_send, duplicate publish idempotency, known `message_id` projection, durable outcome-time projection/restart, one expired edit without keyboard, atomic prepared/retryable deadline cancellation and own-list privacy; preflight runtime `3 passed` — exact channel/admin capability, degraded capability and preseeded prepared-channel delivery with zero Bot API mutations; existing outbox delivery tests PASS — bounded retry, ambiguous no-retry and message-not-modified behavior.
  - Aggregate checks: `pnpm check` PASS — unit `30`, integration `41`, runtime `30`, build; `pnpm test:e2e:fake` PASS — `6`; `pnpm db:verify` PASS; `pnpm typecheck`/`pnpm lint` PASS; `git diff --check` PASS; secret-pattern scan PASS for credential-shaped values (only local `fake-token` fixtures).
  - Acceptance evidence: additive `0007` adds only minimal `channel_publications`; publication ownership/completeness/deadline is checked before one atomic public-token assignment, `publishing` transition and `channel_send` intent; the durable runner stores Telegram's returned `message_id` before projection, and permanent/exhausted/ambiguous outcomes become `publication_failed` without blind retry; safe versioned send payload carries one opaque-token deep-link URL button; startup preflight checks exact channel ID/normalized username/channel type and bot creator/administrator capabilities, with degraded draft/read mode; stale recovery and terminal projection run before polling; own cards expose authoritative statuses without token/message ID; publish and `/my_collaborations` are wired through existing durable ingress handlers; projection consumes only prepared/sending publications, uses outbox `updated_at` as durable outcome time, atomically creates one terminal expired edit intent, removes its inline keyboard and renders the explicit expired state; prepared and retryable deliveries crossing deadline are atomically prevented from claim/network dispatch.
  - Review/deviations: Sol max review cycle 1 found three BLOCK findings: historical terminal outcomes were reprojected using restart-now, deadline pre-claim was non-atomic and excluded retryable failures, and late-success edits reused active text/button state. Consolidated fixes make projection one-shot and outcome-time based, atomically transition deadline-crossing deliveries with legacy outbox CHECK compatibility, and use an expired renderer with an explicit empty inline keyboard; all three regressions are covered above. Review cycle 2 found degraded preflight still allowed prepared `channel_*` intents to be claimed; runtime now filters claims and deadline cancellation by capability, preserving those intents unchanged until a restored-capability restart, with a preseeded-runtime zero-mutation regression. Review cycle 3: independent Sol max read-only review returned `PASS` after rechecking all prior findings and full S2 launch blockers, exact two-commit history after baseline, clean `main` and no remote; Sol changed no files.
  - Real checkpoint: `NOT RUN — requires separate authorization` (no credentials, network, real Telegram/showcase action, bot process, private SQLite, push, PR or deploy).
- **Stop conditions:** Local implementation cannot pass without real Telegram or requires deferred reconciliation/status infrastructure. The hands-on checkpoint itself pauses for separate authorization.

### FUT — Telegram audience snapshot

#### FUT-01 — One-time Telegram audience snapshot

- **Status:** `completed` — отдельно авторизованный post-launch unit после завершённого `S4-01`; first-launch `LFR-*`/`LAC-*` не менялись.
- **Objective:** После успешного сохранения профиля без явно введённого размера аудитории best-effort получить один Telegram Bot API snapshot и сохранить внутреннее происхождение значения без заявлений о владении, охвате или качестве аудитории.
- **Requirements:** PRD §7.2–§7.3; TD §7.2, §8.3, §10.3 и §10.5.1. Eligibility определяется platform, а не `ProfileType`.
- **Dependencies:** `S4-01` completed как фактический predecessor; `S1-02` предоставляет canonical URL/native `ChatShared` identity, profile persistence, durable ingress, `Clock` и общий provider deadline. Showcase capability не требуется.
- **Preconditions:** clean `main` at `ab09e70f94455ed6b1342dcc8b31958614076f16`; cached `origin/main` совпадал и divergence был `0/0`; Node `v24.18.0`; pnpm `11.15.1`; уникального `FUT-01` commit не было. Любой drift требовал stop/re-plan.
- **Scope:** Внутренние `TelegramAudienceReader.getChatMemberCount(target, signal)` и conditional writer; ровно одна canonical Telegram platform без audience и intent `allow`. Валидный negative decimal `telegram_chat_id` передаётся строкой с приоритетом, иначе выполняется один вызов по `@username`; ошибка ID не запускает username fallback, multiple eligible platforms fail closed.
- **Session intent:** `audienceAutofill: allow | suppress` существует только в profile session. New/quick и уже-empty skip используют `allow`; смена platform сбрасывает в `allow`; manual entry и очистка populated draft ставят `suppress`. После save session удаляется, поэтому suppression относится только к этому сохранению.
- **Schema contract:** Additive `0013_fut-01-telegram-audience.sql` добавляет nullable `audience_source` (`manual | telegram_api`) и nullable non-negative integer UTC-ms `audience_observed_at`. Non-null provenance требует non-null audience/timestamp; legacy counts сохраняют `NULL` provenance без invented backfill. Manual writes используют save time, API writes — observation time; public profile projection остаётся прежней.
- **Post-commit ordering:** Только fresh durable effect регистрирует максимум одно действие. После commit receipt/profile/session transaction callback ack отправляется первым; lookup идёт через общий 15-секундный deadline; exact profile/platform CAS с `audience_size IS NULL` и parent timestamp выполняются в короткой transaction; outcome добавляется к сохранённому reply до flush текста. Receipt replay не планирует lookup; crash после commit может оставить audience пустым.
- **Failure policy:** Bot API `400/403/429`, inaccessible/private/personal username, not-found, network error, timeout, unknown provider failure и invalid count дают один safe fail-soft result без retry. Replaced platform или concurrent manual value дают stale CAS и не перезаписываются. Authoritative persistence/invariant errors не маскируются после безопасного подтверждения сохранения.
- **Do not touch:** Public `ProfileInput`, commands, callbacks, public profile shape и configuration; Instagram/VK/TikTok/YouTube integrations; `getChat` preflight; OAuth/scraping; scheduler, worker/outbox expansion, periodic refresh, retry loop, showcase permissions или persistent opt-out.
- **Tests first:** RED зафиксировал отсутствующие port/service/migration/orchestration. Unit покрывает eligibility, intent, ID precedence, username fallback, no second call, multiple fail-closed, invalid/zero count, 15-second deadline и grammY `400/403/429`/HTTP classification. SQLite покрывает fresh и `0012 → 0013`, legacy/checks, manual/API provenance, reopen, parent timestamp, replaced-platform и manual-value races. Fake Telegram покрывает native ID, manual username success/failure, quick continuation, explicit clear only for one save, duplicate receipt, manual/non-Telegram zero calls и committed state до завершения deferred lookup.
- **Acceptance:** Eligible save делает не более одного post-commit lookup; success сохраняет count с `telegram_api`/timestamp и добавляет точную snapshot copy; provider failure сохраняет профиль и добавляет точную fallback copy; public renderer по-прежнему показывает только `Аудитория: N`. Local/fake evidence не заявляет live Telegram accuracy.
- **Evidence:**
  - Commit SHA: `SELF` — local commit subject: `FUT-01: enrich Telegram audience snapshot`.
  - Changed files: `README.md`, `docs/PRD.md`, `docs/TECHNICAL_DESIGN.md`, `migrations/0013_fut-01-telegram-audience.sql`, `src/application/profiles/profile-audience-service.ts`, `src/bot/profile-bot.ts`, `src/infrastructure/database/drizzle-schema.ts`, `src/infrastructure/database/profile-repository.ts`, `src/runtime/bot-runtime.ts`, `test/unit/fut-01-telegram-audience.test.ts`, `test/integration/s1-01-profile.test.ts`, four migration-registry expectation fixtures, `test/e2e-fake/s1-02-profile-bot.test.ts`, and this plan. Exactly `12` source/test files changed; migration/docs/evidence are outside that cap.
  - Focused GREEN: FUT unit `18 passed`; profile SQLite `10 passed`; profile fake journey `6 passed`.
  - Aggregate checks: Node `v24.18.0`, pnpm `11.15.1`; `pnpm check` PASS — unit `61`, integration `80`, runtime `30`, build; separate `pnpm test:e2e:fake` PASS — `21`; `pnpm db:verify` PASS; `git diff --check` PASS; credential-shaped secret scan PASS.
  - Acceptance evidence: deferred-reader E2E opened a second SQLite connection and observed completed receipt, saved profile and deleted session before resolving lookup; callback ack preceded lookup; exact string chat ID was preserved; duplicate update left one call; conditional storage preserved replaced/manual state; quick profile reached `application_message` without an audience step.
  - Review result: independent read-only stage-final blocker review — PASS; post-commit/replay, eligibility/one-call policy, CAS/aggregate timestamp, migration/session intent and launch-blocker boundaries were rechecked; no fix wave and no second review cycle were needed.
  - Notes/deviations: no dependency/config/public contract, real credential, Telegram network, bot process, production DB, push, PR, merge or deploy action. A real count/access comparison remains a separately authorized optional checkpoint and was not run.
- **Stop conditions:** source/timestamp would require destructive migration; policy would require verification claims, periodic refresh, another platform integration, OAuth/scraping, production credentials/network, or a new persistent product field.

### C-01 — Telegram-first contact correction (post-S1, pre-S3)

- **Status:** `completed`
- **Objective:** Убрать обязательный private/alternate contact из profile wizard и storage; после будущего S3 acceptance оставить прямой Telegram action как единственный канонический контактный путь.
- **Dependencies:** Existing `S1-02` profile wizard and `telegram_users` current identity snapshot. This is a bounded correction, not a third S1 unit and not a new stage dependency.
- **Scope:** PRD/TD/plan contract update; S1 domain/input/repository/Drizzle mapping; `audience → review` wizard transition; session step/draft validation; migration `0005_s1-03-telegram-first-contact.sql` dropping `profiles.private_contact` and existing values without legacy/backup copy, removing `$.draft.privateContact` from every profile session, converting legacy table/JSON `private_contact` steps to `review`, and preserving profile/platform/topic/session metadata; fresh/upgrade/fake regression tests.
- **S3 contract only:** After an accepted pair, S3 will render «Написать в Telegram», preferring `https://t.me/<current_username>` and falling back to inline `tg://user?id=<telegram_user_id>` with explicit privacy/failure behavior. Missing/corrupt identity fails closed. No request-contact handshake, in-bot relay, history, moderation, automatic phone request or pre-match disclosure is implemented here.
- **Invariants:** New/current profile flow never asks for or writes phone/email/alternate contact; public profile remains separate from `telegram_users`; migration preserves all non-contact authoritative data; S3 remains pending and no S3 buttons are implemented in this correction.
- **Tests first:** domain validation without contact; fresh schema without `private_contact`; v4→v5 upgrade with valid legacy `private_contact` and `review` sessions for distinct users plus profile/platform/topic data; close/reopen `SqliteProfileSessionRepository` reads and raw JSON cleanup; profile aggregate read; fake `/start → create → native/manual platform → audience → review → apply → view/edit`; no contact prompt/assertion.
- **Verification:** focused profile/migration/fake E2E, `pnpm db:verify`, `pnpm check`, `git diff --check`, exact changed-file and secret scans. No live DB migration, live bot process, credentials, real Telegram network or S3 contact action was used.
- **Evidence:** Commit SHA `SELF`; historical S1-01/S1-02 evidence above remains historical evidence for the pre-correction contract and is not silently rewritten. Sol max cycle 1 found a migration blocker because legacy session JSON/step cleanup was missing; the follow-up adds atomic cleanup and close/reopen/raw-JSON regression evidence. This card records the explicit post-S1 product/schema correction.
- **Stop conditions:** Migration cannot prove non-contact data preservation; any implementation needs legacy contact storage/sentinel, pre-match identity disclosure, in-bot relay/history/moderation, automatic phone collection, or S3 decision logic.

### S3 — Marketplace vertical

#### S3-01 — Minimal applicant profiles

- **Status:** `completed`
- **Objective:** Make type, display name and one public platform sufficient for an active profile while preserving existing full profiles.
- **Requirements:** `LFR-01`, `LFR-10`; profile parts of `LAC-03`, `LAC-08`–`LAC-09`.
- **Dependencies:** `S2-02`.
- **Read first:** PRD §7, §19.1, §20.1; TD §7 migrations, §8.2–§8.4, §10.3 and §22 S3; current profile domain/repository/session/bot flow.
- **Scope:** Add `0008_s3-01-minimal-profiles.sql`; make description nullable, topics 0–3 and audience optional; keep type/display name/city/one platform mandatory. Ordinary create/edit exposes skip/clear for optional enrichment. Public/own render omits absent enrichment.
- **Do not touch:** feed, deep links, applications, contact identity, second profile, audience lookup or product events.
- **Invariants:** Existing profile/platform/topic IDs, values, active-profile index and collaboration references survive upgrade; no placeholder values; at least one public platform remains mandatory; private contact remains absent.
- **Tests first:** minimal/full domain validation, skip/clear edit, own/public render, fresh and `0007→0008` upgrade with close/reopen and dependent rows.
- **Verification:** focused profile unit/SQLite/fake tests, migration fresh/upgrade, `pnpm db:verify`, `pnpm check`, fake E2E, diff/secret scans.
- **Exit criteria:** Full and minimal profiles are valid and restart-safe; one commit `S3-01: allow minimal applicant profiles`.
- **Evidence:**
  - Commit SHA: `SELF` — local commit subject: `S3-01: allow minimal applicant profiles`.
  - Changed files: `migrations/0008_s3-01-minimal-profiles.sql`, `src/domain/profiles/profile.ts`, `src/application/ports/profile-session-repository.ts`, `src/infrastructure/database/profile-repository.ts`, `src/infrastructure/database/drizzle-schema.ts`, `src/bot/profile-bot.ts`, `test/unit/s1-01-profile-domain.test.ts`, `test/integration/s1-01-profile.test.ts`, `test/integration/s2-02-publication.test.ts`, `test/e2e-fake/s1-02-profile-bot.test.ts`, and this plan evidence; 10 source/test/migration files, within the bounded-unit limit.
  - Tests first: focused red proved the old contract rejected `description = NULL`, lacked migration `0008`, and rejected textual `-` for optional topics; the final focused profile/domain/migration/publication/fake suite is PASS — `20 passed`.
  - Aggregate checks: `pnpm check` PASS — unit `31`, integration `43`, runtime `30`, build; `pnpm test:e2e:fake` PASS — `6`; `pnpm db:verify` PASS; `git diff --check` PASS; credential-shaped secret scan PASS.
  - Acceptance evidence: fresh schema and `0007→0008` upgrade allow `description = NULL` with a 10–500 bound for present text; dependent profile/platform/topic/collaboration/publication data, exact IDs, active-profile index and foreign keys survive migration and close/reopen. Domain/repository accept zero topics and no audience while retaining type/display name/city/one-platform requirements. Revision-bound `Пропустить`/`Очистить` and textual `-` skip or clear topics, description and audience; stale buttons do not advance state. Full and minimal own/review renders show present enrichment and omit absent lines without placeholders; minimal profile state survives SQLite reopen.
  - Review/deviations: final diff inspection found no scope expansion into feed/applications/contact/product events and no private-contact reintroduction. No dependencies changed. No real Telegram, credentials, private database, network, bot process, remote, push, PR or deploy was used.
- **Stop conditions:** Nullable migration cannot preserve current IDs/FKs/indexes/rows, scope exceeds the bounded unit, or implementation needs placeholder data or another product field.

#### S3-02 — Feed and deep links

- **Status:** `completed`
- **Objective:** Let any private-chat user browse eligible cards and open one exact card from the showcase deep link without a profile.
- **Requirements:** `LFR-04`, `LFR-10`; feed/deep-link parts of `LAC-03`, `LAC-08`–`LAC-09`.
- **Dependencies:** `S3-01`.
- **Read first:** PRD §8–§9, §19.1, §20.1; TD §8.5–§8.6, §9.12, §10.6 and §22 S3; current publication renderer/repositories/runtime.
- **Scope:** Add immutable `published_at`, a 24-hour current browse session, three AND filters, stable keyset paging, `/feed`, menu wiring and strict `/start c_<token>` lookup. Keep one card per screen with Apply/Next/Filters/Reset actions.
- **Do not touch:** applications, decisions, contact identity, analytics/view events or long-term browse history.
- **Invariants:** Feed/deep link are read-only; own/non-published/expired cards are not actionable; malformed/unknown/hidden tokens disclose no internal data; public token never grants mutation authority.
- **Tests first:** migration/backfill, filter matrix, stable ordering/cursor/reset/TTL/restart, own/status/deadline exclusions, deep-link availability matrix and duplicate callbacks.
- **Verification:** focused browse unit/SQLite/fake tests, migration fresh/upgrade, `pnpm db:verify`, `pnpm check`, fake E2E, diff/secret scans.
- **Exit criteria:** A user without a profile can browse and open the exact public card; one commit `S3-02: browse cards by feed and deep link`.
- **Evidence:**
  - Commit SHA: `SELF` — local commit subject: `S3-02: browse cards by feed and deep link`.
  - Changed files: `migrations/0009_s3-02-browse.sql`, `src/application/ports/collaboration-browse-repository.ts`, `src/application/collaborations/collaboration-browse-service.ts`, `src/infrastructure/database/collaboration-browse-repository.ts`, `src/infrastructure/database/collaboration-publication-repository.ts`, `src/infrastructure/database/drizzle-schema.ts`, `src/bot/profile-bot.ts`, `src/runtime/bot-runtime.ts`, `test/integration/s2-02-publication.test.ts`, `test/integration/s3-02-browse.test.ts`, `test/e2e-fake/s3-02-browse-bot.test.ts`, and this plan evidence; 11 source/test/migration files, within the bounded-unit limit.
  - Tests first: focused red proved migration `0009`, `published_at`, browse repository/service and runtime handlers were absent, while the existing publication test still expected migrations only through `0008`. The final focused publication/browse/fake suite is PASS — `11 passed`.
  - Aggregate checks: `pnpm check` PASS — unit `31`, integration `49`, runtime `30`, build; `pnpm test:e2e:fake` PASS — `7`; `pnpm db:verify` PASS; `git diff --check` PASS; credential-shaped secret scan PASS with only the literal local `fake-token` fixture.
  - Migration/publication evidence: fresh schema and `0008→0009` upgrade add immutable first-known-success `published_at`, stable feed index and one bounded browse session. Backfill follows authoritative successful publication rows, including a card already `expired`; failed publication remains `NULL`. Profile/platform/topic/card/publication IDs and values, active-profile index and foreign keys survive migration and close/reopen. New on-time and late known-success publication paths preserve the durable Telegram outcome timestamp; pre-send deadline expiry does not fabricate it.
  - Browse/deep-link evidence: three nullable filters compose with AND, target type includes exact plus `any`, format is exact, topic uses membership, and keyset order is `published_at DESC, id DESC`. Own, hidden, non-published and past-deadline cards are excluded; deadline equality remains eligible. Current cursor/filter state survives restart, reset restarts the filtered result, and 24-hour expiry physically removes inactive state through bounded cleanup. Random generation plus revision-bound compact callbacks reject stale buttons even after cleanup and clock rollback while remaining within Telegram's 64-byte limit.
  - Runtime/privacy evidence: `/feed`, menu and strict `/start c_<22-char-token>` are wired through the real runtime; browsing and exact-card deep links work without a profile. Malformed, unknown and hidden tokens share a neutral response, terminal cards expose only a safe public status, and token/UUID/internal state is absent from rendered cards. A selected feed row is rechecked with the canonical visibility predicate immediately before render; a concurrently hidden row and any stale replacement are skipped with persisted cursor advancement.
  - Review/deviations: the independent critical review initially found successful-expired backfill, physical TTL cleanup, pre-render revalidation and upgrade-preservation gaps. One consolidated fix wave added those contracts plus generation-bound ABA protection; closure review returned `COMMIT-READY` with no remaining correctness, privacy, scope or preservation blocker. Apply remains a safe S3-02 placeholder for S3-03; no application, decision, contact, analytics or long-term history state was introduced. No dependencies changed, and no real Telegram, credentials, private database, network, bot process, remote, push, PR or deploy was used.
- **Stop conditions:** Stable public lookup requires application or analytics state, token privacy cannot be preserved, or unit boundary is exceeded.

#### S3-03 — Resumable application submission

- **Status:** `completed`
- **Objective:** Let a user with a full or quick profile submit exactly one durable application and notify the author after commit.
- **Requirements:** `LFR-01`, `LFR-05`, `LFR-10`–`LFR-11`; `LAC-03`, `LAC-06`, `LAC-08`–`LAC-09`.
- **Dependencies:** `S3-02`.
- **Read first:** PRD §7, §9–§10.2, §19.1, §20.1; TD §8.7, §9.2, §10.3 and §22 S3; profile continuation, durable command and outbox contracts.
- **Scope:** Add applications and `first_application_at`; extend profile continuation with typed target/source and `application_message`; implement quick `type → display_name → platform`, guard rerun, atomic submit and one safe author-DM intent. Extend feed exclusions for full/already-applied cards.
- **Do not touch:** withdraw, decisions, contact identity, deadline runner, recommendations or product-event emission.
- **Invariants:** Every application references one active profile; quick flow stores no placeholders/application text; cancel creates no application; submit atomically writes application/first timestamp/outbox; duplicate command creates no second effect; Telegram delivery occurs after commit.
- **Tests first:** full-profile bypass, quick happy path/Back/Cancel/restart, stale target after profile creation, own/type/status/deadline/full/duplicate guards, atomic outbox and failed/ambiguous DM independence.
- **Verification:** focused application unit/SQLite/fake tests, migration fresh/upgrade, `pnpm db:verify`, `pnpm check`, fake E2E, diff/secret scans.
- **Exit criteria:** `LAC-03` passes from deep link without a pre-existing profile; one commit `S3-03: submit resumable applications`.
- **Evidence:**
  - Commit SHA: `SELF` — local commit subject: `S3-03: submit resumable applications`.
  - Changed files: `migrations/0010_s3-03-applications.sql`, `src/application/applications/application-service.ts`, `src/application/ports/profile-session-repository.ts`, `src/infrastructure/database/profile-session-repository.ts`, `src/infrastructure/database/collaboration-browse-repository.ts`, `src/infrastructure/database/drizzle-schema.ts`, `src/bot/profile-bot.ts`, `src/runtime/bot-runtime.ts`, `test/unit/s3-03-application.test.ts`, `test/integration/s3-03-application.test.ts`, `test/e2e-fake/s3-02-browse-bot.test.ts`, `test/integration/s2-02-publication.test.ts`, and this plan evidence; exactly 12 source/test/migration files, within the bounded-unit limit.
  - Tests first: the initial unit RED failed on the absent application use case; SQLite RED failed all `8` scenarios on missing migration `0010`; fake RED failed all `5` browse/application journeys on the absent source-tagged callbacks and resumable flow. The final focused application/browse/session/fake suite is PASS — `25 passed`.
  - Aggregate checks: `pnpm check` PASS — unit `34`, integration `57`, runtime `30`, build; `pnpm test:e2e:fake` PASS — `11`; `pnpm db:verify` PASS; `git diff --check` PASS; credential-shaped scan found only configured environment key names plus explicit local/privacy fixtures such as `fake-token` and `private_handle`, with no credential value.
  - Migration/persistence evidence: fresh schema and populated `0009→0010` upgrade add immutable non-negative `first_application_at`, bounded/unique/FK-backed applications and applicant/card/status indexes. Profile/platform/topic/card/publication/browse IDs and values survive upgrade and close/reopen; `foreign_key_check` stays empty. Submission fields are immutable, decision coherence is enforced, and deadline equality remains eligible.
  - Atomicity/privacy evidence: the existing outer durable Telegram transaction owns receipt/update claim, application, first timestamp, session deletion and exactly one author-DM intent. Injected outbox failure rolls all five surfaces back; replay and a second update create no duplicate. The DM renderer copies an explicit public-profile allowlist, omits absent enrichment and never receives/stores Telegram username, Telegram user ID, platform chat ID, profile IDs or callback data; failed and ambiguous delivery leave the authoritative application `pending`.
  - Runtime evidence: full profiles go directly to `application_message`; deep-link quick mode persists only `type → display_name → platform`, creates a real minimal active profile, reruns current target/type/deadline/capacity/duplicate guards and never stores application text in session/receipt. Revision-bound Back/Cancel survive restart; before profile save they create neither profile nor application, while after save they preserve the profile without creating an application. Feed and pre-render revalidation exclude own, already-used, full, expired and unavailable cards through one SQL predicate; feed/deep-link callbacks preserve exact `feed`/`deep_link` continuation source.
  - Review/deviations: final unit diff inspection found no scope expansion into withdraw, decisions, contacts, analytics, deadline runner or product events. Application rendering intentionally cannot prevent a candidate from voluntarily typing identity into free text; the system itself adds no private identity. No dependencies changed, and no real Telegram, credentials, private database, network, bot process, remote, push, PR or deploy was used. The single independent stage-final critical review remains reserved for the completed S3 candidate after S3-04.
- **Stop conditions:** Safe continuation cannot survive restart, atomicity needs Telegram inside SQLite transaction, profile/target privacy cannot be preserved, or unit boundary is exceeded.

#### S3-04 — Decisions, capacity and pair contacts

- **Status:** `completed`
- **Objective:** Let the author decide pending applications, close capacity and let only each accepted pair open a current Telegram contact action.
- **Requirements:** `LFR-06`–`LFR-08`, `LFR-10`–`LFR-11`; `LAC-04`–`LAC-06`, `LAC-08`–`LAC-09`.
- **Dependencies:** `S3-03`.
- **Read first:** PRD §10–§11, §19.1, §20.1; TD §8.7, §9.4–§9.6, §10.4 and §22 S3; callback-action, publication projection, outbox and Telegram-user lookup contracts.
- **Scope:** Add `matched_at`; serialized accept/reject/manual close; slot and pending-close guards; durable DM/showcase intents; author management and own applications; actor-bound decision tokens; username then user-ID Telegram action.
- **Do not touch:** withdraw, completion/reminders, deadline runner, block/unblock, automatic phone request, request-contact handshake or in-bot relay.
- **Invariants:** Accepted never exceeds slots; last slot/manual close produces authoritative matched state and closes remaining pending; outbound failure never rolls back business state; contact is recomputed from current identity and visible only to the exact accepted pair.
- **Tests first:** accept/reject/replay, concurrent last slot, manual close, failed/ambiguous DM/showcase edit, authoritative lists, foreign/stale callbacks, username/user-ID/fail-closed matrix and multi-slot pair isolation.
- **Verification:** focused unit/SQLite/fake tests, migration fresh/upgrade, core fake journey, `pnpm db:verify`, `pnpm check`, diff/secret scans and one stage-final critical review; real two-account checkpoint remains separately authorized.
- **Exit criteria:** `LAC-04`–`LAC-06` and the core fake journey pass; one commit `S3-04: decide applications and reveal pair contacts`.
- **Evidence:**
  - Commit SHA: `SELF` — local commit subject: `S3-04: decide applications and reveal pair contacts`.
  - Changed files: `migrations/0011_s3-04-application-decisions.sql`, `src/application/applications/application-service.ts`, `src/application/outbox/delivery-payload.ts`, `src/bot/profile-bot.ts`, `src/infrastructure/database/collaboration-browse-repository.ts`, `src/infrastructure/database/drizzle-schema.ts`, `src/runtime/bot-runtime.ts`, `test/unit/s3-04-application-decision.test.ts`, `test/integration/s3-04-application-decision.test.ts`, `test/e2e-fake/s3-02-browse-bot.test.ts`, `test/integration/s2-02-publication.test.ts`, `test/integration/s3-03-application.test.ts`, and this plan evidence; exactly 12 source/test/migration files, within the bounded-unit limit.
  - Tests first: the initial focused RED produced the expected `18` failures for the absent `0011` schema, decision/capacity use case, callback routing, persisted views and pair-contact behavior while the five pre-existing browse/application fake journeys stayed green. The final focused unit/SQLite/fake gate is PASS — `3` files and `28` tests.
  - Aggregate checks: Node `v24.18.0` and pnpm `11.15.1`; `pnpm check` PASS — unit `41`, integration `69`, runtime `30`, build; separate `pnpm test:e2e:fake` PASS — `15`; `pnpm db:verify` PASS; `git diff --check` PASS; credential-shaped secret scan PASS with only repository-owned configuration names and explicit fake/privacy fixtures.
  - Migration/persistence evidence: fresh schema and populated `0010→0011` upgrade add `matched_at`, backfill valid legacy matched/completed rows, enforce application decision/capacity/author invariants and preserve profile/platform/topic/card/publication/application IDs, active-profile uniqueness and all foreign keys through close/reopen. Existing migrations were not rewritten.
  - Decision/delivery evidence: serialized accept/reject/manual close prevents last-slot overflow, closes only the required pending set, records immutable decision metadata and increments authoritative projection revision on every slot/status change. Last-slot and manual close notify every accepted pair and closed pending candidate. DM/showcase intents are atomic with the business mutation; insertion failure rolls the transaction back, while failed/ambiguous provider outcomes leave persisted decisions authoritative. Older prepared or retryable projection edits are superseded before replacement and again before every runtime claim; the dispatch-then-retry race and replacement rollback have dedicated SQLite regressions.
  - Runtime/privacy evidence: actor-bound hashed `cb_*` decisions enter before the generic external update wrapper and replay without nested `in_progress` receipts or duplicate effects. Author management and `Мои отклики` read persisted statuses. Only the exact accepted pair gets a freshly computed `https://t.me/<username>` or `tg://user?id=<positive-decimal-id>` action; missing/corrupt identity fails closed and multi-slot partners cannot see one another. Delivery payload v1 accepts only the compatible URL allowlist and cannot persist callback data.
  - Stage gate/review: one real-runtime fake journey creates the author profile and two-slot card, delivers exactly one showcase publication, creates three quick-profile applications from the deep link, rejects one, accepts two through last-slot `matched`, delivers the matched edit, verifies pair contacts/own lists and survives restart without duplicate state. The independent critical review initially found completion-notification, stale-projection and whole-journey blockers; one consolidated fix wave closed them, including the pre-claim in-flight retry fence found during final self-review. The same reviewer returned `PASS` on the final candidate; no credential/private-contact exposure, authoritative corruption, duplicate business effect, broken core journey or unrunnable-stage blocker remains.
  - Boundaries: no dependencies changed and no withdraw, deadline runner, completion/reminders, moderation/blocking, analytics, recommendations, phone request, contact handshake or in-bot relay was added. No real Telegram, credentials, private database, network, bot process, remote, push, PR or deploy was used. The separately authorized real two-account Telegram checkpoint remains unperformed.
- **Stop conditions:** Capacity/privacy/fallback cannot be proven, implementation requires Later lifecycle or real Telegram for local acceptance, or unit boundary is exceeded.

#### S3-C1 — Real-checkpoint collaboration card rendering correction

- **Status:** `completed`
- **Objective:** Replace internal enum values with PRD display labels in bot/channel cards and make durable Telegram send/edit render the card's escaped HTML markup.
- **Dependencies:** `S3-04`; separately authorized S3 real Telegram checkpoint exposed the defect.
- **Scope:** Collaboration renderer, grammY delivery transport, focused regression tests and this evidence entry.
- **Do not touch:** Feed delivery semantics, recommendation/push behavior, card lifecycle, schema, credentials, bot/channel identity or S4 scope.
- **Invariants:** Deep links open exactly the selected card; feed remains user-requested and keyset-based; user-authored card/application/profile text stays HTML-escaped; delivery effects continue through the existing outbox.
- **Verification:** focused unit RED/GREEN, `pnpm check`, separate `pnpm test:e2e:fake`, `pnpm db:verify`, diff/secret scan and restart of the already authorized real S3 runtime.
- **Evidence:**
  - Commit SHA: `SELF` — local commit subject: `S3-C1: render readable collaboration cards`.
  - Changed files: `src/application/collaborations/collaboration-renderer.ts`, `src/infrastructure/telegram/grammy-telegram-transport.ts`, `test/unit/s2-01-collaboration-domain.test.ts`, `test/unit/s2-02-telegram-transport.test.ts`, and this plan.
  - Tests first: focused RED proved raw `joint_giveaway`/`blogger`/topic values and missing Telegram HTML parse mode; focused GREEN is `2` files and `5` tests.
  - Aggregate checks: Node `v24.18.0`, pnpm `11.15.1`; `pnpm check` PASS — unit `42`, integration `69`, runtime `30`, build; separate `pnpm test:e2e:fake` PASS — `15`; `pnpm db:verify` PASS.
  - Acceptance evidence: all collaboration format, target-profile and topic enums render through the canonical Russian labels; HTML-sensitive user input remains escaped; durable sends/edits explicitly use Telegram HTML mode; no automatic card delivery, feed behavior or database state was added.
- **Stop conditions:** Fix requires a feed-policy change, schema migration, direct Telegram mutation outside the outbox or unescaped user content.

#### S3-C2 — Explicit personal Telegram platform opt-in

- **Status:** `completed`
- **Objective:** Let a user deliberately use the current public Telegram username as the required public platform without automatically exposing service identity.
- **Dependencies:** `S3-C1`; user-approved product amendment during the separately authorized S3 real checkpoint.
- **Scope:** PRD/Technical Design privacy clarification, profile wizard opt-in, ordinary/quick-flow fake regressions and this evidence entry.
- **Do not touch:** Automatic username publication, decimal Telegram ID visibility, post-match contact calculation, profile schema, feed/application policy or S4 scope.
- **Invariants:** The username comes only from the current actor update and never from callback data; the button is absent without a valid username; a forged/stale/foreign action cannot create a platform; `telegram_user_id` remains private; accepted contact still recomputes current identity independently.
- **Verification:** focused fake RED/GREEN, `pnpm check`, separate `pnpm test:e2e:fake`, `pnpm db:verify`, diff/secret scan and restart of the already authorized real S3 runtime.
- **Evidence:**
  - Commit SHA: `SELF` — local commit subject: `S3-C2: opt in personal Telegram profile`.
  - Changed files: `docs/PRD.md`, `docs/TECHNICAL_DESIGN.md`, `src/bot/profile-bot.ts`, `test/e2e-fake/s1-02-profile-bot.test.ts`, `test/e2e-fake/s3-02-browse-bot.test.ts`, and this plan.
  - Tests first: focused RED proved the personal username button and missing-username fail-closed response were absent; focused GREEN covers ordinary selection, quick-flow persistence and quick-flow no-username forgery in `2` files and `15` tests.
  - Aggregate checks: Node `v24.18.0`, pnpm `11.15.1`; `pnpm check` PASS — unit `42`, integration `69`, runtime `30`, build; separate `pnpm test:e2e:fake` PASS — `18`; `pnpm db:verify` PASS.
  - Acceptance evidence: the platform prompt explicitly states pre-accept visibility; a valid current username renders `Использовать @username`; the revision-bound callback contains only `self`, persists canonical `https://t.me/<username>` after the click and advances both ordinary and quick flows through their existing paths. Without username the button is absent, a forged action preserves the platform step and creates no profile.
- **Stop conditions:** Implementation requires implicit consent, username in callback data, public Telegram ID, schema migration or weakening pairwise contact authorization.

### S4 — Shareable launch

#### S4-01 — Simple admin hide, real smoke and shareable handoff

- **Status:** `completed`
- **Objective:** Add the minimum moderation escape hatch, prove the complete flow and hand the author a bot link that can be shared manually.
- **Requirements:** `LFR-09`; `LAC-07`, `LAC-10`–`LAC-12`.
- **Dependencies:** `S3-C2`.
- **Read first:** PRD §11, §14.2, §15, §19.1 and §20.1; TD §5.1, §8.5, §8.16, §9.10, §11.5, §20.5–§20.6 and §22 S4; current command receipt, browse/application guard, publication and outbox contracts.
- **Preconditions:** clean `main` at unique `S3-C2`; Node `>=24.18.0 <25`; pnpm `>=11.15.1 <12`; no existing `S4-01` commit; no real Telegram, credentials, remote or production action without separate authorization.
- **Scope:** Allowlisted lookup/hide, hide delivery intent, full fake journey, exact bot/channel preflight, separately authorized real journey and concise manual start/stop/restart/database-copy handoff.
- **Do not touch:** restore, block/unblock, cascades, analytics, completion, scheduler, status/heartbeat, backup/LaunchAgent.
- **Invariants:** Non-admin cannot hide; hidden card is absent from feed and rejects applications; contact already revealed is not revoked; Telegram delete failure does not make the card visible in authoritative feed.
- **Tests first:** admin/non-admin, hide active card, failed delete, feed/apply guards, full fake journey and a real-smoke checklist with abort conditions before external mutations.
- **Verification:** focused tests, full fake journey, migrations, `pnpm check`, staged secret scan and one critical review; then, after separate credentials/Telegram authorization, exact identity/channel and full real journey through admin hide and restart.
- **Exit criteria:** `LAC-01`–`LAC-12` pass at their applicable local/fake/real evidence level; the author has the exact manual command and may share the bot link; one commit `S4-01: prove shareable collaboration journey`.
- **Evidence:**
  - Commit SHA: `SELF` — local commit subject: `S4-01: prove shareable collaboration journey`.
  - Preflight: `main` at unique `S3-C2` `29d057db9b43958c7b35b7a6a94a3d5dae8a18d8`; cached `origin/main` matched; tree was clean; no existing `S4-01` commit; Node `v24.18.0`; pnpm `11.15.1`.
  - Implementation: additive migration `0012_s4-01-admin-hide.sql`; strict allowlisted `/admin <canonical-link>` and `/admin hide <canonical-link> <reason>`; Telegram admin receipts/replay; atomic hidden overlay, pending-application closure, append-only safe audit and one known-target `channel_delete`; real adapter mapping for already-absent delete targets; foreground/manual stopped-database handoff in `README.md`.
  - Focused checks: S4 integration `8 passed` covers fresh and `0011 → 0012`, legacy-hidden fail-closed guard, five hideable statuses, 1/500 reason boundaries, invalid/non-admin inputs, receipt replay, accepted-decision preservation, append-only audit, rollback, delete not-found and fifth-attempt permanent failure; Telegram transport `2 passed`; complete shareable and focused admin-hide fake checkpoints `2 passed`.
  - Aggregate checks: `pnpm check` PASS — unit `43`, integration `78`, runtime `30`, build; `pnpm test:e2e:fake` PASS — `19`; `pnpm db:verify` PASS; `git diff --check` PASS; staged credential/logger scan PASS.
  - Acceptance evidence: `LAC-01`–`LAC-11` pass at their applicable local/fake level. The full fake flow creates the author/profile/card, publishes, creates three quick-profile applications, exercises reject and accept/contact branches, shows own lists, hides a matched card, dispatches one channel delete and preserves accepted contact plus audit/status across restart. Hidden feed/deep-link/apply guards and delete-failure authority are separately asserted.
  - Real preflight: after explicit authorization, the private ignored `.runtime/bot.env` remained mode `0600`; stopped SQLite `quick_check` returned `ok`, a private stopped-state copy was created, and migration `0012` applied without legacy hidden rows. Bot `@davay_vmeste_bot` and channel `@davay_vmeste_collab` matched the configured identities exactly; the target was a channel and the bot had post, edit and delete rights. The initially stale admin allowlist matched no known account; the user-designated `@ChDenis` identity was applied only to ignored runtime config, then verified by non-admin-before/admin-after behavior without recording a numeric ID, token or reason here.
  - Real journey / `LAC-12`: `@ChernykDenis` created the meaningful blogger profile `Денис — городские проекты` and published `Осенний гид по локальным местам Екатеринбурга`; `@ChDenis` opened the showcase deep link, created a minimal profile, applied with a scenario-specific proposal, and observed pending status. The author accepted the application; both own lists showed the authoritative matched/accepted result and the applicant received the Telegram contact action. Allowlisted lookup returned the matched card, hide overlaid `hidden` from `matched`, preserved the accepted application/contact, appended exactly one audit row and delivered exactly one known-target `channel_delete` in one attempt. A fresh channel view retained earlier content but no longer contained this post.
  - Restart persistence: graceful stop produced `quick_check = ok`; the final foreground restart emitted `runtime_ready` and `poll_started`. After reopening SQLite, migration `12`, `hidden` from `matched`, accepted application, one audit row and sent delete intent remained authoritative. Telegram again returned a neutral hidden deep-link response; applicant own list/contact and author hidden `1 из 1` view persisted, and a reloaded channel still omitted the deleted post.
  - Review result: independent read-only stage-final review — PASS; no credential/privacy exposure, authoritative-data corruption, duplicate effect, broken core journey, unrunnable stage or Later-scope expansion found. No second review cycle was run.
  - Notes/deviations: no dependencies, Node/pnpm contract, restore, block/unblock, analytics, completion, scheduler, LaunchAgent or automatic backup were added. The real checkpoint used one manual foreground topology and one manual stopped-state SQLite copy; it does not establish hosted availability, 24/7, production readiness or SLA. No credential value, private database, backup, numeric identity, deep-link token or internal moderation reason is committed. No remote, push, PR, merge or deploy was performed.
- **Stop conditions:** Requires block/restore policy, wrong bot/channel identity, missing explicit real-Telegram authorization, non-green local gate or risk to another bot.

### R1 — Post-launch maintainability

- **Status:** `completed` — отдельно авторизованный post-launch stage завершён без расширения продуктового scope.
- **Objective:** Сохранить доказанное внешнее поведение, но сделать ownership feature-кода, import graph, Telegram presentation, runtime lifecycle, test seams и persistence-модель явными и независимо проверяемыми.
- **Requirements:** неизменные `LFR-01`–`LFR-11`, `LAC-01`–`LAC-12`; TD §2.1, §4, §7, §10, §13, §20.
- **Dependencies:** `FUT-01` completed на `32441e59510a79852aceb47a73ca5338fa529e4c`.
- **Stage invariants:** неизменные команды, callback/deep-link payloads, пользовательские тексты, SQLite schema/migration history, idempotency/receipt/outbox semantics, contact privacy, один process и одна SQLite; Bot API только после commit.
- **Stage exclusions:** NestJS, Prisma, Redis/BullMQ, scheduler, heartbeat, cleanup, backup/LaunchAgent, generic shared package, credentials, real Telegram, remote/push/PR/merge/deploy.
- **Stage gate:** `pnpm architecture`, `pnpm check`, `pnpm test:e2e:fake`, `pnpm db:verify`, `git diff --check`, staged secret scan и один независимый critical review.

#### R1-00 — Define the post-launch maintainability stage

- **Status:** `completed`
- **Objective:** Зафиксировать decision-complete unit order до runtime/source изменений.
- **Requirements:** правила исполнения этого плана; TD §2.1, §4, §7, §10, §13, §20.
- **Dependencies:** `FUT-01` completed.
- **Read first:** `AGENTS.md`; PRD §19.1, §20.1; TD §2.1–§2.4, §4, §7, §10, §13, §20, §22.1; deferred-capabilities document; этот план.
- **Preconditions:** `main` и `origin/main` на `32441e59510a79852aceb47a73ca5338fa529e4c`; clean tree; Node `v24.18.0`; pnpm `11.15.1`.
- **Scope:** только этот план; определить R1 units, ordering, invariants, checks и stop conditions.
- **Do not touch:** source, tests, migrations, dependencies, PRD/TD, runtime, Telegram или данные.
- **Invariants:** один stage/один current unit; каждый implementation unit имеет отдельный commit и ограниченный diff; schema-validator остаётся решением stage gate, а не автоматически добавленной зависимостью.
- **Tests first:** документарный audit source precedence, live statuses, exact predecessor и deferred boundary.
- **Verification:** `pnpm check`; `pnpm db:verify`; `git diff --check`; exact changed-file check.
- **Exit criteria:** R1 и все cards описаны; один commit `R1-00: define post-launch maintainability stage`; clean tree; `R1-01` становится current unit.
- **Completion evidence:** Commit SHA: `SELF`; changed only `IMPLEMENTATION_PLAN.md`; preflight confirmed clean `main`/`origin/main` at `32441e59510a79852aceb47a73ca5338fa529e4c`, Node `v24.18.0`, pnpm `11.15.1`; `pnpm check` PASS (61 unit, 80 integration, 30 runtime tests and build); `pnpm db:verify` PASS; `git diff --check` and exact changed-file check PASS; no source, test, migration, dependency, credential, Telegram, remote or production mutation.
- **Stop conditions:** PRD/TD требуют нового продуктового решения или requested order нельзя разделить без нарушения внешнего контракта.

#### R1-01 — Replace regex import checks with an import-graph gate

- **Status:** `completed`
- **Objective:** Проверять реальные import edges, cycles и направления слоёв вместо чтения source регулярным выражением.
- **Requirements:** TD §4, §20.1, §22.1.
- **Dependencies:** `R1-00`.
- **Read first:** текущие package/TS/ESLint configs; `test/unit/s0-04-import-boundary.test.ts`; starter `.dependency-cruiser.cjs` только как reference.
- **Preconditions:** exact predecessor `R1-00`; Node/pnpm contract подтверждён перед dependency change.
- **Scope:** `dependency-cruiser` dev dependency; минимальная project-owned config; `pnpm architecture`; policy fixtures для current layer-first и будущего `src/modules/<feature>/<layer>` layout; aggregate gate; минимальное устранение type-only cycle, впервые обнаруженного новым gate.
- **Do not touch:** runtime, product services, SQL/migrations, Telegram behavior.
- **Invariants:** запреты соответствуют текущему TD; domain не импортирует application/infrastructure/presentation/runtime; application не импортирует infrastructure/presentation/runtime; нет circular/unresolvable imports; будущие module-local слои не теряют enforcement.
- **Tests first:** fixture, которая проходит корректный graph и падает на domain→infrastructure и application→runtime.
- **Verification:** focused policy test; `pnpm architecture`; `pnpm check`; `pnpm db:verify`; diff/secret scans.
- **Exit criteria:** regex-test заменён executable import-graph policy; один commit `R1-01: enforce architectural import graph`.
- **Completion evidence:** Commit SHA: `SELF`; added `dependency-cruiser@18.1.0`, `.dependency-cruiser.cjs`, `pnpm architecture`, three executable policy fixtures and `product-event-contracts.ts`; removed the previous source-regex implementation. Initial real graph found `product-event-service → product-event-store → product-event-service`; shared event types/constants moved to the neutral application contract without runtime behavior changes or an allowlist. Focused policy/contracts tests PASS (7); architecture PASS (93 modules, 262 dependencies); `pnpm check` PASS (63 unit, 80 integration, 30 runtime tests and build); `pnpm db:verify` PASS; diff/secret scans PASS. Context7 was quota-blocked; configuration was checked against official dependency-cruiser rule/CLI documentation and the installed `18.1.0` reference config. No SQL, migration, Telegram, credential, remote or production mutation.
- **Stop conditions:** несовместимая toolchain dependency, undocumented live edge требует решения, или gate зелёный только с broad allowlist.

#### R1-02 — Split the applications application boundary

- **Status:** `completed`
- **Objective:** Выделить use cases и consumer-oriented ports для submit, decisions, recruitment, contacts и read queries.
- **Requirements:** TD §4–§5, §9.2–§9.6; `LFR-05`–`LFR-08`, `LAC-03`–`LAC-06`.
- **Dependencies:** `R1-01`.
- **Read first:** application service, focused unit/integration tests, callback and outbox contracts.
- **Preconditions:** architecture gate покрывает `src/modules/**`.
- **Scope:** pilot `src/modules/applications/application`; узкие ports/use cases; временный совместимый feature API для текущих callers; без SQL-переноса.
- **Do not touch:** repositories/SQL, bot routing, runtime lifecycle, schema/migrations, copy или callback encoding.
- **Invariants:** exact result unions, transaction/outbox atomicity, idempotency keys, capacity guards и contact privacy сохраняются.
- **Tests first:** focused consumer-port/use-case test, затем существующие S3-03/S3-04 tests.
- **Verification:** focused unit/integration; architecture; `pnpm check`; `pnpm test:e2e:fake`; `pnpm db:verify`; diff/secret scans.
- **Exit criteria:** каждый applications workflow зависит только от нужного порта; один commit `R1-02: split applications use-case boundaries`.
- **Completion evidence:** Commit SHA: `SELF`; replaced the 996-line implementation at the legacy `application-service.ts` path with a compatibility barrel and split contracts, policy, submission, decisions/recruitment, read queries and the temporary feature facade under `src/modules/applications/application`; added one consumer-port characterization test. The implementation changed eight source/test files and this plan; repositories/SQL, runtime, bot routing, migrations/schema, copy and callback encoding stayed untouched. Focused R1-02/S3-03/S3-04 unit and integration tests PASS (5 files, 33 tests); architecture PASS (99 modules, 289 dependencies); `pnpm check` PASS (66 unit, 80 integration, 30 runtime tests and build); `pnpm test:e2e:fake` PASS (21); `pnpm db:verify` PASS; `git diff --check` PASS. Independent read-only review compared the split with `HEAD`, confirmed old import-path/API compatibility plus unchanged transactions, delivery ordering/idempotency, capacity/stale guards, projection revision, contact privacy and read-model sanitization, and returned PASS with no findings. No credential, Telegram, remote or production mutation.
- **Stop conditions:** требуется изменить product/outbox contract, добавить generic abstraction без второго consumer или выйти за unit boundary.

#### R1-03 — Give applications feature-owned SQLite composition

- **Status:** `completed`
- **Objective:** Отделить application persistence/read models от browse adapter и подключить feature через одну composition factory.
- **Requirements:** TD §4.2–§4.3, §7, §9.2–§9.6.
- **Dependencies:** `R1-02`.
- **Read first:** collaboration browse/application repository, S3-02/S3-03/S3-04 integration tests, runtime composition.
- **Preconditions:** узкие applications ports стабильны.
- **Scope:** feature-owned SQLite applications adapter(s), composition factory и public feature contract; browse сохраняет только собственные queries/filtering.
- **Do not touch:** migrations/schema, query policy, Telegram presentation, runtime lifecycle.
- **Invariants:** тот же `DatabaseBoundary`; SQL predicates/order/affected-row guards/mappers и transaction context неизменны; business state и delivery intents атомарны.
- **Tests first:** characterize browse/application ownership and concurrent last-slot behavior before cutover.
- **Verification:** S3-02/S3-03/S3-04 integration; architecture; `pnpm check`; fake journey; `pnpm db:verify`; diff/secret scans.
- **Exit criteria:** browse adapter больше не реализует applications store; runtime получает feature composition; один commit `R1-03: own application persistence by feature`.
- **Completion evidence:** Commit SHA: `SELF`; extracted all applications store/read-model methods and mappers into feature-owned `SqliteApplicationsRepository`, reduced `SqliteCollaborationBrowseRepository` to browse session/query/filter responsibilities, added the public `ApplicationsFeatureApi` entrypoint and `createApplicationsFeature`, and changed runtime/test composition to use the factory. Nine source/test files plus this plan changed; migrations/schema, product policy, Telegram routing/copy/encoding and runtime lifecycle logic stayed untouched. Pre-cutover concurrent last-slot characterization PASS; focused R1-03/S3-02/S3-03/S3-04 integration PASS (4 files, 27 tests); architecture PASS (102 modules, 300 dependencies); `pnpm check` PASS (66 unit, 81 integration, 30 runtime tests and build); `pnpm test:e2e:fake` PASS (21); `pnpm db:verify` PASS; `git diff --check` PASS. Independent read-only review verified the moved 33 repository method bodies and nine mapper/helper bodies against predecessor `f35741e`, confirmed unchanged SQL predicates/parameters/order/affected-row guards, one shared `DatabaseBoundary`/transaction runner, the same stale-projection position in the delivery cycle and legacy import compatibility, and returned PASS with no findings. No credential, Telegram, remote or production mutation.
- **Stop conditions:** нужна migration, query ownership неоднозначен или перенос меняет SQL semantics.

#### R1-04 — Establish a single durable grammY ingress seam

- **Status:** `completed`
- **Objective:** Сохранить один receipt/transaction envelope и дать feature composers безопасную точку подключения.
- **Requirements:** TD §4.1, §10.1–§10.4; `LFR-10`, `LAC-08`.
- **Dependencies:** `R1-03`.
- **Read first:** root bot registration, durable reply collector, callback executor, fake Telegram tests.
- **Preconditions:** applications feature API не требует concrete service type.
- **Scope:** root ingress shell/router и focused characterization test; `cb_*` остаётся отдельным callback-action path; другие updates проходят `runDurable` ровно один раз.
- **Do not touch:** product policy, copy/keyboards, callback/session formats, Bot API transport или runtime lifecycle.
- **Invariants:** replies/callback ack отправляются после commit; actor binding и replay сохраняются; один update достигает ровно одного feature route.
- **Tests first:** duplicate update, opaque callback и post-commit reply routing tests.
- **Verification:** focused fake tests; all e2e-fake; architecture; `pnpm check`; diff/secret scans.
- **Exit criteria:** feature middleware может работать на durable proxy context; один commit `R1-04: establish durable Telegram routing seam`.
- **Completion evidence:** Commit SHA: `SELF`; added a root grammY ingress router, mounted the existing message/callback logic as two terminal Composer middlewares on the durable proxy context, and kept `cb_*` on its existing callback-action executor without an outer receipt/transaction envelope. Four source/test files plus this plan changed; `runDurable`, `ReplyCollector`, `handleOpaqueCallback`, runtime, SQL, applications, copy, keyboards and callback codecs stayed unchanged. Test-first RED was the missing ingress module; focused ingress/profile/opaque fake tests PASS (3 files, 19 tests); all fake E2E PASS (4 files, 22 tests); architecture PASS (103 modules, 303 dependencies); `pnpm check` PASS (66 unit, 81 integration, 30 runtime tests and build); `git diff --check` PASS. Independent read-only review verified mutually exclusive routing, one durable call for generic updates, `cb_*` bypass, terminal `next`, canonical-input parity and production post-commit reply/ack behavior, and returned PASS with no findings. No credential, real Telegram, remote or production mutation.
- **Stop conditions:** middleware ordering меняет replay/ack или нужен новый context framework.

#### R1-05A — Extract the profile Telegram composer

- **Status:** `completed`
- **Objective:** Передать profile wizard/render/session routing feature-owned presentation без изменения quick-profile continuation.
- **Requirements:** `LFR-01`, `LAC-01`, `LAC-03`; TD §10.3, §10.5.
- **Dependencies:** `R1-04`.
- **Read first:** profile bot handlers, profile session contracts, profile fake journeys.
- **Preconditions:** durable ingress seam proven.
- **Scope:** profile composer и его presentation helpers; root монтирует composer.
- **Do not touch:** profile use-case policy, persistence, copy, callbacks, config/runtime.
- **Invariants:** command-before-session routing, Back/Cancel/restart, channel picker/fallback и explicit personal Telegram opt-in неизменны.
- **Tests first:** ordinary profile and quick-profile continuation characterization.
- **Verification:** focused profile fake tests; all e2e-fake; architecture; `pnpm check`; diff scan.
- **Exit criteria:** profile handlers принадлежат feature composer; один commit `R1-05A: extract profile Telegram composer`.
- **Completion evidence:** Commit SHA: `SELF`; extracted profile message/callback routing, wizard/session transitions, exact profile copy/keyboards/codecs and profile presentation helpers into a feature-owned Composer, while root keeps global command precedence, collaboration-first `/cancel`, durable ingress, one callback acknowledgement and opaque `cb_*`. Cross-feature create-collaboration and submit-application continuations remain explicit injected hooks; no application policy moved. Four source/test files plus this plan changed; profile persistence/use-case policy, collaboration/application/moderation behavior, runtime/config and SQL stayed untouched. Test-first RED was the missing profile composer module; focused ordinary/quick-profile/collaboration/application fake tests PASS (4 files, 23 tests); all fake E2E PASS (5 files, 24 tests); architecture PASS (105 modules, 316 dependencies); `pnpm check` PASS (66 unit, 81 integration, 30 runtime tests and build); `git diff --check` PASS. Critical self-review found and fixed accidental reachability of malformed/unversioned profile type/platform callbacks; independent read-only review then matched message/callback order, strings/payloads, restart/Back/Cancel, continuations and durable proxy/post-commit behavior and returned PASS with no findings. No credential, real Telegram, remote or production mutation.
- **Stop conditions:** extraction меняет session precedence or public presentation contract.

#### R1-05B — Extract the collaboration Telegram composer

- **Status:** `completed`
- **Objective:** Передать draft/preview/publication routing feature-owned presentation.
- **Requirements:** `LFR-02`–`LFR-03`, `LAC-02`; TD §9.1, §10.3, §11.
- **Dependencies:** `R1-05A`.
- **Read first:** collaboration handlers/renderers/session contracts and fake journeys.
- **Preconditions:** root/profile routing stable.
- **Scope:** collaboration composer и presentation helpers; root монтирует composer.
- **Do not touch:** collaboration policy, repository, publication/outbox semantics, copy/callback encoding.
- **Invariants:** draft resume/back/cancel/preview/publish and known-result delivery behavior unchanged.
- **Tests first:** stale/replayed collaboration callbacks and restart journey.
- **Verification:** focused collaboration fake tests; all e2e-fake; architecture; `pnpm check`; diff scan.
- **Exit criteria:** collaboration handlers принадлежат feature composer; один commit `R1-05B: extract collaboration Telegram composer`.
- **Completion evidence:** Commit SHA: `SELF`; extracted collaboration command/session/callback routing, draft/preview/publish presentation, exact copy/keyboards/codecs and own-publication summaries into a feature-owned Composer. Root preserves global precedence, collaboration-first `/cancel`, profile-before-collaboration session routing, durable ingress, one callback acknowledgement and opaque `cb_*`; application management remains an injected rendering hook. Four source/test files plus this plan changed; collaboration policy/repositories/outbox, profile/application/moderation behavior, runtime/config and SQL stayed untouched. Test-first RED was the missing collaboration composer module; focused root/profile/collaboration/application fake tests PASS (5 files, 25 tests); all fake E2E PASS (6 files, 26 tests); architecture PASS (107 modules, 329 dependencies); `pnpm check` PASS (66 unit, 81 integration, 30 runtime tests and build); `git diff --check` PASS. Self-review corrected a malformed stale fixture to a syntactically valid foreign generation; independent live-diff review matched strings/literals, replacement-draft protection, publish/error keyboards, profile continuation, known-result and post-commit behavior and returned PASS with no findings. No credential, real Telegram, remote or production mutation.
- **Stop conditions:** extraction changes durable session or publication behavior.

#### R1-05C — Extract marketplace and moderation Telegram composers

- **Status:** `completed`
- **Objective:** Передать feed/deep-link/applications/author-management/moderation routing feature-owned presentation.
- **Requirements:** `LFR-04`–`LFR-09`, `LAC-03`–`LAC-10`; TD §9.2–§9.6, §9.10, §10.6.
- **Dependencies:** `R1-05B`.
- **Read first:** marketplace/moderation handlers, applications API, profile continuation and full fake journey.
- **Preconditions:** profile/collaboration composers stable.
- **Scope:** marketplace/applications and moderation composers; root keeps only global ingress/error/mounting.
- **Do not touch:** product policy, SQL, copy, callback/deep-link encoding, runtime lifecycle.
- **Invariants:** profile continuation handoff, own lists, decisions, pair contacts, admin hide and actor-bound callbacks unchanged.
- **Tests first:** quick-profile resume, stale/foreign callbacks and admin hide routing.
- **Verification:** all e2e-fake; focused application/moderation tests; architecture; `pnpm check`; `pnpm db:verify`; diff/secret scans.
- **Exit criteria:** root registration не содержит feature decisions; один commit `R1-05C: extract marketplace Telegram composers`.
- **Completion evidence:** Commit SHA: `SELF`; extracted feed/deep-link/application/author-management routes and callback codecs into a marketplace Composer, and allowlisted `/admin` routing plus durable actor resolution into a moderation feature. Root registration now owns only global command precedence, feature mounting, durable ingress, post-commit reply collection and the deliberately separate opaque `cb_*` route. Presentation consumes the public `ApplicationsFeatureApi`; quick-profile continuation order, own lists, decisions, pair contacts, admin hide and exact copy/callback encodings remain unchanged. Eight source/test files plus this plan changed; product policy, repositories/SQL, delivery/runtime lifecycle and configuration stayed untouched. Test-first RED was the missing marketplace/moderation feature modules; focused fake journeys PASS (3 files, 22 tests); focused browse/application/moderation composition PASS (5 files, 35 tests); all fake E2E PASS (7 files, 30 tests); architecture PASS (110 modules, 346 dependencies); `pnpm check` PASS (66 unit, 81 integration, 30 runtime tests and build); `pnpm db:verify` PASS; `git diff --check` PASS. Critical self-review confirmed mutually exclusive callback ownership, one generic callback acknowledgement, separate opaque action acknowledgement, admin actor binding before durable execution and unchanged profile continuation order; independent read-only review returned PASS with no findings. No credential, real Telegram, remote or production mutation.
- **Stop conditions:** route ownership requires product change or one update can reach multiple features.

#### R1-06A — Extract the delivery worker lifecycle

- **Status:** `completed`
- **Objective:** Изолировать ordered delivery cycle, wakeable delay и stop-new-work behavior от bot runtime.
- **Requirements:** TD §13.1, §13.4, §20.4; `LFR-11`.
- **Dependencies:** `R1-05C`.
- **Read first:** delivery runner, runtime loop and runtime tests.
- **Preconditions:** presentation no longer changes runtime dependencies.
- **Scope:** `DeliveryWorker.run(signal)`/stop contract and focused tests; exact current cycle order.
- **Do not touch:** second process, scheduler, active provider-call cancellation, retry policy or persistence.
- **Invariants:** recover → terminal projection → expiration → stale projection supersede → delivery; concurrency one; shutdown awaits in-flight run.
- **Tests first:** stop during delay, no overlapping cycles, in-flight completion.
- **Verification:** focused runtime/delivery tests; architecture; `pnpm check`; fake journey; diff scan.
- **Exit criteria:** runtime no longer owns timer loop; one commit `R1-06A: isolate delivery worker lifecycle`.
- **Completion evidence:** Commit SHA: `SELF`; extracted the exact ordered delivery startup/cycle into `DeliveryWorker.run(signal)`: stale recovery, terminal projection, capability-gated expiration, stale application projection supersede, one delivery attempt and a wakeable 250 ms delay. Abort stops only new steps and wakes the delay; an already-started step completes, the signal is deliberately not passed into `DeliveryRunner.runOnce`, and a concurrent second run is rejected. Runtime now performs abort → polling stop → worker join → in-flight update drain → SQLite close. Three source/test files plus this plan changed; `DeliveryRunner`, retry/provider policy, persistence, scheduler, product behavior and configuration stayed untouched. Test-first RED was the missing worker module; focused worker/runtime/delivery tests PASS (3 files, 31 tests); all fake E2E PASS (7 files, 30 tests); architecture PASS (111 modules, 347 dependencies); `pnpm check` PASS (66 unit, 81 integration, 34 runtime tests and build); `pnpm db:verify` PASS; `git diff --check` PASS. Critical self-review and independent read-only review both confirmed exact cycle order, degraded-capability skip, between-step abort checks, in-flight completion, non-overlap and shutdown ordering with no findings. No credential, real Telegram, remote or production mutation.
- **Stop conditions:** implementation requires new scheduler/state or changes delivery semantics.

#### R1-06B — Separate object graph from BotRuntime lifecycle

- **Status:** `completed`
- **Objective:** Сделать composition side-effect free и сузить runtime до start/stop orchestration.
- **Requirements:** TD §3.2, §4.1, §13.4, §20.4.
- **Dependencies:** `R1-06A`.
- **Read first:** bot runtime, composition dependencies, preflight and lifecycle tests.
- **Preconditions:** delivery worker has explicit lifecycle.
- **Scope:** `composeBotApplication`, narrow `BotRuntime`, update drain/close-resources contracts; compatible `createBotRuntime` entrypoint during test cutover.
- **Do not touch:** process signals/env/files, config fields, product policy or runtime topology.
- **Invariants:** migration → identity/channel preflight → recovery/delivery → polling; reverse shutdown; SQLite closes once after in-flight updates.
- **Tests first:** configure-without-start, start failure cleanup and idempotent stop.
- **Verification:** runtime/preflight tests; all e2e-fake; architecture; `pnpm check`; `pnpm db:verify`; diff scan.
- **Exit criteria:** object graph and lifecycle are independent; one commit `R1-06B: separate bot composition and runtime`.
- **Completion evidence:** Commit SHA: `SELF`; extracted synchronous `composeBotApplication` object wiring, a framework-neutral `configure/start/stop` lifecycle and the grammY audience adapter from the compatibility runtime facade. Composition registers the in-memory graph without migration, SQLite/Telegram calls, worker/polling start or resource close. `createBotRuntime` preserves its prepared/not-started contract by awaiting private-path preparation, canonical migrations and exact bot identity before return; it now exposes canonical `stop` while retaining `shutdown` as the same memoized operation. Startup remains migration → identity → showcase preflight → delivery worker invocation → polling; stop remains abort worker → polling stop → worker join → update drain → one SQLite close. Five source/test files plus this plan changed; CLI/process signals, env/filesystem policy, config, product behavior and runtime topology stayed untouched. Test-first RED was the missing composition/lifecycle modules; focused R1-06A/B and existing runtime/preflight tests PASS (4 files, 18 tests); audience adapter tests PASS (1 file, 18 tests); all fake E2E PASS (7 files, 30 tests); architecture PASS (114 modules, 358 dependencies); `pnpm check` PASS (66 unit, 81 integration, 39 runtime tests and build); `pnpm db:verify` PASS; `git diff --check` PASS. Critical self-review and independent read-only review matched middleware/capability/logging wiring, compatibility exports, lifecycle order, failure cleanup, stop/shutdown identity and close-after-drain behavior with no findings. No credential, real Telegram, remote or production mutation.
- **Stop conditions:** lifecycle order/drain cannot be proven or requires Later hardening.

#### R1-06C — Make process/config/filesystem bootstrap thin

- **Status:** `completed`
- **Objective:** Оставить CLI только владельцем process signals и запуска готового runtime.
- **Requirements:** TD §3.2, §13.4, §16, §20.4.
- **Dependencies:** `R1-06B`.
- **Read first:** CLI, env loader/private-path checks and runtime tests.
- **Preconditions:** BotRuntime exposes stable start/stop contract.
- **Scope:** process runner/signal coordinator, env-file loader, private runtime path policy и thin CLI.
- **Do not touch:** config variables, credentials, production files, LaunchAgent or shutdown policy expansion.
- **Invariants:** SIGINT/SIGTERM one-shot shutdown, same exit behavior, env/file permissions and bot identity checks unchanged.
- **Tests first:** signal-before/after-start and config/path failure characterization.
- **Verification:** focused config/runtime tests; architecture; `pnpm check`; fake journey; diff/secret scans.
- **Exit criteria:** CLI has no object graph or filesystem policy; one commit `R1-06C: thin process bootstrap boundaries`.
- **Completion evidence:** Commit SHA: `SELF`; separated private env/database path policy, exact env-file config loading, argument/bootstrap construction and one-shot process signal coordination into focused runtime modules. The CLI now owns only argv, the migrations asset anchor, stdout/stderr, the Node signal adapter and `exitCode`; `bot-runtime.ts` is a one-way compatibility facade preserving all previous exports. Both existing `--env-file` forms, the exact usage and generic failure text, the ten-key env allowlist, private file predicates and absence of `process.exit()` remain unchanged. SIGINT/SIGTERM and final cleanup share one memoized stop promise and remove listeners. A signal during awaited showcase preflight exposed a real lifecycle race; a minimal post-preflight state guard now prevents worker/polling from starting after resources were stopped, without adding a readiness/watchdog or exit policy. Nine source/test files plus this plan changed; config fields, production files, DB CLI, runtime topology and product behavior stayed untouched. Test-first RED covered missing bootstrap/process modules, then focused regression RED reproduced immediate pre-start semantics and the preflight/stop race; focused bootstrap/process/lifecycle/runtime tests PASS (5 files, 22 tests); focused config/audience tests PASS (2 files, 24 tests); all fake E2E PASS (7 files, 30 tests); architecture PASS (118 modules, 366 dependencies); `pnpm check` PASS (66 unit, 81 integration, 47 runtime tests and build); `pnpm db:verify` PASS; `git diff --check` PASS. Self-review and independent read-only review matched arguments, env/path predicates, failure/exit behavior, signal timing, facade exports and one-way dependency direction with no remaining findings. No credential, real Telegram, remote or production mutation.
- **Stop conditions:** requires real process/Telegram or changes externally visible CLI/config contract.

#### R1-07 — Consolidate production-like test support

- **Status:** `completed`
- **Objective:** Убрать повторяемую setup/teardown composition из application, runtime и fake E2E tests.
- **Requirements:** TD §20.2–§20.5; `LAC-09`–`LAC-11`.
- **Dependencies:** `R1-06C`.
- **Read first:** current temporary DB, runtime and fake Telegram fixtures.
- **Preconditions:** production composition/lifecycle seams stable.
- **Scope:** local `test/support` helpers для fresh migrated SQLite, applications composition, fake runtime и Telegram update/assertion builders; минимум три реальных consumers.
- **Do not touch:** production test hooks, Testcontainers, hidden global setup, singleton DB or fake/real evidence boundary.
- **Invariants:** fresh temporary DB per test, real migrations, explicit cleanup/restart semantics and distinct FakeTelegramApi/FakeTelegramTransport.
- **Tests first:** repeated fixture run and failure-path cleanup.
- **Verification:** migrated suites separately/together; all e2e-fake; `pnpm check`; `pnpm db:verify`; architecture; diff scan.
- **Exit criteria:** duplicated setup заменён общими helpers с несколькими consumers; один commit `R1-07: consolidate production-like test support`.
- **Completion evidence:** Commit SHA: `SELF`; added four local test-support boundaries for fresh migrated SQLite, production `createApplicationsFeature` composition, canonical prepared/not-started fake bot runtime and explicit Telegram update/callback builders. A focused helper test proves independent repeated databases, all 13 canonical migrations and close/remove cleanup on callback failure; construction is inside the cleanup guard so constructor/migration failures also remove the temporary directory. Six real integration/runtime/fake suites now consume the helpers, each helper has at least two consumers, and explicit start/stop/restart remains visible in tests. `FakeTelegramApi` remains the grammY/Bot HTTP fake and was not merged with the port-level `FakeTelegramTransport`. Eleven source/test files plus this plan changed; production code, global setup, singleton DB, Testcontainers and test-only production hooks stayed untouched. Test-first RED was the missing migrated-database helper; focused support/application/decision tests PASS (3 files, 22 tests); focused runtime PASS (1 file, 6 tests); migrated profile/collaboration/browse fake journeys PASS together (3 files, 21 tests); all fake E2E PASS (7 files, 30 tests); architecture PASS (118 modules, 366 dependencies); `pnpm check` PASS (66 unit, 83 integration, 47 runtime tests and build); `pnpm db:verify` PASS; `git diff --check` PASS. Self-review fixed constructor-failure cleanup; two independent read-only reviews then confirmed cleanup, helper consumer counts, canonical runtime/applications composition, explicit lifecycle/restarts, unchanged assertions and distinct fake levels with no findings. No credential, real Telegram, remote or production mutation.
- **Stop conditions:** helper имеет одного consumer, скрывает lifecycle или массовый cutover выходит за unit boundary.

#### R1-08 — Make raw SQL the only persistence model

- **Status:** `completed`
- **Objective:** Убрать теневой Drizzle mapping и закрепить SQL migrations + typed rows/mappers как единственную persistence-модель.
- **Requirements:** обновлённый TD §2.2, §7; неизменные `LFR-10`–`LFR-11`, `LAC-08`–`LAC-11`.
- **Dependencies:** `R1-07`.
- **Read first:** TD §2.2/§7, database boundary/schema, migration/schema/outbox tests, package config.
- **Preconditions:** source scan подтверждает отсутствие production Drizzle queries; Node/pnpm contract проверен перед dependency removal.
- **Scope:** синхронно обновить TD; удалить Drizzle client/schema/dependencies; заменить Drizzle-only tests реальной migrated SQLite introspection.
- **Do not touch:** existing migrations, DB/data, table/index/trigger definitions, repository SQL or transaction semantics.
- **Invariants:** immutable SQL history, checksums/integrity, `BEGIN IMMEDIATE`, pragmas, FIFO serialization и nested rollback-only сохраняются; destructive migration отсутствует.
- **Tests first:** schema/introspection assertions, эквивалентные удаляемому mapping probe.
- **Verification:** no-Drizzle source/dependency scan; focused DB/schema/outbox tests; fresh/upgrade migrations; architecture; `pnpm check`; `pnpm db:verify`; diff/secret scans.
- **Exit criteria:** один persistence stack и синхронизированный TD; один commit `R1-08: make raw SQL persistence canonical`.
- **Completion evidence:** Commit SHA: `SELF`; removed the unused Drizzle proxy from `DatabaseContext`, deleted the shadow schema mapping and removed `drizzle-orm`/`drizzle-kit` plus their inactive unique transitive graph through host-capable pnpm. Production repositories already used parameterized raw SQL exclusively, so no repository query, transaction rule or migration changed. Drizzle-only tests now exercise the real `DatabaseSync` client and inspect the actually migrated SQLite schema through `PRAGMA`/`sqlite_master`; exact existing schema/behavior tests remain. Technical Design now declares immutable SQL migrations as the single schema/history owner and repository-local typed rows/mappers as query contracts. Dependency-cruiser rules were narrowed to the remaining framework/SQLite boundaries, and four exact ignored stale `dist/infrastructure/database/drizzle-schema.*` artifacts were removed before a clean rebuild. Nine source/test/docs/dependency files plus this plan changed; all 13 migrations, PRD, repositories, data and transaction semantics stayed untouched. Test-first RED proved the obsolete boundary adapter was still present (1 failed, 18 passed); focused DB/schema/ingress/outbox tests PASS (4 files, 26 tests); fresh/upgrade migration regressions PASS (9 files, 56 tests); all fake E2E PASS (7 files, 30 tests); architecture PASS (114 modules, 363 dependencies); `pnpm check` PASS (66 unit, 83 integration, 47 runtime tests and build); `pnpm db:verify` PASS; host-capable `pnpm why` returns no Drizzle graph; zero-match scan across source/tests/TD/package/lock/dist PASS; migrations/PRD diff and `git diff --check` are empty/PASS. Self-review and two independent read-only reviews confirmed the lockfile reduction is Drizzle-specific and DatabaseSync pragmas, FIFO, `BEGIN IMMEDIATE`, nested rollback-only and close behavior are unchanged. No credential, real Telegram, remote or production mutation.
- **Stop conditions:** найден production Drizzle consumer, проверка схемы ослабляется или требуется изменить applied migration/data.

#### R1-09 — Close R1 and decide runtime-schema validation

- **Status:** `completed`
- **Objective:** Доказать сохранение поведения, независимо проверить candidate и решить, нужна ли следующая schema-validator карточка.
- **Requirements:** все stage invariants; PRD §19.1/§20.1; TD self-review checklist.
- **Dependencies:** `R1-08`.
- **Read first:** полный R1 diff/log, config/session/payload validators, all completion evidence.
- **Preconditions:** R1-01–R1-08 completed; clean per-unit history.
- **Scope:** full stage gate; critical review; одна consolidated blocker fix wave максимум; evidence/ledger/status update; documented schema-validator decision based on минимум двух live consumers and measurable duplication.
- **Do not touch:** новая production dependency или дальнейший refactor без отдельной карточки; real Telegram/production/remote.
- **Invariants:** no behavior/schema/migration drift; local/fake evidence не выдаётся за real smoke.
- **Tests first:** нет нового runtime behavior; audit exact commands/results and architecture graph.
- **Verification:** `pnpm architecture`; `pnpm check`; `pnpm test:e2e:fake`; `pnpm db:verify`; `git diff --check`; staged secret scan; independent review.
- **Review:** один read-only critical review ограничен credential/privacy exposure, authoritative-data corruption, duplicate effects, broken core journey или unrunnable candidate.
- **Exit criteria:** R1 `completed`; schema-validator либо получает отдельный future trigger/card, либо мотивированно отклонён; один commit `R1-09: close maintainability stage evidence`.
- **Completion evidence:** Commit SHA: `SELF`; полный диапазон `32441e59510a79852aceb47a73ca5338fa529e4c...947c304f94fd485c8b158e0af51813dd77adf4b2` содержит 13 сфокусированных implementation commits перед этой evidence-карточкой, уникальные Task-ID и 71 изменённый файл. `pnpm architecture` PASS (114 modules, 363 dependencies); `pnpm check` PASS (66 unit, 83 integration, 47 runtime tests, lint, typecheck и build); `pnpm test:e2e:fake` PASS (30 tests); `pnpm db:verify` PASS; full-range `git diff --check` PASS. PRD и все 13 immutable SQL migrations не менялись; zero-match scan не нашёл Drizzle в source, tests, package/lock, TD, architecture config или build output. Runtime schema-validator dependency мотивированно не добавлена: env config, sessions, persisted payloads и callback/deep-link values имеют разные форматы, источники доверия и failure semantics, поэтому сейчас отсутствуют минимум два live consumer с одной и той же versioned-object policy, а библиотека добавила бы adapters без измеримого сокращения дублирования. Вернуться к решению следует, когда два production consumer действительно разделят одинаковую versioned schema и замена уберёт минимум две ручные реализации без изменения публичных контрактов. Независимый read-only review полного диапазона завершился PASS без credential/privacy exposure, authoritative-data corruption, duplicated effects, broken core journey или unrunnable candidate. README и этот registry синхронизированы с новой организацией; real Telegram, credentials, remote, push, PR, deploy и production не затрагивались.
- **Stop conditions:** confirmed blocker нельзя закрыть одной wave, aggregate gate не зелёный или нужен новый product decision.

### R2 — Complete feature-first layout

- **Status:** `in_progress` — пользователь уточнил, что ожидает не переходный hybrid, а завершённую feature-first организацию.
- **Objective:** Убрать физическое смешение layer-first и feature-first: весь business-specific domain/application/infrastructure/Telegram presentation принадлежит модулям, а корневые слои содержат только shared kernel/platform и composition.
- **Requirements:** неизменные `LFR-01`–`LFR-11`, `LAC-01`–`LAC-12`; TD §4; R1 behavioral evidence.
- **Dependencies:** `R1-09` completed на `411383eb96edcca3f8cef2a1b13409eac2c1d4b8`.
- **Target tree:** `src/modules/{profiles,collaborations,marketplace,applications,moderation}/{domain,application,infrastructure,presentation,composition}` по фактической необходимости; `src/presentation/telegram` для global routing/durable orchestration; shared `domain`, `application` и `infrastructure` только для genuinely cross-feature contracts/adapters; `runtime`, `config`, `cli` сохраняют текущие роли.
- **Stage invariants:** неизменные команды, routing precedence, callback/deep-link bytes, session JSON/version/TTL, тексты, SQL/schema/migrations, transaction/outbox/receipt semantics, post-commit audience lookup, actor/admin/blocked gates и lifecycle order.
- **Stage exclusions:** NestJS/DI container, generic shared package, новая product capability, dependency addition, schema/data migration, credentials, real Telegram, remote/push/PR/merge/deploy.
- **Completion definition:** нет business-specific code в legacy `src/domain/{profiles,collaborations}`, `src/application/{profiles,collaborations,applications,moderation}`, shared `application/ports`, shared database adapters или `src/bot`; runtime использует module factories/public APIs; cross-module deep imports запрещены executable graph gate; docs показывают фактическое дерево.
- **Stage gate:** `pnpm architecture`, `pnpm check`, `pnpm test:e2e:fake`, `pnpm db:verify`, unchanged PRD/migrations/SQL behavior, no legacy-path scan, `git diff --check`, staged secret scan и один независимый blocker-limited review.

#### R2-00 — Define the completed feature-first target

- **Status:** `completed`
- **Objective:** Исправить преждевременную closure-формулировку и зафиксировать полный физический transition до source moves.
- **Dependencies:** `R1-09`.
- **Read first:** `AGENTS.md`; PRD §19.1/§20.1; TD §4; R1 diff/evidence; live source/import tree.
- **Scope:** только этот plan: target tree, completion definition, bounded unit order, invariants и gates.
- **Do not touch:** source/tests/dependencies/PRD/TD/runtime/Telegram/data.
- **Verification:** `pnpm check`; `pnpm db:verify`; `git diff --check`; exact changed-file check.
- **Exit criteria:** decision-complete R2 cards; один commit `R2-00: define complete feature-first transition`.
- **Completion evidence:** Commit SHA: `SELF`; live audit на clean `main`/`411383eb96edcca3f8cef2a1b13409eac2c1d4b8` подтвердил незавершённый hybrid: только applications физически находился под `src/modules`, feature ports/adapters оставались в shared layers, root `profile-bot.ts` владел всеми Telegram routes, а marketplace composer смешивал browse и application workflows. Зафиксированы complete target tree, public-module boundary, 16 bounded units и exact completion scan; изменён только этот plan. Node `v24.18.0`, pnpm `11.15.1`; `pnpm check` PASS (66 unit, 83 integration, 47 runtime tests, lint, architecture 114/363, typecheck/build); `pnpm db:verify` PASS; `git diff --check` PASS. No source, test, dependency, PRD/TD, migration, credential, Telegram, remote or production mutation.
- **Stop conditions:** полное разделение требует product-policy решения либо невозможно сохранить текущие payload/session/SQL contracts.

#### R2-01 — Enforce module public boundaries and routing contracts

- **Status:** `completed`
- **Objective:** До moves закрепить public-entrypoint policy и точный global routing/durable behavior.
- **Dependencies:** `R2-00`.
- **Read first:** dependency-cruiser config; Telegram root/ingress; all feature composers; runtime tests.
- **Scope:** graph fixtures/rules для запрета cross-module internal imports; characterization route-order, `cb_*`, replay и post-commit audience tests; narrow public contract entrypoints where required by the gate.
- **Do not touch:** user copy, payload codecs, repositories, SQL or runtime topology.
- **Invariants:** admin → start/deep-link → collaboration → marketplace/profile order unchanged; generic durable and opaque callback paths remain separate.
- **Verification:** focused architecture/runtime/fake tests; `pnpm architecture`; `pnpm check`; `pnpm db:verify`.
- **Exit criteria:** будущие moves не могут обойти public module surfaces; один commit `R2-01: enforce feature module public boundaries`.
- **Completion evidence:** Commit SHA: `SELF`; added generated dependency-cruiser rules for the five target business modules plus passing public-entrypoint and failing internal-import fixtures. Test-first RED showed the internal import was accepted before the rule (1 failed/4 passed); focused architecture policy is now 5/5. Extracted the exact text-command precedence into `presentation/telegram/telegram-routing.ts` and made the existing root consume it without changing copy/routes: moderation → start/deep-link or menu → help → collaboration → marketplace → profile middleware. Focused routing contract and durable/opaque composer tests PASS (6 unit, 5 fake); architecture PASS (115 modules, 365 dependencies); `pnpm check` PASS (69 unit, 83 integration, 47 runtime, lint/typecheck/build); all fake E2E PASS (30); `pnpm db:verify` PASS; migrations/PRD diff and `git diff --check` PASS. Nine source/test/config files plus this plan changed; no repository, SQL, payload, credential, real Telegram, remote or production mutation.
- **Stop conditions:** gate requires broad allowlist or current routing cannot be characterized without new policy.

#### R2-02 — Move profiles domain and application ownership

- **Status:** `completed`
- **Objective:** Собрать profile domain, use cases, session contract и repositories ports под `modules/profiles`.
- **Dependencies:** `R2-01`.
- **Read first:** profile domain/services/ports and focused unit/integration tests.
- **Scope:** profile domain/application paths, pure application public entrypoint and temporary exact re-export compatibility paths where needed for green intermediate HEAD.
- **Do not touch:** SQLite implementation, grammY presentation, session JSON or profile policy.
- **Invariants:** exported types/errors and runtime semantics byte-for-byte equivalent.
- **Verification:** profile unit/session integration; architecture; `pnpm check`; `pnpm db:verify`.
- **Exit criteria:** profile core has one feature owner; one commit `R2-02: move profiles core into feature module`.
- **Completion evidence:** Commit SHA: `SELF`; moved profile domain, services and two consumer ports into `modules/profiles/{domain,application}` with a pure `application/index.ts`; five old paths are exact temporary re-export barrels so current consumers remain green until their scheduled cutover. The previous declaration merge for `audienceAutofill` was replaced by the same explicit optional field in the owned session contract; emitted/runtime behavior is unchanged. Eleven source paths plus this plan changed, with no repository implementation, SQL, presentation, payload/session serialization or policy edit. Focused profile domain/audience tests PASS (23), profile/repository/session integration PASS (13); architecture PASS (121 modules, 376 dependencies); `pnpm check` PASS (69 unit, 83 integration, 47 runtime, lint/typecheck/build); all fake E2E PASS (30); `pnpm db:verify` PASS; migrations/PRD diff and `git diff --check` PASS. No credential, real Telegram, remote or production mutation.
- **Stop conditions:** runtime cycle through public barrel or consumer-visible contract drift.

#### R2-03 — Move profiles adapters and composition

- **Status:** `completed`
- **Objective:** Дать profiles собственные SQLite/audience adapters и factory.
- **Dependencies:** `R2-02`.
- **Read first:** profile repositories, audience reader, runtime composition and restart tests.
- **Scope:** profile/session SQLite adapters, grammY audience reader, `createProfilesFeature`, root module exports; temporary compatibility exports only for not-yet-moved tests.
- **Do not touch:** SQL text/schema, Telegram call timing or session validation.
- **Invariants:** один shared DatabaseBoundary/transaction context; audience lookup remains post-commit best effort.
- **Verification:** profile repository/session/audience tests; runtime; architecture; `pnpm check`; `pnpm db:verify`.
- **Exit criteria:** runtime can consume profiles factory; one commit `R2-03: own profiles adapters and composition`.
- **Completion evidence:** Commit SHA: `SELF`; moved profile aggregate/session SQLite adapters and grammY audience reader under `modules/profiles/infrastructure`, added `createProfilesFeature` and the root feature public entrypoint, and left three exact temporary infrastructure re-exports for scheduled consumer/test cutover. The factory owns one profile repository shared by profile API and audience writer, one session repository and one audience service while receiving the existing shared boundary/transactions/clock/deadline/bot. Test-first RED was the missing public feature factory; the new migrated-SQLite composition test now proves create/read plus exposed session/audience boundaries. Ten source/test paths plus this plan changed; repository SQL, session parser, migrations and post-commit invocation remain unchanged. Focused profile composition/repository/session PASS (14), audience PASS (18), runtime PASS (6); architecture PASS (126 modules, 391 dependencies); `pnpm check` PASS (69 unit, 84 integration, 47 runtime, lint/typecheck/build); all fake E2E PASS (30); `pnpm db:verify`, migrations/PRD diff and `git diff --check` PASS. No credential, real Telegram, remote or production mutation.
- **Stop conditions:** factory creates a second DB boundary or changes lookup/delivery ordering.

#### R2-04 — Move profiles Telegram presentation

- **Status:** `completed`
- **Objective:** Разместить profile composer/rendering внутри profiles без владения соседними workflows.
- **Dependencies:** `R2-03`.
- **Read first:** profile composer/presentation, continuation tests and root orchestration.
- **Scope:** `modules/profiles/presentation/telegram`; narrow injected continuation/application ports; production consumers switch to public profile surfaces.
- **Do not touch:** callback strings, session continuation encoding, copy or route priority.
- **Invariants:** profile module exposes wizard operations; cross-feature journey continuation остаётся в global router.
- **Verification:** focused profile composer/fake E2E; architecture; `pnpm check`; `pnpm db:verify`.
- **Exit criteria:** нет active profile presentation под `src/bot/profile`; один commit `R2-04: move profile Telegram presentation`.
- **Completion evidence:** Commit SHA: `SELF`; moved profile composer/presentation under `modules/profiles/presentation/telegram`, exported them through the profiles public API, switched the root Telegram router plus collaboration/marketplace profile-session consumers to public profile surfaces, and migrated the focused composer test to the module entrypoint. The two old `src/bot/profile/*` files are exact temporary re-export bridges only; no active implementation remains there. Ten source/test paths plus this plan changed; callback strings, continuation JSON, copy, route order and profile/application behavior are unchanged. Focused profile composer/full-profile fake tests PASS (8); architecture PASS (128 modules, 390 dependencies); `pnpm check` PASS (69 unit, 84 integration, 47 runtime, lint/typecheck/build); all fake E2E PASS (30); `pnpm db:verify`, migrations/PRD diff and `git diff --check` PASS. No credential, real Telegram, remote or production mutation.
- **Stop conditions:** move требует дублировать replies/effects или меняет continuation payload.

#### R2-05A — Move collaborations domain and port ownership

- **Status:** `completed`
- **Objective:** Собрать collaboration domain и consumer-owned ports под модулем без широкого mixed move.
- **Dependencies:** `R2-04`.
- **Read first:** collaboration domain and repository/session/publication/showcase ports plus consumers.
- **Scope:** collaboration domain and four owned ports; temporary exact compatibility exports.
- **Do not touch:** services, repositories, grammY presentation, SQL or lifecycle transitions.
- **Invariants:** validation, session constants/types and port shapes unchanged.
- **Verification:** collaboration domain/session/publication tests; architecture; `pnpm check`; `pnpm db:verify`.
- **Exit criteria:** collaboration domain/ports have one owner; один commit `R2-05A: move collaboration domain and ports`.
- **Completion evidence:** Commit SHA: `SELF`; split was recorded because domain/ports plus services would exceed the bounded unit. Moved collaboration domain and repository/session/publication/showcase consumer ports under `modules/collaborations`; five old locations are exact temporary re-export bridges. Ten source paths plus this plan changed; values, session constants/types, port shapes, services, repositories, SQL, presentation and migrations are unchanged. Focused collaboration domain PASS (4), draft/publication integration PASS (7); architecture PASS (133 modules, 395 dependencies); `pnpm check` PASS (69 unit, 84 integration, 47 runtime, lint/typecheck/build); all fake E2E PASS (30); `pnpm db:verify`, migrations/PRD diff and `git diff --check` PASS. No credential, real Telegram, remote or production mutation.
- **Stop conditions:** consumer-visible type/value drift or module barrel cycle.

#### R2-05B — Move collaborations application services

- **Status:** `completed`
- **Objective:** Перенести draft/publication services и pure renderer за application public entrypoint.
- **Dependencies:** `R2-05A`.
- **Read first:** collaboration services/renderer, applications decision consumer and focused tests.
- **Scope:** three application files, `modules/collaborations/application/index.ts`, temporary exact compatibility exports; switch applications to the public application surface.
- **Do not touch:** repositories, grammY presentation, SQL or lifecycle transitions.
- **Invariants:** render output, errors, transaction/outbox/publication semantics unchanged.
- **Verification:** collaboration unit/publication integration; application decision tests; architecture; `pnpm check`; `pnpm db:verify`.
- **Exit criteria:** collaboration application core has one owner; один commit `R2-05B: move collaboration application services`.
- **Completion evidence:** Commit SHA: `SELF`; moved draft/publication services and pure Telegram-safe renderer under `modules/collaborations/application`, added its narrow application entrypoint and retained three exact temporary compatibility exports. Applications decisions now consume the collaboration renderer through that public application surface, so the executable cross-module rule protects the edge without a broad root barrel or ESM cycle. Nine source paths plus this plan changed; service bodies, render output, errors, transactions, outbox/publication behavior, repositories and SQL are unchanged. Focused domain PASS (4), draft/publication/application-decision integration PASS (19); architecture PASS (137 modules, 406 dependencies); `pnpm check` PASS (69 unit, 84 integration, 47 runtime, lint/typecheck/build); all fake E2E PASS (30); `pnpm db:verify`, migrations/PRD diff and `git diff --check` PASS. No credential, real Telegram, remote or production mutation.
- **Stop conditions:** applications must deep-import collaboration internals or a runtime barrel cycle appears.

#### R2-06 — Extract shared wizard admission

- **Status:** `completed`
- **Objective:** Явно владеть атомарным правилом «один active wizard» вместо cross-table SQL двух feature adapters.
- **Dependencies:** `R2-05B`.
- **Read first:** both session repositories, collaboration draft conflict path and migration constraints.
- **Scope:** consumer-neutral wizard-admission contract with one SQLite implementation and two real session-repository consumers; preserve transaction/error mapping.
- **Do not touch:** tables/migrations/session shapes/TTL or wizard product policy.
- **Invariants:** concurrent/conflicting saves fail exactly as before inside one transaction.
- **Verification:** adversarial profile/collaboration session tests; architecture; `pnpm check`; `pnpm db:verify`.
- **Exit criteria:** no feature repository directly queries the other feature session table; один commit `R2-06: centralize wizard admission invariant`.
- **Completion evidence:** Commit SHA: `SELF`; added one shared `WizardAdmission` application contract and one SQLite implementation, then injected it into both profile and collaboration session repositories (default construction preserves current consumers). Each repository still starts its existing `BEGIN IMMEDIATE` transaction before admission; the guard uses the same DatabaseBoundary context and selects the same opposite active-session condition before save. No feature adapter now contains SQL for the other feature's session table. Test-first RED was the missing shared adapter; the new migrated-SQLite adversarial test proves both conflict directions and serialized concurrent saves yield exactly one success/one conflict. Five source/test files plus this plan changed; tables, migrations, session shapes/TTL, error text and wizard policy are unchanged. Focused admission/profile/collaboration session tests PASS (7); architecture PASS (139 modules, 412 dependencies); `pnpm check` PASS (69 unit, 85 integration, 47 runtime, lint/typecheck/build); all fake E2E PASS (30); `pnpm db:verify`, migrations/PRD diff and `git diff --check` PASS. No credential, real Telegram, remote or production mutation.
- **Stop conditions:** atomicity cannot be preserved without schema/data change.

#### R2-07 — Move collaborations adapters and Telegram presentation

- **Status:** `in_progress`
- **Objective:** Завершить collaboration vertical slice и factory.
- **Dependencies:** `R2-06`.
- **Read first:** collaboration repositories/composer/presentation, runtime and S2 tests.
- **Scope:** feature SQLite adapters, composition factory, collaboration composer/presentation, public exports; production consumers switch.
- **Do not touch:** browse projection, application decisions, SQL or callbacks.
- **Invariants:** publication/draft transactions, render and wizard flow unchanged.
- **Verification:** S2 integration/fake E2E; runtime; architecture; `pnpm check`; `pnpm db:verify`.
- **Exit criteria:** collaboration business code absent from shared legacy paths; один commit `R2-07: complete collaborations feature module`.
- **Stop conditions:** unit exceeds boundary with non-mechanical behavior changes; split before continuing.

#### R2-08 — Create the marketplace read module

- **Status:** `pending`
- **Objective:** Дать feed/deep-link/browse projection отдельного владельца вместо размытого marketplace composer.
- **Dependencies:** `R2-07`.
- **Read first:** browse service/port/repository, feed/deep-link tests and TD CQRS rules.
- **Scope:** `modules/marketplace` application/infrastructure/composition for read-only cross-feature projection and browse-session writes; explicit documented CQRS exception.
- **Do not touch:** application submission/decisions or browse SQL/pagination.
- **Invariants:** same filters, keyset order, visibility and revalidation.
- **Verification:** browse integration/fake E2E; architecture; `pnpm check`; `pnpm db:verify`.
- **Exit criteria:** browse ownership no longer sits in collaborations/shared DB; один commit `R2-08: establish marketplace read module`.
- **Stop conditions:** projection write expands beyond browse sessions or SQL behavior changes.

#### R2-09 — Split marketplace and applications Telegram presentation

- **Status:** `pending`
- **Objective:** Разделить смешанный composer по реальному business ownership.
- **Dependencies:** `R2-08`.
- **Read first:** marketplace composer/codec, applications APIs and all S3 fake journeys.
- **Scope:** browse/deep-link rendering под marketplace; submit/own/author decision/opaque `cb_*` под applications; injected public ports; удалить legacy marketplace composer after cutover.
- **Do not touch:** callback/deep-link bytes, command names, copy or route priority.
- **Invariants:** `cb_*` не проходит generic durable envelope; no duplicated Telegram/business effect.
- **Verification:** R1-05C/S3 focused tests; all fake E2E; architecture; `pnpm check`; `pnpm db:verify`.
- **Exit criteria:** applications и marketplace имеют отдельные presentation owners; один commit `R2-09: split marketplace Telegram ownership`.
- **Stop conditions:** exact routing/effect parity cannot be proven in one wave.

#### R2-10 — Complete the moderation feature module

- **Status:** `pending`
- **Objective:** Собрать moderation service/ports/adapter/presentation и узко оформить её cross-feature orchestration.
- **Dependencies:** `R2-09`.
- **Read first:** moderation service/repository/composer and hide audit/outbox tests.
- **Scope:** moderation vertical module/factory/public API; remove internal presentation import; preserve current atomic repository behavior unless a narrow port split is behavior-neutral and fully characterized.
- **Do not touch:** hide policy, audit schema, restore/block Later scope or delivery semantics.
- **Invariants:** hide + audit + channel-delete intent остаются одной authoritative transaction.
- **Verification:** S4 moderation integration/fake E2E; architecture; `pnpm check`; `pnpm db:verify`.
- **Exit criteria:** moderation business code absent from shared legacy paths; один commit `R2-10: complete moderation feature module`.
- **Stop conditions:** ownership split would weaken atomicity or require new product policy.

#### R2-11 — Replace the profile-named root with a neutral Telegram router

- **Status:** `pending`
- **Objective:** Убрать вводящий в заблуждение `profile-bot.ts` и оставить global routing/durable orchestration в `presentation/telegram`.
- **Dependencies:** `R2-10`.
- **Read first:** root bot, durable ingress, feature composer APIs and runtime drain tests.
- **Scope:** neutral `telegram-router`, durable ingress/executor, menu/update metadata; mount module presentations through narrow ports; delete `src/bot` after consumers switch.
- **Do not touch:** route/callback priority, reply buffering, replay, audience post-commit action or in-flight middleware ownership.
- **Invariants:** exact external Telegram behavior and one durable envelope per generic update.
- **Verification:** routing characterization/runtime/all fake E2E; architecture; `pnpm check`; `pnpm db:verify`.
- **Exit criteria:** `src/bot` absent; root name/ownership truthful; один commit `R2-11: establish neutral Telegram router`.
- **Stop conditions:** ESM cycle or changed effect/reply order.

#### R2-12 — Compose runtime through feature factories

- **Status:** `pending`
- **Objective:** Убрать ручное создание feature internals из runtime composition.
- **Dependencies:** `R2-11`.
- **Read first:** bot application, all module factories/public APIs and lifecycle tests.
- **Scope:** runtime creates shared platform primitives, calls feature factories and mounts neutral router; narrow cross-feature ports wired only here.
- **Do not touch:** bootstrap/preflight/polling/worker/shutdown order.
- **Invariants:** one DB boundary, one transaction runner, one bot, one worker and one close.
- **Verification:** composition/lifecycle/runtime tests; all fake E2E; architecture; `pnpm check`; `pnpm db:verify`.
- **Exit criteria:** runtime imports no feature internal file; один commit `R2-12: compose runtime from feature APIs`.
- **Stop conditions:** factory duplication changes instance/transaction identity.

#### R2-13 — Remove legacy production feature paths

- **Status:** `pending`
- **Objective:** Удалить temporary barrels и feature-specific code из shared layers.
- **Dependencies:** `R2-12`.
- **Read first:** all source imports, module entrypoints and architecture graph.
- **Scope:** cut remaining production consumers to module public paths; delete legacy domain/application/port/infrastructure feature files and compatibility barrels.
- **Do not touch:** shared commands/outbox/platform adapters or tests beyond import fixes required for build.
- **Invariants:** no code duplication; every surviving shared contract has at least two cross-feature consumers or explicit platform ownership.
- **Verification:** zero legacy production scan; architecture; `pnpm check`; all fake E2E; `pnpm db:verify`.
- **Exit criteria:** completion definition holds for `src`; один commit `R2-13: remove legacy feature paths`.
- **Stop conditions:** a surviving consumer lacks a stable public module contract.

#### R2-14 — Align test support with module APIs

- **Status:** `pending`
- **Objective:** Убрать зависимость tests от удалённых внутренних путей и test-only adapters из production source.
- **Dependencies:** `R2-13`.
- **Read first:** direct test imports, `test/support`, fake clocks/Telegram adapters and module factories.
- **Scope:** module-focused fixtures/public APIs; relocate genuine test-only fakes under `test/support`; retain direct platform internals only in platform tests.
- **Do not touch:** assertions, lifecycle visibility, DB isolation or fake/real evidence boundary.
- **Invariants:** tests continue using real migrations and explicit start/stop/restart; FakeTelegramApi and port transport remain distinct.
- **Verification:** support tests, all suites together, architecture, `pnpm check`, `pnpm test:e2e:fake`, `pnpm db:verify`.
- **Exit criteria:** production `src` has no test-only adapter; один commit `R2-14: align tests with feature modules`.
- **Stop conditions:** helper hides lifecycle or weakens behavioral assertions.

#### R2-15 — Close the physical transition

- **Status:** `pending`
- **Objective:** Синхронизировать TD/README, доказать completed tree и независимо проверить весь R2 candidate.
- **Dependencies:** `R2-14`.
- **Read first:** full R2 diff/log, actual tree/import graph, all unit evidence and docs.
- **Scope:** docs/status/ledger; full stage gates; one blocker-limited independent review; at most one consolidated fix wave.
- **Do not touch:** new behavior/dependency/refactor, real Telegram, production or remote.
- **Invariants:** local/fake evidence не выдаётся за real smoke; PRD/migrations/contracts unchanged.
- **Verification:** complete stage gate plus exact old-path/empty-dir/source-tree audit.
- **Exit criteria:** R2 `completed`, docs match source, clean local commit `R2-15: close feature-first transition evidence`.
- **Completion evidence:** pending.
- **Stop conditions:** confirmed blocker, non-green aggregate gate or incomplete physical transition.

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

После `FUT-01` в реестре нет следующего авторизованного pending unit. Новая работа начинается только с отдельной decision-complete карточки и пользовательской авторизации.
