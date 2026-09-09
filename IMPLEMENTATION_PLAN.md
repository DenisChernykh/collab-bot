# Collaboration Bot — solo-launch and Cloudflare migration implementation plan

- Статус документа: `Approved execution registry`
- Версия: `1.2`
- Дата: `2026-09-09`
- Цель: сохранить работающий Telegram-цикл и перенести его на бесплатный Cloudflare runtime без ослабления durable/transactional гарантий
- Ограничение: один stage за пользовательскую авторизацию, один локальный commit на unit; push/PR/deploy и внешние mutations только в явно разрешённых cards CF2/CF3

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
| R2 — Complete feature-first layout | `completed` | 31 | Активные feature implementations принадлежат пяти модулям; shared cross-feature/platform code отделён, legacy paths отсутствуют |
| R3 — Honest top-level ownership | `completed` | 14 | Корень `src` отражает реальные owners: modules, shared kernel, platform adapters и runtime composition |
| CF1 — Cloudflare-compatible local runtime | `completed` | 15 | Тот же бот проходит workerd/SQLite Durable Object gates локально; production polling остаётся доступным для rollback |
| CF2 — Free Cloudflare staging | `completed` | 4 | Отдельный staging Worker и dev-бот проходят hosted webhook/alarm smoke без production traffic |
| MFM — Bilingual event profiles | `in_progress` | 10 | One bot with classic and MFM profiles; authorized project DB reset |
| AP — Automatic Telegram profile | `completed` | 3 | Профиль создаётся при /start, доступные данные берутся из Telegram, участие требует дозаполнения |
| CF3 — Production cutover | `completed` | 4 | Данные перенесены, production webhook включён, hosted journey подтверждён и operations handoff закрыт с явным recovery boundary |

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
  → R2-05A → R2-05B → R2-06 → R2-07A → R2-07B → R2-08
  → R2-09A → R2-09B → R2-10A → R2-10B
  → R2-11A → R2-11B → R2-11C → R2-12
  → R2-13A → R2-13B → R2-13C → R2-13D → R2-13E → R2-13F
  → R2-14A → R2-14B → R2-14C → R2-14D → R2-14E → R2-15
  → R3-00 → R3-01 → R3-02A → R3-02B → R3-02C → R3-03 → R3-04
  → R3-05A → R3-05B → R3-05C → R3-06 → R3-07A → R3-07B → R3-08
  → CF1-00 → CF1-01 → CF1-02A → CF1-02B → CF1-02C → CF1-02D → CF1-03 → CF1-04A → CF1-04B → CF1-04C → CF1-05 → CF1-06 → CF1-07 → CF1-08 → CF1-09
  → CF2-00 → CF2-01 → CF2-02 → CF2-03
  → CF3-00 → CF3-01 → CF3-02 → CF3-03
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
| S3-C2 | `29d057db9b43958c7b35b7a6a94a3d5dae8a18d8` | explicit personal Telegram platform opt-in |
| S4-01 | `ab09e70f94455ed6b1342dcc8b31958614076f16` | allowlisted hide, complete fake/real journey and manual launch handoff |
| FUT-01 | `32441e59510a79852aceb47a73ca5338fa529e4c` | one-time Telegram audience snapshot with internal provenance |
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
| R2-05A | `aab692ae3259937b8d52217c06fb4cfaec74cbb8` | collaboration domain and port ownership |
| R2-05B | `3872a906753d733edf3ed46a279c26f25b45eb27` | collaboration application service ownership |
| R2-06 | `3868e52236668b8683bbc8a0306ad8be0b60178f` | consumer-neutral atomic wizard admission |
| R2-07A | `92b37305909e1834b04f930fb54cc2c76d450907` | collaboration SQLite adapters and composition ownership |
| R2-07B | `b9ec2b3d82e0e1766aec040d2c373840ee158127` | collaboration Telegram presentation ownership |
| R2-08 | `730f8790a11082974dc2ee6d0e28990d487c1ba1` | marketplace CQRS read-model ownership |
| R2-09A | `fd38d23335f8cb190b12cff9db226ac9a8a6cef6` | marketplace Telegram presentation and split routing seam |
| R2-09B | `d5f61074bba13c29e7b967a5c638d7e6278a80e1` | applications Telegram presentation ownership |
| R2-10A | `18c3139aa4798440347a592a688c516ba2c78374` | moderation core, persistence and composition ownership |
| R2-10B | `2c4523bb334983292be0c971806bee926319c036` | moderation Telegram presentation ownership |
| R2-11A | `f4383a791d2a95c21ae04c543c17a448c74c63fe` | neutral durable Telegram ingress ownership |
| R2-11B | `3c12fbab1e91b2e55d92c488c3a8e41a6a7bfe3f` | neutral Telegram router ownership |
| R2-11C | `fa5859801398d3ce85c731f9ce163825da21535c` | removed legacy bot presentation paths |
| R2-12 | `59f70493ce162ab00ae640a69eec3479cd8d9227` | runtime composition through feature public factories |
| R2-13A | `03f74a2b90b11bb5d0115a187c099b2e3f83bb6c` | profile consumer cutover to module ownership |
| R2-13B | `f97d771f32d0dd33382bdfa98cdafaebfbf2ce05` | removed profile compatibility paths |
| R2-13C | `383ea3d26ac1aa1d0886f4c1f8580337ce2dd30e` | collaboration consumer cutover to module ownership |
| R2-13D | `49f05d81dcb7c1a3e0c7b53d996e20de20ff3b0a` | removed collaboration compatibility paths |
| R2-13E | `f97f32d1edaa0807d2f6ca563cb92b5e3357d0dd` | remaining feature consumer cutover to module ownership |
| R2-13F | `9215d9d2c9f4ee5f03afa21a4138db4e8168c062` | removed remaining feature bridges and owned deadline policy |
| R2-14A | `a12e7e275db5cc4b562be044668cc59b00fbee89` | test-owned grammY API fake |
| R2-14B | `0889b71023843ee36db8b399313f70abd21ff2d9` | test-owned Telegram transport fake |
| R2-14C | `c349454d191cf78ecf3bfde2efa82b07a32c9636` | test-support FakeClock facade and first consumer cohort |
| R2-14D | `e1f3ae7f0f1c500d6c0371bfc0f5b99044235551` | second FakeClock consumer cohort |
| R2-14E | `ccdc3a6c57e2464b6543e22ef90a3d22c9bc2bce` | removed final test-only production path |
| R2-15 | `6a4a6f142c7cd95a4c81f473af2ca7ec135a935f` | closed and documented the feature-first transition |
| R3-00 | `a85c815d52474fa779483b71c9a5c26a861b549d` | decision-complete top-level ownership stage |
| R3-01 | `78e2d561ba03bcb6d74d32ea76fff9e3af455761` | shared domain vocabulary ownership |
| R3-02A | `d1c3d3cd3aa1934204deebef94b9794753e49975` | shared core application ports |
| R3-02B | `8c59f211f9f15132b0b953b9d33dbdc9764c2d00` | shared durable-effect ports |
| R3-02C | `772aa530eb8811c6be431e98b3a3ac18f38eb7dc` | shared Telegram ports |
| R3-03 | `e390e5ef0ed87c147f6e7bc0c25f52fff5d0195f` | shared command policies |
| R3-04 | `934477075c83da03248bb1afd452c1cc658adb89` | complete shared application ownership |
| R3-05A | `15d36eb180b772df9fa86407a596088fa4da7866` | platform primitive adapters |
| R3-05B | `03cd93304cde5158af73eff06a382e7e18fea36d` | platform database adapters |
| R3-05C | `c75564b234f0420b6a04715b08764ac314ff4568` | platform outbox adapters |
| R3-06 | `5562c5bfb2cca0863588b0e44e6d98a6d57fc39d` | runtime-owned global Telegram shell |
| R3-07A | `f2f7fe6f11af159da26dfcc006a76b8e25b4b973` | grouped runtime bootstrap and lifecycle |
| R3-07B | `5ed4b1c36571efece0022fa5493aaaca8f7b4018` | grouped runtime composition |

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

- **Status:** `completed` — завершённая feature-first организация закрыта всеми 31 units; прежний `in_progress` здесь был stale относительно таблицы и последующего completed R3.
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

#### R2-07A — Move collaborations adapters and composition

- **Status:** `completed`
- **Objective:** Дать collaborations собственные SQLite adapters и factory до переноса Telegram-слоя.
- **Dependencies:** `R2-06`.
- **Read first:** three collaboration SQLite repositories, runtime composition and S2 integration tests.
- **Scope:** move collaboration aggregate/session/publication adapters, add `createCollaborationsFeature`, public exports and temporary exact repository compatibility exports.
- **Do not touch:** composer/presentation, browse projection, application decisions or SQL.
- **Invariants:** one repository/session identity per factory; publication/draft transactions and wizard admission unchanged.
- **Verification:** S2 draft/publication integration; composition test; runtime; architecture; `pnpm check`; `pnpm db:verify`.
- **Exit criteria:** collaboration persistence is feature-owned and factory-constructible; один commit `R2-07A: own collaboration adapters and composition`.
- **Completion evidence:** Commit SHA: `SELF`; moved the collaboration aggregate, wizard-session and publication SQLite implementations under `modules/collaborations/infrastructure`, added one public `createCollaborationsFeature` composition boundary and retained three exact legacy re-export bridges for the scheduled runtime/test cutover. The factory constructs one aggregate repository, one session repository shared by draft/publication services, one publication repository and exposes sessions through its application port rather than leaking the concrete adapter type. Test-first RED was the missing module root/factory; the migrated-SQLite composition test now proves profile-backed draft creation plus factory-owned session/publication surfaces. Nine source/test paths plus this plan changed; adapter bodies differ only in import ownership, while SQL, schema/migrations, transaction runner, outbox/capability inputs and session validation are unchanged. Focused composition/draft/publication/admission tests PASS (9); architecture PASS (144 modules, 429 dependencies); `pnpm check` PASS (69 unit, 86 integration, 47 runtime, lint/typecheck/build); all fake E2E PASS (30); `pnpm db:verify` PASS. No credential, real Telegram, remote or production mutation.
- **Stop conditions:** factory duplicates a boundary/transaction runner or SQL behavior must change.

#### R2-07B — Move collaborations Telegram presentation

- **Status:** `completed`
- **Objective:** Завершить collaboration vertical slice переносом composer/rendering и consumer cutover.
- **Dependencies:** `R2-07A`.
- **Read first:** collaboration composer/presentation, root router, marketplace/moderation consumers and S2 fake tests.
- **Scope:** move collaboration composer/presentation, export through feature public API and switch all production/test consumers; remove old `src/bot/collaboration` implementation paths.
- **Do not touch:** browse/application behavior, callbacks, copy or routing order.
- **Invariants:** callback bytes, render output, wizard flow and managed-collaboration continuation unchanged.
- **Verification:** collaboration composer/S2 fake E2E; runtime; architecture; `pnpm check`; `pnpm db:verify`.
- **Exit criteria:** no active collaboration adapter or presentation implementation remains in shared legacy paths; exact compatibility exports remain scheduled for `R2-13`; один commit `R2-07B: move collaboration Telegram presentation`.
- **Completion evidence:** Commit SHA: `SELF`; moved the collaboration grammY composer and callback/presentation helpers under `modules/collaborations/presentation/telegram`, exported the feature contract through the collaboration root and switched the root router, marketplace, moderation and focused fake test to that public surface. The two old `src/bot/collaboration/*` files now contain exact compatibility re-exports only; no active production consumer imports them. Test-first RED proved the new public composer was absent (`createCollaborationTelegramFeature is not a function`); the same replay/stale-callback and restart/route-precedence tests are GREEN after the move. Nine source/test paths plus this plan changed; composer/render bodies differ only in imports, while callback bytes, reply copy, render output, route priority and managed-collaboration continuation are unchanged. Focused fake composer PASS (2); architecture PASS (146 modules, 431 dependencies); `pnpm check` PASS (69 unit, 86 integration, 47 runtime, lint/typecheck/build); all fake E2E PASS (30); `pnpm db:verify` PASS. No credential, real Telegram, remote or production mutation.
- **Stop conditions:** move requires duplicate replies/effects or changes cross-feature continuation.

#### R2-08 — Create the marketplace read module

- **Status:** `completed`
- **Objective:** Дать feed/deep-link/browse projection отдельного владельца вместо размытого marketplace composer.
- **Dependencies:** `R2-07B`.
- **Read first:** browse service/port/repository, feed/deep-link tests and TD CQRS rules.
- **Scope:** `modules/marketplace` application/infrastructure/composition for read-only cross-feature projection and browse-session writes; explicit documented CQRS exception.
- **Do not touch:** application submission/decisions or browse SQL/pagination.
- **Invariants:** same filters, keyset order, visibility and revalidation.
- **Verification:** browse integration/fake E2E; architecture; `pnpm check`; `pnpm db:verify`.
- **Exit criteria:** browse ownership no longer sits in collaborations/shared DB; один commit `R2-08: establish marketplace read module`.
- **Completion evidence:** Commit SHA: `SELF`; moved the browse service, its consumer port and SQLite projection under `modules/marketplace`, added pure application/root entrypoints plus `createMarketplaceFeature({ boundary, transactions, clock })`, and retained three exact compatibility exports for scheduled presentation/runtime/test cutover. The factory exposes only the browse service, not its repository. Test-first RED was the missing marketplace root/factory; the migrated-SQLite composition test now proves an empty feed persists and resumes the same generation with revision 1→2 across recomposition. Technical Design now records marketplace as the explicit CQRS exception: its adapter may join authoritative profiles/collaborations/applications/actor tables for current visibility, while writes remain limited to owned `browse_sessions`. Ten source/test paths plus this plan and TD changed; SQL predicates/order/parameters, keyset cursor, TTL/cleanup, stale-session and deep-link behavior remain unchanged. Focused composition/browse tests PASS (7); architecture PASS (152 modules, 443 dependencies); `pnpm check` PASS (69 unit, 87 integration, 47 runtime, lint/typecheck/build); all fake E2E PASS (30); `pnpm db:verify` PASS. No credential, real Telegram, remote or production mutation.
- **Stop conditions:** projection write expands beyond browse sessions or SQL behavior changes.

#### R2-09A — Extract marketplace Telegram presentation

- **Status:** `completed`
- **Objective:** Передать marketplace собственные browse/deep-link handlers и ввести явный presentation seam до applications move.
- **Dependencies:** `R2-08`.
- **Read first:** mixed marketplace composer/codec, browse/deep-link flows, profile continuation, opaque callback and S3 fake tests.
- **Scope:** move browse/deep-link composer and callback codec under `modules/marketplace/presentation/telegram`; root mounts marketplace and a temporary applications-only legacy facade through injected profile/target ports.
- **Do not touch:** application business API, callback/deep-link bytes, copy, browse SQL or root route priority.
- **Invariants:** browse/application callback prefixes have one owner; `cb_*` stays outside generic durable ingress; target resolution never emits a duplicate card before application eligibility.
- **Verification:** marketplace/applications-focused R1-05C/S3 fake tests; routing contract; architecture; `pnpm check`; `pnpm db:verify`.
- **Exit criteria:** marketplace presentation is feature-owned and the temporary applications facade contains no browse handler; один commit `R2-09A: own marketplace Telegram presentation`.
- **Completion evidence:** Commit SHA: `SELF`; extracted browse/deep-link callbacks, feed rendering, filters and target resolution into `modules/marketplace/presentation/telegram`, exported them through the marketplace public API and rewired the root to mount separate marketplace and temporary applications-only composers. The remaining two `src/bot/marketplace` files now own only application callbacks/management/opaque decisions and communicate with profile/marketplace through injected ports; they contain no browse parser or renderer. Test-first RED proved the marketplace public composer/codec were absent (3 failed); new focused tests now prove browse-only callback ownership, malformed `c_` claim behavior and valid application-target resolution without a duplicate card reply. Root start order is applications author-management then marketplace fallback; command order is applications then `/feed`; generic callback order is profile → collaboration → marketplace → applications, while `cb_*` still reaches only the separate opaque applications route. Eight source/test paths plus this plan changed; callback/deep-link bytes, copy, route priority, profile continuation and application effects remain unchanged. Focused split/routing/S3 tests PASS (20); architecture PASS (154 modules, 450 dependencies); `pnpm check` PASS (69 unit, 87 integration, 47 runtime, lint/typecheck/build); all fake E2E PASS (33); `pnpm db:verify` PASS. No credential, real Telegram, remote or production mutation.
- **Stop conditions:** split duplicates a handler/reply or requires direct marketplace↔applications/profile imports.

#### R2-09B — Complete applications Telegram presentation

- **Status:** `completed`
- **Objective:** Перенести applications-only facade под реального owner и завершить split consumer cutover.
- **Dependencies:** `R2-09A`.
- **Read first:** temporary applications composer/codec, applications public API, injected profile/target ports, root router and all S3 fake journeys.
- **Scope:** move submit/own/author-management/decision/completion presentation and application callback codec under `modules/applications/presentation/telegram`; root switches to applications public API; delete two temporary `src/bot/marketplace` files.
- **Do not touch:** marketplace handlers moved in `R2-09A`, browse SQL/pagination, callback/deep-link bytes, copy or route priority.
- **Invariants:** every update reaches one owner; author deep-link, feed application start, quick-profile return and opaque `cb_*` remain unchanged and single-shot.
- **Verification:** applications-focused R1-05C/S3 tests and all fake E2E; architecture; `pnpm check`; `pnpm db:verify`.
- **Exit criteria:** applications and marketplace have distinct module-owned presentation surfaces and no active legacy marketplace implementation; один commit `R2-09B: own applications Telegram presentation`.
- **Completion evidence:** Commit SHA: `SELF`; moved the applications-only composer and callback codec from the temporary `src/bot/marketplace` seam into `modules/applications/presentation/telegram`, exported the feature/codec through the applications public API and switched the root plus focused test to that surface. Both legacy marketplace files are deleted. Applications owns own-list, author management, application start, decision/completion tokens and opaque `cb_*`; marketplace owns only browse/deep-link rendering. Profile-session keyboard/continuation and marketplace target lookup remain injected structural ports, so applications imports neither profiles nor marketplace. Test-first RED proved the applications public exports were absent (2 failed/2 passed); after the move the focused composer tests are 4/4 GREEN. Architecture initially caught a type-only applications→marketplace cycle; replacing it with the already-identical local target-port result removed the dependency, and the final executable graph has no violations/cycles. Seven source/test paths plus this plan changed; callback bytes, copy, root order, quick-profile return, author deep-link and single-shot opaque effects remain unchanged. Architecture PASS (154 modules, 450 dependencies); `pnpm check` PASS (69 unit, 87 integration, 47 runtime, lint/typecheck/build); all fake E2E PASS (33); `pnpm db:verify` PASS. No credential, real Telegram, remote or production mutation.
- **Stop conditions:** exact routing/effect parity cannot be preserved without a direct module cycle.

#### R2-10A — Move moderation core and composition

- **Status:** `completed`
- **Objective:** Собрать moderation application contract, service, SQLite adapter and factory под одним owner.
- **Dependencies:** `R2-09B`.
- **Read first:** moderation service/port/repository, runtime composition and hide audit/outbox integration tests.
- **Scope:** move moderation port/service/adapter unchanged, add composition factory/public API and temporary exact compatibility exports.
- **Do not touch:** Telegram composer, repository SQL split, hide policy, audit schema, restore/block Later scope or delivery semantics.
- **Invariants:** hide, pending-application close, projection supersede, delete intent and audit remain one authoritative transaction.
- **Verification:** S4 moderation integration and composition tests; architecture; `pnpm check`; `pnpm db:verify`.
- **Exit criteria:** moderation core and persistence are feature-owned and factory-constructible; один commit `R2-10A: own moderation core and composition`.
- **Completion evidence:** Commit SHA: `SELF`; moved the moderation port, service and unchanged SQLite transaction adapter under `modules/moderation`, retained three exact compatibility exports, and added a public application surface plus `createModerationFeature({ boundary, outboxStore, transactions, clock, botUsername, adminTelegramIds })`. The factory reuses the injected database boundary, transaction runner and outbox store, and exposes only `AdminModerationService`; it does not create a second persistence or transaction context. A migrated-SQLite composition test proves factory-composed hide atomically produces the hidden collaboration, one operator audit action and one prepared `channel_delete` intent. Ten source/test paths plus this plan changed; repository SQL, hide policy, projection revision, audit schema, command/deep-link validation and Telegram presentation remained unchanged. Focused R2-10A/S4 integration PASS (9); architecture PASS (160 modules, 464 dependencies); `pnpm check` PASS (69 unit, 88 integration, 47 runtime, lint/typecheck/build); all fake E2E PASS (33); `pnpm db:verify` PASS. No credential, real Telegram, remote or production mutation.
- **Stop conditions:** ownership move weakens atomicity or requires repository/SQL redesign.

#### R2-10B — Move moderation Telegram presentation

- **Status:** `completed`
- **Objective:** Завершить moderation vertical slice переносом composer и consumer cutover.
- **Dependencies:** `R2-10A`.
- **Read first:** moderation composer, collaboration status public surface, root actor routing and focused fake tests.
- **Scope:** move composer under `modules/moderation/presentation/telegram`, export through module API and switch root/focused consumers; exact legacy bridge remains only до `R2-11C`.
- **Do not touch:** admin command syntax/copy, actor resolution, hide behavior or routing priority.
- **Invariants:** non-admin `/admin` remains indistinguishable from unknown command; admin actor tagging and one durable effect remain unchanged.
- **Verification:** moderation-focused R1-05C/S4 fake tests; architecture; `pnpm check`; `pnpm db:verify`.
- **Exit criteria:** no active moderation implementation remains under shared application/infrastructure or `src/bot`; один commit `R2-10B: move moderation Telegram presentation`.
- **Completion evidence:** Commit SHA: `SELF`; moved the moderation Telegram composer unchanged under `modules/moderation/presentation/telegram`, exported its actor-resolution/routing contract through the moderation public API, and switched the root router plus focused fake consumer to that entrypoint. The old composer path is now an exact one-line compatibility export scheduled for removal in `R2-11C`; shared application/infrastructure moderation paths likewise contain no implementation. Five source/test paths plus this plan changed; admin syntax/copy, canonical input classification, command id, collaboration status rendering, root routing priority and hide effects remain unchanged. Focused moderation/browse/S4/routing tests PASS (25); architecture PASS (161 modules, 465 dependencies); `pnpm check` PASS (69 unit, 88 integration, 47 runtime, lint/typecheck/build); all fake E2E PASS (33); `pnpm db:verify` PASS. No credential, real Telegram, remote or production mutation.
- **Stop conditions:** move changes actor classification or duplicates hide execution.

#### R2-11A — Move durable Telegram ingress

- **Status:** `completed`
- **Objective:** Передать neutral presentation layer единственную durable ingress seam.
- **Dependencies:** `R2-10B`.
- **Read first:** durable ingress, current root router and R1-04 characterization tests.
- **Scope:** move `registerDurableTelegramIngress` and its contracts under `presentation/telegram`; switch root and focused test; remove the old active ingress path.
- **Do not touch:** command executor, receipt policy, callback classification or reply buffering.
- **Invariants:** generic messages/callbacks use one durable envelope; `cb_*` remains a separate opaque path.
- **Verification:** R1-04 ingress and routing tests; all fake E2E; architecture; `pnpm check`; `pnpm db:verify`.
- **Exit criteria:** durable ingress has one neutral presentation owner; один commit `R2-11A: move durable Telegram ingress`.
- **Completion evidence:** Commit SHA: `SELF`; moved the single durable grammY ingress seam from `src/bot` to neutral `src/presentation/telegram`, switched the root router and focused characterization test to the new owner, and removed the old path instead of retaining another bridge. Message and generic callback updates still enter exactly one durable envelope; opaque `cb_*` callbacks still bypass it and remain terminal. Four source/test paths plus this plan changed; canonical input bytes, executor/receipt policy, reply buffering and feature routing stayed unchanged. Focused ingress/routing tests PASS (2); architecture PASS (161 modules, 465 dependencies); `pnpm check` PASS (69 unit, 88 integration, 47 runtime, lint/typecheck/build); all fake E2E PASS (33); `pnpm db:verify` PASS. No credential, real Telegram, remote or production mutation.
- **Stop conditions:** classification or middleware terminality changes.

#### R2-11B — Establish the neutral Telegram router

