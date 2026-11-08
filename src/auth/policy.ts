export type SystemRole = 
  | 'STUDENT'
  | 'PROCTOR'
  | 'WARDEN'
  | 'DEPUTY_WARDEN'
  | 'CHIEF_WARDEN'
  | 'HOSTEL_OFFICE'
  | 'SUPER_ADMIN';

export type PermissionAction =
  | 'student.view_self'
  | 'student.manage'
  | 'student.edit_priority'
  | 'fee.verify'
  | 'terms.accept'
  | 'terms.manage'
  | 'inventory.view'
  | 'inventory.manage'
  | 'floor_plan.edit'
  | 'floor_plan.publish'
  | 'cycle.view'
  | 'cycle.manage'
  | 'cycle.publish'
  | 'allocation.join'
  | 'allocation.confirm'
  | 'allocation.override'
  | 'wishlist.manage'
  | 'roommate.manage'
  | 'recommendation.manage'
  | 'complaint.create'
  | 'complaint.vote'
  | 'complaint.manage'
  | 'complaint.view_private'
  | 'room_change.request'
  | 'room_change.review'
  | 'audit.view'
  | 'demo.access'
  | 'device.manage';

export interface AuthActor {
  id: string;
  college_id: string;
  full_name?: string;
  role: SystemRole;
  scope_type: 'SYSTEM' | 'BUILDING' | 'STUDENT';
  scope_id?: string | null;
  student_profile_id?: string | null;
}

export const ROLE_PERMISSIONS: Record<SystemRole, PermissionAction[]> = {
  STUDENT: [
    'student.view_self',
    'terms.accept',
    'inventory.view',
    'cycle.view',
    'allocation.join',
    'allocation.confirm',
    'wishlist.manage',
    'roommate.manage',
    'recommendation.manage',
    'complaint.create',
    'complaint.vote',
    'room_change.request',
  ],
  PROCTOR: [
    'inventory.view',
    'cycle.view',
  ],
  WARDEN: [
    'inventory.view',
    'inventory.manage',
    'cycle.view',
    'complaint.manage',
    'complaint.view_private',
    'room_change.review',
    'audit.view',
  ],
  DEPUTY_WARDEN: [
    'inventory.view',
    'inventory.manage',
    'cycle.view',
    'complaint.manage',
    'complaint.view_private',
    'room_change.review',
    'audit.view',
  ],
  CHIEF_WARDEN: [
    'inventory.view',
    'inventory.manage',
    'floor_plan.edit',
    'floor_plan.publish',
    'cycle.view',
    'cycle.manage',
    'cycle.publish',
    'allocation.override',
    'complaint.manage',
    'complaint.view_private',
    'room_change.review',
    'audit.view',
  ],
  HOSTEL_OFFICE: [
    'student.view_self',
    'student.manage',
    'student.edit_priority',
    'fee.verify',
    'terms.manage',
    'inventory.view',
    'inventory.manage',
    'floor_plan.edit',
    'floor_plan.publish',
    'cycle.view',
    'cycle.manage',
    'cycle.publish',
    'roommate.manage',
    'complaint.manage',
    'complaint.view_private',
    'room_change.review',
    'audit.view',
  ],
  SUPER_ADMIN: [
    'device.manage',
    'demo.access',
    'student.view_self',
    'student.manage',
    'student.edit_priority',
    'fee.verify',
    'terms.manage',
    'inventory.view',
    'inventory.manage',
    'floor_plan.edit',
    'floor_plan.publish',
    'cycle.view',
    'cycle.manage',
    'cycle.publish',
    'allocation.override',
    'roommate.manage',
    'complaint.manage',
    'complaint.view_private',
    'room_change.review',
    'audit.view',
  ],
};

export interface ResourceContext {
  resource_type: 'STUDENT' | 'BUILDING' | 'ROOM' | 'CYCLE' | 'COMPLAINT' | 'ALLOCATION' | 'SYSTEM';
  building_id?: string | null;
  student_id?: string | null;
  author_id?: string | null;
  proctor_user_id?: string | null;
  complaint_type?: 'PUBLIC' | 'PRIVATE';
  assigned_to?: string | null;
}

