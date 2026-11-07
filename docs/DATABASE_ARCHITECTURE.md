# DORMEX — Database Architecture & Schema Reference

## 1. Overview
DORMEX uses **PostgreSQL 16** as its relational source of truth. All critical business invariants (single-seat occupancy, priority uniqueness, turn expiry, fee validation) are enforced at the database layer via relational foreign keys, check constraints, and partial unique indexes.

---

## 2. Relational Schema Invariants

### A. Foundational Tables (33 Total)
1. **`users`**: Institutional identity (college ID, email, password hash, status).
2. **`roles`**: System roles (`STUDENT`, `PROCTOR`, `WARDEN`, `CHIEF_WARDEN`, `HOSTEL_OFFICE`, `SUPER_ADMIN`).
3. **`permissions` & `role_permissions`**: Granular capability mappings.
4. **`user_roles`**: User role assignments with scope boundaries (`SYSTEM`, `BUILDING`, `STUDENT`).
5. **`student_profiles`**: Academic year, quota category, eligibility status, admission priority rank, and guardian details.
6. **`buildings`**: Hostel blocks (e.g. BVB Block) with gender designation and floor count.
7. **`floors`**: Floor numbering and label metadata.
8. **`floor_maps`**: Canonical SVG layout, viewBox, canvas dimensions, and interactive coordinate maps.
9. **`floor_map_drafts`**: Draft states for unpublished floor plan modifications.
10. **`rooms`**: Room numbers, room types (Single, Double, Triple), wing designation, and base capacity.
11. **`seats`**: Individual physical beds/desks with status (`AVAILABLE`, `ALLOCATED`, `LOCKED`, `MAINTENANCE`).
12. **`allocation_cycles`**: Turn-based allocation periods with phase lifecycle (`PENDING`, `ACTIVE`, `PAUSED`, `COMPLETED`, `ARCHIVED`).
13. **`allocation_pools`**: Cohort pools partitioned by quota, academic year, and gender.
14. **`waiting_room_entries`**: Active student waiting queue ordered by assigned priority rank and join timestamp.
15. **`booking_sessions`**: Active student turns with server-authoritative timer expiration.
16. **`allocations`**: Finalized room assignments linking student profile, seat ID, and allocation cycle.
17. **`roommate_groups` & `roommate_group_members`**: Pre-allocation group matching and mutual invitation state.
18. **`room_wishlists`**: Student room preference ranking.
19. **`complaints` & `complaint_votes`**: Student grievance logging and upvoting desk.
20. **`room_change_requests`**: 48-hour post-allocation swap/change requests.
21. **`audit_logs`**: Immutable security audit trail recording actor ID, action, before/after JSON states, and correlation IDs.
22. **`outbox_events`**: Transactional outbox for guaranteed event publishing.
23. **`notifications` & `user_notification_reads`**: Announcement broadcast and student notification feeds.
24. **`terms_documents` & `terms_acknowledgements`**: Versioned institutional responsibility accord agreements.
25. **`password_reset_tokens`**: SHA-256 single-use cryptographic recovery tokens.
26. **`weekly_mess_menus` & `mess_feedback`**: Daily meal schedules and student dietary satisfaction tracking.
27. **`schema_migrations`**: Migration history tracking executed manifests.

---

## 3. Concurrency & Integrity Safeguards

- **Partial Unique Indexes**:
  ```sql
  CREATE UNIQUE INDEX IF NOT EXISTS uq_active_seat_allocation 
  ON allocations(seat_id) 
  WHERE status = 'ACTIVE';
  ```
  Guarantees that no single seat can ever be double-booked by two concurrent transactions.
- **Batch-Scoped Admission Priority**:
  ```sql
  CREATE UNIQUE INDEX IF NOT EXISTS uq_student_batch_priority 
  ON student_profiles(admission_batch_year, assigned_priority) 
  WHERE assigned_priority IS NOT NULL;
  ```
- **Transaction Rollbacks**: All multi-step allocations execute inside atomic `transaction(client => ...)` blocks. If a seat reservation fails or conflicts, the entire transaction rolls back cleanly without partial writes.

---

## 4. Migration Mechanics

Migrations are declared as structured manifests in [`src/db/migrate.ts`](../src/db/migrate.ts) and reconciled using `src/db/schema.ts` against `schema_migrations`.
- To reconcile migrations:
  ```bash
  npm run dev
  # Or run dedicated migration reconciliation
  npx tsx scripts/bootstrap-super-admin.ts
  ```
