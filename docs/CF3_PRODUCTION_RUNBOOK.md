# CF3 production operations runbook

This runbook describes the deployed Cloudflare production topology and its
safe operating boundary. It does not authorize a deploy, rollback, state
import, webhook change, `/ops/ready`, billing change, resource deletion, bot
link distribution, Git push, PR or merge. Each of those remains a separate
explicitly authorized action.

Cloudflare Workers Free is a best-effort hosting tier, not an availability or
delivery guarantee. Telegram webhook retries, Durable Object idempotency and
PITR reduce specific risks; they do not create an SLA or prove that every
update will be delivered during a platform or quota failure.

## Fixed production topology

The production topology recorded at the CF3 handoff is:

| Item | Exact value |
|---|---|
| Cloudflare account | `643464cda99dd9fb036367674d42a62c` |
| Worker | `collaboration-bot-production` |
| Active deployment | `61b828fb-cadd-4ddb-bb73-1ce2e6d46f6a` |
| Active version | `7408355f-5fe3-4fcb-8cf4-d07181ed21e7` at 100% |
| Public URL | `https://collaboration-bot-production.castors-suburb-2h.workers.dev` |
| Webhook URL | `https://collaboration-bot-production.castors-suburb-2h.workers.dev/telegram/webhook` |
| Exposure | workers.dev only; preview URLs, routes and custom domains absent |
| Durable Object binding | `COLLABORATION_STATE` |
| Durable Object class | `CollaborationBotState`, SQLite storage |
| Durable Object namespace | `942002e61f4b4f68ad56bb780ea0e74a` |
| Production object | fixed name `collaboration-bot-primary` |
| Import switch | `STATE_IMPORT_ENABLED=false` |
| Bot identity | `@davay_vmeste_bot`; numeric ID verified privately |
| Showcase identity | `@davay_vmeste_collab`; numeric ID verified privately |
| Required secret names | `BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `OPERATIONS_TOKEN`, `ADMIN_TELEGRAM_IDS` |

The bot identity, showcase identity and bot administrator rights to post, edit
and delete showcase messages were exact at handoff. Secret values, private
Telegram identities and state-transfer rows are deliberately absent from this
document.

### Read-only handoff snapshot

At `2026-08-30T00:23:05Z` the bounded production inspection proved:

- `/health/live` returned HTTP 200;
- the canonical export was transfer version 1, schema version 13, 17 product
  tables, 312 rows and digest
  `e602c0e8515e2e56a6fc1ac0b3f3409e62428d527d273f03bde2c0a1e41dc300`;
- 128 completed command receipts equalled 128 processed updates;
- all 17 outbox deliveries were `sent`, with zero nonterminal deliveries and
  zero unresolved delivery incidents;
- the fixed object's alarm was `null` and its PITR bookmark was non-empty;
- Telegram named the exact workers.dev webhook, with zero pending updates,
  `max_connections=1`, allowed updates `message` and `callback_query`, no last
  error and no custom certificate;
- the Cloudflare dashboard showed the current plan as Free and current cost as
  `$0`.

The dashboard counters observed in that same snapshot were:

| Counter | Observed value |
|---|---:|
| Workers requests today | `31 / 100,000` |
| Workers CPU | `195 ms` |
| Production Durable Object requests | `32` |
| Production Durable Object errors | `0` |
| Production Durable Object duration | `0.161 GB-s` |
| Account SQL rows read | `4.53k` |
| Account SQL rows written | `146` |
| Account total SQL storage | `360.45 kB` |

Dashboard counters can use different aggregation windows, lag behind requests
or reset. Treat every recorded value as timestamped evidence, not a permanent
baseline or an arithmetic reconciliation between panels.

## Private material and privacy boundary

Keep the owner handoff directory outside Git with directory mode `0700`; every
token, manifest, PITR bookmark and raw tail file must be a regular file with
mode `0600`. Use a private helper that reads values from those files. Never put
a token in argv, shell history, a URL printed by a command, a log filter,
documentation, test fixture or Git evidence.

Protected production routes require the operations bearer token. Write raw
responses directly to new private files, then report only HTTP status, fixed
metadata, counts and digests. Do not print or search a minified manifest: its
rows may contain user-authored text and identifiers. A PITR bookmark is also
private and should be reported only as present or absent.

If any secret, authorization header, raw Telegram update, user-authored text,
private deep-link token, manifest row, bookmark or private contact appears in
shared output, stop. Preserve the private evidence, restrict access, assess
exposure and obtain a separate authorization before rotation or remediation.

## Routine read-only checks

Run from the repository root and compare every result with the fixed topology:

```sh
git status --short
node --version
pnpm --version
pnpm exec wrangler --version
WRANGLER_WRITE_LOGS=false pnpm exec wrangler whoami --json
WRANGLER_WRITE_LOGS=false pnpm exec wrangler deployments status --env production --profile collab-bot --json
WRANGLER_WRITE_LOGS=false pnpm exec wrangler versions list --env production --profile collab-bot --json
WRANGLER_WRITE_LOGS=false pnpm exec wrangler versions view <ACTIVE_VERSION_ID> --env production --profile collab-bot --json
WRANGLER_WRITE_LOGS=false pnpm exec wrangler secret list --env production --profile collab-bot --format json
curl -fsS https://collaboration-bot-production.castors-suburb-2h.workers.dev/health/live
```

`whoami` uses the Wrangler auth profile already activated for this repository;
Wrangler 4.127.0 does not accept `--profile` on that command. Confirm that its
JSON names the fixed account before running the subsequent explicitly profiled
commands. These commands are observations only. Re-resolve the active
deployment and version every time; the IDs in this document become historical
after any authorized deployment. Raw Wrangler identity/deployment JSON may
include the Cloudflare account email; keep it in the owner's terminal/private
handoff and copy only the required deployment/version fields into shared
evidence.

Use the private helper for:

- Telegram `getMe`, `getChat`, `getChatMember` and `getWebhookInfo`;
- authenticated `GET /ops/state/export`;
- authenticated `GET /ops/pitr/bookmark`;
- authenticated `GET /ops/alarm`.

`/ops/ready` is not a routine read-only check. It can refresh Telegram
preflight data and change alarm scheduling. Do not call it without a separately
reviewed reason and proof that no delivery can be dispatched unexpectedly.

Stop on a wrong account, Worker, deployment, version, workers.dev host,
binding, class, object name, secret-name set, bot/channel identity, webhook
configuration, schema, digest or import switch. Also stop on a nonterminal
outbox row, unresolved incident, unexpected alarm, pending/error webhook state,
health failure, secret exposure or quota/cost ambiguity.

## Data Studio

Open the exact production namespace, then the fixed
`collaboration-bot-primary` object. Data Studio acts on the deployed object and
consumes Durable Object request, duration and SQL-row usage. In this runbook it
is strictly `SELECT` only: no `INSERT`, `UPDATE`, `DELETE`, DDL, console reset
or object deletion.

Use the smallest queries needed:

```sql
SELECT status, COUNT(*) AS count
FROM outbox_deliveries
GROUP BY status
ORDER BY status;

