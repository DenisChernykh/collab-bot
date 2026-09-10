# One-time MFM project database reset

PRD MFM-F06 explicitly authorizes this operation for this project only. It supersedes the older CF2/CF3 retention prohibition for these databases. Feature release and Git push remain separate. Execute MFM-08 only after the MFM-07 tests and independent critical review pass.

Targets: the existing `collaboration-bot-production` and `collaboration-bot-staging` Workers in account `643464cda99dd9fb036367674d42a62c`; their fixed `collaboration-bot-primary` objects; staging's fixed `collaboration-bot-cf2-03-rehearsal`; `.runtime/app.sqlite`, `.runtime/app.pre-s4-01-20260827T172913.sqlite`, and the project's retained CF3 `authoritative.sqlite` snapshot under the owner's CollaborationBot application-support directory. Verify the current binding/namespace/object IDs, deployed version and every real local path. Do not address arbitrary object names or other projects. Enumerate any further project SQLite files before execution.

The reset preserves schema, migration checksums, indexes and triggers. It clears existing allowlisted product/service tables, including MFM data if present. It does not apply migration 15 to legacy live databases. A small `mfm_reset_audit` row retains only operation ID, target, counts, digests and time. An exact retry returns that result, even if new data later exists; a second operation ID is refused. This is a logical reset, not forensic erasure of Cloudflare PITR or private JSON evidence. Existing Telegram messages are outside scope.

## Preflight and maintenance

1. Inspect exact current deployments and namespace binding. Keep raw provider output and credentials in mode-0600 files outside Git; report only versions, IDs, counts and digests. Do not print raw state exports or Telegram data.
2. Confirm no local polling process, LaunchAgent or DB holder. Inspect live outbox/receipt aggregates without invoking `/ops/ready`. Zero nonterminal/ambiguous deliveries and in-progress receipts are required. Capture only necessary private recovery evidence; do not create another SQLite database copy.
3. Build and dry-run the temporary entrypoint. It contains no bot application, migration runner, update handler or delivery runner. The normal `src/worker.ts` does not expose reset routes.
4. For each existing hosted Worker, record the exact previous version at 100%, then temporarily deploy `src/reset-worker.ts` with `RESET_OPERATION_ID=mfm-2026-reset`. Keep existing vars/secrets. Where the original operations token is unavailable, generate an owner-only temporary JSON secrets file containing only `RESET_AUTH_TOKEN` and pass it using `--secrets-file`; never place values in argv. It applies only to this maintenance entrypoint. Restore the recorded version afterward so the temporary token and reset routes are absent from the active version.
5. Maintenance returns 503 to webhook ingress and never sends Telegram messages. Its authenticated `GET /ops/reset/webhook-state` performs only `getMe` and `getWebhookInfo`, returning booleans/counts. Require the exact bot/webhook and zero pending updates before reset and immediately before restoring service. Keep an idle window of at least 60 seconds after replacement of the old runtime; if ingress/delivery remains non-quiescent, stop without resetting.

Example commands (replace only inspected, non-secret placeholders):

```sh
WRANGLER_WRITE_LOGS=false pnpm exec wrangler deploy src/reset-worker.ts --env staging --dry-run --outdir /tmp/mfm-reset-bundle --var RESET_OPERATION_ID:mfm-2026-reset --keep-vars
WRANGLER_WRITE_LOGS=false pnpm exec wrangler deploy src/reset-worker.ts --env <verified-environment> --profile collab-bot --var RESET_OPERATION_ID:mfm-2026-reset --keep-vars --secrets-file <private-temporary-secrets-json>
```

## Exact reset and verification

Use a private authenticated helper. `GET /ops/reset/inspect` returns the actual `<environment>:<object-id>`, schema version/hash, table counts, data digest and quiescence. Staging rehearsal uses `/ops/reset/rehearsal/inspect`. There is no public export or arbitrary SQL endpoint.

POST `/ops/reset/apply` (or staging `/ops/reset/rehearsal/apply`) with exactly the inspected target, operation ID and expected digest. Request JSON is limited to 2048 bytes. A mismatch, active alarm, nonterminal delivery, unknown table or invalid migration prefix prevents deletion. Both append-only DELETE guards are suspended and restored within the same transaction; an injected error rolls back all deletes and trigger changes. SQLite FK checks and schema equality must pass. Cloudflare does not expose `PRAGMA integrity_check`; the local CLI additionally runs it.

Immediately inspect again: all product/service counts must be zero and the schema hash unchanged. Repeat the identical POST once to verify the durable result without performing another deletion. Capture the summary, not rows. Confirm zero Telegram pending updates, then restore the previously inspected Worker version. This is a code rollback only; it does not restore data. Verify ordinary health, absence of the reset route, unchanged webhook identity and expected active version. Do not call `/ops/ready` or create a real user journey as part of the reset.

```sh
WRANGLER_WRITE_LOGS=false pnpm exec wrangler rollback <inspected-previous-version> --env <verified-environment> --profile collab-bot --message 'Restore runtime after authorized MFM database reset'
```

For local SQLite, after proving no holders and inspecting the exact real path:

```sh
pnpm build
node dist/cli/project-reset.js inspect <verified-existing-database>
node dist/cli/project-reset.js apply <verified-existing-database> <private-request-json>
```

The local request uses `local:<resolved-absolute-path>` plus the inspection digest. A missing DB is never created. Restore owner-only permissions after clearing an immutable snapshot, and mark its former recovery checksum/summary as superseded in a private note; never present it as a usable pre-reset backup. Recheck integrity, zero rows, migration history and zero holders. Leave polling stopped. Historical private JSON manifests remain outside the requested database reset and must not be re-imported.

Record exact targets, before/after counts and digests, helper/returned deployment versions, checks and any remaining limitation in MFM-08 evidence. No credentials, raw profiles, contacts or update bodies belong in Git. MFM remains default-off until its separately authorized release.
