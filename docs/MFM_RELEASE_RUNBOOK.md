# MFM hosted release — 2026-09-10

> Historical MFMR-01 record. The later [MNET release](MNET_RELEASE_RUNBOOK.md) supersedes these active versions, schema15 checks and shutdown instructions; current hosted primaries are schema16.

User authorization: «Задеплой». MFMR-01 releases the immutable application candidate
`d192080d0a678f0341ba6149facb10a38760330a` to the existing staging and production
Workers, with `MFM_FEATURE_ENABLED=true`. The release changes no application code,
Telegram bot identity, webhook configuration, DO namespace, billing or Git remote.

## Recorded MFMR-01 deployments

| Environment | Worker version (100%) | Deployment | Activated (UTC) |
|---|---|---|---|
| staging | `b4d79bda-d848-4dcd-935b-34fc2d5a82f0` | `efb70d02-1b5d-40b8-abcb-1a80191dbaf5` | 2026-09-10 04:49:58 |
| production | `c4a99757-2f2a-468e-be76-b42ad5999a86` | `68a85c0f-a391-479a-b716-e3e0c757653b` | 2026-09-10 04:53:43 |

Production is [@davay_vmeste_bot](https://t.me/davay_vmeste_bot), served by
`collaboration-bot-production.castors-suburb-2h.workers.dev`; staging remains
`collaboration-bot-staging.castors-suburb-2h.workers.dev`.
Both final primaries report schema 15, 22 canonical tables and zero product rows,
with validated digest
`760b36d30518cf718134d2ae3ab8ae0ea46b2b2723c5edb1653d4a3b7b92314d`.
The production pre-release export was schema 13/17tables/zero rows with digest
`dfede19847301092c861e371e771318c0251fb13bc7d74853f90afdc40c998c5`.
Retained staging rehearsal/local snapshots are outside this release's migration scope.

Both environments pass health, protected readiness, verified bot identity,
publication capability and quiescent delivery checks. Both expose exactly the
four expected secret names, no `RESET_*` binding, `STATE_IMPORT_ENABLED=false`
and `MFM_FEATURE_ENABLED=true`. Unauthenticated export returns 401; reset route404.
Production additionally has `alarm=null`, a PITR bookmark, unchanged exact webhook,
zero pending updates/no last error and the original webhook secret. An authenticated
invalid payload returns 400 while an unauthenticated one returns 401; neither reaches
DO update dispatch or generates a Telegram message.

## Procedure and preservation

The release gate passed with Node 24.18.0, pnpm 11.15.1 and Wrangler 4.127.0:
`pnpm check` (249 tests plus lint/architecture/typecheck/build),
`pnpm test:e2e:fake` (43), `pnpm test:cloudflare` (38), `pnpm db:verify`,
`pnpm cloudflare:typecheck`, `pnpm cloudflare:types:check` and
`pnpm cloudflare:migrations:check`. Independent critical review found no blocker.

The inspected normal Worker bundle is 841.57KiB (155.15KiB gzip), using the
existing compatibility date 2026-08-28 and `CollaborationBotState` SQLite binding.
Staging precedes production. The effective deployment command is:

```sh
WRANGLER_WRITE_LOGS=false pnpm exec wrangler deploy \
  --env <staging-or-production> --profile collab-bot \
  --strict --keep-vars=false --var MFM_FEATURE_ENABLED:true \
  --message '<AUTHORIZED_CHANGE_REFERENCE>'
```

Run the same command with `--dry-run` first. Inspect all declared environment
vars before using `--keep-vars=false`; this repository declares the complete
working set. Preserve the four existing secret bindings. For this release only,
staging also used `--secrets-file <PRIVATE_STAGING_OPERATIONS_JSON>` to replace
only its operations credential, whose local CF2 handoff had been removed.
Production reused all four existing credentials unchanged.

The first staging upload demonstrated that Cloudflare retained reset-era settings
from an earlier upload despite their absence in the active rollback version.
The final deployment uses the exact configured vars, then deletes only the unused
`RESET_AUTH_TOKEN` from the verified normal-code version. Script metadata stayed
identical across that secret deletion. All final `RESET_*` bindings must be absent;
normal `/ops/reset/inspect` returns 404. Do not deploy `src/reset-worker.ts`.

Migrations 14/15 run through the canonical runner when the DO is instantiated.
Protected export proves schema 15 and the 22-table allowlist, migration history,
foreign keys and recomputed per-table/manifest digests. Compare preexisting row
values across shared columns: adding columns/tables changes the complete digest.
There is no reset, import, restore or migration of retained local databases in this release.

## Verification limits and private handoff

Cloudflare health/readiness and protected state checks are live evidence. The
330 passing tests cover local, fake Telegram and local workerd journeys; this
release does not claim a new real Telegram user journey and sends no test messages.
Production Telegram `getWebhookInfo` is checked through its existing private token.
Staging preserves its Telegram secrets and verifies bot identity through readiness;
a fresh staging `getWebhookInfo` is unavailable without its removed local token.

API usage inspection covers bounded last 24h Worker requests/errors: before the
release production32/staging23; afterward production45/staging29; errors0 throughout. The existing
Wrangler OAuth profile can read Workers account settings (`standard`) and usage,
but the billing subscriptions endpoint denies access (code 10000). The historical
Free-plan confirmation remains in CF3; this release does not claim a newly verified
bill or change billing/resources. No quota/error signal was observed.

Raw metadata, exports and PITR bookmarks stay outside Git in private files.
The owner-only handoff is
`~/Library/Application Support/CollaborationBot/mfmr-release-20260910/`;
`staging-operations.json` contains only its replacement operations credential.
Production continues to use its existing CF3 private handoff. Never print these
credentials or raw exports. Operator outputs contain counts, hashes and version IDs.

## Feature shutdown and rollback boundary

The repository defaults remain `MFM_FEATURE_ENABLED=false`; the release uses an
explicit override. A future authorized feature shutdown deploys schema 15-compatible
code with `--var MFM_FEATURE_ENABLED:false`, retaining completed MFM profiles and
drafts. Re-run health/readiness, state preservation and webhook checks afterward.

Do not roll back to the pre-release schema 13 versions: their migration runner
rejects schema 15 history. Worker rollback does not rewind SQLite. PITR/restore,
import, database reset and polling failover require their own incident authorization
and reconciliation; none is part of this release. See the official
[Wrangler Workers commands](https://developers.cloudflare.com/workers/wrangler/commands/workers/)
for deploy/secret semantics and the [CF3 runbook](CF3_PRODUCTION_RUNBOOK.md)
for protected operations.
