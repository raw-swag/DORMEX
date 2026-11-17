import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { getDatabaseService, DatabaseService } from '../src/db/index.js';
import { WaitingRoomTelemetryService } from '../src/allocation/telemetryService.js';

describe('Phase 3: Student Waiting Room Live Telemetry & SSE Suite', () => {
  let app: FastifyInstance;
  let db: DatabaseService;
  let telemetryService: WaitingRoomTelemetryService;
  let student1Token: string;
  let student2Token: string;
  let student1ProfileId: string;
  let student2ProfileId: string;
  const cycleId = 'cyc_bvb_pilot_2026';

  beforeAll(async () => {
    db = getDatabaseService();
    telemetryService = new WaitingRoomTelemetryService(db);
    app = await buildApp(db);
    await app.ready();

    // Reset cycle to ACTIVE for telemetry tests
    await db.query(`UPDATE allocation_cycles SET status = 'ACTIVE' WHERE id = $1`, [cycleId]);

    // Setup student test users and profiles
    const passHash = '$argon2id$v=19$m=65536,t=3,p=4$DwE/5+08QO8E$abcdefghijklmnopqrstuvwxyz123456';
    
    // Student 1
    const s1User = await db.query(
      `INSERT INTO users (id, college_id, email, full_name, password_hash, is_active)
       VALUES ('usr_test_p3_s1', '1SI25CS001', 's1@dormex.edu', 'Phase 3 Student One', $1, TRUE)
       ON CONFLICT (id) DO UPDATE SET is_active = TRUE
       RETURNING id`,
      [passHash]
    );
    await db.query(
      `INSERT INTO students (usn, full_name, email, user_id, branch, admission_year, account_status)
       VALUES ('1SI25CS001', 'Phase 3 Student One', 's1@dormex.edu', $1, 'CS', 2025, 'ACTIVE')
       ON CONFLICT (usn) DO UPDATE SET account_status = 'ACTIVE'`,
      [s1User.rows[0].id]
    );
    const p1 = await db.query(
      `INSERT INTO student_profiles (id, user_id, college_id, full_name, department, gender, academic_year, quota_category, eligibility_status, assigned_priority)
       VALUES ('prof_test_p3_s1', $1, '1SI25CS001', 'Phase 3 Student One', 'Computer Science', 'MALE', 2, 'GENERAL', 'ELIGIBLE', 1)
       ON CONFLICT (id) DO UPDATE SET eligibility_status = 'ELIGIBLE', assigned_priority = 1
       RETURNING id`,
      [s1User.rows[0].id]
    );
    student1ProfileId = p1.rows[0].id;
    await db.query(
      `INSERT INTO user_roles (id, user_id, role_id, scope_type)
       VALUES ('ur_p3_s1', $1, 'role_student', 'STUDENT')
       ON CONFLICT (id) DO NOTHING`,
      [s1User.rows[0].id]
    );

    // Student 2
    const s2User = await db.query(
      `INSERT INTO users (id, college_id, email, full_name, password_hash, is_active)
       VALUES ('usr_test_p3_s2', '1SI25CS002', 's2@dormex.edu', 'Phase 3 Student Two', $1, TRUE)
       ON CONFLICT (id) DO UPDATE SET is_active = TRUE
       RETURNING id`,
      [passHash]
    );
    await db.query(
      `INSERT INTO students (usn, full_name, email, user_id, branch, admission_year, account_status)
       VALUES ('1SI25CS002', 'Phase 3 Student Two', 's2@dormex.edu', $1, 'CS', 2025, 'ACTIVE')
       ON CONFLICT (usn) DO UPDATE SET account_status = 'ACTIVE'`,
      [s2User.rows[0].id]
    );
    const p2 = await db.query(
      `INSERT INTO student_profiles (id, user_id, college_id, full_name, department, gender, academic_year, quota_category, eligibility_status, assigned_priority)
       VALUES ('prof_test_p3_s2', $1, '1SI25CS002', 'Phase 3 Student Two', 'Computer Science', 'MALE', 2, 'GENERAL', 'ELIGIBLE', 2)
       ON CONFLICT (id) DO UPDATE SET eligibility_status = 'ELIGIBLE', assigned_priority = 2
       RETURNING id`,
      [s2User.rows[0].id]
    );
    student2ProfileId = p2.rows[0].id;
    await db.query(
      `INSERT INTO user_roles (id, user_id, role_id, scope_type)
       VALUES ('ur_p3_s2', $1, 'role_student', 'STUDENT')
       ON CONFLICT (id) DO NOTHING`,
      [s2User.rows[0].id]
    );

    // Acknowledge terms
    const docRes = await db.query(
      `SELECT id FROM terms_documents WHERE is_published = TRUE ORDER BY version DESC LIMIT 1`
    );
    const docId = docRes.rows[0]?.id || 'terms_doc_2026';

    await db.query(
      `INSERT INTO terms_acknowledgements (id, student_id, terms_document_id, terms_version, accepted_at, ip_address)
       VALUES ('ack_p3_s1', $1, $2, 1, CURRENT_TIMESTAMP, '127.0.0.1')
       ON CONFLICT DO NOTHING`,
      [student1ProfileId, docId]
    );
    await db.query(
      `INSERT INTO terms_acknowledgements (id, student_id, terms_document_id, terms_version, accepted_at, ip_address)
       VALUES ('ack_p3_s2', $1, $2, 1, CURRENT_TIMESTAMP, '127.0.0.1')
       ON CONFLICT DO NOTHING`,
      [student2ProfileId, docId]
    );

    // Sign tokens
    student1Token = app.jwt.sign({ sub: s1User.rows[0].id, role: 'STUDENT', ver: 1 });
    student2Token = app.jwt.sign({ sub: s2User.rows[0].id, role: 'STUDENT', ver: 1 });
  });

  afterAll(async () => {
    await app.close();
  });

  it('1. Rejects unauthenticated requests to waiting-room status & SSE endpoint', async () => {
    const resStatus = await request(app.server)
      .get(`/api/allocation-cycles/${cycleId}/waiting-room/status`);
    expect(resStatus.status).toBe(401);

    const resSse = await request(app.server)
      .get(`/api/allocation-cycles/${cycleId}/waiting-room/live`);
    expect(resSse.status).toBe(401);
  });

  it('2. Authoritative Waiting Room State: Correctly computes aggregate capacities and empty queue for student', async () => {
    const res = await request(app.server)
      .get(`/api/allocation-cycles/${cycleId}/waiting-room/status`)
      .set('Authorization', `Bearer ${student1Token}`);

    expect(res.status).toBe(200);
    expect(res.body.cycleId).toBe(cycleId);
    expect(res.body.maxAdmittedCapacity).toBe(20);
    expect(res.body.standardAdmissionCapacity).toBe(15);
    expect(res.body.reservedPriorityCapacity).toBe(5);
    expect(res.body.studentQueue).toBeNull();
  });

  it('3. Student Queue Isolation: Computes exact personal queue position and top 5 alert without leaking peer data', async () => {
    // Student 1 joins waiting room
    const joinRes1 = await request(app.server)
      .post(`/api/allocation-cycles/${cycleId}/join`)
      .set('Authorization', `Bearer ${student1Token}`)
      .send({ studentProfileId: student1ProfileId });
    expect(joinRes1.status).toBe(200);

    // Student 2 joins waiting room
    const joinRes2 = await request(app.server)
      .post(`/api/allocation-cycles/${cycleId}/join`)
      .set('Authorization', `Bearer ${student2Token}`)
      .send({ studentProfileId: student2ProfileId });
    expect(joinRes2.status).toBe(200);

    // Query telemetry for Student 1
    const s1Telemetry = await request(app.server)
      .get(`/api/allocation-cycles/${cycleId}/waiting-room/status`)
      .set('Authorization', `Bearer ${student1Token}`);

    expect(s1Telemetry.status).toBe(200);
    expect(s1Telemetry.body.studentQueue).toBeDefined();
    expect(s1Telemetry.body.studentQueue.status).toBe('WAITING');
    expect(s1Telemetry.body.studentQueue.queuePosition).toBe(1);
    expect(s1Telemetry.body.studentQueue.isTop5).toBe(true);

    // Query telemetry for Student 2
    const s2Telemetry = await request(app.server)
      .get(`/api/allocation-cycles/${cycleId}/waiting-room/status`)
      .set('Authorization', `Bearer ${student2Token}`);

    expect(s2Telemetry.status).toBe(200);
    expect(s2Telemetry.body.studentQueue).toBeDefined();
    expect(s2Telemetry.body.studentQueue.status).toBe('WAITING');
    expect(s2Telemetry.body.studentQueue.queuePosition).toBe(2);
    expect(s2Telemetry.body.studentQueue.isTop5).toBe(true);

    // Ensure peer identities or other students are NOT present in telemetry body
    expect(JSON.stringify(s1Telemetry.body)).not.toContain('1SI25CS002');
    expect(JSON.stringify(s2Telemetry.body)).not.toContain('1SI25CS001');
  });

  it('4. Server-Sent Events (SSE) Stream: Connects with text/event-stream headers and emits initial authoritative state', async () => {
    let rawResponse = '';
    const sseApp = await buildApp(db);
    const listenAddr = await sseApp.listen({ port: 0, host: '127.0.0.1' });

    try {
      await new Promise<void>((resolve, reject) => {
        const clientReq = request(listenAddr)
          .get(`/api/allocation-cycles/${cycleId}/waiting-room/live`)
          .set('Authorization', `Bearer ${student1Token}`);

        clientReq.buffer(false);
        clientReq.on('response', (res) => {
          expect(res.headers['content-type']).toContain('text/event-stream');
          expect(res.headers['cache-control']).toContain('no-cache');

          res.on('data', (d) => {
            rawResponse += d.toString();
            if (rawResponse.includes('event: state')) {
              expect(rawResponse).toContain('event: state');
              expect(rawResponse).toContain(cycleId);
              // Cleanly destroy and resolve
              res.destroy();
              resolve();
            }
          });
        });
        clientReq.on('error', () => {
          resolve();
        });
        clientReq.end();
      });
    } finally {
      await sseApp.close();
    }
  });

  it('5. Participant Leave & Teardown: Student leaves waiting room and queue updates accordingly', async () => {
    const leaveRes = await request(app.server)
      .post(`/api/allocation-cycles/${cycleId}/leave`)
      .set('Authorization', `Bearer ${student2Token}`)
      .send({ studentProfileId: student2ProfileId });

    expect(leaveRes.status).toBe(200);
    expect(leaveRes.body.status).toBe('CANCELLED');

    // Verify Student 2 telemetry now reflects cancelled
    const s2AfterLeave = await request(app.server)
      .get(`/api/allocation-cycles/${cycleId}/waiting-room/status`)
      .set('Authorization', `Bearer ${student2Token}`);

    expect(s2AfterLeave.status).toBe(200);
    expect(s2AfterLeave.body.studentQueue.status).toBe('CANCELLED');
  });

  it('6. Post-Commit Emission & Rollback Guard: No broadcast is emitted if transaction fails', async () => {
    let broadcastCount = 0;
    const testCycle = 'cyc_test_rollback';
    const testPool = 'pool_test_rollback';
    
    // Create base pool & cycle
    await db.query(
      `INSERT INTO allocation_cycles (id, name, academic_year, status, turn_duration_seconds)
       VALUES ($1, 'Rollback Test Cycle', 2, 'ACTIVE', 120)
       ON CONFLICT (id) DO UPDATE SET status = 'ACTIVE'`,
      [testCycle]
    );
    await db.query(
      `INSERT INTO allocation_pools (id, cycle_id, name, quota_category, academic_year)
       VALUES ($1, $2, 'Rollback Test Pool', 'GENERAL', 2)
       ON CONFLICT (id) DO NOTHING`,
      [testPool, testCycle]
    );

    const { AllocationEngineService } = await import('../src/allocation/engine.js');
    const mockTelemetryService = {
      broadcastCycleUpdate: (cId: string) => {
        if (cId === testCycle) broadcastCount++;
      },
      getStudentWaitingRoomState: telemetryService.getStudentWaitingRoomState.bind(telemetryService),
      subscribe: telemetryService.subscribe.bind(telemetryService),
    } as any;

    const testEngine = new AllocationEngineService(db, mockTelemetryService);

    // 1. Successful Join: Produces exactly one post-commit broadcast
    const joinResult = await testEngine.joinWaitingRoom(testCycle, student1ProfileId, {
      id: 'usr_test_p3_s1',
      college_id: '1SI25CS001',
      role: 'STUDENT',
      scope_type: 'STUDENT',
      student_profile_id: student1ProfileId,
    });
    expect(joinResult.status).toBe('WAITING');
    expect(broadcastCount).toBe(1);

    // 2. Failed / Rejected Operation (e.g. invalid profile ID that fails transaction): Produces zero broadcasts
    await expect(
      testEngine.joinWaitingRoom(testCycle, 'prof_non_existent', {
        id: 'usr_non_existent',
        college_id: '1SI25CS999',
        role: 'STUDENT',
        scope_type: 'STUDENT',
        student_profile_id: 'prof_non_existent',
      })
    ).rejects.toThrow();

    // Broadcast count MUST remain unchanged
    expect(broadcastCount).toBe(1);
  });

  it('7. Cookie-based SSE Authentication & CORS allowlist validation', async () => {
    const sseApp = await buildApp(db);
    const listenAddr = await sseApp.listen({ port: 0, host: '127.0.0.1' });

    try {
      // 1. With valid HttpOnly cookie: Succeeds with 200 and approved origin
      await new Promise<void>((resolve, reject) => {
        const req = request(listenAddr)
          .get(`/api/allocation-cycles/${cycleId}/waiting-room/live`)
          .set('Cookie', `token=${student1Token}`)
          .set('Origin', 'https://dormex-sit.vercel.app');

        req.buffer(false);
        req.on('response', (res) => {
          try {
            expect(res.headers['content-type']).toContain('text/event-stream');
            expect(res.headers['access-control-allow-origin']).toBe('https://dormex-sit.vercel.app');
            expect(res.headers['access-control-allow-credentials']).toBe('true');
            expect(res.headers['access-control-allow-origin']).not.toBe('*');
            res.destroy();
            resolve();
          } catch (e) {
            res.destroy();
            reject(e);
          }
        });
        req.on('error', () => resolve());
        req.end();
      });

      // 2. With unapproved Origin: Access-Control-Allow-Origin header is omitted
      await new Promise<void>((resolve, reject) => {
        const req = request(listenAddr)
          .get(`/api/allocation-cycles/${cycleId}/waiting-room/live`)
          .set('Cookie', `token=${student1Token}`)
          .set('Origin', 'https://malicious-attacker-site.com');

        req.buffer(false);
        req.on('response', (res) => {
          try {
            expect(res.headers['access-control-allow-origin']).toBeUndefined();
            res.destroy();
            resolve();
          } catch (e) {
            res.destroy();
            reject(e);
          }
        });
        req.on('error', () => resolve());
        req.end();
      });
    } finally {
      await sseApp.close();
    }
  });

  it('8. Long-Lived SSE Session Revocation: Closes connection when session_version changes', async () => {
    // Refresh student token with latest session_version
    const uRes = await db.query(`SELECT session_version FROM users WHERE id = 'usr_test_p3_s1'`);
    const currentVer = uRes.rows[0]?.session_version ?? 1;
    const freshToken = app.jwt.sign({ sub: 'usr_test_p3_s1', role: 'STUDENT', ver: currentVer });

    const sseApp = await buildApp(db);
    const listenAddr = await sseApp.listen({ port: 0, host: '127.0.0.1' });

    try {
      let receivedRevocationError = false;

      await new Promise<void>((resolve) => {
        const req = request(listenAddr)
          .get(`/api/allocation-cycles/${cycleId}/waiting-room/live`)
          .set('Cookie', `token=${freshToken}`);

        req.buffer(false);
        req.on('response', (res) => {
          res.on('data', async (d) => {
            const str = d.toString();
            if (str.includes('event: state')) {
              // Now revoke session in database by bumping session_version
              await db.query(`UPDATE users SET session_version = session_version + 1 WHERE id = 'usr_test_p3_s1'`);
            }
            if (str.includes('SESSION_REVOKED')) {
              receivedRevocationError = true;
              res.destroy();
              resolve();
            }
          });
        });
        req.on('error', () => resolve());
        req.end();

        // Safety timeout in case test runner waits
        setTimeout(() => {
          resolve();
        }, 12000);
      });

      expect(receivedRevocationError).toBe(true);
    } finally {
      await sseApp.close();
    }
  }, 20000);

  it('9. JWT Lifetime Expiration on Active SSE Connection: Closes stream when exp is reached', async () => {
    // 1. First verify: An already-expired JWT is rejected before establishing the SSE stream
    const alreadyExpiredToken = app.jwt.sign(
      { sub: 'usr_test_p3_s1', role: 'STUDENT', ver: 1 },
      { expiresIn: '-1s' }
    );
    const expiredRes = await request(app.server)
      .get(`/api/allocation-cycles/${cycleId}/waiting-room/live`)
      .set('Cookie', `token=${alreadyExpiredToken}`);
    expect(expiredRes.status).toBe(401);
    expect(expiredRes.body.error).toContain('Token expired');

    // 2. Second verify: Active SSE stream terminates when exp time is reached
    const sseApp = await buildApp(db);
    const listenAddr = await sseApp.listen({ port: 0, host: '127.0.0.1' });

    // Fetch latest session_version for user to ensure valid session version
    const uRes = await db.query(`SELECT session_version FROM users WHERE id = 'usr_test_p3_s1'`);
    const currentVer = uRes.rows[0]?.session_version ?? 1;

    // Generate a short-lived token valid for 3 seconds so connection handshake succeeds
    const shortLivedToken = app.jwt.sign(
      { sub: 'usr_test_p3_s1', role: 'STUDENT', ver: currentVer },
      { expiresIn: '3s' }
    );

    try {
      let receivedInitialState = false;
      let receivedTokenExpiredError = false;

      await new Promise<void>((resolve) => {
        const req = request(listenAddr)
          .get(`/api/allocation-cycles/${cycleId}/waiting-room/live`)
          .set('Cookie', `token=${shortLivedToken}`);

        req.buffer(false);
        req.on('response', (res) => {
          res.on('data', (d) => {
            const str = d.toString();
            if (str.includes('event: state')) {
              receivedInitialState = true;
            }
            if (str.includes('TOKEN_EXPIRED')) {
              receivedTokenExpiredError = true;
              res.destroy();
              resolve();
            }
          });
        });
        req.on('error', () => resolve());
        req.end();

        setTimeout(() => {
          resolve();
        }, 10000);
      });

      expect(receivedInitialState).toBe(true);
      expect(receivedTokenExpiredError).toBe(true);
    } finally {
      await sseApp.close();
    }
  }, 25000);

  it('10. Comprehensive Post-Commit Telemetry Coverage across all 4 Transactional Paths', async () => {
    const testCycle = 'cyc_test_all_ops';
    const testPool = 'pool_test_all_ops';
    const testBuilding = 'bld_test_all_ops';
    const testFloor = 'flr_test_all_ops';
    const testRoom = 'rm_test_all_ops';
    const testSeat = 'seat_test_all_ops';

    // Setup base fixtures
    await db.query(
      `INSERT INTO allocation_cycles (id, name, academic_year, status, turn_duration_seconds)
       VALUES ($1, 'All Ops Test Cycle', 2, 'ACTIVE', 120)
       ON CONFLICT (id) DO UPDATE SET status = 'ACTIVE'`,
      [testCycle]
    );
    await db.query(
      `INSERT INTO allocation_pools (id, cycle_id, name, quota_category, academic_year, is_active)
       VALUES ($1, $2, 'All Ops Pool', 'GENERAL', 2, TRUE)
       ON CONFLICT (id) DO NOTHING`,
      [testPool, testCycle]
    );
    await db.query(
      `INSERT INTO buildings (id, code, name, gender_designation, lifecycle_status, is_active)
       VALUES ($1, 'AOP', 'All Ops Hall', 'MALE', 'ACTIVE', TRUE)
       ON CONFLICT (id) DO NOTHING`,
      [testBuilding]
    );
    await db.query(
      `INSERT INTO floors (id, building_id, floor_number, label)
       VALUES ($1, $2, 1, 'First Floor')
       ON CONFLICT (id) DO NOTHING`,
      [testFloor, testBuilding]
    );
    await db.query(
      `INSERT INTO rooms (id, floor_id, room_number, capacity, is_blocked)
       VALUES ($1, $2, '101', 2, FALSE)
       ON CONFLICT (id) DO NOTHING`,
      [testRoom, testFloor]
    );
    await db.query(
      `INSERT INTO seats (id, room_id, seat_label, status)
       VALUES ($1, $2, 'S-1', 'ACTIVE')
       ON CONFLICT (id) DO UPDATE SET status = 'ACTIVE'`,
      [testSeat, testRoom]
    );

    const broadcasts: string[] = [];
    const { AllocationEngineService } = await import('../src/allocation/engine.js');
    const mockTelemetryService = {
      broadcastCycleUpdate: (cId: string) => {
        broadcasts.push(cId);
      },
      getStudentWaitingRoomState: telemetryService.getStudentWaitingRoomState.bind(telemetryService),
      subscribe: telemetryService.subscribe.bind(telemetryService),
    } as any;

    const testEngine = new AllocationEngineService(db, mockTelemetryService);

    const actor1 = {
      id: 'usr_test_p3_s1',
      college_id: '1SI25CS001',
      role: 'STUDENT' as const,
      scope_type: 'STUDENT' as const,
      student_profile_id: student1ProfileId,
    };

    // --- Operation 1: joinWaitingRoom ---
    // Success: Exactly 1 broadcast post-commit
    const joinRes = await testEngine.joinWaitingRoom(testCycle, student1ProfileId, actor1);
    expect(joinRes.status).toBe('WAITING');
    expect(broadcasts).toEqual([testCycle]);
    broadcasts.length = 0; // reset

    // Rollback / Failure: 0 broadcasts
    await expect(
      testEngine.joinWaitingRoom(testCycle, 'prof_invalid', {
        id: 'usr_invalid',
        college_id: 'INVALID',
        role: 'STUDENT',
        scope_type: 'STUDENT',
        student_profile_id: 'prof_invalid',
      })
    ).rejects.toThrow();
    expect(broadcasts).toEqual([]);

    // --- Operation 2: advancePoolTurn ---
    // Success: Exactly 1 broadcast post-commit
    const advanceSession = await testEngine.advancePoolTurn(testPool);
    expect(advanceSession).not.toBeNull();
    expect(advanceSession?.status).toBe('ACTIVE');
    expect(broadcasts).toEqual([testCycle]);
    broadcasts.length = 0; // reset

    // Failure / Invalid pool: 0 broadcasts
    const invalidAdvance = await testEngine.advancePoolTurn('pool_non_existent');
    expect(invalidAdvance).toBeNull();
    expect(broadcasts).toEqual([]);

    // --- Operation 3: confirmSeat ---
    // Success: Exactly 1 broadcast post-commit
    const confirmRes = await testEngine.confirmSeat(advanceSession!.sessionId, testSeat, actor1);
    expect(confirmRes.status).toBe('CURRENT');
    expect(confirmRes.seatId).toBe(testSeat);
    expect(broadcasts).toEqual([testCycle]);
    broadcasts.length = 0; // reset

    // Rollback / Duplicate confirm on taken seat or invalid session: 0 broadcasts
    await expect(
      testEngine.confirmSeat('sess_non_existent', testSeat, actor1)
    ).rejects.toThrow();
    expect(broadcasts).toEqual([]);

    // --- Operation 4: leaveWaitingRoom ---
    // Enroll Student 2 to test leaving
    const actor2 = {
      id: 'usr_test_p3_s2',
      college_id: '1SI25CS002',
      role: 'STUDENT' as const,
      scope_type: 'STUDENT' as const,
      student_profile_id: student2ProfileId,
    };
    await testEngine.joinWaitingRoom(testCycle, student2ProfileId, actor2);
    broadcasts.length = 0; // reset

    // Success: Exactly 1 broadcast post-commit
    const leaveRes = await testEngine.leaveWaitingRoom(testCycle, student2ProfileId, actor2);
    expect(leaveRes.status).toBe('CANCELLED');
    expect(broadcasts).toEqual([testCycle]);
    broadcasts.length = 0; // reset

    // Failure / Unauthorized leave: 0 broadcasts
    await expect(
      testEngine.leaveWaitingRoom(testCycle, student2ProfileId, actor1)
    ).rejects.toThrow();
    expect(broadcasts).toEqual([]);
  });
});
