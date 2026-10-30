// Discord embed + message builders.

import { STORES, EMOJI, FREE_EMOJI } from './config.js';

export const inr = (n) => `₹${Math.round(n).toLocaleString('en-IN')}`;

export function buildDealEmbed(deal) {
  const meta = STORES[deal.store] ?? { name: deal.store, color: 0x5865f2 };
  const free = deal.isFree || deal.discountPct >= 100 || deal.salePrice === 0;
  // Free games get their dedicated "free" variant of the store icon.
  const icon = free ? (FREE_EMOJI[deal.store] ?? meta.emoji) : meta.emoji;

  const lines = [];
  if (free) {
    // Free-to-keep giveaways have no list price — don't render "₹0 → FREE".
    lines.push(deal.originalPrice > 0 ? `~~${inr(deal.originalPrice)}~~  →  **FREE**` : '**FREE to keep**');
  } else lines.push(`~~${inr(deal.originalPrice)}~~  →  **${inr(deal.salePrice)}**`);
  if (deal.rating) lines.push(`⭐ ${deal.rating}`);
  if (deal.endsAt) {
    const ts = Math.floor(new Date(deal.endsAt).getTime() / 1000);
    if (Number.isFinite(ts) && ts > 0) lines.push(`🗓️ Deal ends <t:${ts}:R>`);
  }

  const embed = {
    title: free
      ? `${icon ?? ''} 🆓 FREE · ${deal.title}`.trimStart()
      : `${icon ?? ''} 🔥 ${deal.discountPct}% OFF · ${deal.title}`.trimStart(),
    url: deal.url,
    description: lines.join('\n'),
    color: meta.color,
    footer: { text: `${meta.name} · Prices in INR` },
    timestamp: new Date().toISOString(),
  };
  if (deal.image) embed.image = { url: deal.image };
  return embed;
}

export const buyNowButton = (deal, label) => ({
  type: 2,
  style: 5, // Link button — opens the store page directly, no interaction cost
  label: label ?? '🛒 Buy Now',
  url: deal.url,
});

// The pinged alert posted in the server's deals channel.
export function dealAlertPayload(guildSettings, deal) {
  return {
    content: `<@&${guildSettings.role_id}>`,
    allowed_mentions: { roles: [String(guildSettings.role_id)] },
    embeds: [buildDealEmbed(deal)],
    components: [{ type: 1, components: [buyNowButton(deal)] }],
  };
}

// The permanent opt-in message posted by /deals setup.
export function optInMessagePayload() {
  return {
    embeds: [{
      title: '🎮 Game Sale Alerts',
      description: [
        'Click **🔔 Get Sale Alerts** below to get the Game Deals role and be pinged whenever a game goes on sale on:',
        '',
        [
          `${EMOJI.steam} Steam`,
          `${EMOJI.steamFree} Steam Free Games (giveaways & free-to-play)`,
          `${EMOJI.epicFree} Epic Games (incl. weekly **FREE** games)`,
          `${EMOJI.xbox} Xbox / Microsoft Store`,
          `${EMOJI.gogFree} GOG Free Games (Free to Keep giveaways)`,
        ].join('   '),
        '',
        'All prices in ₹ (INR), every alert has a **🛒 Buy Now** button.',
        'Click the button again anytime to unsubscribe.',
      ].join('\n'),
      color: 0xf5a623,
    }],
    components: [{
      type: 1,
      components: [{ type: 2, style: 2, custom_id: 'deals_subscribe', label: '🔔 Get Sale Alerts' }],
    }],
  };
}
