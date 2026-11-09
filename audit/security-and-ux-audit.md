# DORMEX Security and UX Audit Findings

Date: 2026-11-09  
Branch: `audit/dormex-review`

---

## 1. Cross-Site Scripting (XSS)
- **Status**: Clean / Verified Safe.
- **Evidence**:
  - Global codebase search across `src/client/**/*.tsx` and `src/client/**/*.ts` for `dangerouslySetInnerHTML`: **0 occurrences**.
  - React's default virtual DOM JSX escaping is respected across all student, admin, complaints, and mess menu components.
  - SVG floor maps (`FloorPlanEditor.tsx`, `StudentAllocationView.tsx`) are constructed using React native SVG elements (`<svg>`, `<rect>`, `<path>`, `<text>`) and sanitized attributes without raw inner HTML injection.

---

## 2. Exposed Secrets & Environment Files
- **Status**: Clean / Compliant.
- **Evidence**:
  - Execution of `git ls-files | grep -i env` yields:
    - `.env.example`
    - `docs/ENVIRONMENT_VARIABLES.md`
    - `docs/environment-and-secrets.md`
    - `tests/environment_and_secret_management.test.ts`
  - No `.env` or production credentials/certificates are tracked in the repository.

---

## 3. Rate Limiting
- **Status**: Partially Implemented (WebAuthn / Passkey auth limited; general HTTP API unthrottled).
- **Evidence**:
  - In `src/auth/deviceAuthService.ts` (lines 106-131), IP-based rate limiting (`checkRateLimit`, `recordAttempt`, `clearRateLimit`) is enforced on WebAuthn assertion options and verification attempts with temporary lockouts.
  - Core API routes in `src/app.ts` (`/api/students`, `/api/allocation-cycles`, `/api/booking-sessions/:id/confirm-seat`) currently do not mount a global rate-limiting plugin (such as `@fastify/rate-limit`). High-volume bursts rely on database serialization transactions.

---

## 4. Role & Permission Checks on Non-Login API Routes
- **Status**: Secure Server-Side Guards with Targeted Exceptions.
- **Evidence**:
  - Governance endpoints (`/api/governance/*`, lines 1599-1747 in `src/app.ts`) rigorously resolve the caller's database actor and enforce downward hierarchy checks via `GovernanceService`.
  - Admin overview (`/api/admin/overview`, line 490) and audit logs (`/api/admin/audit-logs`, line 903) verify JWT authentication and restrict access to privileged roles (`ADMIN`, `CHIEF_WARDEN`, `SUPER_ADMIN`).
  - Read-only catalog endpoints (`/api/buildings`, `/api/buildings/:id/floors`, `/api/floors/:id/rooms`, `/api/floors/:id/svg`) are accessible without authentication to allow pre-login campus visualization.
  - Seat confirmation (`/api/booking-sessions/:id/confirm-seat`, line 878) strictly requires an active authenticated booking turn and verifies token subject matches the student seat applicant.

---

## 5. Mobile UX: Keyboard Overlap on Form Inputs
- **Status**: Addressed via Safe-Area & Dynamic Viewport Heights (`dvh`).
- **Evidence**:
  - Modals and bottom sheets across `StudentAllocationView.tsx` (lines 1392-1432), `AdminDashboard.tsx` (lines 1259, 1357, 1405), and `ComplaintsView.tsx` (lines 269, 380) utilize `max-h-[90dvh] overflow-y-auto` paired with `pb-[calc(1.25rem+env(safe-area-inset-bottom,0px))]`.
  - Virtual keyboard appearance triggers viewport resize smoothly without inputs becoming hidden beneath screen edges or navigation bars.

---

## 6. Accessibility: `prefers-reduced-motion`
- **Status**: Needs Global CSS Token Integration.
- **Evidence**:
  - Searching for `prefers-reduced-motion` or Tailwind `motion-reduce` across `src/client/` yields **0 occurrences**.
  - While CSS animations (`animate-fadeIn`, `animate-spin`) are restrained and subtle, an explicit media query `@media (prefers-reduced-motion: reduce) { *, ::before, ::after { animation-duration: 0.01ms !important; animation-iteration-count: 1 !important; transition-duration: 0.01ms !important; } }` in `index.css` is recommended.

---

## 7. Touch & Mouse: Hover-Only Interactions
- **Status**: Touch-Accessible with Tactile Fallbacks.
- **Evidence**:
  - All room beds and interactive floor map elements support explicit touch click/tap handlers (`onClick` / `onTouchStart`), triggering bottom sheet inspectors (`MobileInspectorBottomSheet.tsx`) on mobile devices.
  - Hover utility classes (`hover:bg-slate-50`, `hover:text-[#203653]`) provide desktop micro-feedback and do not gate primary allocation or submission actions.

---

## 8. State Feedback: Loading, Empty, and Error States
- **Status**: Comprehensive across Student and Admin portals.
- **Evidence**:
  - Dynamic route views are protected by `ChunkLoadErrorBoundary` with a mobile-friendly retry interface and accessible spinning loader fallback in `App.tsx`.
  - Tables and lists in `StudentRegistryView.tsx`, `ComplaintsView.tsx`, and `MessMenuView.tsx` render clear empty states (`No records found`, `No active complaints`, `No menu published`) with iconography.

---

## 9. Form Validation & User Messages
- **Status**: Inline Error Feedback & Server Toast Sync.
- **Evidence**:
  - Forms validate required fields (e.g., student profile, room change rationale, complaint descriptions) with visual red borders and assistive text before submission.
  - Backend validation errors (e.g. 400 Bad Request, turn expired) are caught and surfaced via notification banners or modal alerts.

---

## 10. Color Contrast on Non-Login Screens
- **Status**: High Contrast adhering to WCAG 2.1 AA.
- **Evidence**:
  - Primary text uses `#181C1E` / `#07203C` on white or `#F0F4F6` backgrounds (contrast ratio > 11:1).
  - Primary interactive accents use Deep Teal `#016A62` and `#2C8279` on white backgrounds (contrast ratio > 4.5:1), ensuring readability on low-brightness mobile displays.
