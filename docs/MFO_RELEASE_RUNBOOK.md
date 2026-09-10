# Fast MFM onboarding hosted release — 2026-09-10

The user authorized a staging-first deployment and a logical clearing of only the current staging and production primary databases. The staging rehearsal object, retained local SQLite files, Telegram messages, webhook configuration, secrets and Git remote are outside scope. The user confirmed that production contains no useful data, so this release does not create or retrieve a state export.

## Candidate

The immutable normal-runtime candidate is MFO-04B `1a02e5ab714f5d8bef9da48c7a0fd2a2ce342079`. It shortens only MFM onboarding, adds the schema17 preferred-contact table, keeps optional specialization editing, asks search purpose through the existing filter session and resolves a preferred contact only on an accepted request screen. Classic collaboration behavior and the one-bot/one-database topology are unchanged.

The inspected staging and production dry runs are identical normal Workers: 913.06 KiB / 169.17 KiB gzip, worker SHA256 `ce8abf5132ba5c0590009a025bcc52ec20e4247fa0ce18e2396e2b58b5ba86fe`. They use `src/worker.ts`, contain no maintenance reset route and retain the existing Durable Object binding, environment identity and four secret names.

## Local gate

Node 24.18.0 and pnpm 11.15.1 satisfy the repository contract. `pnpm check` passed with 108 unit, 121 integration and 47 runtime tests; all 51 fake Telegram tests and all 41 workerd tests passed. The workerd gate initially exposed one stale pre-shortening test journey; only that test was aligned with the already-reviewed short flow before the complete green rerun. Database verification, Cloudflare typecheck/types/manifest checks and both normal dry runs passed. The one blocker-limited independent review passed with no credential/contact exposure, data corruption, duplicated effects, broken core journey or unrunnable-candidate blocker.

## Live sequence

Resolve the current account, Worker, active deployment/version, primary namespace/object, exact four secret names, protected summary and Telegram pending-update state immediately before mutation. Deploy the normal candidate to staging with `MFM_FEATURE_ENABLED:true`, verify schema17, health/readiness and the protected summary, then use the temporary maintenance entrypoint for exact operation `mfo-2026-reset`. Require both earlier audit rows, quiescent delivery, null alarm, the inspected target and digest. Restore the just-verified normal version and prove the primary is empty on schema17. Repeat only after staging succeeds, for production.

Record the final version/deployment IDs, before/after aggregate counts and digests, audit preservation, webhook identity and post-restoration checks here. Never place tokens, raw profiles, contacts or Telegram update bodies in Git.

## Execution record

The release completed staging-first on the existing Cloudflare account `643464cda99dd9fb036367674d42a62c`. Both normal Workers run the MFO-04B candidate with `MFM_FEATURE_ENABLED=true`, schema17 and the existing four secret names. No export was taken because the user confirmed that production held no useful data.

- **Staging primary** `staging:aec0ad2bc6f0c391c815102baec88b8ea4300737cfa45307b3399b1549a70973`: the normal deploy migrated the empty canonical schema16 state to schema17. Maintenance inspection included one auxiliary row and reset it `1 → 0`, from digest `65bef049547a41cca4cd7e79b8f6d37ecef146e163dfba8bc091825ca3ca926f` to `b64721dc814e0dfd7780b1e3f5d4680bbacaa6a3c96b29eb9c4f0f4f4a6d0b92`. Maintenance version `a4559185-5d25-4b82-b429-8bda5c62d7c6` was replaced by normal version `f34dfdc0-c5f9-431a-a414-aceae9a1e515`, final deployment `54b2acb0-2fac-4eec-b246-f4c3ecafe189`.
- **Production primary** `production:7c3fd71a1bfba2be912e976e9855b4a0193c291fdf26c07437599a75bdf6961e`: the normal deploy preserved all 123 canonical rows while migrating schema16 to schema17. Maintenance inspection included one auxiliary row and reset it `124 → 0`, from digest `2095414798d13792567d9682ff4d32c6a7fe1de9c57c9333e1cf8b16b6ea1312` to `b64721dc814e0dfd7780b1e3f5d4680bbacaa6a3c96b29eb9c4f0f4f4a6d0b92`. Maintenance version `9763feb2-f108-4e08-990f-4312a59677e1` was replaced by normal version `fdf722d8-10d5-4024-8806-36d5c805cf16`, final deployment `256e519f-8c22-4003-8d96-030f09539b32`.

Both exact reset requests were replayed once and returned the retained result. The prior `mfm-2026-reset` and `mnet-2026-reset` audits were preserved and `mfo-2026-reset` was appended; the maintenance schema digest remained `3f6d1bd6fdbc6abfacf4a99ce860f94d6cc22179cc4ae4cd2bad9e6eaee2ebee`. Bot and webhook identities matched, Telegram pending updates were zero, no last webhook error was present and each deletion followed the required idle maintenance window. An initial staging composite check failed immediately after the maintenance switch; no deletion occurred, and a subsequent aggregate-only inspection passed every gate before reset.

After restoration both normal Workers are at 100%, health is `ok`, the protected canonical summary is schema17/26 tables/zero rows with digest `a899c77c7e12f9af1b2c265823d3eb7251c18c8a5265abe0ffa46abe62439389`, the alarm is null, unauthenticated summary access returns 401 and reset routes return 404. No rehearsal/local database, namespace, secret, webhook, Telegram message, billing resource or Git remote was changed.
