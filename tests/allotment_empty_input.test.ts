import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getDatabaseService, resetDatabaseInstance } from '../src/db/index.js';
import { runMigrations } from '../src/db/schema.js';
import { AllocationEngineService } from '../src/allocation/engine.js';
import { AuthActor } from '../src/auth/policy.js';

describe('Allotment Empty Input Validation Suite', () => {
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

  it('rejects empty strings for sessionId or seatId in confirmSeat', async () => {
    await expect(
      engine.confirmSeat('', 'seat_valid_1', studentActor('stu_1'))
    ).rejects.toThrow();

    await expect(
      engine.confirmSeat('sess_valid_1', '', studentActor('stu_1'))
    ).rejects.toThrow();
  });

  it('rejects empty string identifiers in joinWaitingRoom', async () => {
    await expect(
      engine.joinWaitingRoom('', 'stu_1', studentActor('stu_1'))
    ).rejects.toThrow();

    await expect(
      engine.joinWaitingRoom('cycle_1', '', studentActor(''))
    ).rejects.toThrow();
  });
});
