# CF2 hosted staging operations runbook

> 2026-09-10 update: PRD MFM-F06 separately authorized the project database reset, now completed. The existing hosted code version was restored afterward; historical row counts, freeze checksums and pre-reset recovery claims below are timestamped history. Use the [MFM reset record](MFM_RESET_RUNBOOK.md) for current data state. MFM application release remains separate.

CF2 proves one hosted **staging** candidate on a confirmed Cloudflare Free
account. It does not authorize or establish a production deployment, a
production Telegram webhook, a production data import, paid resources, or a
production rollback. Those actions begin only with separately authorized
CF3 units. CF2-03 also never restores or deletes a Durable Object and never
removes, resets or replaces the staging Telegram webhook.

## Fixed topology and hard boundary

The staging Worker has one Durable Object namespace and two deliberately
different object identities:

- `collaboration-bot-primary` is the staging dev-bot singleton. The webhook,
  readiness check and alarm-driven outbox use only this object.
- `collaboration-bot-cf2-03-rehearsal` is the single fixed CF2-03 rehearsal
  object. Only the staging-gated, operations-token-protected rehearsal
  import/export and PITR-bookmark routes address it.

The rehearsal object has no webhook, update, readiness or alarm activation
route. An operator cannot select an arbitrary object name. Do not create a
replacement name when the fixed object is non-empty, and do not delete or
reset it to repeat the rehearsal: stop and investigate. The imported object is
retained as CF2 evidence and consumes a small amount of Durable Object storage
until a separately authorized cleanup.

The protected rehearsal surface is:

| Method | Route | Purpose |
|---|---|---|
| `POST` | `/ops/rehearsal/state/import` | One-shot canonical import into the fixed object |
| `GET` | `/ops/rehearsal/state/export` | Canonical logical export from the fixed object |
| `GET` | `/ops/rehearsal/pitr/bookmark` | Capture the current SQLite PITR bookmark |

Every route requires `Authorization: Bearer <OPERATIONS_TOKEN>` and exact
`DEPLOYMENT_ENVIRONMENT=staging`. Default and production environments fail
closed. The ordinary `/ops/state/*` routes continue to address only the
primary singleton; `STATE_IMPORT_ENABLED=false` continues to disable primary
import.

## Private material

Keep the operations token, Telegram token, state-transfer manifest and PITR
bookmark outside the repository in regular files with mode `0600`. Use a
private helper that reads those files and writes response bodies directly to
private files. Never paste a token into shell history, print a raw manifest or
bookmark, include one in a log filter, or save one in Git evidence.

The snippets below intentionally contain placeholders. Replace them only
inside the private helper, not in committed scripts or copied terminal output.

## Preflight before any staging mutation

From the repository root, first verify the local candidate and the exact
remote target:

```sh
git status --short
node --version
pnpm --version
pnpm exec wrangler --version
pnpm exec wrangler whoami
pnpm exec wrangler deployments status --env staging
pnpm exec wrangler versions list --env staging
pnpm exec wrangler secret list --env staging --format json
curl -fsS https://<STAGING_WORKER_HOST>/health/live
```

Then use the private helper for the protected checks and Telegram
`getWebhookInfo`. Stop unless all of the following are true:

- the active Wrangler profile resolves to the repository-bound Free account;
- the Worker name, account, deployment, version, workers.dev host, Durable
  Object binding and four expected secret **names** are exact:
  `BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `OPERATIONS_TOKEN` and
  `ADMIN_TELEGRAM_IDS`;
- no custom domain, production Worker, production bot/channel or production
  data is in scope;
- `/health/live` is HTTP 200 for `cloudflare`/`staging`, `/ops/ready` is HTTP
  200 with verified bot identity and publish capability, and the Durable Object
  class is exact;
- `getWebhookInfo` names the exact staging route and allowed update set, with
  zero pending updates and no last error;
- the primary export has the expected transfer/schema versions and all 17
  canonical product tables;
- a read-only query shows no nonterminal primary outbox delivery and no
  unresolved delivery incident;
- the Cloudflare dashboard still shows `Free` and `$0`, with enough Workers,
  Durable Objects, SQL rows and storage allowance for the bounded rehearsal.

For outbox inspection, run only this read-only query against the exact primary
object in Durable Objects Data Studio:

```sql
SELECT status, COUNT(*) AS count
FROM outbox_deliveries
GROUP BY status
ORDER BY status;
```

`prepared`, `dispatching` and `retryable_failed` are nonterminal. Any count in
those states is a stop condition. Treat `ambiguous` or `permanent_failed` as an
incident that must be understood before proceeding even though the runner does
not automatically retry it.

## One-shot state-transfer rehearsal

1. Export the primary singleton through `/ops/state/export` into a new private
   mode-0600 file. Verify transfer version, schema version, 17-table allowlist,
   table counts, per-table digests and overall digest without printing rows.
2. Before import, export the fixed rehearsal object. It must contain exactly
   the same 17-table schema with zero product rows. In Data Studio, verify that
   its `cf1_state_import_audit` count is zero. If either condition fails, stop;
   do not delete the object and do not choose another name.
3. Capture the pre-import PITR bookmark as described below.
4. POST the private source file to `/ops/rehearsal/state/import` with JSON
   content type. The response must report success without returning source
   rows.
5. Export the rehearsal object to a second private mode-0600 file. A private
   comparison must prove equal transfer/schema versions, table allowlist,
   every table count and digest, total row count and overall digest.
6. Repeat the exact import once. It must return HTTP 409. Export again and
   prove that the digest and counts did not change.
7. Verify one import-audit row, zero nonterminal outbox rows, no alarm-driven
   delivery, no Telegram effect, and an unchanged primary export digest.
8. Capture the post-import PITR bookmark, recheck primary health/readiness,
   webhook info and Free usage, then remove temporary local manifest/bookmark
   copies that are no longer required. Do not delete the remote rehearsal
   object.

Conceptual placeholder requests for steps 4 and 5 are shown only to make the
HTTP contract unambiguous:

```sh
curl --fail-with-body --silent --show-error \
  --request POST \
  --header 'Authorization: Bearer <OPERATIONS_TOKEN_FROM_PRIVATE_FILE>' \
  --header 'Content-Type: application/json' \
  --data-binary @"$PRIVATE_SOURCE_MANIFEST_PATH" \
  https://<STAGING_WORKER_HOST>/ops/rehearsal/state/import

curl --fail-with-body --silent --show-error \
  --header 'Authorization: Bearer <OPERATIONS_TOKEN_FROM_PRIVATE_FILE>' \
  https://<STAGING_WORKER_HOST>/ops/rehearsal/state/export \
  > "$PRIVATE_REHEARSAL_MANIFEST_PATH"
```

Logical parity covers only the 17 canonical product tables. Migration history,
preflight cache and import audit are target-local operational state and are
intentionally excluded from the transfer digest.

## PITR bookmark boundary

SQLite-backed Durable Objects retain point-in-time recovery history and expose
bookmark APIs. CF2-03 captures bookmarks only from the fixed rehearsal object:

```sh
curl --fail-with-body --silent --show-error \
  --header 'Authorization: Bearer <OPERATIONS_TOKEN_FROM_PRIVATE_FILE>' \
  https://<STAGING_WORKER_HOST>/ops/rehearsal/pitr/bookmark \
  > "$PRIVATE_PITR_BOOKMARK_PATH"
```

Verify only that the hosted response is successful and the bookmark is
non-empty; do not print or commit it. This route never invokes restore,
restart or object deletion. A real restore requires a separately authorized
incident procedure, a chosen target bookmark, a next-session restore request,
an object restart, and verification of the returned undo bookmark. Never
rehearse that sequence on the primary object during CF2. See Cloudflare's
[SQLite Durable Object storage and PITR API](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/).

## Logs, Data Studio and Free usage

Use a bounded tail tied to the verified deployed version, perform only a safe
health/export/bookmark probe, and stop the tail immediately:

```sh
pnpm exec wrangler tail --env staging \
  --version-id <VERIFIED_DEPLOYED_VERSION_ID> \
  --format json
```

Expected evidence is request method/path, version and successful outcome. Stop
if logs contain a secret, an unredacted authorization value, raw update,
user-authored text, manifest, bookmark or private contact. Data Studio is
read-only for this unit:
`SELECT` is permitted against the exact primary or fixed rehearsal object;
`INSERT`, `UPDATE`, `DELETE`, schema changes, console resets and object deletion
are not.

Before and after the rehearsal, record the dashboard's current plan name/cost
and bounded usage counters without changing billing. If the account is not
Free, a quota is exhausted or near an unsafe boundary, cost behavior is
unclear, or the UI offers an upgrade as the only continuation, stop. CF2 is
fail-closed at zero mandatory Cloudflare cost.

## Worker version rollback is not storage rollback

Identify a rollback candidate with both commands below and inspect it before
an incident. A previous version is acceptable only if its code, bindings,
Durable Object class lifecycle, secrets/config contract and current SQLite
schema are compatible:

```sh
pnpm exec wrangler deployments status --env <TARGET_ENVIRONMENT>
pnpm exec wrangler versions list --env <TARGET_ENVIRONMENT>
pnpm exec wrangler versions view <VERIFIED_PREVIOUS_VERSION_ID> --env <TARGET_ENVIRONMENT>
```

The exact mutation, reserved for separate incident authorization, is:

```sh
pnpm exec wrangler rollback <VERIFIED_PREVIOUS_VERSION_ID> \
  --env <TARGET_ENVIRONMENT> \
  --message '<INCIDENT_REFERENCE>'
