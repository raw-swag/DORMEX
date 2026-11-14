# AGENTS.MD — Development, Documentation & Commit Protocol

Welcome to **DORMEX**. This document is a strict, binding guide for all autonomous agents and developers contributing to this codebase.

---

## 1. Golden Rules of Contribution

1. **Development Directly on Local `main`**:
   - All development work happens directly on the local `main` branch.
   - Do NOT create arbitrary feature branches unless explicitly directed by the project lead.
   - Always fetch, inspect, and safely integrate contributor changes before starting new work.
   - Never discard or overwrite teammate work.
   - **No remote push or deployment without explicit authorization**.

2. **Real Institutional Identity & Authoritative Backend**:
   - DORMEX is an institutional hostel management system operating on real institutional student population data.
   - The `students` table uses **`usn`** as its **PRIMARY KEY** (format `1SI25<branch>XYZ` where `25` is admission year).
   - A yearwise priority tracking table (`student_year_priority`) manages queue priority by academic year, building, and semester.
   - No hardcoded demo identities (`DEMO-001`, `OFF001`, `ADM001`) in application logic or business rules.
   - No mock data or fake success responses presented as real institutional operations.
   - Backend PostgreSQL is strictly authoritative for permissions, eligibility, allocation, booking, and state transitions.

3. **Database Rules & Data Safety**:
   - Migrations must be versioned, reviewed, idempotent, and reversible where practical.
   - Never silently delete institutional records.
   - Preserve foreign-key integrity at all times.
   - Multi-record workflows must execute within PostgreSQL transactions (`BEGIN ... COMMIT`).
   - Explicitly handle concurrent requests and conflicts using row locks (`FOR UPDATE`) and database unique constraints.
   - Never log passwords, tokens, secrets, or sensitive student PII.

4. **Documentation is Completely Unavoidable**:
   - Before any commit is created, documentation **must** be checked and updated.
   - If an API or schema changes, update [`README.md`](./README.md) and [`docs/features.md`](./docs/features.md) / [`docs/system_design.md`](./docs/system_design.md).
   - Milestone progress **must** be recorded in [`docs/implementation-status.md`](./docs/implementation-status.md).
   - Every single meaningful change **must** be logged in [`CHANGELOG.md`](./CHANGELOG.md).

5. **Mandatory Verification Before Every Commit**:
   - Automated tests must run and achieve a 100% pass rate: `npm test`.
   - TypeScript must pass without type errors: `npm run typecheck`.
   - Server build must succeed cleanly: `npm run build:server`.
   - Client build must succeed cleanly: `npm run build:client`.

---

## 2. Commit Message Style (Conventional Commits)

We enforce standard **Conventional Commits**:

```text
<type>(<scope>): <short imperative description>

[optional body explaining rationale and non-obvious details]

[optional footer(s)]
```

### Allowed Types:
- `feat`: A new feature (e.g. `feat(student): real USN primary key schema and yearwise priority`)
- `fix`: A bug fix (e.g. `fix(db): handle idle client errors in pg pool`)
- `docs`: Documentation updates only (e.g. `docs(status): document phase 46 migration`)
- `test`: Adding or updating test cases (e.g. `test(disjoint): add pool inventory conflict test`)
- `refactor`: Code changes that neither fix a bug nor add a feature
- `perf`: Performance optimizations
- `chore`: Build tasks, package updates, configuration adjustments

---

## 3. Pre-Commit Checklist for Agents

Before running `git commit`, execute this exact mental checklist:

```text
[ ] 1. Did I modify or add backend/frontend features or invariants?
[ ] 2. Did I update CHANGELOG.md with clear bullet points under the active version?
[ ] 3. Did I update docs/implementation-status.md with the completed phase / details?
[ ] 4. Did I verify all automated tests with `npm test`?
[ ] 5. Did I run `npm run typecheck` to ensure 0 TypeScript errors?
[ ] 6. Did I run `npm run build:server` and `npm run build:client` cleanly?
[ ] 7. Am I on local `main` with clean working tree?
[ ] 8. Commit with conventional commit message.
[ ] 9. Do NOT push without explicit user request.
```

---

## 4. Architectural Boundaries

- **Modular Monolith**: Respect domain boundaries:
  - `src/auth`: Policy and authorization (`can(actor, action, resource)`).
  - `src/student`: Institutional registry, real USN profiles, and yearwise priority eligibility.
  - `src/allocation`: Server-authoritative turn scheduling and seat confirmation transactions.
  - `src/inventory`: Buildings, floors, SVG maps, room definitions, and seats.
  - `src/preferences`: Room wishlists and one-hop recommendation invites.
  - `src/operations`: Complaints desk and 48-hour room change requests.
  - `src/db`: Relational PostgreSQL schema migrations, pool connection management, and seed data.
- **Client Clocks are Untrusted**: Never trust client timestamps or client-supplied priorities for turns, expirations, or eligibility.
- **Relational Source of Truth**: All invariants must be backed by PostgreSQL relational constraints and partial unique indexes.
