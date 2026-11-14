import { DatabaseService } from '../db/index.js';
import { AuthActor, can } from '../auth/policy.js';
import { AuthService } from '../auth/service.js';
import {
  StudentRecord,
  StudentYearPriorityRecord,
  BuildingEligibilityPolicy,
  StudentImportRow,
  StudentImportResult,
  validateInstitutionalUsn,
  parseInstitutionalUsn,
} from './studentModel.js';

export class InstitutionalStudentService {
  constructor(private db: DatabaseService) {}

  /**
   * Register a single real institutional student with USN as PRIMARY KEY
   */
  async registerStudent(
    input: {
      usn: string;
      full_name: string;
      email: string;
      phone?: string;
      academic_year?: number;
      current_semester?: number;
      gender?: 'MALE' | 'FEMALE' | 'OTHER';
    },
    actor: AuthActor
  ): Promise<StudentRecord> {
    if (!can(actor, 'student.manage')) {
      throw new Error('FORBIDDEN: Only authorized administrative staff can register institutional students');
    }

    const cleanUsn = input.usn.trim().toUpperCase();
    if (!validateInstitutionalUsn(cleanUsn)) {
      throw new Error(`INVALID_USN_FORMAT: USN "${cleanUsn}" does not conform to institutional pattern 1SI<2-digit year><branch><3-digits> (e.g. 1SI25CS001)`);
    }

    const parsed = parseInstitutionalUsn(cleanUsn)!;
    const admissionYear = parsed.admissionYear;
    const branch = parsed.branch;
    const academicYear = input.academic_year || 1;
    const semester = input.current_semester || 1;
    const gender = input.gender || 'MALE';

    return this.db.transaction(async (client) => {
      // 1. Check duplicate USN
      const dupUsn = await client.query('SELECT usn FROM students WHERE usn = $1', [cleanUsn]);
      if (dupUsn.rows.length > 0) {
        throw new Error(`DUPLICATE_USN: Student with USN ${cleanUsn} already exists in institutional registry`);
      }

      // 2. Check duplicate Email
      const dupEmail = await client.query('SELECT usn FROM students WHERE email = $1', [input.email.trim().toLowerCase()]);
      if (dupEmail.rows.length > 0) {
        throw new Error(`DUPLICATE_EMAIL: Student with email ${input.email} already exists`);
      }

      // 3. Create or resolve institutional user account
      const userId = `usr_${cleanUsn.toLowerCase()}`;
      const authService = new AuthService(this.db);
      const defaultPasswordHash = authService.hashPassword('password');

      await client.query(
        `INSERT INTO users (id, college_id, email, full_name, phone, password_hash)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (id) DO UPDATE SET full_name = EXCLUDED.full_name, email = EXCLUDED.email`,
        [userId, cleanUsn, input.email.trim().toLowerCase(), input.full_name.trim(), input.phone || null, defaultPasswordHash]
      );

      // Assign STUDENT role
      const roleRes = await client.query(`SELECT id FROM roles WHERE name = 'STUDENT'`);
      const roleId = roleRes.rows[0]?.id || 'role_student';
      await client.query(
        `INSERT INTO user_roles (id, user_id, role_id, scope_type, scope_id)
         VALUES ($1, $2, $3, 'STUDENT', NULL)
         ON CONFLICT (id) DO NOTHING`,
        [`ur_${userId}`, userId, roleId]
      );

      // 4. Insert into students table (USN PRIMARY KEY)
      const res = await client.query(
        `INSERT INTO students (
          usn, user_id, full_name, email, phone, admission_year, branch, academic_year, current_semester, gender, account_status, eligibility_status
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'ACTIVE', 'PENDING')
        RETURNING *`,
        [
          cleanUsn,
          userId,
          input.full_name.trim(),
          input.email.trim().toLowerCase(),
          input.phone || null,
          admissionYear,
          branch,
          academicYear,
          semester,
          gender,
        ]
      );

      // Also ensure student_profiles compatibility record exists for historical/FK integrations
      const profileId = `prof_${cleanUsn.toLowerCase()}`;
      await client.query(
        `INSERT INTO student_profiles (
          id, user_id, college_id, full_name, admission_batch_year, academic_year, department, gender, quota_category, eligibility_status
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'GENERAL', 'PENDING')
        ON CONFLICT (id) DO UPDATE SET full_name = EXCLUDED.full_name, college_id = EXCLUDED.college_id`,
        [
          profileId,
          userId,
          cleanUsn,
          input.full_name.trim(),
          String(admissionYear),
          academicYear,
          branch,
          gender,
        ]
      );

      return res.rows[0];
    });
  }

