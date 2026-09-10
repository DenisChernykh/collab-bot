# One-time MFM project database reset

PRD MFM-F06 explicitly authorizes this operation for this project only. It supersedes the older CF2/CF3 retention prohibition for these databases. Feature release and Git push remain separate. Execute MFM-08 only after the MFM-07 tests and independent critical review pass.

Targets: the existing `collaboration-bot-production` and `collaboration-bot-staging` Workers in account `643464cda99dd9fb036367674d42a62c`; their fixed `collaboration-bot-primary` objects; staging's fixed `collaboration-bot-cf2-03-rehearsal`; `.runtime/app.sqlite`, `.runtime/app.pre-s4-01-20260827T172913.sqlite`, and the project's retained CF3 `authoritative.sqlite` snapshot under the owner's CollaborationBot application-support directory. Verify the current binding/namespace/object IDs, deployed version and every real local path. Do not address arbitrary object names or other projects. Enumerate any further project SQLite files before execution.

The reset preserves schema, migration checksums, indexes and triggers. Cloudflare’s internal `_cf_METADATA` table is recognized but its rows are never queried or deleted ([workerd source](https://github.com/cloudflare/workerd/blob/main/src/workerd/util/sqlite-metadata.h)); its presence is covered by an alarm-created local workerd regression. Unknown application tables still fail closed. It clears existing allowlisted product/service tables, including MFM data if present. It does not apply migrations to legacy live databases. A small `mfm_reset_audit` row retains only operation ID, target, counts, digests and time. An exact retry returns that result, even if new data later exists. The MNET follow-up below authorizes one distinct second operation with its own retained audit; arbitrary operation IDs remain refused. This is a logical reset, not forensic erasure of Cloudflare PITR or private JSON evidence. Existing Telegram messages are outside scope.

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


## MNET follow-up — separately authorized second reset

The user confirmed clearing all six databases again and, after the MNET-06 handoff,
asked to complete the reset and feature deployment on 2026-09-10. MNET-07 prepares
the operator code; MNET-08 performs the reset, then the separately recorded release
activates MNET. Keep these operations sequential and record each result.

Only `mfm-2026-reset` and `mnet-2026-reset` are supported. The second requires the
first audit to exist for the same exact target. It writes `mnet_reset_audit` without
rewriting or deleting `mfm_reset_audit`. Both audit rows are excluded from product
row counts and schema/data digests; inspection exposes their data-free results as
`completedOperations`. Each operation's exact retry returns its own immutable result
without deleting newer data. A changed digest for a completed operation is refused;
third/arbitrary operation IDs and a missing/mismatched prior audit are refused.

Reinspect the two existing namespaces, all three fixed hosted objects and the same
three real local SQLite paths above. The last recorded hosted primaries are schema15;
staging rehearsal and local snapshots retain their earlier schemas. The maintenance
helper supports the verified migration prefixes 11–16 and never upgrades them. Do not
infer current versions or counts from the earlier execution record.

Follow the existing preflight/maintenance/apply/retry/restore procedure using
`RESET_OPERATION_ID:mnet-2026-reset` and request `operationId: mnet-2026-reset`.
Both operations credentials are now available in their owner-only handoffs, so reuse
`OPERATIONS_TOKEN` rather than generating a new reset secret. Before maintenance,
verify exact current version/binding and the production null alarm. Use the
maintenance inspection for delivery/receipt aggregates before deletion; do not fetch
full protected state exports. The staging alarm route is production-only in normal code. Preserve the existing Telegram secrets, webhook and vars. Keep at
least 60 seconds of idle maintenance before applying. The protected maintenance
webhook-state check must verify each bot/webhook and zero pending updates.

Before deleting, compare the protected target against the freshly inventoried object
ID and the first audit target; compare the inspection digest and require quiescence.
After deleting, require zero product/service rows, unchanged schema/history and both
audits; compare the old result exactly. Replay the identical request once and require
the same second result. Restore the recorded normal version, verify health and absence
of reset routes. The final maintenance inspection proves zero product rows; the
subsequent normal release uses a protected summary without exporting private rows.

Local SQLite remains stopped. Check the database and WAL/SHM holders, exact paths and
original permissions. Preserve the earlier snapshot notice and write a separate MNET
supersession notice after clearing the retained snapshot. Restore original permissions.
No import, PITR restore, polling startup, Telegram test messages or Git push is part of
the reset. Subsequent MNET feature deployment uses normal `src/worker.ts`, schema16,
explicit `MFM_FEATURE_ENABLED:true` and the staging-first release verification.

## MNET-08 execution record — 2026-09-10

Operation `mnet-2026-reset` completed on the same exact six inventoried project databases. All product/service rows were zero after inspection, schemas/history/guards remained unchanged, the earlier MFM result was preserved verbatim and the separate MNET result was retained. Every identical retry returned the recorded result.

- **staging:aec0ad2bc6f0c391c815102baec88b8ea4300737cfa45307b3399b1549a70973**, schema 15, 1 → 0 rows. Before `6323e2cf54c623ece51dc1be473c5d00a49f6381b6bfb9e2780e6533f5cfd105`; after `683d45211877fc81631e0e5de74ec942709e9794b04dcb010e2d3516e03dc983`.
- **staging:483591a3219bd403b7a4f64ff96ab92ca6c7b14fa02b15799dbbe6c6bee74753**, schema 13, 0 → 0 rows. Before `76006bf3d782a45d4840feaebe27c2e40d2e1900c5a1f8bff96aae5a269da075`; after `76006bf3d782a45d4840feaebe27c2e40d2e1900c5a1f8bff96aae5a269da075`.
- **production:7c3fd71a1bfba2be912e976e9855b4a0193c291fdf26c07437599a75bdf6961e**, schema 15, 45 → 0 rows. Before `dd66a4581ee4223a14d395d5a5c76744b3182143c3854ec33cd3ca0d96d1a805`; after `683d45211877fc81631e0e5de74ec942709e9794b04dcb010e2d3516e03dc983`.
- **local:/Users/denischernykh/Documents/ChatGPT/collab-bot/.runtime/app.sqlite**, schema 13, 0 → 0 rows. Before `a413c9a309a9a612d6c12fe518c60686d90b7ecc62a0d6dc1cc75d64cfd4caac`; after `a413c9a309a9a612d6c12fe518c60686d90b7ecc62a0d6dc1cc75d64cfd4caac`.
- **local:/Users/denischernykh/Documents/ChatGPT/collab-bot/.runtime/app.pre-s4-01-20260827T172913.sqlite**, schema 11, 0 → 0 rows. Before `6dc61cf2138cfbc4839e8efe744462ec51c8533e67106bd55fffbab842cac66a`; after `6dc61cf2138cfbc4839e8efe744462ec51c8533e67106bd55fffbab842cac66a`.
- **local:/Users/denischernykh/Library/Application Support/CollaborationBot/cf3-00-freeze-20260830T033847+0500/authoritative.sqlite**, schema 13, 0 → 0 rows. Before `a413c9a309a9a612d6c12fe518c60686d90b7ecc62a0d6dc1cc75d64cfd4caac`; after `a413c9a309a9a612d6c12fe518c60686d90b7ecc62a0d6dc1cc75d64cfd4caac`.

Staging primary contained only one preflight-cache row. Production primary contained 44 canonical rows (one completed profile and its ingress/history/structured profile data) plus one preflight-cache row. Rehearsal and the three local databases were already empty. The second reset records a distinct operation without erasing the first audit.

Staging maintenance version `130d39d8-dbfc-4e7a-9190-1c91a5014abf` was replaced by the exact prior normal version `b4d79bda-d848-4dcd-935b-34fc2d5a82f0` at100%, deployment `f78194e0-064b-4e79-9f71-2021476ee39c`. Production maintenance version `d604da96-8fd5-4570-8c5f-6a8a8a865529` was replaced by the exact prior normal version `c4a99757-2f2a-468e-be76-b42ad5999a86` at100%, deployment `af245de0-2d30-4781-a389-0bae83b4465d`. Both normal versions returned health `ok`, protected reset route404 and exact four secret bindings with no RESET bindings. Bot/webhook identities, pending0 and max_connections1 were verified during maintenance immediately before restoring. Production alarm remained null. Each deletion followed more than60 seconds of idle maintenance. No webhook change or Telegram test message occurred.

## MFO follow-up — authorized third primary-only reset

The fast-onboarding request authorizes one further operation, `mfo-2026-reset`, only for the current staging and production `collaboration-bot-primary` objects after each normal schema17 release. The user confirmed that production contains no useful data, so no state export is created or retrieved. Staging rehearsal, retained local SQLite files, Telegram messages, webhooks, secrets and other resources are not reset.

The operation requires valid `mfm-2026-reset` and `mnet-2026-reset` results for the same exact target, preserves both verbatim and adds `mfo_reset_audit`. Schema17 and `mfm_profile_contacts` are in the reviewed allowlist. The same target/digest, quiescence, null-alarm, guard restoration, schema/FK and exact-retry rules above remain mandatory. Use the existing maintenance routes with `RESET_OPERATION_ID:mfo-2026-reset`; restore the just-verified normal version after each primary is empty. Final hosted versions, counts and digests are recorded in [the MFO release record](MFO_RELEASE_RUNBOOK.md).

Local integrity/FK checks passed before and after, no DB/WAL/SHM holders were present and the polling LaunchAgent was absent. Original modes600/600/400 and directory permissions were restored. The snapshot's earlier notice was preserved and a separate owner-only MNET notice added. No backup copy, import or PITR restore was made. Full state export was removed from the operation after automatic approval review rejected that private payload transfer; hosted inspections return only counts/hashes/audit metadata. The later release verifies canonical schema16 state through the protected summary endpoint.
