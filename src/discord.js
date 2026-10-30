// Minimal Discord REST client with rate-limit (429) backoff.

const API_BASE = 'https://discord.com/api/v10';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function discord(env, method, path, body, attempt = 0) {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bot ${env.DISCORD_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (res.status === 429) {
    if (attempt >= 4) throw new Error(`Discord rate limit persisted on ${method} ${path}`);
    let waitMs = 1000;
    try {
      waitMs = Math.ceil((await res.json()).retry_after * 1000);
    } catch { /* keep default wait */ }
    await sleep(waitMs + 200);
    return discord(env, method, path, body, attempt + 1);
  }

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Discord API ${method} ${path} → ${res.status}: ${text.slice(0, 300)}`);
  }

  return res.status === 204 ? null : res.json();
}

export async function findOrCreateDealsRole(env, guildId, roleName, color) {
  const roles = await discord(env, 'GET', `/guilds/${guildId}/roles`);
  const existing = roles.find((r) => r.name === roleName);
  if (existing) return existing;
  return discord(env, 'POST', `/guilds/${guildId}/roles`, {
    name: roleName,
    color,
    hoist: false,
    mentionable: false, // only the bot pings it (via its Mention All Roles permission)
    permissions: '0',
    reason: 'Game Deals Bot: alert role for sale notifications',
  });
}

// PUT member role requires an (empty) JSON body.
export const addMemberRole = (env, guildId, userId, roleId) =>
  discord(env, 'PUT', `/guilds/${guildId}/members/${userId}/roles/${roleId}`, {});

export const removeMemberRole = (env, guildId, userId, roleId) =>
  discord(env, 'DELETE', `/guilds/${guildId}/members/${userId}/roles/${roleId}`);

export const sendMessage = (env, channelId, payload) =>
  discord(env, 'POST', `/channels/${channelId}/messages`, payload);

// Discord permission bits (https://discord.com/developers/docs/topics/permissions)
// Least privilege: the bot never deletes or pins messages, so Manage Messages is
// deliberately not requested — not in the invite, not in channel overrides.
const P = { VIEW: 1 << 10, SEND: 1 << 11, EMBED: 1 << 14, HISTORY: 1 << 16 };
const BOT_ALLOW = String(P.VIEW | P.SEND | P.EMBED | P.HISTORY);

export const getBotUserId = async (env) => (await discord(env, 'GET', '/users/@me')).id;

export const createChannel = (env, guildId, name) =>
  discord(env, 'POST', `/guilds/${guildId}/channels`, { name, type: 0 });

// Existence probes used when re-running /deals setup: a channel or message the
// admin deleted must be recreated, not assumed to still exist.
// Fail safe: only a real 404 counts as "gone". A 403 (older installs without
// Read Message History) or a 5xx must not cause duplicate channels or messages.
const is404 = (err) => /→ 404\b/.test(String(err?.message));

export async function channelExists(env, channelId) {
  try {
    await discord(env, 'GET', `/channels/${channelId}`);
    return true;
  } catch (err) {
    return !is404(err);
  }
}

export async function messageExists(env, channelId, messageId) {
  try {
    await discord(env, 'GET', `/channels/${channelId}/messages/${messageId}`);
    return true;
  } catch (err) {
    return !is404(err);
  }
}

// Alerts channel: only the Game Deals role (and the bot) can see/use it.
export const lockChannelToRole = async (env, channelId, guildId, roleId, botId) => {
  await Promise.all([
    discord(env, 'PUT', `/channels/${channelId}/permissions/${guildId}`, { type: 0, allow: '0', deny: String(P.VIEW) }),
    discord(env, 'PUT', `/channels/${channelId}/permissions/${roleId}`, { type: 0, allow: String(P.VIEW), deny: '0' }),
    discord(env, 'PUT', `/channels/${channelId}/permissions/${botId}`, { type: 1, allow: BOT_ALLOW, deny: '0' }),
  ]);
};

// Remove the role lockdown (used when moving alerts to a different channel).
export const unlockChannel = async (env, channelId, guildId, roleId, botId) => {
  await Promise.allSettled([
    discord(env, 'DELETE', `/channels/${channelId}/permissions/${guildId}`),
    discord(env, 'DELETE', `/channels/${channelId}/permissions/${roleId}`),
    discord(env, 'DELETE', `/channels/${channelId}/permissions/${botId}`),
  ]);
};

// Opt-in channel: everyone can view, but only the bot can post.
export const makeChannelReadonly = async (env, channelId, guildId, botId) => {
  await Promise.all([
    discord(env, 'PUT', `/channels/${channelId}/permissions/${guildId}`, { type: 0, allow: '0', deny: String(P.SEND) }),
    discord(env, 'PUT', `/channels/${channelId}/permissions/${botId}`, { type: 1, allow: BOT_ALLOW, deny: '0' }),
  ]);
};

export const editOriginalResponse = (env, interactionToken, payload) =>
  discord(env, 'PATCH', `/webhooks/${env.DISCORD_APPLICATION_ID}/${interactionToken}/messages/@original`, payload);
