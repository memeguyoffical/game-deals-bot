// Small helpers for interaction responses.

export const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

// Immediate ephemeral (only the clicker sees it) text response.
export const ephemeral = (content) =>
  json({ type: 4, data: { content, flags: 64 } });

// "Bot is thinking..." deferred ephemeral — follow up later via editOriginalResponse.
export const deferredEphemeral = () =>
  json({ type: 5, data: { flags: 64 } });

const MANAGE_GUILD = 0x20n;

// Comma-separated allowlist of server IDs in the ALLOWED_GUILD_IDS variable.
// Unset (or empty) means "allow everywhere" — only enforce when configured.
export const allowedGuildIds = (env) =>
  (env.ALLOWED_GUILD_IDS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

export const isGuildAllowed = (env, guildId) => {
  const allowed = allowedGuildIds(env);
  return allowed.length === 0 || allowed.includes(String(guildId));
};

export const hasManageGuild = (interaction) => {
  try {
    return (BigInt(interaction?.member?.permissions ?? '0') & MANAGE_GUILD) !== 0n;
  } catch {
    return false;
  }
};

// ---- user-facing permission help ----
// Raw Discord API errors (status codes, channel/role IDs, error bodies) are
// logged server-side only; users get this clean list of what to enable instead.

export const PERMISSIONS_LINE =
  'View Channels · Send Messages · Embed Links · Manage Channels · Manage Roles · Mention @everyone, @here and All Roles';

export const permissionHelp = (heading, extra) =>
  [
    heading,
    extra,
    '',
    '**Required bot permissions** (Server Settings → Roles → the bot):',
    '• View Channels · Send Messages · Embed Links',
    '• Manage Channels · Manage Roles',
    '• Read Message History · Mention @everyone, @here and All Roles',
    '',
    "Also drag the bot's role **above** the Game Deals role in Server Settings → Roles.",
  ]
    .filter(Boolean)
    .join('\n');
