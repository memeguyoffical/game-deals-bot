-- Add Eneba as a per-server toggleable store (default ON).

ALTER TABLE guild_settings ADD COLUMN eneba_enabled INTEGER NOT NULL DEFAULT 1;