export function can(
  actor: AuthActor,
  action: PermissionAction,
  resource?: ResourceContext
): boolean {
  // 1. Check if actor's role has the requested action permission
  const permissions = ROLE_PERMISSIONS[actor.role] || [];
  if (!permissions.includes(action)) {
    return false;
  }

  // 2. Super Admin has full system scope (except allocation override still requires Super Admin role check)
  if (actor.role === 'SUPER_ADMIN') {
    return true;
  }

  // 3. Chief Warden has system-wide building scope
  if (actor.role === 'CHIEF_WARDEN') {
    return true;
  }

  // 4. Warden & Deputy Warden: Scope is strictly constrained to their assigned building
  if (actor.role === 'WARDEN' || actor.role === 'DEPUTY_WARDEN') {
    if (actor.scope_type === 'BUILDING' && resource?.building_id) {
      return actor.scope_id === resource.building_id;
    }
    // General queries within warden role are allowed if no specific mismatched building target
    return true;
  }

  // 5. Proctor: Transparent access to assigned students only, no allocation rights
  if (actor.role === 'PROCTOR') {
    if (resource?.resource_type === 'STUDENT' && resource.proctor_user_id) {
      return resource.proctor_user_id === actor.id;
    }
    return true;
  }

  // 6. Student: Cannot access other students' records or mutate outside their own profile
  if (actor.role === 'STUDENT') {
    if (resource?.student_id && actor.student_profile_id) {
      return resource.student_id === actor.student_profile_id;
    }
    if (resource?.author_id) {
      return resource.author_id === actor.id;
    }
  }

  return true;
}

export interface UserRoleRecord {
  id: string;
  college_id: string;
  full_name?: string;
  role_name: string;
  scope_type: string;
  scope_id?: string | null;
  profile_id?: string | null;
}

/**
 * Supported institutional roles
 */
export const VALID_SYSTEM_ROLES = new Set<string>([
  'STUDENT',
  'PROCTOR',
  'WARDEN',
  'DEPUTY_WARDEN',
  'CHIEF_WARDEN',
  'HOSTEL_OFFICE',
  'SUPER_ADMIN',
]);

/**
 * SEC-02: Policy-Backed Role/Scope Compatibility Matrix
 * Defines the allowed scope types and whether a non-empty scope_id is required.
 */
export const ROLE_SCOPE_COMPATIBILITY_MATRIX: Record<
  SystemRole,
  { allowedScopes: ('SYSTEM' | 'BUILDING' | 'STUDENT')[]; requiresScopeId: boolean }
> = {
  SUPER_ADMIN: {
    allowedScopes: ['SYSTEM'],
    requiresScopeId: false,
  },
  CHIEF_WARDEN: {
    allowedScopes: ['SYSTEM'],
    requiresScopeId: false,
  },
  HOSTEL_OFFICE: {
    allowedScopes: ['SYSTEM'],
    requiresScopeId: false,
  },
  WARDEN: {
    allowedScopes: ['BUILDING'],
    requiresScopeId: true, // A warden must be assigned to an explicit building
  },
  DEPUTY_WARDEN: {
    allowedScopes: ['BUILDING'],
    requiresScopeId: true, // A deputy warden must be assigned to an explicit building
  },
  PROCTOR: {
    allowedScopes: ['SYSTEM'],
    requiresScopeId: false,
  },
  STUDENT: {
    allowedScopes: ['STUDENT'],
    requiresScopeId: false,
  },
};

/**
 * Validates that a role and scope assignment strictly complies with institutional policy (SEC-02).
 */
export function validateRoleScopeCompatibility(
  roleName: string,
  scopeType: string,
  scopeId?: string | null
): void {
  if (!VALID_SYSTEM_ROLES.has(roleName)) {
    throw new Error(`ROLE_SCOPE_INCOMPATIBLE: Unrecognized or invalid institutional role '${roleName}'.`);
  }

  const role = roleName as SystemRole;
  const config = ROLE_SCOPE_COMPATIBILITY_MATRIX[role];

  if (!config.allowedScopes.includes(scopeType as any)) {
    throw new Error(
      `ROLE_SCOPE_INCOMPATIBLE: Role '${role}' cannot be assigned scope '${scopeType}'. Allowed scopes: [${config.allowedScopes.join(', ')}].`
    );
  }

  if (config.requiresScopeId && (!scopeId || typeof scopeId !== 'string' || scopeId.trim().length === 0)) {
    throw new Error(
      `ROLE_SCOPE_INCOMPATIBLE: Role '${role}' requires a non-empty building scope_id.`
    );
  }
}

