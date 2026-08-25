# Collaboration Bot

## Status

This repository is the documentation baseline for the Collaboration Bot MVP. The product and technical contracts are approved for implementation planning; application source, package configuration, runtime checks, and deployment resources have not been created.

## Sources of truth

Read the documents in this order:

1. [Product Requirements Document](docs/PRD.md) — product policy, MVP boundary, functional requirements, and acceptance criteria.
2. [Technical Design](docs/TECHNICAL_DESIGN.md) — architecture, storage, failure handling, security, operations, and test traceability.
3. [Discovery brief](tz_telegram_collaboration_bot.md) — origin context and non-authoritative future ideas.

The PRD has priority over the Technical Design; the Technical Design has priority over the discovery brief. A policy change starts in the PRD and must then be reflected in the Technical Design and acceptance traceability.

## MVP boundary

The MVP is a Russian-language Telegram market for collaboration partners in Yekaterinburg: one active profile, resumable collaboration drafts, preview/publication, a showcase channel, feed filters, applications and decisions, contact disclosure after acceptance, completion reports, moderation, and SQLite analytics.

Later work includes multiple profiles, other cities, richer search, recommendations, favorites, public ratings, complaints, premoderation, photos, Mini App/web/mobile clients, an HTTP API, and a one-time Giveaway Bot handoff.

Out of scope are running giveaways or selecting winners, changing or sharing the existing Giveaway Bot database, payments, deal guarantees, external audience/ownership verification, ML recommendations, and social-network imports.

## Intended technical shape

The approved shape is a new independent TypeScript project: one modular Node.js process with `Telegram Bot API → grammY adapter → application/domain → SQLite`. It intentionally excludes HTTP API, Mini App, web application, PostgreSQL, Redis, BullMQ, Docker, and Giveaway Bot integration.

This shape is a design contract, not an implemented runtime. Do not infer source code, credentials, Telegram identity, or operational resources from this document.

## Execution

The executable registry is [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md). A user authorizes one stage at a time; units in that stage run sequentially in registry order, with one unit `in_progress` at a time and one local commit per unit.

The P0 repository baseline is complete after its two units. The exact next stage command is:

```text
Выполни этап S0 по IMPLEMENTATION_PLAN.md
```

No push, remote setup, pull request, merge, deployment, credential use, production mutation, or real Telegram action is implied by a stage command unless separately authorized.

## Readiness claims

- Documentation baseline means the approved documents, repository rules, and local Git history exist. It does not mean the bot runs.
- Functional MVP means the S0–S4 implementation and their focused, integration, fake-API, and acceptance evidence have passed. This repository has not reached that gate.
- Production readiness is not claimed. There is no deployed service, no public runtime evidence, and no 24/7 availability claim; S5 must separately establish the exact tested bot/channel identity, operational checks, backup/restore rehearsal, and real smoke evidence.
