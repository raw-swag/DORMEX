import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DatabaseService, getDatabaseService, resetDatabaseInstance } from '../src/db/index.js';
import { runMigrations } from '../src/db/schema.js';
import { buildApp } from '../src/app.js';
import {
  resolveAuthoritativeActor,
  assertRoleCompatibility,
  validateRoleScopeCompatibility,
} from '../src/auth/policy.js';

describe('Multi-Role Fail-Closed Authorization & Scope Compatibility Suite (SEC-01 & SEC-02)', () => {
  let db: DatabaseService;
  let fastifyApp: any;

  beforeEach(async () => {
    resetDatabaseInstance();
    db = getDatabaseService(true);
    await runMigrations(db);
    fastifyApp = await buildApp(db);

    // Setup base institutional roles
    await db.query(`INSERT INTO roles (id, name, description) VALUES
      ('role_student', 'STUDENT', 'Student resident'),
      ('role_proctor', 'PROCTOR', 'Faculty proctor'),
      ('role_warden', 'WARDEN', 'Building Warden'),
      ('role_chief_warden', 'CHIEF_WARDEN', 'Chief Warden across all hostels'),
      ('role_hostel_office', 'HOSTEL_OFFICE', 'Hostel Office Administrator'),
      ('role_super_admin', 'SUPER_ADMIN', 'Super Administrator with system override')
      ON CONFLICT (id) DO NOTHING;`);
  });

  afterEach(async () => {
    if (fastifyApp) await fastifyApp.close();
    await db.close();
    resetDatabaseInstance();
  });

  describe('1. SEC-01: Incompatible Multi-Role Conflict Rejection', () => {
    it('fails closed and rejects STUDENT + SUPER_ADMIN coexisting on same user', () => {
      const records = [
        { id: 'usr_c1', college_id: 'BAD01', role_name: 'STUDENT', scope_type: 'STUDENT' },
        { id: 'usr_c1', college_id: 'BAD01', role_name: 'SUPER_ADMIN', scope_type: 'SYSTEM' },
      ];
      expect(() => resolveAuthoritativeActor(records)).toThrowError(
        /AUTHORIZATION_CONFLICT: Incompatible role assignments detected/
      );
    });

    it('fails closed and rejects STUDENT + CHIEF_WARDEN coexisting on same user', () => {
      const records = [
        { id: 'usr_c2', college_id: 'BAD02', role_name: 'STUDENT', scope_type: 'STUDENT' },
        { id: 'usr_c2', college_id: 'BAD02', role_name: 'CHIEF_WARDEN', scope_type: 'SYSTEM' },
      ];
      expect(() => resolveAuthoritativeActor(records)).toThrowError(
        /AUTHORIZATION_CONFLICT: Incompatible role assignments detected/
      );
    });

    it('fails closed and rejects STUDENT + HOSTEL_OFFICE coexisting on same user', () => {
      const records = [
        { id: 'usr_c3', college_id: 'BAD03', role_name: 'STUDENT', scope_type: 'STUDENT' },
        { id: 'usr_c3', college_id: 'BAD03', role_name: 'HOSTEL_OFFICE', scope_type: 'SYSTEM' },
      ];
      expect(() => resolveAuthoritativeActor(records)).toThrowError(
        /AUTHORIZATION_CONFLICT: Incompatible role assignments detected/
      );
    });

    it('fails closed and rejects STUDENT + WARDEN coexisting on same user', () => {
      const records = [
        { id: 'usr_c4', college_id: 'BAD04', role_name: 'STUDENT', scope_type: 'STUDENT' },
        { id: 'usr_c4', college_id: 'BAD04', role_name: 'WARDEN', scope_type: 'BUILDING', scope_id: 'bld_1' },
      ];
      expect(() => resolveAuthoritativeActor(records)).toThrowError(
        /AUTHORIZATION_CONFLICT: Incompatible role assignments detected/
      );
    });

    it('fails closed and rejects SUPER_ADMIN + ordinary administrative role coexisting on same user', () => {
      const records = [
        { id: 'usr_c5', college_id: 'BAD05', role_name: 'SUPER_ADMIN', scope_type: 'SYSTEM' },
        { id: 'usr_c5', college_id: 'BAD05', role_name: 'CHIEF_WARDEN', scope_type: 'SYSTEM' },
      ];
      expect(() => resolveAuthoritativeActor(records)).toThrowError(
        /AUTHORIZATION_CONFLICT: Incompatible role assignments detected/
      );
    });
  });

  describe('2. SEC-02: Role/Scope Compatibility Invariants', () => {
    it('rejects WARDEN with SYSTEM scope (wardens must be building-scoped)', () => {
      expect(() => validateRoleScopeCompatibility('WARDEN', 'SYSTEM', null)).toThrowError(
        /ROLE_SCOPE_INCOMPATIBLE: Role 'WARDEN' cannot be assigned scope 'SYSTEM'/
      );
    });

    it('rejects WARDEN with BUILDING scope if building scope_id is omitted', () => {
      expect(() => validateRoleScopeCompatibility('WARDEN', 'BUILDING', null)).toThrowError(
        /ROLE_SCOPE_INCOMPATIBLE: Role 'WARDEN' requires a non-empty building scope_id/
      );
    });

    it('rejects contradictory multi-building scopes for WARDEN without arbitrary collapse', () => {
      const multiBuilding = [
        { id: 'usr_w', college_id: 'WRD01', role_name: 'WARDEN', scope_type: 'BUILDING', scope_id: 'bld_a' },
        { id: 'usr_w', college_id: 'WRD01', role_name: 'WARDEN', scope_type: 'BUILDING', scope_id: 'bld_b' },
      ];
      expect(() => resolveAuthoritativeActor(multiBuilding)).toThrowError(
        /AUTHORIZATION_CONFLICT: Contradictory building scopes detected for WARDEN/
      );
    });

    it('accepts valid single-building WARDEN assignment', () => {
      const validWarden = [
        { id: 'usr_w', college_id: 'WRD01', role_name: 'WARDEN', scope_type: 'BUILDING', scope_id: 'bld_a' },
      ];
      const actor = resolveAuthoritativeActor(validWarden);
      expect(actor.role).toBe('WARDEN');
      expect(actor.scope_type).toBe('BUILDING');
      expect(actor.scope_id).toBe('bld_a');
    });
  });

  describe('3. HTTP-Level End-to-End Enforcement in extractActor', () => {
    it('returns HTTP 401 and refuses login/access when user possesses conflicting roles in database', async () => {
      // Insert conflicting student + super_admin user into database
      await db.query(`INSERT INTO users (id, college_id, email, full_name, password_hash) VALUES
        ('usr_conflict', 'CONFLICT01', 'conflict@college.edu', 'Conflict User', 'hash')
        ON CONFLICT (id) DO NOTHING;`);

      await db.query(`INSERT INTO user_roles (id, user_id, role_id, scope_type) VALUES
        ('ur_conf_1', 'usr_conflict', 'role_student', 'STUDENT'),
        ('ur_conf_2', 'usr_conflict', 'role_super_admin', 'SYSTEM')
        ON CONFLICT (id) DO NOTHING;`);

      const token = fastifyApp.jwt.sign({ sub: 'usr_conflict' });

      const response = await fastifyApp.inject({
        method: 'GET',
        url: '/api/auth/me',
        headers: {
          authorization: `Bearer ${token}`,
        },
      });

      expect(response.statusCode).toBe(401);
      const body = response.json();
      expect(body.error).toContain('AUTHORIZATION_CONFLICT');
    });

    it('returns HTTP 200 for clean canonical user with legitimate role and scope', async () => {
      await db.query(`INSERT INTO users (id, college_id, email, full_name, password_hash) VALUES
        ('usr_clean', 'CLEAN01', 'clean@college.edu', 'Clean User', 'hash')
        ON CONFLICT (id) DO NOTHING;`);

      await db.query(`INSERT INTO user_roles (id, user_id, role_id, scope_type) VALUES
        ('ur_clean_1', 'usr_clean', 'role_chief_warden', 'SYSTEM')
        ON CONFLICT (id) DO NOTHING;`);

      const token = fastifyApp.jwt.sign({ sub: 'usr_clean' });

      const response = await fastifyApp.inject({
        method: 'GET',
        url: '/api/auth/me',
        headers: {
          authorization: `Bearer ${token}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.role).toBe('CHIEF_WARDEN');
      expect(body.scopeType).toBe('SYSTEM');
    });
  });
});