SELECT status, COUNT(*) AS count
FROM command_receipts
GROUP BY status
ORDER BY status;

SELECT COUNT(*) AS count FROM processed_updates;
SELECT COUNT(*) AS count FROM __app_migrations;
```

`prepared`, `dispatching` and `retryable_failed` are nonterminal stop
conditions. `ambiguous` and `permanent_failed` require incident investigation
before any deploy, webhook change or user action. Do not open broad user tables
when aggregate status evidence is sufficient.

See Cloudflare's official [Durable Objects Data Studio](https://developers.cloudflare.com/durable-objects/observability/data-studio/)
documentation.

## Real-time logs

Tie every bounded tail to the currently verified production version and stop
it as soon as the intended probe is complete:

```sh
WRANGLER_WRITE_LOGS=false pnpm exec wrangler tail \
  --env production \
  --profile collab-bot \
  --version-id <VERIFIED_ACTIVE_VERSION_ID> \
  --format json
```

`wrangler tail --format json` can emit pretty-printed, multiline events.
Fetches and scheduled invocations can also arrive concurrently, so line-level
writers or sanitizers may interleave records. Do not treat each line as a JSON
object. Capture the raw stream only in a private mode-0600 file and use a
record-aware parser that proves complete object boundaries before extracting a
small marker-only aggregate. If framing cannot be proved, fail closed and do
not use the parse as evidence.

Real-time logs can sample and drop events at higher traffic and are not stored
by this facility. The repository does not configure a persistent Workers Logs,
Logpush or Tail Worker sink, so this runbook makes no historical-log retention
claim. See the official [real-time logs and `wrangler tail`](https://developers.cloudflare.com/workers/observability/logs/real-time-logs/)
documentation.

## Local development and legacy SQLite

Local development uses `pnpm cloudflare:dev` and, when real Telegram input is
separately authorized, `pnpm cloudflare:relay` as described in
[`CF1_LOCAL_RUNBOOK.md`](./CF1_LOCAL_RUNBOOK.md). The relay may use only a
separate development bot token whose webhook is not active. Never give it the
production token, and never run `getUpdates` and a webhook for the same token
at the same time. A staging token with an active staging webhook is not an
available relay token unless a separate webhook change is authorized first.

The frozen source SQLite and immutable CF3-00 snapshot predate real production
updates and Telegram effects. They are retained as historical migration and
audit evidence, but they are stale and are not an automatic production
failover. Never start the legacy polling process against the production token.
Any rollback to polling first requires a separately authorized webhook removal,
remote export and explicit state/effect reconciliation.

## Safe deployment procedure

The commands in this section document a future procedure; they are not present
authorization to run a live deployment.

Before a dry run, verify the exact account, active deployment/version, webhook,
secret names, configuration, health, export/schema/digest, terminal outbox,
zero incidents, `alarm=null`, PITR presence and current Free usage. Then run the
repository gates under the declared Node, pnpm and Wrangler contracts:

```sh
pnpm check
pnpm test:e2e:fake
WRANGLER_WRITE_LOGS=false pnpm test:cloudflare
pnpm db:verify
pnpm cloudflare:typecheck
WRANGLER_WRITE_LOGS=false pnpm cloudflare:types:check
pnpm cloudflare:migrations:check
WRANGLER_WRITE_LOGS=false pnpm exec wrangler deploy \
  --env production \
  --profile collab-bot \
  --strict \
  --dry-run \
  --secrets-file <PRIVATE_MODE_0600_JSON>
