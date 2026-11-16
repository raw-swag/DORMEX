# DORMEX — Project Handoff & Developer Continuity Guide (PROMPT.md)

Welcome to **DORMEX** (College Hostel Allocation & Administrative Management System).  
This document serves as the master onboarding, architectural state, and handoff guide for any developer or AI coding agent joining this project.

---

## A. Project Overview

### 1. Purpose & Domain
DORMEX is an institutional, production-grade hostel management and room allocation platform built for colleges and universities. It replaces legacy manual paper allotment with a transactional, server-authoritative system:
- **Primary Institutional Key**: Students are identified exclusively by their real University Seat Number (**USN**, e.g., `1SI25<branch>XYZ`).
- **Student Cohort & Priority Engine**: Queue priority is governed by `student_year_priority` and profile-assigned priority (disability accommodation, sports quotas, senior cohorts) rather than client-submitted timestamps.
- **Relational Source of Truth**: PostgreSQL relational constraints, row locks (`FOR UPDATE`), and partial unique indexes enforce single-occupancy seat guarantees and lifecycle rules.
- **Privacy-First Posture**: Student priority ranking and wishlist targeting are kept confidential via invite-based roommate recommendations rather than exposing full priority lists.

### 2. High-Level Architecture
- **Monorepo / Modular Monolith**:
  - `src/auth`: Policy and authorization (`can(actor, action, resource)`), institutional credential authentication, TOTP MFA, step-up elevation, and governance-safe identity retirement.
  - `src/student`: Institutional student registry, USN profiles, and cohort priority eligibility.
  - `src/allocation`: Server-authoritative turn scheduling, dual-bucket waiting-room admission, rolling auto-refill, and atomic seat confirmation transactions.
  - `src/inventory`: Buildings, floors, room definitions, and SVG floor map geometry rendering.
  - `src/preferences`: Room wishlists and one-hop recommendation invites.
  - `src/operations`: Complaints desk, mess menu management, and 48-hour room change requests.
  - `src/db`: PostgreSQL relational schema migrations, connection pooling, and in-memory test engine (`pg-mem`).
- **Backend Stack**: Node.js + TypeScript + Fastify + Zod validation + `pg` (node-postgres).
- **Frontend Stack**: React 18 + TypeScript + Vite + Tailwind CSS + Lucide Icons + custom interactive 2D SVG canvas floor-plan editor.
- **Current Hosting Architecture**:
  - **Frontend Client**: Deployed on Vercel (`https://dormex-sit.vercel.app`), proxying API requests through relative `/api/*` endpoints.
  - **Backend API**: Deployed on Render Web Service (`https://dormex-api-s4qq.onrender.com`) in Oregon (US-West).
  - **Database**: PostgreSQL on Render (`dormex_db`).

### 3. User Roles & Governance Model
1. **Chief Warden (`SUPER_ADMIN`)**: Sole institutional singleton executive (user ID: `usr_adm001`, USN: `ADM001`). Holds ultimate system-wide authority; cannot be deactivated or retired without explicit successor transfer.
2. **Building Warden (`WARDEN`)**: Administrative scope strictly scoped to their assigned residential building (`bld_<id>`).
3. **Deputy Warden (`DEPUTY_WARDEN`)**: Operates strictly within their supervising Warden's building and delegated authority; automatically deactivated if the supervising Warden is revoked.
4. **Hostel Office (`HOSTEL_OFFICE`)**: Administrative operations (inventory maintenance, manual cycle overrides, complaints triage) without singleton Warden privileges.
5. **Student (`STUDENT`)**: Authenticated by real USN. Access strictly restricted to personal profile, terms documents, eligible room maps, and active allocation turns.

---

## B. Current Git & Implementation State

- **Active Branch**: `main`
- **Current HEAD**: `2e28920` (`feat(db): register migration 058 forward and rollback for priority window release`)
- **Remote Synchronization**: `origin/main` is fully synchronized with local `main` at `2e28920`.
- **Feature Branch Status**: `feat/auth-institutional-mfa` has been fully merged into `main` and pushed to origin.

### Implemented Features & Verification Status Matrix

