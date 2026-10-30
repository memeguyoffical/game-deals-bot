// src/verify.js
var MAX_TIMESTAMP_SKEW_SECONDS = 300;
function hexToBytes(hex) {
  if (!hex || typeof hex !== "string" || hex.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(hex)) return null;
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}
async function verifyDiscordRequest(request, publicKeyHex) {
  const signature = hexToBytes(request.headers.get("x-signature-ed25519"));
  const timestamp = request.headers.get("x-signature-timestamp");
  const publicKey = hexToBytes(publicKeyHex);
  const body = await request.text();
  if (!signature || !timestamp || !publicKey) return { ok: false, body };
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(Date.now() / 1e3 - ts) > MAX_TIMESTAMP_SKEW_SECONDS) {
    return { ok: false, body };
  }
  try {
    const key = await crypto.subtle.importKey("raw", publicKey, { name: "Ed25519" }, false, ["verify"]);
    const ok = await crypto.subtle.verify(
      { name: "Ed25519" },
      key,
      signature,
      new TextEncoder().encode(timestamp + body)
    );
    return { ok, body };
  } catch {
    return { ok: false, body };
  }
}

// src/config.js
var CUSTOM_EMOJI = {
  steam: "",
  steamFree: "",
  epic: "",
  epicFree: "",
  xbox: "",
  gog: "",
  gogFree: ""
};
var FALLBACK_EMOJI = {
  steam: "\u{1F7E6}",
  steamFree: "\u{1F3AE}",
  epic: "\u2B1B",
  epicFree: "\u{1F193}",
  xbox: "\u{1F7E9}",
  gog: "\u{1F7EA}",
  gogFree: "\u{1F381}"
};
var EMOJI = Object.fromEntries(
  Object.keys(FALLBACK_EMOJI).map((key) => [key, CUSTOM_EMOJI[key] || FALLBACK_EMOJI[key]])
);
var ROLE_NAME = "\u{1F3AE} Game Deals";
var ROLE_COLOR = 16098851;
var STORES = {
  steam: { name: "Steam", color: 1809124, enabledKey: "steam_enabled", emoji: EMOJI.steam },
  // The Epic fetcher only returns free games today (Epic's paid-discount API is
  // bot-blocked); EMOJI.epic is kept ready for when deal alerts get added.
  epic: { name: "Epic Games", color: 3223604, enabledKey: "epic_enabled", emoji: EMOJI.epicFree },
  xbox: { name: "Xbox / Microsoft Store", color: 1080336, enabledKey: "xbox_enabled", emoji: EMOJI.xbox },
  steam_free: { name: "Steam Free Games", color: 1796924, enabledKey: "steam_free_enabled", emoji: EMOJI.steamFree },
  gog: { name: "GOG Free Games", color: 5975438, enabledKey: "gog_enabled", emoji: EMOJI.gogFree }
};
var FREE_EMOJI = {
  steam_free: EMOJI.steamFree,
  gog: EMOJI.gogFree,
  epic: EMOJI.epicFree
};
var USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

