-- DORMEX Migration 057 Rollback: Revert Waiting Room Capacity Architecture
ALTER TABLE allocation_cycles
  DROP CONSTRAINT IF EXISTS chk_waiting_room_capacity_sum;

ALTER TABLE allocation_cycles
  DROP COLUMN IF EXISTS reserved_priority_capacity,
  DROP COLUMN IF EXISTS standard_admission_capacity,
  DROP COLUMN IF EXISTS max_admitted_capacity;
