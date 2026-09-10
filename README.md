# Collaboration Bot

## Status

P0 and S0–S4 are complete, including the separately authorized real S4 journey and manual-launch handoff. FUT-01 is implemented locally as a one-time best-effort Telegram audience snapshot; its local/fake evidence does not establish live Telegram count accuracy. The post-launch R1/R2 maintainability work and R3 top-level ownership transition are complete without changing the product boundary.

CF1 prepared the Cloudflare-compatible runtime, CF2 proved it on an isolated hosted staging Worker, and CF3 completed the bounded production freeze/import/webhook cutover plus a named two-account hosted journey. Production now runs as one workers.dev Worker and one SQLite-backed Durable Object on the confirmed Cloudflare Free plan. This is deployment evidence, not an SLA, 24/7 guarantee, unlimited-capacity claim or automatic recovery promise.

AP and MFM were released to the existing hosted staging and production bots on 2026-09-10, with MFM enabled. The first private `/start` creates one persistent base profile using the Telegram name, then new users choose RU/EN. With `MFM_FEATURE_ENABLED=true`, they choose classic or MFM. Classic retains its collaboration journey; MFM has a bilingual person/project profile and durable onboarding. Repeated starts preserve the profile and draft. The username stays private unless explicitly selected as a classic public platform.

Migration 0014 adds automatic-profile compatibility; migration 0015 adds MFM preferences, profiles and draft relations without changing classic meanings. On 2026-09-10, the separately authorized reset cleared all six project databases. The subsequent MFM release upgraded the hosted primary databases from schema13 to15 without another reset. See the [release record](docs/MFM_RELEASE_RUNBOOK.md) for deployed versions, verification and the schema-aware shutdown procedure; the [reset record](docs/MFM_RESET_RUNBOOK.md) retains its historical target evidence.

The local MNET candidate adds private people search and consensual introductions in RU/EN. Migration 0016 preserves existing profiles and adds discovery consent, introduction requests and durable search/message sessions. Local state transfer now uses schema16 (25 tables); earlier-schema exports need an explicit compatible upgrade before import. The hosted release record remains schema15: MNET has not been deployed, and its local checks do not establish a live Telegram journey.

## MFM behavior and configuration

`MFM_FEATURE_ENABLED` defaults to `false` in Node and Cloudflare and accepts only `true` or `false`. The hosted release explicitly sets it to `true`; keep that override in subsequent authorized deployment commands. Node uses its private environment file. No second bot, user database or application is needed.

- New users select language, then affiliation when enabled. No enters classic; Yes asks event status and starts MFM onboarding. Existing accounts migrate to classic without forced enrollment.
- The base profile exists from the first private `/start`. MFM answers are saved after every choice in a no-expiry draft. Only the final required step saves the completed MFM extension and shared display name atomically. Editing leaves the saved profile intact until confirmation.
- MFM requires a name, profile type, city/country, 1–3 of eight professional spheres, 1–3 of 42 related specializations and 1–3 intentions. Buttons handle categories; removed spheres prune incompatible specializations. `/start` resumes and `/language` changes RU/EN without clearing the draft.
- Before completion, no MFM feature menu is available. Completed users can view/edit their profile. In the local MNET candidate, they also get Find people and Introductions (incoming/sent/accepted). Profiles are hidden from search until their owners opt in; status, sphere, specialization and `open_to` are optional filters.
- A hidden user can browse and send a confirmed 10–500 character introduction message. Sending shares their profile with that recipient. The recipient accepts or declines; the sender can withdraw a pending request. One request per pair prevents duplicate or reverse introductions. Telegram contact appears only on the accepted pair's authorized request screen. Notifications use private bot DMs; MFM does not publish to a channel.
- Turning the flag off sends new users through language selection to classic. Completed MFM profiles remain editable with neutral labels; unfinished MFM drafts pause and resume when enabled again. MNET disables search and new requests while retaining history, pending decisions/withdrawal and accepted contacts. Shutdown preserves profile data, requests and visibility consent.

The classic creation, browse, own collaboration/application lists, decisions and contact-disclosure rules remain in their existing modules. MFM routing gates classic commands, deep links and callbacks, including repeated and group-chat deliveries. Classic UI remains Russian.

## Sources of truth

Read the documents in this order:

1. [Product Requirements Document](docs/PRD.md) — product policy, MVP boundary, functional requirements, and acceptance criteria.
2. [Technical Design](docs/TECHNICAL_DESIGN.md) — architecture, storage, failure handling, security, operations, and test traceability.
3. [Deferred platform capabilities](docs/DEFERRED_PLATFORM_CAPABILITIES.md) — consciously postponed infrastructure and return triggers.
4. [Discovery brief](tz_telegram_collaboration_bot.md) — origin context and non-authoritative future ideas.