// src/util.js
var json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { "Content-Type": "application/json" }
});
var ephemeral = (content) => json({ type: 4, data: { content, flags: 64 } });
var deferredEphemeral = () => json({ type: 5, data: { flags: 64 } });
var MANAGE_GUILD = 0x20n;
var allowedGuildIds = (env) => (env.ALLOWED_GUILD_IDS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
var isGuildAllowed = (env, guildId) => {
  const allowed = allowedGuildIds(env);
  return allowed.length === 0 || allowed.includes(String(guildId));
};
var hasManageGuild = (interaction) => {
  try {
    return (BigInt(interaction?.member?.permissions ?? "0") & MANAGE_GUILD) !== 0n;
  } catch {
    return false;
  }
};
var PERMISSIONS_LINE = "View Channels \xB7 Send Messages \xB7 Embed Links \xB7 Manage Channels \xB7 Manage Roles \xB7 Mention @everyone, @here and All Roles";
var permissionHelp = (heading, extra) => [
  heading,
  extra,
  "",
  "**Required bot permissions** (Server Settings \u2192 Roles \u2192 the bot):",
  "\u2022 View Channels \xB7 Send Messages \xB7 Embed Links",
  "\u2022 Manage Channels \xB7 Manage Roles",
  "\u2022 Read Message History \xB7 Mention @everyone, @here and All Roles",
  "",
  "Also drag the bot's role **above** the Game Deals role in Server Settings \u2192 Roles."
].filter(Boolean).join("\n");

// src/discord.js
var API_BASE = "https://discord.com/api/v10";
var sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function discord(env, method, path, body, attempt = 0) {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bot ${env.DISCORD_TOKEN}`,
      "Content-Type": "application/json"
    },
    body: body === void 0 ? void 0 : JSON.stringify(body)
  });
  if (res.status === 429) {
    if (attempt >= 4) throw new Error(`Discord rate limit persisted on ${method} ${path}`);
    let waitMs = 1e3;
    try {
      waitMs = Math.ceil((await res.json()).retry_after * 1e3);
    } catch {
    }
    await sleep(waitMs + 200);
    return discord(env, method, path, body, attempt + 1);
  }
  if (!res.ok) {
    const text2 = await res.text();
    throw new Error(`Discord API ${method} ${path} \u2192 ${res.status}: ${text2.slice(0, 300)}`);
  }
  return res.status === 204 ? null : res.json();
}
async function findOrCreateDealsRole(env, guildId, roleName, color) {
  const roles = await discord(env, "GET", `/guilds/${guildId}/roles`);
  const existing = roles.find((r) => r.name === roleName);
  if (existing) return existing;
  return discord(env, "POST", `/guilds/${guildId}/roles`, {
    name: roleName,
    color,
    hoist: false,
    mentionable: false,
    // only the bot pings it (via its Mention All Roles permission)
    permissions: "0",
    reason: "Game Deals Bot: alert role for sale notifications"
  });
}
var addMemberRole = (env, guildId, userId, roleId) => discord(env, "PUT", `/guilds/${guildId}/members/${userId}/roles/${roleId}`, {});
var removeMemberRole = (env, guildId, userId, roleId) => discord(env, "DELETE", `/guilds/${guildId}/members/${userId}/roles/${roleId}`);
var sendMessage = (env, channelId, payload) => discord(env, "POST", `/channels/${channelId}/messages`, payload);
var P = { VIEW: 1 << 10, SEND: 1 << 11, EMBED: 1 << 14, HISTORY: 1 << 16 };
var BOT_ALLOW = String(P.VIEW | P.SEND | P.EMBED | P.HISTORY);
var getBotUserId = async (env) => (await discord(env, "GET", "/users/@me")).id;
var createChannel = (env, guildId, name) => discord(env, "POST", `/guilds/${guildId}/channels`, { name, type: 0 });
var is404 = (err) => /→ 404\b/.test(String(err?.message));
async function channelExists(env, channelId) {
  try {
    await discord(env, "GET", `/channels/${channelId}`);
    return true;
  } catch (err) {
    return !is404(err);
  }
}
async function messageExists(env, channelId, messageId) {
  try {
    await discord(env, "GET", `/channels/${channelId}/messages/${messageId}`);
    return true;
  } catch (err) {
    return !is404(err);
  }
}
var lockChannelToRole = async (env, channelId, guildId, roleId, botId) => {
  await Promise.all([
    discord(env, "PUT", `/channels/${channelId}/permissions/${guildId}`, { type: 0, allow: "0", deny: String(P.VIEW) }),
    discord(env, "PUT", `/channels/${channelId}/permissions/${roleId}`, { type: 0, allow: String(P.VIEW), deny: "0" }),
    discord(env, "PUT", `/channels/${channelId}/permissions/${botId}`, { type: 1, allow: BOT_ALLOW, deny: "0" })
  ]);
};
var unlockChannel = async (env, channelId, guildId, roleId, botId) => {
  await Promise.allSettled([
    discord(env, "DELETE", `/channels/${channelId}/permissions/${guildId}`),
    discord(env, "DELETE", `/channels/${channelId}/permissions/${roleId}`),
    discord(env, "DELETE", `/channels/${channelId}/permissions/${botId}`)
  ]);
};
var makeChannelReadonly = async (env, channelId, guildId, botId) => {
  await Promise.all([
    discord(env, "PUT", `/channels/${channelId}/permissions/${guildId}`, { type: 0, allow: "0", deny: String(P.SEND) }),
    discord(env, "PUT", `/channels/${channelId}/permissions/${botId}`, { type: 1, allow: BOT_ALLOW, deny: "0" })
  ]);
};
var editOriginalResponse = (env, interactionToken, payload) => discord(env, "PATCH", `/webhooks/${env.DISCORD_APPLICATION_ID}/${interactionToken}/messages/@original`, payload);

// src/db.js
async function getGuildSettings(env, guildId) {
  return env.DB.prepare("SELECT * FROM guild_settings WHERE guild_id = ?").bind(guildId).first();
}
async function getAllGuildSettings(env) {
  const { results } = await env.DB.prepare("SELECT * FROM guild_settings").all();
  return results ?? [];
}
async function upsertGuildSettings(env, s) {
  await env.DB.prepare(`
    INSERT INTO guild_settings
      (guild_id, channel_id, role_id, min_discount, steam_enabled, epic_enabled, xbox_enabled, steam_free_enabled, gog_enabled, optin_message_id, optin_channel_id, scan_minutes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(guild_id) DO UPDATE SET
      channel_id       = excluded.channel_id,
      role_id          = excluded.role_id,
      min_discount     = excluded.min_discount,
      steam_enabled    = excluded.steam_enabled,
      epic_enabled     = excluded.epic_enabled,
      xbox_enabled     = excluded.xbox_enabled,
      steam_free_enabled = excluded.steam_free_enabled,
      gog_enabled      = excluded.gog_enabled,
      optin_message_id = excluded.optin_message_id,
      optin_channel_id = excluded.optin_channel_id,
      scan_minutes     = excluded.scan_minutes
  `).bind(
    s.guild_id,
    s.channel_id,
    s.role_id,
    s.min_discount,
    s.steam_enabled,
    s.epic_enabled,
    s.xbox_enabled,
    s.steam_free_enabled ?? 1,
    s.gog_enabled ?? 1,
    s.optin_message_id ?? null,
    s.optin_channel_id ?? null,
    s.scan_minutes ?? 30
  ).run();
}
async function patchGuildSettings(env, guildId, p) {
  await env.DB.prepare(`
    UPDATE guild_settings SET
      channel_id   = COALESCE(?, channel_id),
      min_discount = COALESCE(?, min_discount),
      steam_enabled = COALESCE(?, steam_enabled),
      epic_enabled  = COALESCE(?, epic_enabled),
      xbox_enabled  = COALESCE(?, xbox_enabled),
      steam_free_enabled  = COALESCE(?, steam_free_enabled),
      gog_enabled   = COALESCE(?, gog_enabled),
      scan_minutes  = COALESCE(?, scan_minutes)
    WHERE guild_id = ?
  `).bind(
    p.channel_id ?? null,
    p.min_discount ?? null,
    p.steam_enabled ?? null,
    p.epic_enabled ?? null,
    p.xbox_enabled ?? null,
    p.steam_free_enabled ?? null,
    p.gog_enabled ?? null,
    p.scan_minutes ?? null,
    guildId
  ).run();
}
async function touchGuildScan(env, guildId) {
  await env.DB.prepare(
    `UPDATE guild_settings SET last_scan_at = datetime('now') WHERE guild_id = ?`
  ).bind(guildId).run();
}
async function getGuildAlertMap(env, guildId) {
  const { results } = await env.DB.prepare(
    "SELECT store, game_id, last_alerted_pct FROM deal_alerts WHERE guild_id = ?"
  ).bind(guildId).all();
  return new Map((results ?? []).map((r) => [`${r.store}:${r.game_id}`, r.last_alerted_pct]));
}
async function getRatingMap(env) {
  const { results } = await env.DB.prepare("SELECT app_id, rating FROM steam_ratings").all();
  return new Map((results ?? []).map((r) => [r.app_id, r.rating]));
}
async function saveRating(env, appId, rating) {
  await env.DB.prepare(
    "INSERT INTO steam_ratings (app_id, rating) VALUES (?, ?) ON CONFLICT(app_id) DO UPDATE SET rating = excluded.rating"
  ).bind(String(appId), rating).run();
}
async function markGuildAlerts(env, guildId, deals) {
  if (!deals.length) return;
  const stmt = env.DB.prepare(`
    INSERT INTO deal_alerts (guild_id, store, game_id, last_alerted_pct)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(guild_id, store, game_id) DO UPDATE SET
      last_alerted_pct = MAX(COALESCE(last_alerted_pct, -1), excluded.last_alerted_pct)
  `);
  await env.DB.batch(deals.map((d) => stmt.bind(guildId, d.store, d.id, d.discountPct)));
}
async function getAllDeals(env) {
  const { results } = await env.DB.prepare("SELECT * FROM deals").all();
  return results ?? [];
}
async function upsertDeals(env, deals) {
  if (!deals.length) return;
  const stmt = env.DB.prepare(`
    INSERT INTO deals
      (store, game_id, title, url, image, original_price, sale_price, discount_pct, ends_at, rating, is_free, first_seen, last_seen)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    ON CONFLICT(store, game_id) DO UPDATE SET
      title          = excluded.title,
      url            = excluded.url,
      image          = excluded.image,
      original_price = excluded.original_price,
      sale_price     = excluded.sale_price,
      discount_pct   = excluded.discount_pct,
      ends_at        = excluded.ends_at,
      rating         = excluded.rating,
      is_free        = excluded.is_free,
      last_seen      = datetime('now')
  `);
  const CHUNK = 50;
  for (let i = 0; i < deals.length; i += CHUNK) {
    await env.DB.batch(
      deals.slice(i, i + CHUNK).map((d) => stmt.bind(
        d.store,
        d.id,
        d.title,
        d.url,
        d.image ?? null,
        d.originalPrice,
        d.salePrice,
        d.discountPct,
        d.endsAt ?? null,
        d.rating ?? null,
        d.isFree ? 1 : 0
      ))
    );
  }
}
async function markDealsAlerted(env, deals) {
  if (!deals.length) return;
  const stmt = env.DB.prepare(
    "UPDATE deals SET last_alerted_pct = MAX(COALESCE(last_alerted_pct, -1), ?) WHERE store = ? AND game_id = ?"
  );
  await env.DB.batch(deals.map((d) => stmt.bind(d.discountPct, d.store, d.id)));
}
async function pruneOldDeals(env) {
  await env.DB.prepare(
    `DELETE FROM deals
     WHERE last_seen < datetime('now', '-14 days')
       AND store NOT IN ('steam_free', 'gog')`
  ).run();
  await env.DB.prepare(
    `DELETE FROM deals
     WHERE store IN ('steam_free', 'gog')
       AND last_seen < datetime('now', '-120 days')`
  ).run();
}
async function getRecentDeals(env) {
  const { results } = await env.DB.prepare(
    `SELECT * FROM deals WHERE last_seen > datetime('now', '-2 days') ORDER BY discount_pct DESC`
  ).all();
  return results ?? [];
}
var rowToDeal = (r) => ({
  store: r.store,
  id: r.game_id,
  title: r.title,
  url: r.url,
  image: r.image,
  originalPrice: r.original_price,
  salePrice: r.sale_price,
  discountPct: r.discount_pct,
  endsAt: r.ends_at,
  rating: r.rating,
  isFree: Boolean(r.is_free)
});

// src/embeds.js
var inr = (n) => `\u20B9${Math.round(n).toLocaleString("en-IN")}`;
function buildDealEmbed(deal) {
  const meta = STORES[deal.store] ?? { name: deal.store, color: 5793266 };
  const free = deal.isFree || deal.discountPct >= 100 || deal.salePrice === 0;
  const icon = free ? FREE_EMOJI[deal.store] ?? meta.emoji : meta.emoji;
  const lines = [];
  if (free) {
    lines.push(deal.originalPrice > 0 ? `~~${inr(deal.originalPrice)}~~  \u2192  **FREE**` : "**FREE to keep**");
  } else lines.push(`~~${inr(deal.originalPrice)}~~  \u2192  **${inr(deal.salePrice)}**`);
  if (deal.rating) lines.push(`\u2B50 ${deal.rating}`);
  if (deal.endsAt) {
    const ts = Math.floor(new Date(deal.endsAt).getTime() / 1e3);
    if (Number.isFinite(ts) && ts > 0) lines.push(`\u{1F5D3}\uFE0F Deal ends <t:${ts}:R>`);
  }
  const embed = {
    title: free ? `${icon ?? ""} \u{1F193} FREE \xB7 ${deal.title}`.trimStart() : `${icon ?? ""} \u{1F525} ${deal.discountPct}% OFF \xB7 ${deal.title}`.trimStart(),
    url: deal.url,
    description: lines.join("\n"),
    color: meta.color,
    footer: { text: `${meta.name} \xB7 Prices in INR` },
    timestamp: (/* @__PURE__ */ new Date()).toISOString()
  };
  if (deal.image) embed.image = { url: deal.image };
  return embed;
}
var buyNowButton = (deal, label) => ({
  type: 2,
  style: 5,
  // Link button — opens the store page directly, no interaction cost
  label: label ?? "\u{1F6D2} Buy Now",
  url: deal.url
});
function dealAlertPayload(guildSettings, deal) {
  return {
    content: `<@&${guildSettings.role_id}>`,
    allowed_mentions: { roles: [String(guildSettings.role_id)] },
    embeds: [buildDealEmbed(deal)],
    components: [{ type: 1, components: [buyNowButton(deal)] }]
  };
}
function optInMessagePayload() {
  return {
    embeds: [{
      title: "\u{1F3AE} Game Sale Alerts",
      description: [
        "Click **\u{1F514} Get Sale Alerts** below to get the Game Deals role and be pinged whenever a game goes on sale on:",
        "",
        [
          `${EMOJI.steam} Steam`,
          `${EMOJI.steamFree} Steam Free Games (giveaways & free-to-play)`,
          `${EMOJI.epicFree} Epic Games (incl. weekly **FREE** games)`,
          `${EMOJI.xbox} Xbox / Microsoft Store`,
          `${EMOJI.gogFree} GOG Free Games (Free to Keep giveaways)`
        ].join("   "),
        "",
        "All prices in \u20B9 (INR), every alert has a **\u{1F6D2} Buy Now** button.",
        "Click the button again anytime to unsubscribe."
      ].join("\n"),
      color: 16098851
    }],
    components: [{
      type: 1,
      components: [{ type: 2, style: 2, custom_id: "deals_subscribe", label: "\u{1F514} Get Sale Alerts" }]
    }]
  };
}

// src/commands/deals.js
var clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
var optsToMap = (sub) => Object.fromEntries((sub?.options ?? []).map((o) => [o.name, o.value]));
var storesLine = (s) => Object.values(STORES).map((m) => `${s[m.enabledKey] ? "\u2705" : "\u274C"} ${m.emoji ?? ""} ${m.name}`).join("  \xB7  ");
function handleDealsCommand(interaction, env, ctx) {
  const sub = interaction.data?.options?.[0];
  if (!sub) return ephemeral("\u2753 Unknown subcommand.");
  if (!isGuildAllowed(env, interaction.guild_id)) {
    return ephemeral("\u{1F6AB} This bot is private. It only works in servers the owner added it to.");
  }
  if ((sub.name === "setup" || sub.name === "settings") && !hasManageGuild(interaction)) {
    return ephemeral(`\u{1F6AB} You need the **Manage Server** permission to use \`/deals ${sub.name}\`.`);
  }
  switch (sub.name) {
    case "setup":
      ctx.waitUntil(doSetup(interaction, env, sub));
      return deferredEphemeral();
    case "settings":
      ctx.waitUntil(doSettings(interaction, env, sub));
      return deferredEphemeral();
    case "now":
      return doNow(interaction, env);
    default:
      return ephemeral("\u2753 Unknown subcommand.");
  }
}
async function doSetup(interaction, env, sub) {
  const reply = (payload) => editOriginalResponse(env, interaction.token, payload);
  try {
    const guildId = interaction.guild_id;
    const o = optsToMap(sub);
    const minDiscount = clamp(o.min_discount ?? 50, 1, 100);
    const steam = o.steam ?? true;
    const epic = o.epic ?? true;
    const xbox = o.xbox ?? true;
    const steamFree = o.steam_free ?? true;
    const gog = o.gog ?? true;
    const scanMinutes = clamp(o.scan_minutes ?? 30, 5, 1440);
    const current = await getGuildSettings(env, guildId);
    const role = await findOrCreateDealsRole(env, guildId, ROLE_NAME, ROLE_COLOR);
    const botId = await getBotUserId(env);
    let alertsChannelId = o.channel ?? current?.channel_id ?? null;
    if (alertsChannelId && !await channelExists(env, alertsChannelId)) alertsChannelId = null;
    if (!alertsChannelId) alertsChannelId = (await createChannel(env, guildId, "game-deals")).id;
    await lockChannelToRole(env, alertsChannelId, guildId, role.id, botId);
    if (current?.channel_id && current.channel_id !== alertsChannelId) {
      await unlockChannel(env, current.channel_id, guildId, current.role_id, botId);
    }
    let optinChannelId = current?.optin_channel_id ?? null;
    if (optinChannelId && !await channelExists(env, optinChannelId)) optinChannelId = null;
    if (!optinChannelId) optinChannelId = (await createChannel(env, guildId, "get-sale-alerts")).id;
    await makeChannelReadonly(env, optinChannelId, guildId, botId);
    let optinMessageId = current?.optin_message_id ?? null;
    if (optinMessageId && !await messageExists(env, optinChannelId, optinMessageId)) {
      optinMessageId = null;
    }
    if (!optinMessageId) {
      const optin = await sendMessage(env, optinChannelId, optInMessagePayload());
      optinMessageId = optin?.id ?? null;
    }
    const settings = {
      guild_id: guildId,
      channel_id: alertsChannelId,
      role_id: role.id,
      min_discount: minDiscount,
      steam_enabled: steam ? 1 : 0,
      epic_enabled: epic ? 1 : 0,
      xbox_enabled: xbox ? 1 : 0,
      steam_free_enabled: steamFree ? 1 : 0,
      gog_enabled: gog ? 1 : 0,
      optin_message_id: optinMessageId,
      optin_channel_id: optinChannelId,
      scan_minutes: scanMinutes
    };
    await upsertGuildSettings(env, settings);
    await reply({
      content: [
        "\u2705 **Game sale alerts are set up!**",
        "",
        `\u2022 **Alerts channel:** <#${alertsChannelId}> (only visible to members with the role)`,
        `\u2022 **Subscribe channel:** <#${optinChannelId}> (where members click \u{1F514} to join)`,
        `\u2022 **Alert role:** <@&${role.id}>`,
        `\u2022 **Minimum discount:** ${minDiscount}% (free games always included)`,
        `\u2022 **Stores:** ${storesLine(settings)}`,
        "",
        "Members click **\u{1F514} Get Sale Alerts** in the subscribe channel to subscribe \u2014 the alerts channel then appears for them.",
        "The scanner runs every 5 minutes (your server interval applies to sale alerts; free games always post immediately).",
        "",
        `\u{1F527} Bot permissions in use: ${PERMISSIONS_LINE}`
      ].join("\n")
    });
  } catch (err) {
    console.error("setup failed:", err);
    await reply({
      content: permissionHelp("\u274C **Setup could not be finished.**")
    });
  }
}
async function doSettings(interaction, env, sub) {
  const reply = (payload) => editOriginalResponse(env, interaction.token, payload);
  const guildId = interaction.guild_id;
  const current = await getGuildSettings(env, guildId);
  if (!current) return reply({ content: "\u26A0\uFE0F Sale alerts are not set up yet \u2014 run `/deals setup` first." });
  const o = optsToMap(sub);
  const patch = {};
  if (o.channel !== void 0) {
    patch.channel_id = o.channel;
    try {
      const botId = await getBotUserId(env);
      await lockChannelToRole(env, o.channel, guildId, current.role_id, botId);
      if (current.channel_id && current.channel_id !== o.channel) {
        await unlockChannel(env, current.channel_id, guildId, current.role_id, botId);
      }
    } catch (err) {
      console.error("channel lock failed:", err);
      return reply({
        content: permissionHelp(
          "\u274C **That channel could not be locked to the Game Deals role.**",
          "The bot needs **Manage Channels** and **Manage Roles** in that channel."
        )
      });
    }
  }
  if (o.min_discount !== void 0) patch.min_discount = clamp(o.min_discount, 1, 100);
  if (o.steam !== void 0) patch.steam_enabled = o.steam ? 1 : 0;
  if (o.epic !== void 0) patch.epic_enabled = o.epic ? 1 : 0;
  if (o.xbox !== void 0) patch.xbox_enabled = o.xbox ? 1 : 0;
  if (o.steam_free !== void 0) patch.steam_free_enabled = o.steam_free ? 1 : 0;
  if (o.gog !== void 0) patch.gog_enabled = o.gog ? 1 : 0;
  if (o.scan_minutes !== void 0) patch.scan_minutes = clamp(o.scan_minutes, 5, 1440);
  if (Object.keys(patch).length) await patchGuildSettings(env, guildId, patch);
  const s = await getGuildSettings(env, guildId);
  await reply({
    content: [
      Object.keys(patch).length ? "\u2705 **Settings updated.**" : "\u2699\uFE0F **Current settings** (add options to change them):",
      "",
      `\u2022 **Alerts channel:** <#${s.channel_id}>`,
      `\u2022 **Role:** <@&${s.role_id}>`,
      `\u2022 **Minimum discount:** ${s.min_discount}%`,
      `\u2022 **Scan interval:** every ${s.scan_minutes ?? 30} minutes`,
      `\u2022 **Stores:** ${storesLine(s)}`
    ].join("\n")
  });
}
async function doNow(interaction, env) {
  const settings = await getGuildSettings(env, interaction.guild_id);
  if (!settings) {
    return ephemeral("\u26A0\uFE0F Sale alerts are not set up yet \u2014 an admin needs to run `/deals setup`.");
  }
  const hasRole = (interaction.member?.roles ?? []).includes(settings.role_id);
  if (!hasRole) {
    return ephemeral("\u{1F512} `/deals now` is only for members with the **Game Deals** role. Click **\u{1F514} Get Sale Alerts** in the subscribe channel first!");
  }
  const rows = await getRecentDeals(env);
  let deals = rows.map(rowToDeal);
  if (settings) deals = deals.filter((d) => settings[STORES[d.store]?.enabledKey]);
  const threshold = Math.min(settings?.min_discount ?? 0, 50);
  deals = deals.filter((d) => d.discountPct >= threshold).slice(0, 5);
  if (!deals.length) {
    return ephemeral("\u{1F634} No deals tracked yet \u2014 the scanner runs every 5 minutes. Check back soon!");
  }
  return json({
    type: 4,
    data: {
      content: "\u{1F3AE} **Current top deals:**",
      embeds: deals.map(buildDealEmbed),
      // one action row per deal so each Buy button lines up with its embed
      components: deals.map((d) => ({
        type: 1,
        components: [{ type: 2, style: 5, label: `\u{1F6D2} ${d.title}`.slice(0, 80), url: d.url }]
      })),
      flags: 64
    }
  });
}

