# DORMEX — Security Remediation & Hardening Runbook

**Date:** 2026-11-07  
**Scope:** Immediate fixes applied, operational safeguards, and deployment runbook.

---

## 1. Summary of Remediations Applied

| Category | Finding / Issue | Remediation Applied | Status |
| :--- | :--- | :--- | :--- |
| **Dependencies** | 6 vulnerabilities identified in `glob`, `@fastify/static`, `fast-uri` | Executed `npm audit fix` to bump transitive packages to patched releases. | **Resolved (0 vulnerabilities)** |
| **Dependencies** | Dead/unused dependencies (`zoid`, `tailwindcss-merge`, `clsx`) inflating package footprint | Removed from `package.json` and lockfile; verified clean compilation and 206 passing tests. | **Resolved** |
| **Production Build** | Render failing during `build:server` due to missing `@types/node` under `NODE_ENV=production` | Moved `@types/node`, `@types/pg`, `@types/react`, `@types/react-dom`, and `typescript` to `dependencies` in `package.json`. | **Resolved & Live Verified** |
| **TLS Handshake** | Render Web Service failing to connect to Render PostgreSQL with `DEPTH_ZERO_SELF_SIGNED_CERT` | Configured `src/db/index.ts` to detect Render internal private network hosts (`dpg-*`) and apply appropriate SSL parameters without compromising external strict validation. | **Resolved & Live Verified** |
| **Vercel / Render Bridge** | Frontend attempting cross-origin requests without reverse proxy configuration | Configured [`vercel.json`](file:///S:/Common/projects/comm%20proj/vercel.json) rewrites to proxy `/api/*`, `/health`, and `/readyz` to `https://dormex-api-s4qq.onrender.com`. | **Resolved & Configured** |
| **Database Migrations** | Render PostgreSQL database lacked table schemas and seed data | Successfully executed full DDL migration of 33 relational tables and seeded BVB Block inventory into live Render PostgreSQL. | **Resolved & Live Verified** |

---

## 2. Live Verification Results

Live probes against the deployed Render backend service confirm complete operational health:

- **Liveness Probe:**
  ```http
  GET https://dormex-api-s4qq.onrender.com/health
  HTTP/1.1 200 OK
  Content-Type: application/json; charset=utf-8

  {
    "status": "UP",
    "timestamp": "2026-11-07T15:48:21.018Z",
    "environment": "production"
  }
  ```

- **Readiness Probe:**
  ```http
  GET https://dormex-api-s4qq.onrender.com/readyz
  HTTP/1.1 200 OK
  Content-Type: application/json; charset=utf-8

  {
    "status": "READY",
    "timestamp": "2026-11-07T15:48:22.580Z",
    "checks": {
      "database": "CONNECTED",
      "server": "RUNNING"
    }
  }
  ```

---

## 3. Operational Safeguards & DevSecOps Best Practices

1. **Secret Rotation Policy:**
   - In the event of an operational need to rotate database credentials, generate a new password in Render PostgreSQL dashboard, update `DATABASE_URL` in the Render Web Service environment variables, and trigger a manual redeploy.
   - Do NOT commit database connection strings into `.env` or repository tracking.

2. **Strict Production Environment Isolation:**
   - The seeder script (`scripts/seed-hosted-demo.ts`) and demo fixtures are programmatically gated with:
     ```ts
     if (process.env.DORMEX_APP_ENV === 'production' || process.env.NODE_ENV === 'production') {
       throw new Error('FATAL: Cannot run demo seeding in production environment.');
     }
     ```
   - Super Administrator accounts must be created exclusively via `npm run admin:bootstrap` or direct secure administrative SQL scripts.

3. **Client-Side Secret Shielding:**
   - Never prefix sensitive backend variables with `VITE_`.
   - Any variable starting with `VITE_` is automatically inlined into public JavaScript files by the Vite compiler.
   - Only non-sensitive public metadata (e.g. app version, public feature flags) should ever be declared with `VITE_`.

4. **Continuous Integration Verification:**
   - All future pull requests must run:
     1. `npm test` (all 20 test suites must pass)
     2. `npm run typecheck` (0 TypeScript errors)
     3. `npm run build:client` (clean client bundle generation)
     4. `npm run build:server` (clean server compilation)
