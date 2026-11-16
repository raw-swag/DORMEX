-- DORMEX Migration 056: Relational Foreign Key Query Acceleration & Index Coverage
-- Non-destructive additive index migration
-- Designed to optimize query execution and eliminate sequential table scans on frequently joined foreign keys

-- 1. Accelerate live role extraction during extractActor() on every authenticated request
CREATE INDEX IF NOT EXISTS idx_user_roles_user_id ON user_roles(user_id);

-- 2. Accelerate floor filtering for building queries
CREATE INDEX IF NOT EXISTS idx_floors_building_id ON floors(building_id);

-- 3. Accelerate room lookups by floor in occupancy and map views
CREATE INDEX IF NOT EXISTS idx_rooms_floor_id ON rooms(floor_id);

-- 4. Accelerate seat lookups by room
CREATE INDEX IF NOT EXISTS idx_seats_room_id ON seats(room_id);

-- 5. Accelerate active allocation lookup for seat states
CREATE INDEX IF NOT EXISTS idx_allocations_seat_status ON allocations(seat_id, status);

-- 6. Accelerate published floor map geometry retrieval
CREATE INDEX IF NOT EXISTS idx_floor_maps_floor_status_version ON floor_maps(floor_id, status, version DESC);
