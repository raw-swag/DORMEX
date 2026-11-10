import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { buildApp } from '../src/app.js';
import { getDatabaseService, resetDatabaseInstance } from '../src/db/index.js';

describe('Admin-Controlled Allocation Lifecycle Suite', () => {
  let app: any;
  let db: any;
  let activePoolId: string;

  beforeAll(async () => {
    resetDatabaseInstance();
    db = getDatabaseService(true);
    const fastifyApp = await buildApp(db);
    await fastifyApp.ready();
    app = fastifyApp.server;

    // Reset cycle to DRAFT status to verify explicit start
    await db.query(`UPDATE allocation_cycles SET status = 'DRAFT' WHERE id = 'cyc_bvb_pilot_2026'`);
  }, 30000);

  it('1. Student login or waiting room join does NOT start the allocation engine', async () => {
    // Transition to READY so waiting room enrollment is permitted while engine is not running
    await db.query(`UPDATE allocation_cycles SET status = 'READY' WHERE id = 'cyc_bvb_pilot_2026'`);

    // Student joins waiting room
    const joinRes = await request(app)
      .post('/api/allocation-cycles/cyc_bvb_pilot_2026/join')
      .set('x-user-id', 'usr_demo_001')
      .send({ studentProfileId: 'prof_demo_001' });

    expect(joinRes.status).toBe(200);
    expect(joinRes.body.status).toBe('WAITING');
    activePoolId = joinRes.body.poolId;

    // Verify that joining the waiting room in READY state does NOT start a turn session or countdown
    const activeTurnRes = await request(app)
      .get('/api/allocation-cycles/cyc_bvb_pilot_2026/active-turn')
      .set('x-user-id', 'usr_admin');

    expect(activeTurnRes.status).toBe(200);
    expect(activeTurnRes.body.cycleStatus).toBe('READY');
    expect(activeTurnRes.body.hasActiveTurn).toBe(false);
    expect(activeTurnRes.body.session).toBeNull();
    expect(activeTurnRes.body.candidate).toBeNull();
    expect(activeTurnRes.body.totalWaiting).toBe(1);

    // Verify student remains in waiting room and no booking sessions exist
    const sessionCountRes = await db.query(
      `SELECT COUNT(*)::int AS count FROM booking_sessions WHERE cycle_id = 'cyc_bvb_pilot_2026'`
    );
    expect(sessionCountRes.rows[0].count).toBe(0);

    const waitingEntryRes = await db.query(
      `SELECT status FROM waiting_room_entries WHERE cycle_id = 'cyc_bvb_pilot_2026' AND student_id = 'prof_demo_001'`
    );
    expect(waitingEntryRes.rows[0].status).toBe('WAITING');

    // Verify cycle status remains READY
    const cycleRes = await request(app).get('/api/allocation-cycles');
    const cycle = cycleRes.body.find((c: any) => c.id === 'cyc_bvb_pilot_2026');
    expect(cycle.status).toBe('READY');
  });

  it('1b. Student queue entry is rejected when cycle is in DRAFT status', async () => {
    // Ensure cycle is in DRAFT
    await db.query(`UPDATE allocation_cycles SET status = 'DRAFT' WHERE id = 'cyc_bvb_pilot_2026'`);

    const joinDraft = await request(app)
      .post('/api/allocation-cycles/cyc_bvb_pilot_2026/join')
      .set('x-user-id', 'usr_demo_002')
      .send({ studentProfileId: 'prof_demo_002' });

    expect(joinDraft.status).toBe(400);
    expect(joinDraft.body.error).toContain('CYCLE_NOT_STARTED');

    // Restore cycle to READY for subsequent test flow
    await db.query(`UPDATE allocation_cycles SET status = 'READY' WHERE id = 'cyc_bvb_pilot_2026'`);
  });

  it('2. Students and unauthorized roles are forbidden from starting or stopping the cycle', async () => {
    // Student attempt to start cycle
    const stuStart = await request(app)
      .post('/api/allocation-cycles/cyc_bvb_pilot_2026/start')
      .set('x-user-id', 'usr_demo_001')
      .send();

    expect(stuStart.status).toBe(403);

    // Student attempt to stop cycle
    const stuStop = await request(app)
      .post('/api/allocation-cycles/cyc_bvb_pilot_2026/stop')
      .set('x-user-id', 'usr_demo_001')
      .send();

    expect(stuStop.status).toBe(403);
  });

  it('3. Authorized Administrator starts allocation: sets ACTIVE, starts turn and creates audit trail', async () => {
    // Admin starts the allocation cycle
    const startRes = await request(app)
      .post('/api/allocation-cycles/cyc_bvb_pilot_2026/start')
      .set('x-user-id', 'usr_admin')
      .send();

    expect(startRes.status).toBe(200);
    expect(startRes.body.status).toBe('ACTIVE');

    // Query active turn telemetry
    const turnRes = await request(app)
      .get('/api/allocation-cycles/cyc_bvb_pilot_2026/active-turn')
      .set('x-user-id', 'usr_admin');

    expect(turnRes.status).toBe(200);
    expect(turnRes.body.cycleStatus).toBe('ACTIVE');
    expect(turnRes.body.hasActiveTurn).toBe(true);
    expect(turnRes.body.candidate.collegeId).toBe('DEMO-001');
    expect(turnRes.body.session.remainingSeconds).toBeGreaterThan(0);

    // Verify audit log record
    const auditRes = await request(app)
      .get('/api/admin/audit-logs')
      .set('x-user-id', 'usr_admin');

    expect(auditRes.status).toBe(200);
    const startLog = auditRes.body.find((log: any) => log.action === 'START_ALLOCATION_CYCLE');
    expect(startLog).toBeDefined();
    expect(startLog.target_id).toBe('cyc_bvb_pilot_2026');
  });

  it('4. Administrator stops cycle: freezes turn timer, sets PAUSED, and preserves candidate', async () => {
    const stopRes = await request(app)
      .post('/api/allocation-cycles/cyc_bvb_pilot_2026/stop')
      .set('x-user-id', 'usr_admin')
      .send();

    expect(stopRes.status).toBe(200);
    expect(stopRes.body.status).toBe('PAUSED');

    // Check active turn telemetry while PAUSED
    const turnRes = await request(app)
      .get('/api/allocation-cycles/cyc_bvb_pilot_2026/active-turn')
      .set('x-user-id', 'usr_admin');

    expect(turnRes.status).toBe(200);
    expect(turnRes.body.cycleStatus).toBe('PAUSED');
    expect(turnRes.body.hasActiveTurn).toBe(true);
    expect(turnRes.body.candidate.collegeId).toBe('DEMO-001');

    // Advance pool while paused returns the same frozen session without advancing
    const advRes = await request(app)
      .post(`/api/allocation-pools/${activePoolId}/advance`)
      .send();

    expect(advRes.status).toBe(200);
    expect(advRes.body.session).toBeDefined();
    expect(advRes.body.session.studentId).toBe('prof_demo_001');
    expect(advRes.body.session.status).toBe('ACTIVE');
  });

  it('5. Administrator resumes cycle: restores ACTIVE and continues countdown', async () => {
    const resumeRes = await request(app)
      .post('/api/allocation-cycles/cyc_bvb_pilot_2026/resume')
      .set('x-user-id', 'usr_admin')
      .send();

    expect(resumeRes.status).toBe(200);
    expect(resumeRes.body.status).toBe('ACTIVE');

    const turnRes = await request(app)
      .get('/api/allocation-cycles/cyc_bvb_pilot_2026/active-turn')
      .set('x-user-id', 'usr_admin');

    expect(turnRes.status).toBe(200);
    expect(turnRes.body.cycleStatus).toBe('ACTIVE');
    expect(turnRes.body.hasActiveTurn).toBe(true);
    expect(turnRes.body.candidate.collegeId).toBe('DEMO-001');
  });

  it('6. Admin login, student login, and dashboard refresh do NOT start an unstarted allocation cycle', async () => {
    // Reset cycle to DRAFT
    await db.query(`UPDATE allocation_cycles SET status = 'DRAFT' WHERE id = 'cyc_bvb_pilot_2026'`);

    // Student login (DEMO-001 -> password1)
    const stuLogin = await request(app)
      .post('/api/auth/login')
      .send({ identifier: 'DEMO-001', password: 'password1' });
    expect(stuLogin.status).toBe(200);

    // Admin login (ADM001 -> admin123)
    const admLogin = await request(app)
      .post('/api/auth/login')
      .send({ identifier: 'ADM001', password: 'admin123' });
    expect(admLogin.status).toBe(200);

    // Dashboard refresh overview queries
    const ovRes = await request(app)
      .get('/api/admin/overview')
      .set('x-user-id', 'usr_admin');
    expect(ovRes.status).toBe(200);

    const cycListRes = await request(app).get('/api/allocation-cycles');
    expect(cycListRes.status).toBe(200);
    const cyc = cycListRes.body.find((c: any) => c.id === 'cyc_bvb_pilot_2026');
    expect(cyc.status).toBe('DRAFT');
  });

  it('7. Two simultaneous Start requests cannot create duplicate active cycles or race conditions', async () => {
    // Reset cycle to READY
    await db.query(`UPDATE allocation_cycles SET status = 'READY' WHERE id = 'cyc_bvb_pilot_2026'`);

    // Launch two simultaneous start requests
    const [start1, start2] = await Promise.all([
      request(app).post('/api/allocation-cycles/cyc_bvb_pilot_2026/start').set('x-user-id', 'usr_admin').send(),
      request(app).post('/api/allocation-cycles/cyc_bvb_pilot_2026/start').set('x-user-id', 'usr_admin').send(),
    ]);

    expect(start1.status).toBe(200);
    expect(start2.status).toBe(200);
    expect(start1.body.status).toBe('ACTIVE');
    expect(start2.body.status).toBe('ACTIVE');

    // Verify database only has one cycle record with status ACTIVE
    const countRes = await db.query(
      `SELECT status FROM allocation_cycles WHERE id = 'cyc_bvb_pilot_2026'`
    );
    expect(countRes.rows.length).toBe(1);
    expect(countRes.rows[0].status).toBe('ACTIVE');

    // Verify active turn exists
    const turnRes = await request(app)
      .get('/api/allocation-cycles/cyc_bvb_pilot_2026/active-turn')
      .set('x-user-id', 'usr_admin');
    expect(turnRes.status).toBe(200);
    expect(turnRes.body.hasActiveTurn).toBe(true);
  });

  it('8. Paused cycle cannot auto-skip, advance, or start a new student turn', async () => {
    // Stop / pause cycle
    const stopRes = await request(app)
      .post('/api/allocation-cycles/cyc_bvb_pilot_2026/stop')
      .set('x-user-id', 'usr_admin')
      .send();
    expect(stopRes.status).toBe(200);

    // Call advance multiple times while paused
    const adv1 = await request(app).post(`/api/allocation-pools/${activePoolId}/advance`).send();
    const adv2 = await request(app).post(`/api/allocation-pools/${activePoolId}/advance`).send();

    expect(adv1.status).toBe(200);
    expect(adv2.status).toBe(200);

    // Candidate should remain DEMO-001 without advancing to next student
    const turnRes = await request(app)
      .get('/api/allocation-cycles/cyc_bvb_pilot_2026/active-turn')
      .set('x-user-id', 'usr_admin');

    expect(turnRes.body.cycleStatus).toBe('PAUSED');
    expect(turnRes.body.hasActiveTurn).toBe(true);
    expect(turnRes.body.candidate.collegeId).toBe('DEMO-001');
  });

  it('9. COMPLETED/PUBLISHED or LOCKED cycles cannot be restarted or resumed', async () => {
    // Set cycle to PUBLISHED
    await db.query(`UPDATE allocation_cycles SET status = 'PUBLISHED' WHERE id = 'cyc_bvb_pilot_2026'`);

    // Attempt to start published cycle
    const startPub = await request(app)
      .post('/api/allocation-cycles/cyc_bvb_pilot_2026/start')
      .set('x-user-id', 'usr_admin')
      .send();
    expect(startPub.status).toBe(400);
    expect(startPub.body.error).toContain('INVALID_STATE');

    // Attempt to resume published cycle
    const resumePub = await request(app)
      .post('/api/allocation-cycles/cyc_bvb_pilot_2026/resume')
      .set('x-user-id', 'usr_admin')
      .send();
    expect(resumePub.status).toBe(400);
    expect(resumePub.body.error).toContain('INVALID_STATE');

    // Set cycle to LOCKED
    await db.query(`UPDATE allocation_cycles SET status = 'LOCKED' WHERE id = 'cyc_bvb_pilot_2026'`);

    const startLock = await request(app)
      .post('/api/allocation-cycles/cyc_bvb_pilot_2026/start')
      .set('x-user-id', 'usr_admin')
      .send();
    expect(startLock.status).toBe(400);
    expect(startLock.body.error).toContain('INVALID_STATE');

    // Restore cycle to ACTIVE for any teardown consistency
    await db.query(`UPDATE allocation_cycles SET status = 'ACTIVE' WHERE id = 'cyc_bvb_pilot_2026'`);
  });

  describe('10. Lifecycle State-by-State Student Queue Entry Authorization', () => {
    it('rejects student queue entry in DRAFT state', async () => {
      await db.query(`UPDATE allocation_cycles SET status = 'DRAFT' WHERE id = 'cyc_bvb_pilot_2026'`);
      const res = await request(app)
        .post('/api/allocation-cycles/cyc_bvb_pilot_2026/join')
        .set('x-user-id', 'usr_demo_002')
        .send({ studentProfileId: 'prof_demo_002' });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('CYCLE_NOT_STARTED');
    });

    it('rejects student queue entry in NOT_STARTED state', async () => {
      await db.query(`UPDATE allocation_cycles SET status = 'NOT_STARTED' WHERE id = 'cyc_bvb_pilot_2026'`);
      const res = await request(app)
        .post('/api/allocation-cycles/cyc_bvb_pilot_2026/join')
        .set('x-user-id', 'usr_demo_002')
        .send({ studentProfileId: 'prof_demo_002' });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('CYCLE_NOT_STARTED');
    });

    it('permits student waiting room entry in READY state', async () => {
      await db.query(`UPDATE allocation_cycles SET status = 'READY' WHERE id = 'cyc_bvb_pilot_2026'`);
      const res = await request(app)
        .post('/api/allocation-cycles/cyc_bvb_pilot_2026/join')
        .set('x-user-id', 'usr_demo_002')
        .send({ studentProfileId: 'prof_demo_002' });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('WAITING');
    });

    it('permits student waiting room entry in ACTIVE state', async () => {
      await db.query(`UPDATE allocation_cycles SET status = 'ACTIVE' WHERE id = 'cyc_bvb_pilot_2026'`);
      const res = await request(app)
        .post('/api/allocation-cycles/cyc_bvb_pilot_2026/join')
        .set('x-user-id', 'usr_demo_003')
        .send({ studentProfileId: 'prof_demo_003' });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('WAITING');
    });

    it('rejects student queue entry in SIMULATING state', async () => {
      await db.query(`UPDATE allocation_cycles SET status = 'SIMULATING' WHERE id = 'cyc_bvb_pilot_2026'`);
      const res = await request(app)
        .post('/api/allocation-cycles/cyc_bvb_pilot_2026/join')
        .set('x-user-id', 'usr_demo_004')
        .send({ studentProfileId: 'prof_demo_004' });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('CYCLE_SIMULATING');
    });

    it('rejects new student queue entry in PAUSED state while preserving existing queue', async () => {
      await db.query(`UPDATE allocation_cycles SET status = 'PAUSED' WHERE id = 'cyc_bvb_pilot_2026'`);

      // Attempt new student entry
      const res = await request(app)
        .post('/api/allocation-cycles/cyc_bvb_pilot_2026/join')
        .set('x-user-id', 'usr_demo_005')
        .send({ studentProfileId: 'prof_demo_005' });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('CYCLE_PAUSED');

      // Verify previously queued students remain in waiting_room_entries
      const entriesRes = await db.query(
        `SELECT student_id, status FROM waiting_room_entries WHERE cycle_id = 'cyc_bvb_pilot_2026' AND student_id = 'prof_demo_002'`
      );
      expect(entriesRes.rows.length).toBe(1);
      expect(entriesRes.rows[0].status).toBe('WAITING');
    });

    it('rejects student queue entry in terminal states (PUBLISHED, LOCKED, CLOSED)', async () => {
      for (const st of ['PUBLISHED', 'LOCKED', 'CLOSED']) {
        await db.query(`UPDATE allocation_cycles SET status = $1 WHERE id = 'cyc_bvb_pilot_2026'`, [st]);
        const res = await request(app)
          .post('/api/allocation-cycles/cyc_bvb_pilot_2026/join')
          .set('x-user-id', 'usr_demo_006')
          .send({ studentProfileId: 'prof_demo_006' });

        expect(res.status).toBe(400);
        expect(res.body.error).toContain('CYCLE_CLOSED');
      }
    });
  });
});
