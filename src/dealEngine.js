// The deal engine — runs on the cron schedule (every 5 min).
// Fetches every enabled store in parallel, then pings each server's Game Deals
// role about new / deeper / cheaper deals, gated by that server's scan interval.

import { STORES } from './config.js';
import { fetchSteamDeals, fetchSteamRating } from './stores/steam.js';
import { fetchEpicDeals } from './stores/epic.js';
import { fetchXboxDeals } from './stores/xbox.js';
import { fetchSteamFreeDeals } from './stores/steamfree.js';
import { fetchGogDeals, enrichGogImage } from './stores/gog.js';
import {
  getAllGuildSettings,
  getAllDeals,
  upsertDeals,
  markDealsAlerted,
  pruneOldDeals,
  getGuildAlertMap,
  markGuildAlerts,
  touchGuildScan,
  getRatingMap,
  saveRating,
  rowToDeal,
} from './db.js';
import { sendMessage } from './discord.js';
import { dealAlertPayload } from './embeds.js';
import { isGuildAllowed } from './util.js';

const FETCHERS = {
  steam: fetchSteamDeals,
  epic: fetchEpicDeals,
  xbox: fetchXboxDeals,
  steam_free: fetchSteamFreeDeals,
  gog: fetchGogDeals,
};

// A deal re-alerts when its discount grew by at least this many points.
const RERE_ALERT_MARGIN = 3;

// ...or when the price dropped by at least this much rupees, even if the
// percentage badge didn't move (some stores quietly cut prices).
const PRICE_DROP_ALERT = 100;

// Free games never wait for the server's scan interval.
const isFreeDeal = (d) => d.isFree || d.discountPct >= 100 || d.salePrice === 0;

const storeEnabled = (guild, store) => Boolean(guild[STORES[store]?.enabledKey]);

export async function runDealEngine(env) {
  const guilds = await getAllGuildSettings(env);
  const guildsInScope = guilds.filter((g) => isGuildAllowed(env, g.guild_id));
  if (!guildsInScope.length) {
    console.log('deal engine: no guilds configured, skipping run');
    return;
  }

  // Only fetch stores that at least one in-scope guild has enabled.
  const wantedFetches = new Set(
    guildsInScope.flatMap((g) => Object.keys(FETCHERS).filter((s) => storeEnabled(g, s)))
      .map((s) => FETCHERS[s])
      .filter(Boolean),
  );

  // Run every store fetch in parallel — total time = slowest store, not the sum.
  const results = await Promise.allSettled([...wantedFetches].map((f) => f()));
  const fetched = [];
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') {
      console.log(`deal engine: fetcher #${i} returned ${r.value.length} deals`);
      fetched.push(...r.value);
    } else {
      console.error(`deal engine: fetcher #${i} failed — ${r.reason?.message ?? r.reason}`);
    }
  });
  if (!fetched.length) {
    console.log('deal engine: all stores failed, nothing to do');
    return;
  }

  const fresh = fetched.filter((d) => d.title && d.url && d.discountPct >= 1 && (d.originalPrice > 0 || isFreeDeal(d)));

  // Per-guild: only alert when that server's scan interval has elapsed (free
  // games excepted), and use its own deal memory so nothing is lost when
  // another server scans more often.
  const cap = Math.max(1, parseInt(env.ALERTS_PER_RUN ?? '10', 10) || 10);
  const known = new Map((await getAllDeals(env)).map((d) => [`${d.store}:${d.game_id}`, d]));
  const ratings = await getRatingMap(env);
  const allPosted = [];

  for (const guild of guildsInScope) {
    const intervalMs = Math.max(5, Number(guild.scan_minutes) || 30) * 60_000;
    const lastRun = guild.last_scan_at
      ? Date.parse(`${String(guild.last_scan_at).replace(' ', 'T')}Z`)
      : 0;
    const sinceLastRun = Date.now() - lastRun;
    const intervalElapsed = sinceLastRun >= intervalMs;

    // Free games bypass the interval: cheap to check, and never worth waiting for.
    const seen = await getGuildAlertMap(env, guild.guild_id);

    // Baseline mode: on a guild's very first run we only record what exists
    // instead of posting it. Otherwise every long-running sale would flood the
    // channel as "new". From the next run on, only genuinely new deals alert.
    const baselineRun = seen.size === 0;

    const eligible = fresh
      .filter((d) => {
        if (!storeEnabled(guild, d.store)) return false;
        const free = isFreeDeal(d);

        if (free) {
          // Free games only alert when they are genuinely NEW to the bot, or when
          // a game we already track has just dropped to free. The standing
          // free-to-play catalogue therefore announces each title just once.
          const key = `${d.store}:${d.id}`;
          const prevDeal = known.get(key);
          if (!prevDeal) return true; // never seen before → announce it
          return !isFreeDeal(rowToDeal(prevDeal)); // known, but only just went free
        }
        if (!intervalElapsed) return false;
        if (d.discountPct < guild.min_discount) return false;

        const prev = seen.get(`${d.store}:${d.id}`);
        if (prev === undefined || prev === null) return true; // never alerted here
        if (d.discountPct >= prev + RERE_ALERT_MARGIN) return true; // deeper discount

        // Same percentage, but a meaningfully lower price than last time.
        const prevDeal = known.get(`${d.store}:${d.id}`);
        return Boolean(prevDeal?.sale_price && prevDeal.sale_price - d.salePrice >= PRICE_DROP_ALERT);
      })
      .sort((a, b) => b.discountPct - a.discountPct || b.originalPrice - a.originalPrice)
      .slice(0, baselineRun ? 0 : cap);

    for (const deal of eligible) {
      try {
        if (deal.store === 'steam' && !deal.rating) {
          const key = String(deal.id);
          if (ratings.has(key)) {
            deal.rating = ratings.get(key);
          } else {
            deal.rating = await fetchSteamRating(deal.id);
            if (deal.rating) await saveRating(env, key, deal.rating);
          }
        }
        // Cover art for GOG is lazy-loaded; fill it in only for what we post.
        if (deal.store === 'gog' && !deal.image) await enrichGogImage(deal);
        await sendMessage(env, guild.channel_id, dealAlertPayload(guild, deal));
        console.log(`deal engine: alerted "${deal.title}" (${deal.discountPct}% off) → guild ${guild.guild_id}`);
      } catch (err) {
        console.error(`deal engine: alert to guild ${guild.guild_id} failed — ${err.message}`);
      }
    }

    // Baseline run: remember everything without posting, so the next run can
    // tell genuinely new deals apart from long-running sales.
    await markGuildAlerts(env, guild.guild_id, baselineRun ? fresh.filter((d) => storeEnabled(guild, d.store)) : eligible);
    if (intervalElapsed) await touchGuildScan(env, guild.guild_id);
    allPosted.push(...eligible);
  }

  await upsertDeals(env, fresh);
  await markDealsAlerted(env, allPosted);
  await pruneOldDeals(env);
  console.log(`deal engine: done — fetched=${fetched.length} posted=${allPosted.length}`);
}