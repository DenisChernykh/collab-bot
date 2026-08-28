# CF1 local Worker runbook

CF1 is a local runtime rehearsal. It does not log in to Cloudflare, deploy a
Worker, configure a Telegram webhook, change BotFather settings, or touch a
production bot/database.

## Local variables

Create the ignored local vars file and keep it private:

```sh
cp .dev.vars.example .dev.vars
chmod 600 .dev.vars
```

Replace the markers with the credentials for one development bot and its
development showcase channel. `BOT_TOKEN` and `RELAY_BOT_TOKEN` are the same
development bot token because the Worker sends Bot API mutations for that bot
and the relay reads updates for it. This bot must be separate from production.
`TELEGRAM_WEBHOOK_SECRET` and `OPERATIONS_TOKEN` are local-only secrets. Never
commit `.dev.vars` or put a real value in `.dev.vars.example`.

## Start and stop

Use two terminals from the repository root:

```sh
pnpm cloudflare:dev
```

The Wrangler command is explicitly local and uses local workerd/SQLite Durable
Object state. In the second terminal, start the raw update relay:

```sh
pnpm cloudflare:relay --env-file "$PWD/.dev.vars"
```

The relay calls only Telegram `getUpdates`, forwards each returned update as
the original JSON body to `POST http://127.0.0.1:8787/telegram/webhook`, and
advances its in-memory offset only after a `204` response. It sends updates in
order, retries transport failures with bounded backoff, and logs only fixed
event names/counts. It contains no product decisions, database access or
Telegram reply logic.

The local health check is public:

```sh
curl -fsS http://127.0.0.1:8787/health/live
```

Stop the relay first with `Ctrl-C`, then stop Wrangler with `Ctrl-C` and wait
for both prompts to return. Do not run the relay and a webhook for the same
development token at the same time: Telegram does not permit simultaneous
`getUpdates` and webhook delivery. CF1 never calls `setWebhook`; any real
development-bot smoke or webhook change needs a separately authorized action.

## Protected local diagnostics

The Worker exposes `/ops/ready`, `/ops/state/export` and
`/ops/state/import` only with the local `OPERATIONS_TOKEN`. Import additionally
requires `STATE_IMPORT_ENABLED=true` and remains disabled in the example file.
Use the already implemented CF1-08 transfer checks; do not paste manifests or
tokens into logs, issues or shell history.

## Rollback

The legacy Node/SQLite path remains available and unchanged:

```sh
pnpm start --env-file /absolute/private/path/collaboration-bot.env
```

Use it only after the Cloudflare relay and local Worker are stopped. CF1 local
evidence does not claim hosted availability, production readiness, real
Telegram success, or a completed data cutover.
