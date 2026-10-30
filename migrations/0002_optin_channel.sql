-- Add the public opt-in channel (the "enter" channel everyone can see).
-- channel_id remains the locked alerts channel (role-only).

ALTER TABLE guild_settings ADD COLUMN optin_channel_id TEXT;
