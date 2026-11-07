# DORMEX — Production Deployment Guide: Vercel & Render

This guide provides step-by-step instructions for deploying DORMEX to **Vercel** (Frontend) and **Render** (Backend Fastify API + Managed PostgreSQL).

---

## 1. Architecture Overview

- **Frontend**: Hosted on **Vercel** as a static single-page application (SPA). Vercel routes `/api/*`, `/health`, and `/readyz` to the Render backend service via `vercel.json` rewrites.
- **Backend API**: Hosted on **Render** as a Node.js Web Service running Fastify on port `$PORT`.
- **Database**: Hosted on **Render Managed PostgreSQL** (or **Neon**).

---

## 2. Render Deployment (Database & Backend)

### Step 1: Create PostgreSQL Database on Render
1. Navigate to the [Render Dashboard](https://dashboard.render.com/).
2. Click **New +** $\rightarrow$ **PostgreSQL**.
3. Name: `dormex-postgres`.
4. Database: `dormex`.
5. User: `dormex_user`.
6. Region: Choose the same region as your backend (e.g. `Singapore` or `Oregon`).
7. Once provisioned, copy the **Internal Database URL** (e.g., `postgresql://dormex_user:...@dpg-...-a:5432/dormex`).
   > [!IMPORTANT]
   > Use Render's **Internal Database URL** for services hosted inside Render to ensure low latency and avoid external egress charges.

### Step 2: Create Web Service on Render
1. Click **New +** $\rightarrow$ **Web Service**.
2. Connect the repository: `saugat2737/DORMEX`.
3. Branch: `main` (or designated production release branch).
4. Runtime: `Node`.
5. Build Command:
   ```bash
   npm ci && npm run build:server
   ```
6. Start Command:
   ```bash
   npm start
   ```
7. Configure Environment Variables on Render:
   - `DATABASE_URL`: Your Render Internal Database URL.
   - `NODE_ENV`: `production`
   - `HOST`: `0.0.0.0`
   - `PG_SSL`: `true`
   - `PG_MAX_CONNECTIONS`: `20`
   - `COOKIE_SECRET`: A 32+ character random secret string.
   - `JWT_SECRET`: A 32+ character random secret string.
   - `SEED_DEMO_DATA`: `false` (enforces zero test credentials in production).
   - `CORS_ORIGIN`: Your Vercel frontend URL (e.g., `https://dormex.vercel.app`).

### Step 3: Bootstrap Initial Super Administrator
After backend deployment completes, run the bootstrap script from Render's Shell or locally pointing to the external database URL:
```bash
npx tsx scripts/bootstrap-super-admin.ts
```

---

## 3. Vercel Deployment (Frontend)

1. Navigate to the [Vercel Dashboard](https://vercel.com/dashboard).
2. Click **Add New...** $\rightarrow$ **Project**.
3. Import the `saugat2737/DORMEX` repository.
4. Framework Preset: **Vite**.
5. Build Command: `npm run build:client`
6. Output Directory: `dist/client`
7. Ensure `vercel.json` in the root points to your deployed Render URL:
   ```json
   {
     "version": 2,
     "rewrites": [
       {
         "source": "/api/(.*)",
         "destination": "https://dormex-api.onrender.com/api/$1"
       },
       {
         "source": "/health",
         "destination": "https://dormex-api.onrender.com/health"
       },
       {
         "source": "/readyz",
         "destination": "https://dormex-api.onrender.com/readyz"
       },
       {
         "source": "/(.*)",
         "destination": "/index.html"
       }
     ]
   }
   ```
8. Click **Deploy**.

---

## 4. Verification Check
- Visit `https://dormex.vercel.app/health` $\rightarrow$ should return `{"status":"UP"}`.
- Visit `https://dormex.vercel.app/readyz` $\rightarrow$ should return `{"status":"READY","database":"CONNECTED"}`.
- Sign in through the portal with institutional credentials.
