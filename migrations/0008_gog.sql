-- Add GOG free games as a per-server toggleable store (default ON).

ALTER TABLE guild_settings ADD COLUMN gog_enabled INTEGER NOT NULL DEFAULT 1;