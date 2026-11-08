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

    it('rejects cross-origin state-changing mutations authenticated via cookies without Bearer token (CSRF defense)', async () => {
      process.env.NODE_ENV = 'production';
      process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/dormex';
      process.env.JWT_SECRET = 'a'.repeat(32);
      process.env.COOKIE_SECRET = 'b'.repeat(32);
      process.env.CORS_ALLOWED_ORIGINS = 'https://dormex-sit.vercel.app';
      resetServerConfig();

      const db = getDatabaseService(true);
      const app = await buildApp(db);

      // Generate a valid signed JWT for testing
      const testToken = app.jwt.sign({ sub: 'usr_test_student', role: 'STUDENT' });

      // 1. Attack Scenario A: Form-compatible POST from malicious origin carrying cookie
      const resMalicious = await app.inject({
        method: 'POST',
        url: '/api/room-change-requests',
        headers: {
          origin: 'https://evil-attacker-site.com',
          cookie: `token=${testToken}`,
          'content-type': 'application/json',
        },
        payload: { targetRoomId: 'rm_202', reason: 'Malicious transfer' },
      });
      expect(resMalicious.statusCode).toBe(500);
      expect(resMalicious.body).toContain('CORS_POLICY_VIOLATION');

      // 2. Attack Scenario B: Sibling subdomain or untrusted origin missing from approved list
      const resSibling = await app.inject({
        method: 'POST',
        url: '/api/room-change-requests',
        headers: {
          origin: 'https://attacker.vercel.app',
          cookie: `token=${testToken}`,
          'content-type': 'application/json',
        },
        payload: { targetRoomId: 'rm_202', reason: 'Subdomain spoofing' },
      });
      expect(resSibling.statusCode).toBe(500);
      expect(resSibling.body).toContain('CORS_POLICY_VIOLATION');

      // 3. Attack Scenario C: Direct browser navigation / missing origin header on cookie mutation
      const resNoOrigin = await app.inject({
        method: 'POST',
        url: '/api/room-change-requests',
        headers: {
          cookie: `token=${testToken}`,
          'content-type': 'application/json',
        },
        payload: { targetRoomId: 'rm_202', reason: 'No origin' },
      });
      expect(resNoOrigin.statusCode).toBe(403);
      expect(resNoOrigin.body).toContain('CSRF_PROTECTION_VIOLATION');

      // 4. Legitimate Scenario D: Approved frontend origin carrying cookie
      const resApprovedOrigin = await app.inject({
        method: 'POST',
        url: '/api/room-change-requests',
        headers: {
          origin: 'https://dormex-sit.vercel.app',
          cookie: `token=${testToken}`,
          'content-type': 'application/json',
        },
        payload: { targetRoomId: 'rm_202', reason: 'Legitimate change request' },
      });
      // Origin passes CSRF validation (reaches business logic: 400 because student has no confirmed allocation to move from)
      expect(resApprovedOrigin.statusCode).toBe(400);
      expect(resApprovedOrigin.body).not.toContain('CSRF_PROTECTION_VIOLATION');

      // 5. Legitimate Scenario E: Non-browser machine-to-machine API client using Bearer token
      const resBearer = await app.inject({
        method: 'POST',
        url: '/api/room-change-requests',
        headers: {
          authorization: `Bearer ${testToken}`,
          'content-type': 'application/json',
        },
        payload: { targetRoomId: 'rm_202', reason: 'Bearer token call' },
      });
      // Passes CSRF validation (Bearer tokens are immune to ambient browser credential transmission)
      expect(resBearer.statusCode).toBe(400);
      expect(resBearer.body).not.toContain('CSRF_PROTECTION_VIOLATION');

      await app.close();
    });
  });
});
