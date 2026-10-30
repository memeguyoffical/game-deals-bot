// Steam free games — two sources:
//   1) Temporary giveaways (limited-time free Steam keys) from a free public
//      giveaway feed (no API key). Steam has no official giveaway list API.
//   2) Permanently free-to-play titles verified against Steam's official
//      appdetails API (curated list of popular F2P games).
//
// Both are emitted as store 'steam_free' so they share one toggle and one
// alert style (same as Epic free games).

import { USER_AGENT } from '../config.js';

const GIVEAWAY_FEED = 'https://www.gamerpower.com/api/giveaways';
const APP_DETAILS = 'https://store.steampowered.com/api/appdetails';

// Popular free-to-play titles on Steam (curated — Steam has no public F2P list).
// App IDs verified against Steam's official appdetails API (only titles that
// actually report is_free = true are alerted).
const F2P_APPS = [
  { id: 570, name: 'Dota 2' },
  { id: 730, name: 'Counter-Strike 2' },
  { id: 578080, name: 'PUBG: BATTLEGROUNDS' },
  { id: 1172470, name: 'Apex Legends' },
  { id: 230410, name: 'Warframe' },
  { id: 2357570, name: 'Overwatch 2' },
  { id: 238960, name: 'Path of Exile' },
  { id: 1085660, name: 'Destiny 2' },
  { id: 359550, name: 'Tom Clancy’s Rainbow Six Siege' },
  { id: 386360, name: 'SMITE' },
  { id: 440, name: 'Team Fortress 2' },
  { id: 291550, name: 'Brawlhalla' },
];

// Rough USD → INR rate; only used to show an approximate "was ₹X" on giveaways.
const USD_TO_INR = 83;

const toINR = (usd) => Math.round(usd * USD_TO_INR);

async function fetchGiveaways() {
  const res = await fetch(GIVEAWAY_FEED, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' } });
  if (!res.ok) throw new Error(`giveaway feed HTTP ${res.status}`);
  const body = await res.json();
  const list = Array.isArray(body) ? body : body?.[0]?.data ?? [];

  const deals = [];
  for (const g of list) {
    if (!/steam/i.test(g.platforms ?? '')) continue;
    if (!g.title || !g.open_giveaway_url && !g.giveaway_url) continue;

    const worthUsd = Number(String(g.worth ?? '').replace(/[^0-9.]/g, '')) || 0;
    const originalPrice = worthUsd > 0 ? toINR(worthUsd) : 0;
    const endsAt = Date.parse(g.end_date ?? '') || null;

    deals.push({
      store: 'steam_free',
      id: `giveaway-${g.id ?? g.title}`,
      title: String(g.title).replace(/\s*Giveaway\s*$/i, '').trim(),
      url: g.open_giveaway_url ?? g.giveaway_url,
      image: g.thumbnail ?? g.image ?? null,
      originalPrice,          // 0 → embed shows plain "FREE"
      salePrice: 0,
      discountPct: 100,
      endsAt: Number.isFinite(endsAt) ? new Date(endsAt).toISOString() : null,
      rating: null,
      isFree: true,
    });
  }
  return deals;
}

async function fetchFreeToPlay() {
  const deals = [];
  for (const app of F2P_APPS) {
    try {
      const res = await fetch(`${APP_DETAILS}?appids=${app.id}&cc=IN&l=english`, {
        headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      });
      if (!res.ok) continue;
      const json = await res.json();
      const data = json?.[app.id]?.data;
      if (!data || json[app.id].success !== true) continue;
      if (!data.is_free) continue; // only actually-free titles

      deals.push({
        store: 'steam_free',
        id: String(app.id),
        title: data.name ?? app.name,
        url: `https://store.steampowered.com/app/${app.id}/`,
        image: data.header_image ?? null,
        originalPrice: 0,
        salePrice: 0,
        discountPct: 100,
        endsAt: null,
        rating: null,
        isFree: true,
      });
    } catch {
      // One bad app id must never break the rest.
    }
  }
  return deals;
}

export async function fetchSteamFreeDeals() {
  const results = await Promise.allSettled([fetchGiveaways(), fetchFreeToPlay()]);
  const deals = [];
  for (const r of results) {
    if (r.status === 'fulfilled') deals.push(...r.value);
    else console.error(`steam_free source failed — ${r.reason?.message ?? r.reason}`);
  }
  return deals;
}