// src/components/subscribe.js
async function handleSubscribeButton(interaction, env) {
  if (!isGuildAllowed(env, interaction.guild_id)) {
    return ephemeral("\u{1F6AB} This bot is private.");
  }
  const settings = await getGuildSettings(env, interaction.guild_id);
  if (!settings) {
    return ephemeral("\u26A0\uFE0F Sale alerts are not set up in this server yet \u2014 ask an admin to run `/deals setup`.");
  }
  const userId = interaction.member?.user?.id;
  const hasRole = (interaction.member?.roles ?? []).includes(settings.role_id);
  try {
    if (hasRole) {
      await removeMemberRole(env, interaction.guild_id, userId, settings.role_id);
      return ephemeral("\u{1F515} **Unsubscribed** \u2014 the Game Deals role was removed. You will no longer get sale pings.");
    }
    await addMemberRole(env, interaction.guild_id, userId, settings.role_id);
    return ephemeral("\u{1F514} **Subscribed!** You now have the Game Deals role and will be pinged when games go on sale. The alerts channel should now be visible to you. Click the button again anytime to unsubscribe.");
  } catch (err) {
    console.error("role toggle failed:", err);
    return ephemeral(
      permissionHelp(
        "\u274C **Could not update your role.**",
        "The bot needs **Manage Roles**, and its role must sit above the Game Deals role."
      )
    );
  }
}

