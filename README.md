# 🎮 Game Deals Bot

A Discord bot that posts **new** game deals to your server — Steam, Xbox /
Microsoft Store, Steam giveaways, Epic free games and GOG free games — with
prices in ₹ INR and a **🛒 Buy Now** button on every alert.

Runs entirely on **Cloudflare Workers + D1**, free tier, no card, no server,
no PC left on.

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![Cloudflare Workers](https://img.shields.io/badge/runs%20on-Cloudflare%20Workers-f38020)](https://workers.cloudflare.com/)

> **Self-hosted by design.** This repository is a template, not a public bot.
> You fork it, create your own Discord application, and deploy to your own
> Cloudflare account. There is no shared backend, no shared database, and no
> invite link to someone else's instance. Nothing about one deployment can
> affect another.

---

## What it posts

| Source | Coverage | Notes |
|---|---|---|
| 🟦 **Steam** | Paid discounts | Includes review rating and deal end date |
| 🟩 **Xbox / Microsoft Store** | Paid discounts | |
| 🎮 **Steam Free** | Giveaways and free-to-play | Alerts once when new to your bot |
| 🆓 **Epic Games** | Weekly free games | Epic blocks bots from the paid catalogue |
| 🎁 **GOG Free Games** | Free-to-keep giveaways | Paid GOG sales are intentionally excluded |

Behaviour that keeps the channel readable:

- Only **new** deals, or deals that got **deeper**, are posted. No repeats.
- A brand-new server gets one silent baseline scan, so long-running sales are
  recorded instead of flooding the channel.
- Free games bypass the scan interval — they go out on the next 5-minute tick.
- Users opt in with a **🔔 Get Sale Alerts** button; the bot manages a role for
  the pings.

Prices are ₹ INR. Stores that list in USD are converted with
[open.er-api.com](https://open.er-api.com) and fall back to a fixed rate if that
is unreachable.

## How it works

```
                    ┌──────────────────────────────┐
 Discord slash cmd ─▶  Worker (fetch / interactions)│
 Button click      ─▶  Ed25519 signature check       │
                    └───────────────┬───────────────┘
                                    │
 Cron every 5 min ──────────────────┤
                                    ▼
                          ┌──────────────────┐
                          │   D1 database    │
                          │ guild_settings   │
                          │ deals            │
                          │ deal_alerts      │
                          │ steam_ratings    │
                          └──────────────────┘
                                    │
        store APIs ─────────────▶ deal engine ─────▶ Discord channel
```

The scanner ticks every 5 minutes. Each server's own `scan_minutes` setting
decides whether that run actually posts for it.

## Commands

| Command | Permission | What it does |
|---|---|---|
| `/deals setup` | Manage Server | Creates the locked `#game-deals` channel, a public `#get-sale-alerts` channel, the ping role, and the opt-in message. Supports `channel`, `min_discount`, `scan_minutes`, and five store toggles. |
| `/deals settings` | Manage Server | Views or changes any of the above. |
| `/deals now` | Members with the Game Deals role | Shows the current top deals, ephemeral (only the caller sees it). |

Day-to-day usage — subscribing, changing settings, and troubleshooting — is in
**[USAGE.md](./USAGE.md)**.

`scan_minutes` accepts **5–1440** (default 30). `min_discount` accepts **1–100**
(default 50).

## Self-host in ~15 minutes

**No terminal** → follow **[DEPLOY.md](./DEPLOY.md)**. You paste one file into
the Cloudflare dashboard. This is the path for non-coders.

**With a terminal:**

```bash
git clone https://github.com/memeguyoffical/game-deals-bot.git
cd game-deals-bot
npm install
npx wrangler login

# 1. Database
npx wrangler d1 create game-deals-db
# copy the printed database_id into wrangler.jsonc

# 2. Schema
npm run db:schema

# 3. Secrets
npx wrangler secret put DISCORD_TOKEN
npx wrangler secret put DISCORD_PUBLIC_KEY
npx wrangler secret put SETUP_KEY

# 4. Application ID — edit wrangler.jsonc → vars.DISCORD_APPLICATION_ID

# 5. Deploy
npm run deploy
```

Then open `https://<your-worker>.<your-subdomain>.workers.dev/setup?key=<SETUP_KEY>`
to register `/deals`, and use the invite link it prints.

### Local development

```bash
cp .dev.vars.example .dev.vars   # then fill in your real values
npm run db:schema:local
npm run dev
```

> npm 11 may print `npm warn allow-scripts` for `esbuild` and `workerd`. Both
> ship prebuilt binaries, so the install and the build work fine; the warning is
> noise. No blanket script permission is required.

## Configuration

Everything is set in Cloudflare → your Worker → **Settings → Variables and
Secrets**, or in `.dev.vars` for local runs.

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `DISCORD_TOKEN` | ✅ secret | — | Bot token |
| `DISCORD_PUBLIC_KEY` | ✅ secret | — | Verifies every interaction signature |
| `DISCORD_APPLICATION_ID` | ✅ | — | Application ID, also used to build the invite link |
| `SETUP_KEY` | recommended secret | — | Protects `/setup`. Without it, `/setup` refuses to run |
| `SETUP_DONE` | optional | unset | Set to `1` to disable `/setup` permanently |
| `ALLOWED_GUILD_IDS` | optional | empty = all | Comma-separated allowlist, e.g. `123...,456...` |
| `ALERTS_PER_RUN` | optional | `10` | Max alerts posted per server per scan |

The `DB` binding is a **D1 database** binding. It must be named exactly `DB`.

## Custom emojis

Store icons are unicode by default. To use real logos, upload them in the
Discord Developer Portal → your app → **Emojis**, then fill in `CUSTOM_EMOJI` in
[`src/config.js`](./src/config.js) as `'<:name:id>'` and run `npm run bundle`.

Emoji IDs only render for the application that owns them, which is why the
upstream repo ships them empty.

## Project layout

```
src/
  index.js          request entry: routing, body cap, security headers
  verify.js         Ed25519 signature + replay-window checks
  setup.js          one-time command registration (/setup)
  dealEngine.js     scan → filter → alert pipeline
  db.js             D1 access (upserts, per-guild alert history, pruning)
  embeds.js         alert / opt-in embeds
  config.js         stores, colours, emoji map
  commands/         slash command definitions and handlers
  components/       button interactions
  stores/           one fetcher per store
migrations/         schema history (use schema.sql for a fresh database)
schema.sql          complete schema, safe to re-run
dist/worker.js      esbuild bundle used by the browser-only install
```

## Security

Signature verification, replay protection, a request body cap, a constant-time
setup key, `/setup` rate limiting, a deploy-time kill-switch, and an optional
guild allowlist are already implemented. See **[SECURITY.md](./SECURITY.md)** for
what is covered and what is your responsibility as the operator.

Please never paste a bot token into an issue.

## Limitations

- **Epic paid deals** are not covered: Epic's store API is behind a bot challenge.
- **GOG** is free-to-keep games only, by design.
- Store HTML changes can break a scraper. If a source goes quiet, that is the
  usual cause.
- The bot needs its role **above** the ping role it creates, and the invite link
  requests only the permissions it uses.

## Not affiliated

Not affiliated with or endorsed by Discord, Valve/Steam, Microsoft/Xbox, Epic
Games, or GOG.com. All trademarks belong to their owners. Prices come from the
stores' public pages and can lag or be region-dependent.

## License

[MIT](./LICENSE)