  /**
   * Import batch of students transactionally with validation report
   */
  async importStudentsCsv(rows: StudentImportRow[], actor: AuthActor): Promise<StudentImportResult> {
    if (!can(actor, 'student.manage')) {
      throw new Error('FORBIDDEN: Only authorized administrative staff can import student registries');
    }

    const result: StudentImportResult = {
      total_processed: rows.length,
      inserted: 0,
      updated: 0,
      rejected: [],
      report_timestamp: new Date().toISOString(),
    };

    for (const row of rows) {
      const rawUsn = (row.usn || '').trim().toUpperCase();
      if (!rawUsn) {
        result.rejected.push({ usn: 'UNKNOWN', reason: 'USN is required' });
        continue;
      }
      if (!validateInstitutionalUsn(rawUsn)) {
        result.rejected.push({ usn: rawUsn, reason: 'Invalid institutional USN format (expected 1SI25<branch>XYZ)' });
        continue;
      }
      if (!row.full_name || !row.email) {
        result.rejected.push({ usn: rawUsn, reason: 'Missing mandatory full_name or email' });
        continue;
      }

      try {
        await this.registerStudent(
          {
            usn: rawUsn,
            full_name: row.full_name,
            email: row.email,
            phone: row.phone,
            academic_year: row.academic_year,
            current_semester: row.current_semester,
            gender: row.gender,
          },
          actor
        );
        result.inserted++;
      } catch (err: any) {
        result.rejected.push({ usn: rawUsn, reason: err.message || 'Import error' });
      }
    }

    return result;
  }