// src/stores/steam.js
var FEATURED_URL = "https://store.steampowered.com/api/featuredcategories?cc=in&l=en";
async function fetchSteamDeals() {
  const res = await fetch(FEATURED_URL, {
    headers: { "User-Agent": USER_AGENT, Accept: "application/json" }
  });
  if (!res.ok) throw new Error(`Steam API HTTP ${res.status}`);
  const data = await res.json();
  const items = data?.specials?.items ?? [];
  const deals = [];
  for (const item of items) {
    if (!item?.discounted || !item.discount_percent || !item.id || !item.name) continue;
    const original = (item.original_price ?? 0) / 100;
    const final = (item.final_price ?? 0) / 100;
    if (original <= 0) continue;
    deals.push({
      store: "steam",
      id: String(item.id),
      title: item.name,
      url: `https://store.steampowered.com/app/${item.id}`,
      image: item.large_capsule_image ?? item.header_image ?? null,
      originalPrice: original,
      salePrice: final,
      discountPct: Math.round(item.discount_percent),
      endsAt: item.discount_expiration ? new Date(item.discount_expiration * 1e3).toISOString() : null,
      rating: null,
      // enriched lazily for alerts only (see fetchSteamRating)
      isFree: final === 0
    });
  }
  return deals;
}
async function fetchSteamRating(appId) {
  try {
    const res = await fetch(
      `https://store.steampowered.com/appreviews/${appId}?json=1&language=all&purchase_type=all&num_per_page=0`,
      { headers: { "User-Agent": USER_AGENT } }
    );
    if (!res.ok) return null;
    const summary = (await res.json())?.query_summary;
    if (!summary?.total_reviews) return null;
    return `${summary.review_score_desc} (${summary.total_reviews.toLocaleString("en-IN")} reviews)`;
  } catch {
    return null;
  }
}