```

A Worker rollback immediately changes the active code deployment. It does
**not** rewind Durable Object SQLite, delete rows, restore a PITR bookmark, undo
Telegram messages, or reconcile effects already sent. Storage resources are
not rolled back with Worker code, and some Durable Object class migrations can
make an older version ineligible. Verify post-rollback health, readiness,
deployment/version, logs, schema, outbox and webhook separately. Cloudflare's
authoritative references are [Workers versions and deployments](https://developers.cloudflare.com/workers/versions-and-deployments/),
[rollbacks](https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/)
and the [Wrangler command reference](https://developers.cloudflare.com/workers/wrangler/commands/workers/).

## Safe Telegram webhook rollback

This is the reviewed future CF3 incident sequence, not an action to execute in
CF2-03.

Never run long polling and a webhook for the same bot token concurrently. A
rollback from webhook ingress uses Telegram's exact
`deleteWebhook(drop_pending_updates=false)` semantics so queued updates are not
discarded. Invoke the Bot API through a private helper because the bot token is
part of the Bot API URL; do not paste or log that URL.

1. Stop new operator/user smoke actions and identify any in-flight webhook or
   alarm work.
2. Call `deleteWebhook` with `drop_pending_updates=false` exactly once.
3. Call `getWebhookInfo`; require an empty webhook URL, record the pending count
   and verify there is no continuing webhook delivery. Never use
   `drop_pending_updates=true` as a shortcut.
4. Export and compare remote state and inspect outbox/logs. If any remote
   business mutation or Telegram effect happened after the frozen SQLite
   snapshot, do **not** restart that stale SQLite. Stop and perform an explicit
   remote export/reconciliation procedure first.
5. Only when the remote state is proven equal to the recoverable frozen source
   and no Worker/DO work remains may the legacy Node process start. Recheck
   `getWebhookInfo` immediately before polling so webhook and polling never
   overlap. Preserved pending updates may then be consumed by the one
   authoritative ingress.

See Telegram's official [`deleteWebhook`](https://core.telegram.org/bots/api#deletewebhook)
and [`getWebhookInfo`](https://core.telegram.org/bots/api#getwebhookinfo)
contracts.

## CF3 production handoff

CF2 completion supplies a reviewed staging candidate and commands; it does not
start production work. The next unit is CF3-00 and requires separate
authorization for production downtime and stopping the authoritative local
polling process.

The production order is fixed:

1. CF3-00 gracefully stops local polling, proves no writer/WAL owner, preserves
   a recoverable SQLite copy and creates one verified private manifest.
2. CF3-01 deploys a traffic-free production Worker/DO and performs one-shot
   import plus logical parity checks while Telegram still has no webhook.
3. Before the first production `/ops/ready` call, inspect the imported outbox
   read-only. `prepared`, `dispatching` and `retryable_failed` must each be
   exactly zero. `/ops/ready` can schedule the DO alarm, so calling it earlier
   could send imported work before webhook cutover. Any unresolved
   `ambiguous`/`permanent_failed` delivery is also a stop-and-review condition.
4. Only after identity, showcase capability, schema, digests, PITR bookmark,
   usage and zero-send-risk checks pass may CF3-02 set the production webhook
   with `drop_pending_updates=false` and run the separately authorized bounded
   smoke.
5. After any remote mutation or Telegram effect, rollback requires
   reconciliation; a code-version rollback or stale-SQLite restart alone is
   insufficient.

Stop CF3 for any wrong account/profile/version/identity/channel, non-empty
target, schema or digest mismatch, nonterminal outbox work, unexpected alarm or
Telegram effect, webhook retry/pending ambiguity, secret/private-data exposure,
quota/cost risk, production resource drift, or need for destructive cleanup.
