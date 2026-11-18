import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { getDatabaseService, DatabaseService } from '../src/db/index.js';
import { runMigrations } from '../src/db/schema.js';
import { seedDatabase } from '../src/db/seed.js';
import { hashPasswordAsync } from '../src/auth/passwordUtils.js';

describe('P1 Verification Suite: Dynamic Student Dossier & Real Admin Audit Ledger', () => {
  let app: FastifyInstance;
  let db: DatabaseService;
  let staffToken: string;
  let student1Id: string;
  let student2Id: string;
  let proctorUserId: string;

  beforeAll(async () => {
    db = getDatabaseService(true);
    await runMigrations(db);
    await seedDatabase(db);
    app = await buildApp(db);
    await app.ready();

    // 1. Create Staff User (Hostel Office)
    const staffPass = 'StaffPass123!';
    const staffHash = await hashPasswordAsync(staffPass);
    const staffUserRes = await db.query(
      `INSERT INTO users (id, college_id, email, full_name, password_hash, is_active)
       VALUES ('usr_test_p1_staff', 'HOFF999', 'office_p1@dormex.edu', 'Hostel Officer Test', $1, TRUE)
       ON CONFLICT (id) DO UPDATE SET is_active = TRUE
       RETURNING id`,
      [staffHash]
    );
    await db.query(
      `INSERT INTO user_roles (id, user_id, role_id, scope_type)
       VALUES ('ur_test_p1_staff', $1, 'role_hostel_office', 'SYSTEM')
       ON CONFLICT (id) DO NOTHING`,
      [staffUserRes.rows[0].id]
    );

    // 2. Create Proctor User
    const proctorPass = 'ProctorPass123!';
    const proctorHash = await hashPasswordAsync(proctorPass);
    const proctorRes = await db.query(
      `INSERT INTO users (id, college_id, email, full_name, password_hash, is_active)
       VALUES ('usr_test_p1_proctor', 'PRC999', 'proctor_p1@dormex.edu', 'Dr. Aruna Devi', $1, TRUE)
       ON CONFLICT (id) DO UPDATE SET is_active = TRUE
       RETURNING id`,
      [proctorHash]
    );
    proctorUserId = proctorRes.rows[0].id;
    await db.query(
      `INSERT INTO user_roles (id, user_id, role_id, scope_type)
       VALUES ('ur_test_p1_proctor', $1, 'role_proctor', 'SYSTEM')
       ON CONFLICT (id) DO NOTHING`,
      [proctorUserId]
    );

    // 3. Create Student 1 with complete parent and proctor details
    const studentPass = 'StudentPass123!';
    const studentHash = await hashPasswordAsync(studentPass);
    const s1User = await db.query(
      `INSERT INTO users (id, college_id, email, full_name, password_hash, is_active)
       VALUES ('usr_test_p1_stu1', '1SI25CS101', 's101@dormex.edu', 'P1 First Candidate', $1, TRUE)
       ON CONFLICT (id) DO UPDATE SET is_active = TRUE
       RETURNING id`,
      [studentHash]
    );
    await db.query(
      `INSERT INTO user_roles (id, user_id, role_id, scope_type)
       VALUES ('ur_test_p1_stu1', $1, 'role_student', 'STUDENT')
       ON CONFLICT (id) DO NOTHING`,
      [s1User.rows[0].id]
    );
    await db.query(
      `INSERT INTO students (usn, full_name, email, user_id, branch, admission_year, account_status)
       VALUES ('1SI25CS101', 'P1 First Candidate', 's101@dormex.edu', $1, 'CS', 2025, 'ACTIVE')
       ON CONFLICT (usn) DO UPDATE SET account_status = 'ACTIVE'`,
      [s1User.rows[0].id]
    );
    const p1 = await db.query(
      `INSERT INTO student_profiles (
         id, user_id, college_id, full_name, department, gender, academic_year, quota_category,
         eligibility_status, assigned_priority, parent_name, parent_relationship, parent_phone,
         local_guardian_address, proctor_user_id, proctor_name, proctor_department, fee_status,
         fee_receipt_ref, fee_payment_timestamp
       )
       VALUES (
         'prof_test_p1_stu1', $1, '1SI25CS101', 'P1 First Candidate', 'Computer Science', 'FEMALE', 3, 'MERIT',
         'ELIGIBLE', 1, 'Mrs. Shailaja K', 'Mother', '+91 98765 43210',
         '#100 Indiranagar, Bangalore, Karnataka', $2, 'Dr. Aruna Devi', 'Computer Science', 'VERIFIED',
         'REC-REAL-7788', CURRENT_TIMESTAMP
       )
       ON CONFLICT (id) DO UPDATE SET
         parent_name = 'Mrs. Shailaja K',
         proctor_name = 'Dr. Aruna Devi',
         fee_receipt_ref = 'REC-REAL-7788'
       RETURNING id`,
      [s1User.rows[0].id, proctorUserId]
    );
    student1Id = p1.rows[0].id;

    // 4. Create Student 2 with missing optional guardian & proctor details
    const s2User = await db.query(
      `INSERT INTO users (id, college_id, email, full_name, password_hash, is_active)
       VALUES ('usr_test_p1_stu2', '1SI25EC202', 's202@dormex.edu', 'P1 Second Candidate', $1, TRUE)
       ON CONFLICT (id) DO UPDATE SET is_active = TRUE
       RETURNING id`,
      [studentHash]
    );
    await db.query(
      `INSERT INTO user_roles (id, user_id, role_id, scope_type)
       VALUES ('ur_test_p1_stu2', $1, 'role_student', 'STUDENT')
       ON CONFLICT (id) DO NOTHING`,
      [s2User.rows[0].id]
    );
    await db.query(
      `INSERT INTO students (usn, full_name, email, user_id, branch, admission_year, account_status)
       VALUES ('1SI25EC202', 'P1 Second Candidate', 's202@dormex.edu', $1, 'EC', 2025, 'ACTIVE')
       ON CONFLICT (usn) DO UPDATE SET account_status = 'ACTIVE'`,
      [s2User.rows[0].id]
    );
    const p2 = await db.query(
      `INSERT INTO student_profiles (
         id, user_id, college_id, full_name, department, gender, academic_year, quota_category,
         eligibility_status, assigned_priority, parent_name, proctor_user_id, fee_status, fee_receipt_ref
       )
       VALUES (
         'prof_test_p1_stu2', $1, '1SI25EC202', 'P1 Second Candidate', 'Electronics', 'MALE', 2, 'GENERAL',
         'PENDING', 2, NULL, NULL, 'UNPAID', NULL
       )
       ON CONFLICT (id) DO UPDATE SET parent_name = NULL, proctor_name = NULL, fee_receipt_ref = NULL
       RETURNING id`,
      [s2User.rows[0].id]
    );
    student2Id = p2.rows[0].id;

    // 5. Authenticate Staff
    const loginRes = await request(app.server)
      .post('/api/auth/login')
      .send({ identifier: 'HOFF999', password: staffPass });
    expect(loginRes.status).toBe(200);
    const cookies = loginRes.headers['set-cookie'];
    const tokenMatch = Array.isArray(cookies) ? cookies.find((c: string) => c.startsWith('token=')) : null;
    staffToken = tokenMatch ? tokenMatch.split(';')[0] : '';
    expect(staffToken).toBeTruthy();
  });

  afterAll(async () => {
    if (app) await app.close();
    if (db) await db.close();
  });

  describe('1. Dynamic Student Registry Dossier Backend Data Flow', () => {
    it('returns authoritative parent and proctor fields for registered student profiles', async () => {
      const res = await request(app.server)
        .get('/api/students')
        .set('Cookie', staffToken);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);

      const stu1 = res.body.find((s: any) => s.id === student1Id);
      expect(stu1).toBeDefined();
      expect(stu1.parent_name).toBe('Mrs. Shailaja K');
      expect(stu1.parent_relationship).toBe('Mother');
      expect(stu1.parent_phone).toBe('+91 98765 43210');
      expect(stu1.proctor_name).toBe('Dr. Aruna Devi');
      expect(stu1.proctor_department).toBe('Computer Science');
      expect(stu1.fee_receipt_ref).toBe('REC-REAL-7788');
      expect(stu1.fee_status).toBe('VERIFIED');
    });

    it('returns null/unassigned fields for student without assigned proctor or parent details', async () => {
      const res = await request(app.server)
        .get('/api/students')
        .set('Cookie', staffToken);

      expect(res.status).toBe(200);
      const stu2 = res.body.find((s: any) => s.id === student2Id);
      expect(stu2).toBeDefined();
      expect(stu2.parent_name).toBeNull();
      expect(stu2.proctor_name).toBeNull();
      expect(stu2.proctor_user_id).toBeNull();
      expect(stu2.fee_receipt_ref).toBeNull();
      expect(stu2.fee_status).toBe('UNPAID');
    });

    it('denies unauthenticated access to student registry records', async () => {
      const res = await request(app.server)
        .get('/api/students');

      expect([401, 403]).toContain(res.status);
    });
  });

  describe('2. Real Admin Audit Ledger API Contract & Flow', () => {
    it('returns authentic chronological audit logs with actor and target fields', async () => {
      // Insert an authentic audit record for fee verification
      const auditId = `aud_test_p1_${Date.now()}`;
      await db.query(
        `INSERT INTO audit_logs (id, actor_id, action, target_type, target_id, reason)
         VALUES ($1, 'usr_test_p1_staff', 'FEE_VERIFIED', 'STUDENT_PROFILE', $2, 'Payment slip verified by office')`,
        [auditId, student1Id]
      );

      const res = await request(app.server)
        .get('/api/admin/audit-logs')
        .set('Cookie', staffToken);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThanOrEqual(1);

      const log = res.body.find((l: any) => l.id === auditId);
      expect(log).toBeDefined();
      expect(log.action).toBe('FEE_VERIFIED');
      expect(log.target_type).toBe('STUDENT_PROFILE');
      expect(log.target_id).toBe(student1Id);
      expect(log.actor_name).toBe('Hostel Officer Test');
      expect(log.reason).toBe('Payment slip verified by office');
      expect(log.created_at).toBeDefined();
    });

    it('strictly forbids non-administrative roles from querying audit logs', async () => {
      // Authenticate as Student
      const sLoginRes = await request(app.server)
        .post('/api/auth/login')
        .send({ identifier: '1SI25CS101', password: 'StudentPass123!' });
      expect(sLoginRes.status).toBe(200);

      const sCookies = sLoginRes.headers['set-cookie'];
      const sTokenMatch = Array.isArray(sCookies) ? sCookies.find((c: string) => c.startsWith('token=')) : null;
      const studentCookie = sTokenMatch ? sTokenMatch.split(';')[0] : '';
      expect(studentCookie).toBeTruthy();

      const res = await request(app.server)
        .get('/api/admin/audit-logs')
        .set('Cookie', studentCookie);

      expect(res.status).toBe(403);
      expect(res.body.error).toContain('FORBIDDEN');
    });
  });
});
