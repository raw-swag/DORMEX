# DORMEX — Repository Inventory & Structural Manifest

**Date:** 2026-11-07  
**Scope:** Full repository audit across root, configuration, backend, frontend, database, scripts, tests, assets, and operational workflows.

---

## 1. Repository Overview

- **Project Name:** DORMEX (University Dormitory Allocation & Operations Platform)
- **Architecture:** Monorepo / Modular Monolith (Fastify Node.js Backend + React 19 / Vite SPA Frontend)
- **Primary Runtime:** Node.js 24+ LTS (ES2022 / CommonJS & TypeScript)
- **Database Engine:** PostgreSQL 16+ (Render Managed Database)
- **Hosting Targets:**
  - **Backend API & WebSockets/Workers:** Render Web Service (`https://dormex-api-s4qq.onrender.com`)
  - **Relational Database:** Render Managed PostgreSQL (`dpg-dbnjeqrl550s73fcr1lg-a.oregon-postgres.render.com`)
  - **Client SPA:** Vercel Edge CDN (`vercel.json` reverse-proxying API calls to Render)

---

## 2. Directory Structure & Classification

```text
/
├── .agents/                    [TOOLING/AGENTS] Antigravity skills and custom workflows
│   └── skills/                 Skills for code review, git commits, documentation, issues
├── .github/                    [CI/CD] GitHub workflows & issue templates
│   └── workflows/ci.yml        Automated CI running tests, typecheck, build
├── dist/                       [BUILD OUTPUT] Server & Client compilation output (gitignored)
│   ├── client/                 Minified React 19 frontend bundle & static assets
│   └── *.js                    Compiled CommonJS server modules
├── docs/                       [DOCUMENTATION] System architecture, security, rules, workflows
│   ├── SECURITY_AUDIT.md       Full static & dynamic security audit results
│   ├── REPOSITORY_INVENTORY.md File-by-file classification & manifest (this document)
│   ├── ENVIRONMENT_VARIABLES.md Environment variable specification & scopes
│   ├── SECURITY_REMEDIATION.md Vulnerability remediation & operational runbook
│   ├── features.md             Feature specifications
│   ├── rules.md                Allocation rules & business invariants
│   ├── system_design.md        Database schema & domain architecture
│   └── workflow.md             Operational workflows & procedures
├── public/                     [STATIC ASSETS] Browser icons, manifest, favicon assets
│   ├── favicon.svg             Vector favicon
│   ├── manifest.json           PWA manifest configuration
│   └── vite.svg                Vite starter icon
├── scripts/                    [OPERATIONAL SCRIPTS] Database migration, seeding & bootstrap
│   ├── bootstrap-super-admin.ts CLI for initial SUPER_ADMIN provisioning
│   ├── dev.js                  Local concurrent development runner
│   ├── seed-hosted-demo.ts     Controlled staging demo data seeder
│   └── seed.ts                 Local development seed script
├── src/                        [APPLICATION SOURCE CODE]
│   ├── allocation/             Turn engine, waiting room, seat booking transactions
│   ├── auth/                   RBAC, institutional auth, session management, password reset
│   ├── client/                 React 19 Frontend SPA (pages, components, stores, styles)
│   ├── db/                     PostgreSQL connection pool, migrations, schema definitions
│   ├── inventory/              Building, room, and seat spatial management
│   ├── notifications/          Real-time notification engine & announcement feeds
│   ├── operations/             Complaints desk, voting, 48-hour room swaps
│   ├── preferences/            Roommate matching, invites, preference ranking
│   ├── student/                Profile registry, academic eligibility, verification
│   └── server.ts               Fastify application root, plugin registration & route tree
├── tests/                      [AUTOMATED TEST SUITE] Vitest integration & unit tests
│   ├── admin-bootstrap.test.ts Admin provisioning & migration tracking tests
│   ├── dormex.test.ts          Core business invariant tests
│   ├── hosted-demo-seed.test.ts Controlled demo data seeding tests
│   └── ... (20 test suites total, 206 passing tests)
├── .env.example                [CONFIG TEMPLATE] Safe template for environment variables
├── .gitignore                  [VCS] Git exclusion list
├── package.json                [DEPENDENCIES] Package definitions & npm run scripts
├── tsconfig.json               [TYPESCRIPT] Compiler options
├── vercel.json                 [DEPLOYMENT] Vercel routing & Render reverse-proxy rewrites
└── vite.config.ts              [BUILD CONFIG] Vite bundler configuration
```

---

## 3. Detailed File Catalog

