# DORMEX Full-Stack Architecture, Modularization & Scalability Specification

## 1. Executive System Map

DORMEX is architected as a **Modular Relational Monolith**. It balances server-authoritative institutional invariants with a responsive, offline-tolerant mobile client.

```mermaid
flowchart TD
    subgraph Client_Layer["Frontend Client Architecture (src/client)"]
        UI_Shell["App Shell & Navigation (MobileBottomNav / AppLayout)"]
        State_Ctx["AuthContext & PWAInstallContext"]
        API_Layer["Centralized API Client (src/client/api/client.ts)"]
        Views["Domain Feature Views (Allocation, Complaints, Registry, Governance)"]
        UI_Shell --> State_Ctx
        Views --> API_Layer
        API_Layer --> State_Ctx
    end

    subgraph Transport_Layer["API Gateway & Reverse Proxy"]
        Vercel_Rewrite["vercel.json (/api/* rewrite)"]
        Fastify_App["Fastify HTTP Core (src/app.ts & src/server.ts)"]
        Vercel_Rewrite --> Fastify_App
    end

    subgraph Backend_Modules["Modular Monolith Domains (src/)"]
        Auth_Mod["Auth & Policy (src/auth/)<br/>- RBAC Actor Resolution<br/>- WebAuthn Hardware Binding (3 Slots)"]
        Gov_Mod["Institutional Governance (src/auth/governanceService.ts)<br/>- Singleton Chief Warden<br/>- Downward Authority Cascades"]
        Alloc_Mod["Allocation Engine (src/allocation/)<br/>- Turn Scheduling & FIFO Slots<br/>- Atomic Seat Reservations"]
        Inv_Mod["Inventory & Maps (src/inventory/)<br/>- Wings, CAD SVG Telemetry"]
        Ops_Mod["Operations (src/operations/ & src/notifications/)<br/>- Complaints Desk<br/>- Mess Menus & Noticeboard"]
        Config_Mod["Runtime Config (src/config/)<br/>- Type-Safe Environment Validation"]
    end

    subgraph Database_Layer["PostgreSQL Relational Core (src/db)"]
        PG_Pool["PostgresDatabaseService (pg.Pool)"]
        PG_Invariants["Relational Integrity & Partial Unique Indexes<br/>- Row-Level Immutability Triggers<br/>- Multi-Role Constraints"]
    end

    API_Layer -->|HTTPS (Relative /api/*)| Vercel_Rewrite
    Fastify_App --> Auth_Mod
    Fastify_App --> Gov_Mod
    Fastify_App --> Alloc_Mod
    Fastify_App --> Inv_Mod
    Fastify_App --> Ops_Mod
    Auth_Mod --> PG_Pool
    Gov_Mod --> PG_Pool
    Alloc_Mod --> PG_Pool
    Inv_Mod --> PG_Pool
    Ops_Mod --> PG_Pool
    PG_Pool --> PG_Invariants
```

---

## 2. Backend Architecture & Domain Modularization

### A. Core Domain Responsibilities
1. **`src/auth` (Authentication, Policy & Hardware Authorization)**:
   - Server-authoritative actor resolution (`resolveAuthoritativeActor`). Resolves database roles, appointments, and building scopes per request.
   - WebAuthn hardware device assertion: Strictly restricts hardware authentication to predefined slots `SLOT_01`, `SLOT_02`, and `SLOT_03`.
2. **`src/auth/governanceService` (Institutional Governance)**:
   - Anchored to the `institutional_governance` singleton (`singleton_id = 1`).
   - Enforces downward-only authority cascades: Supervising Wardens manage Deputy Wardens within their assigned building; Deputy Wardens cannot revoke or review Wardens; Chief Warden maintains institution-wide oversight.
3. **`src/allocation` (Allocation & Turn Engine)**:
   - Enforces server-authoritative turn scheduling and atomic seat confirmation. Client clocks are untrusted.
4. **`src/config` (Runtime Configuration)**:
   - Evaluates `NODE_ENV`, `DATABASE_URL`, `JWT_SECRET`, and allowed CORS origins at startup. Fails fast with safe diagnostics that never print secrets.

---

## 3. Frontend Architecture & Client Infrastructure

### A. Centralized API Layer (`src/client/api/client.ts`)
Previously, direct `fetch` and `apiFetch` calls were scattered across components, resulting in duplicated error-handling logic and inconsistent response parsing. The new `requestJson` abstraction provides:
- Uniform JSON header injection (`Accept`, `Content-Type`).
- Structured `ApiError` hierarchy carrying HTTP status codes and backend error payloads.
- Graceful handling of empty responses (`204 No Content`).
- Modular domain clients: `AuthApiClient`, `InventoryApiClient`, `GovernanceApiClient`, `NotificationsApiClient`, and `MessMenuApiClient`.

### B. Route & Navigation Contracts
- Routes are organized into responsive, mobile-first workspaces.
- Access to administrative consoles is gated on live JWT verification and server-authoritative actor roles (`/api/auth/me`).

---

## 4. Database Architecture & Scalability Assessment (10k Students / 100 Buildings)

| Domain | Scalability Finding | Production Protection & Mitigation |
| :--- | :--- | :--- |
| **Turn Engine & Slots** | High write concurrency during turn advance | Relational locks (`SELECT FOR UPDATE`) on pool inventories and waiting room entries guarantee zero double-allocation. |
| **Audit Ledger** | Rapidly growing event tables (`audit_logs`, `governance_action_events`) | Append-only triggers (`trg_prevent_audit_tampering`) guarantee tamper resistance. Recommended partitioning by academic year (`created_at`) when logs exceed 1M rows. |
| **Building Telemetry** | 100+ SVG floor maps | Floor map geometry is stored as versioned JSON/SVG in `floor_maps` and cached per building, minimizing database roundtrips. |
| **Connection Pooling** | Render managed PostgreSQL connection limits | `pg.Pool` configured with explicit timeouts (`PG_IDLE_TIMEOUT_MS`, `PG_CONNECTION_TIMEOUT_MS`) and default pool size (20 connections). |

---

## 5. Security Invariants Checklist

- [x] Exactly three authorized hardware device slots (`SLOT_01`, `SLOT_02`, `SLOT_03`).
- [x] Zero hard-coded credentials or fake demo modes in frontend bundles.
- [x] All 18 canonical demo accounts provisioned and database-backed.
- [x] Downward-only institutional governance hierarchy strictly enforced server-side.
- [x] Immutable audit logs protected against `UPDATE` and `DELETE`.