/**
 * SEC-01: Validates role compatibility across all assigned roles for a single user.
 * Enforces Fail-Closed security:
 * 1. STUDENT must never coexist with administrative or staff roles.
 * 2. SUPER_ADMIN must never coexist with ordinary roles.
 * 3. Administrative roles cannot coexist if contradictory (e.g. WARDEN + CHIEF_WARDEN).
 * 4. Contradictory building assignments for WARDEN are rejected.
 */
export function assertRoleCompatibility(rows: UserRoleRecord[]): void {
  if (!rows || rows.length === 0) {
    throw new Error('UNAUTHORIZED: No active role assignments found for user.');
  }

  // 1. Verify every single role/scope pair individually
  for (const row of rows) {
    validateRoleScopeCompatibility(row.role_name, row.scope_type, row.scope_id);
  }

  // Deduplicate identical role assignments (idempotent duplicate rows)
  const uniqueRolePairs = new Map<string, UserRoleRecord>();
  for (const row of rows) {
    const key = `${row.role_name}:${row.scope_type}:${row.scope_id || ''}`;
    uniqueRolePairs.set(key, row);
  }

  const distinctRecords = Array.from(uniqueRolePairs.values());
  const distinctRoleNames = Array.from(new Set(distinctRecords.map((r) => r.role_name)));

  // If user only has one distinct role name (or multiple identical rows)
  if (distinctRoleNames.length === 1) {
    const singleRole = distinctRoleNames[0];
    if ((singleRole === 'WARDEN' || singleRole === 'DEPUTY_WARDEN') && distinctRecords.length > 1) {
      // Multiple building assignments for a single Warden/Deputy Warden must be rejected (no ambiguous collapsing)
      throw new Error(
        `AUTHORIZATION_CONFLICT: Contradictory building scopes detected for ${singleRole}. An administrator cannot be assigned to multiple disjoint buildings simultaneously without explicit administrative consolidation.`
      );
    }
    return;
  }

  // Multiple distinct role names present: evaluate institutional incompatibility
  const hasStudent = distinctRoleNames.includes('STUDENT');
  const hasSuperAdmin = distinctRoleNames.includes('SUPER_ADMIN');
  const hasStaff = distinctRoleNames.some((r) =>
    ['CHIEF_WARDEN', 'HOSTEL_OFFICE', 'WARDEN', 'DEPUTY_WARDEN', 'PROCTOR'].includes(r)
  );

  if (hasStudent && (hasSuperAdmin || hasStaff)) {
    throw new Error(
      `AUTHORIZATION_CONFLICT: Incompatible role assignments detected. Student accounts cannot coexist with administrative roles (${distinctRoleNames.join(', ')}). Authentication refused.`
    );
  }

  if (hasSuperAdmin && (hasStudent || hasStaff)) {
    throw new Error(
      `AUTHORIZATION_CONFLICT: Incompatible role assignments detected. Root SUPER_ADMIN identity cannot coexist with ordinary operational roles (${distinctRoleNames.join(', ')}). Authentication refused.`
    );
  }

  // Any other combination of distinct institutional roles is also contradictory in the single-actor model
  throw new Error(
    `AUTHORIZATION_CONFLICT: Incompatible role assignments detected (${distinctRoleNames.join(', ')}). Accounts must hold a single unambiguous institutional role.`
  );
}

/**
 * Resolves a single authoritative AuthActor deterministically from a user's database role records.
 * Invariants:
 * 1. Throws if no role assignments exist.
 * 2. Validates role/scope compatibility for every record (SEC-02).
 * 3. Enforces strict fail-closed role compatibility (SEC-01).
 * 4. Preserves exact role-to-scope binding without arbitrary privilege escalation.
 */
export function resolveAuthoritativeActor(rows: UserRoleRecord[]): AuthActor {
  if (!rows || rows.length === 0) {
    throw new Error('UNAUTHORIZED: No active role assignments found for user.');
  }

  // Enforce fail-closed compatibility check across all records
  assertRoleCompatibility(rows);

  // The records are guaranteed compatible and homogeneous
  const primary = rows[0];

  return {
    id: primary.id,
    college_id: primary.college_id,
    full_name: primary.full_name,
    role: primary.role_name as SystemRole,
    scope_type: primary.scope_type as 'SYSTEM' | 'BUILDING' | 'STUDENT',
    scope_id: primary.scope_id || null,
    student_profile_id: primary.profile_id || null,
  };
}
