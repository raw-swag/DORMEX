-- DORMEX Migration 058 Rollback: Revert Priority Window Release Policy
ALTER TABLE allocation_cycles
  DROP COLUMN IF EXISTS priority_window_closes_at;
