-- DORMEX Migration 057: Allocation Cycle Waiting Room Capacity Architecture
-- Non-destructive additive migration establishing configurable waiting-room capacities:
--   - max_admitted_capacity: Hard cap on simultaneously admitted waiting-room candidates (default 20)
--   - standard_admission_capacity: Slots open to general qualified queue progression (default 15)
--   - reserved_priority_capacity: Slots reserved for late-arriving verified high-priority candidates (default 5)
-- Invariant enforced: standard_admission_capacity + reserved_priority_capacity <= max_admitted_capacity

ALTER TABLE allocation_cycles
  ADD COLUMN IF NOT EXISTS max_admitted_capacity INT NOT NULL DEFAULT 20,
  ADD COLUMN IF NOT EXISTS standard_admission_capacity INT NOT NULL DEFAULT 15,
  ADD COLUMN IF NOT EXISTS reserved_priority_capacity INT NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS priority_window_closes_at TIMESTAMP WITH TIME ZONE DEFAULT NULL;

-- Ensure constraint exists to prevent contradictory capacity allocations
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_waiting_room_capacity_sum'
  ) THEN
    ALTER TABLE allocation_cycles
      ADD CONSTRAINT chk_waiting_room_capacity_sum
      CHECK (
        max_admitted_capacity > 0 AND
        standard_admission_capacity >= 0 AND
        reserved_priority_capacity >= 0 AND
        standard_admission_capacity + reserved_priority_capacity <= max_admitted_capacity
      );
  END IF;
END $$;
