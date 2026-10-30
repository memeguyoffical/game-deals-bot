// Steam — official storefront API, INR region (cc=in).
// Returns normalized deals: { store, id, title, url, image, originalPrice, salePrice, discountPct, endsAt, rating, isFree }

import { USER_AGENT } from '../config.js';

const FEATURED_URL = 'https://store.steampowered.com/api/featuredcategories?cc=in&l=en';

export async function fetchSteamDeals() {
  const res = await fetch(FEATURED_URL, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
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
      store: 'steam',
      id: String(item.id),
      title: item.name,
      url: `https://store.steampowered.com/app/${item.id}`,
      image: item.large_capsule_image ?? item.header_image ?? null,
      originalPrice: original,
      salePrice: final,
      discountPct: Math.round(item.discount_percent),
      endsAt: item.discount_expiration ? new Date(item.discount_expiration * 1000).toISOString() : null,
      rating: null, // enriched lazily for alerts only (see fetchSteamRating)
      isFree: final === 0,
    });
  }
  return deals;
}

// Called only for the few deals we actually alert about (keeps request counts tiny).
export async function fetchSteamRating(appId) {
  try {
    const res = await fetch(
      `https://store.steampowered.com/appreviews/${appId}?json=1&language=all&purchase_type=all&num_per_page=0`,
      { headers: { 'User-Agent': USER_AGENT } },
    );
    if (!res.ok) return null;
    const summary = (await res.json())?.query_summary;
    if (!summary?.total_reviews) return null;
    return `${summary.review_score_desc} (${summary.total_reviews.toLocaleString('en-IN')} reviews)`;
  } catch {
    return null;
  }
}