// src/stores/epic.js
var FREE_GAMES_URL = "https://store-site-backend-static.ak.epicgames.com/freegamespromotions?locale=en-IN&country=IN&allowCountries=IN";
function pickImage(element) {
  const images = element?.keyImages ?? [];
  const preferred = images.find((i) => i.type === "OfferImageWide") ?? images.find((i) => i.type === "DieselStoreFrontWide") ?? images.find((i) => i.type === "Thumbnail") ?? images[0];
  return preferred?.url ?? null;
}
async function fetchEpicDeals() {
  const res = await fetch(FREE_GAMES_URL, {
    headers: { "User-Agent": USER_AGENT, Accept: "application/json" }
  });
  if (!res.ok) throw new Error(`Epic API HTTP ${res.status}`);
  const data = await res.json();
  const elements = data?.data?.Catalog?.searchStore?.elements ?? [];
  const now = Date.now();
  const deals = [];
  for (const el of elements) {
    const active = (el?.promotions?.promotionalOffers ?? []).flatMap((p) => p.promotionalOffers ?? []).find(
      (o) => o?.discountSetting?.discountPercentage === 0 && Date.parse(o.startDate) <= now && now <= Date.parse(o.endDate)
    );
    if (!active) continue;
    const slug = el.productSlug || el.urlSlug;
    if (!el.title || !el.id || !slug) continue;
    deals.push({
      store: "epic",
      id: String(el.id),
      title: el.title,
      url: `https://store.epicgames.com/en-US/p/${slug}`,
      image: pickImage(el),
      originalPrice: (el?.price?.totalPrice?.originalPrice ?? 0) / 100,
      salePrice: 0,
      discountPct: 100,
      endsAt: active.endDate ? new Date(active.endDate).toISOString() : null,
      rating: null,
      isFree: true
    });
  }
  return deals;
}

// src/stores/xbox.js
var SALES_PAGE = "https://www.xbox.com/en-IN/promotions/sales/sales-and-specials";
function extractBalanced(text2, openIdx) {
  const open = text2[openIdx];
  const close = open === "{" ? "}" : "]";
  let depth = 0, inStr = false, esc = false;
  for (let i = openIdx; i < text2.length; i++) {
    const c = text2[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === open) depth++;
    else if (c === close) {
      depth--;
      if (depth === 0) return text2.slice(openIdx, i + 1);
    }
  }
  return null;
}
function extractAllObjects(text2, key) {
  const hits = [];
  let from = 0;
  while (true) {
    const ki = text2.indexOf(key, from);
    if (ki < 0) break;
    from = ki + key.length;
    const windowText = text2.slice(ki + key.length, ki + key.length + 300);
    const rel = windowText.search(/[{[]/);
    if (rel < 0) continue;
    const raw = extractBalanced(text2, ki + key.length + rel);
    if (raw) {
      try {
        hits.push(JSON.parse(raw));
      } catch {
      }
    }
  }
  return hits;
}
var biggestBy = (hits, scoreFn) => hits.reduce((best, h) => scoreFn(h) > scoreFn(best ?? {}) ? h : best, null);
function parseEndDate(value) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2}):(\d{2})$/.exec(value ?? "");
  if (!m) return null;
  const [, mm, dd, yyyy, hh, mi, ss] = m;
  return new Date(Date.UTC(+yyyy, +mm - 1, +dd, +hh, +mi, +ss)).toISOString();
}
function firstPriceNode(availEntry) {
  if (!availEntry) return null;
  for (const sku of Object.values(availEntry)) {
    for (const node of Object.values(sku ?? {})) {
      if (node?.price?.msrp > 0) return node;
    }
  }
  return null;
}
async function fetchXboxDeals() {
  const res = await fetch(SALES_PAGE, { headers: { "User-Agent": USER_AGENT, Accept: "text/html" } });
  if (!res.ok) throw new Error(`Xbox sales page HTTP ${res.status}`);
  const html = await res.text();
  const channel = biggestBy(
    extractAllObjects(html, '"BROWSE_CHANNELID=DYNAMICCHANNEL.GAMEDEALS'),
    (h) => (h?.data?.products ?? []).length
  );
  const ids = (channel?.data?.products ?? []).map((p) => p.productId).filter(Boolean);
  if (!ids.length) throw new Error("Xbox: no deal products found on the sales page");
  const avail = biggestBy(extractAllObjects(html, '"availabilitySummaries":'), (h) => Object.keys(h ?? {}).length);
  const summaries = biggestBy(extractAllObjects(html, '"productSummaries":'), (h) => Object.keys(h ?? {}).length);
  const deals = [];
  for (const id of ids) {
    const node = firstPriceNode(avail?.[id]);
    const summary = summaries?.[id];
    if (!node || !summary?.title) continue;
    const { listPrice, msrp, discountPercentage, currency } = node.price;
    if (currency !== "INR" || !msrp || msrp <= 0 || listPrice >= msrp) continue;
    const discountPct = Math.max(
      1,
      Math.round(discountPercentage ?? (1 - listPrice / msrp) * 100)
    );
    deals.push({
      store: "xbox",
      id,
      title: summary.title,
      url: `https://www.microsoft.com/store/productId/${id}`,
      image: summary.images?.superHeroArt?.url ?? summary.images?.poster?.url ?? summary.images?.boxArt?.url ?? null,
      originalPrice: msrp,
      salePrice: listPrice,
      discountPct,
      endsAt: parseEndDate(node.endDateUtc ?? node.price.endDateUtc),
      rating: summary.averageRating ? `${summary.averageRating.toFixed(1)}/5${summary.ratingCount ? ` (${Number(summary.ratingCount).toLocaleString("en-IN")} ratings)` : ""}` : null,
      isFree: listPrice === 0
    });
  }
  return deals;
}