The PRD has priority over the Technical Design; the Technical Design has priority over the discovery brief. A policy change starts in the PRD and must then be reflected in the Technical Design and acceptance traceability.

## MVP boundary

The solo-launch MVP is a Russian-language Telegram market for collaboration partners in Yekaterinburg: one active profile, resumable draft, preview/publication, one showcase channel, a simple feed, application and author decision, pairwise contact disclosure, own lists, and simple admin hide.

Later work includes completion reports/reminders, product analytics, advanced moderation, automatic deadlines, runtime heartbeat/status, scheduled cleanup, Unix-socket admission, automated backup/restore, LaunchAgent tooling, multiple profiles, other cities, richer search, recommendations, favorites, ratings, photos, Mini App/web/mobile clients, an HTTP API, and a Giveaway Bot handoff.

Out of scope are running giveaways or selecting winners, changing or sharing the existing Giveaway Bot database, payments, deal guarantees, external audience/ownership verification, ML recommendations, and social-network imports.

FUT-01 does not verify ownership, reach, authenticity or audience quality. It performs no periodic refresh, and manual audience entry remains authoritative.

## Intended technical shape

The active production shape is `Telegram webhook → Worker → singleton SQLite Durable Object → the same application/domain graph`. The legacy `Telegram Bot API → grammY adapter → application/domain → SQLite` foreground runtime remains available for local development and as historical recovery code, but its frozen database became stale as soon as CF3 accepted remote updates; it must not be started as an automatic production fallback. D1, Queues, PostgreSQL, Redis, BullMQ, Docker, and Giveaway Bot integration remain outside CF1–CF3 unless a later plan explicitly authorizes them.

The repository contains no real credentials, raw production exports, PITR bookmarks, Telegram updates or deep-link tokens. Exact operational evidence and safe inspection/recovery boundaries are recorded without secret values in the production runbook.

## Code organization

The codebase is a feature-first modular monolith. Business behavior belongs to one of six vertical slices under `src/modules`: `profiles`, `connections`, `collaborations`, `marketplace`, `applications`, or `moderation`. Each feature exposes its runtime and Telegram composition surface through its root `index.ts`. A narrow `application/index.ts` may expose application contracts to another feature; all other cross-feature internal imports are rejected by the dependency graph.

```text
src/
  modules/<feature>/
    domain/                 pure feature rules, when the feature owns them
    application/            use cases, contracts and owned ports
    infrastructure/         SQLite or provider adapters owned by the feature
    presentation/telegram/  grammY handlers, codecs and rendering
    composition/            one factory that wires the feature
    index.ts                public runtime/presentation feature API
    application/index.ts    narrow cross-feature application API, when needed
  shared/
    domain/                 framework-free shared vocabulary
    application/
      commands/             durable command and safe-result policies
      outbox/               delivery/event policies and runners
      ports/                provider-neutral contracts implemented by adapters
  platform/
    database/               shared SQLite boundary, migrations and repositories
    outbox/                 SQLite delivery and event adapters
    crypto/                 hash, token and ingress-codec implementations
    logging/                redacting process logger
    telegram/               grammY outbound transport
    time/                   system clock and provider deadline
  runtime/
    telegram/               cross-feature durable ingress and routing
    composition/            application object graph and showcase preflight
    lifecycle/              polling, worker, drain and process signals
    bootstrap/              env/private-path startup preparation
    bot-runtime.ts          narrow established runtime facade
  config/                   environment parsing and validation
  cli/                      executable entrypoints
```

Not every feature must have every subdirectory. For example, `marketplace` is a read model and `applications` primarily coordinates existing profile and collaboration state, so neither gets a decorative `domain/` layer without rules it actually owns. Test doubles live under `test/support`, outside production source.

`shared` is the framework-free internal kernel, not a second set of feature implementations. It declares cross-feature command/outbox policies and provider-neutral ports; `platform` points inward and implements those ports. `runtime` is the only global application shell. This dependency direction is enforced directly and does not need a NestJS container: feature factories and `runtime/composition` provide explicit constructor injection.

`runtime/telegram` owns cross-feature orchestration: global route precedence, private-chat and actor-snapshot guards, callback acknowledgement, one durable envelope for ordinary updates, reply buffering, and the post-commit audience action. Product decisions and feature rendering stay in the mounted feature composers. The former root `application`, `domain`, `infrastructure`, `presentation` and `src/bot` trees no longer exist.

Runtime object composition, Telegram ingress, lifecycle, process signals, environment loading and private-path preparation are explicit subdirectories, while the delivery worker owns its own loop lifecycle. `runtime/bot-runtime.ts` is intentionally retained as a narrow stable facade, not as another implementation owner.

