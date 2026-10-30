// GOG — sale scanner + free games.
//
// GOG has no public deals API (their catalogue API needs OAuth). Their listing
// pages, however, render each product tile server-side with title, base price,
// final price and discount — so we parse those, exactly like the Xbox fetcher
// lifts embedded JSON.
//
// Prices come back in USD; we convert to INR with a free FX endpoint and fall
// back to a fixed rate if it's unavailable. Tiles priced at $0 / 100% off are
// flagged as free so they alert as "FREE to keep".

import { USER_AGENT } from '../config.js';

const LIST_PAGES = [
  'https://www.gog.com/en/games/discounted',
  'https://www.gog.com/en/games?giveaways=true',
];
const FX_URL = 'https://open.er-api.com/v6/latest/USD';
const FALLBACK_USD_INR = 97;

const num = (s) => Number(String(s ?? '').replace(/[^0-9.]/g, '')) || 0;

let fxRate = FALLBACK_USD_INR;
let fxFetchedAt = 0;

async function usdToInrRate() {
  // Refresh the rate at most once a day.
  if (Date.now() - fxFetchedAt < 86_400_000) return fxRate;
  try {
    const res = await fetch(FX_URL, { headers: { 'User-Agent': USER_AGENT } });
    const rate = (await res.json())?.rates?.INR;
    if (Number.isFinite(rate) && rate > 0) {
      fxRate = rate;
      fxFetchedAt = Date.now();
    }
  } catch {
    // keep whatever we had
  }
  return fxRate;
}

// Generic label tiles (DLC, Soundtrack, …) aren't standalone games.
const GENERIC_TITLE = /^(dlc|soundtrack|bonus|edition|artbook|manual|demo|ost|bundle|season pass|expansion)(\s*[:\-].*)?$/i;

function parseTile(tile, slug, rate) {
  const inner = (re) => (re.exec(tile)?.[1] ?? '').trim();

  // The reliable name lives in the title attribute on product-tile__title.
  // The first <span> inside a tile is often just a label ("DLC").
  const title =
    inner(/class="product-tile__title[^"]*"[^>]*\stitle="([^"]+)"/) ||
    inner(/class="product-tile__title[^"]*"[^>]*>([\s\S]*?)<\/div>/).replace(/<[^>]+>/g, '').trim() ||
    inner(/<product-title[^>]*>[\s\S]*?<span[^>]*>([^<]+)<\/span>/);

  const discText = inner(/<price-discount[^>]*>([^<]+)</);
  const baseUsd = num(inner(/<span[^>]*class="base-value[^"]*"[^>]*>([^<]*)</));
  const finalUsd = num(inner(/<span[^>]*class="final-value[^"]*"[^>]*>([^<]*)</));

  // GOG lazy-loads covers: most tiles only carry a 1×1 transparent placeholder,
  // so we defer those to enrichGogImage() when the deal is actually alerted.
  const rawImg =
    inner(/<source[^>]*srcset="(https:\/\/images\.gog[^",]+)/) ||
    inner(/<img[^>]*src="(https:\/\/images\.gog[^"]+)/) ||
    null;
  const image = rawImg && !rawImg.startsWith('data:') ? rawImg : null;

  if (!title || GENERIC_TITLE.test(title.trim()) || /_dlc\b/.test(slug)) return null;

  const discountPct = Math.abs(num(discText));
  const originalPrice = Math.round(baseUsd * rate);

  // Free games only — GOG paid sales are intentionally not reported.
  const isFree = finalUsd === 0 || discountPct >= 100;
  if (!isFree) return null;

  return {
    store: 'gog',
    id: slug,
    title,
    url: `https://www.gog.com/en/game/${slug}`,
    image,
    originalPrice,
    salePrice: 0,
    discountPct: 100,
    endsAt: null,
    rating: null,
    isFree: true,
  };
}

// GOG listing pages lazy-load cover art (1×1 placeholder), so for deals we are
// about to alert we fetch the product page and read its schema.org JSON-LD image.
// Capped per run to keep request counts (and scan time) tiny.
export async function enrichGogImage(deal) {
  if (deal.image) return deal;
  try {
    const res = await fetch(deal.url, { headers: { 'User-Agent': USER_AGENT, Accept: 'text/html' } });
    if (!res.ok) return deal;
    const html = await res.text();
    const ld = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/i.exec(html)?.[1];
    const image = ld ? (JSON.parse(ld)?.image ?? null) : null;
    if (typeof image === 'string' && image.startsWith('http')) deal.image = image;
    else if (Array.isArray(image) && typeof image[0] === 'string') deal.image = image[0];
  } catch {
    // Cover art is cosmetic — never let it block an alert.
  }
  return deal;
}

export async function fetchGogDeals() {
  const rate = await usdToInrRate();
  const deals = [];
  const seen = new Set();

  const results = await Promise.allSettled(
    LIST_PAGES.map((url) => fetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'text/html' } })),
  );

  for (const r of results) {
    if (r.status !== 'fulfilled' || !r.value.ok) continue;
    const html = await r.value.text();

    const tiles = html.matchAll(
      /<a[^>]+href="https:\/\/www\.gog\.com\/(?:[a-z]{2}\/)?game\/([a-z0-9_\-]+)"[\s\S]*?<\/a>/gi,
    );
    for (const m of tiles) {
      const slug = m[1];
      if (seen.has(slug)) continue;
      seen.add(slug);
      const deal = parseTile(m[0], slug, rate);
      if (deal) deals.push(deal);
    }
  }

  if (!deals.length) throw new Error('GOG: no parsable product tiles found');
  return deals;
}