-- DORMEX Migration 054: Authentication Modernization & Credential Security
-- Non-destructive additive DDL migration

-- 1. Session Invalidation Epoch on Users
ALTER TABLE users ADD COLUMN IF NOT EXISTS session_version INT NOT NULL DEFAULT 1;

-- 2. Purpose-bound Password Reset & Activation Tokens
ALTER TABLE password_reset_tokens 
  ADD COLUMN IF NOT EXISTS purpose TEXT NOT NULL DEFAULT 'PASSWORD_RESET' 
  CHECK (purpose IN ('ACTIVATION', 'PASSWORD_RESET', 'ADMIN_RECOVERY'));

CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_lookup 
  ON password_reset_tokens (token_hash, purpose, used_at, expires_at);

-- 3. TOTP MFA Settings Table
CREATE TABLE IF NOT EXISTS user_mfa_settings (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    encrypted_secret TEXT NOT NULL,
    secret_iv TEXT NOT NULL,
    secret_tag TEXT NOT NULL,
    key_version INT NOT NULL DEFAULT 1,
    is_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    enrolled_at TIMESTAMP WITH TIME ZONE,
    last_verified_step BIGINT NOT NULL DEFAULT 0,
    recovery_code_hashes TEXT[] NOT NULL DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_user_mfa_settings_user ON user_mfa_settings(user_id);

-- 4. Multi-Instance Distributed Rate Limiting Table
CREATE TABLE IF NOT EXISTS auth_rate_limits (
    key_hash TEXT PRIMARY KEY, -- SHA-256('ip:' || ip) or SHA-256('id:' || clean_identifier)
    attempts INT NOT NULL DEFAULT 1,
    window_start_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    blocked_until TIMESTAMP WITH TIME ZONE,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_auth_rate_limits_blocked ON auth_rate_limits(blocked_until);