// src/stores/steamfree.js
var GIVEAWAY_FEED = "https://www.gamerpower.com/api/giveaways";
var APP_DETAILS = "https://store.steampowered.com/api/appdetails";
var F2P_APPS = [
  { id: 570, name: "Dota 2" },
  { id: 730, name: "Counter-Strike 2" },
  { id: 578080, name: "PUBG: BATTLEGROUNDS" },
  { id: 1172470, name: "Apex Legends" },
  { id: 230410, name: "Warframe" },
  { id: 2357570, name: "Overwatch 2" },
  { id: 238960, name: "Path of Exile" },
  { id: 1085660, name: "Destiny 2" },
  { id: 359550, name: "Tom Clancy\u2019s Rainbow Six Siege" },
  { id: 386360, name: "SMITE" },
  { id: 440, name: "Team Fortress 2" },
  { id: 291550, name: "Brawlhalla" }
];
var USD_TO_INR = 83;
var toINR = (usd) => Math.round(usd * USD_TO_INR);
async function fetchGiveaways() {
  const res = await fetch(GIVEAWAY_FEED, { headers: { "User-Agent": USER_AGENT, Accept: "application/json" } });
  if (!res.ok) throw new Error(`giveaway feed HTTP ${res.status}`);
  const body = await res.json();
  const list = Array.isArray(body) ? body : body?.[0]?.data ?? [];
  const deals = [];
  for (const g of list) {
    if (!/steam/i.test(g.platforms ?? "")) continue;
    if (!g.title || !g.open_giveaway_url && !g.giveaway_url) continue;
    const worthUsd = Number(String(g.worth ?? "").replace(/[^0-9.]/g, "")) || 0;
    const originalPrice = worthUsd > 0 ? toINR(worthUsd) : 0;
    const endsAt = Date.parse(g.end_date ?? "") || null;
    deals.push({
      store: "steam_free",
      id: `giveaway-${g.id ?? g.title}`,
      title: String(g.title).replace(/\s*Giveaway\s*$/i, "").trim(),
      url: g.open_giveaway_url ?? g.giveaway_url,
      image: g.thumbnail ?? g.image ?? null,
      originalPrice,
      // 0 → embed shows plain "FREE"
      salePrice: 0,
      discountPct: 100,
      endsAt: Number.isFinite(endsAt) ? new Date(endsAt).toISOString() : null,
      rating: null,
      isFree: true
    });
  }
  return deals;
}
async function fetchFreeToPlay() {
  const deals = [];
  for (const app of F2P_APPS) {
    try {
      const res = await fetch(`${APP_DETAILS}?appids=${app.id}&cc=IN&l=english`, {
        headers: { "User-Agent": USER_AGENT, Accept: "application/json" }
      });
      if (!res.ok) continue;
      const json2 = await res.json();
      const data = json2?.[app.id]?.data;
      if (!data || json2[app.id].success !== true) continue;
      if (!data.is_free) continue;
      deals.push({
        store: "steam_free",
        id: String(app.id),
        title: data.name ?? app.name,
        url: `https://store.steampowered.com/app/${app.id}/`,
        image: data.header_image ?? null,
        originalPrice: 0,
        salePrice: 0,
        discountPct: 100,
        endsAt: null,
        rating: null,
        isFree: true
      });
    } catch {
    }
  }
  return deals;
}
async function fetchSteamFreeDeals() {
  const results = await Promise.allSettled([fetchGiveaways(), fetchFreeToPlay()]);
  const deals = [];
  for (const r of results) {
    if (r.status === "fulfilled") deals.push(...r.value);
    else console.error(`steam_free source failed \u2014 ${r.reason?.message ?? r.reason}`);
  }
  return deals;
}

// src/stores/gog.js
var LIST_PAGES = [
  "https://www.gog.com/en/games/discounted",
  "https://www.gog.com/en/games?giveaways=true"
];
var FX_URL = "https://open.er-api.com/v6/latest/USD";
var FALLBACK_USD_INR = 97;
var num = (s) => Number(String(s ?? "").replace(/[^0-9.]/g, "")) || 0;
var fxRate = FALLBACK_USD_INR;
var fxFetchedAt = 0;
async function usdToInrRate() {
  if (Date.now() - fxFetchedAt < 864e5) return fxRate;
  try {
    const res = await fetch(FX_URL, { headers: { "User-Agent": USER_AGENT } });
    const rate = (await res.json())?.rates?.INR;
    if (Number.isFinite(rate) && rate > 0) {
      fxRate = rate;
      fxFetchedAt = Date.now();
    }
  } catch {
  }
  return fxRate;
}
var GENERIC_TITLE = /^(dlc|soundtrack|bonus|edition|artbook|manual|demo|ost|bundle|season pass|expansion)(\s*[:\-].*)?$/i;
function parseTile(tile, slug, rate) {
  const inner = (re) => (re.exec(tile)?.[1] ?? "").trim();
  const title = inner(/class="product-tile__title[^"]*"[^>]*\stitle="([^"]+)"/) || inner(/class="product-tile__title[^"]*"[^>]*>([\s\S]*?)<\/div>/).replace(/<[^>]+>/g, "").trim() || inner(/<product-title[^>]*>[\s\S]*?<span[^>]*>([^<]+)<\/span>/);
  const discText = inner(/<price-discount[^>]*>([^<]+)</);
  const baseUsd = num(inner(/<span[^>]*class="base-value[^"]*"[^>]*>([^<]*)</));
  const finalUsd = num(inner(/<span[^>]*class="final-value[^"]*"[^>]*>([^<]*)</));
  const rawImg = inner(/<source[^>]*srcset="(https:\/\/images\.gog[^",]+)/) || inner(/<img[^>]*src="(https:\/\/images\.gog[^"]+)/) || null;
  const image = rawImg && !rawImg.startsWith("data:") ? rawImg : null;
  if (!title || GENERIC_TITLE.test(title.trim()) || /_dlc\b/.test(slug)) return null;
  const discountPct = Math.abs(num(discText));
  const originalPrice = Math.round(baseUsd * rate);
  const isFree = finalUsd === 0 || discountPct >= 100;
  if (!isFree) return null;
  return {
    store: "gog",
    id: slug,
    title,
    url: `https://www.gog.com/en/game/${slug}`,
    image,
    originalPrice,
    salePrice: 0,
    discountPct: 100,
    endsAt: null,
    rating: null,
    isFree: true
  };
}
async function enrichGogImage(deal) {
  if (deal.image) return deal;
  try {
    const res = await fetch(deal.url, { headers: { "User-Agent": USER_AGENT, Accept: "text/html" } });
    if (!res.ok) return deal;
    const html = await res.text();
    const ld = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/i.exec(html)?.[1];
    const image = ld ? JSON.parse(ld)?.image ?? null : null;
    if (typeof image === "string" && image.startsWith("http")) deal.image = image;
    else if (Array.isArray(image) && typeof image[0] === "string") deal.image = image[0];
  } catch {
  }
  return deal;
}
async function fetchGogDeals() {
  const rate = await usdToInrRate();
  const deals = [];
  const seen = /* @__PURE__ */ new Set();
  const results = await Promise.allSettled(
    LIST_PAGES.map((url) => fetch(url, { headers: { "User-Agent": USER_AGENT, Accept: "text/html" } }))
  );
  for (const r of results) {
    if (r.status !== "fulfilled" || !r.value.ok) continue;
    const html = await r.value.text();
    const tiles = html.matchAll(
      /<a[^>]+href="https:\/\/www\.gog\.com\/(?:[a-z]{2}\/)?game\/([a-z0-9_\-]+)"[\s\S]*?<\/a>/gi
    );
    for (const m of tiles) {
      const slug = m[1];
      if (seen.has(slug)) continue;
      seen.add(slug);
      const deal = parseTile(m[0], slug, rate);
      if (deal) deals.push(deal);
    }
  }
  if (!deals.length) throw new Error("GOG: no parsable product tiles found");
  return deals;
}

