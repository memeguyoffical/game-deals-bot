-- This file was originally a byte-for-byte duplicate of 0003_scan_interval.sql,
-- which made `wrangler d1 migrations apply` fail on a fresh database with:
--   duplicate column name: scan_minutes
--
-- 0003 already adds guild_settings.scan_minutes, guild_settings.last_scan_at and
-- the deal_alerts table. The filename is kept as a no-op so existing migration
-- histories stay valid; it must never add those columns a second time.

SELECT 1;
