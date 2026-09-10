# One-time MFM project database reset

PRD MFM-F06 explicitly authorizes this operation for this project only. It supersedes the older CF2/CF3 retention prohibition for these databases. Feature release and Git push remain separate. Execute MFM-08 only after the MFM-07 tests and independent critical review pass.

Targets: the existing `collaboration-bot-production` and `collaboration-bot-staging` Workers in account `643464cda99dd9fb036367674d42a62c`; their fixed `collaboration-bot-primary` objects; staging's fixed `collaboration-bot-cf2-03-rehearsal`; `.runtime/app.sqlite`, `.runtime/app.pre-s4-01-20260827T172913.sqlite`, and the project's retained CF3 `authoritative.sqlite` snapshot under the owner's CollaborationBot application-support directory. Verify the current binding/namespace/object IDs, deployed version and every real local path. Do not address arbitrary object names or other projects. Enumerate any further project SQLite files before execution.

The reset preserves schema, migration checksums, indexes and triggers. Cloudflare’s internal `_cf_METADATA` table is recognized but its rows are never queried or deleted ([workerd source](https://github.com/cloudflare/workerd/blob/main/src/workerd/util/sqlite-metadata.h)); its presence is covered by an alarm-created local workerd regression. Unknown application tables still fail closed. It clears existing allowlisted product/service tables, including MFM data if present. It does not apply migration 15 to legacy live databases. A small `mfm_reset_audit` row retains only operation ID, target, counts, digests and time. An exact retry returns that result, even if new data later exists; a second operation ID is refused. This is a logical reset, not forensic erasure of Cloudflare PITR or private JSON evidence. Existing Telegram messages are outside scope.

## Preflight and maintenance

1. Inspect exact current deployments and namespace binding. Keep raw provider output and credentials in mode-0600 files outside Git; report only versions, IDs, counts and digests. Do not print raw state exports or Telegram data.
2. Confirm no local polling process, LaunchAgent or DB holder. Inspect live outbox/receipt aggregates without invoking `/ops/ready`. Zero nonterminal/ambiguous deliveries and in-progress receipts are required. Capture only necessary private recovery evidence; do not create another SQLite database copy. If the old operations-token handoff was deliberately disposed of (as recorded for staging), install the maintenance helper first, then perform these aggregate checks after the idle window and before any reset. The helper cannot deliver effects and refuses non-quiescent data; this changes only inspection order.
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

## MFM-08 execution record — 2026-09-10

All six inspected project databases were logically cleared with operation `mfm-2026-reset`. Product and auxiliary table counts after each reset were zero; the schema and history were preserved. The operator-result row and Cloudflare-owned metadata remain. Exact retries returned the original result.

- **production primary**, schema 13, 332 → 0 rows. Target: `production:7c3fd71a1bfba2be912e976e9855b4a0193c291fdf26c07437599a75bdf6961e`. Before: `e9472059e009ec20f9e6050b6b4c6a46a0f353b5b947ddfe949424ad4b1beb78`; after: `c068bb9d6251e57661c32fd42f157b733efc9a535ebd9b5d70992ed3f1b45ec7`.
- **staging primary**, schema 13, 110 → 0 rows. Target: `staging:aec0ad2bc6f0c391c815102baec88b8ea4300737cfa45307b3399b1549a70973`. Before: `ca2ac468b14dd5df1d0c409aba0a76eec4c20e6d548d91eecd94448bb54493e5`; after: `c068bb9d6251e57661c32fd42f157b733efc9a535ebd9b5d70992ed3f1b45ec7`.
- **staging rehearsal**, schema 13, 110 → 0 rows. Target: `staging:483591a3219bd403b7a4f64ff96ab92ca6c7b14fa02b15799dbbe6c6bee74753`. Before: `29348213f37f8eb513e21720a2583cb545d25dcf00c0fdfddca0e2084bf0e58e`; after: `76006bf3d782a45d4840feaebe27c2e40d2e1900c5a1f8bff96aae5a269da075`.
- **local current**, schema 13, 257 → 0 rows. Target: `local:/Users/denischernykh/Documents/ChatGPT/collab-bot/.runtime/app.sqlite`. Before: `032def59b07892792e6a5745cd0e9ed7ed88bda3aed8bda17a1248ce695f0222`; after: `a413c9a309a9a612d6c12fe518c60686d90b7ecc62a0d6dc1cc75d64cfd4caac`.
- **local pre-S4**, schema 11, 124 → 0 rows. Target: `local:/Users/denischernykh/Documents/ChatGPT/collab-bot/.runtime/app.pre-s4-01-20260827T172913.sqlite`. Before: `8580514f51dc95c599130341c2519b4ee5ab8aec9b5db559d20a9a1d4c9c8290`; after: `6dc61cf2138cfbc4839e8efe744462ec51c8533e67106bd55fffbab842cac66a`.
- **local CF3 snapshot**, schema 13, 257 → 0 rows. Target: `local:/Users/denischernykh/Library/Application Support/CollaborationBot/cf3-00-freeze-20260830T033847+0500/authoritative.sqlite`. Before: `032def59b07892792e6a5745cd0e9ed7ed88bda3aed8bda17a1248ce695f0222`; after: `a413c9a309a9a612d6c12fe518c60686d90b7ecc62a0d6dc1cc75d64cfd4caac`.

Cloudflare namespace inventory confirmed exactly the two project namespaces and three objects listed above. The local inventory found the current database, the pre-S4 copy and the retained CF3 SQLite snapshot; no project `.wrangler` SQLite files were present. All local integrity checks returned `ok`, FK checks were empty, and original file/directory permissions were restored. The CF3 snapshot contains a private supersession notice; its former recovery checksum/summary no longer represents the cleared database.

Final maintenance versions were staging `7871165e-32ab-498b-9c78-811d1261e5e6` and production `d918840d-9c14-46fe-9573-d8abca032cf0`. After verification, staging was restored to version `59917d21-c09e-4239-8ef8-d97656df9d9f` (deployment `95a2eff0-2f1c-4157-af21-90c328f99e1b`) and production to version `7408355f-5fe3-4fcb-8cf4-d07181ed21e7` (deployment `039c2a7d-a3f7-4d62-a5ed-ca6cfc3a62a1`), both at 100%. Health returned `ok`, reset routes returned 404 and both active versions had no `RESET_*` bindings. Production's restored schema-13 canonical export has 17 tables, zero rows and digest `dfede19847301092c861e371e771318c0251fb13bc7d74853f90afdc40c998c5`; its alarm is null and pending Telegram updates are zero. Temporary local reset-token files were removed. The existing original credentials were not replaced.

Operational deviations were resolved before deletion: Python used the system CA bundle and a standard HTTP User-Agent after Cloudflare 1010; staging was restored without data changes while the metadata-table guard was diagnosed. The authenticated diagnostics and exact `_cf_METADATA` exception were covered by failing then passing tests; no deletion allowlist expansion occurred. No MFM application release, webhook mutation, Telegram message delivery or Git push was performed.
