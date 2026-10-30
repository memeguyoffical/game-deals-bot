-- Per-server scan interval + per-guild alert history (so a slow server never
-- misses deals that the global scanner happened to see first).

ALTER TABLE guild_settings ADD COLUMN scan_minutes INTEGER NOT NULL DEFAULT 30;
ALTER TABLE guild_settings ADD COLUMN last_scan_at TEXT;

CREATE TABLE IF NOT EXISTS deal_alerts (
  guild_id         TEXT NOT NULL,
  store            TEXT NOT NULL,
  game_id          TEXT NOT NULL,
  last_alerted_pct INTEGER,
  PRIMARY KEY (guild_id, store, game_id)
);
