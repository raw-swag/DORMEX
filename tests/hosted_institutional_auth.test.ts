import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { getDatabaseService, resetDatabaseInstance } from '../src/db/index.js';

describe('DORMEX Hosted Institutional Sign In & Direct Access Suite', () => {
  let app: FastifyInstance;
  let db: any;
  const originalEnv = process.env.NODE_ENV;
  const originalAppEnv = process.env.DORMEX_APP_ENV;

  beforeAll(async () => {
    process.env.NODE_ENV = 'development';
    process.env.DORMEX_APP_ENV = 'staging';
    resetDatabaseInstance();
    db = getDatabaseService(true);
    app = await buildApp(db);
    await app.ready();
  });

  afterAll(async () => {
    process.env.NODE_ENV = originalEnv;
    process.env.DORMEX_APP_ENV = originalAppEnv;
    if (app) {
      await app.close();
    }
  });

  it('1. /health and /readyz probes respond cleanly without presentation headers or cookies', async () => {
    const healthRes = await app.inject({ method: 'GET', url: '/health' });
    expect(healthRes.statusCode).toBe(200);
    expect(healthRes.json().status).toBe('UP');

    const readyRes = await app.inject({ method: 'GET', url: '/readyz' });
    expect(readyRes.statusCode).toBe(200);
    expect(readyRes.json().status).toBe('READY');
  });

  it('2. Institutional Sign In opens directly: unauthenticated requests reach auth endpoints without presentation error', async () => {
    const meRes = await app.inject({ method: 'GET', url: '/api/auth/me' });
    expect(meRes.statusCode).toBe(401);
    const body = meRes.json();
    // Must return normal unauthenticated error, NEVER presentation error
    expect(body.error).not.toContain('PRESENTATION_ACCESS_REQUIRED');
    expect(body.error).toContain('UNAUTHORIZED');
  });

  it('3. Authenticates student demo account (DEMO-001 -> password1) and issues session cookie', async () => {
    const loginRes = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { identifier: 'DEMO-001', password: 'password1' },
    });

    expect(loginRes.statusCode).toBe(200);
    const body = loginRes.json();
    expect(body.success).toBe(true);
    expect(body.session.collegeId).toBe('DEMO-001');
    expect(body.session.role).toBe('STUDENT');

    const cookie = loginRes.cookies.find((c: any) => c.name === 'token');
    expect(cookie).toBeDefined();
    expect(cookie.httpOnly).toBe(true);
  });

  it('4. Authenticates administrative demo account (ADM001 -> admin123) with CHIEF_WARDEN role and SYSTEM scope', async () => {
    const loginRes = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { identifier: 'ADM001', password: 'admin123' },
    });

    expect(loginRes.statusCode).toBe(200);
    const body = loginRes.json();
    expect(body.session.collegeId).toBe('ADM001');
    expect(body.session.role).toBe('CHIEF_WARDEN');
    expect(body.session.scopeType).toBe('SYSTEM');
    expect(body.session.role).not.toBe('SUPER_ADMIN');
  });

  it('5. Authenticates hostel office demo account (OFF001 -> office123) with HOSTEL_OFFICE role and SYSTEM scope', async () => {
    const loginRes = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { identifier: 'OFF001', password: 'office123' },
    });

    expect(loginRes.statusCode).toBe(200);
    const body = loginRes.json();
    expect(body.session.collegeId).toBe('OFF001');
    expect(body.session.role).toBe('HOSTEL_OFFICE');
    expect(body.session.scopeType).toBe('SYSTEM');
  });

  it('6. Rejects invalid credentials gracefully with 401', async () => {
    const badLoginRes = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { identifier: 'DEMO-001', password: 'wrong-password-999' },
    });

    expect(badLoginRes.statusCode).toBe(401);
    expect(badLoginRes.json().error).toContain('UNAUTHORIZED');
  });

  it('7. Restores authenticated session via HttpOnly cookie at GET /api/auth/me', async () => {
    const loginRes = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { identifier: 'DEMO-002', password: 'password2' },
    });
    const cookie = loginRes.cookies.find((c: any) => c.name === 'token')!;

    const meRes = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { cookie: `token=${cookie.value}` },
    });

    expect(meRes.statusCode).toBe(200);
    expect(meRes.json().collegeId).toBe('DEMO-002');
  });
});
