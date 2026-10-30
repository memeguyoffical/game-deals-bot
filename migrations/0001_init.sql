-- Game Deals Bot — initial schema

CREATE TABLE IF NOT EXISTS guild_settings (
  guild_id          TEXT PRIMARY KEY,
  channel_id        TEXT NOT NULL,
  role_id           TEXT NOT NULL,
  min_discount      INTEGER NOT NULL DEFAULT 50,
  steam_enabled     INTEGER NOT NULL DEFAULT 1,
  epic_enabled      INTEGER NOT NULL DEFAULT 1,
  xbox_enabled      INTEGER NOT NULL DEFAULT 1,
  optin_message_id  TEXT,
  created_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS deals (
  store             TEXT NOT NULL,          -- 'steam' | 'epic' | 'xbox'
  game_id           TEXT NOT NULL,
  title             TEXT NOT NULL,
  url               TEXT NOT NULL,
  image             TEXT,
  original_price    REAL NOT NULL,          -- INR
  sale_price        REAL NOT NULL,          -- INR
  discount_pct      INTEGER NOT NULL,
  ends_at           TEXT,                   -- ISO timestamp or NULL
  rating            TEXT,                   -- human-readable, e.g. "Very Positive (12,345 reviews)"
  is_free           INTEGER NOT NULL DEFAULT 0,
  first_seen        TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen         TEXT NOT NULL DEFAULT (datetime('now')),
  last_alerted_pct  INTEGER,                -- NULL = never alerted
  PRIMARY KEY (store, game_id)
);

CREATE INDEX IF NOT EXISTS idx_deals_last_seen ON deals(last_seen);
