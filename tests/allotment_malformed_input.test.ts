import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getDatabaseService, resetDatabaseInstance } from '../src/db/index.js';
import { runMigrations } from '../src/db/schema.js';
import { AllocationEngineService } from '../src/allocation/engine.js';
import { AuthActor } from '../src/auth/policy.js';

describe('Allotment Malformed Input Validation Suite', () => {
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

  it('rejects malformed session IDs with invalid characters or corrupted identifiers', async () => {
    const malformedIds = [
      'sess; DROP TABLE allocations;--',
      'sess\x00nullbyte',
      '../../../etc/passwd',
      'invalid@#$*&^%',
    ];

    for (const badId of malformedIds) {
      await expect(
        engine.confirmSeat(badId, 'seat_test_1', studentActor('stu_1'))
      ).rejects.toThrow();
    }
  });

  it('rejects malformed non-existent cycle and student IDs on joinWaitingRoom', async () => {
    await expect(
      engine.joinWaitingRoom('cycle_non_existent_999', 'stu_non_existent', studentActor('stu_non_existent'))
    ).rejects.toThrow();
  });
});
