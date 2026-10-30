-- Add Steam free games (giveaways + free-to-play) as a per-server toggleable
-- store (default ON).

ALTER TABLE guild_settings ADD COLUMN steam_free_enabled INTEGER NOT NULL DEFAULT 1;