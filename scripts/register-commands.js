// Registers the /deals slash command with Discord (terminal alternative to
// the browser /setup route — use whichever you prefer).
//
// PowerShell usage:
//   $env:DISCORD_APPLICATION_ID="your-app-id"; $env:DISCORD_TOKEN="your-bot-token"; npm run register
//
// Optional: set GUILD_ID to register instantly in one server while testing
// (global registration can take up to 1 hour to appear).

import { DEALS_COMMAND } from '../src/commands/definitions.js';

const { DISCORD_APPLICATION_ID, DISCORD_TOKEN, GUILD_ID } = process.env;

if (!DISCORD_APPLICATION_ID || !DISCORD_TOKEN) {
  console.error('❌ Missing DISCORD_APPLICATION_ID or DISCORD_TOKEN environment variables.');
  process.exit(1);
}

const url = GUILD_ID
  ? `https://discord.com/api/v10/applications/${DISCORD_APPLICATION_ID}/guilds/${GUILD_ID}/commands`
  : `https://discord.com/api/v10/applications/${DISCORD_APPLICATION_ID}/commands`;

const res = await fetch(url, {
  method: 'PUT',
  headers: { Authorization: `Bot ${DISCORD_TOKEN}`, 'Content-Type': 'application/json' },
  body: JSON.stringify([DEALS_COMMAND]),
});

const text = await res.text();
if (!res.ok) {
  console.error(`❌ Registration failed (${res.status}): ${text}`);
  process.exit(1);
}
console.log(`✅ Registered /deals ${GUILD_ID ? `in guild ${GUILD_ID} (instant)` : 'globally (may take up to 1 hour to appear)'}.`);
