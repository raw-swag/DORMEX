import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { loadServerConfig, getSafeConfigDiagnostics, resetServerConfig, DEFAULT_ALLOWED_ORIGINS, PRODUCTION_DEFAULT_ALLOWED_ORIGINS } from '../src/config/index.js';
import { DeviceAuthService } from '../src/auth/deviceAuthService.js';
import { buildApp } from '../src/app.js';
import { getDatabaseService, resetDatabaseInstance } from '../src/db/index.js';

describe('DORMEX Environment Configuration & Secret Management Security Suite', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    resetServerConfig();
    resetDatabaseInstance();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    resetServerConfig();
    resetDatabaseInstance();
    process.env = { ...originalEnv };
    vi.unstubAllGlobals();
  });

  describe('1. Environment Validation & Production Fail-Fast', () => {
    it('rejects invalid or unknown NODE_ENV values', () => {
      expect(() => {
        loadServerConfig({ NODE_ENV: 'invalid_env' });
      }).toThrow(/FATAL_CONFIG_ERROR: Invalid NODE_ENV/);
    });

    it('rejects invalid PORT numbers outside 1..65535', () => {
      expect(() => {
        loadServerConfig({ NODE_ENV: 'development', PORT: '999999' });
      }).toThrow(/FATAL_CONFIG_ERROR: Invalid PORT/);

      expect(() => {
        loadServerConfig({ NODE_ENV: 'development', PORT: 'not-a-number' });
      }).toThrow(/FATAL_CONFIG_ERROR: Invalid PORT/);
    });

    it('rejects production startup without DATABASE_URL', () => {
      expect(() => {
        loadServerConfig({
          NODE_ENV: 'production',
          JWT_SECRET: 'a'.repeat(32),
        });
      }).toThrow(/FATAL_DATABASE_CONFIG: Production requires an externally supplied DATABASE_URL/);
    });

    it('rejects production startup when JWT_SECRET is missing or under 32 characters', () => {
      expect(() => {
        loadServerConfig({
          NODE_ENV: 'production',
          DATABASE_URL: 'postgresql://postgres@localhost:5432/dormex',
          JWT_SECRET: '',
        });
      }).toThrow(/FATAL_CONFIG_ERROR: Production requires an externally supplied JWT_SECRET with at least 32 characters/);

      expect(() => {
        loadServerConfig({
          NODE_ENV: 'production',
          DATABASE_URL: 'postgresql://postgres@localhost:5432/dormex',
          JWT_SECRET: 'short-secret-under-32-chars',
        });
      }).toThrow(/FATAL_CONFIG_ERROR: Production requires an externally supplied JWT_SECRET with at least 32 characters/);
    });

    it('rejects production startup when COOKIE_SECRET is missing or under 32 characters', () => {
      expect(() => {
        loadServerConfig({
          NODE_ENV: 'production',
          DATABASE_URL: 'postgresql://postgres@localhost:5432/dormex',
          JWT_SECRET: 'a'.repeat(32),
          COOKIE_SECRET: '',
        });
      }).toThrow(/FATAL_CONFIG_ERROR: Production requires an externally supplied COOKIE_SECRET with at least 32 characters/);

      expect(() => {
        loadServerConfig({
          NODE_ENV: 'production',
          DATABASE_URL: 'postgresql://postgres@localhost:5432/dormex',
          JWT_SECRET: 'a'.repeat(32),
          COOKIE_SECRET: 'short-cookie-secret',
        });
      }).toThrow(/FATAL_CONFIG_ERROR: Production requires an externally supplied COOKIE_SECRET with at least 32 characters/);
    });

    it('accepts valid production configuration and defaults host to 0.0.0.0 for Render', () => {
      const cfg = loadServerConfig({
        NODE_ENV: 'production',
        DATABASE_URL: 'postgresql://user:pass@dpg-abc-a.oregon-postgres.render.com/dormex_db',
        JWT_SECRET: 'a'.repeat(32),
        COOKIE_SECRET: 'b'.repeat(32),
      });

      expect(cfg.isProduction).toBe(true);
      expect(cfg.host).toBe('0.0.0.0');
      expect(cfg.port).toBe(3000);
      expect(cfg.database.isSsl).toBe(true);
    });

    it('strictly isolates production CORS and RP IDs from development localhost origins', () => {
      const prodCfg = loadServerConfig({
        NODE_ENV: 'production',
        DATABASE_URL: 'postgresql://user:pass@dpg-abc-a.oregon-postgres.render.com/dormex_db',
        JWT_SECRET: 'a'.repeat(32),
        COOKIE_SECRET: 'b'.repeat(32),
      });

      expect(prodCfg.corsAllowedOrigins).not.toContain('http://localhost:5173');
      expect(prodCfg.corsAllowedOrigins).not.toContain('http://localhost:3000');
      expect(prodCfg.corsAllowedOrigins).toContain('https://dormex-sit.vercel.app');

      const devCfg = loadServerConfig({
        NODE_ENV: 'development',
      });
      expect(devCfg.corsAllowedOrigins).toContain('http://localhost:5173');
    });

    it('verifies fail-closed TLS behavior for internal, external, and adversarial host variations', () => {
      const baseEnv = {
        NODE_ENV: 'production',
        JWT_SECRET: 'a'.repeat(32),
        COOKIE_SECRET: 'b'.repeat(32),
      };

      // 1. Legitimate configured Render internal database endpoint (dpg-dbnjeqrl550s73fcr1lg-a)
      const internalCfg1 = loadServerConfig({
        ...baseEnv,
        DATABASE_URL: 'postgresql://user:pass@dpg-dbnjeqrl550s73fcr1lg-a/dormex_db',
      });
      expect(internalCfg1.database.isRenderInternal).toBe(true);
      expect(internalCfg1.database.rejectUnauthorized).toBe(false);

      // 2. Legitimate configured Render internal endpoint with .internal suffix
      const internalCfg2 = loadServerConfig({
        ...baseEnv,
        DATABASE_URL: 'postgresql://user:pass@dpg-dbnjeqrl550s73fcr1lg-a.internal/dormex_db',
      });
      expect(internalCfg2.database.isRenderInternal).toBe(true);
      expect(internalCfg2.database.rejectUnauthorized).toBe(false);

      // 3. Legitimate external Render endpoint (*.render.com -> MUST strictly verify CA)
      const externalCfg = loadServerConfig({
        ...baseEnv,
        DATABASE_URL: 'postgresql://user:pass@dpg-dbnjeqrl550s73fcr1lg-a.oregon-postgres.render.com/dormex_db',
      });
      expect(externalCfg.database.isRenderInternal).toBe(false);
      expect(externalCfg.database.rejectUnauthorized).toBe(true);

      // 4. Adversarial lookalike: dpg-attacker (MUST NOT receive internal exemption)
      const attackerLookalike1 = loadServerConfig({
        ...baseEnv,
        DATABASE_URL: 'postgresql://user:pass@dpg-attacker/dormex_db',
      });
      expect(attackerLookalike1.database.isRenderInternal).toBe(false);
      expect(attackerLookalike1.database.rejectUnauthorized).toBe(true);

      // 5. Adversarial lookalike: dpg-malicious.internal (MUST NOT receive internal exemption)
      const attackerLookalike2 = loadServerConfig({
        ...baseEnv,
        DATABASE_URL: 'postgresql://user:pass@dpg-malicious.internal/dormex_db',
      });
      expect(attackerLookalike2.database.isRenderInternal).toBe(false);
      expect(attackerLookalike2.database.rejectUnauthorized).toBe(true);

      // 6. Adversarial subdomain: dpg-attacker.example.com
      const subdomCfg = loadServerConfig({
        ...baseEnv,
        DATABASE_URL: 'postgresql://user:pass@dpg-attacker.example.com/dormex_db',
      });
      expect(subdomCfg.database.isRenderInternal).toBe(false);
      expect(subdomCfg.database.rejectUnauthorized).toBe(true);

      // 7. Adversarial domain: dpg-attacker.com
      const domainCfg = loadServerConfig({
        ...baseEnv,
        DATABASE_URL: 'postgresql://user:pass@dpg-attacker.com/dormex_db',
      });
      expect(domainCfg.database.isRenderInternal).toBe(false);
      expect(domainCfg.database.rejectUnauthorized).toBe(true);

      // 8. Adversarial path: attacker.com/dpg-db
      const pathCfg = loadServerConfig({
        ...baseEnv,
        DATABASE_URL: 'postgresql://user:pass@attacker.com/dpg-db',
      });
      expect(pathCfg.database.isRenderInternal).toBe(false);
      expect(pathCfg.database.rejectUnauthorized).toBe(true);

      // 9. Adversarial query: attacker.com?host=dpg-db
      const queryCfg = loadServerConfig({
        ...baseEnv,
        DATABASE_URL: 'postgresql://user:pass@attacker.com/db?host=dpg-db',
      });
      expect(queryCfg.database.isRenderInternal).toBe(false);
      expect(queryCfg.database.rejectUnauthorized).toBe(true);

      // 10. Ordinary third-party PostgreSQL hostname (e.g., aws, supabase, neon)
      const thirdPartyCfg = loadServerConfig({
        ...baseEnv,
        DATABASE_URL: 'postgresql://user:pass@db.my-university.edu:5432/dormex_db',
      });
      expect(thirdPartyCfg.database.isRenderInternal).toBe(false);
      expect(thirdPartyCfg.database.rejectUnauthorized).toBe(true);

      // 11. Legitimate configured internal endpoint with uppercase or trailing-dot variation
      const trailingDotCfg = loadServerConfig({
        ...baseEnv,
        DATABASE_URL: 'postgresql://user:pass@DPG-DBNJEQRL550S73FCR1LG-A./dormex_db',
      });
      expect(trailingDotCfg.database.isRenderInternal).toBe(true);
      expect(trailingDotCfg.database.rejectUnauthorized).toBe(false);

      // 12. Malformed unparseable URL -> fails closed (never gets internal exemption)
      const malformedCfg = loadServerConfig({
        ...baseEnv,
        DATABASE_URL: 'not-a-valid-url-with-dpg-internal',
      });
      expect(malformedCfg.database.isRenderInternal).toBe(false);

      // 13. Dynamic explicit override via RENDER_INTERNAL_DB_HOST
      const customInternalCfg = loadServerConfig({
        ...baseEnv,
        RENDER_INTERNAL_DB_HOST: 'dpg-custom-staging-db-01',
        DATABASE_URL: 'postgresql://user:pass@dpg-custom-staging-db-01/dormex_db',
      });
      expect(customInternalCfg.database.isRenderInternal).toBe(true);
      expect(customInternalCfg.database.rejectUnauthorized).toBe(false);
    });

    it('defaults local development host to 127.0.0.1', () => {
      const cfg = loadServerConfig({
        NODE_ENV: 'development',
      });
      expect(cfg.isProduction).toBe(false);
      expect(cfg.host).toBe('127.0.0.1');
    });

    it('automatically detects Render environment (RENDER=true) to bind 0.0.0.0 and require production secrets', () => {
      // Render automatically supplies RENDER=true and PORT
      expect(() => {
        loadServerConfig({
          RENDER: 'true',
          PORT: '10000',
        });
      }).toThrow(/FATAL_DATABASE_CONFIG: Production requires an externally supplied DATABASE_URL/);

      const renderCfg = loadServerConfig({
        RENDER: 'true',
        PORT: '10000',
        DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
        JWT_SECRET: 'a'.repeat(32),
        COOKIE_SECRET: 'b'.repeat(32),
      });
      expect(renderCfg.isProduction).toBe(true);
      expect(renderCfg.env).toBe('production');
      expect(renderCfg.host).toBe('0.0.0.0');
      expect(renderCfg.port).toBe(10000);
    });
  });

  describe('2. Secret Redaction & Safe Diagnostics', () => {
    it('getSafeConfigDiagnostics never leaks database passwords, URLs, or JWT secrets', () => {
      const sensitivePassword = 'super-secret-password-xyz123';
      const sensitiveSecret = 'cryptographic-signing-key-very-secret-32-chars';
      const cfg = loadServerConfig({
        NODE_ENV: 'production',
        DATABASE_URL: `postgresql://user:${sensitivePassword}@dpg-db-a.render.com/dormex_db`,
        JWT_SECRET: sensitiveSecret,
        COOKIE_SECRET: sensitiveSecret,
      });

      const diag = getSafeConfigDiagnostics(cfg);
      const jsonStr = JSON.stringify(diag);

      expect(jsonStr).not.toContain(sensitivePassword);
      expect(jsonStr).not.toContain(sensitiveSecret);
      expect(jsonStr).not.toContain('postgresql://');
      expect(diag.databaseConfigured).toBe(true);
      expect(diag.jwtConfigured).toBe(true);
    });

    it('error messages for missing production config do not leak surrounding environment variables', () => {
      try {
        loadServerConfig({
          NODE_ENV: 'production',
          SUPER_SECRET_TOKEN: 'should-never-be-printed',
        });
        expect.fail('Should have thrown');
      } catch (err: any) {
        expect(err.message).not.toContain('should-never-be-printed');
      }
    });
  });

  describe('3. Dynamic CORS & WebAuthn RP Configuration', () => {
    it('merges custom CORS_ALLOWED_ORIGINS with canonical defaults', () => {
      const customOrigin = 'https://custom-portal.college.edu';
      const cfg = loadServerConfig({
        NODE_ENV: 'production',
        DATABASE_URL: 'postgresql://user@localhost/db',
        JWT_SECRET: 'a'.repeat(32),
        COOKIE_SECRET: 'b'.repeat(32),
        CORS_ALLOWED_ORIGINS: customOrigin,
      });

      expect(cfg.corsAllowedOrigins).toContain(customOrigin);
      for (const def of PRODUCTION_DEFAULT_ALLOWED_ORIGINS) {
        expect(cfg.corsAllowedOrigins).toContain(def);
      }
    });

    it('DeviceAuthService dynamically incorporates configured WebAuthn RP IDs and Origins', () => {
      process.env.WEBAUTHN_RP_IDS = 'custom.campus.edu,portal.dormex.edu';
      process.env.CORS_ALLOWED_ORIGINS = 'https://custom.campus.edu';

      const rpIds = DeviceAuthService.getApprovedRpIds();
      expect(rpIds).toContain('custom.campus.edu');
      expect(rpIds).toContain('portal.dormex.edu');
      expect(rpIds).toContain('dormex-sit.vercel.app');

      const origins = DeviceAuthService.getApprovedOrigins();
      expect(origins).toContain('https://custom.campus.edu');
      expect(origins).toContain('https://dormex-sit.vercel.app');
    });
  });

  describe('4. In-Memory and Testing Safety Enforcements', () => {
    it('strictly forbids synthetic demo student seeding in production even if SEED_DEMO_DATA=true', () => {
      const cfg = loadServerConfig({
        NODE_ENV: 'production',
        DATABASE_URL: 'postgresql://user@localhost/db',
        JWT_SECRET: 'a'.repeat(32),
        COOKIE_SECRET: 'b'.repeat(32),
        SEED_DEMO_DATA: 'true',
      });

      expect(cfg.demo.allowDemoSeed).toBe(false);
    });

    it('permits demo data seeding in development when SEED_DEMO_DATA=true', () => {
      const cfg = loadServerConfig({
        NODE_ENV: 'development',
        SEED_DEMO_DATA: 'true',
      });

      expect(cfg.demo.allowDemoSeed).toBe(true);
    });
  });

  describe('5. Application CORS Policy Enforcement in App', () => {
    it('rejects unapproved cross-origin requests in production while permitting approved origins', async () => {
      process.env.NODE_ENV = 'production';
      process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/dormex';
      process.env.JWT_SECRET = 'a'.repeat(32);
      process.env.COOKIE_SECRET = 'b'.repeat(32);
      process.env.CORS_ALLOWED_ORIGINS = 'https://approved-partner.edu';
      resetServerConfig();

      process.env.INITIAL_ADMIN_HASH = 'test';
      const db = getDatabaseService(true);
      const app = await buildApp(db);

      // 1. Approved origin
      const resApproved = await app.inject({
        method: 'OPTIONS',
        url: '/health',
        headers: {
          origin: 'https://approved-partner.edu',
          'access-control-request-method': 'GET',
        },
      });
      expect(resApproved.statusCode).toBe(204);

      // 2. Unapproved origin
      const resDenied = await app.inject({
        method: 'GET',
        url: '/health',
        headers: {
          origin: 'https://malicious-site.com',
        },
      });
      expect(resDenied.statusCode).toBe(500);
      expect(resDenied.body).toContain('CORS_POLICY_VIOLATION');

      await app.close();
    });

    it('enforces strict CSRF defense across all 8 precedence and origin combination scenarios', async () => {
      process.env.NODE_ENV = 'production';
      process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/dormex';
      process.env.JWT_SECRET = 'a'.repeat(32);
      process.env.COOKIE_SECRET = 'b'.repeat(32);
      process.env.CORS_ALLOWED_ORIGINS = 'https://dormex-sit.vercel.app';
      resetServerConfig();

      process.env.INITIAL_ADMIN_HASH = 'test_hash';
      const db = getDatabaseService(true);
      const app = await buildApp(db);

      const validToken = app.jwt.sign({ sub: 'usr_admin', role: 'STUDENT' });
      const invalidToken = 'malformed.or.invalid.token';

      // 1. Scenario 1: Valid cookie + invalid Bearer token + malicious Origin
      // PreValidation CSRF hook rejects based on cookie presence; CORS rejects malicious Origin
      const res1 = await app.inject({
        method: 'POST',
        url: '/api/room-change-requests',
        headers: {
          origin: 'https://evil-attacker.com',
          authorization: `Bearer ${invalidToken}`,
          cookie: `token=${validToken}`,
          'content-type': 'application/json',
        },
        payload: { targetRoomId: 'rm_202', reason: 'Attack 1' },
      });
      expect(res1.statusCode).toBe(500);
      expect(res1.body).toContain('CORS_POLICY_VIOLATION');

      // 2. Scenario 2: Valid cookie + arbitrary Authorization header + malicious Origin
      const res2 = await app.inject({
        method: 'POST',
        url: '/api/room-change-requests',
        headers: {
          origin: 'https://evil-attacker.com',
          authorization: 'Basic dXNlcjpwYXNz',
          cookie: `token=${validToken}`,
          'content-type': 'application/json',
        },
        payload: { targetRoomId: 'rm_202', reason: 'Attack 2' },
      });
      expect(res2.statusCode).toBe(500);
      expect(res2.body).toContain('CORS_POLICY_VIOLATION');

      // 3. Scenario 3: Valid cookie + approved Origin
      // Passes CSRF and CORS; reaches business logic
      const res3 = await app.inject({
        method: 'POST',
        url: '/api/room-change-requests',
        headers: {
          origin: 'https://dormex-sit.vercel.app',
          cookie: `token=${validToken}`,
          'content-type': 'application/json',
        },
        payload: { targetRoomId: 'rm_202', reason: 'Legitimate mutation' },
      });
      expect(res3.statusCode).toBe(403); // 403 from domain: Insufficient permissions for non-student
      expect(res3.body).not.toContain('CSRF_PROTECTION_VIOLATION');
      expect(res3.body).not.toContain('CORS_POLICY_VIOLATION');

      // 4. Scenario 4: Valid Bearer token without cookies
      // Pure non-browser API client; passes CSRF
      const res4 = await app.inject({
        method: 'POST',
        url: '/api/room-change-requests',
        headers: {
          authorization: `Bearer ${validToken}`,
          'content-type': 'application/json',
        },
        payload: { targetRoomId: 'rm_202', reason: 'M2M request' },
      });
      expect(res4.statusCode).toBe(403); // Reaches domain logic (insufficient permissions for non-student)
      expect(res4.body).not.toContain('CSRF_PROTECTION_VIOLATION');

      // 5. Scenario 5: Invalid Bearer token without cookies
      // Fails fast at extractActor with 401
      const res5 = await app.inject({
        method: 'POST',
        url: '/api/room-change-requests',
        headers: {
          authorization: `Bearer ${invalidToken}`,
          'content-type': 'application/json',
        },
        payload: { targetRoomId: 'rm_202', reason: 'Bad token' },
      });
      expect(res5.statusCode).toBe(401);
      expect(res5.body).toContain('UNAUTHORIZED');

      // 6. Scenario 6: Valid cookie + missing Origin and Referer
      // Blocked by preValidation CSRF hook
      const res6 = await app.inject({
        method: 'POST',
        url: '/api/room-change-requests',
        headers: {
          cookie: `token=${validToken}`,
          'content-type': 'application/json',
        },
        payload: { targetRoomId: 'rm_202', reason: 'No origin header' },
      });
      expect(res6.statusCode).toBe(403);
      expect(res6.body).toContain('CSRF_PROTECTION_VIOLATION: Missing origin or referer header');

      // 7. Scenario 7: Valid cookie + malformed Origin
      // Blocked by preValidation CSRF hook
      const res7 = await app.inject({
        method: 'POST',
        url: '/api/room-change-requests',
        headers: {
          origin: ':::not-a-valid-url:::',
          cookie: `token=${validToken}`,
          'content-type': 'application/json',
        },
        payload: { targetRoomId: 'rm_202', reason: 'Malformed origin' },
      });
      expect(res7.statusCode).toBe(500);
      expect(res7.body).toContain('CORS_POLICY_VIOLATION');

      // 8. Scenario 8: Existing public authentication flows (Login) exempt from CSRF
      const res8 = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        headers: {
          origin: 'https://dormex-sit.vercel.app',
          'content-type': 'application/json',
        },
        payload: { identifier: 'ADM001', password: 'wrong-password' },
      });
      // Permitted to reach login endpoint (fails at invalid password rather than CSRF)
      expect(res8.statusCode).toBe(401);
      expect(res8.body).toContain('Invalid credentials');

      // Bonus Precedence Check: Invalid Bearer token MUST fail immediately even if valid cookie is present
      const resPrecedence = await app.inject({
        method: 'POST',
        url: '/api/room-change-requests',
        headers: {
          origin: 'https://dormex-sit.vercel.app',
          authorization: `Bearer ${invalidToken}`,
          cookie: `token=${validToken}`,
          'content-type': 'application/json',
        },
        payload: { targetRoomId: 'rm_202', reason: 'Precedence test' },
      });
      expect(resPrecedence.statusCode).toBe(401);
      expect(resPrecedence.body).toContain('UNAUTHORIZED');

      await app.close();
    });
  });
});