| Component | Responsibility / Design | Verification Status |
|---|---|---|
| **Migration 057** | Adds `max_admitted_capacity` (20), `standard_admission_capacity` (15), `reserved_priority_capacity` (5) to `allocation_cycles` with CHECK constraint `chk_waiting_room_capacity_sum`. | **Tested (`pg-mem`) & Validated**: 7 tests passed (`tests/waiting_room_capacity_schema.test.ts`). |
| **Migration 058** | Forward additive migration adding `priority_window_closes_at TIMESTAMP WITH TIME ZONE DEFAULT NULL` to `allocation_cycles` with corresponding rollback script. | **Implemented & Registered**: Clean forward and rollback SQL scripts registered in `src/db/migrate.ts`. |
| **Authentication & Institutional MFA** | Real USN + password authentication (Argon2id + legacy scrypt verification), TOTP MFA (RFC 6238), single-use recovery codes, step-up elevation, and identity retirement engine. | **Tested (`pg-mem`) & Validated**: 22 tests passed across `tests/institutional_auth_stage1.test.ts` and `tests/institutional_mfa_stage2.test.ts`. |
| **Dual-Bucket Admission (15+5)** | Capped at 20 max concurrent admitted participants (`ADMITTED` + `ACTIVE_TURN`). 15 places reserved for standard candidates; 5 places protected for qualified priority candidates. | **Tested (`pg-mem`) & Validated**: 4 tests passed (`tests/waiting_room_engine_phase2.test.ts`). |
| **Persistent Priority Release Policy** | Uses PostgreSQL database clock (`CURRENT_TIMESTAMP as db_now`). Before window close, priority slots are protected. After window close, unused reserved capacity dynamically opens to general pool up to 20 total. | **Tested (`pg-mem`) & Validated**: 7 tests passed (`tests/waiting_room_release_and_locking.test.ts`). |
| **Unified Root-to-Leaf Locking** | Hierarchical row locking order: `allocation_cycles` (root) -> `allocation_pools` -> `waiting_room_entries` / `booking_sessions` across all 5 write paths. | **Tested (`pg-mem`) & Validated**: Clean serialization and mutual exclusion under adversarial test suites. |
| **Adversarial Queue & Concurrency** | Validates boundary blocks, duplicate join idempotency, rolling auto-refill on confirm/expiration/exit, and transaction rollback integrity. | **Tested (`pg-mem`) & Validated**: 7 tests passed (`tests/waiting_room_adversarial_queue.test.ts`). |
| **Real PostgreSQL 18 Concurrency Suite** | Multi-connection concurrency and migration test harness (`tests/real_postgresql_phase2_concurrency.test.ts`) against local PostgreSQL 18 server (`127.0.0.1:8000`). | **BLOCKED / SKIPPED**: Skipped in generic test runs because `ISOLATED_PG_TEST_URL` is unset and requires local SCRAM password configuration. |

---

## C. Outstanding Phase 2 Release Verification

While the Phase 2 code is merged into `main`, **formal Phase 2 release-gate verification against a physical PostgreSQL instance is still pending**.

### What Needs Execution:
1. **Physical Catalog Validation**: Applying Migration 057 and 058 against actual PostgreSQL 18, verifying table constraints in `information_schema.table_constraints`, executing rollback, and reapplying.
2. **Multi-Connection Concurrency**: Exercising independent TCP socket connections (`Client` from `pg`) racing simultaneous admissions and refills against real row locks (`FOR UPDATE`).
3. **Safety Directive**: **NEVER run these tests against production `dormex_db`.**

### Disposable Local PostgreSQL 18 Setup Runbook:
To execute the real PostgreSQL suite without disclosing credentials:
```powershell
# 1. Connect to local PostgreSQL 18 instance:
& "D:\Dev\Databases\PostgreSQL\18\bin\psql.exe" -p 8000 -U postgres

# 2. Inside psql, create an isolated user and disposable database:
CREATE USER dormex_test_user WITH PASSWORD 'YOUR_STRONG_LOCAL_PASSWORD';
CREATE DATABASE dormex_phase2_test OWNER dormex_test_user;
GRANT ALL PRIVILEGES ON DATABASE dormex_phase2_test TO dormex_test_user;
\q

# 3. Set the test URL in your local shell session (do not commit to version control):
$env:ISOLATED_PG_TEST_URL="postgresql://dormex_test_user:YOUR_STRONG_LOCAL_PASSWORD@127.0.0.1:8000/dormex_phase2_test"

# 4. Execute the dedicated real PostgreSQL test suite:
npx vitest run tests/real_postgresql_phase2_concurrency.test.ts
```

---

## D. Infrastructure Migration — GitHub Issue #22

