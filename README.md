# Collaboration Bot

## Status

P0 and the compact S0 foundation are implemented locally. User-facing Telegram flows have not yet been implemented. The project is being built for a fast manual first launch by one developer, not as a studio platform or a scale-ready service.

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

## Intended technical shape

The approved shape is a new independent TypeScript project: one manually managed modular Node.js process with `Telegram Bot API → grammY adapter → application/domain → SQLite`. It intentionally excludes HTTP API, Mini App, web application, PostgreSQL, Redis, BullMQ, Docker, and Giveaway Bot integration.

This shape is a design contract, not an implemented runtime. Do not infer source code, credentials, Telegram identity, or operational resources from this document.

## Execution

The executable registry is [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md). A user authorizes one stage at a time; units in that stage run sequentially in registry order, with one unit `in_progress` at a time and one local commit per unit.

After the S0-07 rebaseline commit, the exact next stage command is:

```text
Выполни этап S1 по IMPLEMENTATION_PLAN.md
```

No push, remote setup, pull request, merge, deployment, credential use, production mutation, or real Telegram action is implied by a stage command unless separately authorized.

## Readiness claims

- Foundation complete means P0/S0 contracts and reusable local persistence/delivery primitives exist. It does not mean the bot has a user-facing flow.
- After S1 the compiled bot is manually runnable and, with separately authorized credentials, the author can touch `/start` and the profile flow in real Telegram. S2 and S3 extend the same runtime with publication and the two-user marketplace flow.
- Local launch candidate means S1–S4 and `LAC-01`–`LAC-11` pass on fake Telegram.
- Manual first launch means S4 and separately authorized `LAC-12` pass for one exact bot/channel, after which the author can manually share the link.
- Production ready, deployed, scalable and 24/7 are not claimed by this plan.
