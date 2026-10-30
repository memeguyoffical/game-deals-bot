# Security

## Reporting a vulnerability

Open a [private security advisory](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability)
on this repository. Do not open a public issue for anything exploitable.

Never paste a `DISCORD_TOKEN`, `DISCORD_PUBLIC_KEY`, `SETUP_KEY`, or a full D1
export into an issue. A leaked bot token lets anyone act as your bot.

## What the code already does

| Control | Where |
|---|---|
| Ed25519 signature check on every interaction | `src/verify.js` |
| Replay protection — timestamps older than 5 minutes are rejected | `src/verify.js` |
| Request body cap (128 KB) rejected with `413` before parsing | `src/index.js` |
| Constant-time `SETUP_KEY` comparison (SHA-256 + XOR) | `src/setup.js` |
| `/setup` rate limit — 5 attempts per 10 minutes per IP, then `429` | `src/setup.js` |
| `SETUP_DONE=1` kill-switch disables `/setup` completely | `src/setup.js` |
| Optional guild allowlist via `ALLOWED_GUILD_IDS` | `src/util.js` |
| `Manage Server` required for every mutating command | `src/commands/deals.js` |
| User-facing errors never contain raw API responses | `src/util.js` |
| Hardened response headers on public routes | `src/index.js`, `src/setup.js` |

## What you are responsible for

This repo is a **self-hosted template**. Each deployment has its own Discord
application, Cloudflare account, and D1 database. There is no shared backend and
no shared credentials, so there is no multi-tenant isolation to break — but also
no one else protecting your instance.

- Keep `DISCORD_TOKEN`, `DISCORD_PUBLIC_KEY`, and `SETUP_KEY` in Cloudflare
  **Variables and Secrets**, never in `wrangler.jsonc` or git.
- Rotate `DISCORD_TOKEN` immediately if it is ever exposed. Reset it in the
  Discord Developer Portal.
- Set `SETUP_DONE=1` after you register the `/deals` command, so the setup route
  can no longer be reached at all.
- Set `ALLOWED_GUILD_IDS` if your bot is installed anywhere you do not control.
- `.dev.vars` is gitignored. Keep it that way.

## Out of scope

- Abuse of a store's public API by upstream rate limits or ToS changes.
- Deals being wrong because a store served different prices to different regions.
- Anyone who has your Cloudflare account credentials.
