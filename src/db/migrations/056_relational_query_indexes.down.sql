-- DORMEX Migration 056 Rollback: Drop Relational Query Indexes
DROP INDEX IF EXISTS idx_floor_maps_floor_status_version;
DROP INDEX IF EXISTS idx_allocations_seat_status;
DROP INDEX IF EXISTS idx_seats_room_id;
DROP INDEX IF EXISTS idx_rooms_floor_id;
DROP INDEX IF EXISTS idx_floors_building_id;
DROP INDEX IF EXISTS idx_user_roles_user_id;
