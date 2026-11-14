import { DatabaseService } from '../db/index.js';
import { AuthActor, can } from '../auth/policy.js';
import { BuildingEligibilityPolicy } from './studentModel.js';

export interface EvaluateEligibilityInput {
  studentUsn: string;
  buildingId: string;
  academicYear: number;
  admissionYear?: number;
  branch?: string;
  gender?: string;
  quotaCategory?: string;
}

export interface EligibilityEvaluationResult {
  isEligible: boolean;
  buildingId: string;
  studentUsn: string;
  verdict: 'GRANTED' | 'RESTRICTED' | 'NO_POLICY_MATCH';
  reasons: string[];
}

export class BuildingEligibilityService {
  constructor(private db: DatabaseService) {}

  /**
   * Create or update a building eligibility policy or student exception
   */
  async createPolicy(
    input: {
      buildingId: string;
      academicYear?: number | null;
      admissionYear?: number | null;
      branch?: string | null;
      gender?: string | null;
      quotaCategory?: string | null;
      studentUsn?: string | null;
      policyType: 'GRANT' | 'RESTRICTION';
      reason: string;
      effectiveFrom?: string | null;
      effectiveUntil?: string | null;
    },
    actor: AuthActor
  ): Promise<BuildingEligibilityPolicy> {
    if (!can(actor, 'inventory.manage') && !can(actor, 'governance.manage')) {
      throw new Error('FORBIDDEN: Only Chief Warden, Super Admin, or assigned Warden can manage building eligibility policies');
    }

    const id = `bep_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const cleanUsn = input.studentUsn ? input.studentUsn.trim().toUpperCase() : null;

    const res = await this.db.query(
      `INSERT INTO building_eligibility_policies (
        id, building_id, academic_year, admission_year, branch, gender, quota_category, student_usn, policy_type, reason, issued_by, effective_from, effective_until
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      RETURNING *`,
      [
        id,
        input.buildingId,
        input.academicYear || null,
        input.admissionYear || null,
        input.branch ? input.branch.toUpperCase() : null,
        input.gender || null,
        input.quotaCategory || null,
        cleanUsn,
        input.policyType,
        input.reason,
        actor.id,
        input.effectiveFrom || null,
        input.effectiveUntil || null,
      ]
    );

    return res.rows[0];
  }

  /**
   * Evaluates eligibility following documented rule precedence:
   * 1. Global building active status
   * 2. Specific student restrictions (fail-closed)
   * 3. Specific student grants (explicit override)
   * 4. General building policies (academic year, branch, gender match)
   */
  async evaluateEligibility(input: EvaluateEligibilityInput): Promise<EligibilityEvaluationResult> {
    const cleanUsn = input.studentUsn.trim().toUpperCase();

    // 1. Check building status
    const bldRes = await this.db.query('SELECT id, is_active FROM buildings WHERE id = $1', [input.buildingId]);
    if (bldRes.rows.length === 0) {
      return {
        isEligible: false,
        buildingId: input.buildingId,
        studentUsn: cleanUsn,
        verdict: 'RESTRICTED',
        reasons: [`BUILDING_NOT_FOUND: Building ${input.buildingId} does not exist`],
      };
    }
    if (!bldRes.rows[0].is_active) {
      return {
        isEligible: false,
        buildingId: input.buildingId,
        studentUsn: cleanUsn,
        verdict: 'RESTRICTED',
        reasons: [`BUILDING_INACTIVE: Building ${input.buildingId} is deactivated for allocations`],
      };
    }

    // 2. Fetch all active policies for this building
    const policiesRes = await this.db.query(
      `SELECT * FROM building_eligibility_policies 
       WHERE building_id = $1 AND is_active = TRUE`,
      [input.buildingId]
    );

    const now = new Date();
    const policies: BuildingEligibilityPolicy[] = policiesRes.rows.filter(p => {
      if (p.effective_from && new Date(p.effective_from) > now) return false;
      if (p.effective_until && new Date(p.effective_until) < now) return false;
      return true;
    });

    // 2a. Precedence 1: Explicit student-specific RESTRICTION
    const studentRestriction = policies.find(p => p.student_usn === cleanUsn && p.policy_type === 'RESTRICTION');
    if (studentRestriction) {
      return {
        isEligible: false,
        buildingId: input.buildingId,
        studentUsn: cleanUsn,
        verdict: 'RESTRICTED',
        reasons: [`STUDENT_RESTRICTION: Explicit restriction applied: ${studentRestriction.reason}`],
      };
    }

    // 2b. Precedence 2: Explicit student-specific GRANT
    const studentGrant = policies.find(p => p.student_usn === cleanUsn && p.policy_type === 'GRANT');
    if (studentGrant) {
      return {
        isEligible: true,
        buildingId: input.buildingId,
        studentUsn: cleanUsn,
        verdict: 'GRANTED',
        reasons: [`STUDENT_GRANT: Explicit student exemption granted: ${studentGrant.reason}`],
      };
    }

    // 2c. General building policies matching criteria
    const generalPolicies = policies.filter(p => !p.student_usn);
    if (generalPolicies.length === 0) {
      // Default: if building is active and has no restrictive policies, permit by default
      return {
        isEligible: true,
        buildingId: input.buildingId,
        studentUsn: cleanUsn,
        verdict: 'GRANTED',
        reasons: ['DEFAULT_PERMIT: Building is open with no restrictive policy filters'],
      };
    }

    // Check general restrictions
    for (const p of generalPolicies) {
      if (p.policy_type === 'RESTRICTION') {
        const yearMismatch = p.academic_year && p.academic_year === input.academicYear;
        const branchMismatch = p.branch && p.branch === (input.branch || '').toUpperCase();
        const genderMismatch = p.gender && p.gender === input.gender;

        if (yearMismatch || branchMismatch || genderMismatch) {
          return {
            isEligible: false,
            buildingId: input.buildingId,
            studentUsn: cleanUsn,
            verdict: 'RESTRICTED',
            reasons: [`POLICY_RESTRICTION: ${p.reason}`],
          };
        }
      }
    }

    // Check general grants
    const grants = generalPolicies.filter(p => p.policy_type === 'GRANT');
    if (grants.length > 0) {
      const match = grants.some(p => {
        const yearMatches = !p.academic_year || p.academic_year === input.academicYear;
        const branchMatches = !p.branch || p.branch === (input.branch || '').toUpperCase();
        const genderMatches = !p.gender || p.gender === input.gender;
        return yearMatches && branchMatches && genderMatches;
      });

      if (!match) {
        return {
          isEligible: false,
          buildingId: input.buildingId,
          studentUsn: cleanUsn,
          verdict: 'RESTRICTED',
          reasons: [`COHORT_NOT_PERMITTED: Academic year ${input.academicYear} / branch ${input.branch || 'N/A'} is not eligible for building ${input.buildingId}`],
        };
      }
    }

    return {
      isEligible: true,
      buildingId: input.buildingId,
      studentUsn: cleanUsn,
      verdict: 'GRANTED',
      reasons: ['POLICY_MATCH: Student satisfies building eligibility criteria'],
    };
  }

  /**
   * List policies for building
   */
  async getPoliciesForBuilding(buildingId: string): Promise<BuildingEligibilityPolicy[]> {
    const res = await this.db.query(
      `SELECT * FROM building_eligibility_policies WHERE building_id = $1 ORDER BY created_at DESC`,
      [buildingId]
    );
    return res.rows;
  }
}
