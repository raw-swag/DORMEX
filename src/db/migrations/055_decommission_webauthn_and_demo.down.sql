-- DORMEX Migration 055 Rollback (Down Migration)
-- Recreates webauthn_challenges if rolled back

CREATE TABLE IF NOT EXISTS webauthn_challenges (
    token TEXT PRIMARY KEY,
    challenge TEXT NOT NULL,
    slot_id TEXT,
    expected_type TEXT NOT NULL,
    admin_user_id TEXT,
    expires_at BIGINT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