- **Tracking Issue**: [GitHub Issue #22](https://github.com/raw-swag/DORMEX/issues/22)
- **Title**: `infra: migrate database to Neon Serverless Postgres and decouple from Render free DB`

### Context & Motivation:
1. **Render Free-Tier DB Constraints**: Render's free PostgreSQL tier expires after 30 days and enforces a strict ceiling of 50 simultaneous connections with zero connection pooling. Under heavy student registration traffic, the connection pool saturates rapidly.
2. **Geographical Latency**: The existing Render API and database reside in Oregon (US-West), imposing a cross-continental physical transit floor of ~215 ms RTT for Bangalore institutional users.
3. **Target Architecture**:
   - **Database**: Hosted on **Neon Serverless Postgres** ([neon.tech](https://neon.tech)).
   - **Backend API**: Hosted on Render (with option to relocate to an Asia-Pacific region if needed).
   - **Frontend**: Remains hosted on Vercel (`https://dormex-sit.vercel.app`).

> [!NOTE]
> Neon capabilities (free tier allowances, built-in PgBouncer pooling on port 6543, region availability such as Singapore `ap-southeast-1` or Mumbai `ap-south-1`, and cold-start characteristics) must be checked against current official Neon documentation prior to executing migration.

---

## E. Infrastructure Migration Execution Runbook

When authorized to execute GitHub Issue #22, follow this ordered, non-destructive sequence:

1. **Pre-Migration Audit**:
   - Inspect existing Render database schema, active tables, sequence numbers, and total database size.
   - Verify all migrations (001 through 058) are recorded cleanly in `schema_migrations`.
2. **Region & Capacity Selection**:
   - Evaluate Neon regional availability (prioritize Singapore `ap-southeast-1` or Mumbai `ap-south-1` for lowest latency to India).
3. **Provisioning**:
   - Provision a dedicated Neon project (`dormex-prod` or `dormex-staging`).
   - Secure the pooled connection string (`sslmode=require`).
4. **Data Export & Restoration**:
   - Perform a clean schema and data dump of the existing PostgreSQL database:
     ```bash
     pg_dump --clean --if-exists -O -x "$SOURCE_DATABASE_URL" > dormex_backup.sql
     ```
   - Restore into Neon:
     ```bash
     psql "$NEON_DATABASE_URL" < dormex_backup.sql
     ```
   - Execute migration validation:
     ```bash
     npm run db:migrate
     ```
5. **Data & Schema Integrity Verification**:
   - Verify table row counts across all 33 tables against `src/db/schema_manifest.ts`.
   - Verify primary keys, foreign keys, and partial unique indexes (`uq_seat_current`, `uq_pool_one_turn`).
6. **Staging / Application Reconfiguration**:
   - Update Render Web Service environment variables (`DATABASE_URL`, `PG_SSL=true`, `PG_MAX_CONNECTIONS=20`).
   - Re-deploy Render service and verify `/health` and `/readyz` endpoints.
7. **Rollback Readiness**:
   - Keep the original Render PostgreSQL database intact and untouched during the observation window.
   - If an unexpected connection or data issue arises, revert `DATABASE_URL` back to the original database.
8. **Decommissioning**:
   - Only after 72 hours of stable operation and explicit approval from the project lead, decommission the old Render database.

> [!CAUTION]
> The project lead authorized recreating the Render Web Service if necessary to change deployment regions, but this **never authorizes deleting application source code, losing production data, or dropping the existing database prematurely**.

---

## F. DORMEX Governance & Security Invariants

All future code contributions must strictly honor these non-negotiable rules:
1. **Singleton Executive Authority**: The Chief Warden singleton (`ADM001` / `usr_adm001`) cannot be deleted, deactivated, or retired without explicit transfer.
2. **Building Isolation**: Wardens and Deputies cannot view or allocate seats outside their assigned residential building.
3. **Student Privacy**: Students can view only their own profile, allocation turn, and room assignments. Peer-room view is strictly controlled by cycle configuration (`OFF`, `AFTER_OWN_CONFIRM`, `LIVE`).
4. **Server-Authoritative Clock**: Client timestamps, browser timers, and client-supplied priority values are **completely untrusted**. All turn expirations and priority windows use PostgreSQL `CURRENT_TIMESTAMP`.
5. **Relational Invariant Protection**: Double-booking is physically prevented by PostgreSQL partial unique index `uq_seat_current ON allocations(seat_id) WHERE status = 'CURRENT'`.
6. **No Reintroduction of Deprecated Auth**: Do not reintroduce WebAuthn, passkeys, demo logins (`DEMO-001`), or mock credentials.
7. **No Concurrency Weakening**: Never downgrade database row locks (`FOR UPDATE`) or transaction isolation levels in pursuit of microsecond application latency.

---

## G. Next Development Phase: Phase 3

### Scope of Phase 3 (Student UI Waiting Room Experience & Live Telemetry)
*Status: PENDING EXPLICIT AUTHORIZATION (Do not start without approval)*

When authorized, Phase 3 will deliver:
1. **Student Waiting-Room View**:
   - Real-time display of admitted vs. waiting status.
   - Live telemetry feed reporting active participants (`totalAdmitted` out of 20) and waiting queue position.
   - Estimated wait time calculated dynamically based on remaining turn durations.
2. **Low-Overhead Live Updates**:
   - Implement Server-Sent Events (SSE) or lightweight live polling to replace aggressive browser interval spam.
3. **Push Notifications**:
   - Proactive notification alerts when a waiting candidate enters the top 5 queue positions.
4. **Privacy-Preserving UI**:
   - Display only aggregate counts and personal queue position; never leak identities or USNs of other waiting students.

---

## H. Instructions for the Next Developer / AI Agent

Before starting work:
1. **Read this `PROMPT.md` in its entirety.**
2. **Inspect Git status**: Ensure working tree is clean. Development occurs directly on local `main`.
3. **Inspect GitHub Issue #22**: Check whether Neon database provisioning is in progress or completed.
4. **Do not create arbitrary feature branches** unless directed by the project lead.
5. **Never expose credentials or private database connection strings** in commit history, PRs, issue comments, or artifacts.
6. **Provide evidence-based reports**: Always state the exact test execution engine (`pg-mem` vs. real PostgreSQL), sample sizes, and pass/fail/skip counts.
7. **Do NOT begin Phase 3 or destructive infrastructure operations without explicit user confirmation.**
