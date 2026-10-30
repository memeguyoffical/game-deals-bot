// Epic Games — public free-games promotions endpoint (IN region, INR prices).
//
// NOTE: Epic's full storefront GraphQL API sits behind a Cloudflare bot challenge
// and cannot be called from a Worker. Their static promotions endpoint works fine,
// so this fetcher covers Epic's free games (their most popular alerts by far).

import { USER_AGENT } from '../config.js';

const FREE_GAMES_URL =
  'https://store-site-backend-static.ak.epicgames.com/freegamespromotions?locale=en-IN&country=IN&allowCountries=IN';

function pickImage(element) {
  const images = element?.keyImages ?? [];
  const preferred =
    images.find((i) => i.type === 'OfferImageWide') ??
    images.find((i) => i.type === 'DieselStoreFrontWide') ??
    images.find((i) => i.type === 'Thumbnail') ??
    images[0];
  return preferred?.url ?? null;
}

export async function fetchEpicDeals() {
  const res = await fetch(FREE_GAMES_URL, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`Epic API HTTP ${res.status}`);
  const data = await res.json();

  const elements = data?.data?.Catalog?.searchStore?.elements ?? [];
  const now = Date.now();
  const deals = [];

  for (const el of elements) {
    // A game is currently free when it has an active promo with 0% "price" (100% off).
    const active = (el?.promotions?.promotionalOffers ?? [])
      .flatMap((p) => p.promotionalOffers ?? [])
      .find(
        (o) =>
          o?.discountSetting?.discountPercentage === 0 &&
          Date.parse(o.startDate) <= now &&
          now <= Date.parse(o.endDate),
      );
    if (!active) continue;

    const slug = el.productSlug || el.urlSlug;
    if (!el.title || !el.id || !slug) continue;

    deals.push({
      store: 'epic',
      id: String(el.id),
      title: el.title,
      url: `https://store.epicgames.com/en-US/p/${slug}`,
      image: pickImage(el),
      originalPrice: (el?.price?.totalPrice?.originalPrice ?? 0) / 100,
      salePrice: 0,
      discountPct: 100,
      endsAt: active.endDate ? new Date(active.endDate).toISOString() : null,
      rating: null,
      isFree: true,
    });
  }
  return deals;
}
