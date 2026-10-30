# How to use Game Deals Bot

Three audiences, three sections. Jump to yours.

- [Server members](#for-server-members) — you just want deals
- [Server admins](#for-server-admins) — you run the Discord server
- [Self-hosters](#for-self-hosters) — you run the bot itself

---

## For server members

### Subscribe

1. Open the **`#get-sale-alerts`** channel (the bot creates it during setup).
2. Click **🔔 Get Sale Alerts**.
3. You now have the **🎮 Game Deals** role, and the **`#game-deals`** channel
   appears for you.

### Unsubscribe

Click **🔔 Get Sale Alerts** again. The role and channel access are removed
immediately.

### See deals without subscribing

```
/deals now
```

Shows the current top deals. Only you see the reply, and you must already have
the Game Deals role.

### What you will get pinged about

Only **new** deals, deals that got **deeper**, and **new free games**. The same
deal is never posted twice, and long-running sales that predate your server are
not announced.

---

## For server admins

> You need the **Manage Server** permission for every command below.

### First-time setup

```
/deals setup
```

That is enough. With no options, the bot:

1. creates the **🎮 Game Deals** role,
2. creates **`#game-deals`**, locked so only that role can read it,
3. creates **`#get-sale-alerts`**, public but read-only, with the subscribe button,
4. starts scanning every 30 minutes at a 50% discount threshold.

### Setup options

| Option | Type | Default | Notes |
|---|---|---|---|
| `channel` | channel | creates `#game-deals` | Where alerts are posted. It gets locked to the role. |
| `min_discount` | 1–100 | `50` | Free games ignore this. |
| `scan_minutes` | 5–1440 | `30` | How often this server checks for alerts. |
| `steam` | on/off | on | Paid Steam discounts |
| `epic` | on/off | on | Epic free games |
| `xbox` | on/off | on | Xbox / Microsoft Store |
| `steam_free` | on/off | on | Steam giveaways and free-to-play |
| `gog` | on/off | on | GOG free-to-keep giveaways |

Example — quieter channel, only big discounts:

```
/deals setup min_discount:70 scan_minutes:60 steam:true xbox:true epic:false steam_free:false gog:false
```

Setup is safe to re-run. It reuses the existing role, channels, and subscribe
message instead of creating duplicates, and re-applies your options.

### Change settings later

```
/deals settings
```

With no options it just prints the current configuration. Add options to change
them:

| Want | Command |
|---|---|
| Bigger discounts only | `/deals settings min_discount:75` |
| Check more often | `/deals settings scan_minutes:15` |
| Stop Xbox alerts | `/deals settings xbox:false` |
| Turn GOG back on | `/deals settings gog:true` |
| Move alerts to another channel | `/deals settings channel:#deals` |

Moving the channel automatically removes the old channel's lockdown, so nothing
is left half-configured.

### Role position matters

In **Server Settings → Roles**, drag the bot's own role **above** the
**🎮 Game Deals** role.

If it sits below, the bot cannot assign the role, and clicking the subscribe
button replies with a permissions checklist instead of subscribing.

### How often should it scan?

| `scan_minutes` | Feel | Cost |
|---|---|---|
| `5` | Instant | Most requests — still free |
| `15`–`30` | Normal | Balanced |
| `60`+ | Digest-like | Fewest requests |

Free games always go out on the next 5-minute tick regardless of this setting,
because they are time-limited.

### What gets posted, exactly

| Situation | Posted? |
|---|---|
| A deal the bot has never seen | ✅ |
| The same deal again | ❌ |
| A deal that got ≥3% deeper | ✅ |
| A deal that dropped ≥₹100 further | ✅ |
| A long-running sale from before setup | ❌ (recorded silently) |
| A new free game | ✅ once, then never again |
| A paid GOG sale | ❌ (this bot only reports GOG freebies) |

The first scan for a new server is deliberately silent: it records the existing
catalogue so your channel is not flooded with sales that started weeks ago.

### Lock the bot to your servers

Self-hosters can set `ALLOWED_GUILD_IDS` to a comma-separated list of server
IDs. Any other server gets a "this bot is private" reply. Leave it unset to
allow everywhere.

---

## For self-hosters

You run your own copy. Nothing is shared with anyone else.

| Task | Where |
|---|---|
| Install in ~15 minutes, no terminal | [DEPLOY.md](./DEPLOY.md) |
| Install with git + wrangler | [README.md](./README.md#self-host-in-15-minutes) |
| Security model and responsibilities | [SECURITY.md](./SECURITY.md) |
| Database | `schema.sql` (fresh), `migrations/` (history) |

### Useful commands

```bash
npm run dev              # local worker
npm run dev:cron         # local worker + scheduled events
npm run bundle           # rebuild dist/worker.js
npm run db:schema        # apply schema.sql to the remote D1 database
npx wrangler tail        # live production logs
```

After changing `src/`, always run `npm run bundle` — the browser-only install
and CI both depend on `dist/worker.js` being current.

### Production checklist

- [ ] `DISCORD_TOKEN`, `DISCORD_PUBLIC_KEY`, `SETUP_KEY` stored as **secrets**
- [ ] `DISCORD_APPLICATION_ID` set
- [ ] D1 binding named exactly `DB`
- [ ] Cron trigger `*/5 * * * *` exists
- [ ] `/setup?key=…` visited once, `/deals` visible in Discord
- [ ] `SETUP_DONE=1` added afterwards to close the setup page
- [ ] Bot role dragged above 🎮 Game Deals
- [ ] `ALLOWED_GUILD_IDS` set if the bot is in servers you do not control

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `/deals` does not appear | Global commands can take up to 1 hour | Wait, or revisit `/setup?key=…` |
| "You need Manage Server" | You lack the permission | Ask the owner, or use an admin account |
| Subscribe button returns a permissions checklist | Bot role is below 🎮 Game Deals | Drag it up in Server Settings → Roles |
| Alerts post but nobody is pinged | Missing **Mention @everyone, @here and All Roles** | Grant it to the bot role |
| No alerts for hours | Cron, D1 binding, or an empty deal table | Check the cron trigger and run `/deals now` |
| Only Epic free games appear | Epic blocks bots from its paid catalogue | Expected |
| GOG is quiet | No free-to-keep giveaway is running | Expected |
| Prices look wrong | Store region or a stale currency rate | Prices are informational, not checkout prices |

Still stuck? Open an issue with your logs from `npx wrangler tail`, **with
secrets removed**.
