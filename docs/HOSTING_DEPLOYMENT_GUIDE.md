# DORMEX Hosting & Deployment Guide
## Vercel (Frontend) + Render (Backend) + Neon (PostgreSQL)

This guide documents the exact, production-verified procedure for provisioning and deploying DORMEX across **Vercel**, **Render**, and **Neon Managed PostgreSQL**.

---

## 1. Hosting Architecture Overview

```
                                      +---------------------------------------------+
                                      |                 Browser                     |
                                      +---------------------------------------------+
                                                             |
                                                             | HTTPS (Same-Origin)
                                                             v
+-------------------------------------------------------------------------------------------------------------------+
| Vercel Frontend: https://dormex.vercel.app                                                                        |
|                                                                                                                   |
|  - Root: /                                                                                                        |
|  - Framework: Vite + React                                                                                        |
|  - Output Directory: dist/client                                                                                  |
|  - Routing: SPA Fallback -> /index.html                                                                           |
|  - API Proxy: /api/* -> https://dormex-api.onrender.com/api/*                                                     |
|  - Liveness Proxy: /health -> https://dormex-api.onrender.com/health                                               |
|  - Readiness Proxy: /readyz -> https://dormex-api.onrender.com/readyz                                             |
|  - Cookie Handling: HttpOnly session cookie stored under frontend origin (credentials: 'same-origin')             |
+-------------------------------------------------------------------------------------------------------------------+
                                                             |
                                                             | External Rewrite
                                                             v
+-------------------------------------------------------------------------------------------------------------------+
| Render Backend Web Service: https://dormex-api.onrender.com                                                       |
|                                                                                                                   |
|  - Runtime: Node.js 22 LTS (Fastify)                                                                              |
|  - Region: Singapore (ap-southeast-1)                                                                             |
|  - Host Binding: 0.0.0.0 (via process.env.HOST)                                                                    |
|  - Port: $PORT (provided by Render)                                                                               |
|  - Health & Liveness Probe: GET /health (checks process alive; zero DB dependencies)                              |
|  - Readiness Probe: GET /readyz (checks live PostgreSQL connectivity via SELECT 1)                                |
|  - Graceful Shutdown: Handles SIGTERM & SIGINT for zero-downtime rolling deploys                                  |
|  - Service Tier: Paid / Always-On (Standard/Starter) — DO NOT use sleeping free tier for live allocation turns     |
+-------------------------------------------------------------------------------------------------------------------+
                                                             |
                                                             | Verified TLS (rejectUnauthorized: true)
                                                             v
+-------------------------------------------------------------------------------------------------------------------+
| Neon PostgreSQL: Singapore Region (Matching Render)                                                               |
|                                                                                                                   |
|  - Pooled Connection: postgresql://[user]:[pwd]@[ep]-pooler.ap-southeast-1.aws.neon.tech/dormex?sslmode=require  |
|  - Direct Connection: postgresql://[user]:[pwd]@[ep].ap-southeast-1.aws.neon.tech/dormex?sslmode=require         |
|  - TLS Security: Strictly verified certificate validation (rejectUnauthorized: true)                              |
|  - Relational Schema: 20+ relational tables, partial unique indexes, foreign keys                                 |
|  - Concurrency Safety: Atomic transactions with BEGIN/COMMIT/ROLLBACK and conflict rejection                      |
+-------------------------------------------------------------------------------------------------------------------+
```

---

## 2. Step-by-Step Provisioning Runbook

