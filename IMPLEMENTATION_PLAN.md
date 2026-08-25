# Collaboration Bot — канонический план реализации

- Статус документа: `Approved execution registry`
- Версия: `0.1`
- Дата: `2026-08-24`
- Модель исполнения: 7 пользовательских запусков, 32 последовательных work units

## 1. Назначение и источники истины

Этот документ является исполнимым реестром реализации MVP Collaboration Bot одним ИИ-агентом. Он не пересказывает продукт и архитектуру, а задаёт однозначную следующую работу, допустимый diff, проверки и evidence.

Источники применяются в таком порядке:

1. [`docs/PRD.md`](./docs/PRD.md) — продуктовая политика, 19 `FR-*` и `AC-001`–`AC-026`;
2. [`docs/TECHNICAL_DESIGN.md`](./docs/TECHNICAL_DESIGN.md) — технический контракт;
3. [`tz_telegram_collaboration_bot.md`](./tz_telegram_collaboration_bot.md) — discovery-контекст, не обязательный scope.

Новая продуктовая возможность или изменение политики сначала вносится в PRD. При противоречии или недостающем решении агент останавливает stage, не реализует предположение молча и предлагает минимальную документальную поправку.

## 2. Статусы и execution protocol

### 2.1. Статусы

Допустимы `pending`, `in_progress`, `completed`, `blocked`. В первоначальном реестре все stages и units имеют `pending`. Одновременно могут существовать только один stage и один unit со статусом `in_progress`.

| Stage | Status | Units | Результат |
|---|---|---:|---|
| P0 — Repository baseline | `completed` | 2 | Локальный Git baseline и правила проекта |
| S0 — Foundation | `in_progress` | 7 | Надёжная инфраструктурная основа без product flows |
| S1 — Profiles | `pending` | 3 | Профиль и deferred Telegram wizard |
| S2 — Drafts and publication | `pending` | 5 | Draft lifecycle и надёжная showcase publication |
| S3 — Feed and applications | `pending` | 5 | Core marketplace до `matched/contact/restart` |
| S4 — Completion, moderation and analytics | `pending` | 4 | Полный Functional MVP на fake API |
| S5 — Production operations | `pending` | 6 | Проверенная operational readiness и AC-020 |

### 2.2. Пользовательский запуск stage

Пользователь авторизует stage командой вида `Выполни этап S2 по IMPLEMENTATION_PLAN.md`. Это разрешает последовательно выполнить все `pending` units только этого stage. После успешного commit одного unit агент самостоятельно выбирает следующий unit того же stage. Переход к следующему stage требует нового пользовательского запуска.

Первая пользовательская команда — `Выполни этап P0 по IMPLEMENTATION_PLAN.md`; при исходном реестре она однозначно выбирает `P0-01`, а не весь список карточек как отдельные запуски.

S5-05 и S5-06 не получают заранее полномочий на BotFather, credentials, LaunchAgent mutation, restore или реальные Telegram actions: перед каждым таким действием нужна отдельная явная авторизация.

### 2.3. Выбор unit

Следующий unit — первый `pending` в порядке этого реестра, у которого `completed` все Dependencies. Перед ним агент обязан:

1. проверить branch, HEAD, `git status --short`, отсутствие remote drift и чужих изменений;
2. сверить завершённость predecessor и его commit по Task ID;
3. полностью перечитать `Read first`;
4. проверить `node --version`, `pnpm --version`, nearest toolchain contracts и зависимости;
5. при schema work сверить актуальные schema и migrations;
6. определить допустимый diff и перевести только этот unit в `in_progress`.

Для `P0-01` допустим единственный bootstrap exception: `main` является unborn, HEAD отсутствует, а PRD, Technical Design и discovery-ТЗ являются ожидаемыми untracked inputs. Любые другие untracked файлы требуют классификации до изменения.

### 2.4. Выполнение unit

Агент работает test-first, не реализует будущие units «заодно», не создаёт абстракцию без текущего потребителя и не меняет Later/Out. Authoritative state, product event и delivery intent сохраняются атомарно там, где это требует Technical Design. Telegram API не вызывается внутри SQLite transaction; durable flows должны переживать restart/replay.

После реализации агент запускает focused checks, migration/fresh-DB checks при schema change, применимые integration/runtime tests и указанный aggregate gate; проверяет итоговый diff; заполняет evidence; переводит unit в `completed`; создаёт ровно один commit и проверяет clean tree.

### 2.5. Commit protocol и self-resolving SHA

Commit subject имеет уникальную форму `<ID>: <краткий измеримый результат>`. Поле `Commit SHA` внутри того же commit не может содержать literal self-SHA, поэтому записывается `SELF`; authoritative SHA определяется:

```sh
git log --format='%H' --grep='^<ID>:' -n 1
```

Перед следующим unit должен существовать ровно один commit с этим Task ID. Amend допускается только до начала следующего unit. Push, merge, PR и deploy не выполняются без отдельной авторизации.

### 2.6. Общие stop conditions

Любой unit немедленно останавливается при противоречии PRD/Technical Design, необходимости новой product policy, выходе за Later/Out boundary, неподходящей версии Node/pnpm, конфликте с пользовательскими изменениями, недоказуемом AC, необходимости destructive migration, production credential, BotFather, LaunchAgent mutation, restore, push/merge/PR/deploy либо сомнении в integrity/identity. Stage не перескакивает через `blocked` unit.

## 3. Dependency graph и критический путь

Registry intentionally linear: каждый unit зависит от непосредственно предыдущего. Это устраняет конкурирующие «следующие» задачи и соответствует одному исполнителю.

```text
P0-01 → P0-02
  → S0-01 → S0-02 → S0-03 → S0-04 → S0-05 → S0-06 → S0-07
  → S1-01 → S1-02 → S1-03
  → S2-01 → S2-02 → S2-03 → S2-04 → S2-05
  → S3-01 → S3-02 → S3-03 → S3-04 → S3-05
  → S4-01 → S4-02 → S4-03 → S4-04
  → S5-01 → S5-02 → S5-03 → S5-04 → S5-05 → S5-06
```

Все 32 units находятся на execution critical path. Наиболее рискованный технический spine: SQLite/receipts/outbox → delivery fencing/recovery → persisted continuation → initial publication ambiguity → staged edit lock → last-slot concurrency/contact → deadline/projection sync → hide/restore → block/accept race → exact production identity → backup/restore → real smoke.

## 4. Task cards

### P0 — Repository baseline

#### P0-01 — Зафиксировать безопасный initial repository baseline

- **Status:** `completed`
- **Objective:** Создать `.gitignore` и первый локальный commit, содержащий только канонические документы и безопасный baseline без secrets/production resources.
- **Requirements:** Инфраструктурный unit; напрямую не закрывает FR/AC.
- **Dependencies:** Нет.
- **Read first:** PRD §1, §6; Technical Design §1, §2.4, §15.2, §16.2; этот план §1–§3.
- **Preconditions:** Подтвердить unborn `main`, отсутствие HEAD/remote, Node `>=24.18.0 <25`, pnpm `>=11.15.1 <12`; классифицировать все untracked inputs.
- **Scope:** `.gitignore`; tracking discovery-ТЗ, PRD, Technical Design и `IMPLEMENTATION_PLAN.md`; evidence только этого unit.
- **Do not touch:** Содержание source documents, README/AGENTS, package/runtime files, credentials, production paths, Giveaway Bot.
- **Invariants:** `.env`, `.data/`, SQLite/WAL/SHM, logs, backups, `dist`, coverage, editor/OS noise и secrets игнорируются; remote остаётся отсутствующим.
- **Tests first:** До staging проверить secret-like filenames/patterns и список всех добавляемых файлов.
- **Implementation notes:** Не копировать `.gitignore` другого repo целиком; добавить только ожидаемые для утверждённого стека и macOS артефакты.
- **Verification:** `git status --short --branch`; `git remote -v`; `git diff --check --cached`; `git diff --cached --name-only`; secret-pattern scan по staged content.
- **Exit criteria:** Первый commit существует на `main`; tracked только разрешённые документы и `.gitignore`; remote/production resources отсутствуют; working tree clean.
- **Completion evidence:**
  - Commit SHA: `SELF`
  - Changed files: `.gitignore`, `IMPLEMENTATION_PLAN.md`; staged unchanged canonical inputs: `docs/PRD.md`, `docs/TECHNICAL_DESIGN.md`, `tz_telegram_collaboration_bot.md`
  - Focused checks: preflight confirmed unborn `main`, no HEAD, no remote, exact initial untracked set, Node `v24.18.0`, pnpm `11.15.1`; staged whitespace/name-list checks and high-confidence secret scan passed; documented placeholders only
  - Aggregate checks: `N/A — package scripts ещё не существуют`
  - Acceptance evidence: staged file list is exactly `.gitignore`, `IMPLEMENTATION_PLAN.md`, `docs/PRD.md`, `docs/TECHNICAL_DESIGN.md`, `tz_telegram_collaboration_bot.md`; source-document content unchanged; remote remains absent
  - Review result: `Sol max cycle 2/3 — PASS (local staged candidate; no runtime/production evidence)`
  - Notes/deviations: Two review findings (`*.sqlite3-*`, removal of `Thumbs.db`) were corrected; no scope deviation; no README/AGENTS/package/runtime/credential/production/Giveaway Bot files touched
- **Stop conditions:** Любой неожиданный файл, secret-like value, существующий HEAD/remote или несогласованное изменение исходных документов.

#### P0-02 — Добавить README и правила исполнения агентом

- **Status:** `completed`
- **Objective:** Сделать repository self-describing и закрепить безопасный stage/unit protocol в README и root `AGENTS.md`.
- **Requirements:** Инфраструктурный unit; напрямую не закрывает FR/AC.
- **Dependencies:** `P0-01`.
- **Read first:** PRD §1–§3, §6; Technical Design §1–§4, §22.1; этот план §2.
- **Preconditions:** Общий preflight; commit `P0-01` однозначно разрешается по ID; clean tree.
- **Scope:** `README.md`, `AGENTS.md`, evidence этого unit.
- **Do not touch:** Package/toolchain, application source, production instructions глубже утверждённых границ, исходные requirements.
- **Invariants:** README не заявляет implemented/deployed behavior; `AGENTS.md` требует один stage launch, последовательные units, отдельные commits, test-first и stop conditions.
- **Tests first:** Составить checklist обязательных README/AGENTS statements до написания текста.
- **Implementation notes:** README описывает цель, source hierarchy, MVP/Later boundary, stage commands и честные readiness definitions; не дублирует PRD.
- **Verification:** `git diff --check`; link/path check; поиск запрещённых заявлений `production ready`, `deployed`, `24/7` вне отрицательных границ; ручная сверка с §2 этого плана.
- **Exit criteria:** Новый агент из root однозначно находит sources, следующую команду и запреты; P0 stage table/evidence обновлены; commit отдельный; tree clean.
- **Completion evidence:**
  - Commit SHA: `SELF`
  - Changed files: `README.md`, `AGENTS.md`, `IMPLEMENTATION_PLAN.md`
  - Focused checks: `git diff --check`; exact staged-name check; relative-link existence check; mandatory README/AGENTS statement checklist; forbidden-claim search with negative-context manual classification; plan §2 / Technical Design §22.1 comparison; staged high-confidence secret scan
  - Aggregate checks: `P0 documentation gate`
  - Acceptance evidence: README and AGENTS are root-discoverable, link the approved source hierarchy, describe the MVP/Later/Out boundary and intended-but-not-implemented architecture, state the exact next command `Выполни этап S0 по IMPLEMENTATION_PLAN.md`, and distinguish documentation baseline, Functional MVP, and production evidence; P0 table is `completed`
  - Review result: `Sol max cycle 3/3 — PASS (local staged candidate; no runtime/production evidence)`
  - Notes/deviations: No source, package/toolchain, runtime, credential, or production files changed; P0-01 evidence unchanged; No scope deviations
