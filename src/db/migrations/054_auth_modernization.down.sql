-- DORMEX Migration 054 Rollback (Down Migration)
-- Reversible DDL for disaster recovery / rollback authorization

DROP TABLE IF EXISTS auth_rate_limits;
DROP TABLE IF EXISTS user_mfa_settings;
DROP INDEX IF EXISTS idx_password_reset_tokens_lookup;
ALTER TABLE password_reset_tokens DROP COLUMN IF EXISTS purpose;
ALTER TABLE users DROP COLUMN IF EXISTS session_version;
