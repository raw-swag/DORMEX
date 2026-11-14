import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { buildApp } from '../src/app.js';
import { getDatabaseService, resetDatabaseInstance } from '../src/db/index.js';
import { runMigrations } from '../src/db/schema.js';
import { seedDatabase } from '../src/db/seed.js';

describe('Real Institutional Student Identity & Yearwise Priority Suite', () => {
  let app: any;
  let db: any;

  beforeAll(async () => {
    resetDatabaseInstance();
    db = getDatabaseService(true);
    await runMigrations(db);
    await seedDatabase(db);
    const fastifyApp = await buildApp(db);
    await fastifyApp.ready();
    app = fastifyApp.server;
  }, 30000);

  describe('1. Institutional USN Structure & Registration (1SI25<branch>XYZ)', () => {
    it('successfully registers an institutional student with USN as PRIMARY KEY', async () => {
      const res = await request(app)
        .post('/api/institutional-students')
        .set('x-user-id', 'usr_admin') // Chief Warden
        .send({
          usn: '1SI25CS001',
          full_name: 'Aditya Rao',
          email: 'aditya.rao@sit.edu',
          phone: '+919876543210',
          academic_year: 1,
          current_semester: 1,
          gender: 'MALE',
        });

      expect(res.status).toBe(201);
      expect(res.body.usn).toBe('1SI25CS001');
      expect(res.body.admission_year).toBe(2025);
      expect(res.body.branch).toBe('CS');
      expect(res.body.account_status).toBe('ACTIVE');

      // Verify row in database
      const dbCheck = await db.query('SELECT * FROM students WHERE usn = $1', ['1SI25CS001']);
      expect(dbCheck.rows.length).toBe(1);
      expect(dbCheck.rows[0].email).toBe('aditya.rao@sit.edu');
    });

    it('rejects invalid USN formats (must match 1SI<2-digit year><2-letter branch><3-digits>)', async () => {
      const res = await request(app)
        .post('/api/institutional-students')
        .set('x-user-id', 'usr_admin')
        .send({
          usn: 'INVALID_USN_999',
          full_name: 'Invalid Student',
          email: 'invalid@sit.edu',
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('INVALID_USN_FORMAT');
    });

    it('rejects duplicate USN registration', async () => {
      const res = await request(app)
        .post('/api/institutional-students')
        .set('x-user-id', 'usr_admin')
        .send({
          usn: '1SI25CS001',
          full_name: 'Aditya Rao Duplicate',
          email: 'different.email@sit.edu',
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('DUPLICATE_USN');
    });

    it('forbids students from registering new students', async () => {
      const res = await request(app)
        .post('/api/institutional-students')
        .set('x-user-id', 'usr_demo_001') // Student persona
        .send({
          usn: '1SI25EC002',
          full_name: 'Rohan Sharma',
          email: 'rohan.sharma@sit.edu',
        });

      expect(res.status).toBe(403);
    });
  });

  describe('2. Batch CSV Import with Validation & Report', () => {
    it('imports valid CSV rows and reports rejected rows with reasons', async () => {
      const rows = [
        {
          usn: '1SI25EC010',
          full_name: 'Kavya Nair',
          email: 'kavya.ec@sit.edu',
          academic_year: 1,
          current_semester: 1,
          gender: 'FEMALE' as const,
        },
        {
          usn: '1SI25AI020',
          full_name: 'Nikhil Kumar',
          email: 'nikhil.ai@sit.edu',
          academic_year: 1,
          current_semester: 1,
          gender: 'MALE' as const,
        },
        {
          usn: 'BAD_USN_FORMAT',
          full_name: 'Bad USN',
          email: 'bad@sit.edu',
        },
        {
          usn: '1SI25EC010', // duplicate in same batch
          full_name: 'Duplicate Kavya',
          email: 'dup.kavya@sit.edu',
        },
      ];

      const res = await request(app)
        .post('/api/institutional-students/import-csv')
        .set('x-user-id', 'usr_admin')
        .send(rows);

      expect(res.status).toBe(200);
      expect(res.body.total_processed).toBe(4);
      expect(res.body.inserted).toBe(2);
      expect(res.body.rejected.length).toBe(2);
      expect(res.body.rejected[0].usn).toBe('BAD_USN_FORMAT');
      expect(res.body.rejected[1].usn).toBe('1SI25EC010');
    });
  });

  describe('3. Yearwise Priority Table (student_year_priority) & Conflict Handling', () => {
    it('assigns yearwise priority slot for student in a building', async () => {
      const res = await request(app)
        .put('/api/institutional-students/1SI25CS001/year-priority')
        .set('x-user-id', 'usr_admin')
        .send({
          academicYear: 1,
          assignedPriority: 1,
          buildingId: 'bld_bvb',
          semester: 1,
          source: 'MANUAL',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.priority.assigned_priority).toBe(1);
      expect(res.body.priority.building_id).toBe('bld_bvb');
    });

    it('rejects conflict when another student attempts to claim the same priority in the same building and academic year', async () => {
      // 1SI25AI020 attempts to claim priority #1 in building 'bld_bvb' for academic year 1
      const res = await request(app)
        .put('/api/institutional-students/1SI25AI020/year-priority')
        .set('x-user-id', 'usr_admin')
        .send({
          academicYear: 1,
          assignedPriority: 1,
          buildingId: 'bld_bvb',
          semester: 1,
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('PRIORITY_CONFLICT');
    });

    it('permits same priority rank #1 in a DIFFERENT building (no building conflict)', async () => {
      await db.query(`INSERT INTO buildings (id, code, name, gender_designation, is_active) VALUES ('bld_main', 'MAIN', 'Main Hostel Block', 'COED', TRUE) ON CONFLICT (id) DO NOTHING`);

      const res = await request(app)
        .put('/api/institutional-students/1SI25AI020/year-priority')
        .set('x-user-id', 'usr_admin')
        .send({
          academicYear: 1,
          assignedPriority: 1,
          buildingId: 'bld_main',
          semester: 1,
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.priority.building_id).toBe('bld_main');
    });
  });

  describe('4. Configurable Building Eligibility Policies & Rule Precedence', () => {
    it('sets building eligibility policy allowing only Year 1 students to bld_bvb', async () => {
      const res = await request(app)
        .post('/api/buildings/bld_bvb/eligibility-policies')
        .set('x-user-id', 'usr_admin')
        .send({
          academicYear: 1,
          policyType: 'GRANT',
          reason: 'BVB Block Floor 2 is strictly reserved for First Year Engineering Students',
        });

      expect(res.status).toBe(201);
      expect(res.body.building_id).toBe('bld_bvb');
      expect(res.body.academic_year).toBe(1);
    });

    it('evaluates student eligibility: First Year student is eligible', async () => {
      const res = await request(app)
        .post('/api/buildings/bld_bvb/evaluate-eligibility')
        .send({
          studentUsn: '1SI25CS001',
          academicYear: 1,
          branch: 'CS',
        });

      expect(res.status).toBe(200);
      expect(res.body.isEligible).toBe(true);
      expect(res.body.verdict).toBe('GRANTED');
    });

    it('evaluates student eligibility: Third Year student is restricted by cohort policy', async () => {
      const res = await request(app)
        .post('/api/buildings/bld_bvb/evaluate-eligibility')
        .send({
          studentUsn: '1SI23CS099',
          academicYear: 3,
          branch: 'CS',
        });

      expect(res.status).toBe(200);
      expect(res.body.isEligible).toBe(false);
      expect(res.body.verdict).toBe('RESTRICTED');
      expect(res.body.reasons[0]).toContain('COHORT_NOT_PERMITTED');
    });

    it('applies explicit student USN exception overriding cohort restriction', async () => {
      // First ensure student 1SI23CS099 exists in students table
      await request(app)
        .post('/api/institutional-students')
        .set('x-user-id', 'usr_admin')
        .send({
          usn: '1SI23CS099',
          full_name: 'Senior Proctor Assistant',
          email: 'proctor.asst@sit.edu',
          academic_year: 3,
          current_semester: 5,
          gender: 'MALE',
        });

      // Grant individual exemption for 1SI23CS099 (e.g. Proctor Assistant / Special Needs)
      const grantRes = await request(app)
        .post('/api/buildings/bld_bvb/eligibility-policies')
        .set('x-user-id', 'usr_admin')
        .send({
          studentUsn: '1SI23CS099',
          policyType: 'GRANT',
          reason: 'Special Proctor Assistant Accommodation authorized by Chief Warden',
        });

      const res = await request(app)
        .post('/api/buildings/bld_bvb/evaluate-eligibility')
        .send({
          studentUsn: '1SI23CS099',
          academicYear: 3,
          branch: 'CS',
        });

      expect(res.status).toBe(200);
      expect(res.body.isEligible).toBe(true);
      expect(res.body.verdict).toBe('GRANTED');
      expect(res.body.reasons[0]).toContain('STUDENT_GRANT');
    });

    it('applies explicit student USN restriction overriding general grant (fail-closed)', async () => {
      // Add disciplinary restriction for 1SI25CS001
      await request(app)
        .post('/api/buildings/bld_bvb/eligibility-policies')
        .set('x-user-id', 'usr_admin')
        .send({
          studentUsn: '1SI25CS001',
          policyType: 'RESTRICTION',
          reason: 'Disciplinary suspension from BVB Block residence',
        });

      const res = await request(app)
        .post('/api/buildings/bld_bvb/evaluate-eligibility')
        .send({
          studentUsn: '1SI25CS001',
          academicYear: 1,
          branch: 'CS',
        });

      expect(res.status).toBe(200);
      expect(res.body.isEligible).toBe(false);
      expect(res.body.verdict).toBe('RESTRICTED');
      expect(res.body.reasons[0]).toContain('STUDENT_RESTRICTION');
    });
  });
});