```

Inspect the dry-run bindings, vars, compatibility date, Durable Object class
and four secret bindings. It must preserve `STATE_IMPORT_ENABLED=false`, the
fixed SQLite binding and workers.dev-only topology.

Only after a separate live-deploy authorization may the same inspected command
run without `--dry-run` and with an auditable message:

```sh
WRANGLER_WRITE_LOGS=false pnpm exec wrangler deploy \
  --env production \
  --profile collab-bot \
  --strict \
  --secrets-file <PRIVATE_MODE_0600_JSON> \
  --message '<AUTHORIZED_CHANGE_REFERENCE>'
```

Afterward, re-resolve deployment/version and verify health, exact webhook,
export/schema/digest, outbox/incidents, alarm, PITR presence and usage. A code
deployment normally preserves Durable Object storage, but code, bindings,
compatibility behavior and the active version have changed and must be checked
as a new boundary.

## Worker rollback

A rollback candidate is never pre-approved. Inspect the current deployment and
candidate code/config first:

```sh
WRANGLER_WRITE_LOGS=false pnpm exec wrangler deployments status --env production --profile collab-bot --json
WRANGLER_WRITE_LOGS=false pnpm exec wrangler versions list --env production --profile collab-bot --json
WRANGLER_WRITE_LOGS=false pnpm exec wrangler versions view <CANDIDATE_VERSION_ID> --env production --profile collab-bot --json
```

Require compatibility with the current schema, binding, SQLite-backed Durable
Object class lifecycle, secrets/config contract, webhook routes and protected
operations surface. Import-enabled bootstrap code and a version missing a
required production inspection route are not safe defaults.

Only a separately authorized incident may run the mutation:

```sh
WRANGLER_WRITE_LOGS=false pnpm exec wrangler rollback <INSPECTED_VERSION_ID> \
  --env production \
  --profile collab-bot \
  --message '<INCIDENT_REFERENCE>'