- **Stop conditions:** Требуется изменить product/technical contract либо добавить runtime/configuration.

### S0 — Foundation

#### S0-01 — Создать toolchain contracts и pure config boundary

- **Status:** `completed`
- **Objective:** Получить минимальный strict ESM TypeScript project с закреплёнными версиями, исполнимыми scripts и pure config parser без real credentials.
- **Requirements:** Инфраструктура; косвенная основа всех FR/AC.
- **Dependencies:** `P0-02`.
- **Read first:** Technical Design §2.2, §4, §16, §20, §22 S0; PRD §6.2–§6.3.
- **Preconditions:** Общий preflight; подтвердить Node/pnpm contracts до dependency-changing command; проверить clean lockfile baseline.
- **Scope:** `package.json`, lockfile, TypeScript/ESLint/test/build configuration, source/test skeleton, pure allowlisted config parser и unit tests.
- **Do not touch:** SQLite/product schemas, Telegram network adapter, product modules, production env/plist.
- **Invariants:** Node `>=24.18.0 <25`; pnpm `>=11.15.1 <12`, `packageManager=pnpm@11.15.1`; strict ESM; без NestJS/dotenv/HTTP/Docker.
- **Tests first:** Invalid/missing/duplicate config values, decimal IDs without Number conversion, fixed timezone, username normalization, unknown-key warning.
- **Implementation notes:** Parser принимает explicit key/value input. Создать canonical scripts `lint`, `typecheck`, `test:unit`, `test:integration`, `test:runtime`, `test:e2e:fake`, `build`, `check`; `pnpm check` запускает только применимые непустые suites; отдельные пустые suite scripts fail-closed без `--passWithNoTests` и подключаются к aggregate после первого реального теста.
- **Verification:** `node --version`; `pnpm --version`; `pnpm lint`; `pnpm typecheck`; focused config tests; `pnpm build`; `pnpm check`.
- **Exit criteria:** Clean install воспроизводим lockfile; все применимые scripts зелёные; отдельные пустые suite scripts fail-closed без `--passWithNoTests` и подключаются к aggregate после первого реального теста; config tests не читают filesystem/Telegram; запрещённые dependencies отсутствуют.
- **Completion evidence:**
  - Commit SHA: `SELF`
  - Changed files: `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `tsconfig.json`, `tsconfig.build.json`, `eslint.config.js`, `vitest.config.ts`, `src/config/parse-config.ts`, `test/unit/config.test.ts`, `IMPLEMENTATION_PLAN.md`
  - Focused checks: `node --version` (`v24.18.0`); `pnpm --version` (`11.15.1`); ordinary `pnpm install` PASS with reproducible lock and no blocked-build warning/error; `pnpm test:unit` (6/6 PASS); `pnpm lint` PASS; `pnpm typecheck` PASS; `pnpm build` PASS; empty `pnpm test:integration` exits 1 as expected; parser/test import `rg` check PASS; forbidden dependency audit PASS; staged secret scan PASS
  - Aggregate checks: `pnpm check` — PASS
  - Acceptance evidence: strict NodeNext ESM package with explicit `.js` imports, exact Node/pnpm engines and package manager, lockfile-pinned approved dependency branches, canonical scripts, pure explicit-input config parser, synthetic validation tests including duplicate admin IDs and process.env isolation with `finally` restoration, separate source/import `rg` proof of no filesystem/Telegram dependency, and build output under `dist/`; `check` runs only applicable non-empty lint/typecheck/unit/build gates while empty suites fail closed without `--passWithNoTests`
  - Review result: `Orchestrator review — PASS (local S0-01 diff and applicable gates); independent Sol max deferred to S0-07`
  - Notes/deviations: No SQLite/schema, Telegram adapter, product module, credential, or production file changes; `pnpm-workspace.yaml` contains only explicit `allowBuilds: esbuild: true`; no `minimumReleaseAgeExclude`, `onlyBuiltDependencies`, `--ignore-scripts`, frozen install, or store override; `typescript-eslint@8.67.0` is an exact stable patch in the approved 8.x branch, without release-age exclusions; no scope deviations
- **Stop conditions:** Required tool version unavailable, repository policy конфликтует с TD или dependency требует неутверждённой архитектуры.

#### S0-02 — Добавить безопасные domain/runtime primitives

- **Status:** `completed`
- **Objective:** Централизовать enums, time/deadline policy, fake clock, UUID/opaque-token generation и redacting JSON logger.
- **Requirements:** Инфраструктура; поддерживает FR-C04, FR-E01, FR-R01, но AC пока не закрывает.
- **Dependencies:** `S0-01`.
- **Read first:** PRD §4–§5, §8.1, §17; Technical Design §5.4, §6, §15, §19.1, §20.1.
- **Preconditions:** Общий preflight; canonical enums сверены с PRD; no schema work.
- **Scope:** Domain value types/validators, `Clock` port/fake, inclusive deadline helpers, UUID/public/callback tokens, hash utilities, JSON logger/redaction tests.
- **Do not touch:** Product aggregates/use cases, DB, grammY handlers, production logging files.
- **Invariants:** Telegram IDs остаются decimal strings; public token 128 bits/base64url; callback token хранится только hash; UTC ms и `Asia/Yekaterinburg`; raw content/contact/tokens/secrets не логируются.
- **Tests first:** Enum rejection; exact 23:59:59.999 conversion and inclusive boundary; deterministic fake time; token entropy/format; logger redaction and safe error serialization.
- **Implementation notes:** Единственный domain declaration справочников; logger принимает только structured safe fields, не arbitrary object dumps.
- **Verification:** `pnpm exec vitest run -t "canonical enums|inclusive deadline|opaque token|logger redaction"`; `pnpm typecheck`; `pnpm lint`.
- **Exit criteria:** Primitives имеют focused coverage; no Telegram/DB imports in domain; secrets/raw content отсутствуют в logger snapshots.
- **Completion evidence:**
  - Commit SHA: `SELF`
  - Changed files: `src/domain/value-objects/enums.ts`, `src/application/ports/clock.ts`, `src/infrastructure/time/fake-clock.ts`, `src/infrastructure/time/deadline.ts`, `src/infrastructure/crypto/tokens.ts`, `src/infrastructure/logging/safe-logger.ts`, `test/unit/s0-02-primitives.test.ts`, `IMPLEMENTATION_PLAN.md`
  - Focused checks: `pnpm exec vitest run -t "canonical enums|inclusive deadline|opaque token|logger redaction"` — 9/9 PASS; `pnpm typecheck` — PASS; `pnpm lint` — PASS; domain/application import-boundary `rg` check — PASS (no grammY/Drizzle/SQLite/process.env/node:fs/framework imports)
  - Aggregate checks: `pnpm check` — PASS (`pnpm lint`, `pnpm typecheck`, `pnpm test:unit` 17/17, `pnpm build`)
  - Acceptance evidence: Canonical PRD enums have one domain declaration with runtime parsers; strict `DD.MM.YYYY` calendar validation rejects rollover and invalid public `LocalDate` components, converting inclusive local end-of-day in `Asia/Yekaterinburg` to UTC ms; mutation/due boundary is proven at `<=`/`>`; defensive fake clock copies dates and rejects non-finite resulting state; UUID, 128-bit unpadded base64url public/callback tokens, deterministic SHA-256 hashes, and batch uniqueness sanity are covered; injected structured logger validates bounded module/event/outcome identifiers, internal/decimal IDs, non-negative durations, exact error allowlists, rejects sensitive/nested/raw values, and serializes errors without message/stack.
  - Review result: `Orchestrator review — PASS (local S0-02 diff and focused/aggregate gates); independent Sol max deferred to S0-07`
  - Notes/deviations: No product aggregates/use cases, DB/schema, grammY handlers, production logging, credentials, or network changes; no scope deviations.
- **Stop conditions:** Enum/date policy расходится с PRD или требуется новый user-visible validation rule.

#### S0-03 — Реализовать SQLite boundary и migration harness

- **Status:** `completed`
- **Objective:** Открывать temporary SQLite с обязательными pragmas/defensive mode, сериализовать nested transactions и применять проверяемую migration history.
- **Requirements:** FR-R01 foundation; AC-019 foundation.
- **Dependencies:** `S0-02`.
- **Read first:** Technical Design §7, §20.2; Node/Drizzle contracts в §2.2.
- **Preconditions:** Общий preflight; проверить текущую schema/migrations (ожидается отсутствие); подтвердить native `node:sqlite` в текущем Node.
- **Scope:** DatabaseBoundary, transaction context, migration runner/history, fresh/upgrade/integrity test harness, `db:migrate` и `db:verify` scripts.
- **Do not touch:** Product tables, PostgreSQL, worker process, production DB path.
- **Invariants:** `foreign_keys=ON`, WAL, busy timeout 5000, defensive mode; no implicit commit; nested repositories reuse transaction; migration failure precedes polling.
- **Tests first:** Fresh bootstrap, repeat migrate no-op, previous-version fixture upgrade, rollback, FK enforcement, nested transaction reuse, migration failure.
- **Implementation notes:** Каждый test получает новую temporary DB; migration files после acceptance не редактируются.
- **Verification:** `pnpm db:verify`; `pnpm exec vitest run -t "fresh migration|upgrade fixture|transaction rollback|foreign keys"`; `pnpm typecheck`.
- **Exit criteria:** Fresh/upgrade paths и integrity_check зелёные; connection closes deterministically; repository root/production path не затронуты.
- **Completion evidence:**
  - Commit SHA: `SELF`
  - Changed files: `package.json`, `src/infrastructure/database/database-boundary.ts`, `src/infrastructure/database/migrations.ts`, `src/cli/db-migrate.ts`, `src/cli/db-verify.ts`, `test/integration/s0-03-database.test.ts`, `IMPLEMENTATION_PLAN.md`
  - Focused checks: `node --version` (`v24.18.0`); `pnpm --version` (`11.15.1`); native `node:sqlite`/`DatabaseSync` smoke — PASS; typed Drizzle `run`/`all`/`get`/`values` parameter-and-result contract plus transaction/FIFO boundary — PASS; `pnpm exec vitest run --project integration -t "fresh migration|upgrade fixture|transaction rollback|foreign keys"` — 3/3 PASS; full integration — 9/9 PASS; explicit temporary `db:migrate` — PASS; `pnpm db:verify` — PASS; `db:migrate` without explicit paths — expected exit 1; `db:verify` with explicit/broad args — expected exit 1; runtime/e2e empty suites remain fail-closed with expected exit 1.
  - Aggregate checks: `pnpm lint` — PASS; `pnpm typecheck` — PASS; `pnpm test:unit` — 17/17 PASS; `pnpm build` — PASS; `pnpm check` — PASS (unit 17/17, integration 9/9).
  - Acceptance evidence: Native `DatabaseSync` opens file-backed paths with timeout 5000, defensive mode, extensions disabled, `foreign_keys=ON`, WAL, and `busy_timeout=5000`; typed Drizzle sqlite-proxy delegates through the exact native client and proves parameterized raw `run` result `{rows: [...]}`, row-list `all`, single-row/undefined `get`, and array `values` shapes; FIFO `AsyncLocalStorage` boundary serializes ordinary awaited facade use, `BEGIN IMMEDIATE` transactions, nested client reuse, rollback-only propagation, deterministic close, and after-close rejection; immutable ordered SQL source validates filenames/gaps, SHA-256 checksums, applied prefix/history, repeat no-op, transactional failure rollback, and upgrade fixtures; verification runs `foreign_key_check` and `integrity_check`; CLIs reject implicit/environment/root paths and `db:verify` uses only temporary fixtures; no product tables/schema, PostgreSQL, worker, or production DB artifacts.
  - Review result: `Orchestrator review — PASS (native DatabaseSync ownership and sqlite-proxy compatibility adapter contract verified); independent Sol max deferred to S0-07`
  - Notes/deviations: Orchestrator-approved compatibility deviation: installed `drizzle-orm@0.45.2` exposes no `node-sqlite` export, so its typed `sqlite-proxy` adapter delegates to the exact native `DatabaseSync`; `DatabaseSync` remains the sole client and transaction owner. No product migrations, credentials, remote, or production files changed.
- **Stop conditions:** Native SQLite/Drizzle contract требует другой stack либо migration окажется destructive.

#### S0-04 — Закрепить durable ingress idempotency и callback safety

- **Status:** `pending`
- **Objective:** Один раз обрабатывать command/update/callback, возвращать safe replay result и отвергать actor/hash conflicts.
- **Requirements:** FR-R01; AC-019 foundation.
- **Dependencies:** `S0-03`.
- **Read first:** Technical Design §5.1, §8.1, §8.10–§8.12, §10.4, §13.5; PRD §7.5, §18.
- **Preconditions:** Общий и schema preflight; актуальные migrations зелёные.
- **Scope:** Полная schema-only таблица `telegram_users` ровно по Technical Design §8.1, `command_receipts`, `processed_updates`, actor-bound `telegram_actions`, repositories/use-case wrappers, retention policy и migrations.
- **Do not touch:** Profiles/topics/platforms, product commands, Telegram UI, moderation behavior.
- **Invariants:** Update/receipt/effect завершаются одной transaction; same ID+same hash replays, different hash conflicts; callback token hashed/actor-bound/versioned/expiring; group/channel actor не создаётся.
- **Tests first:** Duplicate command/update/callback, input-hash conflict, foreign actor, stale version, expired/consumed one-shot, rollback, retention 7 days/50k floor.
- **Implementation notes:** Все `telegram_users` columns/constraints создаются сразу, чтобы S1 не добавлял NOT NULL columns поверх FK fixture rows. S0 использует таблицу только как durable identity/FK foundation; UpsertTelegramUser, snapshot repository и profile behavior остаются S1-01.
- **Verification:** `pnpm db:verify`; `pnpm exec vitest run -t "command replay|input hash conflict|duplicate update|actor-bound callback|retention"`; `pnpm test:integration` focused suite.
- **Exit criteria:** Duplicate paths не создают второго effect; constraints/FKs доказаны fresh DB; replay result versioned и safe.
- **Completion evidence:**
  - Commit SHA: `SELF`
  - Changed files:
  - Focused checks:
  - Aggregate checks: `Deferred to S0-07`
  - Acceptance evidence:
  - Review result:
  - Notes/deviations:
- **Stop conditions:** Нужен product-specific callback payload либо обход actor binding.

#### S0-05 — Создать atomic outbox и product-event stores

- **Status:** `pending`
- **Objective:** Атомарно сохранять business effect companions: delivery intent и idempotent product event.
- **Requirements:** FR-N01, FR-E01, FR-R01 foundation; AC-018/AC-019 foundation.
- **Dependencies:** `S0-04`.
- **Read first:** Technical Design §4.3, §7.2, §8.15, §8.17, §12, §15.3, §19; PRD §16–§17.
- **Preconditions:** Общий и schema preflight; outbox/event taxonomies сверены с PRD/TD.
- **Scope:** `outbox_deliveries`, `product_events`, atomic ports/repositories, semantic idempotency, safe payload validation и migrations.
- **Do not touch:** Actual provider calls, product event emission from future flows, admin UI, notification matrix.
- **Invariants:** Unique semantic keys; statuses включают distinct `cancelled`/`superseded`; events/logs exclude raw content/contact/tokens; transaction rollback removes companions together.
- **Tests first:** Atomic commit/rollback, duplicate keys, forbidden event attributes, invalid transitions, `cancelled` only before provider call.
- **Implementation notes:** Store/ports создаются сейчас; каждый S1–S4 owning flow обязан добавлять свои intents/events в той же transaction, без массового retrofit.
- **Verification:** `pnpm db:verify`; `pnpm exec vitest run -t "outbox atomicity|event idempotency|cancelled delivery"`; focused SQLite integration.
- **Exit criteria:** Schema constraints и atomicity доказаны; raw sensitive payload rejected; никаких внешних вызовов.
- **Completion evidence:**
  - Commit SHA: `SELF`
  - Changed files:
  - Focused checks:
  - Aggregate checks: `Deferred to S0-07`
  - Acceptance evidence:
  - Review result:
  - Notes/deviations:
- **Stop conditions:** Notification/product event требует несуществующего PRD type либо safe envelope невозможно выразить без raw secret/content.

#### S0-06 — Реализовать fake Telegram transport и delivery recovery

- **Status:** `pending`
- **Objective:** Детерминированно dispatch-ить due deliveries через fake Bot API с classification, bounded retry, ambiguity policy, provider deadline и claim fencing.
- **Requirements:** FR-N01, FR-R01, FR-V01 foundation; AC-006, AC-018, AC-019, AC-024 foundation.
- **Dependencies:** `S0-05`.
- **Read first:** Technical Design §11–§14, §20.3–§20.4; PRD §13, §16, §18.
- **Preconditions:** Общий preflight; outbox migrations/transition tests зелёные; реальный BOT_TOKEN отсутствует.
- **Scope:** Telegram port, fake Bot API harness, error classification, concurrency-1 delivery runner, 15s deadline, retry schedule/429, 60s stale recovery, fencing/supersede handling.
- **Do not touch:** grammY long polling, real Telegram, product renderers, publication business lifecycle.
- **Invariants:** No network in DB transaction; ambiguous send never blind-retries; known-target edit/delete retryable; max five known attempts; late stale claim cannot overwrite current outcome.
- **Tests first:** Success, 429, pre-send retryable, 403 permanent, ambiguous send, retryable edit/delete, abort deadline, stale recovery, late outcome fencing, superseded/cancelled claims.
- **Implementation notes:** Fake API records calls/outcomes without Telegram credentials; request/response bodies не логируются целиком.
- **Verification:** `pnpm exec vitest run -t "fake Bot API|ambiguous send|claim fencing|provider deadline|retry_after"`; `pnpm test:runtime` focused runner suite.
- **Exit criteria:** Required outcome matrix deterministic; no duplicate provider call for ambiguous send; recovery/fencing tests pass after simulated crash.
- **Completion evidence:**
  - Commit SHA: `SELF`
  - Changed files:
  - Focused checks:
  - Aggregate checks: `Deferred to S0-07`
  - Acceptance evidence:
  - Review result:
  - Notes/deviations:
- **Stop conditions:** Test requires real Telegram/network или classification невозможно вывести из TD.

#### S0-07 — Завершить runtime lifecycle и S0 gate

- **Status:** `pending`
- **Objective:** Запускать foundation runtime в правильном порядке, исключать второй instance, восстанавливать durable work и завершаться graceful без product modules.
- **Requirements:** FR-R01; AC-019 foundation.
- **Dependencies:** `S0-06`.
- **Read first:** Technical Design §3.2–§3.4, §10.1, §13, §19.2, §20.4, §22 S0.
- **Preconditions:** Общий preflight; все S0 focused suites зелёные; no real Telegram config.
- **Scope:** Runtime health singleton/heartbeat, startup/recovery orchestration, Unix socket admission, in-flight tracking, runner admission, SIGINT/SIGTERM drain, cleanup runner, architecture tests.
- **Do not touch:** Product modules, production LaunchAgent/plist/env, real polling.
- **Invariants:** Socket acquired before DB; only exact stale socket current owner removed; shutdown idempotent, stops admission/claims, aborts calls, drains ≤20s, closes DB; stale health не healthy.
- **Tests first:** Startup order/failure, live/stale socket, symlink/owner refusal, recovery, in-flight update/delivery drain, repeated signal, timeout exit, cleanup retention.
- **Implementation notes:** Runtime uses fake adapter. Independent read-only deep review оценивает весь S0 diff, recovery and architecture boundaries before completion.
- **Verification:** Focused runtime tests; `pnpm db:verify`; `pnpm check`; independent review result `PASS` with no unresolved finding.
- **Exit criteria:** Clean startup/shutdown и crash-recovery доказаны; aggregate gate green; architecture imports valid; S0 review PASS; stage status `completed`.
- **Completion evidence:**
  - Commit SHA: `SELF`
  - Changed files:
  - Focused checks:
  - Aggregate checks: `pnpm check`
  - Acceptance evidence:
  - Review result:
  - Notes/deviations:
- **Stop conditions:** Review finding требует diff вне S0-07; подозрение на DB integrity; socket test затрагивает чужой path/process.

### S1 — Profiles

#### S1-01 — Добавить profile persistence и invariant одного active profile

- **Status:** `pending`
- **Objective:** Сохранить profiles, topics и public platforms поверх durable Telegram identity с future-compatible 1:N history и ровно одним active profile.
- **Requirements:** FR-P01, FR-P02; AC-002, AC-022 foundation.
- **Dependencies:** `S0-07`.
- **Read first:** PRD §4–§7, §19 FR-P01–FR-P03, §20 AC-001–AC-003/AC-022; Technical Design §8.1–§8.4, §20.2, §21.
- **Preconditions:** Общий и schema preflight; полная schema-only `telegram_users` migration из S0 актуальна; identity repository/command и profile tables ещё отсутствуют.
- **Scope:** Telegram user identity snapshot repository/command, profiles/topics/platforms schema, partial UNIQUE active/user, constraints, repositories and validators; migration/upgrade fixture.
- **Do not touch:** Profile UI/wizard, native channel selection, collaborations/applications, contact disclosure query.
- **Invariants:** 1:N history allowed, exactly one active/user; 1–3 canonical topics; ≥1 public platform; private contact separate; city fixed; platform URLs follow TD.
- **Tests first:** All field bounds, topic count, missing platform, Telegram/manual URL matrix, FK/cascade, two concurrent attempts to create second active profile.
- **Implementation notes:** `telegram_users` table не пересоздаётся; S1 добавляет owning behavior поверх S0 FK foundation. Partial profile index снимается только будущей migration вместе с profile switcher.
- **Verification:** `pnpm db:verify`; `pnpm exec vitest run -t "profile constraints|one active profile|platform URL"`; adversarial concurrent SQLite test.
- **Exit criteria:** Fresh/upgrade schema зелёная; SQL и use-case-level constraints agree; race leaves exactly one active profile and no corrupted partial state.
- **Completion evidence:**
  - Commit SHA: `SELF`
  - Changed files:
  - Focused checks:
  - Aggregate checks: `Deferred to S1-03`
  - Acceptance evidence:
  - Review result:
  - Notes/deviations:
- **Stop conditions:** Требуется второй active profile, новый ProfileType/Topic/PlatformType или schema weakening.

#### S1-02 — Реализовать profile commands и visibility projections

- **Status:** `pending`
- **Objective:** Создавать/редактировать active profile и выдавать default-redacted public/private projections без ретроактивной отмены business entities.
- **Requirements:** FR-P01, FR-P02; AC-002, AC-022. Positive accepted-contact authorization завершается в S3-03.
- **Dependencies:** `S1-01`.
- **Read first:** PRD §7.1–§7.5, §10.3, AC-002/AC-013; Technical Design §5.2–§5.3, §8.2–§8.4, §15.3, trace FR-P01/FR-P02.
- **Preconditions:** Общий preflight; profile migrations/validators зелёные; actor policy из S0 доступна.
- **Scope:** CreateProfile/UpdateProfile/GetOwnProfile/GetPublicProfile, active actor guard, current projections, `profile_completed` event.
- **Do not touch:** Accepted pair query, Telegram wizard/menus, applications, block cascade.
- **Invariants:** All fields live-editable; eligibility old applications not rechecked; public result never includes private contact; current profile remains one; event/intents atomic with mutation.
- **Tests first:** Create/update/replay/conflict, live type/contact changes, public redaction, owner view, unauthorized access, concurrent second create, event idempotency, pure policy spy proving no retroactive eligibility callback.
- **Implementation notes:** No snapshot/history feature beyond entity references. До появления collaboration/application schema unit доказывает non-retroactivity как закрытый UpdateProfile contract без downstream eligibility dependency; real populated-DB integration добавляется в S3-02/S3-03.
- **Verification:** Focused unit/SQLite tests for create/update/projections; `pnpm exec vitest run -t "profile projection|live profile edit|profile event|active profile race"`; `pnpm typecheck`.
- **Exit criteria:** Create/update idempotent; public DTO closed/redacted; pure contract не вызывает retroactive eligibility; AC-002 negative visibility evidence saved, real application/contact integration явно deferred to S3-02/S3-03.
- **Completion evidence:**
  - Commit SHA: `SELF`
  - Changed files:
  - Focused checks:
  - Aggregate checks: `Deferred to S1-03`
  - Acceptance evidence:
  - Review result:
  - Notes/deviations:
- **Stop conditions:** Нужен profile archive/delete/switcher либо новый rule о ретроактивной invalidation.

#### S1-03 — Провести deferred profile wizard и S1 acceptance gate

- **Status:** `pending`
- **Objective:** Дать profileless `/start`/feed entry, сохранить deferred wizard через restart, поддержать typed continuation и native Telegram channel choice с manual fallback.
- **Requirements:** FR-P01, FR-P03, FR-R01; AC-001, AC-002, AC-003, AC-019, AC-022.
- **Dependencies:** `S1-02`.
- **Read first:** PRD §7, §15, §18, AC-001–AC-003/AC-019/AC-022; Technical Design §8.9, §10.1–§10.5, §20.3, §22 S1.
- **Preconditions:** Общий preflight; profile commands/projections зелёные; fake Bot API available; no real Telegram credential.
- **Scope:** Profile session schema/state, menu/commands, validation/Back/Cancel/resume, return-to create/apply continuation, `KeyboardButtonRequestChat`/ChatShared binding, manual URL fallback, fake adapter journey, `bot_started` и `profile_started` events в owning transactions.
- **Do not touch:** Collaboration/application creation beyond safe continuation target, real bot/channel, profile switching.
- **Invariants:** `/start` and feed work without profile; flow starts only on create/apply; state persists after each valid step; invalid input keeps prior state; request_id and actor bound; stale target returns safe result.
- **Tests first:** Deferred start, restart/resume, Back/Cancel, unknown session version, continuation create/apply/stale target, native channel with/without username, wrong actor/request ID, manual URL valid/invalid.
- **Implementation notes:** Native selection never assumes bot membership. S1 real-client portion of AC-003 remains pending until S5-06 and is identified as such in evidence.
- **Verification:** Focused fake adapter/restart tests; concurrent profile guard; `pnpm db:verify`; `pnpm check`; S1 acceptance matrix AC-001/002/003/019/022.
- **Exit criteria:** Full fake profile journey and restart green; no private contact leakage; aggregate gate green; S1 stage completed with AC-003 real-smoke caveat explicit.
- **Completion evidence:**
  - Commit SHA: `SELF`
  - Changed files:
  - Focused checks:
  - Aggregate checks: `pnpm check`
  - Acceptance evidence:
  - Review result:
  - Notes/deviations:
- **Stop conditions:** Telegram client capability differs from TD, continuation requires hidden product policy, or test needs real Bot API.

### S2 — Drafts and publication

#### S2-01 — Создать collaboration aggregate и durable draft commands

- **Status:** `pending`
- **Objective:** Сохранять валидируемый incomplete draft, его topics/versioning и atomically стартовать/update его вместе с session/event state.
- **Requirements:** FR-C01, FR-R01; AC-004, AC-021 foundation.
- **Dependencies:** `S1-03`.
- **Read first:** PRD §8.1–§8.2, §11.1 draft transitions, FR-C01; Technical Design §8.5–§8.6, §9.1, §10.3, §20.2.
- **Preconditions:** Общий и schema preflight; active profile flow stable; current migrations green.
- **Scope:** Collaborations/topics schema for draft, aggregate/value validation, Start/Update/CancelCollaborationDraft commands, collaboration_draft_started event, migration/fixtures.
- **Do not touch:** Telegram wizard/render, public token, publication/applications, terminal cancel.
- **Invariants:** Only draft may have incomplete fields; 1–3 topics when present; city/date/slot bounds canonical; `/cancel` hard-deletes draft/topics/session atomically; event history remains; replay safe.
- **Tests first:** Partial step persistence, all field/date bounds, inclusive deadline/date relation, ownership, rollback, hard delete/replay, orphan detection.
- **Implementation notes:** No `cancelled` row for never-published draft; no future application or showcase tables in this migration.
- **Verification:** `pnpm db:verify`; focused aggregate/command SQLite tests; `pnpm exec vitest run -t "collaboration draft|draft cancellation|date policy"`.
- **Exit criteria:** Draft lifecycle and deletion invariants proven fresh DB; no orphan topic/session; event/receipt atomicity green.
- **Completion evidence:**
  - Commit SHA: `SELF`
  - Changed files:
  - Focused checks:
  - Aggregate checks: `Deferred to S2-05`
  - Acceptance evidence:
  - Review result:
  - Notes/deviations:
- **Stop conditions:** Wizard needs format-specific fields, new status, city or giveaway specialization.

#### S2-02 — Реализовать draft wizard, renderer и public deep link

- **Status:** `pending`
- **Objective:** Провести 11-step wizard с Back/Cancel/resume, точным preview/final render и read-only lookup по opaque token.
- **Requirements:** FR-C01, FR-S02, FR-R01; AC-004, AC-009 partial, AC-021.
- **Dependencies:** `S2-01`.
- **Read first:** PRD §8.2–§9.4, §15, §18, AC-004/009/021; Technical Design §6.1, §10.3–§10.7, §20.3.
- **Preconditions:** Общий preflight; draft commands/migrations green; fake adapter ready.
- **Scope:** Persisted collaboration session/screens, Back/Cancel/resume, shared renderer/escaping/UTF-16 limits, preview, token generation, `/start c_<token>` safe read handler.
- **Do not touch:** Actual publication, apply CTA behavior, browse filters, hidden moderation implementation.
- **Invariants:** Preview and target render use one pure contract; invalid input preserves draft; token grants read only and is never logged; unknown/hidden-safe status leaks no reason.
- **Tests first:** Every wizard step/back path, restart/resume/delete, invalid long text, escaping/length, token collision/replay, known/unknown/terminal deep link, foreign callback.
- **Implementation notes:** AC-009 hidden matrix completes in S4-02; collaboration_viewed emission for all card displays is wired in S3-01 after known Telegram success.
- **Verification:** Fake adapter wizard/deep-link tests; renderer snapshots; draft deletion SQLite test; `pnpm exec vitest run -t "draft wizard|render parity|public deep link"`.
- **Exit criteria:** Exact preview parity and restart behavior proven; `/cancel` atomic; token contains no internal ID/mutation authority; partial AC-009 evidence marked.
- **Completion evidence:**
  - Commit SHA: `SELF`
  - Changed files:
  - Focused checks:
  - Aggregate checks: `Deferred to S2-05`
  - Acceptance evidence:
  - Review result:
  - Notes/deviations:
- **Stop conditions:** Telegram limits/API require changing PRD copy/fields or deep link cannot remain opaque/read-only.

#### S2-03 — Реализовать initial publication с known outcomes

- **Status:** `pending`
- **Objective:** Делать карточку public только после known message ID, безопасно retry-ить known failures и истекать без network call после дедлайна.
- **Requirements:** FR-C02, FR-V01, FR-N01, FR-R01; AC-005, AC-019 foundation.
- **Dependencies:** `S2-02`.
- **Read first:** PRD §11.1, §13.1–§13.2, AC-005; Technical Design §8.13–§8.16, §11.1–§11.2, §13.1–§13.2.
- **Preconditions:** Общий и schema preflight; renderer/fake delivery green; showcase tables absent before migration.
- **Scope:** Channel publications/attempts и admin-only `operator_actions` schema, PublishCollaboration, RetryFailedPublication, prepare/claim/known success/retryable/permanent outcomes, safe known-failed deadline expiry, `collaboration_published` event в known-success transaction.
- **Do not touch:** Ambiguous reconciliation, staged edit, applications/feed, real channel.
- **Invariants:** One current generation; no public/feed before known ID; all provider calls after commit; max five known attempts; `cancelled` only before call; inclusive deadline; known-failed/no-post can expire; admin retry reason 1–500 is audited atomically, author retry uses only its command receipt.
- **Tests first:** Atomic prepare, one send/known success, deadline before call/during response, 429/retry/permanent/exhaustion, author/admin known-failed retry with distinct receipt/audit evidence, blocked/late success fence fixture.
- **Implementation notes:** Admin retry audit uses operator action; author retry uses command receipt. No blind retry path for unknown outcome is introduced.
- **Verification:** `pnpm db:verify`; fake API/SQLite publication tests; `pnpm exec vitest run -t "known publication|publication retry|deadline publication"`.
- **Exit criteria:** AC-005 fake evidence; exactly one known post attached; feed visibility success-gated; known failure and expiry state machine closed.
- **Completion evidence:**
  - Commit SHA: `SELF`
  - Changed files:
  - Focused checks:
  - Aggregate checks: `Deferred to S2-05`
  - Acceptance evidence:
  - Review result:
  - Notes/deviations:
- **Stop conditions:** Provider result cannot be classified known vs ambiguous or safe retry would require channel inspection.

#### S2-04 — Закрыть ambiguous publication и reconciliation

- **Status:** `pending`
- **Objective:** Не повторять unknown initial send, показывать durable incident и разрешать attach-or-retry только после аудируемой проверки.
- **Requirements:** FR-C02, FR-V01, FR-N01, FR-R01; AC-006, AC-019, AC-024.
- **Dependencies:** `S2-03`.
- **Read first:** PRD §11.1, §13.2, §14.2, AC-006/024; Technical Design §8.14–§8.16, §11.2, §12–§14.
- **Preconditions:** Общий preflight; known outcome state machine/tests green; operator audit foundation exists.
- **Scope:** Ambiguous status/fencing, durable admin incidents/fan-out, ListAdminIncidents minimum query, ReconcilePublicationFound, ConfirmOrphanRemovedAndRetry, deadline late-outcome handling и direct authoritative-state/generation fence fixtures.
- **Do not touch:** Actual CancelCollaboration/BlockUser commands, general `/admin` UX, hide/restore, staged edit, real Telegram reconciliation.
- **Invariants:** No automatic resend; unresolved ambiguity never auto-expires; found ID must be controlled by known edit/not-modified; new generation only after orphan absence/removal; tokens/raw content absent from incident.
- **Tests first:** Timeout after possible send, restart no retry, found valid/invalid ID, orphan confirmed retry, deadline on both branches, injected cancelled/inactive-author generation fences, incident duplicate/fan-out/audit.
- **Implementation notes:** Minimum admin action can use fake operator port; complete admin menu arrives S4-02. Safe internal UUID is incident reference.
- **Verification:** Fake API/runtime/SQLite reconciliation suite; restart recovery; `pnpm exec vitest run -t "ambiguous publication|publication reconciliation|orphan retry"`.
- **Exit criteria:** AC-006/024 automated evidence saved; attempt DAG cannot fork while ambiguous; every admin decision audited; late success never resurrects state.
- **Completion evidence:**
  - Commit SHA: `SELF`
  - Changed files:
  - Focused checks:
  - Aggregate checks: `Deferred to S2-05`
  - Acceptance evidence:
  - Review result:
  - Notes/deviations:
- **Stop conditions:** Reconciliation needs blind send, token logging or unverified post attachment.

#### S2-05 — Реализовать staged edit, own cards и S2 gate

- **Status:** `pending`
- **Objective:** Изменять published terms только через durable staged revision до первого application и показывать author history через authoritative queries.
- **Requirements:** FR-C01, FR-C03, FR-V01, FR-R01; AC-004, AC-007, AC-019, AC-021, AC-024 stage gate.
- **Dependencies:** `S2-04`.
- **Read first:** PRD §8.3–§8.4, §13.3, §14.2, §15, AC-007; Technical Design §5.2–§5.3, §8.5, §8.16, §11.3–§11.4, §20.2–§20.5, §22 S2.
- **Preconditions:** Общий preflight; publication known/ambiguous paths и operator audit зелёные; no application implementation yet.
- **Scope:** EditPublishedCollaboration/ReconcilePublishedEdit apply/rollback, pending snapshot/action lock, own collaboration query/UI, coalesced relevant projection, S2 restart/publication journey.
- **Do not touch:** SubmitApplication implementation, slot/terminal sync, completion/moderation.
- **Invariants:** Active version stays old until known edit success; failure preserves/rolls back deterministically; ambiguous locks mutations; first_application_at once set forbids edit; no business rollback from outbound failure; ReconcilePublishedEdit admin-only и атомарно пишет reason 1–500, safe before/after, command ID.
- **Tests first:** Staged success/permanent/retry exhaustion/ambiguous/crash, apply/rollback admin authority/audit/reason bounds, stale generation, fixture with first_application_at, injected terminal/hidden generation fence, own-list redaction/restart.
- **Implementation notes:** S3-02 adds the real first-application integration test, а S3-04/S4-02 добавляют actual cancel/hide command races; S2 использует только direct schema/state fixtures и не реализует будущие commands.
- **Verification:** Focused staged-edit and restart tests; `pnpm db:verify`; `pnpm check`; S2 AC matrix AC-004/005/006/007/009(partial)/019/021/024.
- **Exit criteria:** S2 fake journey green; active/pending version never diverge from known post; every admin reconciliation audited atomically; aggregate gate green; stage status completed.
- **Completion evidence:**
  - Commit SHA: `SELF`
  - Changed files:
  - Focused checks:
  - Aggregate checks: `pnpm check`
  - Acceptance evidence:
  - Review result:
  - Notes/deviations:
- **Stop conditions:** Edit semantics need changing PRD freeze policy or review finds publication invariant outside unit scope.

### S3 — Feed and applications

#### S3-01 — Реализовать feed, browse session и view event

- **Status:** `pending`
- **Objective:** Детерминированно выдавать public cards по трём фильтрам/keyset, сохранять 24h browse state и учитывать только известные Telegram exposures.
- **Requirements:** FR-S01, FR-S02, FR-E01, FR-R01; AC-008 partial, AC-009 partial, AC-019.
- **Dependencies:** `S2-05`.
- **Read first:** PRD §9, §17, §18, AC-008/009/019; Technical Design §5.3, §8.9, §9.12, §10.6, §20.2–§20.3.
- **Preconditions:** Общий preflight; published/deep-link projections green; applications table ещё отсутствует.
- **Scope:** Browse query/policies, filters, keyset cursor, seen IDs/TTL/reset, feed UI, post-send/edit `collaboration_viewed`, current visibility recheck.
- **Do not touch:** Application create/withdraw, decisions, moderation, recommendations/saved filters.
- **Invariants:** AND semantics; exact format/topic membership/target+any; sort `published_at DESC,id DESC`; own/status/slots/deadline/session exclusions; duplicate/ambiguous Telegram outcome no view event.
- **Tests first:** Filter combinations, stable pagination/ties, own/closed/full/expired/seen exclusion, reset/TTL/restart, concurrent disappearance, deep-link independence, known success/failure/ambiguous view event.
- **Implementation notes:** Already-applied exclusion is connected and finally proven in S3-02 when applications schema exists; AC-008 remains partial here.
- **Verification:** Focused query snapshots, session/restart and fake adapter view tests; `pnpm exec vitest run -t "browse filters|keyset|browse session|collaboration viewed"`.
- **Exit criteria:** All available feed predicates/keyset/session behavior deterministic; exposure metric follows PRD; explicit pending evidence only for already-applied and hidden cases.
- **Completion evidence:**
  - Commit SHA: `SELF`
  - Changed files:
  - Focused checks:
  - Aggregate checks: `Deferred to S3-05`
  - Acceptance evidence:
  - Review result:
  - Notes/deviations:
- **Stop conditions:** Нужен новый filter/ranking/recommendation или analytics semantics beyond PRD.

#### S3-02 — Добавить applications, submit/withdraw и own list

- **Status:** `pending`
- **Objective:** Создать ровно один version-bound application на card/profile, разрешить только pending withdrawal и показать authoritative own applications.
- **Requirements:** FR-A01, FR-C03, FR-S01, FR-R01; AC-007, AC-008, AC-010, AC-019.
- **Dependencies:** `S3-01`.
- **Read first:** PRD §8.4, §9.3, §10.1, §11.2, §15, AC-007/008/010; Technical Design §8.7, §9.2–§9.3, §20.2, trace FR-A01.
- **Preconditions:** Общий и schema preflight; feed partial predicates noted; staged edit freeze contract green.
- **Scope:** Applications schema/repository, SubmitApplication, WithdrawApplication, own list/UI, first_application_at integration, author notification intent, application_submitted event, already-applied feed exclusion.
- **Do not touch:** Accept/reject/contact, slots transitions, retry after withdrawn/rejected.
- **Invariants:** UNIQUE collaboration/profile forever; eligibility checked at submit with current profile type; inclusive deadline; first_application_at once, edit forever frozen; withdraw serialized/pending/owner only; event/notification atomic.
- **Tests first:** All submit guards, duplicate update/command, type any/exact, own/full/deadline/sync lock, first application vs staged edit race, withdraw vs terminal race, already-applied feed exclusion, restart/own list.
- **Implementation notes:** First committed serialized operation determines withdraw/close/decision race; loser returns current safe state without overwrite.
- **Verification:** `pnpm db:verify`; focused application/feed/freeze integration; `pnpm exec vitest run -t "submit application|withdraw application|first application freeze|already applied"`.
- **Exit criteria:** AC-007/008/010 complete automated evidence; duplicate/replay no second application/event/DM; migrations/integrity green.
- **Completion evidence:**
  - Commit SHA: `SELF`
  - Changed files:
  - Focused checks:
  - Aggregate checks: `Deferred to S3-05`
  - Acceptance evidence:
  - Review result:
  - Notes/deviations:
- **Stop conditions:** Product asks repeat application, accepted withdrawal or applicant message fields outside PRD.

#### S3-03 — Реализовать atomic decisions и pairwise contact

- **Status:** `pending`
- **Objective:** Атомарно accept/reject applications без переполнения slots и раскрывать текущие контакты только конкретной accepted pair.
- **Requirements:** FR-A02, FR-A03, FR-C04, FR-N01, FR-E01; AC-002 positive part, AC-011, AC-012 partial, AC-013, AC-019.
- **Dependencies:** `S3-02`.
- **Read first:** PRD §10.2–§10.4, §11, §16, AC-011–AC-013; Technical Design §5.3, §9.4–§9.6, §15.3, §20.1–§20.2.
- **Preconditions:** Общий preflight; submit/withdraw and first_application freeze green.
- **Scope:** DecideApplication accept/reject, serialized slot policy, last-slot cascade, pairwise contact query/projections, decision callbacks/intents, `application_accepted` и last-slot `collaboration_matched` events.
- **Do not touch:** Manual close/cancel/deadline, block admin command, completion reports.
- **Invariants:** accepted ≤ slots; duplicate callback replays; last slot matches and closes remaining pending; reject only chosen row; blocked/inactive applicant closes without contact; accepted partners isolated from each other; current contact only authorized pair.
- **Tests first:** Two concurrent accepts last slot, accept/reject/withdraw races, replay/stale/foreign callback, blocked applicant fixture, multi-slot contact matrix including live profile edit, failed DM after commit.
- **Implementation notes:** Block/accept full committed-order race completes in S4-03; current guard is exercised with pre-blocked fixture only.
- **Verification:** Adversarial concurrent SQLite promises; pairwise authorization unit/E2E fixture; fake DM failure; `pnpm exec vitest run -t "last slot|pairwise contact|decide application"`.
- **Exit criteria:** AC-011/013 and last-slot half AC-012 proven; no overfill/contact leak under concurrency/replay; AC-002 positive accepted projection evidence saved.
- **Completion evidence:**
  - Commit SHA: `SELF`
  - Changed files:
  - Focused checks:
  - Aggregate checks: `Deferred to S3-05`
  - Acceptance evidence:
  - Review result:
  - Notes/deviations:
- **Stop conditions:** Contact must be exposed before accepted or accepted application must become self-service reversible.

#### S3-04 — Закрыть recruitment lifecycle и showcase synchronization

- **Status:** `pending`
- **Objective:** Сохранять authoritative manual/cancel/deadline transitions и синхронизировать latest public projection без отката от outbound failures.
- **Requirements:** FR-C04, FR-V01, FR-N01, FR-R01; AC-012, AC-014, AC-018, AC-019, AC-025.
- **Dependencies:** `S3-03`.
- **Read first:** PRD §10.4, §11, §13.3, §16, §18, AC-012/014/018/025; Technical Design §9.6–§9.8, §11.4, §12, §13.2.
- **Preconditions:** Общий preflight; decision/contact tests green; fake clock/runner active.
- **Scope:** CompleteRecruitment, CancelCollaboration, ExpireDueCollaborations/catch-up, pending closure, projection_revision/coalesced latest edit, notification matrix for S3 transitions, manual/deadline `collaboration_matched` event.
- **Do not touch:** Completion reports, moderation, full analytics/funnel, real scheduler/Telegram.
- **Invariants:** Manual close requires ≥1 accepted; deadline now>instant yields matched or expired; hidden due not yet present; accepted/contact survive cancel; DB decision survives failed DM/showcase; every slots/status change increments projection.
- **Tests first:** Manual close, cancel published/matched, deadline with/without accepted, exact inclusive boundary, sleep/restart catch-up, every intermediate slot render, edit coalescing/fencing, DM/showcase known/ambiguous failures.
- **Implementation notes:** `sync_ambiguous` locks ordinary actions per TD, but cancel/deadline remain authoritative exceptions and avoid blind call.
- **Verification:** Fake-clock SQLite/runtime tests; projection snapshots; failed outbound scenarios; `pnpm exec vitest run -t "complete recruitment|cancel collaboration|deadline catch-up|projection revision"`.
- **Exit criteria:** AC-012/014/018/025 evidence complete; business state remains queryable/current after outbound failure; no stale projection overwrites latest.
- **Completion evidence:**
  - Commit SHA: `SELF`
  - Changed files:
  - Focused checks:
  - Aggregate checks: `Deferred to S3-05`
  - Acceptance evidence:
  - Review result:
  - Notes/deviations:
- **Stop conditions:** Deadline/close policy conflicts with PRD or provider failure would require business rollback.

#### S3-05 — Доказать core marketplace journey и пройти S3 review

- **Status:** `pending`
- **Objective:** Пройти fake journey author + two candidates до matched/pairwise contacts/restart без duplicate effects и независимо проверить S0–S3 architecture.
- **Requirements:** FR-P01, FR-P02, FR-P03, FR-C01, FR-C02, FR-C03, FR-C04, FR-S01, FR-S02, FR-A01, FR-A02, FR-A03, FR-V01, FR-N01, FR-E01, FR-R01; AC-001, AC-002, AC-003 fake, AC-004, AC-005, AC-006, AC-007, AC-008, AC-009 partial, AC-010, AC-011, AC-012, AC-013, AC-014, AC-018, AC-019, AC-021, AC-022, AC-024, AC-025.
- **Dependencies:** `S3-04`.
- **Read first:** PRD §2–§3, §18–§21; Technical Design §20.5, §21, §22 S3, §24.
- **Preconditions:** Общий preflight; all S3 focused suites green; no S4 behavior claimed.
- **Scope:** Core fake E2E fixture/report, adversarial replay/restart assertions, aggregate gates, independent read-only deep review; only in-scope fixes.
- **Do not touch:** Completion/moderation/funnel UI, real Telegram, production ops.
- **Invariants:** Journey ends at matched/contact/restart; it is not full PRD MVP; no hidden/blocked/completion assertions except fixtures already needed for guards.
- **Tests first:** Author 2-slot publish; feed/deep-link candidates; submit; concurrent decisions; pairwise contact; post matched; restart; duplicate update/callback produces no duplicate business/event/delivery effects.
- **Implementation notes:** Independent reviewer checks ports/layers, transaction/outbox/event atomicity, state machines, privacy and diff scope. Outside-scope finding blocks stage and requires plan amendment.
- **Verification:** `pnpm test:e2e:fake` core journey; concurrency/restart suites; `pnpm db:verify`; `pnpm check`; independent review `PASS`.
- **Exit criteria:** Core marketplace evidence reproducible from fresh DB; aggregate green; review PASS; S3 completed; Functional MVP/Pilot ready not claimed.
- **Completion evidence:**
  - Commit SHA: `SELF`
  - Changed files:
  - Focused checks:
  - Aggregate checks: `pnpm check`
  - Acceptance evidence:
  - Review result:
  - Notes/deviations:
- **Stop conditions:** Core journey can pass only by using S4 behavior or review finds unresolved issue outside this unit.

### S4 — Completion, moderation and analytics

#### S4-01 — Реализовать completion reports и единственный reminder

- **Status:** `pending`
- **Objective:** Завершать matched collaboration, собирать pairwise outcomes и создавать bilateral event ровно при двух `happened` с максимум одним 72h reminder.
- **Requirements:** FR-O01, FR-N01, FR-E01, FR-R01; AC-015, AC-019, AC-023.
- **Dependencies:** `S3-05`.
- **Read first:** PRD §12, §16–§18, AC-015/023; Technical Design §8.8, §9.11, §13.3, §20.1–§20.2.
- **Preconditions:** Общий и schema preflight; accepted pair/contact lifecycle green.
- **Scope:** Completion reports migration/repository, CompleteCollaboration/ReportCompletion, prompt intents, `Ответить позже`, one scheduled reminder, `completion_reported` и `collaboration_bilateral_confirmed` events/projection.
- **Do not touch:** Ratings/comments/reputation/arbitration, moderation, real scheduler.
- **Invariants:** Only author completes; only accepted pair reporters; UNIQUE application/reporter; negative/mismatch stored; bilateral event once only for two happened; final answer supersedes unclaimed reminder.
- **Tests first:** Per-pair prompts in multi-slot, reporter authorization/replay, two positive, negative/negative, mismatches, simultaneous reports, later/reminder uniqueness/supersede/restart, no rating question.
- **Implementation notes:** Reminder uses semantic outbox key from TD and ordinary delivery runner; no external cron.
- **Verification:** `pnpm db:verify`; completion SQLite/fake adapter/fake-clock tests; `pnpm exec vitest run -t "completion report|bilateral confirmed|completion reminder"`.
- **Exit criteria:** AC-015/023 complete; no duplicate bilateral event/reminder; all reports survive restart and retain pair isolation.
- **Completion evidence:**
  - Commit SHA: `SELF`
  - Changed files:
  - Focused checks:
  - Aggregate checks: `Deferred to S4-04`
  - Acceptance evidence:
  - Review result:
  - Notes/deviations:
- **Stop conditions:** Product asks rating/comment/arbitration or more than one reminder.

#### S4-02 — Реализовать admin incidents, hide и success-gated restore

- **Status:** `pending`
- **Objective:** Дать allowlisted admin безопасный audit-backed интерфейс incidents/hide/delete/reconcile/restore без двойного showcase post.
- **Requirements:** FR-M01, FR-V01, FR-N01, FR-R01, FR-S02; AC-009, AC-016, AC-018, AC-019.
- **Dependencies:** `S4-01`.
- **Read first:** PRD §11.1, §13.3, §14, §16, AC-009/016; Technical Design §5.2–§5.3, §8.13–§8.16, §9.10, §11.5.
- **Preconditions:** Общий preflight; operator audit/publication reconciliation foundation green; admin IDs fake-configured.
- **Scope:** `/admin` entry/incidents lookup, hide/delete states, ReconcileHiddenDeletion, restore attempt/send fencing, audits/notifications, hidden deep-link matrix, `collaboration_hidden` event.
- **Do not touch:** User reports/premoderation, block cascade, real admin/Telegram resources.
- **Invariants:** Numeric allowlist authority; public token/internal UUID/numeric author ID lookup; username display-only; reason 1–500; hide authoritative despite delete failure; restore waits proven delete and known new send success; old ID never reused.
- **Tests first:** Active/terminal hide, pending closure, accepted preservation, delete success/not-found/retry/ambiguous, forbidden early restore, restore success/failure/ambiguity/deadline/inactive author, late fenced result, unknown/hidden token neutral.
- **Implementation notes:** Incident DM fan-out is derivative; durable `/admin` query is truth. No raw reason in public response/log.
- **Verification:** Fresh DB moderation fixtures; fake create/delete/restore outcomes; deep-link E2E; `pnpm exec vitest run -t "hide collaboration|restore collaboration|admin incidents"`.
- **Exit criteria:** AC-009/016 complete fake evidence; no path creates two active posts; every admin mutation audited; terminal business state preserved.
- **Completion evidence:**
  - Commit SHA: `SELF`
  - Changed files:
  - Focused checks:
  - Aggregate checks: `Deferred to S4-04`
  - Acceptance evidence:
  - Review result:
  - Notes/deviations:
- **Stop conditions:** Restore requires blind send, delete cannot be proven or admin lookup needs username authority.

#### S4-03 — Реализовать block/unblock cascade и block/accept race

- **Status:** `pending`
- **Objective:** Атомарно запретить blocked user mutations, скрыть/закрыть его active work и сохранить committed accepted rights по serialization-winner policy.
- **Requirements:** FR-M02, FR-A02, FR-A03, FR-V01, FR-N01, FR-E01, FR-R01; AC-017, AC-019, AC-026.
- **Dependencies:** `S4-02`.
- **Read first:** PRD §7.5, §14.2, §18, AC-017/026; Technical Design §5.1, §9.4, §9.9, §15.1, §20.2.
- **Preconditions:** Общий preflight; hide/delete and decision use cases share serialized DatabaseBoundary.
- **Scope:** Global RequireActiveActor completion, BlockUser/UnblockUser, cascades/audit/intents, `user_blocked` event, in-flight publication fencing, adversarial block/accept tests.
- **Do not touch:** Ban appeals, auto-unhide/resurrection, user complaints, rate limits.
- **Invariants:** `/start`/`/help`/own history/accepted contacts remain read-only available; all mutations blocked; publishing cancelled/late success deleted; active cards hidden; pending both directions closed; accepted/contact never revoked; unblock revives nothing.
- **Tests first:** Mutation matrix, block cascades published/matched/publishing/hidden, late send/restore, accepted preservation, block-first vs accept-first concurrent promises, duplicate block/unblock, multi-profile future fixture.
- **Implementation notes:** Race winner is first committed serialized transaction, not callback arrival; losing command returns current safe state.
- **Verification:** Adversarial SQLite E2E both orderings; fake publication late result; mutation matrix; `pnpm exec vitest run -t "block cascade|block accept race|blocked actor"`.
- **Exit criteria:** AC-017/026 complete; no contact leak/revocation/resurrection; all cascades/audits/intents atomic and replay-safe.
- **Completion evidence:**
  - Commit SHA: `SELF`
  - Changed files:
  - Focused checks:
  - Aggregate checks: `Deferred to S4-04`
  - Acceptance evidence:
  - Review result:
  - Notes/deviations:
- **Stop conditions:** Policy demands undoing accepted/contact rights or changing first-commit winner semantics.

#### S4-04 — Завершить analytics/notifications и доказать Functional MVP

- **Status:** `pending`
- **Objective:** Доказать полную event/notification taxonomy, построить read-only funnel и пройти comprehensive fake journey с completion/moderation/restart.
- **Requirements:** FR-P01, FR-P02, FR-P03, FR-C01, FR-C02, FR-C03, FR-C04, FR-S01, FR-S02, FR-A01, FR-A02, FR-A03, FR-O01, FR-V01, FR-M01, FR-M02, FR-N01, FR-E01, FR-R01; AC-001, AC-002, AC-003 fake, AC-004, AC-005, AC-006, AC-007, AC-008, AC-009, AC-010, AC-011, AC-012, AC-013, AC-014, AC-015, AC-016, AC-017, AC-018, AC-019, AC-021, AC-022, AC-023, AC-024, AC-025, AC-026.
- **Dependencies:** `S4-03`.
- **Read first:** PRD §3.3, §16–§21; Technical Design §12, §19.3, §20.5, §21, §22 S4, §24.
- **Preconditions:** Общий preflight; all S4 focused suites green; AC-020 and real evidence explicitly excluded.
- **Scope:** Product-event coverage verifier без deferred flow wiring, только недостающие notification intents, CalculatePilotFunnel SQL/CLI, full fake journey steps 1–9, notification failure fixtures, aggregate gate and stage review.
- **Do not touch:** External analytics SDK, real Telegram/LaunchAgent/backups, numerical go/no-go thresholds.
- **Invariants:** Events safe/idempotent; funnel derives authoritative state; DM failure never rolls back decisions; comprehensive journey includes completion/hide/block/restart; no AC-020 claim.
- **Tests first:** Event taxonomy/forbidden payload/duplicate keys, funnel snapshot including time-to-first response/bilateral, every notification recipient/content/failure, full fake E2E and restart no duplicate.
- **Implementation notes:** Все product events уже должны создаваться owning flow units. Найденный пропуск является обязательным gate failure: unit/stage останавливается для явной поправки плана или отдельного repair unit; этот commit не amend-ит завершённый predecessor и не делает массовый retrofit.
- **Verification:** Product-event coverage check; funnel snapshot; full notification matrix; `pnpm test:e2e:fake`; `pnpm db:verify`; `pnpm check`; review of readiness claims.
- **Exit criteria:** All 19 FR implemented locally; AC-001–AC-019 and AC-021–AC-026 have automated fake/SQLite evidence; full §20.5 journey green; S4 completed as Functional MVP/fake-pilot ready; AC-020 pending.
- **Completion evidence:**
  - Commit SHA: `SELF`
  - Changed files:
  - Focused checks:
  - Aggregate checks: `pnpm check`
  - Acceptance evidence:
  - Review result:
  - Notes/deviations:
- **Stop conditions:** Найден пропущенный owning-flow event; funnel requires new product metric/policy; full journey needs real Telegram; unresolved AC lacks non-unit evidence.

### S5 — Production operations

#### S5-01 — Реализовать production-boundary preflight

- **Status:** `pending`
- **Objective:** Fail closed проверять exact external env file, bot identity и showcase capabilities до любых real Bot API mutations.
- **Requirements:** FR-V01, FR-R01; подготовка AC-020.
- **Dependencies:** `S4-04`.
- **Read first:** Technical Design §3.2, §11.1, §14–§16, §20.4/§20.6; PRD §13, §18.
- **Preconditions:** Общий preflight; Functional MVP fake gate green; только synthetic temp env/fake API, без real credentials.
- **Scope:** External file path/type/owner/mode/content validator, database parent safety, `getMe` expected ID/username check, channel ID/admin/post/edit/delete capability, degraded state/recheck.
- **Do not touch:** Real production.env, BotFather/channel, LaunchAgent install, application features.
- **Invariants:** All filesystem/identity/capability checks precede mutation/polling; wrong identity fatal; lost channel rights blocks publish/restore only; no token in output/log.
- **Tests first:** Non-file/symlink/wrong owner/mode, missing/invalid content, repo DB path, wrong getMe, missing permissions, degraded/read-only/recovery, zero mutations before failure.
- **Implementation notes:** Evidence identity binds `getMe.id`, normalized username, channel ID and exact env checksum; no APP_ENV.
- **Verification:** Temp filesystem + fake Bot API preflight/runtime tests; `pnpm exec vitest run -t "production preflight|wrong bot identity|showcase degraded"`; `pnpm typecheck`.
- **Exit criteria:** Preflight paths fail closed and disclose no secret; degraded mode observable; no external file/resource created.
- **Completion evidence:**
  - Commit SHA: `SELF`
  - Changed files:
  - Focused checks:
  - Aggregate checks: `Deferred to S5-06`
  - Acceptance evidence:
  - Review result:
  - Notes/deviations:
- **Stop conditions:** Test would need real token/channel, filesystem rule conflicts with TD, or preflight cannot precede mutation.

#### S5-02 — Реализовать bot LaunchAgent, status и log lifecycle

- **Status:** `pending`
- **Objective:** Генерировать и безопасно управлять exact bot job, status/log tail и stopped-only rotation без shell/pnpm/secrets.
- **Requirements:** FR-R01; подготовка AC-020.
- **Dependencies:** `S5-01`.
- **Read first:** Technical Design §3.3–§3.4, §13.4, §17.1–§17.5, §19.2, §20.4/§20.6.
- **Preconditions:** Общий preflight; production preflight green in temp fixtures; actual `launchctl` forbidden.
- **Scope:** Ops CLI/dry-run for bot plist install/start/stop/restart/status/logs/rotate/uninstall, absolute Node/env/dist resolution, launchd adapter port, temp fixture tests.
- **Do not touch:** Actual user LaunchAgents, backup job implementation until S5-03, production logs/process, Giveaway labels.
- **Invariants:** Exact Collaboration labels/paths; no shell/pnpm/token in plist; all checks before write/bootstrap; bounded tail; >2m stale not healthy; rotate only two exact files, stopped, 0600, generations 1–5; uninstall preserves data.
- **Tests first:** Plist snapshot, wrong paths/versions, preflight-before-write, start/stop/restart exact targets, status live/stale, bounded logs, rotation running refusal/generations, noncollision.
- **Implementation notes:** Final `install` remains fail closed until S5-03 supplies verified backup job artifact because TD install registers both jobs atomically.
- **Verification:** Ops unit/integration tests entirely under temp dirs/fake launchd; `pnpm exec vitest run -t "LaunchAgent|status|log rotation"`.
- **Exit criteria:** Bot job lifecycle dry-run deterministic; no external mutation; paths/labels cannot target Giveaway Bot; two-job install incomplete state rejected.
- **Completion evidence:**
  - Commit SHA: `SELF`
  - Changed files:
  - Focused checks:
  - Aggregate checks: `Deferred to S5-06`
  - Acceptance evidence:
  - Review result:
  - Notes/deviations:
- **Stop conditions:** Requires launchctl/real paths, exact Node unavailable, or generated plist could include secret/shell/package manager.

#### S5-03 — Реализовать backup commands и backup LaunchAgent

- **Status:** `pending`
- **Objective:** Создавать, проверять, перечислять и безопасно prune-ить consistent SQLite snapshots с mutex/catch-up и вторым exact LaunchAgent job.
- **Requirements:** FR-R01; подготовка AC-020.
- **Dependencies:** `S5-02`.
- **Read first:** Technical Design §17.2–§17.3, §18.1–§18.2, §20.2/§20.6.
- **Preconditions:** Общий preflight; bot job dry-run green; all backup tests use temp DB/directory.
- **Scope:** `create`, `create-if-due`, `list`, `verify`, `prune`, operation socket, VACUUM INTO/manifest/checksum/integrity/fsync/rename, retention/partial cleanup, backup plist and atomic two-job install dry-run.
- **Do not touch:** Production DB/backups/LaunchAgents, restore replacement, off-device backup.
- **Invariants:** Never copy active main alone; partial not backup; mutex safe stale recovery; no-op <23h; keep 14 verified daily snapshots; prune accepts no arbitrary path and never source DB; exact backup label.
- **Tests first:** Active WAL snapshot consistency, interruption/partial, checksum/integrity corruption, mutex live/stale/symlink, due/catch-up, strict retention/prune/partial older-24h, plist/two-job preflight.
- **Implementation notes:** Partial cleanup only exact regular current-owner non-symlink files in backup dir; deletion targets enumerated and classified before mutation.
- **Verification:** Temp active-WAL backup integration; verify/prune safety tests; backup plist snapshots; `pnpm exec vitest run -t "backup|create-if-due|backup mutex|prune"`.
- **Exit criteria:** Snapshot/manifest verifiable and crash-safe; destructive target guards proven; both job artifacts pass dry-run; no real file outside temp.
- **Completion evidence:**
  - Commit SHA: `SELF`
  - Changed files:
  - Focused checks:
  - Aggregate checks: `Deferred to S5-06`
  - Acceptance evidence:
  - Review result:
  - Notes/deviations:
- **Stop conditions:** Test target could resolve to production/repository root, deletion classification incomplete, or consistent snapshot requires stopping real bot.

#### S5-04 — Реализовать sidecar-safe restore rehearsal и runbook

- **Status:** `pending`
- **Objective:** Доказать восстановление копии SQLite без stale WAL/SHM и описать human-approved production procedure, не автоматизируя замену production DB.
- **Requirements:** FR-R01; подготовка AC-020.
- **Dependencies:** `S5-03`.
- **Read first:** Technical Design §17.4, §18.3, §20.2/§20.6; этот план §2.6.
- **Preconditions:** Общий preflight; verified temp backup available; explicit non-production target required.
- **Scope:** `pnpm ops:restore -- rehearse <backup> --target <explicit-temp-dir>`, restore validation/migration/read-only smoke tooling, documented stop/PID/open-FD/quarantine/install/restart runbook.
- **Do not touch:** Configured production DB, real LaunchAgents/processes, quarantine deletion, automatic rollback/down-migration.
- **Invariants:** Main/WAL/SHM handled as recoverable set; checksum/manifest/integrity before install; forward migrations only; checkpoint truncate → DELETE → close/no sidecars; same-filesystem atomic rename; failure preserves quarantine.
- **Tests first:** Backup corruption, open handle/refusal, sidecar set, migration failure, integrity/smoke failure, stale target paths, successful rehearsal and atomic install under temp fixture.
- **Implementation notes:** CLI refuses configured production path and broad/root targets. Production restore remains a manual separately authorized runbook action.
- **Verification:** Rehearsal on fresh temp copy; post-restore integrity/FK/schema/read-only queries; absence/zero WAL and no SHM; `pnpm exec vitest run -t "restore rehearsal|WAL sidecar"`.
- **Exit criteria:** Simulated rehearsal reproducible; failure never destroys original fixture; runbook contains exact abort/recovery boundaries; no real service stopped.
- **Completion evidence:**
  - Commit SHA: `SELF`
  - Changed files:
  - Focused checks:
  - Aggregate checks: `Deferred to S5-06`
  - Acceptance evidence:
  - Review result:
  - Notes/deviations:
- **Stop conditions:** Target may be production, open-FD/PID absence cannot be proven, or destructive restore is requested without new authorization.

#### S5-05 — Зафиксировать отдельно авторизованные test resources и exact identity

- **Status:** `pending`
- **Objective:** После отдельной авторизации проверить dedicated test bot/channel/admin/env и сохранить redacted identity/capability evidence без credentials в Git/logs.
- **Requirements:** Подготовка AC-020; product code не добавляется.
- **Dependencies:** `S5-04`.
- **Read first:** PRD §13–§14; Technical Design §15–§17.1, §20.6; этот план §2.2/§2.6/§7.
- **Preconditions:** Остановиться и получить отдельную явную авторизацию/предоставленные resources; inventory Giveaway Bot identity/process/DB/posts read-only before action.
- **Scope:** Exact external 0600 env inspection, getMe ID/username, channel ID/username/admin capabilities, admin IDs and redacted evidence document/plan evidence.
- **Do not touch:** BotFather/channel creation без отдельной команды, committed credentials/env, Giveaway Bot, application code, LaunchAgent install.
- **Invariants:** Dedicated identity differs from Giveaway; token never printed/stored; canonical label readiness bound to exact getMe/channel/env checksum; any change invalidates evidence.
- **Tests first:** Предварительно составить redaction/non-interference checklist и expected identity assertions; не делать probe mutation до successful preflight.
- **Implementation notes:** Stage launch сам по себе не авторизует external resource creation. Если resources отсутствуют, unit становится `blocked`, а stage не переходит к S5-06.
- **Verification:** File owner/mode/content without token output; getMe exact match; read-only channel membership/capability checks where possible; before/after Giveaway inventory unchanged.
- **Exit criteria:** Redacted evidence identifies exact test topology; required rights confirmed; no secret/user content in diff/log; commit changes only evidence/plan docs.
- **Completion evidence:**
  - Commit SHA: `SELF`
  - Changed files:
  - Focused checks:
  - Aggregate checks: `Deferred to S5-06`
  - Acceptance evidence:
  - Review result:
  - Notes/deviations:
- **Stop conditions:** Нет explicit authorization/resources, identity overlaps Giveaway, rights incomplete, env permissions unsafe or secret appears in output/diff.

#### S5-06 — Провести real smoke и финальное readiness review

- **Status:** `pending`
- **Objective:** На exact test topology доказать AC-020, real Telegram client behavior, оба LaunchAgent jobs и backup/restore operations без влияния на Giveaway Bot.
- **Requirements:** Все 19 FR; AC-003 real evidence, AC-016 real-sensitive evidence, AC-020, AC-024 real-sensitive evidence where feasible; повторная проверка остальных AC по acceptance report.
- **Dependencies:** `S5-05`.
- **Read first:** PRD §19–§21; Technical Design §3.3, §17–§20.6, §21, §22 S5, §24; runbooks/evidence S5-01–S5-05.
- **Preconditions:** Общий preflight; отдельная авторизация на конкретные real mutations/launchctl/rehearsal; exact identity evidence current; full fake/aggregate gates green; before-inventory Giveaway captured.
- **Scope:** Real three-user/admin/showcase journey, native/manual channel selection, multi-slot/deadline/moderation/reconciliation feasible cases, canonical jobs install/restart/status/log rotation, backup catch-up/verify, restore rehearsal only on copy, final independent review/report.
- **Do not touch:** Production DB restore, public pilot users, Giveaway credentials/process/DB/posts, remote/push/deploy, new features.
- **Invariants:** Readiness applies only exact tested identity/topology/env checksum; no hosted/24×7 claim; Mac GUI/sleep limitation explicit; every external action evidenced separately; feature defect is not fixed by widening this evidence unit.
- **Tests first:** Утвердить smoke checklist/actors/test data/cleanup and stop points; ambiguous simulation only where safe; define before/after non-interference evidence.
- **Implementation notes:** Install uses canonical Collaboration labels temporarily with test env. Changing bot/channel/env after smoke forces preflight and relevant smoke rerun.
- **Verification:** `pnpm check`; `pnpm db:verify`; real flow and ops checklist; both labels/status/heartbeat; backup age/verify/catch-up; copy-only restore integrity; Giveaway before/after diff; independent review `PASS`.
- **Exit criteria:** AC-020 report complete and reproducible; real portions AC-003/016/024 recorded honestly; no Giveaway impact; final review PASS; S5/Production ready only for exact topology.
- **Completion evidence:**
  - Commit SHA: `SELF`
  - Changed files:
  - Focused checks:
  - Aggregate checks: `pnpm check`
  - Acceptance evidence:
  - Review result:
  - Notes/deviations:
- **Stop conditions:** Любая недостающая authorization, wrong identity/capability, non-green local gate, unsafe failure simulation, production restore need or detected Giveaway change.

## 5. Обязательные quality gates

- Каждый unit добавляет focused tests до или одновременно с implementation; unit без Verification/Exit criteria не завершается.
- Любая schema change запускает fresh temporary SQLite migration, previous-version upgrade fixture, `PRAGMA foreign_key_check` и `PRAGMA integrity_check`.
- Unit gates включают validators/unit tests, SQLite integration, fake Telegram adapter, duplicate update/callback, restart recovery, graceful shutdown, ambiguous delivery и fencing по применимости.
- Last-slot и block/accept policy доказываются adversarial concurrent promises, а не последовательным unit test.
- Завершающие units S0-07, S1-03, S2-05, S3-05, S4-04 и S5-06 запускают aggregate `pnpm check`.
- S0-07 и S3-05 получают независимое read-only deep review; S5-06 — финальное независимое review. Finding вне текущего scope блокирует stage и требует явной поправки плана.
- S3-05 запускает core fake journey; S4-04 — comprehensive fake journey; S5-06 — real Telegram/LaunchAgent/backup evidence.
- SQLite, Telegram, restart, concurrency, LaunchAgent и backup AC нельзя закрыть только unit test.

## 6. Acceptance evidence rules

Evidence различает: focused local, aggregate local, fake Telegram, real Telegram, LaunchAgent, backup/restore и non-interference. `PASS` в одном классе не переносится на другой. Каждый completed unit перечисляет exact changed files, commands/results, fixtures/scenarios, review и отклонения. Недоступное real evidence остаётся `pending`, а не описывается как PASS.

Acceptance report связывает AC с authoritative state, durable side effects и наблюдаемым result. Screenshot/log excerpt не заменяет DB/integrity proof; локальный fake smoke не доказывает production identity; plan/runbook не доказывает runtime behavior.

## 7. Действия с отдельной авторизацией

Следующее не разрешается stage launch автоматически:

- BotFather, создание/изменение bot или channel;
- получение/запись real credentials и production env;
- реальные Telegram mutations до S5-05/S5-06 preflight;
- запись/загрузка/unload LaunchAgent и `launchctl` actions;
- stop/restart реального process, log rotation, backup prune;
- production restore или любое перемещение production DB/WAL/SHM;
- изменение Giveaway Bot;
- dependency update вне selected unit;
- destructive migration;
- Git remote/repository, push, merge, PR или deploy.

## 8. Определения готовности

- **Core marketplace checkpoint (после S3):** профиль → draft/publish → feed/deep link → application → accept/reject → matched → pairwise contact → restart на fake API. Completion, moderation и полный funnel ещё не готовы.
- **Functional MVP complete / functionally Pilot ready (после S4):** все 19 FR реализованы, comprehensive fake journey проходит, AC-001–AC-019 и AC-021–AC-026 имеют применимое local/fake evidence. Real-only AC-020 остаётся открытым; запуск публичного пилота ещё не разрешён.
- **Production ready (после S5):** AC-020, real Telegram, exact identity/channel, LaunchAgent, backup/restore rehearsal и Giveaway non-interference фактически подтверждены. Заявление относится только к проверенной topology и не означает hosted/24×7 SLA из-за Mac GUI/sleep boundary.

## 9. Coverage matrix: FR → units

| FR | Primary units | Gate |
|---|---|---|
| FR-P01 | S1-01, S1-02, S1-03 | S1-03 / S4-04 |
| FR-P02 | S1-01, S1-02, S3-03 | S3-03 / S4-04 |
| FR-P03 | S1-03, S5-06 | S1 fake / S5 real |
| FR-C01 | S2-01, S2-02, S2-05 | S2-05 |
| FR-C02 | S2-03, S2-04 | S2-05 |
| FR-C03 | S2-05, S3-02 | S3-02 |
| FR-C04 | S3-03, S3-04 | S3-05 |
| FR-S01 | S3-01, S3-02 | S3-05 |
| FR-S02 | S2-02, S3-01, S4-02 | S4-04 |
| FR-A01 | S3-02 | S3-05 |
| FR-A02 | S3-03, S4-03 | S4-04 |
| FR-A03 | S3-03, S4-03 | S4-04 |
| FR-O01 | S4-01 | S4-04 |
| FR-V01 | S0-06, S2-03, S2-04, S2-05, S3-04, S4-02 | S4-04 / S5-06 |
| FR-M01 | S4-02 | S4-04 |
| FR-M02 | S4-03 | S4-04 |
| FR-N01 | S0-05, S0-06, owning S1–S4 flows | S4-04 |
| FR-E01 | S0-05, owning S1–S4 flows, S4-04 | S4-04 |
| FR-R01 | S0-03–S0-07, stage restart gates, S5-01–S5-06 | S4-04 / S5-06 |

## 10. Coverage matrix: AC → units/gates

| AC | Primary evidence units | Required gate |
|---|---|---|
| AC-001 | S1-03 | Fake adapter + SQLite |
| AC-002 | S1-02, S3-03 | Projection authorization + accepted-pair E2E |
| AC-003 | S1-03, S5-06 | Fake adapter + real client smoke |
| AC-004 | S2-02, S2-05 | Restart adapter journey |
| AC-005 | S2-03 | Fake Bot API + SQLite |
| AC-006 | S2-04 | Ambiguous recovery runtime |
| AC-007 | S2-05, S3-02 | Staged edit + first-application integration |
| AC-008 | S3-01, S3-02 | SQLite query/session snapshot |
| AC-009 | S2-02, S3-01, S4-02 | Deep-link public/hidden matrix |
| AC-010 | S3-02 | Unit + SQLite duplicate/guard matrix |
| AC-011 | S3-03 | Adversarial last-slot concurrency |
| AC-012 | S3-03, S3-04 | SQLite + core E2E |
| AC-013 | S3-03 | Pairwise visibility matrix |
| AC-014 | S3-04 | Fake-clock SQLite/runtime |
| AC-015 | S4-01 | SQLite bilateral uniqueness + E2E |
| AC-016 | S4-02, S5-06 | Fake API/SQLite + real-sensitive smoke |
| AC-017 | S4-03 | Block cascade E2E |
| AC-018 | S3-04, S4-04 | Forced DM failure + authoritative views |
| AC-019 | S0-04–S0-06, S4-04 | Duplicate effect counts across full fake journey |
| AC-020 | S5-05, S5-06 | Exact real smoke/non-interference report |
| AC-021 | S2-01, S2-02 | Transactional delete/replay SQLite + adapter |
| AC-022 | S1-01, S1-02 | Concurrent partial-UNIQUE integration |
| AC-023 | S4-01 | Negative/mismatch outcome matrix |
| AC-024 | S2-04, S5-06 | Fake reconciliation/runtime + feasible real check |
| AC-025 | S3-04 | Cancellation with failed outbound |
| AC-026 | S4-03 | Adversarial block/accept both commit orders |

## 11. Плановая self-check перед исполнением

- [ ] Ровно 7 stages и 32 уникальных unit ID: P0=2, S0=7, S1=3, S2=5, S3=5, S4=4, S5=6.
- [ ] Все stage/unit statuses первоначально `pending`; нет `in_progress`, `completed`, `blocked` card status.
- [ ] Единственный root — P0-01; каждый следующий unit зависит от непосредственного predecessor; cycles отсутствуют.
- [ ] Каждая карточка содержит Objective, Requirements, Dependencies, Read first, Preconditions, Scope, Do not touch, Invariants, Tests first, Implementation notes, Verification, Exit criteria, Completion evidence и Stop conditions.
- [ ] Все 19 FR и AC-001–AC-026 покрыты конкретным unit и gate.
- [ ] Production resources/actions находятся только в S5 и требуют отдельной авторизации.
- [ ] Later/Out implementation отсутствует; упоминания допустимы только как запрет/граница.
- [ ] Первая пользовательская команда запускает P0, первый unit однозначно P0-01.
