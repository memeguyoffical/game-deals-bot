// The /deals slash command definition — shared by the terminal registration
// script (scripts/register-commands.js) and the browser /setup route.

const storeToggle = (name, description) => ({ type: 5, name, description });

export const DEALS_COMMAND = {
  name: 'deals',
  description: 'Game sale alerts (Steam · Epic · Xbox · GOG) — prices in ₹',
  integration_types: [0], // guild install
  contexts: [0],          // guild only
  options: [
    {
      type: 1,
      name: 'setup',
      description: 'Set up sale alerts for this server (needs Manage Server)',
      options: [
        { type: 7, name: 'channel', description: 'Alerts channel (optional — bot creates #game-deals, locked to the role)', channel_types: [0] },
        { type: 4, name: 'min_discount', description: 'Minimum discount % to alert (default 50)', min_value: 1, max_value: 100 },
        { type: 4, name: 'scan_minutes', description: 'How often to scan (5-1440, default 30)', min_value: 5, max_value: 1440 },
        storeToggle('steam', 'Steam deals (default: on)'),
        storeToggle('epic', 'Epic Games free games & deals (default: on)'),
        storeToggle('xbox', 'Xbox / Microsoft Store deals (default: on)'),
        storeToggle('steam_free', 'Steam giveaways & free-to-play games (default: on)'),
        storeToggle('gog', 'GOG free games (default: on)'),
      ],
    },
    {
      type: 1,
      name: 'settings',
      description: 'View or change alert settings (needs Manage Server)',
      options: [
        { type: 7, name: 'channel', description: 'Move alerts to another channel (it gets locked to the role)', channel_types: [0] },
        { type: 4, name: 'min_discount', description: 'Minimum discount % to alert', min_value: 1, max_value: 100 },
        { type: 4, name: 'scan_minutes', description: 'How often to scan (5-1440)', min_value: 5, max_value: 1440 },
        storeToggle('steam', 'Steam deals on/off'),
        storeToggle('epic', 'Epic Games free games & deals on/off'),
        storeToggle('xbox', 'Xbox / Microsoft Store deals on/off'),
        storeToggle('steam_free', 'Steam giveaways & free-to-play games on/off'),
        storeToggle('gog', 'GOG free games on/off'),
      ],
    },
    { type: 1, name: 'now', description: 'Show the current top deals (only you can see it)' },
  ],
};