-- DORMEX Migration 055: Decommission WebAuthn and Obsolete Device Authentication
-- Non-destructive cleanup and deprecation migration

-- 1. Deprecate and safely truncate obsolete transient challenge records
DROP TABLE IF EXISTS webauthn_challenges;

-- 2. Mark existing device_registration_slots as deprecated/revoked for audit integrity
-- (Preserves table structure and historical records to avoid foreign-key violations on audit logs)
UPDATE device_registration_slots
SET is_revoked = TRUE,
    revoked_at = CURRENT_TIMESTAMP
WHERE is_revoked = FALSE;

-- 3. Document retention:
-- device_registration_slots is permanently retained in schema for historical and foreign-key audit references.