// src/dealEngine.js
var FETCHERS = {
  steam: fetchSteamDeals,
  epic: fetchEpicDeals,
  xbox: fetchXboxDeals,
  steam_free: fetchSteamFreeDeals,
  gog: fetchGogDeals
};
var RERE_ALERT_MARGIN = 3;
var PRICE_DROP_ALERT = 100;
var isFreeDeal = (d) => d.isFree || d.discountPct >= 100 || d.salePrice === 0;
var storeEnabled = (guild, store) => Boolean(guild[STORES[store]?.enabledKey]);
async function runDealEngine(env) {
  const guilds = await getAllGuildSettings(env);
  const guildsInScope = guilds.filter((g) => isGuildAllowed(env, g.guild_id));
  if (!guildsInScope.length) {
    console.log("deal engine: no guilds configured, skipping run");
    return;
  }
  const wantedFetches = new Set(
    guildsInScope.flatMap((g) => Object.keys(FETCHERS).filter((s) => storeEnabled(g, s))).map((s) => FETCHERS[s]).filter(Boolean)
  );
  const results = await Promise.allSettled([...wantedFetches].map((f) => f()));
  const fetched = [];
  results.forEach((r, i) => {
    if (r.status === "fulfilled") {
      console.log(`deal engine: fetcher #${i} returned ${r.value.length} deals`);
      fetched.push(...r.value);
    } else {
      console.error(`deal engine: fetcher #${i} failed \u2014 ${r.reason?.message ?? r.reason}`);
    }
  });
  if (!fetched.length) {
    console.log("deal engine: all stores failed, nothing to do");
    return;
  }
  const fresh = fetched.filter((d) => d.title && d.url && d.discountPct >= 1 && (d.originalPrice > 0 || isFreeDeal(d)));
  const cap = Math.max(1, parseInt(env.ALERTS_PER_RUN ?? "10", 10) || 10);
  const known = new Map((await getAllDeals(env)).map((d) => [`${d.store}:${d.game_id}`, d]));
  const ratings = await getRatingMap(env);
  const allPosted = [];
  for (const guild of guildsInScope) {
    const intervalMs = Math.max(5, Number(guild.scan_minutes) || 30) * 6e4;
    const lastRun = guild.last_scan_at ? Date.parse(`${String(guild.last_scan_at).replace(" ", "T")}Z`) : 0;
    const sinceLastRun = Date.now() - lastRun;
    const intervalElapsed = sinceLastRun >= intervalMs;
    const seen = await getGuildAlertMap(env, guild.guild_id);
    const baselineRun = seen.size === 0;
    const eligible = fresh.filter((d) => {
      if (!storeEnabled(guild, d.store)) return false;
      const free = isFreeDeal(d);
      if (free) {
        const key = `${d.store}:${d.id}`;
        const prevDeal2 = known.get(key);
        if (!prevDeal2) return true;
        return !isFreeDeal(rowToDeal(prevDeal2));
      }
      if (!intervalElapsed) return false;
      if (d.discountPct < guild.min_discount) return false;
      const prev = seen.get(`${d.store}:${d.id}`);
      if (prev === void 0 || prev === null) return true;
      if (d.discountPct >= prev + RERE_ALERT_MARGIN) return true;
      const prevDeal = known.get(`${d.store}:${d.id}`);
      return Boolean(prevDeal?.sale_price && prevDeal.sale_price - d.salePrice >= PRICE_DROP_ALERT);
    }).sort((a, b) => b.discountPct - a.discountPct || b.originalPrice - a.originalPrice).slice(0, baselineRun ? 0 : cap);
    for (const deal of eligible) {
      try {
        if (deal.store === "steam" && !deal.rating) {
          const key = String(deal.id);
          if (ratings.has(key)) {
            deal.rating = ratings.get(key);
          } else {
            deal.rating = await fetchSteamRating(deal.id);
            if (deal.rating) await saveRating(env, key, deal.rating);
          }
        }
        if (deal.store === "gog" && !deal.image) await enrichGogImage(deal);
        await sendMessage(env, guild.channel_id, dealAlertPayload(guild, deal));
        console.log(`deal engine: alerted "${deal.title}" (${deal.discountPct}% off) \u2192 guild ${guild.guild_id}`);
      } catch (err) {
        console.error(`deal engine: alert to guild ${guild.guild_id} failed \u2014 ${err.message}`);
      }
    }
    await markGuildAlerts(env, guild.guild_id, baselineRun ? fresh.filter((d) => storeEnabled(guild, d.store)) : eligible);
    if (intervalElapsed) await touchGuildScan(env, guild.guild_id);
    allPosted.push(...eligible);
  }
  await upsertDeals(env, fresh);
  await markDealsAlerted(env, allPosted);
  await pruneOldDeals(env);
  console.log(`deal engine: done \u2014 fetched=${fetched.length} posted=${allPosted.length}`);
}

// src/commands/definitions.js
var storeToggle = (name, description) => ({ type: 5, name, description });
var DEALS_COMMAND = {
  name: "deals",
  description: "Game sale alerts (Steam \xB7 Epic \xB7 Xbox \xB7 GOG) \u2014 prices in \u20B9",
  integration_types: [0],
  // guild install
  contexts: [0],
  // guild only
  options: [
    {
      type: 1,
      name: "setup",
      description: "Set up sale alerts for this server (needs Manage Server)",
      options: [
        { type: 7, name: "channel", description: "Alerts channel (optional \u2014 bot creates #game-deals, locked to the role)", channel_types: [0] },
        { type: 4, name: "min_discount", description: "Minimum discount % to alert (default 50)", min_value: 1, max_value: 100 },
        { type: 4, name: "scan_minutes", description: "How often to scan (5-1440, default 30)", min_value: 5, max_value: 1440 },
        storeToggle("steam", "Steam deals (default: on)"),
        storeToggle("epic", "Epic Games free games & deals (default: on)"),
        storeToggle("xbox", "Xbox / Microsoft Store deals (default: on)"),
        storeToggle("steam_free", "Steam giveaways & free-to-play games (default: on)"),
        storeToggle("gog", "GOG free games (default: on)")
      ]
    },
    {
      type: 1,
      name: "settings",
      description: "View or change alert settings (needs Manage Server)",
      options: [
        { type: 7, name: "channel", description: "Move alerts to another channel (it gets locked to the role)", channel_types: [0] },
        { type: 4, name: "min_discount", description: "Minimum discount % to alert", min_value: 1, max_value: 100 },
        { type: 4, name: "scan_minutes", description: "How often to scan (5-1440)", min_value: 5, max_value: 1440 },
        storeToggle("steam", "Steam deals on/off"),
        storeToggle("epic", "Epic Games free games & deals on/off"),
        storeToggle("xbox", "Xbox / Microsoft Store deals on/off"),
        storeToggle("steam_free", "Steam giveaways & free-to-play games on/off"),
        storeToggle("gog", "GOG free games on/off")
      ]
    },
    { type: 1, name: "now", description: "Show the current top deals (only you can see it)" }
  ]
};

