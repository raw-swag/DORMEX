import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { getDatabaseService, resetDatabaseInstance } from '../src/db/index.js';
import { buildApp } from '../src/app.js';

describe('DORMEX Hosting, TLS & Production Environment Integrity Suite', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    resetDatabaseInstance();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    resetDatabaseInstance();
    process.env = { ...originalEnv };
    vi.unstubAllGlobals();
  });

  describe('1. PostgreSQL TLS & Security Configuration', () => {
    it('throws FATAL_DATABASE_CONFIG in production when DATABASE_URL is missing', () => {
      process.env.NODE_ENV = 'production';
      delete process.env.DATABASE_URL;

      expect(() => {
        getDatabaseService();
      }).toThrow('FATAL_DATABASE_CONFIG: Production requires an externally supplied DATABASE_URL');
    });

    it('production database configuration supports Render internal self-signed TLS', () => {
      const dbIndexContent = fs.readFileSync(path.resolve(process.cwd(), 'src/db/index.ts'), 'utf-8');
      expect(dbIndexContent).toContain('isRenderInternal');
    });

    it('throws FATAL_CONFIG_ERROR in production when JWT_SECRET is missing or less than 32 characters', async () => {
      process.env.NODE_ENV = 'production';
      process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
      delete process.env.JWT_SECRET;

      await expect(async () => {
        await buildApp();
      }).rejects.toThrow('FATAL_CONFIG_ERROR: Production requires an externally supplied JWT_SECRET with at least 32 characters');

      process.env.JWT_SECRET = 'too-short';
      await expect(async () => {
        await buildApp();
      }).rejects.toThrow('FATAL_CONFIG_ERROR: Production requires an externally supplied JWT_SECRET with at least 32 characters');
    });

    it('permits valid 32+ character JWT_SECRET in production with in-memory DB override for testing', async () => {
      process.env.NODE_ENV = 'production';
      process.env.JWT_SECRET = 'a-very-long-production-jwt-secret-key-32-chars-long';
      process.env.COOKIE_SECRET = 'a-very-long-production-cookie-secret-key-32-chars-long';
      const db = getDatabaseService(true);
      const app = await buildApp(db);
      expect(app).toBeDefined();
      await app.close();
    });
  });

  describe('2. Dedicated Health Check & Readiness Probes', () => {
    it('GET /health functions as a pure liveness probe without depending on PostgreSQL', async () => {
      process.env.NODE_ENV = 'test';
      const db = getDatabaseService(true);
      const app = await buildApp(db);

      const res = await app.inject({
        method: 'GET',
        url: '/health',
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.status).toBe('UP');
      expect(body.service).toBe('DORMEX Hostel Allocation Engine');
      expect(body.timestamp).toBeDefined();
      // Liveness probe must NOT require database field
      expect(body.database).toBeUndefined();
      await app.close();
    });

    it('GET /readyz functions as a readiness probe verifying database connectivity', async () => {
      process.env.NODE_ENV = 'test';
      const db = getDatabaseService(true);
      const app = await buildApp(db);

      const res = await app.inject({
        method: 'GET',
        url: '/readyz',
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.status).toBe('READY');
      expect(body.database).toBe('CONNECTED');
      expect(body.service).toBe('DORMEX Hostel Allocation Engine');
      await app.close();
    });
  });

  describe('3. Vercel Configuration & Rewrites', () => {
    it('vercel.json exists, parses valid JSON, and prioritizes /api/*, /health, and /readyz rewrites before SPA fallback', () => {
      const vercelPath = path.resolve(process.cwd(), 'vercel.json');
      expect(fs.existsSync(vercelPath)).toBe(true);

      const vercelConfig = JSON.parse(fs.readFileSync(vercelPath, 'utf-8'));
      expect(vercelConfig.version).toBe(2);
      expect(Array.isArray(vercelConfig.rewrites)).toBe(true);

      const rewrites = vercelConfig.rewrites;
      const apiRewriteIdx = rewrites.findIndex((r: any) => r.source === '/api/(.*)');
      const healthRewriteIdx = rewrites.findIndex((r: any) => r.source === '/health');
      const readyzRewriteIdx = rewrites.findIndex((r: any) => r.source === '/readyz');
      const spaRewriteIdx = rewrites.findIndex((r: any) => r.source === '/(.*)');

      expect(apiRewriteIdx).toBeGreaterThanOrEqual(0);
      expect(healthRewriteIdx).toBeGreaterThanOrEqual(0);
      expect(readyzRewriteIdx).toBeGreaterThanOrEqual(0);
      expect(spaRewriteIdx).toBeGreaterThan(apiRewriteIdx);
      expect(spaRewriteIdx).toBeGreaterThan(healthRewriteIdx);
      expect(spaRewriteIdx).toBeGreaterThan(readyzRewriteIdx);
      expect(rewrites[apiRewriteIdx].destination).toContain('/api/$1');
      expect(rewrites[spaRewriteIdx].destination).toBe('/index.html');
    });

    it('backend session cookie does not specify an incompatible Domain attribute and enforces Secure + HttpOnly in production', () => {
      const appTs = fs.readFileSync(path.resolve(process.cwd(), 'src/app.ts'), 'utf-8');

      // The reply.setCookie call must NOT set domain attribute (which would lock it to the Render domain)
      expect(appTs).toContain("reply.setCookie('token', token, {");
      expect(appTs).toContain("path: '/'");
      expect(appTs).toContain("httpOnly: true");
      expect(appTs).toContain("sameSite: 'lax'");
      expect(appTs).toContain("secure: process.env.NODE_ENV === 'production'");
      // Must not specify a hardcoded or conflicting domain attribute
      expect(appTs).not.toContain("domain:");
    });
  });

  describe('4. Migration Script Safeguards & Schema Tracking', () => {
    it('src/db/migrate.ts creates a schema_migrations tracking table and forbids synthetic students in production', () => {
      const migrateTs = fs.readFileSync(path.resolve(process.cwd(), 'src/db/migrate.ts'), 'utf-8');

      expect(migrateTs).toContain('CREATE TABLE IF NOT EXISTS schema_migrations');
      expect(migrateTs).toContain('applied_at TIMESTAMP WITH TIME ZONE');
      expect(migrateTs).toContain('CRITICAL_INTEGRITY_VIOLATION');
      expect(migrateTs).not.toContain('TRUNCATE');
      expect(migrateTs).not.toContain('DROP DATABASE');
      expect(migrateTs).not.toContain('DROP TABLE');
    });
  });
});
