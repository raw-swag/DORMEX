export type SystemRole = 
  | 'STUDENT'
  | 'PROCTOR'
  | 'WARDEN'
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

  // 4. Warden: Scope is strictly constrained to their assigned building
  if (actor.role === 'WARDEN') {
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
 * Deterministic role hierarchy rank (lower number = higher authoritative precedence).
 * Super Admin > Chief Warden > Hostel Office > Warden > Proctor > Student
 */
export const ROLE_HIERARCHY_RANK: Record<string, number> = {
  SUPER_ADMIN: 1,
  CHIEF_WARDEN: 2,
  HOSTEL_OFFICE: 3,
  WARDEN: 4,
  PROCTOR: 5,
  STUDENT: 6,
};

/**
 * Resolves a single authoritative AuthActor deterministically from a user's database role records.
 * Invariants:
 * 1. Throws if no role assignments exist.
 * 2. If multiple roles are assigned, sorts deterministically by canonical institutional precedence:
 *    SUPER_ADMIN > CHIEF_WARDEN > HOSTEL_OFFICE > WARDEN > PROCTOR > STUDENT.
 * 3. Scope precedence: If same role is assigned with different scopes, SYSTEM takes precedence over BUILDING or STUDENT.
 * 4. Ensures no accidental privilege loss or undefined role selection.
 */
export function resolveAuthoritativeActor(rows: UserRoleRecord[]): AuthActor {
  if (!rows || rows.length === 0) {
    throw new Error('UNAUTHORIZED: No active role assignments found for user');
  }

  // Sort rows deterministically: highest privilege rank first, then SYSTEM scope first, then role ID
  const sorted = [...rows].sort((a, b) => {
    const rankA = ROLE_HIERARCHY_RANK[a.role_name] ?? 99;
    const rankB = ROLE_HIERARCHY_RANK[b.role_name] ?? 99;
    if (rankA !== rankB) return rankA - rankB;

    // Scope tie-breaker: SYSTEM (0) > BUILDING (1) > STUDENT (2)
    const scopeRank = (s: string) => (s === 'SYSTEM' ? 0 : s === 'BUILDING' ? 1 : 2);
    const scopeA = scopeRank(a.scope_type);
    const scopeB = scopeRank(b.scope_type);
    if (scopeA !== scopeB) return scopeA - scopeB;

    return (a.id || '').localeCompare(b.id || '');
  });

  const primary = sorted[0];

  const validScopeType = (
    primary.scope_type === 'SYSTEM' || primary.scope_type === 'BUILDING' || primary.scope_type === 'STUDENT'
      ? primary.scope_type
      : 'SYSTEM'
  ) as 'SYSTEM' | 'BUILDING' | 'STUDENT';

  return {
    id: primary.id,
    college_id: primary.college_id,
    full_name: primary.full_name,
    role: primary.role_name as SystemRole,
    scope_type: validScopeType,
    scope_id: primary.scope_id || null,
    student_profile_id: primary.profile_id || null,
  };
}