// src/setup.js
var SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
  "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'",
  "Cache-Control": "no-store"
};
var text = (body, status = 200, headers = {}) => new Response(body, {
  status,
  headers: { ...SECURITY_HEADERS, "Content-Type": "text/plain; charset=utf-8", ...headers }
});
async function safeEqual(a, b) {
  const enc = new TextEncoder();
  const [ha, hb] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(a ?? "")),
    crypto.subtle.digest("SHA-256", enc.encode(b ?? ""))
  ]);
  const A = new Uint8Array(ha);
  const B = new Uint8Array(hb);
  let diff = 0;
  for (let i = 0; i < A.length; i++) diff |= A[i] ^ B[i];
  return diff === 0;
}
var ATTEMPT_LIMIT = 5;
var ATTEMPT_WINDOW_MS = 10 * 6e4;
var attempts = /* @__PURE__ */ new Map();
function rateLimited(ip) {
  const now = Date.now();
  const entry = attempts.get(ip) ?? { count: 0, resetAt: now + ATTEMPT_WINDOW_MS };
  if (now > entry.resetAt) {
    entry.count = 0;
    entry.resetAt = now + ATTEMPT_WINDOW_MS;
  }
  entry.count += 1;
  attempts.set(ip, entry);
  if (attempts.size > 1e3) {
    for (const [k, v] of attempts) if (now > v.resetAt) attempts.delete(k);
  }
  return { blocked: entry.count > ATTEMPT_LIMIT, retryAfter: Math.ceil((entry.resetAt - now) / 1e3) };
}
var INVITE_PERMISSIONS = (1 << 10) + // View Channels
(1 << 11) + // Send Messages
(1 << 14) + // Embed Links
(1 << 16) + // Read Message History
(1 << 17) + // Mention @everyone, @here and All Roles
(1 << 4) + //  Manage Channels (create + lock the two channels)
(1 << 28);
async function handleSetup(url, env, request) {
  if (env.SETUP_DONE === "1" || env.SETUP_DONE === "true") {
    return text(
      '\u{1F512} Setup is disabled on this bot.\n\n(Set the SETUP_DONE variable to anything other than "1" in Cloudflare to re-enable it.)',
      403
    );
  }
  if (!env.SETUP_KEY) {
    return text(
      '\u26A0\uFE0F SETUP_KEY is not configured.\n\nAdd it in the Cloudflare dashboard:\nWorker \u2192 Settings \u2192 Variables and Secrets \u2192 Add \u2192 type "Secret" \u2192 name SETUP_KEY \u2192 any random value.',
      500
    );
  }
  const ip = request?.headers?.get("cf-connecting-ip") ?? request?.headers?.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const limit = rateLimited(ip);
  if (limit.blocked) {
    return text(
      `\u23F3 Too many attempts. Try again in ${Math.ceil(limit.retryAfter / 60)} minute(s).`,
      429,
      { "Retry-After": String(Math.max(1, limit.retryAfter)) }
    );
  }
  const provided = url.searchParams.get("key") ?? "";
  if (!await safeEqual(provided, env.SETUP_KEY)) {
    return text("\u274C Forbidden \u2014 missing or wrong ?key= parameter.", 403);
  }
  const res = await fetch(
    `https://discord.com/api/v10/applications/${env.DISCORD_APPLICATION_ID}/commands`,
    {
      method: "PUT",
      headers: { Authorization: `Bot ${env.DISCORD_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify([DEALS_COMMAND])
    }
  );
  const body = await res.text();
  if (!res.ok) {
    console.error(`setup: command registration failed \u2014 HTTP ${res.status}: ${body.slice(0, 500)}`);
    return text(
      [
        `\u274C Command registration failed (HTTP ${res.status}).`,
        "",
        "Check the **DISCORD_TOKEN** and **DISCORD_APPLICATION_ID** secrets in",
        "Cloudflare \u2192 your Worker \u2192 Settings \u2192 Variables and Secrets.",
        "If you recently reset the bot token, update DISCORD_TOKEN and try again."
      ].join("\n"),
      500
    );
  }
  const invite = `https://discord.com/oauth2/authorize?client_id=${env.DISCORD_APPLICATION_ID}&scope=bot+applications.commands&permissions=${INVITE_PERMISSIONS}`;
  return text([
    "\u2705 /deals command registered with Discord!",
    "",
    "Next steps:",
    `1. Invite the bot to your server: ${invite}`,
    "2. In your server, run: /deals setup",
    "3. Members click \u{1F514} Get Sale Alerts to subscribe.",
    "",
    "Bot permissions to enable on the bot role:",
    PERMISSIONS_LINE,
    "",
    '\u{1F512} Recommended: set a SETUP_DONE variable to "1" in Cloudflare to close this page off.',
    "Note: global commands can take up to 1 hour to appear in Discord."
  ].join("\n"));
}

// src/index.js
var MAX_BODY_BYTES = 128 * 1024;
var SECURITY_HEADERS2 = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
  "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'",
  "Cache-Control": "no-store"
};
var secured = (body, status = 200, headers = {}) => new Response(body, { status, headers: { ...SECURITY_HEADERS2, ...headers } });
var index_default = {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/setup") {
      return handleSetup(url, env, request);
    }
    if (request.method === "GET") {
      return secured("\u{1F3AE} Game Deals Bot is running. Set this URL as your Discord Interactions Endpoint.");
    }
    if (request.method !== "POST" || url.pathname !== "/") {
      return secured("Not found", 404);
    }
    const declaredLength = Number(request.headers.get("content-length") ?? 0);
    if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
      return secured("payload too large", 413);
    }
    const { ok, body } = await verifyDiscordRequest(request, env.DISCORD_PUBLIC_KEY);
    if (!ok) return secured("invalid request signature", 401);
    if (body.length > MAX_BODY_BYTES) return secured("payload too large", 413);
    let interaction;
    try {
      interaction = JSON.parse(body);
    } catch {
      return secured("bad request body", 400);
    }
    if (interaction.type === 1) return json({ type: 1 });
    if (interaction.type === 2 && interaction.data?.name === "deals") {
      return handleDealsCommand(interaction, env, ctx);
    }
    if (interaction.type === 3 && interaction.data?.custom_id === "deals_subscribe") {
      return handleSubscribeButton(interaction, env);
    }
    return ephemeral("\u2753 Unknown interaction.");
  },
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runDealEngine(env));
  }
};
export {
  index_default as default
};
