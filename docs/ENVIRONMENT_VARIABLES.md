# DORMEX — Environment Variables & Configuration Matrix

This document provides the canonical specification of all configuration and secret parameters required across environments (Local Development, Staging, and Production), their scopes, and hosting provider assignments.

---

## 1. Environment Variable Matrix

| Variable Name | Required In | Target Environment / Host | Exposure Scope | Description & Constraints | Safe Fallback / Default |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `DATABASE_URL` | Production & Staging | **Render** (Web Service) | **Server-Only (Private)** | Full PostgreSQL connection string (`postgresql://<user>:<password>@<host>:<port>/<dbname>`). Must never be exposed to client. | None (Server terminates if missing in prod) |
| `JWT_SECRET` | Production & Staging | **Render** (Web Service) | **Server-Only (Private)** | Cryptographic secret key used to sign and verify Fastify JWTs. Minimum 32 characters in production. | In `development`/`test` defaults to dummy key if unset. |
| `COOKIE_SECRET` | Production & Staging | **Render** (Web Service) | **Server-Only (Private)** | Cryptographic signing secret for signed HttpOnly session cookies. Minimum 32 characters. | In `development`/`test` defaults to dummy key if unset. |
| `PORT` | All | **Render** & Local | **Server-Only (Private)** | Port on which Fastify listens. In Render, automatically injected as `10000`. | `3000` |
| `HOST` | All | **Render** & Local | **Server-Only (Private)** | Network interface binding. Must be `0.0.0.0` in containerized environments (Render). | `0.0.0.0` |
| `NODE_ENV` | All | **Render**, **Vercel**, Local | **System Runtime** | Defines runtime execution mode (`production`, `staging`, `development`, `test`). | `development` |
| `DORMEX_APP_ENV` | All | **Render** (Web Service) | **Server-Only (Private)** | Application environment identifier (`production`, `staging`, `development`). Guard against demo seeders running in production. | `development` |
| `CORS_ORIGIN` | Production | **Render** (Web Service) | **Server-Only (Private)** | Allowed Origin header for CORS. Set to your Vercel deployment URL (e.g. `https://dormex.vercel.app` or `*` during initial staging). | Localhost regex in development |
| `SUPER_ADMIN_EMAIL` | Optional (CLI) | Local / Ops Admin | **Server-Only (Private)** | Used by `scripts/bootstrap-super-admin.ts` to provision initial super admin. | `superadmin@dormex.internal` |

---

## 2. Platform Configuration Guide

### A. Render (Backend Web Service)
In the Render Dashboard (`Dashboard -> dormex-api -> Environment`):
1. **`DATABASE_URL`**: Set to the internal connection string of `dormex_db` (`postgres://dormex_db_user:...@dpg-...:5432/dormex_db`).
2. **`JWT_SECRET`**: Set to a cryptographically random 64-character hex string (e.g., generated with `openssl rand -hex 32`).
3. **`COOKIE_SECRET`**: Set to a cryptographically random 64-character hex string.
4. **`NODE_ENV`**: `production`
5. **`DORMEX_APP_ENV`**: `production`
6. **`PORT`**: `10000` (Render binds this port automatically).

### B. Vercel (Frontend Static SPA)
In the Vercel Project Settings (`Settings -> Environment Variables`):
- **NO PRIVATE SECRETS SHOULD BE ADDED TO VERCEL.**
- DORMEX uses Vercel Edge Rewrites configured in [`vercel.json`](file:///S:/Common/projects/comm%20proj/vercel.json):
  ```json
  {
    "rewrites": [
      {
        "source": "/api/:path*",
        "destination": "https://dormex-api-s4qq.onrender.com/api/:path*"
      },
      {
        "source": "/health",
        "destination": "https://dormex-api-s4qq.onrender.com/health"
      },
      {
        "source": "/readyz",
        "destination": "https://dormex-api-s4qq.onrender.com/readyz"
      },
      {
        "source": "/(.*)",
        "destination": "/index.html"
      }
    ]
  }
  ```
- Because requests are rewritten by Vercel edge nodes:
  1. The browser talks directly to `/api/...` on the Vercel domain (same-origin).
  2. Cookies set by the backend (`HttpOnly`, `SameSite=lax`) are cleanly accepted by the browser without cross-domain third-party cookie restrictions.
  3. No backend endpoints or credentials need to be baked into client-side JS bundles.

---

## 3. Local Development Template (`.env.example`)

A sanitized `.env.example` file is tracked at the root:

```ini
# DORMEX Local Environment Configuration Template
# DO NOT COMMIT REAL CREDENTIALS TO VERSION CONTROL

NODE_ENV=development
DORMEX_APP_ENV=development
PORT=3000
HOST=0.0.0.0

# Database Connection (Local Docker or PostgreSQL)
DATABASE_URL=postgresql://dormex:dormex@localhost:5432/dormex_dev

# Cryptographic Secrets (Minimum 32 characters in production)
JWT_SECRET=local_development_jwt_secret_min_32_chars_long!!
COOKIE_SECRET=local_development_cookie_secret_min_32_chars!

# CORS / Origin Settings
CORS_ORIGIN=http://localhost:5173
```
