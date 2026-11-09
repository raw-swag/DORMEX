import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getDatabaseService, resetDatabaseInstance } from '../src/db/index.js';
import { runMigrations } from '../src/db/schema.js';
import { AllocationEngineService } from '../src/allocation/engine.js';
import { AuthActor } from '../src/auth/policy.js';

describe('Allotment Very Large Input Validation Suite', () => {
  let db: any;
  let engine: AllocationEngineService;

  const studentActor = (studentId: string): AuthActor => ({
    userId: `user_${studentId}`,
    collegeId: `STU_${studentId}`,
    role: 'STUDENT',
    scope_type: 'STUDENT',
    scope_id: studentId,
    student_profile_id: studentId,
  });

  beforeAll(async () => {
    resetDatabaseInstance();
    db = getDatabaseService(true);
    await runMigrations(db);
    engine = new AllocationEngineService(db);
  });

  afterAll(async () => {
    resetDatabaseInstance();
  });

  it('safely handles extremely large strings (100KB+) without crash or buffer overflow', async () => {
    const hugeString = 'A'.repeat(100000);

    // confirmSeat with oversized session ID
    await expect(
      engine.confirmSeat(hugeString, 'seat_1', studentActor('stu_1'))
    ).rejects.toThrow();

    // joinWaitingRoom with oversized IDs
    await expect(
      engine.joinWaitingRoom(hugeString, 'stu_1', studentActor('stu_1'))
    ).rejects.toThrow();
  });
});
