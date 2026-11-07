import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { buildApp } from '../src/app.js';
import { getDatabaseService, resetDatabaseInstance, DatabaseService } from '../src/db/index.js';
import { AuthService } from '../src/auth/service.js';

describe('DORMEX Presentation Gate Integration & Lifecycle Suite', () => {
  let db: DatabaseService;
  let authService: AuthService;
  let app: any;

  const validPassword = 'ExecutivePresentation2026!';
  let validHash: string;

  beforeEach(async () => {
    resetDatabaseInstance();
    process.env.NODE_ENV = 'development';
    process.env.DORMEX_APP_ENV = 'staging';
    process.env.PRESENTATION_ACCESS_ENABLED = 'true';
    process.env.JWT_SECRET = 'jwt-secret-for-integration-tests-32chars';
    process.env.PRESENTATION_ACCESS_TOKEN_SECRET = 'presentation-secret-key-for-tests-32chars';

    db = getDatabaseService(true);
    authService = new AuthService(db);
    validHash = authService.hashPassword(validPassword);
    process.env.PRESENTATION_ACCESS_PASSWORD_HASH = validHash;

    app = await buildApp(db);
    await app.ready();
  });

  afterEach(async () => {
    if (app) {
      await app.close();
    }
    await db.close();
    resetDatabaseInstance();
    delete process.env.DORMEX_APP_ENV;
    delete process.env.PRESENTATION_ACCESS_ENABLED;
    delete process.env.PRESENTATION_ACCESS_PASSWORD_HASH;
    delete process.env.PRESENTATION_ACCESS_TOKEN_SECRET;
  });

  it('1. Correct password issues a cryptographically signed HttpOnly, SameSite cookie', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/presentation/verify',
      payload: { password: validPassword },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);

    const cookie = res.cookies.find((c: any) => c.name === 'dormex_presentation_token');
    expect(cookie).toBeDefined();
    expect(cookie.httpOnly).toBe(true);
    expect(cookie.sameSite.toLowerCase()).toBe('lax');
    expect(cookie.path).toBe('/');
    expect(cookie.maxAge).toBe(12 * 60 * 60);

    // Verify token payload
    const decoded = await app.jwt.verify(cookie.value);
    expect(decoded.type).toBe('PRESENTATION_ACCESS_GRANTED');
  });

  it('2. Incorrect password rejects with 401 and does not issue cookie', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/presentation/verify',
      payload: { password: 'WrongPassword123' },
    });

    expect(res.statusCode).toBe(401);
    expect(res.json().error).toContain('INVALID_CREDENTIALS');
    const cookie = res.cookies.find((c: any) => c.name === 'dormex_presentation_token');
    expect(cookie).toBeUndefined();
  });

  it('3. Cookie persistence allows consecutive API requests and survives session checks', async () => {
    // Authenticate through presentation gate
    const verifyRes = await app.inject({
      method: 'POST',
      url: '/api/presentation/verify',
      payload: { password: validPassword },
    });
    const presentationCookie = verifyRes.cookies.find((c: any) => c.name === 'dormex_presentation_token')!;
    const cookieHeader = `${presentationCookie.name}=${presentationCookie.value}`;

    // Verify status endpoint acknowledges active access
    const statusRes = await app.inject({
      method: 'GET',
      url: '/api/presentation/status',
      headers: { cookie: cookieHeader },
    });
    expect(statusRes.statusCode).toBe(200);
    expect(statusRes.json()).toEqual({ gateEnabled: true, hasAccess: true });

    // Request protected institutional auth endpoint
    const meRes = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { cookie: cookieHeader },
    });
    // Request succeeds presentation check and reaches auth layer (401 because user is not yet logged in)
    expect(meRes.statusCode).toBe(401);
    expect(meRes.json().error).not.toContain('PRESENTATION_ACCESS_REQUIRED');
  });

  it('4. Expired or forged presentation cookies are rejected and require reauthentication', async () => {
    const forgedHeader = 'dormex_presentation_token=forged.invalid.token';

    const statusRes = await app.inject({
      method: 'GET',
      url: '/api/presentation/status',
      headers: { cookie: forgedHeader },
    });
    expect(statusRes.statusCode).toBe(200);
    expect(statusRes.json()).toEqual({ gateEnabled: true, hasAccess: false });

    const protectedRes = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { cookie: forgedHeader },
    });
    expect(protectedRes.statusCode).toBe(401);
    expect(protectedRes.json().error).toContain('PRESENTATION_ACCESS_REQUIRED');
  });

  it('5. Unauthenticated direct requests to protected endpoints remain rejected', async () => {
    const protectedRoutes = ['/api/auth/me', '/api/auth/login', '/api/student/profile'];
    for (const route of protectedRoutes) {
      const res = await app.inject({
        method: 'GET',
        url: route,
      });
      expect(res.statusCode).toBe(401);
      expect(res.json().error).toContain('PRESENTATION_ACCESS_REQUIRED');
    }
  });

  it('6. Normal DORMEX student and staff login functions seamlessly after presentation access', async () => {
    // 1. Presentation unlock
    const verifyRes = await app.inject({
      method: 'POST',
      url: '/api/presentation/verify',
      payload: { password: validPassword },
    });
    const presentationCookie = verifyRes.cookies.find((c: any) => c.name === 'dormex_presentation_token')!;

    // 2. Institutional Login with presentation cookie
    const loginRes = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { cookie: `${presentationCookie.name}=${presentationCookie.value}` },
      payload: { identifier: 'DEMO-001', password: 'password1' },
    });

    expect(loginRes.statusCode).toBe(200);
    const loginBody = loginRes.json();
    expect(loginBody.session.collegeId).toBe('DEMO-001');
    expect(loginBody.session.role).toBe('STUDENT');

    // 3. User session cookie issued
    const sessionCookie = loginRes.cookies.find((c: any) => c.name === 'token')!;
    expect(sessionCookie).toBeDefined();

    // 4. Subsequent authenticated API call with both cookies
    const combinedCookieHeader = `${presentationCookie.name}=${presentationCookie.value}; ${sessionCookie.name}=${sessionCookie.value}`;
    const meRes = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { cookie: combinedCookieHeader },
    });
    expect(meRes.statusCode).toBe(200);
    expect(meRes.json().collegeId).toBe('DEMO-001');
  });

  it('7. Rate limiting triggers after 5 failed attempts within 15 minutes', async () => {
    const ip = '203.0.113.195';

    for (let i = 0; i < 5; i++) {
      const failRes = await app.inject({
        method: 'POST',
        url: '/api/presentation/verify',
        remoteAddress: ip,
        payload: { password: 'bad-password' },
      });
      expect(failRes.statusCode).toBe(401);
    }

    // 6th attempt is throttled
    const throttledRes = await app.inject({
      method: 'POST',
      url: '/api/presentation/verify',
      remoteAddress: ip,
      payload: { password: validPassword },
    });
    expect(throttledRes.statusCode).toBe(429);
    expect(throttledRes.json().error).toContain('RATE_LIMITED');
  });
});