- **Status:** `completed`
- **Objective:** Заменить profile-named root фактическим `telegram-router`.
- **Dependencies:** `R2-11A`.
- **Read first:** `profile-bot.ts`, module presentation APIs, routing contract and runtime composition tests.
- **Scope:** move root implementation to `presentation/telegram/telegram-router.ts`, rename its internal public contract neutrally and switch runtime plus direct S1/S2 fake consumers.
- **Do not touch:** feature factories/runtime DI cutover, route priority, menu/copy, replay, reply collector or audience post-commit action.
- **Invariants:** exact Telegram behavior, update metadata and effect/reply ordering remain unchanged.
- **Verification:** routing characterization, S1/S2 and all fake E2E, runtime, architecture, `pnpm check`, `pnpm db:verify`.
- **Exit criteria:** runtime and tests use the neutral router and `profile-bot.ts` is absent; один commit `R2-11B: establish neutral Telegram router`.
- **Completion evidence:** Commit SHA: `SELF`; moved the behavior-dense root grammY composition from misleading `src/bot/profile-bot.ts` to neutral `src/presentation/telegram/telegram-router.ts`, renamed its public surface to `registerTelegramRouter`/`TelegramRouterOptions`/`RegisteredTelegramRouter`, and switched runtime plus both direct S1/S2 consumers. No compatibility alias remains for the old root name or path. Five source/test paths plus this plan changed; feature construction, route precedence, lazy continuation wiring, durable replay, one generic callback acknowledgement, opaque `cb_*`, actor snapshot, post-commit audience lookup and reply ordering are unchanged. Focused S1/S2/ingress/routing tests PASS (11); runtime PASS (47); architecture PASS (161 modules, 465 dependencies); `pnpm check` PASS (69 unit, 88 integration, 47 runtime, lint/typecheck/build); all fake E2E PASS (33); `pnpm db:verify` PASS. No credential, real Telegram, remote or production mutation.
- **Stop conditions:** rename introduces an ESM cycle or changes effect/reply order.

#### R2-11C — Remove legacy bot presentation paths

- **Status:** `completed`
- **Objective:** Удалить оставшиеся exact feature-presentation bridges и физически закрыть `src/bot`.
- **Dependencies:** `R2-11B`.
- **Read first:** all `src/bot` files, source/test imports and module presentation entrypoints.
- **Scope:** delete unused profile/collaboration/marketplace/moderation compatibility exports; exact zero-path and empty-directory audit.
- **Do not touch:** module implementations, runtime composition, shared application/infrastructure paths or broad test-support alignment.
- **Invariants:** every removed file has zero active consumer and an existing public module replacement.
- **Verification:** zero `src/bot` import/path scan; routing and all fake E2E; architecture; `pnpm check`; `pnpm db:verify`.
- **Exit criteria:** `src/bot` absent and all Telegram presentation ownership is truthful; один commit `R2-11C: remove legacy bot presentation paths`.
- **Completion evidence:** Commit SHA: `SELF`; deleted the five remaining one-line profile, collaboration and moderation compatibility exports and removed the now-empty `src/bot` tree. A zero-path scan confirms no `src/bot`, feature-bot path or source/test import remains; all active Telegram code now lives either in a feature presentation package or the neutral presentation layer. Exactly five passive source paths plus this plan changed; no implementation, runtime wiring, route or behavior changed. Focused ingress/routing tests PASS (2); architecture PASS (156 modules, 460 dependencies); `pnpm check` PASS (69 unit, 88 integration, 47 runtime, lint/typecheck/build); all fake E2E PASS (33); `pnpm db:verify` PASS. No credential, real Telegram, remote or production mutation.
- **Stop conditions:** any consumer still requires a compatibility bridge.

#### R2-12 — Compose runtime through feature factories

- **Status:** `completed`
- **Objective:** Убрать ручное создание feature internals из runtime composition.
- **Dependencies:** `R2-11C`.
- **Read first:** bot application, all module factories/public APIs and lifecycle tests.
- **Scope:** runtime creates shared platform primitives, calls feature factories and mounts neutral router; narrow cross-feature ports wired only here.
- **Do not touch:** bootstrap/preflight/polling/worker/shutdown order.
- **Invariants:** one DB boundary, one transaction runner, one bot, one worker and one close.
- **Verification:** composition/lifecycle/runtime tests; all fake E2E; architecture; `pnpm check`; `pnpm db:verify`.
- **Exit criteria:** runtime imports no feature internal file; один commit `R2-12: compose runtime from feature APIs`.
- **Completion evidence:** Commit SHA: `SELF`; replaced all manual profiles, collaborations, marketplace, applications and moderation service/adapter construction in `bot-application.ts` with one call to each feature public factory. Every factory receives the same `DatabaseBoundary`, transaction runner, clock and shared outbox store where required; profiles sessions are passed by port to collaborations, the mutable showcase capability remains shared with preflight/worker, and one collaboration publication instance serves Telegram plus all delivery projections. `ProfilesFeature.sessions` now exposes its application port rather than a concrete SQLite type. A dependency-cruiser rule first failed on all 14 legacy runtime feature edges and now enforces public module entrypoints. Three source/config paths plus this plan changed; bootstrap, migration, identity, preflight, polling, worker and shutdown order stayed unchanged. Runtime PASS (47); focused S1/S2/S3 fake journeys PASS (21); architecture PASS (156 modules, 450 dependencies); `pnpm check` PASS (69 unit, 88 integration, 47 runtime, lint/typecheck/build); all fake E2E PASS (33); `pnpm db:verify` PASS. No credential, real Telegram, remote or production mutation.
- **Stop conditions:** factory duplication changes instance/transaction identity.

#### R2-13A — Cut profile consumers to the module owner

- **Status:** `completed`
- **Objective:** Перевести runtime compatibility export и profile-related tests со shared legacy paths на `modules/profiles`.
- **Dependencies:** `R2-12`.
- **Read first:** nine remaining profile bridge consumers, profiles public/application/infrastructure surfaces and focused tests.
- **Scope:** switch `runtime/bot-runtime.ts` and the eight profile/cross-feature tests to the profiles module root or the exact module-owned adapter under test; no bridge deletion yet.
- **Do not touch:** assertions, profile behavior, SQL, factories or fake locations.
- **Invariants:** public contracts and direct adapter coverage remain identical; no module export is widened solely for tests.
- **Verification:** profile unit/integration/fake tests; architecture; `pnpm check`; all fake E2E; `pnpm db:verify`.
- **Exit criteria:** no active consumer imports a legacy profile path; один commit `R2-13A: cut profile consumers to module owner`.
- **Completion evidence:** Commit SHA: `SELF`; switched the runtime compatibility facade and eight profile/cross-feature test files from shared profile re-exports to `modules/profiles` public contracts or the exact feature-owned SQLite/grammY adapter under direct test. The obsolete `GrammyTelegramAudienceReader` runtime re-export is removed, and no module root was widened merely to expose infrastructure for tests. Nine source/test paths plus this plan changed; test bodies/assertions, factory construction, SQL and profile behavior stayed unchanged. Exact consumer scan finds no legacy profile import outside the passive bridge files themselves. Focused profile/cross-feature tests PASS (8 files, 52 tests); architecture PASS (156 modules, 449 dependencies); `pnpm check` PASS (69 unit, 88 integration, 47 runtime, lint/typecheck/build); all fake E2E PASS (33); `pnpm db:verify` PASS. No credential, real Telegram, remote or production mutation.
- **Stop conditions:** a consumer cannot express the same test through a module-owned surface.

#### R2-13B — Delete profile compatibility paths

- **Status:** `completed`
- **Objective:** Удалить восемь profile compatibility files из shared domain/application/infrastructure.
- **Dependencies:** `R2-13A`.
- **Read first:** exact profile zero-consumer scan and module replacements.
- **Scope:** delete legacy profile domain, services, ports, SQLite adapters and grammY audience adapter; extend graph enforcement to reject those paths.
- **Do not touch:** module implementations, tests or shared Telegram transport.
- **Invariants:** every deleted file is a passive re-export with zero consumer.
- **Verification:** exact profile old-path scan; architecture; `pnpm check`; all fake E2E; `pnpm db:verify`.
- **Exit criteria:** shared layers contain no profile implementation or bridge; один commit `R2-13B: remove profile compatibility paths`.
- **Completion evidence:** Commit SHA: `SELF`; deleted all eight passive profile compatibility files from shared domain, application ports/services and infrastructure database/Telegram paths. The feature-owned domain, services, ports and adapters are now the only source implementations, and dependency-cruiser rejects future imports of the removed profile locations. Eight deleted source paths, the architecture config and this plan changed; no executable implementation or test body changed. Exact path checks PASS; architecture PASS (148 modules, 441 dependencies); `pnpm check` PASS (69 unit, 88 integration, 47 runtime, lint/typecheck/build); all fake E2E PASS (33); `pnpm db:verify` PASS. No credential, real Telegram, remote or production mutation.
- **Stop conditions:** any active import remains.

#### R2-13C — Cut collaboration consumers to the module owner

- **Status:** `completed`
- **Objective:** Перевести showcase preflight и collaboration-focused tests на module-owned contracts/adapters.
- **Dependencies:** `R2-13B`.
- **Read first:** remaining collaboration bridge consumers, public API, module internals under focused test and preflight capability port.
- **Scope:** switch production preflight and five collaboration/domain tests; no bridge deletion yet.
- **Do not touch:** assertions, publication/draft behavior, SQL, outbox or Telegram copy.
- **Invariants:** preflight mutates the same capability object; direct adapter tests retain their original construction and coverage.
- **Verification:** collaboration unit/integration/fake and preflight tests; architecture; `pnpm check`; all fake E2E; `pnpm db:verify`.
- **Exit criteria:** no active consumer imports a legacy collaboration-core path; один commit `R2-13C: cut collaboration consumers to module owner`.
- **Completion evidence:** Commit SHA: `SELF`; switched showcase preflight and five collaboration-focused unit/integration/fake tests from shared collaboration re-exports to the collaboration public API or exact feature-owned SQLite adapters. The preflight return type now comes from the public module capability contract while preserving the same mutable object shape; direct repository tests keep their original topology without widening module exports. Six source/test paths plus this plan changed; assertions, SQL, draft/publication behavior, outbox and Telegram copy stayed unchanged. Focused collaboration/domain/preflight tests PASS (6 files, 18 tests); architecture PASS (148 modules, 441 dependencies); `pnpm check` PASS (69 unit, 88 integration, 47 runtime, lint/typecheck/build); all fake E2E PASS (33); `pnpm db:verify` PASS. No credential, real Telegram, remote or production mutation.
- **Stop conditions:** cutover changes capability identity or test topology.

#### R2-13D — Delete collaboration compatibility paths

- **Status:** `completed`
- **Objective:** Удалить одиннадцать collaboration compatibility files из shared layers.
- **Dependencies:** `R2-13C`.
- **Read first:** exact collaboration zero-consumer scan and module replacements.
- **Scope:** delete collaboration domain, draft/publication/renderer, four ports and three SQLite adapter bridges; extend graph enforcement.
- **Do not touch:** marketplace browse bridges, module code, shared outbox/platform adapters or tests.
- **Invariants:** every removed path is a passive re-export; module imports remain internal or public-root imports.
- **Verification:** exact collaboration old-path scan; architecture; `pnpm check`; all fake E2E; `pnpm db:verify`.
- **Exit criteria:** shared layers contain no collaboration-core implementation or bridge; один commit `R2-13D: remove collaboration compatibility paths`.
- **Completion evidence:** Commit SHA: `SELF`; deleted all eleven passive collaboration-core compatibility files: domain, draft/publication/renderer services, repository/session/publication/capability ports and three SQLite adapters. The collaboration module is now the sole owner, while marketplace browse remains intentionally separate for its later cutover. Dependency-cruiser rejects future imports of the removed paths. Eleven deleted source paths, the architecture config and this plan changed; no executable implementation or test changed. Exact path checks PASS; architecture PASS (137 modules, 430 dependencies); `pnpm check` PASS (69 unit, 88 integration, 47 runtime, lint/typecheck/build); all fake E2E PASS (33); `pnpm db:verify` PASS. No credential, real Telegram, remote or production mutation.
- **Stop conditions:** any active import remains.

#### R2-13E — Cut remaining feature consumers to module owners

- **Status:** `completed`
- **Objective:** Перевести marketplace, applications и moderation consumers со shared compatibility paths.
- **Dependencies:** `R2-13D`.
- **Read first:** neutral Telegram router and S3/S4 focused tests; three module entrypoints and owned adapters.
- **Scope:** switch the router browse type plus marketplace/applications/moderation unit/integration consumers; no bridge deletion yet.
- **Do not touch:** assertions, callback/deep-link bytes, SQL, hide/application behavior or route priority.
- **Invariants:** module roots remain consumer contracts; direct adapter imports are limited to focused module tests.
- **Verification:** browse/application/moderation focused tests; architecture; `pnpm check`; all fake E2E; `pnpm db:verify`.
- **Exit criteria:** no active consumer imports any remaining legacy feature path; один commit `R2-13E: cut remaining feature consumers`.
- **Completion evidence:** Commit SHA: `SELF`; switched the neutral router and seven marketplace/applications/moderation test files from the final shared feature bridges to module public contracts or exact same-module application/infrastructure targets under focused test. Concrete `ApplicationService` and SQLite adapters remain internal test targets rather than being exposed through public roots. Eight source/test paths plus this plan changed; assertions, callbacks/deep links, SQL, route priority, application effects and moderation hide behavior stayed unchanged. Focused browse/application/moderation/routing tests PASS (8 files, 46 tests); architecture PASS (137 modules, 430 dependencies); `pnpm check` PASS (69 unit, 88 integration, 47 runtime, lint/typecheck/build); all fake E2E PASS (33); `pnpm db:verify` PASS. No credential, real Telegram, remote or production mutation.
- **Stop conditions:** a stable module-owned replacement is missing.

#### R2-13F — Remove remaining feature bridges and misplaced deadline policy

- **Status:** `completed`
- **Objective:** Физически удалить marketplace, applications и moderation compatibility files, а collaboration deadline policy передать доменному owner.
- **Dependencies:** `R2-13E`.
- **Read first:** exact source import graph, seven remaining bridge files, `infrastructure/time/deadline.ts`, its two production consumers and primitive test.
- **Scope:** delete three browse, one applications and three moderation re-exports; move deadline parsing/formatting/due predicates under collaboration domain and switch its canonical domain/application consumers plus primitive test; finalize architecture rejection of all legacy feature paths.
- **Do not touch:** shared command/outbox/platform code, deadline semantics/assertions, unrelated module implementations or test support.
- **Invariants:** no feature code or compatibility export survives in shared domain/application/infrastructure; deadline behavior has one collaboration-owned implementation.
- **Verification:** zero legacy feature scan over `src` and `test`; architecture; `pnpm check`; all fake E2E; `pnpm db:verify`.
- **Exit criteria:** feature-first completion definition holds for production `src`; один commit `R2-13F: remove remaining feature bridges`.
- **Completion evidence:** Commit SHA: `SELF`; deleted the final seven marketplace/applications/moderation compatibility exports and removed their empty shared directories. Moved the duplicate collaboration date/deadline primitive from generic infrastructure into `modules/collaborations/domain/deadline.ts`; the collaboration domain now uses that canonical parse/format/end-of-day logic and publication uses its inclusive mutation/due predicates instead of duplicate comparisons. The primitive test follows the real owner unchanged. Dependency-cruiser rejects all removed legacy feature/deadline imports. Exactly twelve source/test paths plus architecture config and this plan changed; deadline boundaries, SQL, product policy and Telegram behavior stayed unchanged. Deadline/domain/publication focused tests PASS (3 files, 19 tests); exact source/test old-path scans PASS; architecture PASS (130 modules, 420 dependencies); `pnpm check` PASS (69 unit, 88 integration, 47 runtime, lint/typecheck/build); all fake E2E PASS (33); `pnpm db:verify` PASS. No credential, real Telegram, remote or production mutation.
- **Stop conditions:** any bridge still has an active consumer.

#### R2-14A — Move the grammY API fake to test support

- **Status:** `completed`
- **Objective:** Убрать `FakeTelegramApi` из production source.
- **Dependencies:** `R2-13F`.
- **Read first:** fake implementation and its ten sorted consumers.
- **Scope:** move the fake to `test/support/fake-telegram-api.ts` and switch all ten consumers in one bounded mechanical cutover.
- **Do not touch:** assertions, fake response behavior or `FakeTelegramTransport`.
- **Invariants:** grammY HTTP fake remains distinct from the application transport fake.
- **Verification:** affected fake/runtime tests; all suites; architecture; `pnpm check`; `pnpm test:e2e:fake`; `pnpm db:verify`.
- **Exit criteria:** old API-fake path is absent; один commit `R2-14A: move Telegram API fake to test support`.
- **Completion evidence:** Commit SHA: `SELF`; moved the unchanged local grammY Bot API fake from production infrastructure to `test/support/fake-telegram-api.ts` and switched its ten support/runtime/E2E consumers. The fake remains the same networkless `fetch` surface and stays distinct from the port-level delivery transport fake. Exactly twelve source/test paths plus this plan changed; fake responses/call recording, test assertions and production code stayed unchanged. Old source/import scan PASS; affected support/runtime/E2E tests PASS (9 files, 34 tests); architecture PASS (129 modules, 419 dependencies); `pnpm check` PASS (69 unit, 88 integration, 47 runtime, lint/typecheck/build); all fake E2E PASS (33); `pnpm db:verify` PASS. No credential, real Telegram, remote or production mutation.
- **Stop conditions:** any production code consumes the fake.

#### R2-14B — Move the Telegram transport fake to test support

- **Status:** `completed`
- **Objective:** Убрать port-level `FakeTelegramTransport` из production source.
- **Dependencies:** `R2-14A`.
- **Read first:** transport fake and its four integration/runtime consumers.
- **Scope:** move the fake to `test/support/fake-telegram-transport.ts` and switch all consumers.
- **Do not touch:** provider behavior, assertions or grammY API fake.
- **Invariants:** delivery result/error semantics remain byte-for-byte compatible.
- **Verification:** affected delivery/application/moderation tests; all suites; architecture; `pnpm check`; `pnpm test:e2e:fake`; `pnpm db:verify`.
- **Exit criteria:** old transport-fake path is absent; один commit `R2-14B: move Telegram transport fake to test support`.
- **Completion evidence:** Commit SHA: `SELF`; moved the unchanged port-level Telegram delivery fake to `test/support/fake-telegram-transport.ts`, adjusted its production port imports for the new location and switched all four integration/runtime consumers. The Bot API fake and transport fake remain distinct abstractions. Six source/test paths plus this plan changed; outcomes, safe-call hashing, abort semantics and assertions stayed unchanged. Old source/import scan PASS; affected delivery/publication/application/moderation tests PASS (4 files, 41 tests); architecture PASS (128 modules, 416 dependencies); `pnpm check` PASS (69 unit, 88 integration, 47 runtime, lint/typecheck/build); all fake E2E PASS (33); `pnpm db:verify` PASS. No credential, real Telegram, remote or production mutation.
- **Stop conditions:** any production code consumes the fake.

#### R2-14C — Establish the test-owned fake clock

- **Status:** `completed`
- **Objective:** Создать test-support owner для `FakeClock` без oversized consumer diff.
- **Dependencies:** `R2-14B`.
- **Read first:** fake clock and the recorded first cohort: unit `s0-02`; integration `s0-04-ingress`, `s0-04-schema`, `s0-05-outbox`, `r1-07`, `r1-03`, `r2-03`, `r2-06`, `r2-07a`; runtime `s0-06`, `r1-06b`.
- **Scope:** add `test/support/fake-clock.ts` as a temporary exact re-export of the still-canonical source implementation and switch those eleven consumers.
- **Do not touch:** source implementation, clock behavior, timestamps, assertions or remaining importers.
- **Invariants:** production source never imports test support; every test retains its explicit clock instance.
- **Verification:** affected tests; all suites; architecture; `pnpm check`; `pnpm test:e2e:fake`; `pnpm db:verify`.
- **Exit criteria:** canonical implementation is test-owned and first cohort uses it; один commit `R2-14C: establish test-owned fake clock`.
- **Completion evidence:** Commit SHA: `SELF`; added `test/support/fake-clock.ts` as the one-way test facade over the still-canonical source implementation and switched the recorded first eleven unit/integration/runtime consumers. Production source does not import test support, and every test still constructs an explicit independent clock. Twelve source/test paths plus this plan changed; clock behavior, timestamps, assertions and remaining consumers stayed unchanged. Affected tests PASS (11 files, 60 tests); architecture PASS (128 modules, 416 dependencies); `pnpm check` PASS (69 unit, 88 integration, 47 runtime, lint/typecheck/build); all fake E2E PASS (33); `pnpm db:verify` PASS. No credential, real Telegram, remote or production mutation.
- **Stop conditions:** source production code imports `FakeClock`.

#### R2-14D — Cut the second fake-clock consumer cohort

- **Status:** `completed`
- **Objective:** Перевести двенадцать записанных integration/unit consumers на test-support facade.
- **Dependencies:** `R2-14C`.
- **Read first:** integration `r2-08`, `r2-10a`, `s1-01`, `s1-02`, `s2-01`, `s2-02`, `s3-02`, `s3-03`, `s3-04`, `s4-01`; unit `fut-01`, `s3-04`.
- **Scope:** twelve import-only changes; test-support facade continues to re-export the source implementation.
- **Do not touch:** fake implementation, assertions or final three E2E consumers.
- **Invariants:** test timestamps/lifecycle remain explicit and unchanged.
- **Verification:** affected tests; all suites; architecture; `pnpm check`; `pnpm test:e2e:fake`; `pnpm db:verify`.
- **Exit criteria:** only three E2E tests import the source path; один commit `R2-14D: cut second fake-clock cohort`.
- **Completion evidence:** Commit SHA: `SELF`; switched the recorded twelve integration/unit files to the test-support FakeClock facade. The facade still delegates to the unchanged canonical implementation; only the three scheduled E2E consumers plus the facade itself retain the source import. Exactly twelve import-only test paths plus this plan changed; timestamps, assertions, DB isolation and lifecycle stayed unchanged. Affected tests PASS (12 files, 81 tests); remaining-import audit matches the recorded final cohort; architecture PASS (128 modules, 416 dependencies); `pnpm check` PASS (69 unit, 88 integration, 47 runtime, lint/typecheck/build); all fake E2E PASS (33); `pnpm db:verify` PASS. No credential, real Telegram, remote or production mutation.
- **Stop conditions:** recorded cohort or importer count differs at preflight.

#### R2-14E — Remove the fake-clock source bridge

- **Status:** `completed`
- **Objective:** Перевести последние три E2E importers и удалить последний test-only production path.
- **Dependencies:** `R2-14D`.
- **Read first:** E2E `s1-02`, `s2-01`, `s3-02`, facade content and exact `src/infrastructure/testing|time` scan.
- **Scope:** replace the test-support facade with the unchanged implementation, switch final three imports, delete `src/infrastructure/time/fake-clock.ts` and enforce absence of all three test-only adapters from `src`.
- **Do not touch:** assertions, production clocks/deadlines or test lifecycle.
- **Invariants:** all tests use the same moved implementation and no production module depends on it.
- **Verification:** all suites together; architecture; `pnpm check`; `pnpm test:e2e:fake`; `pnpm db:verify`; zero test-only source scan.
- **Exit criteria:** production `src` has no test-only adapter; один commit `R2-14E: remove fake-clock source bridge`.
- **Completion evidence:** Commit SHA: `SELF`; replaced the temporary test facade with the byte-identical FakeClock implementation, switched the final three E2E consumers and deleted `src/infrastructure/time/fake-clock.ts` plus the now-empty `src/infrastructure/testing` directory. Production `src` now contains no test-only clock, grammY API fake or Telegram transport fake. Five source/test paths plus this plan changed; clock validation/mutation behavior, explicit per-test instances, assertions and lifecycle stayed unchanged. Exact old-path/source scans PASS; focused final E2E/primitive tests PASS (4 files, 32 tests); architecture PASS (127 modules, 415 dependencies); `pnpm check` PASS (69 unit, 88 integration, 47 runtime, lint/typecheck/build); all fake E2E PASS (33); `pnpm db:verify` PASS. No credential, real Telegram, remote or production mutation.
- **Stop conditions:** any source consumer or behavioral difference remains.

#### R2-15 — Close the physical transition

