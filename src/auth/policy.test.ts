import { describe, it, expect } from 'vitest';
import {
  resolveAuthoritativeActor,
  validateRoleScopeCompatibility,
  assertRoleCompatibility,
  ROLE_SCOPE_COMPATIBILITY_MATRIX,
  UserRoleRecord,
} from './policy.js';

describe('Role & Scope Compatibility and Invariant Validation', () => {
  it('accepts canonical institutional role-to-scope pairs', () => {
    expect(() => validateRoleScopeCompatibility('STUDENT', 'STUDENT', null)).not.toThrow();
    expect(() => validateRoleScopeCompatibility('SUPER_ADMIN', 'SYSTEM', null)).not.toThrow();
    expect(() => validateRoleScopeCompatibility('CHIEF_WARDEN', 'SYSTEM', null)).not.toThrow();
    expect(() => validateRoleScopeCompatibility('HOSTEL_OFFICE', 'SYSTEM', null)).not.toThrow();
    expect(() => validateRoleScopeCompatibility('PROCTOR', 'SYSTEM', null)).not.toThrow();
    expect(() => validateRoleScopeCompatibility('WARDEN', 'BUILDING', 'bld_bvb')).not.toThrow();
  });

  it('rejects anomalous or illegal role-to-scope assignments (SEC-02)', () => {
    // WARDEN must have BUILDING scope and non-empty building ID
    expect(() => validateRoleScopeCompatibility('WARDEN', 'SYSTEM', null)).toThrowError(
      /ROLE_SCOPE_INCOMPATIBLE: Role 'WARDEN' cannot be assigned scope 'SYSTEM'/
    );
    expect(() => validateRoleScopeCompatibility('WARDEN', 'BUILDING', null)).toThrowError(
      /ROLE_SCOPE_INCOMPATIBLE: Role 'WARDEN' requires a non-empty building scope_id/
    );

    // STUDENT must have STUDENT scope
    expect(() => validateRoleScopeCompatibility('STUDENT', 'SYSTEM', null)).toThrowError(
      /ROLE_SCOPE_INCOMPATIBLE: Role 'STUDENT' cannot be assigned scope 'SYSTEM'/
    );

    // SUPER_ADMIN must have SYSTEM scope
    expect(() => validateRoleScopeCompatibility('SUPER_ADMIN', 'BUILDING', 'bld_1')).toThrowError(
      /ROLE_SCOPE_INCOMPATIBLE: Role 'SUPER_ADMIN' cannot be assigned scope 'BUILDING'/
    );
  });

  it('enforces fail-closed multi-role conflict rejection (SEC-01)', () => {
    // STUDENT + SUPER_ADMIN
    const studentSuperAdmin: UserRoleRecord[] = [
      { id: 'u1', college_id: 'C1', role_name: 'STUDENT', scope_type: 'STUDENT' },
      { id: 'u1', college_id: 'C1', role_name: 'SUPER_ADMIN', scope_type: 'SYSTEM' },
    ];
    expect(() => resolveAuthoritativeActor(studentSuperAdmin)).toThrowError(
      /AUTHORIZATION_CONFLICT: Incompatible role assignments detected/
    );

    // STUDENT + CHIEF_WARDEN
    const studentChiefWarden: UserRoleRecord[] = [
      { id: 'u2', college_id: 'C2', role_name: 'STUDENT', scope_type: 'STUDENT' },
      { id: 'u2', college_id: 'C2', role_name: 'CHIEF_WARDEN', scope_type: 'SYSTEM' },
    ];
    expect(() => resolveAuthoritativeActor(studentChiefWarden)).toThrowError(
      /AUTHORIZATION_CONFLICT: Incompatible role assignments detected/
    );

    // STUDENT + HOSTEL_OFFICE
    const studentOffice: UserRoleRecord[] = [
      { id: 'u3', college_id: 'C3', role_name: 'STUDENT', scope_type: 'STUDENT' },
      { id: 'u3', college_id: 'C3', role_name: 'HOSTEL_OFFICE', scope_type: 'SYSTEM' },
    ];
    expect(() => resolveAuthoritativeActor(studentOffice)).toThrowError(
      /AUTHORIZATION_CONFLICT: Incompatible role assignments detected/
    );

    // STUDENT + WARDEN
    const studentWarden: UserRoleRecord[] = [
      { id: 'u4', college_id: 'C4', role_name: 'STUDENT', scope_type: 'STUDENT' },
      { id: 'u4', college_id: 'C4', role_name: 'WARDEN', scope_type: 'BUILDING', scope_id: 'bld_1' },
    ];
    expect(() => resolveAuthoritativeActor(studentWarden)).toThrowError(
      /AUTHORIZATION_CONFLICT: Incompatible role assignments detected/
    );

    // SUPER_ADMIN + ordinary administrative role (must not mask anomaly)
    const superAdminWarden: UserRoleRecord[] = [
      { id: 'u5', college_id: 'C5', role_name: 'SUPER_ADMIN', scope_type: 'SYSTEM' },
      { id: 'u5', college_id: 'C5', role_name: 'WARDEN', scope_type: 'BUILDING', scope_id: 'bld_1' },
    ];
    expect(() => resolveAuthoritativeActor(superAdminWarden)).toThrowError(
      /AUTHORIZATION_CONFLICT: Incompatible role assignments detected/
    );
  });

  it('rejects contradictory multi-building scopes for WARDEN (SEC-02)', () => {
    const multiBuildingWarden: UserRoleRecord[] = [
      { id: 'u6', college_id: 'C6', role_name: 'WARDEN', scope_type: 'BUILDING', scope_id: 'bld_a' },
      { id: 'u6', college_id: 'C6', role_name: 'WARDEN', scope_type: 'BUILDING', scope_id: 'bld_b' },
    ];
    expect(() => resolveAuthoritativeActor(multiBuildingWarden)).toThrowError(
      /AUTHORIZATION_CONFLICT: Contradictory building scopes detected for WARDEN/
    );
  });

  it('allows duplicate identical role/scope assignments idempotently', () => {
    const duplicates: UserRoleRecord[] = [
      { id: 'u7', college_id: 'C7', role_name: 'HOSTEL_OFFICE', scope_type: 'SYSTEM' },
      { id: 'u7', college_id: 'C7', role_name: 'HOSTEL_OFFICE', scope_type: 'SYSTEM' },
    ];
    const actor = resolveAuthoritativeActor(duplicates);
    expect(actor.role).toBe('HOSTEL_OFFICE');
    expect(actor.scope_type).toBe('SYSTEM');
  });

  it('rejects empty or malformed role data', () => {
    expect(() => resolveAuthoritativeActor([])).toThrowError(/No active role assignments found/);
    expect(() => resolveAuthoritativeActor([{ id: 'u8', college_id: 'C8', role_name: 'HACKER' as any, scope_type: 'SYSTEM' }])).toThrowError(
      /ROLE_SCOPE_INCOMPATIBLE: Unrecognized or invalid institutional role/
    );
  });
});
