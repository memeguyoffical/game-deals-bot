// Xbox / Microsoft Store — the public "Sales & Specials" page embeds its full
// deal catalog (prices, discount %, end dates, titles, images, ratings) as JSON
// in window.__PRELOADED_STATE__. We fetch the page and lift that data out.
// All prices come back natively in INR (en-IN locale page).

import { USER_AGENT } from '../config.js';

const SALES_PAGE = 'https://www.xbox.com/en-IN/promotions/sales/sales-and-specials';

// --- tiny extractor for JS-object blobs embedded in HTML -------------------

function extractBalanced(text, openIdx) {
  const open = text[openIdx];
  const close = open === '{' ? '}' : ']';
  let depth = 0, inStr = false, esc = false;
  for (let i = openIdx; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === open) depth++;
    else if (c === close) {
      depth--;
      if (depth === 0) return text.slice(openIdx, i + 1);
    }
  }
  return null;
}

// Finds every occurrence of `key`, parses the object/array that follows it.
// `key` may be a prefix (the actual JSON key may carry a dynamic suffix).
function extractAllObjects(text, key) {
  const hits = [];
  let from = 0;
  while (true) {
    const ki = text.indexOf(key, from);
    if (ki < 0) break;
    from = ki + key.length;
    const windowText = text.slice(ki + key.length, ki + key.length + 300);
    const rel = windowText.search(/[{[]/);
    if (rel < 0) continue;
    const raw = extractBalanced(text, ki + key.length + rel);
    if (raw) {
      try { hits.push(JSON.parse(raw)); } catch { /* non-JSON blob — skip */ }
    }
  }
  return hits;
}

const biggestBy = (hits, scoreFn) =>
  hits.reduce((best, h) => (scoreFn(h) > scoreFn(best ?? {}) ? h : best), null);

// "10/08/2026 09:59:59" (MM/DD/YYYY, UTC) → ISO string
function parseEndDate(value) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2}):(\d{2})$/.exec(value ?? '');
  if (!m) return null;
  const [, mm, dd, yyyy, hh, mi, ss] = m;
  return new Date(Date.UTC(+yyyy, +mm - 1, +dd, +hh, +mi, +ss)).toISOString();
}

// availabilitySummaries shape: { productId: { skuId: { availabilityId: node } } }
function firstPriceNode(availEntry) {
  if (!availEntry) return null;
  for (const sku of Object.values(availEntry)) {
    for (const node of Object.values(sku ?? {})) {
      if (node?.price?.msrp > 0) return node;
    }
  }
  return null;
}

export async function fetchXboxDeals() {
  const res = await fetch(SALES_PAGE, { headers: { 'User-Agent': USER_AGENT, Accept: 'text/html' } });
  if (!res.ok) throw new Error(`Xbox sales page HTTP ${res.status}`);
  const html = await res.text();

  // 1) which products are in the "Game deals" channel right now
  const channel = biggestBy(
    extractAllObjects(html, '"BROWSE_CHANNELID=DYNAMICCHANNEL.GAMEDEALS'),
    (h) => (h?.data?.products ?? []).length,
  );
  const ids = (channel?.data?.products ?? []).map((p) => p.productId).filter(Boolean);
  if (!ids.length) throw new Error('Xbox: no deal products found on the sales page');

  // 2) prices and metadata (both appear twice in the page — empty scaffold + real data)
  const avail = biggestBy(extractAllObjects(html, '"availabilitySummaries":'), (h) => Object.keys(h ?? {}).length);
  const summaries = biggestBy(extractAllObjects(html, '"productSummaries":'), (h) => Object.keys(h ?? {}).length);

  const deals = [];
  for (const id of ids) {
    const node = firstPriceNode(avail?.[id]);
    const summary = summaries?.[id];
    if (!node || !summary?.title) continue;

    const { listPrice, msrp, discountPercentage, currency } = node.price;
    if (currency !== 'INR' || !msrp || msrp <= 0 || listPrice >= msrp) continue;

    const discountPct = Math.max(
      1,
      Math.round(discountPercentage ?? (1 - listPrice / msrp) * 100),
    );

    deals.push({
      store: 'xbox',
      id,
      title: summary.title,
      url: `https://www.microsoft.com/store/productId/${id}`,
      image:
        summary.images?.superHeroArt?.url ??
        summary.images?.poster?.url ??
        summary.images?.boxArt?.url ??
        null,
      originalPrice: msrp,
      salePrice: listPrice,
      discountPct,
      endsAt: parseEndDate(node.endDateUtc ?? node.price.endDateUtc),
      rating: summary.averageRating
        ? `${summary.averageRating.toFixed(1)}/5${
            summary.ratingCount ? ` (${Number(summary.ratingCount).toLocaleString('en-IN')} ratings)` : ''
          }`
        : null,
      isFree: listPrice === 0,
    });
  }
  return deals;
}