  /**
   * Manage student year priority by academic year, building, and semester
   */
  async setStudentYearPriority(
    params: {
      studentUsn: string;
      academicYear: number;
      assignedPriority: number;
      buildingId?: string | null;
      semester?: number | null;
      source?: 'AUTOMATIC_FEE' | 'MANUAL' | 'OVERRIDE';
      overrideReason?: string | null;
    },
    actor: AuthActor
  ): Promise<StudentYearPriorityRecord> {
    if (!can(actor, 'student.edit_priority')) {
      throw new Error('FORBIDDEN: Only authorized administrative staff can assign yearwise student priority');
    }

    const cleanUsn = params.studentUsn.trim().toUpperCase();
    return this.db.transaction(async (client) => {
      // 1. Verify student exists
      const stuRes = await client.query('SELECT usn FROM students WHERE usn = $1', [cleanUsn]);
      if (stuRes.rows.length === 0) {
        throw new Error(`STUDENT_NOT_FOUND: Student with USN ${cleanUsn} does not exist in institutional records`);
      }

      // 2. Check conflict: building-wise unique priority for that study year
      if (params.buildingId) {
        const conflictRes = await client.query(
          `SELECT student_usn FROM student_year_priority 
           WHERE academic_year = $1 AND building_id = $2 AND assigned_priority = $3 AND student_usn != $4`,
          [params.academicYear, params.buildingId, params.assignedPriority, cleanUsn]
        );
        if (conflictRes.rows.length > 0) {
          throw new Error(`PRIORITY_CONFLICT: Priority rank ${params.assignedPriority} in building ${params.buildingId} for academic year ${params.academicYear} is already assigned to student ${conflictRes.rows[0].student_usn}`);
        }
      }

      const id = `syp_${cleanUsn.toLowerCase()}_y${params.academicYear}`;
      const res = await client.query(
        `INSERT INTO student_year_priority (
          id, student_usn, academic_year, building_id, semester, assigned_priority, priority_source, override_reason, assigned_by
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        ON CONFLICT (student_usn, academic_year) DO UPDATE SET
          assigned_priority = EXCLUDED.assigned_priority,
          building_id = EXCLUDED.building_id,
          semester = EXCLUDED.semester,
          priority_source = EXCLUDED.priority_source,
          override_reason = EXCLUDED.override_reason,
          assigned_by = EXCLUDED.assigned_by,
          updated_at = CURRENT_TIMESTAMP
        RETURNING *`,
        [
          id,
          cleanUsn,
          params.academicYear,
          params.buildingId || null,
          params.semester || null,
          params.assignedPriority,
          params.source || 'MANUAL',
          params.overrideReason || null,
          actor.id,
        ]
      );

      // Synchronize with student_profiles assigned_priority for backwards compatibility if no conflicting profile priority exists
      const profId = `prof_${cleanUsn.toLowerCase()}`;
      try {
        await client.query(
          `UPDATE student_profiles SET assigned_priority = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 OR college_id = $3`,
          [params.assignedPriority, profId, cleanUsn]
        );
      } catch (err) {
        // In legacy single-table schema, student_profiles had unique constraint on (academic_year, quota_category, assigned_priority).
        // If updating legacy assigned_priority conflicts across different buildings, ignore the legacy sync
        // as student_year_priority is the server-authoritative multi-building priority store.
      }

      return res.rows[0];
    });
  }

  /**
   * Get student record by USN
   */
  async getStudentByUsn(usn: string, actor: AuthActor): Promise<StudentRecord | null> {
    const cleanUsn = usn.trim().toUpperCase();
    if (actor.role === 'STUDENT' && actor.college_id.toUpperCase() !== cleanUsn) {
      throw new Error('FORBIDDEN: Students can only view their own institutional record');
    }

    const res = await this.db.query('SELECT * FROM students WHERE usn = $1', [cleanUsn]);
    return res.rows[0] || null;
  }

  /**
   * List students with filtering
   */
  async listStudents(
    query: {
      search?: string;
      academic_year?: number;
      branch?: string;
      eligibility_status?: string;
      building_id?: string;
    },
    actor: AuthActor
  ): Promise<any[]> {
    if (actor.role === 'STUDENT') {
      throw new Error('FORBIDDEN: Only authorized staff can view student population rosters');
    }

    let sql = `
      SELECT s.*, syp.assigned_priority as yearwise_priority, syp.building_id as priority_building_id
      FROM students s
      LEFT JOIN student_year_priority syp ON s.usn = syp.student_usn AND s.academic_year = syp.academic_year
      WHERE 1=1
    `;
    const params: any[] = [];

    if (query.academic_year) {
      params.push(query.academic_year);
      sql += ` AND s.academic_year = $${params.length}`;
    }
    if (query.branch) {
      params.push(query.branch.toUpperCase());
      sql += ` AND s.branch = $${params.length}`;
    }
    if (query.eligibility_status) {
      params.push(query.eligibility_status);
      sql += ` AND s.eligibility_status = $${params.length}`;
    }
    if (query.search) {
      params.push(`%${query.search.trim()}%`);
      sql += ` AND (s.usn ILIKE $${params.length} OR s.full_name ILIKE $${params.length} OR s.email ILIKE $${params.length})`;
    }

    sql += ' ORDER BY s.academic_year ASC, syp.assigned_priority ASC NULLS LAST, s.usn ASC';
    const res = await this.db.query(sql, params);
    return res.rows;
  }
}
