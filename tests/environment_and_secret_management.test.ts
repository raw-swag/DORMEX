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

    it('verifies TLS behavior for internal vs external vs third-party database hosts', () => {
      // 1. Render internal host (hostname starts with dpg- and does not end with .render.com)
      const internalCfg = loadServerConfig({
        NODE_ENV: 'production',
        DATABASE_URL: 'postgresql://user:pass@dpg-dbnjeqrl550s73fcr1lg-a/dormex_db',
        JWT_SECRET: 'a'.repeat(32),
        COOKIE_SECRET: 'b'.repeat(32),
      });
      expect(internalCfg.database.isRenderInternal).toBe(true);
      expect(internalCfg.database.rejectUnauthorized).toBe(false);

      // 2. Render external host (ends with .render.com)
      const externalCfg = loadServerConfig({
        NODE_ENV: 'production',
        DATABASE_URL: 'postgresql://user:pass@dpg-dbnjeqrl550s73fcr1lg-a.oregon-postgres.render.com/dormex_db',
        JWT_SECRET: 'a'.repeat(32),
        COOKIE_SECRET: 'b'.repeat(32),
      });
      expect(externalCfg.database.isRenderInternal).toBe(false);
      expect(externalCfg.database.rejectUnauthorized).toBe(true);

      // 3. Unrelated host that contains dpg- in path or query
      const spoofCfg = loadServerConfig({
        NODE_ENV: 'production',
        DATABASE_URL: 'postgresql://user:pass@my-custom-host.com/dpg-db',
        JWT_SECRET: 'a'.repeat(32),
        COOKIE_SECRET: 'b'.repeat(32),
      });
      expect(spoofCfg.database.isRenderInternal).toBe(false);
      expect(spoofCfg.database.rejectUnauthorized).toBe(true);
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
  });
});
