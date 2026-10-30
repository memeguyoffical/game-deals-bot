# 🚀 Deployment Guide — no terminal needed

Total time: ~20 minutes. Total cost: **₹0**. Nothing is installed on your PC,
and once setup is done your PC can stay off — the bot lives entirely on
Cloudflare.

You only touch two websites: the **Discord Developer Portal** and the
**Cloudflare dashboard**.

This guide is for the no-terminal path: you paste `dist/worker.js` into
Cloudflare's editor. If you prefer git + wrangler, see the README instead.

---

## Part 1 — Discord: create the app (5 min)

1. Go to <https://discord.com/developers/applications> → **New Application** →
   name it (e.g. `Game Deals`) → **Create**.
2. On **General Information**, copy and save:
   - **Application ID**
   - **Public Key**
3. Left sidebar → **Bot**:
   - **Reset Token** → copy the token → save it.
     ⚠️ The token is a password. Never share or screenshot it.
   - Leave all **Privileged Gateway Intents OFF** — the bot does not need them.
   - **Public Bot**: turn **OFF** unless you plan to let strangers invite it.
     Off means only you can add it to servers.

You now have three saved values: **Application ID**, **Public Key**, **Bot
Token**.

---

## Part 2 — Cloudflare: put the bot in the cloud (8 min)

### 2.1 Account

1. Sign up at <https://dash.cloudflare.com/sign-up> (email + password, no card).
2. Skip any "add a website/domain" prompts.

### 2.2 Create the Worker and paste the code

1. Sidebar → **Workers & Pages** → **Create** → **Create Worker**.
2. Name it `game-deals-bot` → **Deploy**.
   The first time, Cloudflare asks you to pick a free `workers.dev` subdomain
   (for example `your-name`). Your bot URL becomes
   `https://game-deals-bot.your-name.workers.dev`.
3. If asked about **"Protect with Cloudflare Access"**, leave it **OFF**.
   It would block Discord from reaching the bot.
4. Click **Edit code** (top right).
5. On your PC, open **`dist\worker.js`** from this project with Notepad →
   **Ctrl+A**, **Ctrl+C**.
6. In the Cloudflare editor: select all existing code → **paste** →
   **Deploy**.

### 2.3 Create the database

1. Sidebar → **Storage & Databases** → **D1 SQL Database** → **Create**
   (D1 — **not** "Workers KV").
2. Name: `game-deals-db` → **Create**.
3. Open it → **Console** tab.
4. Open **`schema.sql`** from this project, select everything, and paste it into
   the console → **Execute**.

   That file creates all four tables the bot needs. It is safe to run twice.

### 2.4 Bind the database to the Worker

1. **Workers & Pages** → `game-deals-bot` → **Settings** → **Bindings**.
2. **Add binding** → **D1 database**:
   - Variable name: `DB` (exactly this, capital letters)
   - D1 database: `game-deals-db`
3. **Save**.

### 2.5 Add your secrets

Same Worker → **Settings** → **Variables and Secrets** → **Add** each row:

| Name | Type | Value |
|---|---|---|
| `DISCORD_TOKEN` | Secret | your Bot Token from Part 1 |
| `DISCORD_PUBLIC_KEY` | Secret | your Public Key from Part 1 |
| `DISCORD_APPLICATION_ID` | Text | your Application ID from Part 1 |
| `SETUP_KEY` | Secret | a long random string you invent, e.g. 6+ random words |

`SETUP_KEY` protects the one-time `/setup` page that registers the `/deals`
command. Treat it like a password.

Optional, can be added later:

| Name | Type | Value |
|---|---|---|
| `ALLOWED_GUILD_IDS` | Text | comma-separated server IDs, if you want to lock the bot to specific servers |
| `ALERTS_PER_RUN` | Text | max alerts per scan per server (default `10`) |
| `SETUP_DONE` | Text | set to `1` once setup is finished, to disable `/setup` for good |

### 2.6 Add the scan schedule

Same Worker → **Settings** → **Trigger Events** → **Cron Triggers** →
**Add Cron Trigger** → enter:

```
*/5 * * * *
```

→ **Save**. This wakes the bot every 5 minutes; each server's own
`scan_minutes` setting decides whether that run posts for it.

---

## Part 3 — Connect Discord to Cloudflare (3 min)

1. Discord Developer Portal → **General Information** →
   **Interactions Endpoint URL**:

   ```
   https://game-deals-bot.your-name.workers.dev
   ```

   → **Save Changes**. Discord verifies it instantly. If it fails, recheck the
   `DISCORD_PUBLIC_KEY` secret from 2.5 — it is the **Public Key**, not the
   token.

2. Open a new tab and visit (replace both placeholders):

   ```
   https://game-deals-bot.your-name.workers.dev/setup?key=YOUR_SETUP_KEY
   ```

   You should see **✅ /deals command registered** with your bot-invite link.

3. Open that invite link → pick your server → **Authorize**.

4. **Now do this:** Cloudflare → your Worker → **Settings → Variables and
   Secrets** → add `SETUP_DONE` = `1`. The setup page is then unreachable, even
   if the key leaks. Delete the variable whenever you need to register commands
   again.

---

## Part 4 — In your Discord server (2 min)

1. **Server Settings → Roles**: drag the bot's own role **near the top**. It must
   sit above the `🎮 Game Deals` role the bot creates.
2. In any channel, type:

   ```
   /deals setup
   ```

   The bot creates:
   - `#game-deals` — locked so only subscribers can read it
   - `#get-sale-alerts` — public, holds the **🔔 Get Sale Alerts** button

   Optional arguments: `min_discount:40`, `scan_minutes:15`,
   `steam:false`, `gog:false`, `channel:#some-channel`.
3. Members click **🔔 Get Sale Alerts** to subscribe or unsubscribe.
4. Deals start arriving within 5 minutes. `/deals now` shows the current top
   deals at any time.

   Note: Discord can take up to an hour to show a brand-new global command the
   very first time.

---

## Updating the bot later

Get a new `dist\worker.js` → **Edit code** in the Cloudflare dashboard →
select all → paste → **Deploy**. About 30 seconds. No database changes are
needed unless the release notes say so.

## Troubleshooting

| Problem | Fix |
|---|---|
| Endpoint URL won't save / "invalid signature" | `DISCORD_PUBLIC_KEY` is wrong. It is the **Public Key**, not the token. |
| `/deals` never appears | Wait up to 1 hour, then revisit `/setup?key=...`. |
| `/setup` says "SETUP_KEY is not configured" | Add the `SETUP_KEY` secret, then reload the page. |
| `/setup` says "Setup is disabled" | You set `SETUP_DONE=1`. Delete that variable to use `/setup` again. |
| `/deals` replies with a permissions checklist | Move the bot's role higher in **Server Settings → Roles**. |
| Subscribe button errors | Same cause: bot role must be above `🎮 Game Deals`. |
| Alerts post but nobody is pinged | Bot needs **Mention @everyone, @here and All Roles**. |
| No alerts for hours | Check the cron trigger `*/5 * * * *` exists, the D1 binding is named `DB`, and the schema from 2.3 was executed. |
| Free games work, paid Steam deals don't | Steam scraping may have changed upstream — open an issue. |
| Only Epic free games appear | Expected. Epic blocks bots from its paid catalogue. |
| GOG is quiet | Expected. GOG is free-to-keep giveaways only, and there isn't always one running. |

## Cost check

Cloudflare's free tier covers this easily: the cron is 288 invocations per day,
plus one request per slash command or button click. D1's free limits are far
above what a handful of servers read and write. No card is required, and there
is nothing to upgrade unless you add hundreds of servers.