- **Status:** `completed`
- **Objective:** Синхронизировать TD/README, доказать completed tree и независимо проверить весь R2 candidate.
- **Dependencies:** `R2-14E`.
- **Read first:** full R2 diff/log, actual tree/import graph, all unit evidence and docs.
- **Scope:** docs/status/ledger; full stage gates; one blocker-limited independent review; at most one consolidated fix wave.
- **Do not touch:** new behavior/dependency/refactor, real Telegram, production or remote.
- **Invariants:** local/fake evidence не выдаётся за real smoke; PRD/migrations/contracts unchanged.
- **Verification:** complete stage gate plus exact old-path/empty-dir/source-tree audit.
- **Exit criteria:** R2 `completed`, docs match source, clean local commit `R2-15: close feature-first transition evidence`.
- **Completion evidence:** Commit SHA: `SELF`; синхронизированы README и TD 0.7 с фактическими пятью feature modules, двумя допустимыми public surfaces (`index.ts` и узкий `application/index.ts`), cross-feature Telegram orchestration, applications/moderation transaction ownership, raw-SQL решением, реальным startup/shutdown и test-support ownership. Ledger дополнен R2-14E и исправлен по authoritative Task-ID commits. Безопасно удалён только ignored/untracked/non-symlink generated `dist`, после чего fresh build содержит 460 файлов вместо 700 stale artifacts; exact scans не находят `src/bot`, legacy feature paths/imports, empty `src` directories, test-only production adapters, source-to-test edges, shared-to-feature edges или runtime deep feature imports. R2 pre-closure range содержит 30 уникальных Task-ID commits и 107 changed paths; PRD, migrations, package и lock contracts не менялись. `pnpm check` PASS (architecture 127 modules/415 dependencies, 69 unit, 88 integration, 47 runtime, lint/typecheck/build); `pnpm test:e2e:fake` PASS (33); `pnpm db:verify` PASS; `git diff --check` PASS. Единственный независимый blocker-limited review полного candidate: PASS — нет credential/private-contact exposure, authoritative-data corruption, duplicated business/Telegram effects, broken core journey или unrunnable candidate. Real Telegram, credentials, production, remote, push, PR и deploy не затрагивались.
- **Stop conditions:** confirmed blocker, non-green aggregate gate or incomplete physical transition.

### R3 — Honest top-level ownership

R3 завершает не feature ownership, уже закрытый в R2, а честное именование оставшихся общих owners. Целевая структура:

```text
src/
  modules/                    five business verticals
  shared/
    domain/                   framework-free shared vocabulary
    application/              shared use-case contracts, ports and policies
  platform/
    database/                 shared SQLite adapters and migrations boundary
    telegram/                 grammY transport adapter
    crypto/                   hashing, codecs and token implementations
    logging/                  safe process logging
    time/                     system clock and provider deadline adapter
    outbox/                   SQLite delivery and product-event adapters
  runtime/
    telegram/                 cross-feature Telegram ingress and routing
    composition/              process object graph
    lifecycle/                worker and shutdown lifecycle
    bootstrap/                env/private-path startup preparation
  config/                     pure configuration parsing
  cli/                        executable entrypoints
```

`shared/application` — не импровизированный framework layer: это внутреннее framework-free ядро, которое определяет порты, а `platform` их реализует. NestJS/DI container, ORM и новые зависимости не входят в R3; composition roots остаются явными TypeScript factories. Поведение, SQL, migrations, Telegram copy/callback bytes и public feature APIs не меняются.

#### R3-00 — Define honest top-level ownership

- **Status:** `completed`
- **Objective:** Зафиксировать полный target и исполняемую последовательность перехода до начала path mutations.
- **Dependencies:** `R2-15`.
- **Read first:** фактическое дерево/import graph, README Code organization, TD architecture/runtime sections, dependency-cruiser rules.
- **Scope:** только этот registry: target tree, ownership/dependency decisions, bounded units, verification and stop conditions.
- **Do not touch:** source, tests, migrations, dependencies, product policy or runtime behavior.
- **Invariants:** `shared` points inward and is framework-free; `platform` implements shared/module ports; `runtime` is the only global composition shell; no NestJS or compatibility tree is introduced.
- **Verification:** Node/pnpm contract; clean preflight; `pnpm architecture`; `git diff --check`; documentation-only diff.
- **Exit criteria:** decision-complete R3 registry; one commit `R3-00: define honest top-level ownership`.
- **Completion evidence:** Commit SHA: `SELF`; preflight confirmed clean `main` at unique `R2-15` `6a4a6f142c7cd95a4c81f473af2ca7ec135a935f`, Node `v24.18.0` and pnpm `11.15.1`. Registry-only diff defines the exact `modules/shared/platform/runtime/config/cli` target, inward shared-kernel dependency direction, platform adapters, global runtime shell and fourteen bounded sequential units. `pnpm architecture` PASS (127 modules, 415 dependencies); `git diff --check` PASS; only this plan changed. No source, test, migration, dependency, credential, real Telegram, production or remote mutation.
- **Stop conditions:** target requires a product-policy, schema, behavior or dependency change.

#### R3-01 — Move shared domain vocabulary

- **Status:** `completed`
- **Objective:** Move the only cross-feature domain vocabulary to `shared/domain`.
- **Dependencies:** `R3-00`.
- **Scope:** move `domain/value-objects/enums.ts`, switch exact consumers, delete empty root `domain`.
- **Do not touch:** enum values, validation, feature-owned domain or behavior.
- **Verification:** exact old-path scan; domain/unit tests; typecheck; architecture.
- **Exit criteria:** no `src/domain`; one commit `R3-01: move shared domain vocabulary`.
- **Completion evidence:** Commit SHA: `SELF`; moved the byte-identical shared enums, parsers and `DomainValidationError` to `src/shared/domain/value-objects/enums.ts`, switched all twenty source/test consumers and removed the empty root domain tree. The wider-than-normal file count is one exact import-only cutover of a single vocabulary owner; enum values, validation and feature behavior are unchanged. Exact old-root/path scan PASS; focused primitive/collaboration-domain tests PASS (2 files, 15 tests); typecheck PASS; architecture PASS (127 modules, 415 dependencies); `git diff --check` PASS. No schema, dependency, credential, real Telegram, production or remote mutation.

#### R3-02A — Move shared core application ports

- **Status:** `completed`
- **Objective:** Establish `shared/application/ports` with framework-free core contracts.
- **Dependencies:** `R3-01`.
- **Scope:** clock, transaction, provider-deadline, claim-token, ingress-crypto and wizard-admission ports plus exact consumers.
- **Do not touch:** implementations, signatures or policy.
- **Verification:** exact old-path scan; focused primitive/ingress tests; typecheck; architecture.
- **Exit criteria:** core port imports use `shared`; one commit `R3-02A: move shared core application ports`.
- **Completion evidence:** Commit SHA: `SELF`; moved six byte-identical core contracts (`Clock`, transaction runner, provider deadline, claim-token generator, ingress crypto and wizard admission) to `shared/application/ports` and performed one mechanical cutover across their 49 direct consumers. The deliberately broad diff is caused by the ubiquitous clock/transaction types; retaining a legacy facade would only prolong the invalid root. Signatures, implementations and policies are unchanged. Typecheck PASS; architecture PASS (127 modules, 415 dependencies); focused primitives/wizard/delivery tests PASS (3 files, 33 tests); exact old-port import scan and `git diff --check` PASS. No schema, dependency, credential, real Telegram, production or remote mutation.

#### R3-02B — Move shared durable-effect ports

- **Status:** `completed`
- **Objective:** Move durable command/outbox/event store contracts under the shared application kernel.
- **Dependencies:** `R3-02A`.
- **Scope:** callback-action, durable-command, outbox-delivery and product-event store ports plus consumers.
- **Do not touch:** durable semantics, claim state or delivery policy.
- **Verification:** focused durable/outbox tests; typecheck; architecture; old-path scan.
- **Exit criteria:** durable store ports have one shared owner; one commit `R3-02B: move shared durable effect ports`.
- **Completion evidence:** Commit SHA: `SELF`; moved the four provider-neutral callback-action, durable-command, outbox-delivery and product-event store contracts to `shared/application/ports`, switched every direct consumer and kept temporary inward references to the not-yet-moved shared command/outbox policies explicit. Store shapes, error classes, statuses and durability semantics are unchanged. Typecheck PASS; architecture PASS (127 modules, 415 dependencies); focused ingress/outbox/delivery tests PASS (3 files, 35 tests); old-port import scan and `git diff --check` PASS. No SQL, schema, dependency, credential, real Telegram, production or remote mutation.

#### R3-02C — Move shared Telegram ports

- **Status:** `completed`
- **Objective:** Move provider-neutral Telegram transport/user contracts under shared application.
- **Dependencies:** `R3-02B`.
- **Scope:** Telegram transport, lookup and writer ports plus consumers.
- **Do not touch:** grammY adapters, delivery results or user snapshot behavior.
- **Verification:** focused Telegram/delivery tests; typecheck; architecture; old-path scan.
- **Exit criteria:** no Telegram port remains in root application; one commit `R3-02C: move shared Telegram ports`.
- **Completion evidence:** Commit SHA: `SELF`; moved the provider-neutral Telegram transport, user lookup and user writer contracts to `shared/application/ports`, switched all direct consumers and preserved the temporary reference to the not-yet-moved delivery payload policy. Transport failure codes/phases, snapshots and adapter behavior are unchanged. Typecheck PASS; architecture PASS (127 modules, 415 dependencies); focused transport/delivery/application tests PASS (3 files, 31 tests); root ports are empty, old imports and `git diff --check` PASS. No SQL, schema, dependency, credential, real Telegram, production or remote mutation.

#### R3-03 — Move shared command policies

- **Status:** `completed`
- **Objective:** Move command execution, canonical input and safe-result policies under shared application.
- **Dependencies:** `R3-02C`.
- **Scope:** root `application/commands` and all exact imports.
- **Do not touch:** canonical bytes, receipts, replay, validation or result shapes.
- **Verification:** command/ingress focused tests; typecheck; architecture; old-path scan.
- **Exit criteria:** command policies have one shared owner; one commit `R3-03: move shared command policies`.
- **Completion evidence:** Commit SHA: `SELF`; moved all six canonical-input, command-contract, executor, callback-action, actor-guard and safe-result policies to `shared/application/commands`, switched every consumer and normalized their now-local shared port imports. Canonical input, receipt/replay, callback and safe-result behavior are unchanged. Typecheck PASS; architecture PASS (127 modules, 415 dependencies); focused command/ingress tests PASS (3 files, 12 tests); old command path and `git diff --check` PASS. No SQL, schema, dependency, credential, real Telegram, production or remote mutation.

#### R3-04 — Move shared outbox policies

- **Status:** `completed`
- **Objective:** Complete shared application ownership and remove root `application`.
- **Dependencies:** `R3-03`.
- **Scope:** outbox payload/runner/service and product-event contracts/service plus consumers; remove empty root `application`.
- **Do not touch:** semantic keys, retry/ambiguity behavior, payload bytes or event contracts.
- **Verification:** focused outbox/delivery tests; typecheck; architecture; exact root scan.
- **Exit criteria:** no `src/application`; one commit `R3-04: complete shared application ownership`.
- **Completion evidence:** Commit SHA: `SELF`; moved all five delivery payload/runner/service and product-event contract/service policies to `shared/application/outbox`, switched every consumer, normalized local shared-port references and removed the empty root `src/application`. Payload bytes, semantic keys, retry/ambiguity handling and event contracts are unchanged. Typecheck PASS; architecture PASS (127 modules, 415 dependencies); focused outbox/delivery/publication tests PASS (3 files, 32 tests); exact old-root/path scan and `git diff --check` PASS. No SQL, schema, dependency, credential, real Telegram, production or remote mutation.

#### R3-05A — Move platform primitives

- **Status:** `completed`
- **Objective:** Rename shared technical implementations from generic infrastructure to capability-oriented platform owners.
- **Dependencies:** `R3-04`.
- **Scope:** crypto, logging, Telegram transport and time adapters under `platform`; switch consumers.
- **Do not touch:** crypto/token formats, logging redaction, provider deadlines or grammY behavior.
- **Verification:** primitive/transport tests; typecheck; architecture; old-path scan.
- **Exit criteria:** four platform capabilities use target paths; one commit `R3-05A: move platform primitives`.
- **Completion evidence:** Commit SHA: `SELF`; moved eight unchanged crypto, safe-logging, grammY transport and system-time/provider-deadline implementations under `platform/{crypto,logging,telegram,time}`, switched every consumer and made the still-unmoved migration adapter's temporary platform-time dependency explicit. Formats, redaction and provider behavior are unchanged. Typecheck PASS; architecture PASS (127 modules, 415 dependencies); focused primitives/crypto/transport/delivery tests PASS (4 files, 38 tests); old capability paths and `git diff --check` PASS. No SQL, schema, dependency, credential, real Telegram, production or remote mutation.

#### R3-05B — Move shared database adapters

- **Status:** `completed`
- **Objective:** Move the shared SQLite boundary and non-outbox repositories to `platform/database`.
- **Dependencies:** `R3-05A`.
- **Scope:** database boundary, migrations, transaction runner, ingress/durable/user/wizard repositories and exact consumers.
- **Do not touch:** SQL, migration files/checksums, transaction boundaries or persistence behavior.
- **Verification:** database/ingress focused tests; `pnpm db:verify`; typecheck; architecture; old-path scan.
- **Exit criteria:** shared database adapters use platform owner; one commit `R3-05B: move shared database adapters`.
- **Completion evidence:** Commit SHA: `SELF`; moved the SQLite boundary, migration runner, transaction runner and callback/durable/retention/user/wizard adapters to `platform/database`, switched all consumers, restored the local platform-time relation and left only the two scheduled outbox adapters in the old tree with explicit boundary imports. SQL, migration files/checksums and transaction behavior are unchanged. Typecheck PASS; architecture PASS (127 modules, 415 dependencies); focused migration/ingress/wizard tests PASS (2 files, 8 tests); `pnpm db:verify` PASS; old adapter import scan and `git diff --check` PASS. No schema, dependency, credential, real Telegram, production or remote mutation.

#### R3-05C — Establish platform outbox adapters

- **Status:** `completed`
- **Objective:** Give durable delivery/event SQLite adapters an explicit platform capability owner and remove root infrastructure.
- **Dependencies:** `R3-05B`.
- **Scope:** move outbox delivery and product-event repositories to `platform/outbox`, switch consumers, remove empty `src/infrastructure`.
- **Do not touch:** repository SQL, claim fencing, statuses or history semantics.
- **Verification:** outbox/event integration tests; `pnpm db:verify`; typecheck; architecture; exact root scan.
- **Exit criteria:** no `src/infrastructure`; one commit `R3-05C: establish platform outbox adapters`.
- **Completion evidence:** Commit SHA: `SELF`; moved the final two SQLite outbox-delivery and product-event adapters to `platform/outbox`, switched all consumers, normalized their dependency on `platform/database` and removed the empty root `src/infrastructure`. Repository classes, SQL, claim fencing, statuses and history semantics are unchanged. Typecheck PASS; architecture PASS (127 modules, 415 dependencies); focused outbox/delivery/decision tests PASS (3 files, 40 tests); `pnpm db:verify` PASS; exact old-root/path scan and `git diff --check` PASS. No schema, dependency, credential, real Telegram, production or remote mutation.

#### R3-06 — Move the global Telegram shell

- **Status:** `completed`
- **Objective:** Make cross-feature Telegram ingress/routing explicit runtime adapters rather than a misleading root presentation layer.
- **Dependencies:** `R3-05C`.
- **Scope:** move the three root Telegram files to `runtime/telegram`, switch consumers, remove `src/presentation`.
- **Do not touch:** route order, callback acknowledgement, durable envelopes, reply buffering or feature presentation.
- **Verification:** ingress/router/runtime focused tests; typecheck; architecture; old-path scan.
- **Exit criteria:** no root presentation tree; one commit `R3-06: move global Telegram shell`.
- **Completion evidence:** Commit SHA: `SELF`; moved durable Telegram ingress, cross-feature router and route-precedence policy unchanged to `runtime/telegram`, switched runtime/direct tests and removed the empty root `src/presentation`. Feature-owned Telegram composers remain inside their modules. Typecheck PASS; architecture PASS (127 modules, 415 dependencies); focused ingress/routing tests PASS (2 files, 2 tests); exact old-root/path scan and `git diff --check` PASS. Route order, durable envelopes, callback acknowledgement and reply behavior are unchanged; no credential, real Telegram, production or remote mutation.

#### R3-07A — Group runtime bootstrap and lifecycle

- **Status:** `completed`
- **Objective:** Replace the flat runtime bag with explicit startup and lifecycle owners.
- **Dependencies:** `R3-06`.
- **Scope:** move bootstrap/env/private-path files under `runtime/bootstrap` and lifecycle/worker/process files under `runtime/lifecycle`; switch consumers.
- **Do not touch:** startup order, signal semantics, drain/worker timing or filesystem policy.
- **Verification:** runtime/bootstrap/lifecycle tests; typecheck; architecture; old-path scan.
- **Exit criteria:** bootstrap/lifecycle owners are explicit; one commit `R3-07A: group runtime bootstrap and lifecycle`.
- **Completion evidence:** Commit SHA: `SELF`; grouped bot bootstrap, env loading and private paths under `runtime/bootstrap`, and lifecycle, delivery worker and signal runner under `runtime/lifecycle`; switched CLI, runtime facade, composition and direct tests. Startup/shutdown/worker code is byte-identical apart from imports. Typecheck PASS; architecture PASS (127 modules, 415 dependencies); focused bootstrap/lifecycle/worker/process tests PASS (4 files, 17 tests); flat old paths and `git diff --check` PASS. No behavior, schema, dependency, credential, real Telegram, production or remote mutation.

#### R3-07B — Group runtime composition

- **Status:** `completed`
- **Objective:** Put object-graph construction under `runtime/composition` while retaining one narrow runtime facade for CLI/tests.
- **Dependencies:** `R3-07A`.
- **Scope:** move bot application and showcase preflight to composition; adjust bot runtime/CLI imports and public facade deliberately.
- **Do not touch:** feature factories, database ownership, startup/preflight order or runtime API behavior.
- **Verification:** composition/runtime/fake E2E; typecheck; architecture; flat-runtime audit.
- **Exit criteria:** runtime tree matches the target and no compatibility implementation remains; one commit `R3-07B: group runtime composition`.
- **Completion evidence:** Commit SHA: `SELF`; moved the real object graph and showcase preflight to `runtime/composition`, switched bootstrap, facade and direct tests, and retained only `runtime/bot-runtime.ts` as the deliberate narrow compatibility/public facade used by established consumers. Composition imports all five modules through their public roots; startup order and factories are unchanged. Typecheck PASS; architecture PASS (127 modules, 415 dependencies); focused composition/preflight/bootstrap/fake tests PASS (4 files, 17 tests); flat-runtime audit and `git diff --check` PASS. No behavior, schema, dependency, credential, real Telegram, production or remote mutation.

#### R3-08 — Enforce and document the completed tree

- **Status:** `completed`
- **Objective:** Make the target executable, synchronize docs and close R3 on complete evidence.
- **Dependencies:** `R3-07B`.
- **Scope:** rewrite architecture rules for `shared/platform/runtime`, update README and TD, authoritative ledger, exact tree/import audit and one blocker-limited critical review.
- **Do not touch:** product behavior, migrations, dependencies, real Telegram, production or remote.
- **Invariants:** top-level source directories are exactly `modules`, `shared`, `platform`, `runtime`, `config`, `cli`; modules use only public cross-feature surfaces; shared imports neither platform nor runtime; platform imports neither modules nor runtime; no source imports tests.
- **Verification:** `pnpm architecture`; `pnpm check`; `pnpm test:e2e:fake`; `pnpm db:verify`; exact old-root/empty-dir/dependency scans; `git diff --check`.
- **Exit criteria:** R3 completed and documented; one commit `R3-08: close top-level ownership transition`.
- **Completion evidence:** Commit SHA: `SELF`; rewrote dependency-cruiser policy around the real `shared/platform/runtime` boundaries, migrated its three layer fixtures, synchronized README and TD 0.8, and recorded authoritative R3 commits. Exact top-level audit returns only `cli`, `config`, `modules`, `platform`, `runtime`, `shared`; no legacy or empty source directories, old source/test import paths, source-to-test edges, runtime deep-feature imports or shared/platform outward edges remain. Full R3 source diff contains only file moves and import-specifier changes after rename normalization; package, lockfile, SQL migrations, behavior and public feature APIs are unchanged. The first aggregate run correctly failed only on old architecture fixtures; after one scoped fixture update, focused policy tests PASS (5). Final `pnpm check` PASS (architecture 127 modules/415 dependencies, 69 unit, 88 integration, 47 runtime, lint/typecheck/build); `pnpm test:e2e:fake` PASS (33); `pnpm db:verify` PASS; `git diff --check` PASS. A separate final blocker-limited critical pass found no credential/private-contact exposure, authoritative-data change, duplicate business/Telegram effect, broken core journey or unrunnable candidate; because current execution rules prohibited agent delegation, this pass was performed by the implementing agent and is not represented as an independent second-agent review. No credential, real Telegram, production, remote, push, PR or deploy mutation.
- **Stop conditions:** any behavior/schema/dependency change, non-green aggregate gate or unresolved blocker.

### CF — Выбранная Cloudflare-топология и бесплатная граница

Целевая production-топология:

```text
Telegram webhook
  → public Cloudflare Worker (secret/header/body/route boundary)
  → singleton SQLite-backed Durable Object `collaboration-bot-primary`
      ├── grammY `handleUpdate`
      ├── application/domain без изменения продуктовых решений
      ├── private SQLite storage и serialized transaction boundary
      └── one durable alarm over the existing outbox schedule
  → Telegram Bot API outside storage transactions
```

Выбран именно один SQLite-backed Durable Object, а не D1. Решение основано не на цене человеческого переноса, а на целевой модели согласованности:

- product commands атомарно меняют несколько связанных состояний, конкурируют за последнее место и должны детерминированно разрешать `accept`/`block`/replay races; singleton Durable Object является одним serialization owner для этих решений;
- private strongly-consistent SQLite и storage transactions сохраняют гарантию «receipt + business state + outbox атомарны», а текущий `DurableCommandExecutor` подтверждает, что эта гарантия реально используется, а не является удобством legacy-кода;
- alarm точно соответствует durable outbox: один ближайший deadline хранится рядом с authoritative data, alarm имеет at-least-once delivery, а claim fencing остаётся защитой от повторной отправки;
- качественная D1 + Queues модель возможна, но должна отдельно реализовать CAS/conditional batch protocols, ingress ordering, at-least-once deduplication и outbox/Queue reconciliation. Для текущего Telegram-first MVP это увеличивает поверхность correctness/failure states без пользовательского или эксплуатационного выигрыша.

Evolution boundary не является обязательной цепочкой миграций:

- появление TMA или web UI добавляет HTTP adapter к тем же application use cases; все authoritative commands продолжают проходить через singleton Durable Object;
- D1 вводится только отдельным будущим решением как derived query/read model, если доказаны сложные публичные выборки, независимые readers или read load, который невыгодно обслуживать через Durable Object; такая проекция обновляется идемпотентно из durable state/outbox и не создаёт второй authoritative writer;
- Queues нужны только если появится доказанная независимая асинхронная обработка или доставка проекции; сам факт TMA/web их не требует;
- при доказанном quota/throughput/operations trigger и появившемся бюджете допустим прямой переход `Durable Object → PostgreSQL на VPS` без промежуточного D1; repository/application boundaries должны сохранить эту возможность;
- D1/read model, Queues и VPS/PostgreSQL не входят в CF1–CF3 и требуют отдельного плана и пользовательской авторизации.

Повторно проверенная на `2026-08-30` free-only граница:

