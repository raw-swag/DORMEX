import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { buildApp } from '../src/app.js';
import { getDatabaseService, resetDatabaseInstance, DatabaseService } from '../src/db/index.js';
import { AuthService } from '../src/auth/service.js';

describe('DORMEX Staging Presentation Access Protection Suite', () => {
  let db: DatabaseService;
  let authService: AuthService;
  let app: any;

  const validPassword = 'PrincipalPresentation2026!';
  let validHash: string;

  beforeEach(async () => {
    resetDatabaseInstance();
    process.env.NODE_ENV = 'development'; // allow presentation gate testing
    process.env.DORMEX_APP_ENV = 'staging';
    process.env.PRESENTATION_ACCESS_ENABLED = 'true';
    process.env.JWT_SECRET = 'super-secret-jwt-signing-key-for-test-suite-32chars';
    process.env.PRESENTATION_ACCESS_TOKEN_SECRET = 'presentation-secret-key-for-tests-32chars';

    db = getDatabaseService(true);
    authService = new AuthService(db);
    validHash = authService.hashPassword(validPassword);
    process.env.PRESENTATION_ACCESS_PASSWORD_HASH = validHash;
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

  it('keeps /health and /readyz accessible without presentation cookie', async () => {
    app = await buildApp(db);
    await app.ready();

    const healthRes = await app.inject({ method: 'GET', url: '/health' });
    expect(healthRes.statusCode).toBe(200);
    expect(healthRes.json().status).toBe('UP');

    const readyRes = await app.inject({ method: 'GET', url: '/readyz' });
    expect(readyRes.statusCode).toBe(200);
    expect(readyRes.json().status).toBe('READY');
  });

  it('rejects direct API access (including /api/auth/login) without presentation access cookie', async () => {
    app = await buildApp(db);
    await app.ready();

    const directLogin = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { identifier: 'DEMO-001', password: 'password1' },
    });
    expect(directLogin.statusCode).toBe(401);
    expect(directLogin.json().error).toContain('PRESENTATION_ACCESS_REQUIRED');
  });

  it('fails closed with HTTP 500 if presentation access is enabled but hash or secret is missing', async () => {
    delete process.env.PRESENTATION_ACCESS_PASSWORD_HASH;
    app = await buildApp(db);
    await app.ready();

    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { identifier: 'DEMO-001', password: 'password1' },
    });
    expect(res.statusCode).toBe(500);
    expect(res.json().error).toContain('CONFIGURATION_ERROR');
  });

  it('authenticates correct presentation password, issues HttpOnly cookie, and rejects incorrect password', async () => {
    app = await buildApp(db);
    await app.ready();

    // 1. Incorrect password rejected
    const badAttempt = await app.inject({
      method: 'POST',
      url: '/api/presentation/verify',
      payload: { password: 'wrong-password' },
    });
    expect(badAttempt.statusCode).toBe(401);
    expect(badAttempt.json().error).toContain('INVALID_CREDENTIALS');

    // 2. Correct password accepted
    const goodAttempt = await app.inject({
      method: 'POST',
      url: '/api/presentation/verify',
      payload: { password: validPassword },
    });
    expect(goodAttempt.statusCode).toBe(200);
    expect(goodAttempt.json().success).toBe(true);

    const cookieHeader = goodAttempt.cookies.find((c: any) => c.name === 'dormex_presentation_token');
    expect(cookieHeader).toBeDefined();
    expect(cookieHeader.httpOnly).toBe(true);
    expect(cookieHeader.sameSite).toBe('Lax');
  });

  it('allows normal DORMEX authentication and API access once presentation cookie is present', async () => {
    app = await buildApp(db);
    await app.ready();

    // Verify presentation access
    const verifyRes = await app.inject({
      method: 'POST',
      url: '/api/presentation/verify',
      payload: { password: validPassword },
    });
    expect(verifyRes.statusCode).toBe(200);

    const presentationCookie = verifyRes.cookies.find((c: any) => c.name === 'dormex_presentation_token')!;
    const cookieHeader = `${presentationCookie.name}=${presentationCookie.value}`;

    // Normal login now proceeds past the gate
    const loginRes = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { cookie: cookieHeader },
      payload: { identifier: 'DEMO-001', password: 'password1' },
    });
    expect(loginRes.statusCode).toBe(200);
    expect(loginRes.json().session.collegeId).toBe('DEMO-001');
  });

  it('rejects forged or expired presentation cookies', async () => {
    app = await buildApp(db);
    await app.ready();

    const forgedCookie = 'dormex_presentation_token=forged.invalid.signature';
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { cookie: forgedCookie },
      payload: { identifier: 'DEMO-001', password: 'password1' },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toContain('PRESENTATION_ACCESS_REQUIRED');
  });

  it('enforces rate limiting on presentation verification endpoint', async () => {
    app = await buildApp(db);
    await app.ready();

    // Fire 5 failed attempts
    for (let i = 0; i < 5; i++) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/presentation/verify',
        remoteAddress: '198.51.100.42',
        payload: { password: 'bad-password' },
      });
      expect(res.statusCode).toBe(401);
    }

    // 6th attempt must trigger rate limit (HTTP 429)
    const rateLimitedRes = await app.inject({
      method: 'POST',
      url: '/api/presentation/verify',
      remoteAddress: '198.51.100.42',
      payload: { password: validPassword },
    });
    expect(rateLimitedRes.statusCode).toBe(429);
    expect(rateLimitedRes.json().error).toContain('RATE_LIMITED');
  });
});
