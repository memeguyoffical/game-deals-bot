-- Add Eneba gift cards as a separate per-server toggleable store (default ON).

ALTER TABLE guild_settings ADD COLUMN eneba_giftcard_enabled INTEGER NOT NULL DEFAULT 1;