### A. Root & Configuration Files
| File Path | Classification | Purpose / Responsibility | Sensitivity |
| :--- | :--- | :--- | :--- |
| `package.json` | Active Manifest | Project dependencies, npm run scripts, engines | Public |
| `package-lock.json` | Active Manifest | Deterministic dependency tree lockfile | Public |
| `tsconfig.json` | Active Config | TypeScript compiler configuration (Node + DOM) | Public |
| `vite.config.ts` | Active Config | Frontend build bundling configuration | Public |
| `vercel.json` | Active Config | Vercel rewrite rules to proxy `/api/*` to Render | Public |
| `.gitignore` | Active Config | Prevents `.env`, `node_modules`, `dist` from git | Public |
| `.env.example` | Active Template | Sanitized template containing dummy placeholders | Public |
| `index.html` | Active Entrypoint | Frontend HTML host file loading `/src/client/main.tsx` | Public |
| `tailwind.config.js` | Active Config | Tailwind CSS utility styling definitions | Public |
| `postcss.config.js` | Active Config | PostCSS autoprefixer & tailwind plugins | Public |

### B. Backend Domain Modules (`src/`)
| Directory / File | Classification | Domain & Responsibility | Security Controls |
| :--- | :--- | :--- | :--- |
| `src/server.ts` | Active Core | Fastify server bootstrap, CORS, Cookie, JWT plugins, route tree | Centralized error handler, sanitization |
| `src/auth/` | Active Domain | Identity, session tokens, Argon2/PBKDF2 hashing, role policies | Cookie `HttpOnly`, `SameSite=lax` |
| `src/allocation/` | Active Domain | Server-authoritative turn scheduling & seat bookings | Row-level locking (`SELECT ... FOR UPDATE`) |
| `src/db/` | Active Domain | PostgreSQL connection pooling, TLS enforcement, migrations | Parameterized queries (`$1, $2`), SSL validation |
| `src/inventory/` | Active Domain | Hostel building maps, floor layouts, room & bed assignments | Scoped queries by building/role |
| `src/operations/` | Active Domain | Complaints desk, upvoting, room swap workflows | Anonymized voter IDs, temporal swap window |
| `src/preferences/`| Active Domain | Roommate invitations, preference vectors | Targeted recipient checks |
| `src/student/` | Active Domain | Student registry, GPA/priority validation, verification status | Role-based data redaction |
| `src/notifications/`| Active Domain | User notification inbox and announcements | Private targeting validation |

### C. Frontend Architecture (`src/client/`)
| Directory / File | Classification | Purpose / Responsibility | Security Invariants |
| :--- | :--- | :--- | :--- |
| `src/client/main.tsx` | Active Entrypoint | Mounts React 19 root into DOM `#root` | Zero secrets or backend URLs |
| `src/client/App.tsx` | Active Root | Main application shell, state contexts, views | Context-aware role-gating |
| `src/client/components/`| Active UI | Reusable widgets (navbars, modals, alerts, badges) | Sanitized outputs |
| `src/client/pages/` | Active Views | Dashboard, Allocation Map, Roommate Finder, Complaints | Same-origin API calls (`/api/...`) |
| `src/client/api/` | Active Client API | HTTP fetch wrapper calling `/api` routes | Uses browser-managed session cookies |

### D. Operational & Maintenance Scripts (`scripts/`)
| Script | Classification | Purpose | Execution Guard |
| :--- | :--- | :--- | :--- |
| `scripts/dev.js` | Development | Concurrent runner for local client & server | Development only |
| `scripts/bootstrap-super-admin.ts` | Production/Ops | CLI command to provision the initial super admin | Requires direct shell access or DB admin |
| `scripts/seed-hosted-demo.ts` | Staging/Demo | Populates 30 demo accounts for staging preview | Hard-blocked in `NODE_ENV=production` |
| `scripts/seed.ts` | Local Dev | Seeds mock data into local PostgreSQL | Development only |

---

## 4. Dependencies & Hygiene Status

### Removed Deprecated / Dead Dependencies:
1. `zoid`: Unused cross-domain component library (removed).
2. `tailwindcss-merge`: Unused utility package superseded by standard tailwind classes (removed).
3. `clsx`: Unused conditional class utility (removed).

### Retained Production Dependencies:
- `fastify`, `@fastify/cookie`, `@fastify/jwt`, `@fastify/cors`, `@fastify/static`: Core API server runtime.
- `pg`: Relational PostgreSQL driver with connection pooling.
- `react`, `react-dom`, `lucide-react`, `konva`, `react-konva`: Core interactive client SPA.
- `zod`: High-performance runtime schema validation.
- `dotenv`: Server-side environment variable loader.
- `typescript`, `@types/node`, `@types/pg`, `@types/react`, `@types/react-dom`: Maintained in dependencies to enable containerized production compilation on Render (`NODE_ENV=production`).

---

## 5. Build Artifact Verification

- **Client Bundle (`dist/client/assets/`):**
  - Minified CSS: `54.39 kB`
  - Minified JavaScript: `627.31 kB`
  - **Secret Leak Verification:** 0 occurrences of `DATABASE_URL`, `JWT_SECRET`, `COOKIE_SECRET`, or credentials.
- **Server Output (`dist/*.js`):**
  - Clean CommonJS modules targeting Node.js 24 runtime.
