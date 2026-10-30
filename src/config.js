// Shared constants.

// Optional custom app emojis, uploaded in the Discord Developer Portal → Emojis.
// They belong to the application, so they render in every server the bot posts to.
//
// They are empty by default because emoji IDs only work for the app that owns
// them: someone else's IDs render as broken ":steam:" text. Add your own here
// in the form '<:name:id>' — anything left empty falls back to unicode below.
const CUSTOM_EMOJI = {
  steam: '',
  steamFree: '',
  epic: '',
  epicFree: '',
  xbox: '',
  gog: '',
  gogFree: '',
};

// Used whenever a custom emoji is missing, so the bot never posts broken icons.
const FALLBACK_EMOJI = {
  steam: '🟦',
  steamFree: '🎮',
  epic: '⬛',
  epicFree: '🆓',
  xbox: '🟩',
  gog: '🟪',
  gogFree: '🎁',
};

export const EMOJI = Object.fromEntries(
  Object.keys(FALLBACK_EMOJI).map((key) => [key, CUSTOM_EMOJI[key] || FALLBACK_EMOJI[key]]),
);

export const ROLE_NAME = '🎮 Game Deals';
export const ROLE_COLOR = 0xf5a623;

export const STORES = {
  steam: { name: 'Steam', color: 0x1b9ae4, enabledKey: 'steam_enabled', emoji: EMOJI.steam },
  // The Epic fetcher only returns free games today (Epic's paid-discount API is
  // bot-blocked); EMOJI.epic is kept ready for when deal alerts get added.
  epic:  { name: 'Epic Games', color: 0x313034, enabledKey: 'epic_enabled', emoji: EMOJI.epicFree },
  xbox:  { name: 'Xbox / Microsoft Store', color: 0x107c10, enabledKey: 'xbox_enabled', emoji: EMOJI.xbox },
  steam_free: { name: 'Steam Free Games', color: 0x1b6b3c, enabledKey: 'steam_free_enabled', emoji: EMOJI.steamFree },
  gog: { name: 'GOG Free Games', color: 0x5b2d8e, enabledKey: 'gog_enabled', emoji: EMOJI.gogFree },
};

// Free-game variants get their own icon in embed titles.
export const FREE_EMOJI = {
  steam_free: EMOJI.steamFree,
  gog: EMOJI.gogFree,
  epic: EMOJI.epicFree,
};

// Browser-like UA so store endpoints treat us like a normal visitor.
export const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';