Executable dependency-graph rules enforce layer directions and reject cycles. Production-like tests reuse explicit helpers for fresh migrated SQLite databases, feature composition, prepared fake runtimes and Telegram updates without hiding start, stop or restart behavior.

Immutable SQL migrations are the canonical schema and history. Repositories under feature infrastructure and `platform` use parameterized raw SQL with repository-local typed rows and mappers. This project keeps raw SQL because its persistence work is dominated by explicit transactions, lifecycle guards and cross-table projections already expressed and tested in SQL. The unused Drizzle schema/client did not replace those responsibilities; it duplicated schema ownership and mapping, so it was removed instead of retaining two persistence models. An ORM should be reconsidered only if it becomes the single canonical model and measurably simplifies current repository work.

## Execution

The executable registry is [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md). A user authorizes one stage at a time; units in that stage run sequentially in registry order, with one unit `in_progress` at a time and one local commit per unit.

No push, remote setup, pull request, merge, deployment, credential use, production mutation, or real Telegram action is implied by a stage command unless separately authorized.

The local Cloudflare Worker and development-bot relay procedure is documented in [the CF1 local runbook](docs/CF1_LOCAL_RUNBOOK.md). Hosted staging preflight, fixed-object state-transfer/PITR-bookmark rehearsal, Free-tier checks and rollback boundaries are documented in [the CF2 staging runbook](docs/CF2_STAGING_RUNBOOK.md). The active production topology, read-only checks, quota behavior, deploy/rollback boundaries and retained recovery artifacts are documented in [the CF3 production runbook](docs/CF3_PRODUCTION_RUNBOOK.md).

## Legacy foreground operations

This path is local-development and historical recovery tooling after CF3. Do not run it with the production token or stale `.runtime/app.sqlite` while the production webhook is active. A future ingress rollback requires separate authorization, `deleteWebhook(drop_pending_updates=false)`, a fresh remote export and explicit reconciliation first.

Use Node and pnpm versions allowed by `package.json`, keep the real env file outside Git with restrictive file permissions, and run from the repository root.

Build once after a code change:

```sh
pnpm build
```

Start in the foreground with an absolute path to the private env file:

```sh
node dist/cli/bot.js --env-file /absolute/private/path/collab-bot.env
```

The process verifies migrations, exact bot identity and showcase capability before polling. Keep this terminal open. To stop, press `Ctrl-C` once and wait until the process exits and the shell prompt returns; this lets polling, in-flight updates, the delivery loop and SQLite close cleanly. To restart, stop it gracefully, wait for exit, and run the same start command again.

The admin escape hatch is stateless and allowlisted through `ADMIN_TELEGRAM_IDS`:

```text
/admin https://t.me/<EXPECTED_BOT_USERNAME>?start=c_<opaque-token>
/admin hide https://t.me/<EXPECTED_BOT_USERNAME>?start=c_<opaque-token> <internal reason>
```

The reason is required after trimming and must contain 1–500 characters. It is stored in the private operator audit, but is not echoed in bot replies or logs. A non-admin receives the ordinary unknown-command response.

### Manual SQLite safety copy

Do not copy the database while the bot is running. First perform the graceful stop above and wait for the process to exit. Then copy the exact file named by `DATABASE_PATH` to a separately chosen destination, for example:

```sh
cp /absolute/private/path/collab-bot.sqlite /absolute/private/backups/collab-bot-2026-08-27T1700.sqlite
```

Only start the bot again after the copy command finishes. This is a manual stopped-process safety copy, not automatic backup, restore validation or a retention policy. Restore remains Later and must not be improvised over the authoritative database.

## Readiness claims

- Foundation complete means P0/S0 contracts and reusable local persistence/delivery primitives exist; it is distinct from the user-facing stages.
- S1–S3 make the compiled foreground bot manually runnable with profile, publication and two-user marketplace flows. Each local/fake result remains distinct from a real Telegram checkpoint.
- Local launch candidate means S1–S4 and `LAC-01`–`LAC-11` pass locally and on fake Telegram.
- Manual first launch means S4 and separately authorized `LAC-12` pass for one exact bot/channel, after which the author can manually share the link.
- FUT-01 is optional post-launch enrichment and does not change `LFR-*`, `LAC-*`, launch-candidate or manual-first-launch claims.
- Hosted staging candidate means CF2 passed on the isolated development bot/channel and Free account; it does not prove production traffic or authorize production mutation.
- Deployed production candidate means CF3 proved one exact Worker/version, singleton schema-13 state, webhook-only ingress and a bounded named-user journey. It does not prove continuous availability, a tested restore/RPO/RTO, unlimited Free capacity or an SLA.
- Foreground start does not provide daemon supervision, hosted availability or automatic restart and is not a production failover after remote state diverged.
