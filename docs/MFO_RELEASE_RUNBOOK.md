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
