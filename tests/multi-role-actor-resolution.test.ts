import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DatabaseService, getDatabaseService, resetDatabaseInstance } from '../src/db/index.js';
import { runMigrations } from '../src/db/schema.js';
import { buildApp } from '../src/app.js';
import { resolveAuthoritativeActor, ROLE_HIERARCHY_RANK } from '../src/auth/policy.js';

describe('Multi-Role Deterministic Actor Resolution Suite', () => {
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

  it('verifies unit behavior of resolveAuthoritativeActor with precedence order', () => {
    // 1. Super Admin beats Chief Warden and Student
    const multi1 = [
      { id: 'usr_1', college_id: 'MULTI01', full_name: 'Multi User', role_name: 'STUDENT', scope_type: 'STUDENT' },
      { id: 'usr_1', college_id: 'MULTI01', full_name: 'Multi User', role_name: 'SUPER_ADMIN', scope_type: 'SYSTEM' },
      { id: 'usr_1', college_id: 'MULTI01', full_name: 'Multi User', role_name: 'CHIEF_WARDEN', scope_type: 'SYSTEM' },
    ];
    const res1 = resolveAuthoritativeActor(multi1);
    expect(res1.role).toBe('SUPER_ADMIN');

    // 2. Chief Warden beats Warden and Proctor
    const multi2 = [
      { id: 'usr_2', college_id: 'MULTI02', full_name: 'Staff User', role_name: 'PROCTOR', scope_type: 'SYSTEM' },
      { id: 'usr_2', college_id: 'MULTI02', full_name: 'Staff User', role_name: 'WARDEN', scope_type: 'BUILDING', scope_id: 'BLD_A' },
      { id: 'usr_2', college_id: 'MULTI02', full_name: 'Staff User', role_name: 'CHIEF_WARDEN', scope_type: 'SYSTEM' },
    ];
    const res2 = resolveAuthoritativeActor(multi2);
    expect(res2.role).toBe('CHIEF_WARDEN');

    // 3. Same role with different scopes: SYSTEM beats BUILDING
    const multi3 = [
      { id: 'usr_3', college_id: 'MULTI03', full_name: 'Warden User', role_name: 'WARDEN', scope_type: 'BUILDING', scope_id: 'BLD_A' },
      { id: 'usr_3', college_id: 'MULTI03', full_name: 'Warden User', role_name: 'WARDEN', scope_type: 'SYSTEM' },
    ];
    const res3 = resolveAuthoritativeActor(multi3);
    expect(res3.role).toBe('WARDEN');
    expect(res3.scope_type).toBe('SYSTEM');
  });

  it('resolves deterministic actor in end-to-end Fastify extractActor hook for multi-role user', async () => {
    // Insert a multi-role user into DB: assigned both STUDENT and CHIEF_WARDEN
    await db.query(`INSERT INTO users (id, college_id, email, full_name, password_hash) VALUES
      ('usr_multi_test', 'MULTI-999', 'multirole@college.edu', 'Multi Role Student-Staff', 'hash')
      ON CONFLICT (id) DO NOTHING;`);

    await db.query(`INSERT INTO user_roles (id, user_id, role_id, scope_type) VALUES
      ('ur_m_1', 'usr_multi_test', 'role_student', 'STUDENT'),
      ('ur_m_2', 'usr_multi_test', 'role_chief_warden', 'SYSTEM')
      ON CONFLICT (id) DO NOTHING;`);

    // Sign a valid JWT for usr_multi_test
    const token = fastifyApp.jwt.sign({ sub: 'usr_multi_test' });

    const response = await fastifyApp.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: {
        authorization: `Bearer ${token}`,
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    // Deterministic precedence picks CHIEF_WARDEN over STUDENT
    expect(body.role).toBe('CHIEF_WARDEN');
    expect(body.scopeType).toBe('SYSTEM');
    expect(body.collegeId).toBe('MULTI-999');
  });

  it('rejects users with empty role records safely without server crash', async () => {
    await db.query(`INSERT INTO users (id, college_id, email, full_name, password_hash) VALUES
      ('usr_norole', 'NOROLE', 'norole@college.edu', 'No Role User', 'hash')
      ON CONFLICT (id) DO NOTHING;`);

    const token = fastifyApp.jwt.sign({ sub: 'usr_norole' });

    const response = await fastifyApp.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: {
        authorization: `Bearer ${token}`,
      },
    });

    expect(response.statusCode).toBe(401);
  });
});
