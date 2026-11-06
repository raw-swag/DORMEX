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
|  - Health Proxy: /health -> https://dormex-api.onrender.com/health                                                 |
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
|  - Health & Readiness: GET /health (checks database alive and service status)                                      |
|  - Graceful Shutdown: Handles SIGTERM & SIGINT for zero-downtime rolling deploys                                  |
|  - Service Tier: Paid / Always-On (Standard/Starter) — DO NOT use sleeping free tier for live allocation turns     |
+-------------------------------------------------------------------------------------------------------------------+
                                                             |
                                                             | TLS / SSL (Pooled & Direct Connection)
                                                             v
+-------------------------------------------------------------------------------------------------------------------+
| Neon PostgreSQL: Singapore Region (Matching Render)                                                               |
|                                                                                                                   |
|  - Pooled Connection: postgresql://[user]:[pwd]@[ep]-pooler.ap-southeast-1.aws.neon.tech/dormex?sslmode=require  |
|  - Direct Connection: postgresql://[user]:[pwd]@[ep].ap-southeast-1.aws.neon.tech/dormex?sslmode=require         |
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
   *Note: DORMEX's `PostgresDatabaseService` automatically detects `-pooler` and `neon.tech` hostnames, enforcing TLS SSL (`rejectUnauthorized: false`).*

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
     npm ci && npm run build:server
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
   - **Health Check Path**: `/health`
   *(Render will probe `GET /health` during deployments. The endpoint verifies database responsiveness and returns HTTP 200 `UP` only when Neon PostgreSQL is connected).*

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
         { "source": "/(.*)", "destination": "/index.html" }
       ]
     }
     ```
   - **Update Destination URL**: If your Render service URL differs from `dormex-api.onrender.com`, update the destination host in `vercel.json` to match your actual Render hostname.
   - **Why This Matters**: Because the browser communicates with `https://dormex.vercel.app/api/...`, all requests are strictly same-origin. The backend's `Set-Cookie: token=...; HttpOnly; SameSite=Lax; Secure` cookie is stored directly under `dormex.vercel.app`. No third-party cookie restrictions or cross-origin credential bypasses are needed.
6. Click **Deploy**.

---

## 3. Safe Database Migration & First-Admin Bootstrap

### Initializing Neon PostgreSQL Schema
Before traffic arrives, execute the safe migration runner against the Neon database:

```bash
# Run migration runner pointing to Neon Direct or Pooled connection URL
DATABASE_URL="postgresql://[user]:[password]@[endpoint].ap-southeast-1.aws.neon.tech/dormex_production?sslmode=require" \
NODE_ENV=production \
npm run migrate
```

### What the Migration Runner Does:
1. Validates connection to the database.
2. Applies all idempotent schema statements from `SCHEMA_SQL` (tables, constraints, foreign keys).
3. Seeds institutional roles (`SUPER_ADMIN`, `HOSTEL_OFFICE`, `CHIEF_WARDEN`, `WARDEN`, `PROCTOR`, `STUDENT`).
4. Seeds official master room inventory (BVB Block Floor 2, 72 rooms 201–272).
5. **Strictly omits all synthetic demo students** (`DEMO-001` through `DEMO-030`) and test accounts because `NODE_ENV=production`.
6. Creates the initial Super Administrator using `INITIAL_ADMIN_EMAIL` and `INITIAL_ADMIN_PASSWORD` (or `INITIAL_ADMIN_HASH`) if configured.

---

## 4. Verification & Health Checklist

After deploying both services:

- [ ] **1. Health Check Response**:
  `curl -i https://dormex-api.onrender.com/health`
  Expect:
  ```json
  HTTP/2 200
  {
    "status": "UP",
    "database": "CONNECTED",
    "environment": "production",
    "service": "DORMEX Hostel Allocation Engine"
  }
  ```
- [ ] **2. Vercel SPA Routing**:
  Visit `https://dormex.vercel.app/` and reload. Verify no 404 error is returned.
- [ ] **3. Vercel API Proxy**:
  `curl -i https://dormex.vercel.app/health`
  Expect HTTP 200 forwarded from Render.
- [ ] **4. Production Seed Isolation**:
  Confirm in Neon database that `SELECT count(*) FROM users WHERE college_id LIKE 'DEMO-%';` returns `0`.
- [ ] **5. Cookie-Based Session Restoration**:
  Log in as the initial administrator on `https://dormex.vercel.app/`.
  Confirm `Set-Cookie` is received, refresh the browser, and verify `/api/auth/me` restores the session without token storage in `localStorage`.
- [ ] **6. PWA Installation Experience**:
  On an Android device, open Chrome and confirm the branded DORMEX install prompt displays. On iOS Safari, confirm the share sheet instructions are available.
