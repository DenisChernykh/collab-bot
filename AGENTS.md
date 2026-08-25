# Agent execution rules

## Authority

Use the repository documents in this precedence order:

1. [PRD](docs/PRD.md) — product policy and acceptance criteria;
2. [Technical Design](docs/TECHNICAL_DESIGN.md) — implementation contract;
3. [discovery brief](tz_telegram_collaboration_bot.md) — context only;
4. [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) — executable unit order, scope, checks, and evidence.

The PRD wins over the Technical Design when they conflict. A new product policy or unresolved contradiction stops the unit; do not silently choose an interpretation.

## Stage and unit protocol

- A user launch authorizes exactly one stage, not unrelated stages or future work. Within that stage, execute the first `pending` unit whose dependencies are complete, then continue sequentially only after its evidence and commit are complete.
- At most one stage and one unit may be `in_progress`; during active execution, the current unit is exactly one unit `in_progress` (an idle stage has none). Keep the plan table, unit status, evidence, and Task-ID commit aligned.
- Before each unit, verify branch/HEAD, `git status --short`, remote state, predecessor Task-ID commit, the complete card `Read first`, and the nearest repository toolchain contracts. Confirm `node --version` is `>=24.18.0 <25` and `pnpm --version` is `>=11.15.1 <12` before dependency-changing work.
- Read the card's `Scope`, `Do not touch`, `Invariants`, `Verification`, and `Stop conditions` before editing. Preserve unrelated user changes; classify unexpected files instead of overwriting or cleaning them.

## Implementation discipline

- Write focused failing tests first for runtime units, then implement the smallest current-scope change. Do not pull in Later/Out features, copy another repository wholesale, or create abstractions without a current consumer.
- Run each card's focused checks and its applicable aggregate gate; at a stage/slice gate this includes `pnpm check` once the repository scripts exist. P0 is documentation-only and has no package scripts yet.
- Keep the Technical Design boundaries: domain stays independent of Telegram/SQLite/framework types; handlers do not make product decisions; external delivery is not performed inside SQLite transactions; durable effects, receipts, and delivery intents follow the specified atomicity and replay rules.
- Stop immediately for ambiguity, source conflict, a required policy decision, an unproven acceptance criterion, an incompatible Node/pnpm contract, destructive migration, production credentials, BotFather or real Telegram actions, LaunchAgent/production mutation, restore, or any push/remote/PR/merge/deploy operation without explicit authorization.

## Evidence and Git

- Run the card's focused checks, inspect the final diff, and record exact changed files, commands/results, acceptance evidence, review result, and deviations in `IMPLEMENTATION_PLAN.md`.
- Use `Commit SHA: SELF` inside the commit being created. Resolve the authoritative SHA afterward with `git log --format='%H' --grep='^<ID>:' -n 1`.
- Create exactly one local commit per completed unit with subject `<ID>: <short measurable result>`. Verify the Task-ID is unique and the working tree is clean before the next unit.
- Do not push, add a remote, open/update a PR, merge, deploy, or mutate production resources without separate explicit authorization. Never place credentials or secrets in Git, logs, fixtures, SQLite, plist files, or documentation examples.
