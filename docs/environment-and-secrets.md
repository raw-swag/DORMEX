# DORMEX — Environment Configuration & Secret Management Architecture Guide

This guide establishes the comprehensive security and configuration architecture for **DORMEX**, defining the boundary between dynamic runtime environment variables, client-bundled configuration, and immutable application-domain constants.

---

## 1. Architectural Configuration Hierarchy

DORMEX enforces a strict configuration separation across three distinct domains:

```mermaid
flowchart TD
    subgraph Hosting_Platforms["Hosting Infrastructure & Secret Stores"]
        Render["Render Web Service (Private Env Secrets)"]
        Vercel["Vercel Frontend (Public Static CDN)"]
    end

    subgraph Backend_Runtime["Backend Runtime (src/config/index.ts)"]
        ServerConfig["loadServerConfig() Validator"]
        DB["PostgreSQL Pool (Render Managed DB)"]
        Auth["Fastify JWT & Scrypt Auth"]
        CORS["Strict Dynamic CORS Origin Filter"]
        WebAuthn["Dynamic RP ID & WebAuthn Engine"]
    end

    subgraph Client_Runtime["Browser Client Runtime (src/client)"]
        Rewrites["vercel.json /api/* Reverse Proxy"]
        AppShell["Relative-Path HTTP Client"]
    end

    Render -->|DATABASE_URL, JWT_SECRET, CORS_ALLOWED_ORIGINS| ServerConfig
    ServerConfig --> DB
    ServerConfig --> Auth
    ServerConfig --> CORS
    ServerConfig --> WebAuthn

    Vercel --> Rewrites
    Rewrites -->|Transparent Proxy| Backend_Runtime
    Client_Runtime --> Rewrites
```

---

## 2. Environment Variables Matrix

### A. Backend Variables (Render Web Service)

These variables must be configured in Render's dashboard under **Environment**:

| Variable Name | Required | Default / Format | Description |
| :--- | :--- | :--- | :--- |
| `NODE_ENV` | **Yes** | `production` | Enforces production runtime safeguards and disables test bypasses. |
| `HOST` | **Yes** | `0.0.0.0` | IP binding. Must be `0.0.0.0` on Render to accept reverse proxy traffic. |
| `PORT` | Auto | `3000` | Injected automatically by Render. |
| `DATABASE_URL` | **Yes** | `postgresql://...` | Secure connection string to Render Managed PostgreSQL (`dormex_db`). |
| `PG_SSL` | Optional | `true` | Explicit SSL activation (cloud database hostnames auto-enable SSL). |
| `PG_SSL_REJECT_UNAUTHORIZED`| Optional | `false` | Required for Render internal private network endpoints (`dpg-*`). |
| `JWT_SECRET` | **Yes** | 32+ characters | Cryptographic key for session token signing. Server halts if `< 32` chars. |
| `COOKIE_SECRET` | Optional | 32+ characters | Cookie signature protection. |
| `CORS_ALLOWED_ORIGINS` | Optional | Comma-separated URLs | Additional production frontend domains permitted for CORS. |
| `WEBAUTHN_RP_IDS` | Optional | Comma-separated hosts| Additional domain names authorized for WebAuthn authentication. |
| `INITIAL_ADMIN_EMAIL` | Optional | `admin@college.edu` | Used only for initial migration bootstrap. |
| `INITIAL_ADMIN_PASSWORD`| Optional | `<password>` | Used only for initial migration bootstrap. |
| `SMTP_HOST` / `SMTP_USER` | Optional | Hostname / User | Email gateway credentials for password reset tokens. |

### B. Frontend Variables (Vercel)

Vercel hosts the compiled single-page application and static assets.

> [!IMPORTANT]
> **No backend secrets, database connection strings, or private keys belong in Vercel.**
> The frontend communicates exclusively via relative paths (`/api/...`) proxied through [`vercel.json`](file:///S:/Common/projects/comm%20proj/vercel.json) to Render.

---

## 3. Immutable Application Constants (Retained in Source)

To protect institutional governance invariants, the following are **strictly hardcoded** as immutable domain constants and cannot be altered or bypassed via environment variables:

1. **Governance & Role Definitions**:
   - Institutional singleton definition: `institutional_governance.singleton_id = 1`.
   - Role hierarchy: `SUPER_ADMIN` > `CHIEF_WARDEN` > `WARDEN` > `DEPUTY_WARDEN` > `HOSTEL_OFFICE` > `STUDENT`.
   - Downward-only review authority and building-boundary rules.
2. **Hardware Device Slots**:
   - Exactly three predefined hardware slots: `SLOT_01`, `SLOT_02`, `SLOT_03`.
   - Enforced by database check constraints and `DeviceAuthService`.
3. **Canonical Demo Account IDs**:
   - `ADM001` (`usr_adm001`), `ADM002` (`usr_admin_2`), `ADM003` (`usr_admin_3`).
   - `OFF001` through `OFF005`.
   - `DEMO-001` through `DEMO-010`.

---

## 4. Local Development Configuration

1. Copy [`.env.example`](file:///S:/Common/projects/comm%20proj/.env.example) to `.env`:
   ```bash
   cp .env.example .env
   ```
2. For local testing without PostgreSQL, leave `DATABASE_URL` commented out. DORMEX will automatically use the in-memory SQLite/PostgreSQL emulation engine.
3. For local PostgreSQL development:
   ```env
   DATABASE_URL=postgresql://postgres:postgres@localhost:5432/dormex
   NODE_ENV=development
   PORT=3000
   HOST=127.0.0.1
   SEED_DEMO_DATA=true
   ```

---

## 5. Secret Rotation Runbook

### A. Rotating `JWT_SECRET`
1. Generate a new cryptographically random 64-character secret:
   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```
2. Update `JWT_SECRET` in the Render Web Service Environment dashboard.
3. Trigger a manual deploy. Existing sessions will expire safely, prompting users to re-authenticate with their credentials.

### B. Rotating `DATABASE_URL`
1. If the database password is reset in Render:
2. Update the `DATABASE_URL` environment secret on the Render Web Service.
3. Verify readiness probe:
   ```bash
   curl https://dormex-api-s4qq.onrender.com/readyz
   # Expected response: {"status":"READY","database":"CONNECTED"}
   ```