### A. Neon Managed PostgreSQL Setup
1. Log in to the [Neon Console](https://console.neon.tech/).
2. Create a new project:
   - **Project Name**: `dormex-db`
   - **Postgres Version**: `PostgreSQL 16` or `17`
   - **Region**: `AWS Singapore (ap-southeast-1)` (critical: must match Render region for single-digit millisecond latency).
3. Under **Databases**, create two separate databases:
   - `dormex_production` (Production live database)
   - `dormex_staging` (Staging & QA verification database)
4. Retrieve connection strings from Dashboard:
   - **Pooled Connection String** (contains `-pooler`):
     ```text
     postgresql://[user]:[password]@[endpoint]-pooler.ap-southeast-1.aws.neon.tech/dormex_production?sslmode=require
     ```
   - **Direct Connection String** (without `-pooler`):
     ```text
     postgresql://[user]:[password]@[endpoint].ap-southeast-1.aws.neon.tech/dormex_production?sslmode=require
     ```
   *Note: DORMEX's `PostgresDatabaseService` automatically enforces verified TLS with certificate validation (`rejectUnauthorized: true`). Neon uses Let's Encrypt ISRG Root X1, which is natively trusted by Node.js.*

---

### B. Render Fastify Web Service Setup
1. Log in to the [Render Dashboard](https://dashboard.render.com/).
2. Click **New +** $\rightarrow$ **Web Service**.
3. Connect your GitHub repository: `raw-swag/DORMEX`.
4. Configure service settings:
   - **Name**: `dormex-api` (or custom institutional backend name)
   - **Region**: `Singapore` (matches Neon database region)
   - **Branch**: `main`
   - **Root Directory**: Leave blank (root)
   - **Runtime**: `Node`
   - **Build Command**:
     ```bash
     npm ci --include=dev && npm run build:server
     ```
   - **Start Command**:
     ```bash
     npm run start
     ```
     *(Which executes `node dist/server.js`)*
   - **Instance Type**: **Starter** or higher (Paid Always-On). **DO NOT select Free instance** — free instances sleep after inactivity, which drops active allocation countdowns and breaks websocket/polling turn notifications.
5. Configure Environment Variables in Render:
   | Key | Recommended Value / Description | Required |
   | :--- | :--- | :---: |
   | `NODE_ENV` | `production` | **Yes** |
   | `HOST` | `0.0.0.0` | **Yes** |
   | `PORT` | `10000` (or let Render assign dynamically) | Render default |
   | `DATABASE_URL` | Neon pooled connection string | **Yes** |
   | `JWT_SECRET` | Cryptographically generated key (minimum 32 chars) | **Yes** |
   | `COOKIE_SECRET` | Cryptographically generated cookie key (32+ chars) | **Yes** |
   | `INITIAL_ADMIN_EMAIL` | `admin@college.edu` | Optional |
   | `INITIAL_ADMIN_PASSWORD` | Strong production password | Optional |
   | `SEED_DEMO_DATA` | `false` (Blocked by server regardless) | Optional |
6. Configure Health Check Path in Render:
   - **Health Check Path**: `/health` (Recommended for Render zero-downtime rolling deploys as a pure process liveness probe).
   - Alternatively, use `/readyz` for readiness probing once the database is fully migrated and reachable.

---

### C. Vercel Frontend Setup
1. Log in to the [Vercel Dashboard](https://vercel.com/).
2. Click **Add New...** $\rightarrow$ **Project**.
3. Import the repository: `raw-swag/DORMEX`.
4. Configure Project Settings:
   - **Framework Preset**: `Vite`
   - **Root Directory**: `./` (repository root)
   - **Build Command**: `npm run build:client`
   - **Output Directory**: `dist/client`
   - **Install Command**: `npm ci`
5. Vercel Rewrites & Cookie Strategy ([`vercel.json`](file:///C:/Users/admin/OneDrive/Desktop/dormex/vercel.json)):
   - The repository includes [`vercel.json`](file:///C:/Users/admin/OneDrive/Desktop/dormex/vercel.json) configuring reverse proxy routing:
     ```json
     {
       "rewrites": [
         { "source": "/api/(.*)", "destination": "https://dormex-api.onrender.com/api/$1" },
         { "source": "/health", "destination": "https://dormex-api.onrender.com/health" },
         { "source": "/readyz", "destination": "https://dormex-api.onrender.com/readyz" },
         { "source": "/(.*)", "destination": "/index.html" }
       ]
     }
     ```
   - **Update Destination URL**: The hostname `dormex-api.onrender.com` is a clearly documented placeholder. If your Render service URL differs upon creation (e.g. `dormex-backend-xyz.onrender.com`), update the destination host in `vercel.json` to match your actual Render hostname.
   - **Why This Matters**: Because the browser communicates with `https://dormex.vercel.app/api/...`, all requests are strictly same-origin. The backend's `Set-Cookie: token=...; HttpOnly; SameSite=Lax; Secure` cookie is stored directly under `dormex.vercel.app`. No third-party cookie restrictions or cross-origin credential bypasses are needed.
6. Click **Deploy**.

---

## 3. Safe Database Migration & Backup Procedure

### Pre-Migration Database Backup
Before executing schema migrations or configuration changes on an active database:
```bash
# Export schema and data using pg_dump
pg_dump "$DATABASE_URL" -Fc -f "dormex_backup_$(date +%Y%m%d_%H%M%S).dump"
```

### Initializing Neon PostgreSQL Schema
Execute the safe migration runner against the Neon database:

```bash
DATABASE_URL="postgresql://[user]:[password]@[endpoint].ap-southeast-1.aws.neon.tech/dormex_production?sslmode=require" \
NODE_ENV=production \
npm run migrate
```

### Safeguards Implemented in `src/db/migrate.ts`:
1. **Migration Tracking Table**: Uses `schema_migrations` (`id`, `name`, `applied_at`) to record every applied version atomically.
2. **Idempotent DDL Execution**: All tables, foreign keys, and indexes use `IF NOT EXISTS`. Never executes `DROP TABLE`, `TRUNCATE`, or `DROP DATABASE`.
3. **No Synthetic Student Data**: In production (`NODE_ENV=production`), synthetic demo students (`DEMO-001` through `DEMO-030`) and mock payment records are strictly excluded.
4. **Integrity Guard**: Asserts `COUNT(*) == 0` for `DEMO-%` users at the conclusion of migration; aborts with `CRITICAL_INTEGRITY_VIOLATION` if synthetic records are detected.
5. **Legitimate Master Inventory**: Sets up authorized institutional roles and published Terms & Conditions document (Version 1). Initial super admin is created only if `INITIAL_ADMIN_EMAIL` and `INITIAL_ADMIN_PASSWORD` (or `INITIAL_ADMIN_HASH`) are explicitly supplied.

---

## 4. Verification & Health Checklist

After deploying both services:

- [ ] **1. Process Liveness Check**:
  `curl -i https://dormex-api.onrender.com/health`
  Expect HTTP 200 with `status: "UP"`.
- [ ] **2. Database Readiness Check**:
  `curl -i https://dormex-api.onrender.com/readyz`
  Expect HTTP 200 with `status: "READY"` and `database: "CONNECTED"`.
- [ ] **3. Vercel SPA Routing**:
  Visit `https://dormex.vercel.app/` and reload. Verify no 404 error is returned.
- [ ] **4. Vercel API Proxy**:
  `curl -i https://dormex.vercel.app/health` and `curl -i https://dormex.vercel.app/readyz`
  Expect HTTP 200 forwarded cleanly from Render.
- [ ] **5. Production Seed Isolation**:
  Confirm in Neon database that `SELECT count(*) FROM users WHERE college_id LIKE 'DEMO-%';` returns `0`.
- [ ] **6. Cookie-Based Session Restoration**:
  Log in as the initial administrator on `https://dormex.vercel.app/`.
  Confirm `Set-Cookie` is received without a conflicting domain, refresh the browser, and verify `/api/auth/me` restores the session without token storage in `localStorage`.
- [ ] **7. PWA Installation Experience**:
  On an Android device, open Chrome and confirm the branded DORMEX install prompt displays. On iOS Safari, confirm the share sheet instructions are available.
