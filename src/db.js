// All D1 (SQLite) access lives here.

// ---------- guild settings ----------

export async function getGuildSettings(env, guildId) {
  return env.DB.prepare('SELECT * FROM guild_settings WHERE guild_id = ?').bind(guildId).first();
}

export async function getAllGuildSettings(env) {
  const { results } = await env.DB.prepare('SELECT * FROM guild_settings').all();
  return results ?? [];
}

export async function upsertGuildSettings(env, s) {
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
    s.guild_id, s.channel_id, s.role_id, s.min_discount,
    s.steam_enabled, s.epic_enabled, s.xbox_enabled,
    s.steam_free_enabled ?? 1,
    s.gog_enabled ?? 1,
    s.optin_message_id ?? null,
    s.optin_channel_id ?? null,
    s.scan_minutes ?? 30,
  ).run();
}

// Only the provided fields are updated (COALESCE keeps existing values otherwise).
export async function patchGuildSettings(env, guildId, p) {
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
    guildId,
  ).run();
}

// Stamp a guild's last scan time (called by the deal engine after a run).
export async function touchGuildScan(env, guildId) {
  await env.DB.prepare(
    `UPDATE guild_settings SET last_scan_at = datetime('now') WHERE guild_id = ?`,
  ).bind(guildId).run();
}

// ---------- per-guild alert memory ----------

export async function getGuildAlertMap(env, guildId) {
  const { results } = await env.DB.prepare(
    'SELECT store, game_id, last_alerted_pct FROM deal_alerts WHERE guild_id = ?',
  ).bind(guildId).all();
  return new Map((results ?? []).map((r) => [`${r.store}:${r.game_id}`, r.last_alerted_pct]));
}

// ---------- rating cache ----------

export async function getRatingMap(env) {
  const { results } = await env.DB.prepare('SELECT app_id, rating FROM steam_ratings').all();
  return new Map((results ?? []).map((r) => [r.app_id, r.rating]));
}

export async function saveRating(env, appId, rating) {
  await env.DB.prepare(
    'INSERT INTO steam_ratings (app_id, rating) VALUES (?, ?) ON CONFLICT(app_id) DO UPDATE SET rating = excluded.rating',
  ).bind(String(appId), rating).run();
}

export async function markGuildAlerts(env, guildId, deals) {
  if (!deals.length) return;
  const stmt = env.DB.prepare(`
    INSERT INTO deal_alerts (guild_id, store, game_id, last_alerted_pct)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(guild_id, store, game_id) DO UPDATE SET
      last_alerted_pct = MAX(COALESCE(last_alerted_pct, -1), excluded.last_alerted_pct)
  `);
  await env.DB.batch(deals.map((d) => stmt.bind(guildId, d.store, d.id, d.discountPct)));
}

// ---------- deals ----------

export async function getAllDeals(env) {
  const { results } = await env.DB.prepare('SELECT * FROM deals').all();
  return results ?? [];
}

export async function upsertDeals(env, deals) {
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
        d.store, d.id, d.title, d.url, d.image ?? null,
        d.originalPrice, d.salePrice, d.discountPct,
        d.endsAt ?? null, d.rating ?? null, d.isFree ? 1 : 0,
      )),
    );
  }
}

// Remember the deepest discount we have ever alerted for each deal.
export async function markDealsAlerted(env, deals) {
  if (!deals.length) return;
  const stmt = env.DB.prepare(
    'UPDATE deals SET last_alerted_pct = MAX(COALESCE(last_alerted_pct, -1), ?) WHERE store = ? AND game_id = ?',
  );
  await env.DB.batch(deals.map((d) => stmt.bind(d.discountPct, d.store, d.id)));
}

// Free-game rows are kept much longer so the "already seen it" memory never
// resets (otherwise an old free-to-play title would look new again and re-alert).
export async function pruneOldDeals(env) {
  await env.DB.prepare(
    `DELETE FROM deals
     WHERE last_seen < datetime('now', '-14 days')
       AND store NOT IN ('steam_free', 'gog')`,
  ).run();
  await env.DB.prepare(
    `DELETE FROM deals
     WHERE store IN ('steam_free', 'gog')
       AND last_seen < datetime('now', '-120 days')`,
  ).run();
}

export async function getRecentDeals(env) {
  const { results } = await env.DB.prepare(
    `SELECT * FROM deals WHERE last_seen > datetime('now', '-2 days') ORDER BY discount_pct DESC`,
  ).all();
  return results ?? [];
}

// DB row (snake_case) → normalized deal (camelCase) used by embed builders.
export const rowToDeal = (r) => ({
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
  isFree: Boolean(r.is_free),
});
