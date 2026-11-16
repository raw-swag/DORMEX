-- DORMEX Migration 058: Allocation Cycle Priority Window Release Policy
-- Non-destructive additive migration establishing priority window closing timestamp:
--   - priority_window_closes_at: Expiration timestamp after which protected priority places release to standard general queue

ALTER TABLE allocation_cycles
  ADD COLUMN IF NOT EXISTS priority_window_closes_at TIMESTAMP WITH TIME ZONE DEFAULT NULL;