```

Rollback immediately changes active code. It does not rewind Durable Object
SQLite, restore a PITR bookmark, undo Telegram messages or reconcile already
sent effects. Re-run the complete read-only post-deploy verification afterward.
See Cloudflare's official [Workers versions and deployments](https://developers.cloudflare.com/workers/versions-and-deployments/),
[rollbacks](https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/)
and [Wrangler Workers commands](https://developers.cloudflare.com/workers/wrangler/commands/workers/).

## Export, import and PITR

Export the fixed primary only through the protected route and private helper
into a new mode-0600 file. Validate transfer version 1, schema version 13, the
17-table allowlist, every table count/digest, total row count and overall
digest without printing rows. Migration history, preflight cache and import
audit are target-local operational state and are not part of the canonical
17-table transfer digest.

Production import is sealed off with `STATE_IMPORT_ENABLED=false`; a probe must
fail closed before forwarding. Do not enable import for routine operations and
never import into the current non-empty primary. A restore/import needs a new
incident plan with an exact target, pre-operation export and PITR bookmark,
schema/config compatibility proof, Telegram-effect reconciliation, separate
authorization and post-operation verification.

A non-empty PITR bookmark proves that the API returned a current recovery
point; it does not prove a restore, an independent backup or an availability
guarantee. Cloudflare currently documents PITR for the previous 30 days. A real
restore changes the whole object's SQL and KV state, is completed on object
restart and returns an undo bookmark; none of those actions are routine CF3
operations. See the official [SQLite Durable Object storage and PITR API](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/).

## Telegram webhook incident boundary

Webhook mutation always needs separate authorization. If removal is approved,
use a private helper because the bot token is part of the Bot API URL:

1. Stop operator and smoke activity; inspect in-flight webhook/alarm/outbox
   state.
2. Call `deleteWebhook` exactly once with `drop_pending_updates=false`.
3. Verify through `getWebhookInfo` that the URL is empty and record the pending
   count; never discard pending updates as a shortcut.
4. Export remote state and reconcile every remote mutation and Telegram effect.
5. Do not start polling from the stale source SQLite. A new authoritative state
   decision is required before any polling process can start.

There is no automatic polling fallback and no authorization here to call
`setWebhook`, `deleteWebhook` or distribute the bot link.

## Free quota and failure behavior

Cloudflare's current official sources are the [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/)
and [limits](https://developers.cloudflare.com/workers/platform/limits/) pages
plus Durable Objects [pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/)
and [limits](https://developers.cloudflare.com/durable-objects/platform/limits/).
Those pages, not copied numbers in this repository, are authoritative if the
service changes.

At this handoff the relevant published Free allowances include 100,000 Worker
requests per day, 10 ms CPU per invocation, 100,000 Durable Object requests and
13,000 GB-s per day, plus 5 million SQL rows read, 100,000 rows written per day
and 5 GB total SQLite storage. Capture a new timestamped Dashboard snapshot
before any future authorized production change.

The zero-mandatory-cost policy fails closed:

- do not enable billing, upgrade the plan or add paid resources automatically;
- if a quota is exhausted, near an unsafe boundary or its behavior is unclear,
  stop operator activity and deployment work;
- leave the webhook configured and never drop pending Telegram updates merely
  to recover; Telegram may receive non-2xx responses/timeouts and retry;
- inspect health, tail, export, outbox/incidents and alarm without using
  `/ops/ready`, then wait for the applicable reset or obtain a separate
  recovery decision;
- after a Worker or storage error, do not assume that a transaction or Telegram
  effect committed; prove remote state and delivery outcome after recovery;
- expect idempotency to suppress proven replay after an update reaches the
  Durable Object, but do not treat it as guaranteed ingress or delivery during
  quota/platform failure.

Do not broadly distribute the bot link while Free capacity and failure behavior
remain the operating constraint.

## Retention and deletion

Until a separate explicit retention/deletion decision, retain without automatic
expiry:

- the original source SQLite files and immutable CF3-00 freeze;
- the private production handoff, manifests, bookmarks and required evidence;
- the staging Worker, namespace and fixed staging rehearsal evidence.

This operator retention policy does not extend Cloudflare's own PITR window,
guarantee provider-side log retention or make the stale SQLite authoritative.
Do not prune, overwrite, reset, restore or delete any retained artifact or
remote resource under this runbook. A future deletion, secret rotation, staging
cleanup, webhook change, billing change, deploy, rollback, import, push or bot
link distribution requires its own exact scope and authorization.
