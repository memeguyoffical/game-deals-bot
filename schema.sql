-- Game Deals Bot — complete schema for a fresh database.
--
-- This is the end state of every file in migrations/, with the unused Eneba
-- columns dropped. Safe to run more than once (everything is IF NOT EXISTS).
--
--   wrangler d1 execute game-deals-db --remote --file=./schema.sql
--
-- ...or paste this whole file into D1 → Console → Execute.

CREATE TABLE IF NOT EXISTS guild_settings (
  guild_id           TEXT PRIMARY KEY,
  channel_id         TEXT NOT NULL,          -- locked alerts channel
  role_id            TEXT NOT NULL,          -- 🎮 Game Deals role
  min_discount       INTEGER NOT NULL DEFAULT 50,
  steam_enabled      INTEGER NOT NULL DEFAULT 1,
  epic_enabled       INTEGER NOT NULL DEFAULT 1,
  xbox_enabled       INTEGER NOT NULL DEFAULT 1,
  steam_free_enabled INTEGER NOT NULL DEFAULT 1,
  gog_enabled        INTEGER NOT NULL DEFAULT 1,
  optin_message_id   TEXT,
  optin_channel_id   TEXT,                   -- public "#get-sale-alerts" channel
  scan_minutes       INTEGER NOT NULL DEFAULT 30,
  last_scan_at       TEXT,
  created_at         TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS deals (
  store             TEXT NOT NULL,           -- 'steam' | 'epic' | 'xbox' | 'steam_free' | 'gog'
  game_id           TEXT NOT NULL,
  title             TEXT NOT NULL,
  url               TEXT NOT NULL,
  image             TEXT,
  original_price    REAL NOT NULL,           -- INR
  sale_price        REAL NOT NULL,           -- INR
  discount_pct      INTEGER NOT NULL,
  ends_at           TEXT,                    -- ISO timestamp or NULL
  rating            TEXT,
  is_free           INTEGER NOT NULL DEFAULT 0,
  first_seen        TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen         TEXT NOT NULL DEFAULT (datetime('now')),
  last_alerted_pct  INTEGER,                 -- NULL = never alerted
  PRIMARY KEY (store, game_id)
);

CREATE INDEX IF NOT EXISTS idx_deals_last_seen ON deals(last_seen);
CREATE INDEX IF NOT EXISTS idx_deals_free ON deals(is_free);

-- Per-server alert history, so a slow server never misses a deal the global
-- scanner already saw, and never gets the same deal twice.
CREATE TABLE IF NOT EXISTS deal_alerts (
  guild_id         TEXT NOT NULL,
  store            TEXT NOT NULL,
  game_id          TEXT NOT NULL,
  last_alerted_pct INTEGER,
  PRIMARY KEY (guild_id, store, game_id)
);

-- Cache of Steam review summaries, to avoid refetching them on every alert.
CREATE TABLE IF NOT EXISTS steam_ratings (
  app_id TEXT PRIMARY KEY,
  rating TEXT
);