- [Workers Free limits](https://developers.cloudflare.com/workers/platform/limits/): 100,000 inbound requests/day, 10 ms CPU для front Worker request, 128 MB memory; front Worker поэтому только валидирует и маршрутизирует, а не исполняет business flow;
- [Durable Objects pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/): 100,000 DO requests/day, 13,000 GB-s/day, 5 million rows read/day, 100,000 rows written/day и 5 GB SQLite storage total на Free; при исчерпании free quota операции fail closed, если account действительно остаётся на Workers Free;
- [Durable Objects limits](https://developers.cloudflare.com/durable-objects/platform/limits/) и [FAQ](https://developers.cloudflare.com/durable-objects/reference/faq/): 30 seconds CPU per DO request и до 10 GB на один SQLite-backed object; для подтверждённого Free account общий 5 GB SQLite storage limit наступает раньше и является фактической границей singleton проекта;
- [Durable Object alarms](https://developers.cloudflare.com/durable-objects/api/alarms/): один alarm на object, at-least-once execution и автоматические retries; приложение хранит много due items в outbox и планирует alarm на ближайший;
- [SQLite storage/PITR](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/): SQL transactions и recovery bookmarks до 30 дней; PITR дополняет, но не заменяет проверяемый экспорт перед рискованным cutover;
- [local Durable Object environment](https://developers.cloudflare.com/durable-objects/reference/environments/): `wrangler dev` создаёт отдельное local-only окружение; production data по умолчанию локально не открывается.

Free-only является stop condition: никакой unit не включает Workers Paid, billing subscription, paid add-on или ресурс, требующий оплаты. Если Cloudflare предлагает upgrade/payment либо account уже находится на платном Workers plan с риском overage, remote stage останавливается до отдельного решения пользователя.

### CF1 — Cloudflare-compatible local runtime

#### CF1-00 — Зафиксировать Cloudflare technical contract

- **Status:** `completed`
- **Objective:** Заменить устаревший long-polling/LaunchAgent target в Technical Design на dual local/Cloudflare contract, не меняя PRD journey.
- **Dependencies:** `R3-08` completed.
- **Read first:** PRD §1, §3.3, §6, §13–16, §19–20; TD §1–3, §7, §10–13, §15–20, §23; CF target/free boundary above.
- **Scope:** `docs/TECHNICAL_DESIGN.md`, `README.md`, this plan; topology, storage/transaction/alarm rules, local polling relay, migration/cutover evidence and rollback semantics.
- **Do not touch:** source, migrations, package files, credentials, Telegram, Cloudflare account or remote.
- **Invariants:** product policy and `LFR-*`/`LAC-*` remain unchanged; D1 is not described as globally unsuitable or as an automatic TMA/web migration; hosted/24x7 is not claimed before CF3 evidence.
- **Verification:** document contradiction scan for `long polling`, `DatabaseSync`, LaunchAgent, backup and production-ready claims; relative links; `git diff --check`.
- **Exit criteria:** sources agree on the target and proof boundaries; one commit `CF1-00: define Cloudflare runtime contract`.
- **Evidence:** Commit SHA: `SELF`. Preflight confirmed clean `main` at `c4c5bfbc5f9696b63e0acf89182990017c2237fb`, matching `origin/main`, Node `v24.18.0` and pnpm `11.15.1`. Updated README and Technical Design to distinguish the legacy Node/SQLite rollback runtime from the local-only Worker → singleton SQLite Durable Object candidate; documented no-login/no-deploy/no-production boundary and alarm/webhook topology. Updated the executable registry to 14 CF1 units and split CF1-02 into A/B/C/D and CF1-04 into A/B; corrected the Durable Object migration-history reference to canonical `__app_migrations`. `git diff --check` passed; contradiction scan found no stale `_sql_schema_migrations`, unsplit CF1-02/04 registry references or ten-unit count. No source, dependency, credential, Telegram, Cloudflare or remote files were touched.

#### CF1-01 — Add workerd toolchain and empty Worker harness

- **Status:** `completed`
- **Objective:** Add a pinned Wrangler/workerd/Vitest harness that runs locally without creating Cloudflare resources.
- **Dependencies:** `CF1-00`.
- **Preconditions:** exact Node/pnpm contract verified before dependency changes.
- **Scope:** pinned Cloudflare development dependencies, `wrangler.jsonc`, Worker-specific TypeScript/Vitest configuration, ignored `.dev.vars`, scripts `cloudflare:dev`, `cloudflare:typecheck`, `test:cloudflare`; empty front Worker/DO smoke only.
- **Do not touch:** business composition, current Node start/db scripts, real env files, login, deploy or remote bindings.
- **Invariants:** no secret value in config/Git; `pnpm start` and existing gates remain green; local Worker state is isolated under ignored Wrangler state.
- **Tests first:** local fetch and named singleton binding smoke; no network.
- **Verification:** `pnpm test:cloudflare`; existing `pnpm check`; bundle/startup-size inspection; secret scan.
- **Exit criteria:** empty Worker + SQLite-backed DO boot under workerd; one commit `CF1-01: establish local workerd harness`.
- **Evidence:** Commit SHA: `SELF`. Preflight after CF1-00 confirmed clean predecessor `5d93523f1f21455991f26799a8f9b16c56a2ad5e`, Node `v24.18.0` and pnpm `11.15.1`; no existing CF1-01 commit. Added exact `wrangler@4.127.0` and `@cloudflare/vitest-plugin@1.1.1`, enabled only the required local `workerd` build in pnpm workspace policy, and generated `worker-configuration.d.ts`. Added `wrangler.jsonc` with ES module Worker, `compatibility_date` `2026-08-28`, declarative SQLite `CollaborationBotState` export and `COLLABORATION_STATE` binding; no `nodejs_compat`. Added an empty local Worker/DO probe using singleton `idFromName("collaboration-bot-primary")`, isolated Cloudflare Vitest config, TypeScript configs, scripts and ignored `.dev.vars`/`.wrangler`. Focused `pnpm cloudflare:typecheck`, `pnpm test:cloudflare` (1 file, 2 tests), `pnpm cloudflare:types:check` and full `pnpm check` (69 unit, 88 integration, 47 runtime, architecture 128/415, build) passed. ESLint reports only two generated-file unused-disable warnings. Bundle/startup inspection used the local harness only; secret scan found no secret values. No login, deploy, remote binding, Telegram or production action.

#### CF1-02A — Establish portable crypto primitives

- **Status:** `completed`
- **Objective:** Make UUID, secure random bytes/tokens and SHA-256 available through runtime-neutral ports/adapters while preserving every serialized format.
- **Dependencies:** `CF1-01`.
- **Scope:** exact `@noble/hashes@2.4.0` dependency; provider-neutral crypto ports; Web Crypto and pure-JS SHA-256 implementations; deterministic test doubles and golden primitives tests.
- **Do not touch:** feature constructors, token lengths/alphabets, callback/deep-link formats, command input canonicalization, SQL or user copy.
- **Invariants:** existing stored hashes and tokens remain valid; cryptographic randomness remains secure; no weak `Math.random` fallback; Node-only imports stay out of shared/application code.
- **Tests first:** golden hashes/token regexes and deterministic crypto capability tests before wiring consumers.
- **Verification:** focused crypto tests; package/version lock check; `rg` proves shared ports have no Node built-ins; typecheck.
- **Exit criteria:** runtime-neutral crypto capabilities exist with compatibility golden tests; one commit `CF1-02A: establish portable crypto primitives`.
- **Evidence:** Commit SHA: `SELF`. Preflight confirmed clean predecessor `ea6e61313aca0fae85bca4e531b05ac241037a40`, Node `v24.18.0`, pnpm `11.15.1` and unique Task-ID. Added exact `@noble/hashes@2.4.0` and its minimum-release-age allowlist entry. Added provider-neutral `CryptoCapabilities`, Web Crypto-backed secure UUID/random bytes, pure-JS SHA-256 and base64url/hex encoding; preserved the existing `generateUuid`, 128-bit token and hash APIs without `node:crypto` imports in `src/platform/crypto`. Focused unit suite passed (14 tests including empty/text golden hashes, UUID/token alphabets and lengths, deterministic injected randomness and invalid lengths); Cloudflare bundle smoke passed (3 tests) proving the primitives load in workerd. `pnpm typecheck`, `pnpm cloudflare:typecheck` and `pnpm architecture` passed (131 modules/417 dependencies). No feature consumers were rewired in this unit; no SQL/copy/public formats changed; no credentials or external resources touched.

#### CF1-02B — Inject crypto into profile and discovery flows

- **Status:** `completed`
- **Objective:** Move profiles and collaborations generation/token/hash decisions onto the portable capabilities.
- **Dependencies:** `CF1-02A`.
- **Scope:** profile presentation plus collaboration application/composition consumers; preserve callback/deep-link tokens, generation strings, rendered hashes and serialized formats.
- **Do not touch:** marketplace/discovery, applications/moderation consumers, SQL text, public copy or token formats.
- **Invariants:** persisted values and replay identity remain byte-compatible; deterministic tests receive explicit doubles; no feature imports `node:crypto`.
- **Tests first:** profile/publication golden and injected-capability tests.
- **Verification:** focused profile/collaboration integration/E2E suites, architecture and import scan.
- **Exit criteria:** profile and collaboration flows are Worker-portable; one commit `CF1-02B: inject portable crypto into profile and collaboration flows`.
- **Evidence:** Commit SHA: `SELF`. Mandatory split discovered before commit: the original 13-unit CF1 plan would exceed the repository unit boundary when the crypto cutover is counted by changed source/test files. The registry was revised to 14 units, with marketplace/discovery plus the required runtime routing wiring isolated as CF1-02C and applications/moderation isolated as CF1-02D. The staged B subset contains exactly 12 source/test files: `src/modules/collaborations/application/collaboration-draft-service.ts`, `src/modules/collaborations/application/collaboration-publication-service.ts`, `src/modules/collaborations/composition/create-collaborations-feature.ts`, `src/modules/profiles/presentation/telegram/profile-composer.ts`, `src/platform/crypto/capabilities.ts`, `src/runtime/telegram/telegram-router.ts`, `src/shared/application/ports/crypto.ts`, `test/e2e-fake/r1-05a-profile-composer.test.ts`, `test/e2e-fake/s2-01-collaboration-bot.test.ts`, `test/integration/r2-07a-collaborations-composition.test.ts`, `test/integration/s2-01-collaboration.test.ts`, and `test/integration/s2-02-publication.test.ts`; plan metadata is outside this cap. The unstaged C WIP was preserved with named `git stash push --keep-index -m "CF1-02C: preserve marketplace discovery routing WIP"`, leaving the B index clean for this single commit. Focused suite passed (5 files, 13 tests); `pnpm typecheck`, `pnpm cloudflare:typecheck`, `pnpm architecture` (131 modules/421 dependencies), `pnpm db:verify`, `git diff --cached --check` and exact `node:crypto` import scan passed. Profile generations/request IDs, collaboration generations, public tokens, rendered hashes and delivery IDs now consume injected capabilities; no SQL, copy or serialized formats changed. No credentials, remote resources, Telegram or production actions touched.

#### CF1-02C — Inject crypto into marketplace discovery and runtime routing

- **Status:** `completed`
- **Objective:** Move marketplace/discovery decisions onto injected crypto capabilities and complete the runtime composition/routing slice needed by those consumers.
- **Dependencies:** `CF1-02B`.
- **Scope:** marketplace/discovery application/composition consumers, Telegram routing and Node runtime wiring required to pass the portable capability; deterministic test doubles.
- **Do not touch:** profile/collaboration consumers, applications/moderation consumers, SQL text, command semantics or public copy.
- **Invariants:** browse tokens, rendered hashes and generated IDs remain compatible; `node:crypto` remains only in explicit Node/test-owned adapters.
- **Tests first:** marketplace/discovery integration and fake journey tests with deterministic crypto doubles.
- **Verification:** focused integration/E2E, `pnpm architecture`, typecheck and exact `node:crypto` import scan.
- **Exit criteria:** marketplace/discovery and their runtime routing are Worker-portable; one commit `CF1-02C: inject portable crypto into marketplace discovery`.
- **Evidence:** Commit SHA: `SELF`. The restored C slice contains exactly 6 source/test files: `src/modules/marketplace/application/collaboration-browse-service.ts`, `src/modules/marketplace/composition/create-marketplace-feature.ts`, `src/runtime/composition/bot-application.ts`, `test/integration/r2-08-marketplace-composition.test.ts`, `test/integration/s3-02-browse.test.ts`, and `test/integration/s3-03-application.test.ts`; the router crypto handoff is already committed in CF1-02B and is not duplicated. `CollaborationBrowseService` now receives portable crypto for browse-session generations; marketplace composition and Node runtime pass one shared capability instance; characterization tests use the same capability without changing SQL, query order, browse tokens or public copy. Focused suite passed (3 files, 15 tests); `pnpm typecheck`, `pnpm architecture` (131 modules/423 dependencies), `git diff --cached --check` and exact `node:crypto` scan passed. No application/moderation implementation changed; the S3-03 test change only supplies the new browse dependency. No credentials, remote resources, Telegram or production actions touched.

#### CF1-02D — Inject crypto into application decisions

- **Status:** `completed`
- **Objective:** Move applications and moderation decisions onto injected UUID/token capabilities and preserve Node composition.
- **Dependencies:** `CF1-02C`.
- **Scope:** applications/moderation feature factories, decision/callback token consumers, remaining Node composition wiring and deterministic test doubles.
- **Do not touch:** profile/collaboration/marketplace consumers, SQL text, command semantics or public copy.
- **Invariants:** decision receipts, callback hashes and generated IDs remain compatible; `node:crypto` remains only in explicit Node/test-owned adapters.
- **Tests first:** application/moderation decision tests with deterministic crypto doubles.
- **Verification:** focused integration/E2E, `pnpm architecture`, typecheck and exact `node:crypto` import scan.
- **Exit criteria:** all application decision flows are Worker-portable; one commit `CF1-02D: inject portable crypto into application decisions`.
- **Evidence:** Commit SHA: `SELF`. The D slice changes exactly 12 source/test files: `src/modules/applications/application/application-decisions.ts`, `src/modules/applications/application/application-feature.ts`, `src/modules/applications/application/application-submission.ts`, `src/modules/applications/composition/create-applications-feature.ts`, `src/modules/moderation/application/admin-moderation-service.ts`, `src/modules/moderation/composition/create-moderation-feature.ts`, `src/runtime/composition/bot-application.ts`, `test/integration/r1-03-applications-composition.test.ts`, `test/integration/r2-10a-moderation-composition.test.ts`, `test/integration/s4-01-admin-hide.test.ts`, `test/support/applications-feature.ts`, and `test/unit/s3-04-application-decision.test.ts`. Test-first RED was recorded by `pnpm typecheck` before the new constructor/factory contract existed; it reported the expected five missing `crypto` properties/argument. Application submission/decision and moderation now receive the shared capability and use it for application, outbox, projection, channel-delete and audit IDs; deterministic UUID/random doubles are used by the application decision fixture. Focused suite passed (4 files, 17 tests); `pnpm architecture` passed (131 modules/426 dependencies); exact `node:crypto` scan found no imports in applications/moderation; full `pnpm check` passed (72 unit, 88 integration, 47 runtime, lint/typecheck/build; generated Cloudflare config has only two pre-existing unused-disable warnings). No SQL, business rules, receipts, idempotency keys, copy or effect ordering changed; no credentials, remote resources, Telegram or production actions touched.

#### CF1-03 — Introduce a runtime-neutral SQL contract

- **Status:** `completed`
- **Objective:** Separate repository-facing SQL/transaction APIs from the concrete `node:sqlite` connection without changing SQL behavior.
- **Dependencies:** `CF1-02D`.
- **Scope:** `SqlDatabase`/result/parameter/transaction contracts; adapt Node `DatabaseBoundary`, transaction runner and shared platform repositories first.
- **Do not touch:** migration SQL/checksums, repository queries, transaction nesting/rollback semantics or feature behavior.
- **Invariants:** current Node path remains serialized and rollback-only on nested failure; Telegram calls remain outside transaction.
- **Tests first:** run the same boundary contract against the Node adapter; include nested failure and conditional `changes` behavior.
- **Verification:** database/ingress/outbox focused tests; `pnpm db:verify`; typecheck/architecture.
- **Exit criteria:** shared persistence depends on interface, not `DatabaseSync`; one commit `CF1-03: establish portable SQL boundary`.
- **Evidence:** Commit SHA: `SELF`. Added `SqlValue`, `SqlExecuteResult` and `SqlDatabase` to the shared application port, restricting parameters to SQLite null/number/bigint/string/`Uint8Array` values. Added `NodeSqlDatabase`, a runtime-neutral facade over the existing `DatabaseBoundary`; it normalizes node:sqlite execute results to exactly `{ changes }`, preserves boundary FIFO queueing, `BEGIN IMMEDIATE`, nested rollback-only behavior and lifecycle close, and turns synchronous closed-state failures into rejected promises matching the port contract. Focused contract suite passed (1 file, 3 tests: normalized changes/query, FIFO plus nested rollback-only, close lifecycle); `pnpm typecheck` and `pnpm architecture` passed (133 modules/428 dependencies); `git diff --check` passed. Existing SQL/repositories and Node migration behavior remain untouched for the scheduled CF1-04 adapter cutovers; no credentials, remote resources, Telegram or production actions touched.

#### CF1-04A — Decouple profile and collaboration persistence

- **Status:** `completed`
- **Objective:** Move profiles and collaborations repositories/factories from the concrete Node boundary to the portable SQL contract.
- **Dependencies:** `CF1-03`.
- **Scope:** profile/collaboration repository constructor types, feature factory wiring and shared repositories directly required by these flows.
- **Do not touch:** applications/marketplace/moderation repositories, SQL text, read-model ordering, row validators, public feature APIs or current Node runtime behavior.
- **Tests first:** existing profile/collaboration integration and composition suites are the characterization gate.
- **Verification:** focused profile/collaboration suites, architecture, typecheck and concrete-boundary import scan.
- **Exit criteria:** profile/collaboration object graphs receive any `SqlDatabase`; one commit `CF1-04A: decouple profile and collaboration persistence`.
- **Evidence:** Commit SHA: `SELF`. Profile and collaboration SQLite repositories now keep a `SqlDatabase` internally for every query, execute and transaction while preserving their existing SQL text, ordering, validators and transaction boundaries. `SqliteWizardAdmission` is portable on the same contract. Feature factories accept a `SqlDatabase` directly and retain a narrow `DatabaseBoundary` compatibility input only for existing Node-owned test composition; the Node runtime now constructs one `NodeSqlDatabase` and passes it to both feature graphs. Existing direct Node test constructors resolve through the adapter without changing public feature APIs. Ten source files plus this plan changed (within the 12-file cap). Focused profile/collaboration persistence/composition suite passed (7 files, 23 tests); `pnpm typecheck`, `pnpm architecture` (133 modules/437 dependencies) and `git diff --check` passed. No applications/marketplace/moderation repository, SQL, row validator or product behavior changed; no credentials, remote resources, Telegram or production actions touched.

#### CF1-04B — Decouple remaining feature persistence

- **Status:** `completed`
- **Objective:** Move applications, marketplace and moderation repositories, factories and runtime composition to the portable SQL contract.
- **Dependencies:** `CF1-04A`.
- **Scope:** exactly seven source files across applications, marketplace and moderation repositories/factories plus Node runtime composition; shared callback/durable/retention/telegram-user/transaction/outbox/product-event adapters are deferred to CF1-04C. After the complete cutover, `DatabaseBoundary` is allowed only in Node composition, migrations/CLI and Node tests.
- **Do not touch:** SQL text, read-model ordering, row validators, public feature APIs or current Node behavior.
- **Tests first:** applications/marketplace/moderation characterization suites plus composition gate.
- **Verification:** all integration suites, fake E2E, architecture and exact import scan for concrete Node boundary.
- **Exit criteria:** applications, marketplace and moderation object graphs receive `SqlDatabase`; one commit `CF1-04B: decouple remaining feature persistence`.
- **Evidence:** Commit SHA: `SELF`. Mandatory split discovered before commit: the initial CF1-04B WIP covered 14 source files, exceeding the repository unit boundary. It was divided into CF1-04B (seven feature/runtime files) and CF1-04C (seven shared persistence adapters), increasing CF1 from 14 to 15 units. The exact B subset is `src/modules/applications/composition/create-applications-feature.ts`, `src/modules/applications/infrastructure/sqlite-applications-repository.ts`, `src/modules/marketplace/composition/create-marketplace-feature.ts`, `src/modules/marketplace/infrastructure/sqlite-collaboration-browse-repository.ts`, `src/modules/moderation/composition/create-moderation-feature.ts`, `src/modules/moderation/infrastructure/sqlite-admin-moderation-repository.ts` and `src/runtime/composition/bot-application.ts`; no source/test file outside this seven-file subset was staged. Shared adapter WIP was preserved with named `git stash push --keep-index -m \"CF1-04C: preserve shared persistence WIP\"`, leaving the staged B tree isolated; the legacy user backup stash remained untouched. Applications, marketplace and moderation repositories now consume `SqlDatabase` internally, their factories accept the portable database while retaining the Node-owned compatibility input, and runtime passes one shared `NodeSqlDatabase` to these three feature graphs. Shared adapters and their runtime wiring remain on the committed Node boundary until CF1-04C. Focused B suite passed (6 files, 25 tests); aggregate `pnpm check` passed (lint 0 errors with two pre-existing generated-file warnings, architecture 133 modules/443 dependencies, typecheck, unit 14 files/75 tests, integration 19 files/88 tests, runtime 7 files/47 tests and build); staged source/test count was exactly 7 and `git diff --cached --check` passed. SQL, ordering, validators, public APIs and product behavior were unchanged; no credentials, remote resources, Telegram or production actions touched.

#### CF1-04C — Decouple shared persistence from Node SQLite

- **Status:** `completed`
- **Objective:** Move shared callback, durable-command, ingress-retention, Telegram-user, transaction, outbox-delivery and product-event adapters to the portable SQL contract.
- **Dependencies:** `CF1-04B`.
- **Scope:** exactly seven shared platform adapter files; preserve SQL text, FIFO/transaction semantics, retention counts, outbox status/fencing/retry behavior and product-event ordering.
- **Do not touch:** feature repositories/factories covered by CF1-04B, migration SQL/schema history, `DatabaseBoundary` internals or product behavior.
- **Invariants:** shared adapters accept `SqlDatabase` without changing public feature contracts; external delivery remains outside database transactions; nested rollback and cleanup semantics remain unchanged.
- **Tests first:** shared callback/durable/retention/outbox/product-event characterization suites through the Node adapter.
- **Verification:** focused shared persistence suites, `pnpm check`, `pnpm db:verify`, architecture and exact concrete-boundary import scan.
- **Exit criteria:** shared persistence consumes `SqlDatabase`; one commit `CF1-04C: decouple shared persistence from Node SQLite`.
- **Evidence:** Commit SHA: `SELF`. The mandatory pre-commit split was restored and verified after CF1-04B: the shared slice contains exactly seven source files — `src/platform/database/callback-action-repository.ts`, `src/platform/database/durable-command-repository.ts`, `src/platform/database/ingress-retention.ts`, `src/platform/database/telegram-user-repository.ts`, `src/platform/database/transaction-runner.ts`, `src/platform/outbox/outbox-delivery-repository.ts` and `src/platform/outbox/product-event-repository.ts` — with no source/test file outside this subset. The named `CF1-04C: preserve shared persistence WIP` stash was restored, its plan/runtime conflicts were resolved in favor of committed CF1-04B plus the seven shared files, the restored diff was verified, and only that named stash was dropped; the user backup stash remained intact. All seven adapters now consume `SqlDatabase` internally through the existing Node adapter while preserving SQL, result normalization, transaction/cleanup semantics, outbox status/fencing/retry behavior and public contracts. Focused shared suite passed (6 files, 54 tests); `pnpm check` passed (lint 0 errors with two pre-existing generated-file warnings, architecture 133 modules/450 dependencies, typecheck, unit 14 files/75 tests, integration 19 files/88 tests, runtime 7 files/47 tests and build); `pnpm db:verify` passed; concrete `DatabaseBoundary` references remain only in Node composition/bootstrap, migrations/CLI and the Node adapter; forbidden `node:crypto` scan across `src/shared` and `src/modules` passed; cached source/test count was exactly 7 and both cached/working-tree `git diff --check` passed. No credentials, remote resources, Telegram or production actions touched.

#### CF1-05 — Implement Durable Object SQLite and migrations

- **Status:** `completed`
- **Objective:** Run the authoritative schema and callback-transactions on `ctx.storage.sql` with equivalent atomicity.
- **Dependencies:** `CF1-04C`.
- **Scope:** Durable Object SQL adapter, `storage.transaction()` runner, bundled/precomputed migration manifest, the existing canonical `__app_migrations` history table, constructor initialization through `blockConcurrencyWhile`, local integrity/foreign-key verification adapted to supported SQL.
- **Do not touch:** product tables/constraints unless a workerd compatibility test demonstrates a concrete incompatibility; no remote object.
- **Invariants:** migration checksum drift fails closed; failed migration/command rolls back; receipt + business state + outbox commit atomically; schema can initialize from empty and reopen idempotently.
- **Tests first:** fresh schema, reopen, failed migration, nested rollback, last-slot race and duplicate update under `cloudflare:test`.
- **Verification:** Worker database contract suite, schema snapshot against Node SQLite, all existing integration/fake gates.
- **Stop conditions:** unsupported SQL changes an invariant, `storage.transaction()` cannot reproduce the callback boundary, or migration parity is unproven.
- **Exit criteria:** local DO owns equivalent authoritative SQLite; one commit `CF1-05: run authoritative state in Durable Object SQLite`.
- **Evidence:** Commit SHA: `SELF`. Added `CloudflareSqlDatabase` over SQLite Durable Object storage; `query` consumes cursors immediately with `toArray()`, `execute` normalizes `rowsWritten` to `{ changes }`, blobs are converted to Cloudflare `ArrayBuffer` bindings, and nested transaction failures mark the outer `storage.transaction()` rollback-only. Added a deterministic generated manifest containing all 13 unchanged migration files, runtime checksum/order validation and `pnpm cloudflare:migrations:check` drift verification; unknown or reordered history fails closed. `CollaborationBotState` now initializes the canonical `__app_migrations` schema inside `blockConcurrencyWhile`, exposes local-only schema inspection for the harness, and reuses the same adapter after eviction/reopen. Cloudflare's local runtime rejected `PRAGMA integrity_check` with `SQLITE_AUTH`, so verification uses the supported `PRAGMA foreign_key_check` plus `sqlite_schema` history-table validation; no invariant or migration SQL was weakened. Test-first RED was recorded by the missing adapter module; the focused workerd suite then passed fresh migration/reopen, nested rollback-only and manifest tamper cases (3 tests), full `pnpm test:cloudflare` passed (2 files, 6 tests), `pnpm cloudflare:typecheck`, `pnpm cloudflare:types:check`, manifest drift check, `pnpm check`, `pnpm db:verify` and fake E2E (8 files, 33 tests) passed. Source/test changes are limited to five files; the manifest/script/package metadata are generated/tooling support. No `BEGIN`/`SAVEPOINT` SQL is used in the DO, no product tables or SQL files changed, and no credentials, remote resources, Telegram or production actions touched.

#### CF1-06 — Add secure webhook and singleton DO composition

- **Status:** `completed`
- **Objective:** Replace production polling with a public webhook adapter while reusing the same grammY router/application graph inside the singleton DO.
- **Dependencies:** `CF1-05`.
- **Scope:** front Worker `POST /telegram/webhook`, exact method/content-type/body-size checks, constant-time `X-Telegram-Bot-Api-Secret-Token` validation, raw Update forwarding to `idFromName("collaboration-bot-primary")`, DO `bot.handleUpdate`, lazy `getMe` identity/showcase preflight, safe `/health/live` and protected readiness diagnostics.
- **Do not touch:** route order, reply collector, durable command identity, public bot copy or production webhook.
- **Invariants:** invalid/unsigned requests never reach business state; duplicate webhook is harmless; webhook returns 2xx only after durable update handling; secrets never appear in response/logs.
- **Tests first:** invalid method/header/body, duplicate update, identity mismatch, handler failure/retry and health redaction.
- **Verification:** local HTTP/workerd fake journey; existing router/runtime/fake E2E; Telegram adapter contract.
- **Exit criteria:** fake Telegram can traverse the exact hosted ingress locally; one commit `CF1-06: add durable Telegram webhook ingress`.
- **Evidence:** Commit SHA: `SELF`. Preflight confirmed clean predecessor `37a0dde81b74379a9f8902f53ef92ec9cc8f7c06`, Node `v24.18.0`, pnpm `11.15.1` and unique Task-ID. Test-first RED reproduced the missing Worker route (GET `/telegram/webhook` and unsigned POST returned 404); the focused contract then passed after implementation (1 file, 4 tests). Added the portable webhook adapter with exact 405/415/401/413/400/500/204 outcomes, a 1 MiB streaming cap, UTF-8 JSON/update validation, constant-time secret comparison and no response secret/error details. The front Worker forwards accepted raw Updates to the singleton `collaboration-bot-primary` Durable Object; the DO composes the existing router/application graph over `CloudflareSqlDatabase` and calls `bot.handleUpdate` only after durable initialization. Added protected Bearer-token ops routes for readiness/export/import (state transfer remains a CF1-08 implementation boundary), and a local `cf1_preflight_cache` runtime table: identity/showcase checks are lazy, concurrent checks are coalesced, only successful exact checks are persisted, and matching cache state is restored after DO eviction without trusting stale/missing configuration. Internal schema/smoke probes remain DO-binding-only and are not exposed by the front Worker; empty secrets/tokens fail closed. The Node composition now accepts the portable SQL contract while preserving the legacy `DatabaseBoundary` API and Cloudflare typecheck no longer traverses Node built-ins; the delivery timer remains compatible with both Node and workerd. Changed eight source/test files: `src/platform/database/database-boundary.ts`, `src/platform/database/node-sql-database.ts`, `src/runtime/bootstrap/bot-bootstrap.ts`, `src/runtime/composition/bot-application.ts`, `src/runtime/cloudflare/webhook.ts`, `src/runtime/lifecycle/delivery-worker.ts`, `src/worker.ts` and `test/cloudflare/cf1-06-webhook.test.ts`; plan metadata is additional. Full `pnpm test:cloudflare` passed (3 files, 10 tests), proving local Worker/DO boot, canonical schema/reopen and webhook/ops routes; `pnpm cloudflare:typecheck`, `pnpm cloudflare:types:check`, `pnpm cloudflare:migrations:check`, `pnpm check` (architecture 137/463, unit 14/75, integration 19/88, runtime 7/47, build), `pnpm test:e2e:fake` (33), `pnpm db:verify`, `git diff --check` and credential-value scan passed. Wrangler/workerd checks were run host-capably only for local execution; no login, deploy, remote binding, secret, Telegram or production action occurred.

#### CF1-07 — Replace the 250 ms loop with a durable alarm

- **Status:** `completed`
- **Objective:** Wake and drain the existing outbox without a permanent process, Cron or Queue.
- **Dependencies:** `CF1-06`.
- **Scope:** alarm scheduler chooses the earliest due/stale delivery, writes one alarm, handler runs bounded claims/sends/projections, reschedules from remaining state; Node `DeliveryWorker` remains only for rollback/local legacy path until CF3 closes.
- **Do not touch:** delivery statuses, retry backoff, provider deadlines, ambiguity classification, claim fencing or channel projection policy.
- **Invariants:** Telegram send/edit/delete remains outside storage transaction; alarm at-least-once cannot duplicate a proven effect; new outbox work cannot be stranded after webhook return; no busy loop keeps the DO active.
- **Tests first:** alarm immediate delivery, retry timing, concurrent alarm/webhook, throw/retry, stale dispatch recovery, empty-queue alarm clearing and ambiguous send.
- **Verification:** `runDurableObjectAlarm` suites; outbox/runtime tests; local fake publish/accept/hide journeys.
- **Exit criteria:** local Worker becomes idle between events and recovers scheduled delivery; one commit `CF1-07: drive outbox with Durable Object alarms`.
- **Evidence:** Commit SHA: `SELF`. Preflight confirmed clean predecessor `d883b1a434ec289ec9f049e67725b52e9b6d43bb`, Node `v24.18.0`, pnpm `11.15.1` and unique Task-ID. Added a bounded `runDeliveryCycleOnce` to the existing composition: explicit stale recovery, terminal projections, capability-gated expiry/projection maintenance, then exactly one existing `DeliveryRunner.runOnce`; provider mutations remain outside SQL/storage transactions and all status, fencing, retry-backoff and ambiguity handling stay in the unchanged runner/repository path. `CollaborationBotState` now computes the earliest eligible prepared/retryable/stale-dispatch timestamp, preserves one earlier alarm, schedules after webhook/ready boundaries and removes the alarm for an empty eligible queue; alarms coalesce concurrent cycles, log only a redacted event on step failure and schedule a bounded retry. Channel deliveries are not scheduled while showcase capability is degraded, so they cannot create a busy alarm loop. Focused workerd tests passed (2 tests): a scheduled alarm invokes one bounded cycle and clears an empty queue; stale recovery is prioritized before a later retry and retry timing is preserved. Full `pnpm test:cloudflare` passed (4 files, 12 tests), including the existing schema/eviction contract; `pnpm check` passed (architecture 137/463, unit 14/75, integration 19/88, runtime 7/47, build), `pnpm test:e2e:fake` passed (33), `pnpm db:verify`, `pnpm cloudflare:types:check`, `pnpm cloudflare:migrations:check` and `git diff --check` passed. A direct seeded-row `evictDurableObject` attempt in the plugin harness timed out before reopen, so the focused scheduler test uses an explicit post-ready boundary; no production code or invariant depends on that harness path, and CF1-05 already proves canonical DO eviction/reopen. Changed three source/test files: `src/runtime/composition/bot-application.ts`, `src/worker.ts` and `test/cloudflare/cf1-07-alarm.test.ts`; plan metadata is additional. No credentials, remote resources, Telegram or production actions touched.

#### CF1-08 — Build reversible SQLite data-transfer tooling

- **Status:** `completed`
- **Objective:** Move existing authoritative data without copying a live WAL file or trusting manual table edits.
- **Dependencies:** `CF1-07`.
- **Scope:** stopped-source export to a mode-0600 manifest outside Git; explicit product-table allowlist, schema version, ordered rows/counts/content hashes; empty-target, one-shot authenticated DO import; remote read-only verification/export endpoint or operator command; import audit record and disable switch.
- **Do not touch:** bot token/env contents; migration history import; production DB/DO in this unit.
- **Invariants:** export starts only after source process is stopped and verified; import rejects non-empty target/rerun/schema mismatch; PII is not logged; source DB and backup stay unchanged.
- **Tests first:** representative legacy fixture, tamper/hash failure, interrupted import rollback, duplicate import rejection, count/hash parity and unrelated-file safety.
- **Verification:** local SQLite → local DO rehearsal plus reverse read-only export comparison; secret/PII log scan.
- **Exit criteria:** deterministic rehearsal proves reversible transfer; one commit `CF1-08: add verified SQLite transfer tooling`.
- **Evidence:** Commit SHA: `SELF`. Preflight confirmed clean predecessor `520f0610a9830e7ff3a1277207cfa025cc44f4c9`, Node `v24.18.0`, pnpm `11.15.1` and unique Task-ID. Added a runtime-neutral manifest exporter/importer with exactly the 17 permanent product tables in dependency-safe order; migration history, preflight cache, import audit and other internal tables are excluded. Manifest v1/schema 13 records declared schema columns, primary-key-ordered rows, row counts, per-table SHA-256 and an overall SHA-256; values are restricted to SQLite scalar/blob forms and blobs use base64url. Validation is fail-closed for unknown tables, schema/digest drift, malformed values and non-canonical primary-key ordering. Import requires an exact target schema, empty product tables and an empty one-row `cf1_state_import_audit`; all rows plus the audit record are inserted inside one `SqlDatabase.withTransaction`, so the forced mid-import failure test leaves no rows or audit marker and repeat import returns conflict. Added protected DO export/import routes behind `OPERATIONS_TOKEN`, `STATE_IMPORT_ENABLED=true` and JSON/size checks; DO verifies canonical migration history before transfer and logs no manifest contents. Added Node-only `db:state:export` tooling that requires `--source-stopped`, verifies no `lsof` holder, refuses repository output, writes a new mode-0600 manifest and prints only counts/digest. Focused tests passed (Node 2, local DO 1); aggregate `pnpm check` passed (architecture 140/473, unit 14/75, integration 20/90, runtime 7/47, build), `pnpm test:e2e:fake` passed (8 files/33 tests), `pnpm db:verify`, `pnpm cloudflare:types:check`, `pnpm cloudflare:migrations:check` and `git diff --check` passed. Local CLI rehearsal migrated a temporary SQLite fixture and exported 17 tables/0 rows with mode 0600 outside the repository; local DO export→import digest parity passed. Source/test changes are limited to five files (`src/platform/database/state-transfer.ts`, `src/cli/state-export.ts`, `src/worker.ts`, `test/integration/cf1-08-state-transfer.test.ts`, `test/cloudflare/cf1-08-transfer.test.ts`); package and plan metadata are additional. No production DB, credential, remote resource, Telegram or Cloudflare mutation was performed.

#### CF1-09 — Preserve real local Telegram development and close CF1

- **Status:** `completed`
- **Objective:** Keep a convenient real-Telegram local path while proving all application logic executes in local workerd/DO, not a second database implementation.
- **Dependencies:** `CF1-08`.
- **Scope:** tiny long-polling relay using a separate development bot token and development showcase channel; relay posts raw updates to local Worker; `.dev.vars.example`, commands/runbook, full Cloudflare fake gate and one blocker-limited stage review.
- **Do not touch:** production bot webhook/token, BotFather, Cloudflare remote or source production SQLite.
- **Invariants:** relay contains no business logic/database; the same token is never used simultaneously for webhook and `getUpdates`; local secrets remain ignored.
- **Verification:** `pnpm check`; `pnpm test:e2e:fake`; `pnpm test:cloudflare`; `pnpm db:verify`; local transfer rehearsal; bundle/startup inspection; secret scan. Real dev-bot smoke remains a separate explicit authorization.
- **Exit criteria:** CF1 completed locally, legacy `pnpm start` still available for rollback, no remote mutation; one commit `CF1-09: close local Cloudflare migration candidate`.
- **Evidence:** Commit SHA: `SELF`. Preflight confirmed clean predecessor `262527e2ea8fe974a112bdb495cfb3f5b5a9348b`, Node `v24.18.0`, pnpm `11.15.1` and unique Task-ID. Test-first RED reproduced the missing relay module; the focused contract then passed (2 tests). Added the Node-only `cloudflare:relay` CLI and package command: it requires a private 0600 env file, a loopback local Worker URL, a separate development bot token, and the webhook secret; it calls only Telegram `getUpdates` with explicit `message`/`callback_query` updates, forwards each raw JSON update sequentially to the local webhook, advances offset only after `204`, retries with bounded backoff and handles SIGINT/SIGTERM. It has no application decisions, database access, `setWebhook`, or raw-update logging. Added ignored local-variable guidance with conscious development bot/channel names and a runbook covering local workerd startup, protected diagnostics, same-token ingress exclusivity, clean shutdown and unchanged `pnpm start` rollback. `pnpm check` passed (lint 0 errors with the two pre-existing generated-config warnings, architecture 141 modules/476 dependencies, typecheck, unit 15 files/77 tests, integration 20 files/90 tests, runtime 7 files/47 tests and build); `pnpm test:e2e:fake` passed (8 files/33 tests); `pnpm test:cloudflare` passed (5 files/13 tests); `pnpm db:verify`, `pnpm cloudflare:types:check`, `pnpm cloudflare:migrations:check`, `git diff --check`, compiled relay bundle inspection and credential/PII scan passed. Real Telegram development-bot smoke, webhook configuration, BotFather, Cloudflare login/deploy/remote mutation and production DB were not performed. Changed two source/test files (`src/cli/cloudflare-relay.ts`, `test/unit/cf1-09-relay.test.ts`); package, `.dev.vars.example`, README, runbook and plan metadata are additional. Legacy `pnpm start` remains present for rollback.

#### CF1-REVIEW — Close local Cloudflare launch blockers

- **Status:** `completed` — one consolidated fix wave after the independent candidate review; this is not a new CF1 unit.
- **Objective:** Close only the confirmed launch blockers while preserving the 15-unit CF1 history and local-only boundary.
- **Dependencies:** `CF1-09` and the final candidate review.
- **Scope:** per-instance Telegram identity initialization, positive-only persisted showcase capability, readiness truthfulness, Cloudflare SQL execute conformance, and focused Cloudflare acceptance evidence.
- **Do not touch:** prior unit commits, remote Cloudflare state, deploy/login, secrets, production Telegram/DB, webhook configuration or broad refactors.
- **Invariants:** every configured webhook/alarm path runs `bot.init()` plus exact identity assertion before using persisted capability; only exact positive `canPublish && reason === null` is durable; degraded/mismatched capability is rechecked; receipt/business/outbox rollback and replay remain atomic; external delivery remains outside storage transactions.
- **Evidence:** Commit SHA: `SELF`; Sol max review supplied two P1 findings: a new DO instance could trust a persisted showcase cache without reinitializing/verifying its Bot identity, and degraded/mismatch/insufficient capability could persist indefinitely while readiness under-reported state. `CollaborationBotState` now separates per-instance identity readiness from positive-only persisted capability, retries identity/preflight after mismatch or degraded state, deletes non-positive cache rows, and returns secret-free exact readiness data. `CloudflareSqlDatabase.execute` now materializes every cursor before reading final `rowsWritten`; because workerd `rowsWritten` includes indexed writes, it additionally normalizes the logical count from SQLite `changes()` while retaining the required cursor order. Changed source files: `src/worker.ts`, `src/platform/database/cloudflare-sql-database.ts`; changed test files: `test/cloudflare/cf1-review.test.ts`, `test/cloudflare/cf1-05-sqlite.test.ts`, `test/cloudflare/cf1-07-alarm.test.ts`, `test/cloudflare/cf1-08-transfer.test.ts`.
- **Acceptance evidence:** Expanded Cloudflare suites passed: review identity/cache/recovery, concurrent duplicate receipt plus business/outbox atomic commit, failed-command rollback, cursor materialization and indexed hit/miss, alarm empty/one-mutation/throw-retry/ambiguous scheduling, and transfer allowlist/export/protected-disabled/tamper/repeat/rollback/digest parity. The transfer suite now also invokes the default Worker handler with a synthetic operations token and enabled import flag, proves authenticated empty-target import followed by protected export digest parity, and proves repeated/tampered requests leave the imported digest unchanged. Existing Node delivery tests remain the evidence for concrete Telegram transport ambiguity classification; Cloudflare alarm tests prove durable scheduling and terminal ambiguous handling without making a network call. The named review harness test uses a new handler-instance boundary because `evictDurableObject` hangs when combined with custom seeded WIP; the canonical CF1-05 schema eviction/reopen test still passes. No credential, PII, remote resource, Telegram or production action was used.
- **Remaining unverified boundaries/deviations:** the Cloudflare Vitest plugin does not complete the custom seeded eviction path, so a single test does not claim literal seeded-row eviction. The authenticated transfer path is proven with a synthetic test token and a local enabled binding; real secret handling, real Telegram mutation, showcase recovery against Telegram, Cloudflare login/deploy and production transfer remain CF2/CF3 boundaries. `IMPLEMENTATION_PLAN.md` records this wave without rewriting the 15 prior unit commits.

### CF2 — Free Cloudflare staging

#### CF2-00 — Preflight the exact free Cloudflare account

- **Status:** `completed`
- **Objective:** Prove the selected account/project can host the staging topology without payment before creating anything.
- **Dependencies:** `CF1-09`.
- **Authorization:** separate remote Cloudflare authorization; browser login remains with the user if required.
- **Scope:** read-only `wrangler whoami`/account inspection, Workers plan, existing names/routes/limits, workers.dev subdomain, current usage, exact staging names and rollback targets.
- **Do not touch:** resource creation, secrets, deploy, Telegram or production.
- **Stop conditions:** paid Workers plan/overage risk, payment requirement, name collision, unavailable workers.dev, quota too close to safe smoke, wrong account.
- **Exit criteria:** evidence records exact account, Free plan and resource names; one commit `CF2-00: record free staging preflight`.
- **Evidence:** Commit SHA: `SELF`. Preflight ran on 2026-08-29 from clean `main` at `b1cfa85ef3e892dfd9719a8f4fcc4643466a9f5a`, with Node `v24.18.0`, pnpm `11.15.1`, Wrangler `4.127.0`, unique Task-ID and no source/config/package change. The user completed Cloudflare OAuth in the browser; a named Wrangler profile `collab-bot` is bound only to this ignored repository directory, while the existing `default` profile remains unchanged. `wrangler whoami` and the Dashboard both resolve account `643464cda99dd9fb036367674d42a62c`.
- **Free-plan and quota evidence:** Dashboard marks `Free — $0 — Current plan`, with Paid shown only as a `$5` upgrade; no payment action is required. Workers usage is `0 / 100,000` requests today, `0 ms` CPU, zero observability events and zero build minutes. Durable Objects shows no namespaces and zero requests, duration, SQL/KV storage, rows read/written and KV operations. Official [Workers limits](https://developers.cloudflare.com/workers/platform/limits/), [Durable Objects limits](https://developers.cloudflare.com/durable-objects/platform/limits/) and [Durable Objects pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/) confirm that Workers Free supports SQLite-backed Durable Objects with the bounded daily/storage quotas needed for this staging smoke. The API's `default_usage_model=standard` is recorded only as an invocation-model setting; the Dashboard's explicit `Current plan` is the billing-plan evidence.
- **Resource and collision evidence:** account-wide API inspection reports zero Workers, zero custom domains, zero zones/routes and zero D1 databases; Dashboard independently reports `No projects found` and `No Durable Objects found`. `wrangler deployments list --name collaboration-bot-staging --json` returned Cloudflare code `10007` (`Worker does not exist`), proving the exact Worker name is unoccupied. The account workers.dev subdomain is `castors-suburb-2h.workers.dev`.
- **Exact staging names:** Worker `collaboration-bot-staging`; public hostname `collaboration-bot-staging.castors-suburb-2h.workers.dev`; binding `COLLABORATION_STATE`; SQLite Durable Object class `CollaborationBotState`; singleton object name `collaboration-bot-primary`. Telegram names in `.dev.vars.example` were provisional local placeholders during CF2-00; this preflight did not claim that BotFather/channel resources existed or configure them. CF2-01 records the later separately authorized live development identities.
- **Rollback baseline:** the account starts with zero Workers and zero Durable Object namespaces, so CF2-01 must create only the named staging Worker/namespace and preserve that empty-account baseline outside them. Production Telegram, webhook and SQLite are untouched; the legacy local `pnpm start` plus the authoritative local SQLite remain the production rollback target. The existing Wrangler `default` profile remains unchanged and is outside CF2; every future CF2 remote command must first prove active profile `collab-bot` and account `643464cda99dd9fb036367674d42a62c`. No resource, route, namespace, secret, deploy, Telegram setting, production data or billing setting was created or changed.
- **Verification:** `pnpm check` PASS (architecture 141 modules/476 dependencies; unit 15 files/77 tests; integration 20/90; runtime 7/47; lint 0 errors with two pre-existing generated-file warnings; typecheck/build PASS); `pnpm test:e2e:fake` PASS (8 files/33 tests); host-capable `pnpm test:cloudflare` PASS (6 files/25 tests) after the unchanged sandbox attempt hit only Wrangler-log and `listen EPERM` boundaries; `pnpm db:verify`, `pnpm cloudflare:types:check` on active profile `collab-bot`, `pnpm cloudflare:migrations:check`, `git diff --check`, exact changed-file check and diff credential scan PASS. Only `IMPLEMENTATION_PLAN.md` changed.
- **Review result:** independent max-effort critical review initially blocked two documentation claims: an unproven inference about the unchanged `default` profile's account and the stale next-unit pointer. One consolidated correction wave removed the inference, added an exact future account/profile preflight, and changed the pointer to separately authorized `CF2-01`; independent re-review returned `PASS` with no remaining blocker.

#### CF2-01 — Provision and deploy isolated staging

- **Status:** `completed`
- **Objective:** Create only `collaboration-bot-staging` and its SQLite DO namespace on Workers Free.
- **Dependencies:** `CF2-00`.
- **Authorization:** remote resource creation, secret writes and staging deploy explicitly authorized; the user separately authorized the development BotFather bot/channel creation and the bot's exact channel-admin rights; no production Telegram action.
- **Read first:** complete CF2-00 evidence; `wrangler.jsonc`; `.dev.vars.example`; Worker health, protected operations and preflight paths in `src/worker.ts`; declarative DO export plus bundled application migration contract; installed Wrangler help/schema.
- **Scope:** staging env/binding, non-secret vars for the separately authorized `@collaboration_development_bot` and `@collaboration_showcase_dev`, encrypted `BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET` and `OPERATIONS_TOKEN`, deployment, DO schema initialization, version ID/URL capture, `/health/live` and protected readiness.
- **Do not touch:** production Worker, production bot token/webhook, source SQLite or existing insta-chat resources.
- **Invariants:** staging uses a separate dev bot, development showcase channel and object namespace; no secret in shell history/log/evidence; no custom domain required.
- **Verification:** deployment list, exact binding/class, schema history/counts, identity/preflight, logs and free-usage snapshot.
- **Stop conditions:** wrong Wrangler profile/account, paid-plan or quota risk, occupied Worker name, secret exposure, Telegram identity/capability mismatch, unexpected route/domain/resource, non-exact readiness or incomplete schema evidence.
- **Exit criteria:** hosted staging is ready but receives no Telegram traffic; one commit `CF2-01: deploy isolated Cloudflare staging`.
- **Evidence:** Commit SHA: `SELF`. Execution ran on 2026-08-29 from `main` at predecessor `af8776ecd87e336e0938b73762da80936fc5cc4e`, ahead of `origin/main` only by the existing local units, with Node `v24.18.0`, pnpm `11.15.1` and Wrangler `4.127.0`. `wrangler auth list` proved profile `collab-bot` is bound only to this repository; `wrangler whoami --account 643464cda99dd9fb036367674d42a62c` proved the exact authorized account. The immediate pre-deploy `deployments list` returned Cloudflare code `10007`, so the Worker name was still unoccupied. A strict dry run exposed exactly one `COLLABORATION_STATE` SQLite Durable Object binding, seven non-secret staging vars and three hidden secret bindings before the single real upload.
- **Telegram development topology:** authenticated Telegram Web account `@ChDenis` created bot `@collaboration_development_bot` (`8777929575`) and public channel `@collaboration_showcase_dev` (`-1004314534828`) under the user's explicit authorization. The bot is an administrator with exactly post, edit and delete-message capabilities; all other administrator rights are disabled. Exact-token Bot API `getMe`/`getChat`/`getChatMember` checks independently matched both identities and capabilities. `getWebhookInfo` returned an empty URL and zero pending updates: no webhook was set and no update or bot message was sent in CF2-01.
- **Secret handling:** `BOT_TOKEN`, random `TELEGRAM_WEBHOOK_SECRET` and random `OPERATIONS_TOKEN` were uploaded only through a mode-`0600` JSON secrets file outside the repository; Wrangler output showed values as hidden. A repository scan across 238 tracked/untracked files found zero exact-secret or Telegram-token-pattern matches. The generated deployment-only secrets file was removed after the upload; the mode-`0600` primary handoff file remains temporarily outside the repository for the separately authorized CF2-02 unit.
- **Deployment evidence:** Cloudflare created only Worker `collaboration-bot-staging` and SQLite namespace `collaboration-bot-staging_CollaborationBotState`. Deployment `2909c201-41f2-4db3-8144-db3dff910c57` serves version `1f89aa75-6f42-4e1d-974b-6486bdad7821` at 100% on `https://collaboration-bot-staging.castors-suburb-2h.workers.dev`; secret metadata lists exactly `BOT_TOKEN`, `OPERATIONS_TOKEN` and `TELEGRAM_WEBHOOK_SECRET`. Dashboard inventory shows one Worker and one Durable Object namespace. The service domain view shows only workers.dev; Custom domains and Routes are empty. Production Worker, production bot/webhook, source SQLite, insta-chat resources and billing settings were not touched.
- **Hosted runtime evidence:** public `GET /health/live` returned exact `{status:"ok",runtime:"cloudflare",environment:"staging"}`. Protected `GET /ops/ready` returned HTTP 200 with `status=ready`, `identity=verified`, `showcase.canPublish=true`, `showcase.reason=null` and `durableObject=CollaborationBotState`; this read-only path initialized the DO and used only Telegram identity/chat/member lookups. Protected state export returned transfer version `1`, schema version `13`, all 17 expected product tables, a manifest digest and zero rows in every table. A bounded tail captured the same version handling the public health request with outcome `ok`, HTTP 200, no exception and no application log.
- **Free-usage snapshot:** after deploy and the bounded verification requests, Dashboard still shows Workers Free capacity at `4 / 100,000` requests today, `4 ms` CPU, zero observability events and zero build minutes. Durable Objects shows the single expected namespace, zero errors and SQLite storage; the usage panel reports no paid/quota warning. No upgrade or billing action occurred.
- **Verification:** focused config test was RED for the provisional Telegram names/missing secret contract and then GREEN (3 tests); hosted readiness test was RED for the missing binding path and then GREEN (2 tests). Final `pnpm check` PASS (architecture 141 modules/476 dependencies; unit 16 files/80 tests; integration 20/90; runtime 7/47; lint 0 errors with two pre-existing generated-file warnings; typecheck/build PASS); `pnpm test:e2e:fake` PASS (8 files/33 tests); host-capable `WRANGLER_WRITE_LOGS=false pnpm test:cloudflare` PASS (7 files/27 tests); `pnpm db:verify`, `pnpm cloudflare:typecheck`, `WRANGLER_WRITE_LOGS=false pnpm cloudflare:types:check`, `pnpm cloudflare:migrations:check`, `git diff --check` and the credential scan PASS. Changed files are `.dev.vars.example`, `.gitignore`, `IMPLEMENTATION_PLAN.md`, `src/worker.ts`, `worker-configuration.d.ts`, `wrangler.jsonc`, `test/cloudflare/cf2-01-staging.test.ts` and `test/unit/cf2-01-staging-config.test.ts`.
- **Review result:** independent blocker-limited final review returned `PASS` with no findings. It independently rechecked the 100% staging version, exact binding/secret set, hosted health, full Cloudflare suite, type/migration/diff gates, 238-file token-pattern scan, private-file boundary and absence of webhook, production or duplicated-effect paths.

#### CF2-02 — Run hosted staging webhook and alarm smoke

- **Status:** `completed`
- **Objective:** Prove the real path `dev Telegram → Worker → DO SQLite → alarm → Telegram`.
- **Dependencies:** `CF2-01`.
- **Authorization:** the user explicitly authorized this card after being told it includes dev BotFather `setWebhook` and a named-account real staging smoke; production remains unauthorized.
- **Read first:** complete CF2-01 evidence and exact deployed version; PRD §20.1–§20.2; Technical Design §20.5–§20.6 plus Telegram ingress, showcase publication, direct-delivery and alarm recovery contracts; Worker webhook/operations routes; current fake first-launch journey; exact live Telegram actors, admin allowlist and private staging handoff boundary; installed Wrangler and Telegram Bot API behavior.
- **Scope:** set dev webhook with secret and `drop_pending_updates=false`, verify `getWebhookInfo`, run bounded profile → publish → browse → apply → accept → contact/admin-hide journey, duplicate update probe, alarm retry/recovery probe and remote state inspection.
- **Do not touch:** production bot/channel/data; no follower messages outside named smoke actors.
- **Invariants:** evidence separates HTTP health, webhook delivery, authoritative rows, Telegram effects and alarm recovery; no replay produces duplicate business/Telegram effect.
- **Verification:** hosted logs, Data Studio/read-only operator query, webhook info, expected message IDs/state/counts and Free quota deltas.
- **Stop conditions:** wrong Cloudflare profile/account/version, missing or unapproved Telegram actor, staging admin allowlist unavailable, webhook identity/secret mismatch, non-empty pending queue before cutover, unexpected production/custom-domain/resource mutation, secret/private-contact exposure, readiness degradation, unbounded Telegram effects, duplicate business/send effect, unrecoverable or ambiguous delivery, schema/invariant failure or Free-plan risk.
- **Exit criteria:** complete hosted staging evidence; one commit `CF2-02: verify hosted Telegram staging journey`.
- **Execution evidence:** Commit SHA: `SELF`. The bounded unit ran on 2026-08-29 and its final read-only verification on 2026-08-30 from `main` at predecessor `da8ceb845e95b8db64b24ffa0ebd1b36848bb6d8`, ahead of `origin/main` only by the existing local units, with Node `v24.18.0`, pnpm `11.15.1` and Wrangler `4.127.0`. The exact repository-bound `collab-bot` profile/account, CF2-01 deployment and zero-pending-update webhook baseline were rechecked before mutation. A hosted DO cold start exposed one bounded composition defect: a persisted positive showcase capability `{canPublish:true, reason:null}` was being replaced with the fallback reason. The fix now distinguishes an absent capability object from its intentional `null` reason, with a side-effect-free runtime regression test. Staging config additionally declares `ADMIN_TELEGRAM_IDS` as a required encrypted secret; no secret value, human/admin Telegram numeric ID, private contact or raw update is stored in the repository or this evidence.
- **Deployment and isolation:** the single authorized upload produced deployment `35d91298-5422-41c2-98f0-87895348b9b3`, version `62be0197-88fe-4719-b5be-2599dce03a9a` at 100% and `https://collaboration-bot-staging.castors-suburb-2h.workers.dev`, annotated `CF2-02 hosted staging journey candidate`. Read-only Cloudflare API and Wrangler checks prove exactly the staging Worker, one SQLite namespace `collaboration-bot-staging_CollaborationBotState`, binding `COLLABORATION_STATE` to class `CollaborationBotState`, four hidden secret names (`BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `OPERATIONS_TOKEN`, `ADMIN_TELEGRAM_IDS`), workers.dev enabled, previews disabled and zero custom domains. Production Worker, production bot/channel/webhook/data, source SQLite, insta-chat resources, routes, custom domains and billing settings were not touched.
- **Duplicate-update evidence:** after private capture of one real `@ChDenis` `/help` update, its exact byte-identical body was POSTed twice directly to the staging webhook under the user's one-shot authorization. Both responses were HTTP 204 with empty bodies; the authoritative deltas were exactly one Telegram user, one completed command receipt and one processed update, with zero business-row or outbox delta, and Telegram showed exactly one bot help reply. The raw update stayed outside Git and the duplicate probe was not repeated.
- **Webhook evidence:** the development bot `@collaboration_development_bot` webhook was set to the exact staging route with the configured secret, `drop_pending_updates=false`, `max_connections=1` and allowed updates `message` plus `callback_query`. Final `getWebhookInfo` returned the exact route, zero pending updates, no last error, no custom certificate and the same bounded allowed-update set.
- **Hosted journey evidence:** the named author `@ChernykDenis` created a Blogger profile and one joint-content city collaboration with one slot and a 2026-09-05 deadline; exactly one card appeared in `@collaboration_showcase_dev`. Applicant/admin `@ChDenis` found the card both in feed and by exact deep link, created the bounded quick profile and applied; the author received one DM, accepted, and the collaboration became matched. Both contact buttons resolved to the other named smoke actor, but no human contact message was sent. Author/applicant personal lists showed the accepted match, the public card changed to `Набор завершён`, and the authorized admin read plus `/admin hide` deleted the public post. After hide, both parties retained accepted contact access, feed returned no matching cards, the deep link returned `Предложение недоступно`, and the public channel was empty.
- **Authoritative-state evidence:** protected export remained transfer version `1`, schema version `13` with all 17 product tables. Final product counts are two Telegram users/profiles/platforms, one collaboration/topic/channel publication/browse session/application/operator action, zero open profile or collaboration sessions and zero product events. The collaboration is `hidden` from `matched`, its single application is `accepted`, the publication retains its inspected Telegram reference, and the one hide action is recorded. All 43 command receipts are completed, and the processed-update count is also 43. All nine outbox rows are terminal `sent` with unique idempotency keys: five direct messages, one channel send, one edit and two deletes; expected Telegram references were inspected but are intentionally not copied into evidence.
- **Alarm-recovery evidence:** one user-authorized, self-guarded staging-only Data Studio insert created exactly one synthetic channel-delete delivery without embedding Telegram actor or message IDs in SQL literals. The real DO alarm moved it through `dispatching` attempt 4 to `retryable_failed` with provider-timeout classification, cleared claim fields and scheduled the exact `+8000 ms` retry; the next alarm moved it through `dispatching` attempt 5 to `sent`, cleared transient/error state and preserved the known target. Business counts and publication links did not change, and the public channel remained empty. A bounded tail identified the same deployed version, two scheduled events about eight seconds apart, outcome `ok` for both and no exception or application log; the synthetic sent row is intentionally retained as audit evidence for CF2-03.
- **Hosted health and Free boundary:** final public health is HTTP 200 with `{status:"ok",runtime:"cloudflare",environment:"staging"}`; protected readiness is HTTP 200 with `status=ready`, `identity=verified`, `showcase.canPublish=true`, `showcase.reason=null` and Durable Object class `CollaborationBotState`. The final export has 109 total rows. Dashboard independently shows `Free — $0 — Current plan`, `76 / 100,000` Workers requests today, `91 ms` aggregate CPU, zero observability events and zero build minutes; the Free limits shown include 100,000 Workers requests/day, 100,000 Durable Object requests/day and 100,000 DO SQL rows written/day. No upgrade, paid resource or billing mutation occurred.
- **Verification:** the focused runtime/config pair passed (2 files/8 tests). Final `pnpm check` PASS (architecture 141 modules/476 dependencies; unit 16 files/80 tests; integration 20/90; runtime 7/47; lint 0 errors with the two generated-file warnings; typecheck/build PASS); `pnpm test:e2e:fake` PASS (8 files/33 tests); host-capable `WRANGLER_WRITE_LOGS=false pnpm test:cloudflare` PASS (7 files/27 tests) after the unchanged sandbox attempt hit only `listen EPERM`; `pnpm db:verify`, `pnpm cloudflare:typecheck`, `WRANGLER_WRITE_LOGS=false pnpm cloudflare:types:check`, `pnpm cloudflare:migrations:check` and `git diff --check` PASS. Exact-value and Telegram-token-pattern scans across 238 repository files found zero secret, human/admin Telegram numeric-ID, captured chat/update-ID or token matches. The CF2-02 raw update, deploy-secret copy and one-shot helper/probe files were removed from `/private/tmp`; the CF2-01 handoff alone remains outside Git at mode `0600` for CF2-03. Changed files are `IMPLEMENTATION_PLAN.md`, `src/runtime/composition/bot-application.ts`, `test/runtime/r1-06b-bot-runtime.test.ts`, `test/unit/cf2-01-staging-config.test.ts`, `worker-configuration.d.ts` and `wrangler.jsonc`.
- **Review result:** independent blocker-limited final review returned `PASS` with no findings. It independently re-ran the focused 2-file/8-test pair, checked the capability regression, secret/config/type consistency, completion metadata and clean diff, and found no credential/private-ID exposure, authoritative-data corruption, duplicate business/Telegram effect, broken core journey or unrunnable-stage blocker.

#### CF2-03 — Close staging operations and cutover readiness

- **Status:** `completed`
- **Objective:** Review the hosted candidate and produce exact production/rollback commands without mutating production.
- **Dependencies:** `CF2-02`.
- **Authorization:** the user explicitly authorized this unit's fixed fresh-staging object, safe PITR-bookmark rehearsal, staging runbook and final review; production deploy/webhook/data and an actual PITR restore remain unauthorized.
- **Read first:** complete CF2-01/CF2-02 deployment, webhook, state and Free-quota evidence; PRD §20.1–§20.2; Technical Design §20.5–§20.6 and rollback/restore boundaries; Worker protected operations and state-transfer routes; installed Wrangler 4.127.0 help; official Workers rollback/version and SQLite Durable Object PITR contracts.
- **Scope:** migration rehearsal against fresh staging object, PITR bookmark rehearsal if safe, Worker rollback caveat, webhook rollback sequence, logs/usage/Data Studio runbook, final blocker-limited review.
- **Do not touch:** production deploy/webhook/data, staging deletion or paid settings; no primary-object PITR restore/restart and no staging webhook removal/reset in this unit.
- **Invariants:** code rollback is not represented as storage rollback; remote mutations after cutover require reconciliation; original SQLite remains recoverable.
- **Tests first:** fixed-object rehearsal routes are operations-token protected and staging-gated; canonical empty-target import/export parity is retained; production/default environments cannot enable rehearsal implicitly.
- **Verification:** fresh-object import parity, previous-version identification, runbook dry-run with placeholders only, secret scan.
- **Stop conditions:** wrong profile/account/version/webhook, non-ready primary object, non-empty fresh target, manifest/schema/digest mismatch, any Telegram effect from rehearsal, production/custom-domain/billing mutation, secret/private-data exposure, PITR restore requirement, unbounded object creation, destructive cleanup or Free-plan risk.
- **Exit criteria:** CF2 completed and CF3 has exact inputs/stop conditions; one commit `CF2-03: approve production cutover candidate`.
- **Execution evidence:** Commit SHA: `SELF`. The bounded unit ran on 2026-08-30 from clean `main` at predecessor `4384dcde6e1b599be7340bb9915dbb5561cb71ee`, ahead of `origin/main` only by the existing local units, with Node `v24.18.0`, pnpm `11.15.1`, Wrangler `4.127.0`, unique Task-ID and the repository-bound `collab-bot` profile on the exact CF2 account. Before mutation, the active CF2-02 deployment/version, four hidden secret names, hosted health/readiness, exact development webhook with zero pending updates/no last error, 17-table primary export and 109-row digest were rechecked. Context7 documentation lookup was unavailable because its monthly quota was exhausted; the unit instead used current official Cloudflare SQLite Durable Object/PITR, Workers versions/rollback pages and the installed Wrangler 4.127.0 help. No production resource, custom domain, production Telegram identity/data, billing setting or local authoritative SQLite was touched.
- **Test-first and implementation evidence:** focused RED initially returned 404 on all three missing rehearsal contracts. The implementation adds only operations-token-protected routes for fixed object `collaboration-bot-cf2-03-rehearsal`: staging-gated one-shot import, canonical export and `getCurrentBookmark()` capture. The caller cannot choose an object name; ordinary `/ops/state/*`, webhook, readiness and alarm paths still address only `collaboration-bot-primary`; `STATE_IMPORT_ENABLED=false` still disables primary import. The rehearsal object has no public or internal ready/update/restore/delete route and none of its handlers schedules an alarm. After routes existed, the absent-environment case exposed that the test helper's JavaScript default parameter converted explicit `undefined` back to `staging`; the fixture now uses an explicit null sentinel and proves absent plus production environments both fail closed. Final focused result is 1 file/3 tests PASS: auth/environment gating, transactional empty-target import with exact parity and repeat 409, unchanged primary/import audit, no alarm, absent ready/update, and nonempty bookmark or explicit local-runtime fallback.
- **Hosted deployment and rollback candidate:** the single authorized staging upload produced deployment `df70d03a-0d3b-41ab-8cc7-6d6b6820ee23`, version `59917d21-c09e-4239-8ef8-d97656df9d9f` at 100%, annotated `CF2-03 cutover readiness candidate`. Read-only version inspection identifies CF2-02 version `62be0197-88fe-4719-b5be-2599dce03a9a` as the previous known-good code candidate: it has the same SQLite Durable Object class/export, namespace binding, compatibility date, hosted configuration and secret-name contract, and the current schema is unchanged. It was not rolled back. CF2-01 remains historical evidence, not an automatically approved rollback target. The runbook makes code/version rollback explicitly different from SQLite/PITR recovery and Telegram-effect reconciliation.
- **Fresh-object transfer and PITR evidence:** the exact fixed remote rehearsal object was first exported with schema version 13, all 17 canonical product tables and zero product rows. A nonempty pre-import PITR bookmark was captured privately. The private primary manifest was imported once: the result contained 17 tables/109 rows and overall digest `598f0c26ef7779174054e7778fb4a576df5d12716a561f160d365e1c30eb2778`; every table name/count/digest and the overall digest matched the source. A byte-identical second import returned HTTP 409, and the next export remained identical. The post-import bookmark was nonempty and different, proving bookmark advancement; no restore, next-session restore, restart or deletion was attempted. The primary digest remained unchanged, the primary and rehearsal exports both had zero `prepared`/`dispatching`/`retryable_failed` outbox rows, webhook URL/config remained unchanged with zero pending updates/no last error, and the public staging channel still rendered zero messages.
- **Hosted isolation, logs and Free boundary:** the Dashboard still showed `Free — $0 — Current plan`; the displayed Free limits include 100,000 Workers requests/day, 100,000 Durable Object requests/day, 100,000 SQL rows written/day and 5 GB SQL storage. The pre-tail snapshot showed 90 Worker invocations, 1,096 µs CPU and zero errors for the last 24 hours; the namespace showed 100 requests, 132 ms wall time and zero errors. Immediately after the rehearsal, the selected object showed exactly six HTTP requests, zero alarm/RPC/WebSocket activity, zero errors and 493 SQL rows written for the import/migrations, far below the Free boundary. A bounded tail filtered to the active CF2-03 version then added only safe health/export/bookmark probes: every captured Worker/DO event had outcome `ok`, HTTP 200, no exception, no application log and a redacted authorization value. No raw manifest/bookmark/update or user-authored content was retained. The imported remote object is deliberately retained as immutable CF2 evidence; deletion/reset or creation of another object was not authorized.
- **Runbook and verification:** added `docs/CF2_STAGING_RUNBOOK.md` with private-file handling, exact preflight/stop conditions, fixed-object rehearsal, capture-only PITR, bounded tail/Data Studio/Free checks, inspected-version rollback commands, safe future `deleteWebhook(drop_pending_updates=false)` ordering and the CF3 rule that zero nonterminal outbox must be proven before the first `/ops/ready` call. README and Technical Design now distinguish hosted staging from production and Worker code rollback from storage/effect recovery. `pnpm check` PASS (lint 0 errors with two generated-file warnings; architecture 141 modules/476 dependencies; unit 16 files/80 tests; integration 20/90; runtime 7/47; typecheck/build PASS); `pnpm test:e2e:fake` PASS (8 files/33 tests); host-capable `WRANGLER_WRITE_LOGS=false pnpm test:cloudflare` PASS (8 files/30 tests); `pnpm db:verify`, `pnpm cloudflare:typecheck`, `WRANGLER_WRITE_LOGS=false pnpm cloudflare:types:check`, `pnpm cloudflare:migrations:check` and `git diff --check` PASS. An exact-value/token-pattern scan covered 240 repository files and 48 secret/human-ID/captured-update patterns with zero findings. The private CF2-01 credential handoff, raw source manifest and all one-shot CF2-03 helpers were explicitly removed from `/private/tmp` after the final remote checks; they are not recoverable from the repository. Changed files are `IMPLEMENTATION_PLAN.md`, `README.md`, `docs/TECHNICAL_DESIGN.md`, `docs/CF2_STAGING_RUNBOOK.md`, `src/worker.ts` and `test/cloudflare/cf2-03-operations.test.ts`.
- **Review result:** independent blocker-limited final review returned `PASS` with no findings. It independently checked the full diff, focused test/type gate, exact staging/fixed-object boundary, primary isolation, transactional one-shot import, absence of alarm/ready/update/restore/delete, capture-only PITR, Wrangler 4.127.0 command syntax, secret/private-contact boundary and CF3 pre-readiness outbox stop gate. It found no credential/private-contact exposure, authoritative-data corruption, duplicate business/Telegram effect, broken core journey or unrunnable-stage blocker.

### CF3 — Production cutover

#### CF3-00 — Freeze and export the authoritative local SQLite

- **Status:** `completed`
- **Objective:** Establish one immutable source snapshot and prevent split-brain before production import.
- **Dependencies:** `CF2-03`.
- **Authorization:** while CF2-03 was in progress, the user explicitly instructed execution to continue into the next plan units without another confirmation; under the one-stage rule this authorizes CF3, including this unit's production downtime and local process stop. Cloudflare production resources and the Telegram webhook remain outside CF3-00.
- **Read first:** completed CF2-03 evidence and `docs/CF2_STAGING_RUNBOOK.md`; PRD §20.1–§20.2; Technical Design SQLite connection/migrations, foreground shutdown, production environment boundary and recoverable backup/WAL rules; the exact runtime bootstrap, process lifecycle, migration and state-export implementations.
- **Scope:** verify exact local runtime/token identity/DB path, stop polling, prove no open DB/WAL writer, make recoverable consistent backup, run migrations/integrity/foreign-key checks, export manifest and hashes, record pending Telegram webhook/update state.
- **Do not touch:** Cloudflare production resources or Telegram webhook yet; never delete/overwrite source DB.
- **Stop conditions:** unknown process, failed integrity, dirty WAL ownership, schema mismatch, export/hash failure or unbounded downtime.
- **Exit criteria:** immutable backup + verified import manifest; local bot remains stopped; no commit contains data; one commit `CF3-00: freeze production SQLite snapshot`.
- **Execution evidence:** Commit SHA: `SELF`. The unit ran on 2026-08-30 from `main` at exact predecessor `f82e9fcc7cbca962d05bcd07e87aa31efc5c5191` with Node `v24.18.0` and pnpm `11.15.1`. The production environment file and authoritative database resolved to the owner-only `.runtime/bot.env` and `.runtime/app.sqlite`; the token identified exact bot `@davay_vmeste_bot`, the configured channel resolved to `@davay_vmeste_collab`, and Telegram confirmed that bot as the expected administrator with publication capability. `getWebhookInfo` had no webhook, zero pending updates and no last error. No matching local bot process, LaunchAgent/backup job or open database/WAL holder existed before or after the freeze, so the already-stopped polling runtime remained stopped throughout. Cloudflare production resources and the Telegram webhook were not touched.
- **WAL-safe freeze and transfer evidence:** the source initially had a nonempty 370,832-byte WAL and 32,768-byte SHM without an open holder, so a raw main-file copy was explicitly rejected. `pnpm build` and the exact compiled `db-migrate` command completed successfully, checkpointing the committed WAL before export. One recoverable SQLite backup plus canonical state-transfer manifest was then created outside Git at owner-only `~/Library/Application Support/CollaborationBot/cf3-00-freeze-20260830T033847+0500`. The first finalization attempt failed closed when an orphan backup SHM remained; after proving no holder, journal mode `delete`, integrity `ok` and exact source/backup logical parity, only that newly created orphan sidecar and a temporary comparison manifest were removed. The published directory is mode `0500` and contains exactly four mode-`0400` files: standalone `authoritative.sqlite` (360,448 bytes), `state-transfer-manifest.json` (58,459 bytes), `checksums.sha256` and the data-free `freeze-summary.json`. The source database was neither deleted nor overwritten and remains in place with zero-byte WAL, 32,768-byte SHM and zero open holders.
- **Integrity and parity evidence:** independent `shasum -a 256 -c checksums.sha256` returned `OK` for both canonical artifacts. The backup SHA-256 is `eb34df0e4278dd5609f8225f2d2551b54928b9aa9f18718bfd88826225bd6c6c`; manifest SHA-256 is `f93ba10e848e1ef78545a3f4a8056cd8c3811a93882d79060e20a54465661fd1`. The standalone backup has journal mode `delete`, integrity `ok`, zero foreign-key violations and all 13 migrations. Manifest v1/schema 13 covers all 17 canonical tables and 257 rows with digest `6234f25fe7e569959dcfa103a06ec3524cc377795c3895eae2bfd189d43556cc`; source parity is exact. Outbox status is only `sent: 9`, with zero prepared/dispatching/retryable/ambiguous/permanent-failed rows, and incomplete command receipts are zero. These gates make the snapshot eligible for CF3-01 import without dispatching a historical effect.
- **Repository and privacy verification:** an exact-value scan derived privately from the runtime environment checked 240 tracked/unignored repository files for `BOT_TOKEN`, `ADMIN_TELEGRAM_IDS` and Telegram-token syntax and found zero findings; no raw row, manifest, token, private Telegram ID or webhook secret entered Git. `git diff --check` passed. The only tracked change is `IMPLEMENTATION_PLAN.md`; all one-shot CF3-00 helpers were removed from `/private/tmp` after verification. The immutable private freeze set is deliberately retained as the rollback source for CF3 and is not deleted by later units.
- **Review result:** independent blocker-limited final review returned `PASS` with no findings. It checked the exact diff and freeze summary against the CF3-00 card, including authorization, stopped-runtime evidence, WAL handling, source preservation, manifest parity, outbox/receipt safety, permissions, secret boundary and the prohibition on Cloudflare production/webhook mutation.

#### CF3-01 — Deploy production and import before traffic

- **Status:** `completed`
- **Objective:** Prepare production Worker/DO with an exact copy while Telegram still has no webhook.
- **Dependencies:** `CF3-00`.
- **Authorization:** the user explicitly authorized continuing the remaining CF3 units without another confirmation after CF3-00; this covers the bounded production Cloudflare resource, encrypted-secret, deploy and one-shot import actions in this card. Telegram webhook and smoke actions remain outside CF3-01.
- **Read first:** completed CF3-00 evidence and immutable freeze summary; completed CF2 hosted evidence and `docs/CF2_STAGING_RUNBOOK.md`; PRD §20.1–§20.2; Technical Design hosted topology, pre-readiness outbox gate and rollback boundary; current Worker operations/state-transfer routes, Wrangler config/schema/help, and current official Cloudflare environment, secret, SQLite Durable Object, version and PITR contracts.
- **Scope:** recheck Free plan/usage; deploy production Worker and singleton namespace; set non-secret vars/encrypted secrets; initialize schema; one-shot import; compare table counts/content hashes, invariants, identity, showcase preflight, alarm/outbox state; capture version/PITR bookmark.
- **Do not touch:** Telegram webhook until every comparison passes; no staging reuse; no source DB mutation.
- **Rollback:** before webhook, delete/leave unused remote candidate and restart original polling DB; do not alter source snapshot.
- **Exit criteria:** production target is bit-for-logical-bit verified and traffic-free; evidence only, no data in Git; one commit `CF3-01: verify production Cloudflare import`.
- **Execution and preflight evidence:** Commit SHA: `SELF`. The unit ran on 2026-08-30 from clean `main` at exact predecessor `23576eb6fc74f44c92870279522cbbec8d137e08`, with Node `v24.18.0`, pnpm `11.15.1`, Wrangler `4.127.0`, unique Task-ID and repository-bound profile `collab-bot` on exact account `643464cda99dd9fb036367674d42a62c`. Immediately before mutation, Wrangler returned code `10007` for unoccupied Worker `collaboration-bot-production`; Dashboard listed only the unchanged staging Worker/namespace, zero D1 databases, no production collision, `Free — $0 — Current plan`, 93/100,000 Worker requests and 360.45 kB staging DO storage. The immutable CF3-00 checksums and exact source main/WAL/SHM hashes passed, with zero DB holders and zero polling process. Production `@davay_vmeste_bot` and `@davay_vmeste_collab` matched exact private IDs/capabilities; the bot remained channel administrator with post/edit/delete rights, and `getWebhookInfo` had an empty URL, zero pending updates and no last error.
- **Test-first and production boundary:** focused RED proved that `env.production` and a primary PITR route were absent. The final config adds only isolated Worker `collaboration-bot-production`, workers.dev enabled, previews/routes/custom domains absent, the separate declarative SQLite `CollaborationBotState` namespace/binding, seven non-secret production vars and four required encrypted-secret names. Committed `STATE_IMPORT_ENABLED=false` is enforced by a focused config test. The new `GET /ops/pitr/bookmark` requires the operations bearer token, fails closed outside exact `production`, always addresses fixed `collaboration-bot-primary`, invokes only `getCurrentBookmark()` and has no update, readiness, alarm, restore, restart or delete path. Focused GREEN is 2 unit tests plus 2 workerd tests; staging rehearsal behavior remains isolated.
- **Private secret and bootstrap deployment:** a fresh owner-only handoff directory outside Git stores the existing production bot token/admin allowlist, new distinct random webhook/operations secrets, manifests and PITR bookmarks; the directory is mode `0700` and every file is mode `0600`. Values were never printed or passed in command arguments. A strict dry run exposed exactly one SQLite DO binding, seven production plain vars and four hidden secret bindings. The temporary import-enabled bootstrap created namespace `collaboration-bot-production_CollaborationBotState` and deployed version `23ce133f-dc67-49f2-844e-84e2b4369007` in deployment `1d323b7d-75b2-48ed-ab81-b6f42901adbc`; public health returned exact production identity while Telegram still had no webhook. This bootstrap is deliberately not a rollback candidate.
- **Fresh target and one-shot import:** protected export initialized migrations without calling readiness and proved transfer v1/schema 13, all 17 canonical tables, zero product rows, empty outbox/receipts and no previous production object state; a nonempty pre-import PITR bookmark was captured privately. The immutable 58,459-byte CF3-00 manifest was submitted once and returned HTTP 200 with 17 tables, 257 rows and digest `6234f25fe7e569959dcfa103a06ec3524cc377795c3895eae2bfd189d43556cc`. Protected export then matched every table schema/count/digest and the overall digest exactly; the PITR bookmark advanced. Outbox contains only `sent: 9`, with zero prepared/dispatching/retryable/ambiguous/permanent-failed rows, and incomplete command receipts are zero. One byte-identical repeat returned HTTP 409 without changing the export.
- **Sealed production candidate:** production config/types were restored to `STATE_IMPORT_ENABLED=false`, focused/type/dry-run gates passed, and strict deployment `db6f8b58-eef3-421b-ae96-e97334e08c58` activated final version `b3fe7f22-9952-446a-9a57-2ff7754a53e7` at 100% on `https://collaboration-bot-production.castors-suburb-2h.workers.dev`. Version inspection proves SQLite storage, exact namespace `942002e61f4b4f68ad56bb780ea0e74a`, compatibility date `2026-08-28`, production vars, `STATE_IMPORT_ENABLED=false` and exactly four secret bindings. An authenticated JSON import probe now fails before forwarding with HTTP 403 `state_import_disabled`; subsequent export and nonempty PITR bookmark remain exact. Dashboard shows only workers.dev; Custom domains and Routes are empty. Staging remains on deployment `df70d03a-0d3b-41ab-8cc7-6d6b6820ee23`/version `59917d21-c09e-4239-8ef8-d97656df9d9f` and was not mutated.
- **Readiness, ingress and alarm boundary:** only after the sealed export re-proved terminal-only outbox state, protected `/ops/ready` returned HTTP 200 with `status=ready`, `identity=verified`, `showcase.canPublish=true`, `reason=null` and exact Durable Object class. Pre/post-ready exports remained identical. Given the fresh object, no alarm-producing path before readiness, terminal-only outbox and the tested `scheduleNextAlarm` contract, no alarm was scheduled; a bounded tail after readiness captured only the three explicit health/export/bookmark probes and their internal DO calls, all on the final version with outcome `ok`, HTTP 200, zero exceptions/logs and redacted authorization, and no alarm event. Production `getWebhookInfo` still had an empty URL, zero pending updates and no error; no webhook, Telegram update, message/channel mutation or local polling restart occurred.
- **Free, verification and privacy evidence:** post-unit Dashboard still shows `Free — $0 — Current plan`, with 110/100,000 Worker requests and the published Free limits of 100,000 DO requests/day, 100,000 SQL rows written/day and 5 GB SQL storage; no billing/upgrade action occurred. Final `pnpm check` PASS (lint 0 errors with two generated-file warnings; architecture 141 modules/476 dependencies; unit 17 files/82 tests; integration 20/90; runtime 7/47; typecheck/build PASS); `pnpm test:e2e:fake` PASS (8 files/33 tests); host-capable `WRANGLER_WRITE_LOGS=false pnpm test:cloudflare` PASS (9 files/32 tests); `pnpm db:verify`, `pnpm cloudflare:typecheck`, `WRANGLER_WRITE_LOGS=false pnpm cloudflare:types:check`, `pnpm cloudflare:migrations:check`, both strict production dry runs and `git diff --check` PASS. Exact-value/token-pattern scan covered 242 repository files and all six local/production credential/admin-ID classes with zero findings. The source/freeze hashes and zero-holder/zero-polling state remained unchanged. Changed files are `IMPLEMENTATION_PLAN.md`, `wrangler.jsonc`, `worker-configuration.d.ts`, `src/worker.ts`, `test/unit/cf3-01-production-config.test.ts` and `test/cloudflare/cf3-01-production-operations.test.ts`; raw data, secrets and bookmarks remain outside Git.
- **Review result:** independent blocker-limited final review returned `PASS` with no findings. It independently rechecked the full diff, canonical focused/type/generated-type gates, active sealed production version, exact export/freeze parity, import rejection, PITR availability, terminal-only outbox and complete receipts, empty Telegram webhook, exact bot/channel capabilities, unchanged staging and source freeze, Free/$0 usage, owner-only private artifacts and a 242-file exact-secret scan; no credential/private-contact exposure, authoritative-data corruption, duplicate business/Telegram effect, broken core journey or unrunnable-stage blocker was found.

#### CF3-02 — Switch Telegram from polling to production webhook

- **Status:** `completed`
- **Objective:** Perform the single ingress cutover and prove the hosted core journey.
- **Dependencies:** `CF3-01`.
- **Authorization:** after CF3-01 the user explicitly instructed the remaining plan units to start without another confirmation; within the already authorized CF3 stage this covers the bounded production `setWebhook`, exact showcase mutation and named smoke-user actions in this card. It does not authorize broad user notification, public link distribution, paid resources, staging mutation, stale local restart after a remote effect, push, PR, merge or work beyond CF3.
- **Read first:** completed CF3-00/CF3-01 evidence and immutable private handoff; `docs/CF2_STAGING_RUNBOOK.md` webhook rollback and CF3 handoff boundaries; PRD §19.1 and §20.1–§20.2; Technical Design §10–§12, §15, §19 and §20.5–§20.6; current webhook ingress, Durable Object alarm/outbox, Telegram routing and real-smoke contracts.
- **Scope:** set exact workers.dev HTTPS webhook with secret and `drop_pending_updates=false`; verify `getWebhookInfo`; send bounded `/start` then core mutation/publication/application smoke; inspect Worker/DO logs, state, alarm and message IDs after every boundary.
- **Do not touch:** source SQLite except read-only comparison; no broad user notification or link distribution.
- **Rollback:** if no remote business mutation occurred, `deleteWebhook` then restart the frozen local DB; after any remote mutation/Telegram effect, stop and reconcile/export remote state instead of blindly reverting to stale SQLite.
- **Stop conditions:** identity/preflight mismatch, webhook retries/non-2xx, missing/duplicate effect, quota/resource error, secret exposure or state divergence.
- **Exit criteria:** real production webhook journey passes with exact hosted evidence; ingress is webhook-only; one commit `CF3-02: cut production ingress to webhook`.
- **Execution and alarm evidence:** Commit SHA: `SELF`. The unit ran on 2026-08-30 from clean `main` at exact predecessor `c61076abfdd888524445a6ad63ca29ccf3b7245c`, with Node `v24.18.0`, pnpm `11.15.1`, Wrangler `4.127.0`, unique Task-ID and the exact CF3 Cloudflare profile/account. Direct alarm state was a required stop-boundary but was absent from the protected API, so test-first RED reproduced two missing-route failures. The smallest code change adds a Bearer-protected, exact-production-only `GET /ops/alarm` that always addresses fixed `collaboration-bot-primary` and invokes only `state.storage.getAlarm()`; it has no scheduling, update, readiness, Telegram or outbox mutation path. Focused GREEN is 2/2 tests proving 401/403, exact timestamp and unchanged stored alarm. Production version `7408355f-5fe3-4fcb-8cf4-d07181ed21e7` was deployed at 100% with message `CF3-02 protected alarm inspection before ingress cutover`; staging remained on version `59917d21-c09e-4239-8ef8-d97656df9d9f`. Exactly four encrypted secret names remained configured and import remained disabled.
- **Ingress cutover evidence:** immediately before the cutover, health/readiness, exact bot/channel identity and post/edit/delete capabilities, 17-table/schema-13 imported state, terminal-only nine-row outbox, complete receipts, nonempty PITR, `scheduledAt=null`, unchanged source/freeze hashes, zero SQLite holders and zero polling processes all passed. One private helper then called Telegram `setWebhook` exactly once for the exact production workers.dev `/telegram/webhook` URL with the private secret, `drop_pending_updates=false`, `max_connections=1` and only `message`/`callback_query`; it did not print or pass credentials in argv. `getWebhookInfo` immediately and finally showed the exact URL, zero pending updates, no last error/custom certificate and the exact connection/update settings. The first real `/start` crossed the rollback boundary, so the stale source SQLite was never restarted.
- **Named production journey:** only authorized actors `@ChernykDenis` (author) and `@ChDenis` (applicant/admin) were used. The author reused the existing profile, created and published one private-reference joint-content/city smoke card with one place; one new `channel_send` produced the linked showcase message. The applicant opened only that exact link and submitted one scenario-specific application; one author DM was sent. The author reopened the exact card once and accepted the single pending application; it became `accepted`, the collaboration became `matched`, the channel edit reused the publication message and five downstream DM/edit deliveries completed. The allowlisted admin hid exactly that card from `matched`; one audit action and one known-target `channel_delete` completed. A final exact deep-link request returned the neutral `Предложение недоступно` response. No human-to-human contact message, third account, feed interaction, broad link distribution or unrelated card mutation occurred.
- **Durability and delivery evidence:** the imported baseline of 257 rows, 108 receipts/processed updates and nine sent outbox rows advanced to 312 rows, 128 completed receipts, 128 processed updates and 17 outbox rows, all `sent`. Expected authoritative deltas are one collaboration/topic/publication/application/operator action, two decision actions and eight deliveries: one channel send, one author notification DM, five acceptance/matched DM/edit effects and one channel delete. The final card is `hidden` from `matched` at projection revision 4, its application remains accepted, profile/collaboration sessions are empty and the one pre-existing browse session is unchanged; receipt/update counts match, all new idempotency keys are unique, every new delivery completed in one attempt without an error, nonterminal/incidents are zero, alarm is null and PITR is nonempty. Final health/readiness returned HTTP 200 with verified identity/showcase capability; schema 13 has 17 tables, 312 rows and digest `e602c0e8515e2e56a6fc1ac0b3f3409e62428d527d273f03bde2c0a1e41dc300`.
- **Tail, deviations and privacy boundary:** the private active-version tail was initially sanitized line-by-line, but Wrangler emitted pretty-printed JSON and concurrent async line writes interleaved records; the first sanitizer therefore failed closed to `tail_unparsed_line` without printing raw data, and its incomplete 74-record parse is not used as evidence. A private marker-only aggregate over the complete raw stream found 114 production active-version events: 106 fetches (66 GET and 40 POST) plus exactly eight scheduled events; all 20 `/telegram/webhook` POSTs pair with 20 internal update POSTs, responses are 66 HTTP 200 and 40 HTTP 204, and all 114 events have outcome `ok`, empty logs and empty exceptions. Telegram Web's first exact applicant deep-link open emitted two distinct read-only `/start` updates/replies instead of one; checkpoints proved that the extra update created no collaboration, application, action or outbox delivery, and the journey continued without repeating the link. During evidence collection, one read-only manifest search and one full Telegram profile DOM snapshot exposed user-owned identifiers/text only to local Codex tool output; no bot/webhook/operations secret, private deep-link token, Git artifact, Cloudflare log or third party received those values. Subsequent browser checks used targeted selectors and all retained raw manifests/tail/bookmarks remain owner-only outside Git.
- **Verification and review:** `pnpm check` PASS (lint zero errors with two generated-file warnings; architecture 141 modules/476 dependencies; unit 17 files/82 tests; integration 20/90; runtime 7/47; typecheck/build PASS); `pnpm test:e2e:fake` PASS (8 files/33 tests); host-capable `WRANGLER_WRITE_LOGS=false pnpm test:cloudflare` PASS (10 files/34 tests); `pnpm cloudflare:typecheck`, `pnpm cloudflare:types:check`, `pnpm cloudflare:migrations:check`, `pnpm db:verify`, production strict dry run, `git diff --check` and credential-value scan PASS. Final source main/WAL/SHM hashes remained `cc967b4224dcda610aa41347fe509c6ce6ab8ed6eba29e063dd9a657a780083a`, the empty-file SHA-256 and `fd4c9fda9cd3f9ae7c962b0ddf37232294d55580e1aa165aa06129b8549389eb`, with no holders/polling process. Dashboard still shows `Free — $0 — Current plan`; no billing/resource/domain/staging mutation occurred. Independent blocker-limited review returned `PASS`: the final route is protected, production-gated, fixed-primary and read-only, with no credential/private-contact exposure, authoritative corruption, duplicated business/Telegram effect, broken core journey or unrunnable-stage blocker. Changed tracked files are `IMPLEMENTATION_PLAN.md`, `src/worker.ts` and `test/cloudflare/cf3-02-production-alarm.test.ts`; no push, PR or merge was performed.

#### CF3-03 — Close deployment evidence and operations handoff

- **Status:** `completed`
- **Objective:** Make the deployed bot operable without claiming guarantees that Free tier cannot provide.
- **Dependencies:** `CF3-02`.
- **Authorization:** the user explicitly instructed the remaining CF3 units to continue without another confirmation. This card is documentation plus read-only inspection only; it does not authorize deploy, rollback, import, webhook mutation, `/ops/ready`, billing, distribution, deletion, push, PR or merge.
- **Read first:** completed CF3-00–CF3-02 evidence and private handoff boundaries; README production/runtime claims; Technical Design hosted topology, alarm/outbox, observability, recovery and Free-tier limits; `docs/CF2_STAGING_RUNBOOK.md`; current package/Wrangler/Worker operations contracts and installed Wrangler help.
- **Scope:** record deployed version/URL/bindings/webhook status/schema/PITR bookmark/usage; update README/TD/plan; document logs, Data Studio, local dev relay, safe deploy/rollback/export/import procedures and Free quota failure behavior; final blocker-limited review.
- **Do not touch:** delete staging/source backup, enable billing, distribute bot link or perform further production actions; `/ops/ready` is excluded from routine read-only verification because it may refresh preflight and change alarm scheduling.
- **Verification:** `pnpm check`; full local Cloudflare gates; read-only hosted health/schema/outbox checks; secret scan; clean tree; exact `origin/main` status before any separately authorized push.
- **Exit criteria:** CF3 completed; production deployment is evidenced, original SQLite/freeze and private handoff artifacts are retained without automatic expiry until a separately authorized retention/deletion decision, and any future push/distribution remains separately authorized; one commit `CF3-03: document Cloudflare production handoff`.
- **Execution and read-only snapshot:** Commit SHA: `SELF`. The unit ran on 2026-08-30 from clean `main` at exact predecessor `65c9d32b7d91fa25f15da60d8367014c632e6de7`, with Node `v24.18.0`, pnpm `11.15.1`, Wrangler `4.127.0`, unique Task-ID and the user-authorized automatic continuation of the remaining CF3 units. No deploy, rollback, import, webhook mutation, `/ops/ready`, billing, distribution, deletion, staging mutation, push, PR or merge occurred. The read-only hosted snapshot at `2026-08-30T00:23:05.290Z` and final deployment-status refresh proved deployment `61b828fb-cadd-4ddb-bb73-1ce2e6d46f6a` serving version `7408355f-5fe3-4fcb-8cf4-d07181ed21e7` at 100% on the exact production workers.dev host; version metadata still has the SQLite `COLLABORATION_STATE → CollaborationBotState` namespace, four encrypted-secret names and `STATE_IMPORT_ENABLED=false`. Public health returned HTTP 200. The canonical export is transfer v1/schema 13 with 17 tables, 312 rows and digest `e602c0e8515e2e56a6fc1ac0b3f3409e62428d527d273f03bde2c0a1e41dc300`; all 17 outbox rows are sent, nonterminal/incidents are zero, 128 completed receipts equal 128 processed updates, profile/collaboration sessions are empty, the one pre-existing browse session remains, alarm is null and PITR is nonempty. Telegram still names the exact production webhook with zero pending updates, `max_connections=1`, only `message`/`callback_query`, no last error and no custom certificate; bot/channel identities and post/edit/delete capability remained exact.
- **Free and retained-state evidence:** the Cloudflare Dashboard showed exactly one current Free plan at `$0`. Timestamped handoff counters were 31/100,000 Worker requests and 195 ms CPU; the production Durable Object showed 32 requests, zero errors and 0.161 GB-s, while account panels showed 4.53k SQL rows read, 146 written and 360.45 kB total SQL storage. These counters can lag, reset or use different windows and are not reconciled as a durable baseline. The private handoff directory remains mode `0700` with 60 mode-`0600` files; the immutable freeze remains mode `0500` with four mode-`0400` files. Source SQLite/main/WAL/SHM hashes remain `cc967b4224dcda610aa41347fe509c6ce6ab8ed6eba29e063dd9a657a780083a`, the empty-file SHA-256 and `fd4c9fda9cd3f9ae7c962b0ddf37232294d55580e1aa165aa06129b8549389eb`, with zero database holders. The source/freeze/private handoff are retained without automatic expiry until a separately authorized deletion/retention decision; stale SQLite is not an automatic production failover.
- **Operations handoff:** added `docs/CF3_PRODUCTION_RUNBOOK.md` and synchronized README/Technical Design with the active Worker/SQLite Durable Object topology, fixed production identity, read-only health/export/PITR/alarm checks, Data Studio `SELECT`-only boundary, version-pinned multiline/interleaved tail handling, development-token-only relay, separate deploy/rollback authorization, export/import/PITR limitations, safe `deleteWebhook(drop_pending_updates=false)` ordering, fail-closed Free quota behavior and retention/deletion policy. Routine verification explicitly excludes `/ops/ready` because it may refresh preflight and schedule an alarm. The installed Wrangler help corrected `whoami` to use the repository-activated profile without an unsupported `--profile` flag and corrected the token statement to forbid printed/logged Bot API URLs rather than denying that Telegram requests technically contain the token. The initial Context7 request hit its monthly quota, but the independent final review subsequently resolved the current Cloudflare documentation and confirmed the rollback/dry-run/tail contracts; official Cloudflare pages and installed Wrangler 4.127.0 help were also checked, so no library/API behavior was inferred from stale model memory.
- **Verification, privacy and review:** `pnpm check` PASS (lint zero errors with two generated-file warnings; architecture 141 modules/476 dependencies; unit 17/82, integration 20/90, runtime 7/47, typecheck/build PASS); `pnpm test:e2e:fake` PASS (8/33); host-capable `WRANGLER_WRITE_LOGS=false pnpm test:cloudflare` PASS (10/34); `pnpm db:verify`, `pnpm cloudflare:typecheck`, `WRANGLER_WRITE_LOGS=false pnpm cloudflare:types:check`, `pnpm cloudflare:migrations:check` and `git diff --check` PASS. The final scan covered 244 repository files and six exact secret/admin/smoke classes with zero findings and zero Telegram-token patterns. A final raw Wrangler deployment-status JSON included the Cloudflare author email in local Codex tool output; it was not copied to Git, documentation, repository logs or retained external/shared evidence, and the runbook now warns that raw identity/deployment JSON stays private. Exact remote `origin/main` remained `c4c5bfbc5f9696b63e0acf89182990017c2237fb`; the branch was 23 commits ahead before this commit and nothing was pushed. Independent blocker-limited review returned `PASS` after the consolidated documentation corrections; no credential/private-contact exposure in Git, authoritative-data corruption, duplicated business/Telegram effect, broken core journey or unrunnable-stage blocker remains. Changed files are `IMPLEMENTATION_PLAN.md`, `README.md`, `docs/TECHNICAL_DESIGN.md` and `docs/CF3_PRODUCTION_RUNBOOK.md`.

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
- **Cloudflare local candidate:** `CF1` зелёный в workerd/SQLite Durable Object; это ещё не hosted proof.
- **Hosted staging candidate:** `CF2` прошёл реальный dev-bot webhook/alarm journey на подтверждённом Workers Free account; production не изменён.
- **Hosted production deployment:** `CF3` прошёл import/cutover/real smoke и имеет точную deployment evidence; это не SLA и не обещание бесконечной доступности после исчерпания Free quota.
- **24/7 / scalable:** Cloudflare снимает зависимость от включённого Mac, но Free limits остаются fail-closed границей; SLA и подготовка к большому масштабу не заявляются.

Исторические executable units через CF3-03 завершены. AP ниже отдельно авторизован 2026-09-09; за его пределами будущую capability или новый stage нельзя выбирать автоматически. Push/PR/merge, paid resources, distribution, retention/deletion и действия вне завершённого CF3 требуют отдельного точного решения и авторизации.


## 9. AP — Automatic Telegram profile

User authorization (2026-09-09): «Я хочу, чтобы создавался профиль. Данные, которые можно брать из ТГ берутся из ТГ». This supersedes deferred profile creation in PRD §7.1. Scope is local implementation; deployment, real Telegram and remote writes are not authorized.

Product contract: first private /start (including card deep links) atomically creates one real profiles row from Telegram name and identity, without starting an obligatory questionnaire. Type is unknown (NULL); no invented platform. Username remains in the existing private Telegram snapshot and is offered for explicit public-platform selection. Existing profile names/edits are not overwritten by subsequent starts. An incomplete profile is visible to its owner, excluded from public projections and cannot create a collaboration or submit an application until required fields are complete. The existing profile_id survives completion. Available names are prefilled; optional enrichment stays optional. Deep links still open their target and abandoned completion does not submit an application.

### AP-01 — Preserve profiles while allowing an unknown type

- **Status:** `completed`
- **Objective:** Prepare a data-preserving schema for automatic profiles on Node SQLite and local workerd.
- **Requirements:** PRD §7, LFR-01/LAC-01 and AP contract above.
- **Dependencies:** CF3-03 completed.
- **Read first:** AGENTS.md; PRD §7, §19.1, §20.1; TD profiles schema and Cloudflare migration/state-transfer contracts; migrations 0003/0008/0013; migration manifest and state-transfer code.
- **Preconditions:** clean main at unique CF3-03; Node >=24.18.0 <25 and pnpm >=11.15.1 <12; inspect remote read-only. Existing runtime remains compatible while auto creation is not yet enabled.
- **Scope:** migration 0014 nullable profile type using copy-preserving column replacement; regenerated Cloudflare manifest; state-transfer schema version; migration count expectations; focused populated-upgrade test; PRD/TD/plan.
- **Do not touch:** dependencies, historic migrations, production data, credentials, remote writes, hosted runtime.
- **Invariants:** preserve profile IDs and all values/children/references; unique active profile/user; no invented type; migration checksums remain authoritative; incompatible old state exports fail closed.
- **Tests first:** populated 13→14 migration preserves profile/platform/collaboration records, permits NULL type and rejects invalid types; repeat migration is a no-op.
- **Verification:** focused integration test; pnpm check; pnpm cloudflare:migrations:check; pnpm cloudflare:typecheck; local workerd schema tests; git diff --check.
- **Exit criteria:** checks pass; evidence recorded; one local AP-01 commit and clean tree.
- **Stop conditions:** data loss, incompatible toolchain, ambiguous policy, scope beyond 12 source/test files, real/remote mutations.

- **Completion evidence:** Commit SHA: `SELF`. Preflight main at unique CF3-03 `c5aee491b55eca1c188d9bdae803387239fefcd7`; clean initial tree; Node v24.18.0/pnpm 11.15.1. Read-only origin/main verified at `c4c5bfbc5f9696b63e0acf89182990017c2237fb` (sandbox DNS failed, host read succeeded); no remote writes. Focused migration test first failed because migration 14 was absent, then passed with populated profile/platform/topic/collaboration preservation, FK/integrity checks, nullable/invalid type checks, uniqueness and replay. An initial test-harness failure used the Cloudflare runner against Node single-statement execute; corrected to the native MigrationRunner before the meaningful failing test. `pnpm check` PASS (unit 82, integration 91, runtime 47); `pnpm cloudflare:typecheck` PASS; `pnpm cloudflare:migrations:check` PASS; local `WRANGLER_WRITE_LOGS=false pnpm test:cloudflare test/cloudflare/cf1-05-sqlite.test.ts test/cloudflare/cf1-review.test.ts` PASS (9 tests); focused populated-reference test rerun PASS; diff check PASS. Local diff reviewed: no historic migration edits or data loss; independent stage review deferred to AP-03 as specified. No live DB or production was touched.
- **Changed files:** `IMPLEMENTATION_PLAN.md`, `docs/PRD.md`, `docs/TECHNICAL_DESIGN.md`, `migrations/0014_ap-01-automatic-profiles.sql`, `src/platform/database/cloudflare-migration-manifest.ts`, `src/platform/database/state-transfer.ts`, `test/cloudflare/cf1-05-sqlite.test.ts`, `test/cloudflare/cf1-review.test.ts`, `test/integration/ap-01-profile-migration.test.ts`, `test/integration/r1-07-test-support.test.ts`, `test/integration/s2-02-publication.test.ts`, `test/integration/s3-03-application.test.ts`, `test/integration/s3-04-application-decision.test.ts`, `test/integration/s4-01-admin-hide.test.ts`.

### AP-02 — Create and complete a persistent basic profile

- **Status:** `completed`
- **Objective:** Add idempotent creation from supplied Telegram name and keep incomplete profiles out of business actions.
- **Requirements:** AP contract; PRD §7, LFR-01/LFR-02/LFR-04.
- **Dependencies:** AP-01 completed.
- **Read first:** AP-01 evidence; complete AP contract; profile domain/service/repository; collaboration admission; application submission context; profile composer; nearest toolchain contracts.
- **Preconditions:** unique AP-01 commit and clean tree; verify branch/HEAD/remote/Node/pnpm.
- **Scope:** nullable type/domain completeness; profile service/repository bootstrap; complete existing profile in place; public projection and application/collaboration guards; profile rendering/completion compatibility; focused integration tests.
- **Do not touch:** Telegram /start activation until AP-03, dependencies, production, schema beyond AP-01.
- **Invariants:** one active row/user; unchanged profile_id on completion; no overwrite of user edits; no business action/public view from incomplete profile; no platform from private username without opt-in.
- **Tests first:** bootstrap twice preserves ID/name; incomplete public lookup absent; incomplete collaboration/application denied; completion reuses ID; optional data stays optional.
- **Verification:** focused integration tests; pnpm check; pnpm test:e2e:fake; git diff --check.
- **Exit criteria:** checks pass; evidence; one local AP-02 commit and clean tree.
- **Stop conditions:** identity exposure, broken core journey, toolchain conflict, scope beyond 12 source/test files, real/remote mutations.

- **Completion evidence:** Commit SHA: `SELF`. Preflight clean main at unique AP-01 `3558eeffa0cc1db40ab7071198e769ee201fd26e`, same read-only remote snapshot `c4c5bfbc5f9696b63e0acf89182990017c2237fb`, Node v24.18.0/pnpm 11.15.1. Focused tests first failed for absent ensureFromTelegram, then passed: one persisted row, initial type NULL and no platforms, private/public separation, repeat preserves name/ID, incomplete collaboration denied and applicant context absent, completion reuses ID/createdAt, edited name retained, short-name completion validation. First aggregate run caught a test-only nullable-type mismatch, corrected explicitly. `pnpm check` PASS (unit 82, integration 93, runtime 47); `pnpm test:e2e:fake` PASS (33 tests). Final diff inspected; unchanged active-profile journeys and no /start activation yet. No dependencies, schema, live data or external state changed. Independent stage review remains AP-03.
- **Changed files:** `IMPLEMENTATION_PLAN.md`, `src/modules/applications/infrastructure/sqlite-applications-repository.ts`, `src/modules/collaborations/infrastructure/sqlite-collaboration-repository.ts`, `src/modules/profiles/application/ports/profile-repository.ts`, `src/modules/profiles/application/profile-service.ts`, `src/modules/profiles/domain/profile.ts`, `src/modules/profiles/infrastructure/sqlite-profile-repository.ts`, `src/modules/profiles/presentation/telegram/profile-composer.ts`, `src/runtime/telegram/telegram-router.ts`, `test/integration/ap-02-automatic-profile.test.ts`.

### AP-03 — Automatically create profiles on Telegram start

- **Status:** `completed`
- **Objective:** First /start creates the profile and shows the usual menu/card; owner can complete it using prefilled Telegram data.
- **Requirements:** AP contract; PRD §7, LFR-01/LAC-01 and existing deep-link/application acceptance.
- **Dependencies:** AP-02 completed.
- **Read first:** AP-02 evidence; complete AP contract; Telegram router/composer, fake and workerd harnesses, migration/transfer gates.
- **Preconditions:** unique AP-02 commit and clean tree; verify branch/HEAD/remote/Node/pnpm.
- **Scope:** bootstrap before /start target routing; owner display and prefilled completion; focused fake Telegram/workerd tests and affected journey expectations; README/TD/PRD/plan final reconciliation.
- **Do not touch:** dependencies, real Telegram, credentials, remote writes, deployment.
- **Invariants:** idempotent update replay; name is populated once; private identity remains private; no username works; deep links retain target; unfinished sessions/old profiles survive; completed profiles keep current journeys.
- **Tests first:** ordinary/deep-link first start; repeated/replayed start; username absent; profile view; completion and application/creation continuation; edited name preserved.
- **Verification:** pnpm check; pnpm test:e2e:fake; pnpm cloudflare:typecheck; pnpm cloudflare:migrations:check; local pnpm test:cloudflare; git diff --check; one independent blocker-limited critical review and at most one consolidated fix wave.
- **Exit criteria:** full local/fake/workerd checks and independent review pass; evidence; one local AP-03 commit and clean tree; AP stage completed.
- **Stop conditions:** broken core journey, identity exposure, toolchain conflict, scope beyond 12 source/test files, real/remote mutations.

- **AP-03 verification before independent review:** Preflight clean main at unique AP-02 `5ceedc3456b2232abd4b23d952dd43d1d55b97aa`, Node v24.18.0/pnpm 11.15.1; host read-only origin/main rechecked unchanged at `c4c5bfbc5f9696b63e0acf89182990017c2237fb`. The new fake journey initially failed because /start had not created a profile; a test-harness reference to an unexposed runtime service was corrected before that meaningful failure. Focused real-composition fake tests then passed for first/last name, username absent, one row, replay/restart, session preservation, owner view, name reuse/edit preservation, completion/creation with original ID. Existing fake assertions expecting no row on /start were replaced with assertions for an unchanged incomplete row. Deep-link quick completion now proves original ID/name preservation and exactly one submitted application under replay. Workerd test proves profile/receipt rollback after an injected SQLite failure and successful same-update retry. `pnpm check` PASS (82 unit, 93 integration, 47 runtime; lint zero errors and two pre-existing generated-file warnings); `pnpm test:e2e:fake` PASS (35); `WRANGLER_WRITE_LOGS=false pnpm test:cloudflare` PASS (35); `pnpm cloudflare:typecheck` PASS; `pnpm cloudflare:migrations:check` PASS; `git diff --check` PASS. Secret-pattern scan over all 30 changed/new stage files found no Telegram token or private-key patterns. These are local/fake/workerd results, not production verification. Independent review pending; no commit or stage-complete claim yet.

- **Completion evidence:** Commit SHA: `SELF`. Independent read-only critical review by `ap_final_review` returned PASS: no credential/private-contact exposure, data corruption, duplicate effect, broken core journey or unrunnable-stage blocker. It confirmed the known nonblocking back→type name reset; one consolidated fix preserves draft.displayName while clearing type/platform. A focused failing assertion reproduced that name reset before the fix, then the complete fake suite passed again (35), and final `pnpm check` passed again (82 unit/93 integration/47 runtime). Earlier full local workerd (35), Cloudflare typecheck/manifest checks remain valid; the final change only preserves an existing draft field in the shared profile flow. No second independent review cycle was started. Final diff and diff-check passed. Stage AP is complete locally; real Telegram, live database migrations, deployment and push were not performed.
- **Changed files:** `IMPLEMENTATION_PLAN.md`, `README.md`, `docs/PRD.md`, `docs/TECHNICAL_DESIGN.md`, `src/modules/collaborations/presentation/telegram/collaboration-composer.ts`, `src/modules/profiles/presentation/telegram/profile-composer.ts`, `src/modules/profiles/presentation/telegram/profile-presentation.ts`, `src/runtime/telegram/telegram-router.ts`, `test/cloudflare/ap-03-automatic-profile.test.ts`, `test/e2e-fake/ap-03-automatic-profile-bot.test.ts`, `test/e2e-fake/s1-02-profile-bot.test.ts`, `test/e2e-fake/s3-02-browse-bot.test.ts`.


## 10. MFM — bilingual event profiles and authorized reset

User approved the conversational plan and launched implementation on 2026-09-09. PRD §22 supersedes classic-only entry restrictions for the new experience. RU/EN, mandatory 1–3 values in all three groups, own profile/edit without people search, neutral complete profiles and paused incomplete onboarding after shutdown, /language, and all project DB reset are explicitly authorized. No general feature release, push or unrelated infrastructure work is authorized.

Shared unit contract: read AGENTS.md, PRD §22, TD MFM contract, this complete stage/card and predecessor evidence; inspect closest source, tests, migration/toolchain contracts. Before every unit verify branch/HEAD/status/remote/predecessor Task-ID; Node 24.18.x and pnpm 11.15.x. One current unit; <=12 source/test files per unit; runtime tests first. Invariants: one user/profile; classic semantics preserved; no private identity exposure; durable state and receipt atomicity; outbound Telegram after commit. Do not touch historic migrations, dependencies, collaboration business policy or unrelated resources. Stop for policy conflict, failed required acceptance, incompatible toolchain, or unauthorized external mutation. Every unit ends with focused checks, diff inspection, exact file/command evidence and exactly one Task-ID commit (SHA SELF). Independent critical review runs once on the final code candidate; at most one consolidated correction wave.

### MFM-00 — Define the approved product and execution contract

- **Status:** `completed`
- **Dependencies:** AP-03 completed.
- **Read first:** shared MFM unit contract above; predecessor evidence; complete relevant source/test contracts.
- **Scope:** Documentation only: PRD/TD and stage cards.
- **Do not touch / Invariants / Stop conditions:** shared unit contract above; external reset mutations only in MFM-08 within explicit user authorization.
- **Tests first:** demonstrate the scope's missing behavior before runtime implementation; documentation units use diff review.
- **Verification:** git diff --check; git diff --check.
- **Exit criteria:** acceptance proved; evidence and one local commit; clean tree.

- **Evidence:** Commit SHA: `SELF`. Clean main at AP-03 `6571b61c798cb82748c84494a4bdab50cbd25fdc`; read-only origin/main `c4c5bfbc5f9696b63e0acf89182990017c2237fb` (host retry after sandbox DNS failure); Node v24.18.0, pnpm 11.15.1. Changed exactly docs/PRD.md, docs/TECHNICAL_DESIGN.md, IMPLEMENTATION_PLAN.md. User-approved decisions reconciled explicitly; no unresolved source conflict. `git diff --check` PASS; final three-file diff reviewed. Documentation-only unit; no runtime tests needed.

### MFM-01 — Add preserving MFM schema and transfer coverage

- **Status:** `completed`
- **Dependencies:** MFM-00 completed.
- **Read first:** shared MFM unit contract above; predecessor evidence; complete relevant source/test contracts.
- **Scope:** Migration 15, Cloudflare manifest, transfer tables/version and affected migration assertions.
- **Do not touch / Invariants / Stop conditions:** shared unit contract above; external reset mutations only in MFM-08 within explicit user authorization.
- **Tests first:** demonstrate the scope's missing behavior before runtime implementation; documentation units use diff review.
- **Verification:** focused migration/integration tests; pnpm check; Cloudflare manifest/typecheck/schema tests; git diff --check.
- **Exit criteria:** acceptance proved; evidence and one local commit; clean tree.

- **Evidence:** Commit SHA: `SELF`. Clean predecessor MFM-00 a164d202b1eab4245d9c64d6233e67c9141a6e43; origin/main unchanged c4c5bfbc5f9696b63e0acf89182990017c2237fb; toolchain unchanged. RED: both populated upgrades failed because migration 15 was absent. GREEN: 3 focused migration tests; pnpm check PASS (82 unit, 95 integration, 47 runtime; build/lint/architecture/typecheck); Cloudflare typecheck/manifest PASS; 9 local workerd schema/recovery tests PASS after required host retry for sandbox 127.0.0.1 EPERM. Aggregate initially identified the expected transfer table-count change (17→22), corrected. Final diff inspected; 12 source/test files plus migration/plan; historical migrations untouched. Changed files: IMPLEMENTATION_PLAN.md, migrations/0015_mfm-onboarding.sql, src/platform/database/cloudflare-migration-manifest.ts, src/platform/database/state-transfer.ts, test/cloudflare/cf1-05-sqlite.test.ts, test/cloudflare/cf1-review.test.ts, test/integration/ap-01-profile-migration.test.ts, test/integration/cf1-08-state-transfer.test.ts, test/integration/mfm-01-migration.test.ts, test/integration/r1-07-test-support.test.ts, test/integration/s2-02-publication.test.ts, test/integration/s3-03-application.test.ts, test/integration/s3-04-application-decision.test.ts, test/integration/s4-01-admin-hide.test.ts. No live database changed.

### MFM-02 — Add structured MFM model and persistence

- **Status:** `completed`
- **Dependencies:** MFM-01 completed.
- **Read first:** shared MFM unit contract above; predecessor evidence; complete relevant source/test contracts.
- **Scope:** Domain catalog/model, onboarding and MFM repository ports/adapters; focused validation/persistence tests.
- **Do not touch / Invariants / Stop conditions:** shared unit contract above; external reset mutations only in MFM-08 within explicit user authorization.
- **Tests first:** demonstrate the scope's missing behavior before runtime implementation; documentation units use diff review.
- **Verification:** focused unit/integration; architecture; typecheck; git diff --check.
- **Exit criteria:** acceptance proved; evidence and one local commit; clean tree.

- **Evidence:** Commit SHA: `SELF`. Preflight clean main at MFM-01 ed6410df6f47bbb09aa5132eb25430ccf3f1d73b; read-only origin/main remains c4c5bfbc5f9696b63e0acf89182990017c2237fb; compatible toolchain. RED: missing domain/repository modules. GREEN: 12 domain cases and persistence/rollback test PASS; typecheck, architecture (144 modules), lint and diff-check PASS (only two prior generated warnings). Explicit SQL mapping preserves profile ID, classic NULL type/platforms and completedAt; forced child failure rolls back shared name and all MFM relations. State/choices validated at persistence boundary. Final five-file source/test diff reviewed; independent stage review remains MFM-07. Changed files: IMPLEMENTATION_PLAN.md, src/modules/profiles/application/ports/onboarding-repository.ts, src/modules/profiles/domain/mfm-profile.ts, src/modules/profiles/infrastructure/sqlite-onboarding-repository.ts, test/integration/mfm-02-repository.test.ts, test/unit/mfm-02-domain.test.ts.

### MFM-03 — Implement durable onboarding decisions

- **Status:** `pending`
- **Dependencies:** MFM-02 completed.
- **Read first:** shared MFM unit contract above; predecessor evidence; complete relevant source/test contracts.
- **Scope:** Application FSM with entry/language, draft/back/multiselect/completion/edit/flag-off and integration tests.
- **Do not touch / Invariants / Stop conditions:** shared unit contract above; external reset mutations only in MFM-08 within explicit user authorization.
- **Tests first:** demonstrate the scope's missing behavior before runtime implementation; documentation units use diff review.
- **Verification:** focused FSM integration and unit tests; architecture; typecheck; git diff --check.
- **Exit criteria:** acceptance proved; evidence and one local commit; clean tree.

### MFM-04 — Render the bilingual MFM journey

- **Status:** `pending`
- **Dependencies:** MFM-03 completed.
- **Read first:** shared MFM unit contract above; predecessor evidence; complete relevant source/test contracts.
- **Scope:** RU/EN dictionaries, keyboards, compact callback codec and profiles-owned Telegram feature.
- **Do not touch / Invariants / Stop conditions:** shared unit contract above; external reset mutations only in MFM-08 within explicit user authorization.
- **Tests first:** demonstrate the scope's missing behavior before runtime implementation; documentation units use diff review.
- **Verification:** focused presentation/callback tests; typecheck; architecture; git diff --check.
- **Exit criteria:** acceptance proved; evidence and one local commit; clean tree.

### MFM-05 — Connect experience routing and configuration

- **Status:** `pending`
- **Dependencies:** MFM-04 completed.
- **Read first:** shared MFM unit contract above; predecessor evidence; complete relevant source/test contracts.
- **Scope:** Real composition, Node/Worker flag, entry/opaque/replay gates, postcommit keyboard edits and focused fake journeys.
- **Do not touch / Invariants / Stop conditions:** shared unit contract above; external reset mutations only in MFM-08 within explicit user authorization.
- **Tests first:** demonstrate the scope's missing behavior before runtime implementation; documentation units use diff review.
- **Verification:** focused fake/routing/config tests; pnpm check; Cloudflare typecheck; git diff --check.
- **Exit criteria:** acceptance proved; evidence and one local commit; clean tree.

### MFM-06 — Verify restart and cross-runtime compatibility

- **Status:** `pending`
- **Dependencies:** MFM-05 completed.
- **Read first:** shared MFM unit contract above; predecessor evidence; complete relevant source/test contracts.
- **Scope:** Full RU/EN/classic journeys, recovery/toggle/replay, migration/transfer workerd evidence and minimal fixes.
- **Do not touch / Invariants / Stop conditions:** shared unit contract above; external reset mutations only in MFM-08 within explicit user authorization.
- **Tests first:** demonstrate the scope's missing behavior before runtime implementation; documentation units use diff review.
- **Verification:** pnpm check; pnpm test:e2e:fake; pnpm test:cloudflare; Cloudflare types/typecheck/manifest; db:verify; git diff --check.
- **Exit criteria:** acceptance proved; evidence and one local commit; clean tree.

### MFM-07 — Prepare an isolated one-time database reset

- **Status:** `pending`
- **Dependencies:** MFM-06 completed.
- **Read first:** shared MFM unit contract above; predecessor evidence; complete relevant source/test contracts.
- **Scope:** Exact-target operator reset under maintenance; idempotency and local/workerd rehearsal; operation documentation.
- **Do not touch / Invariants / Stop conditions:** shared unit contract above; external reset mutations only in MFM-08 within explicit user authorization.
- **Tests first:** demonstrate the scope's missing behavior before runtime implementation; documentation units use diff review.
- **Verification:** focused reset tests; pnpm check; Cloudflare checks; final independent critical review; git diff --check.
- **Exit criteria:** acceptance proved; evidence and one local commit; clean tree.

### MFM-08 — Clear authorized project databases

- **Status:** `pending`
- **Dependencies:** MFM-07 completed.
- **Read first:** shared MFM unit contract above; predecessor evidence; complete relevant source/test contracts.
- **Scope:** Execute reviewed reset on verified project production/staging/rehearsal/local databases; record counts/digests without private rows.
- **Do not touch / Invariants / Stop conditions:** shared unit contract above; external reset mutations only in MFM-08 within explicit user authorization.
- **Tests first:** demonstrate the scope's missing behavior before runtime implementation; documentation units use diff review.
- **Verification:** preflight exact targets; post-reset empty business tables/integrity; reset surface disabled; git diff --check.
- **Exit criteria:** acceptance proved; evidence and one local commit; clean tree.

### MFM-09 — Close MFM evidence and handoff

- **Status:** `pending`
- **Dependencies:** MFM-08 completed.
- **Read first:** shared MFM unit contract above; predecessor evidence; complete relevant source/test contracts.
- **Scope:** Final documentation, clean tree and unit ledger; distinguish local implementation/reset from MFM live activation.
- **Do not touch / Invariants / Stop conditions:** shared unit contract above; external reset mutations only in MFM-08 within explicit user authorization.
- **Tests first:** demonstrate the scope's missing behavior before runtime implementation; documentation units use diff review.
- **Verification:** git diff --check; verify all Task-IDs and completed checks; git diff --check.
- **Exit criteria:** acceptance proved; evidence and one local commit; clean tree.
