import { DatabaseService } from '../db/index.js';
import { AuthActor, can } from '../auth/policy.js';

/**
 * Institutional USN pattern: 1SI<2-digit admission year><2-letter branch code><3-digit sequence>
 * Example: 1SI25CS001, 1SI25EC042, 1SI25AI005
 * Note: '25' represents the admission year 2025.
 */
export const INSTITUTIONAL_USN_REGEX = /^1SI(\d{2})([A-Z]{2})(\d{3})$/i;

export interface StudentRecord {
  usn: string;
  user_id: string;
  full_name: string;
  email: string;
  phone?: string | null;
  admission_year: number;
  branch: string;
  academic_year: number;
  current_semester: number;
  gender: 'MALE' | 'FEMALE' | 'OTHER';
  account_status: 'ACTIVE' | 'DEACTIVATED' | 'SUSPENDED';
  eligibility_status: 'PENDING' | 'ELIGIBLE' | 'INELIGIBLE' | 'FEE_PENDING';
  created_at?: string;
  updated_at?: string;
}

export interface StudentYearPriorityRecord {
  id: string;
  student_usn: string;
  academic_year: number;
  building_id?: string | null;
  semester?: number | null;
  assigned_priority: number;
  priority_source: 'AUTOMATIC_FEE' | 'MANUAL' | 'OVERRIDE';
  override_reason?: string | null;
  assigned_by?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface BuildingEligibilityPolicy {
  id: string;
  building_id: string;
  academic_year?: number | null;
  admission_year?: number | null;
  branch?: string | null;
  gender?: string | null;
  quota_category?: string | null;
  student_usn?: string | null; // USN-specific rule / override
  policy_type: 'GRANT' | 'RESTRICTION';
  reason: string;
  issued_by?: string | null;
  is_active: boolean;
  effective_from?: string | null;
  effective_until?: string | null;
  created_at?: string;
}

export interface StudentImportRow {
  usn: string;
  full_name: string;
  email: string;
  phone?: string;
  admission_year?: number;
  branch?: string;
  academic_year?: number;
  current_semester?: number;
  gender?: 'MALE' | 'FEMALE' | 'OTHER';
}

export interface StudentImportResult {
  total_processed: number;
  inserted: number;
  updated: number;
  rejected: Array<{ usn: string; reason: string }>;
  report_timestamp: string;
}

/**
 * Validates whether a given USN matches the strict institutional format:
 * 1SI<2-digit admission year><2-letter branch><3-digit sequence>
 */
export function validateInstitutionalUsn(usn: string): boolean {
  if (!usn || typeof usn !== 'string') return false;
  return INSTITUTIONAL_USN_REGEX.test(usn.trim());
}

/**
 * Parses USN components (admission year, branch code, roll number)
 */
export function parseInstitutionalUsn(usn: string): { admissionYear: number; branch: string; sequence: number } | null {
  const match = usn.trim().match(INSTITUTIONAL_USN_REGEX);
  if (!match) return null;
  return {
    admissionYear: 2000 + parseInt(match[1], 10),
    branch: match[2].toUpperCase(),
    sequence: parseInt(match[3], 10),
  };
}
