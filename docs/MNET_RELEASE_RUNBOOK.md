# MNET hosted release — 2026-09-10

User authorization: «Сделай», following the handoff that identified the remaining all-project reset and feature deployment. MNET-08 completed and recorded the distinct six-target reset; MNET-09 then released the tested normal Worker to staging first, followed by production.

The immutable runtime candidate is `4be0a9bd095a87433b0055923c41ff5f0f361668` (MNET-07A). The deployment checkout is MNET-08 `083a72b91ac2dd96a595fb49be5565cd4e0f19f6`; the difference is reset evidence only. The normal bundles for both environments are identical: 893.86 KiB / 165.45 KiB gzip, SHA256 `238171af299aa525edac34297c3914055cd01aed4593cb1001ff61406b8ee468`. They contain no reset implementation.

## Active deployments verified on 2026-09-10

| Environment | Worker version at 100% | Deployment |
|---|---|---|
| staging | `79658667-8fa3-4691-b623-073ea482ba45` | `c2ae898e-20e9-45bc-86cf-8c6626ac13d4` |
| production | `5e4b9f49-09ac-49ae-8e33-196750492943` | `d248f10b-c675-461b-bbcb-4ccb584a9e8c` |

Production bot: [@davay_vmeste_bot](https://t.me/davay_vmeste_bot). Staging bot: [@collaboration_development_bot](https://t.me/collaboration_development_bot).

Both existing primary objects migrated 15→16 through the normal runner. Protected summaries verified 25 canonical tables, zero product rows, valid migration history/FKs, no pending delivery/receipts and no alarm. Each per-table count/digest and the overall canonical digest matched an independently constructed empty schema 16 SQLite database in memory:
`3cbe9e143b71709fb1263b4f1cfc4bc931d648391dceb5fc3dadda91e195819b`.
The empty baseline follows the separately recorded authorized reset; the release itself does not clear data. Rehearsal stays schema 13 and local retained databases stay 13/11/13.

Both environments return health `ok` and protected readiness `ready`, with verified bot identity and usable showcase capability. `MFM_FEATURE_ENABLED=true`, `STATE_IMPORT_ENABLED=false`, original DO class/namespaces and exactly the original four secret names are verified. No secret was rotated or added. Authenticated reset requests return 404; unauthenticated summary/export requests return 401. There are no RESET bindings or reset code in the normal deployment.

Production `getWebhookInfo` after release confirms the unchanged exact URL, pending 0, max_connections 1 and allowed message/callback updates, with no recorded error. Both bot/webhook identities and empty queues were checked immediately before leaving maintenance. Staging's token remains hosted: final readiness verifies identity, but a separate post-release staging `getWebhookInfo` was not performed. No webhook configuration or Telegram messages were changed by the operator.

## Release procedure and gates

Use the complete inspected configuration and preserve existing secrets:

```sh
WRANGLER_WRITE_LOGS=false pnpm exec wrangler deploy \
  --env <staging-or-production> --profile collab-bot \
  --strict --keep-vars=false --var MFM_FEATURE_ENABLED:true \
  --message '<AUTHORIZED_CHANGE_REFERENCE>'
```

First run the same command with `--dry-run`. Staging must pass the exact version/binding checks, protected summary, health/readiness and auth/reset-route checks before production. `--keep-vars=false` removes the temporary RESET_OPERATION_ID from the latest upload while retaining existing secrets. Neither environment needs a new token or namespace.

Release gates: Node 24.18.0 / pnpm 11.15.1; `pnpm check` PASS (99 unit/116 integration/47 runtime, lint/architecture/typecheck/build); fake Telegram PASS (48); workerd PASS (41); Cloudflare typecheck PASS. Prior unchanged db:verify/types/manifest gates also passed. Total 351 automated tests. The MNET feature review's Unicode-length blocker was fixed and regression-tested; subsequent independent reset and summary delta reviews passed. No additional deep-review cycle was required.

Automatic approval review rejected transferring full hosted state exports to the local operator. The final procedure uses `/ops/reset/inspect` during maintenance and `/ops/state/summary` after release. These responses contain counts, digests and operational metadata only. No new raw state export was saved. Synthetic tests compare summary digests with canonical manifests and prove no row/contact/token disclosure or delivery effect.

Live checks establish deployment, schema, authentication and readiness. Automated suites cover RU/EN search, introduction confirmation/decisions/contacts, privacy, replay/restart and classic regression. No new real Telegram user journey or test notification was performed. Polling remains stopped; no Git push, imports/restores, billing changes or new resources were performed.

## Compatible shutdown and recovery

Keep schema 16-compatible code. For a separately authorized shutdown, deploy this same candidate with `MFM_FEATURE_ENABLED:false`; profiles, consent, requests and history remain. Existing pending decisions/withdrawal and accepted contacts remain available. Never roll back to the prior schema 15 Worker after migration16: Worker rollback changes code and does not rewind SQLite. A data restore, webhook change or migration back needs its own approved and verified procedure. The retained local snapshots were cleared by the reset and are not valid pre-reset recovery copies.

Detailed exact-target reset and audit evidence is in [the reset record](MFM_RESET_RUNBOOK.md). Older [MFM release evidence](MFM_RELEASE_RUNBOOK.md) is historical and does not define the current schema or shutdown candidate.
