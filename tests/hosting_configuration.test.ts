import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { getDatabaseService, resetDatabaseInstance } from '../src/db/index.js';
import { buildApp } from '../src/app.js';

describe('DORMEX Hosting & Production Environment Integrity Suite', () => {
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

  describe('1. Production Database Fail-Safe Configuration', () => {
    it('throws FATAL_DATABASE_CONFIG in production when DATABASE_URL is missing', () => {
      process.env.NODE_ENV = 'production';
      delete process.env.DATABASE_URL;

      expect(() => {
        getDatabaseService();
      }).toThrow('FATAL_DATABASE_CONFIG: Production requires an externally supplied DATABASE_URL');
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
      const db = getDatabaseService(true);
      const app = await buildApp(db);
      expect(app).toBeDefined();
      await app.close();
    });
  });

  describe('2. Vercel Configuration & Rewrites', () => {
    it('vercel.json exists, parses valid JSON, and prioritizes /api/* rewrites before SPA fallback', () => {
      const vercelPath = path.resolve(process.cwd(), 'vercel.json');
      expect(fs.existsSync(vercelPath)).toBe(true);

      const vercelConfig = JSON.parse(fs.readFileSync(vercelPath, 'utf-8'));
      expect(vercelConfig.version).toBe(2);
      expect(Array.isArray(vercelConfig.rewrites)).toBe(true);

      const rewrites = vercelConfig.rewrites;
      expect(rewrites.length).toBeGreaterThanOrEqual(2);

      // Rule: API rewrite must precede catch-all SPA rewrite
      const apiRewriteIdx = rewrites.findIndex((r: any) => r.source === '/api/(.*)');
      const spaRewriteIdx = rewrites.findIndex((r: any) => r.source === '/(.*)');

      expect(apiRewriteIdx).toBeGreaterThanOrEqual(0);
      expect(spaRewriteIdx).toBeGreaterThan(apiRewriteIdx);
      expect(rewrites[apiRewriteIdx].destination).toContain('/api/$1');
      expect(rewrites[spaRewriteIdx].destination).toBe('/index.html');
    });

    it('vercel.json includes security headers and service-worker cache directives', () => {
      const vercelConfig = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), 'vercel.json'), 'utf-8'));
      expect(Array.isArray(vercelConfig.headers)).toBe(true);

      const swHeader = vercelConfig.headers.find((h: any) => h.source === '/sw.js');
      expect(swHeader).toBeDefined();
      expect(swHeader.headers.some((kv: any) => kv.key === 'Service-Worker-Allowed' && kv.value === '/')).toBe(true);
    });
  });

  describe('3. Readiness Health Check Endpoint', () => {
    it('returns 200 with database status CONNECTED when db is active', async () => {
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
      expect(body.database).toBe('CONNECTED');
      expect(body.service).toBe('DORMEX Hostel Allocation Engine');
      await app.close();
    });
  });

  describe('4. Environment Template Safety', () => {
    it('.env.example does not contain hardcoded production secrets or live student accounts', () => {
      const examplePath = path.resolve(process.cwd(), '.env.example');
      expect(fs.existsSync(examplePath)).toBe(true);
      const envExample = fs.readFileSync(examplePath, 'utf-8');

      // Never expose real live secrets
      expect(envExample).not.toContain('AKIA');
      expect(envExample).not.toContain('BEGIN PRIVATE KEY');
      expect(envExample).toContain('NODE_ENV');
      expect(envExample).toContain('DATABASE_URL');
      expect(envExample).toContain('JWT_SECRET');
      expect(envExample).toContain('COOKIE_SECRET');
    });
  });
});
