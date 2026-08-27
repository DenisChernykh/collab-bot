# Collaboration Bot

## Status

P0 and S0–S4 are complete, including the separately authorized real S4 journey and manual-launch handoff. FUT-01 is implemented locally as a one-time best-effort Telegram audience snapshot; its local/fake evidence does not establish live Telegram count accuracy.

The project targets a fast manual first launch by one developer. It is not a hosted, scale-ready or always-on service.

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

The approved shape is a new independent TypeScript project: one manually managed modular Node.js process with `Telegram Bot API → grammY adapter → application/domain → SQLite`. It intentionally excludes HTTP API, Mini App, web application, PostgreSQL, Redis, BullMQ, Docker, and Giveaway Bot integration.

The repository contains this foreground runtime, but it contains no real credentials and does not establish a deployed Telegram identity or operational resource by itself.

## Execution

The executable registry is [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md). A user authorizes one stage at a time; units in that stage run sequentially in registry order, with one unit `in_progress` at a time and one local commit per unit.

No push, remote setup, pull request, merge, deployment, credential use, production mutation, or real Telegram action is implied by a stage command unless separately authorized.

## Foreground operations

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
- Foreground start does not provide daemon supervision, hosted availability or automatic restart. Production-ready, deployed, scalable, 24/7 and SLA are not claimed by this plan.
