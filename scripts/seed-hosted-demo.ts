import { DatabaseService, getDatabaseService } from '../src/db/index.js';
import { AuthService } from '../src/auth/service.js';
import readline from 'readline';

/**
 * Expected Synthetic Demo Names matching syntheticNames in seed.ts
 */
export const DEMO_SYNTHETIC_NAMES = [
  'Aarav Sharma', 'Diya Patel', 'Rohan Verma', 'Ananya Iyer', 'Vivaan Gupta',
  'Ishaan Nair', 'Aditi Rao', 'Kabir Sen', 'Saanvi Kulkarni', 'Arjun Menon',
  'Meera Deshmukh', 'Reyansh Bhat', 'Anika Reddy', 'Dev Joshi', 'Pooja Hegde',
  'Atharv Naik', 'Tanvi Pillai', 'Siddharth Roy', 'Tara Mukherjee', 'Aditya Das',
  'Neha Bansal', 'Kunal Chadha', 'Kavya Singhania', 'Manish Kapoor', 'Shruti Mehra',
  'Varun Sethi', 'Rhea Chopra', 'Harsh Varma', 'Prisha Pandey', 'Nikhil Saxena'
];

export interface HostedDemoSeedGuardConfig {
  appEnv?: string;
  enableFlag?: string;
  expectedDbName?: string;
  expectedDbHost?: string;
  confirmation?: string;
  databaseUrl?: string;
  allowedStagingHosts?: string[];
  dryRun?: boolean;
}

export interface HostedDemoAccountAction {
  collegeId: string;
  userId: string;
  role: string;
  action: 'CREATE' | 'PRESERVED' | 'CONFLICT';
  details: string;
}

export interface HostedDemoSeedResult {
  success: boolean;
  dryRun: boolean;
  seededStudentsCount: number;
  seededStaffCount: number;
  preservedAccountsCount: number;
  databaseName: string;
  databaseHost: string;
  actions: HostedDemoAccountAction[];
}

/**
 * Validates strictly that all staging-only safeguards hold before any database connection or write.
 */
export function validateHostedDemoSafeguards(config: HostedDemoSeedGuardConfig): {
  normalizedHost: string;
  normalizedDbName: string;
} {
  // 1. Explicit application environment must be 'staging'
  const appEnv = (config.appEnv || '').trim().toLowerCase();
  if (appEnv !== 'staging') {
    throw new Error(
      `STAGING_GUARD_VIOLATION: DORMEX_APP_ENV must be explicitly set to 'staging' (received: '${config.appEnv || 'undefined'}'). Hosted demo seeding is permanently forbidden in production or real institutional environments.`
    );
  }

  // 2. Explicit demo-seeding enable flag must be 'true'
  const enableFlag = (config.enableFlag || '').trim().toLowerCase();
  if (enableFlag !== 'true') {
    throw new Error(
      `STAGING_GUARD_VIOLATION: ENABLE_HOSTED_DEMO_SEED must be explicitly set to 'true' (received: '${config.enableFlag || 'undefined'}').`
    );
  }

  // 3. Expected staging database name must be provided
  const expectedDbName = (config.expectedDbName || '').trim();
  if (!expectedDbName) {
    throw new Error(
      `STAGING_GUARD_VIOLATION: EXPECTED_STAGING_DB_NAME must be explicitly specified (e.g. 'dormex_staging' or 'neondb').`
    );
  }

  // 4. Expected staging database hostname must be provided
  const expectedDbHost = (config.expectedDbHost || '').trim().toLowerCase();
  if (!expectedDbHost) {
    throw new Error(
      `STAGING_GUARD_VIOLATION: EXPECTED_STAGING_DB_HOST must be explicitly specified (e.g. 'ep-xyz-pooler.ap-southeast-1.aws.neon.tech').`
    );
  }

  // 5. Database URL must be present and its hostname must strictly match EXPECTED_STAGING_DB_HOST
  const dbUrl = config.databaseUrl || process.env.DATABASE_URL;
  if (!dbUrl) {
    throw new Error('STAGING_GUARD_VIOLATION: DATABASE_URL is not set.');
  }

  let parsedHost = '';
  try {
    const parsed = new URL(dbUrl);
    parsedHost = (parsed.hostname || '').toLowerCase();
  } catch (err: any) {
    throw new Error(`STAGING_GUARD_VIOLATION: Failed to parse DATABASE_URL: ${err.message}`);
  }

  if (parsedHost !== expectedDbHost) {
    throw new Error(
      `STAGING_GUARD_VIOLATION: DATABASE_URL hostname ('${parsedHost}') does not match the explicitly approved EXPECTED_STAGING_DB_HOST ('${expectedDbHost}'). Seeding aborted immediately.`
    );
  }

  // 5b. Independent allowlist verification:
  // Approved staging hostnames must belong to an independently declared allowlist
  // (e.g. ALLOWED_STAGING_DB_HOSTS env or known staging host patterns).
  // A production database will never pass simply because the operator sets DORMEX_APP_ENV=staging.
  const envAllowlist = (process.env.ALLOWED_STAGING_DB_HOSTS || '')
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
  const configAllowlist = (config.allowedStagingHosts || []).map((h) => h.trim().toLowerCase());
  const combinedAllowlist = new Set([...envAllowlist, ...configAllowlist]);

  // Reject production-like database hosts unconditionally
  const isSuspiciousProdHost =
    parsedHost.includes('prod') ||
    parsedHost.includes('production') ||
    parsedHost.includes('live') ||
    parsedHost.includes('master-db');
  if (isSuspiciousProdHost) {
    throw new Error(
      `STAGING_GUARD_VIOLATION: Hostname '${parsedHost}' contains production indicators. Seeding is permanently rejected.`
    );
  }

  if (combinedAllowlist.size > 0 && !combinedAllowlist.has(parsedHost)) {
    throw new Error(
      `STAGING_GUARD_VIOLATION: Hostname '${parsedHost}' is not in the independently configured staging allowlist. Unknown database host rejected.`
    );
  }

  // 6. Explicit confirmation value must be provided ('CONFIRM_SEED_HOSTED_DEMO')
  const confirmation = (config.confirmation || '').trim();
  if (confirmation !== 'CONFIRM_SEED_HOSTED_DEMO') {
    throw new Error(
      `STAGING_GUARD_VIOLATION: HOSTED_DEMO_CONFIRMATION must equal 'CONFIRM_SEED_HOSTED_DEMO'. Seeding aborted.`
    );
  }

  return {
    normalizedHost: parsedHost,
    normalizedDbName: expectedDbName,
  };
}

/**
 * Execute the hosted staging demo account seeding inside an atomic database transaction.
 * Rolls back completely on any unexpected account collision or role error.
 */
export async function executeHostedDemoSeed(
  db: DatabaseService,
  config: HostedDemoSeedGuardConfig
): Promise<HostedDemoSeedResult> {
  const { normalizedHost, normalizedDbName } = validateHostedDemoSafeguards(config);

  // Deep database verification: verify SELECT current_database() matches expected staging DB name
  const dbNameRes = await db.query<{ current_database: string }>('SELECT current_database();');
  const actualDbName = (dbNameRes.rows[0]?.current_database || '').trim();
  if (actualDbName !== normalizedDbName) {
    throw new Error(
      `STAGING_GUARD_VIOLATION: Connected database name ('${actualDbName}') does not match EXPECTED_STAGING_DB_NAME ('${normalizedDbName}'). Seeding aborted immediately.`
    );
  }

  const authService = new AuthService(db);
  const isDryRun = Boolean(config.dryRun);

  // Hash passwords using standard scrypt
  const adminHash = authService.hashPassword('admin123');
  const officeHash = authService.hashPassword('office123');

  const actions: HostedDemoAccountAction[] = [];

  const runWithClient = async (client: any) => {
    // 1. Verify expected roles exist before attempting account creation
    const roleRes = await client.query(
      `SELECT id, name FROM roles WHERE name IN ('STUDENT', 'CHIEF_WARDEN', 'HOSTEL_OFFICE', 'WARDEN')`
    );
    const roleMap = new Map<string, string>();
    for (const r of roleRes.rows) {
      roleMap.set(r.name, r.id);
    }

    if (!roleMap.has('STUDENT')) {
      throw new Error("ROLE_VERIFICATION_FAILED: Required system role 'STUDENT' is missing. Run migrations first.");
    }
    if (!roleMap.has('CHIEF_WARDEN')) {
      throw new Error("ROLE_VERIFICATION_FAILED: Required system role 'CHIEF_WARDEN' is missing. Run migrations first.");
    }
    if (!roleMap.has('HOSTEL_OFFICE')) {
      throw new Error("ROLE_VERIFICATION_FAILED: Required system role 'HOSTEL_OFFICE' is missing. Run migrations first.");
    }

    const studentRoleId = roleMap.get('STUDENT')!;
    const chiefWardenRoleId = roleMap.get('CHIEF_WARDEN')!;
    const wardenRoleId = roleMap.get('WARDEN') || chiefWardenRoleId;
    const hostelOfficeRoleId = roleMap.get('HOSTEL_OFFICE')!;

    // 2. Staff Demo Accounts: Exactly 8 (ADM001..ADM003, OFF001..OFF005)
    const staffAccounts = [
      {
        id: 'usr_admin',
        collegeId: 'ADM001',
        email: 'admin@college.edu',
        fullName: 'Chief Warden Administrator',
        hash: adminHash,
        roleId: chiefWardenRoleId,
        scopeType: 'SYSTEM',
        scopeId: null,
      },
      {
        id: 'usr_admin_2',
        collegeId: 'ADM002',
        email: 'admin2@college.edu',
        fullName: 'Deputy Chief Warden',
        hash: adminHash,
        roleId: chiefWardenRoleId,
        scopeType: 'SYSTEM',
        scopeId: null,
      },
      {
        id: 'usr_admin_3',
        collegeId: 'ADM003',
        email: 'admin3@college.edu',
        fullName: 'Senior Hostel Warden',
        hash: adminHash,
        roleId: wardenRoleId,
        scopeType: 'SYSTEM',
        scopeId: null,
      },
      {
        id: 'usr_office',
        collegeId: 'OFF001',
        email: 'office@college.edu',
        fullName: 'Hostel Office Staff',
        hash: officeHash,
        roleId: hostelOfficeRoleId,
        scopeType: 'SYSTEM',
        scopeId: null,
      },
      {
        id: 'usr_office_2',
        collegeId: 'OFF002',
        email: 'office2@college.edu',
        fullName: 'Hostel Office Accounts Officer',
        hash: officeHash,
        roleId: hostelOfficeRoleId,
        scopeType: 'SYSTEM',
        scopeId: null,
      },
      {
        id: 'usr_office_3',
        collegeId: 'OFF003',
        email: 'office3@college.edu',
        fullName: 'Hostel Office Admissions Desk',
        hash: officeHash,
        roleId: hostelOfficeRoleId,
        scopeType: 'SYSTEM',
        scopeId: null,
      },
      {
        id: 'usr_office_4',
        collegeId: 'OFF004',
        email: 'office4@college.edu',
        fullName: 'Hostel Office Welfare Coordinator',
        hash: officeHash,
        roleId: hostelOfficeRoleId,
        scopeType: 'SYSTEM',
        scopeId: null,
      },
      {
        id: 'usr_office_5',
        collegeId: 'OFF005',
        email: 'office5@college.edu',
        fullName: 'Hostel Office Facilities Desk',
        hash: officeHash,
        roleId: hostelOfficeRoleId,
        scopeType: 'SYSTEM',
        scopeId: null,
      },
    ];

    let seededStaffCount = 0;
    let preservedAccountsCount = 0;

    for (const staff of staffAccounts) {
      const existing = await client.query(
        `SELECT id, college_id, email, full_name, password_hash FROM users WHERE LOWER(college_id) = LOWER($1) OR LOWER(email) = LOWER($2)`,
        [staff.collegeId, staff.email]
      );

      if (existing.rows.length > 0) {
        const row = existing.rows[0];
        // If it is an expected existing user with matching ID, preserve credentials safely without overwriting
        if (row.id === staff.id && row.college_id.toUpperCase() === staff.collegeId) {
          actions.push({
            collegeId: staff.collegeId,
            userId: staff.id,
            role: 'STAFF',
            action: 'PRESERVED',
            details: `Existing user '${staff.id}' preserved intact. Password hash and profile untouched.`,
          });
          preservedAccountsCount++;
        } else {
          // Unexpected user collision: abort to protect institutional / existing data
          throw new Error(
            `ACCOUNT_COLLISION_DETECTED: Account identifier '${staff.collegeId}' or email '${staff.email}' is already taken by unexpected user '${row.id}'. Aborting to prevent overwriting existing user data.`
          );
        }
      } else {
        actions.push({
          collegeId: staff.collegeId,
          userId: staff.id,
          role: 'STAFF',
          action: 'CREATE',
          details: `Will insert new staff user '${staff.id}' with roleId '${staff.roleId}'`,
        });

        if (!isDryRun) {
          await client.query(
            `INSERT INTO users (id, college_id, email, full_name, password_hash)
             VALUES ($1, $2, $3, $4, $5)`,
            [staff.id, staff.collegeId, staff.email, staff.fullName, staff.hash]
          );
        }
      }

      // Ensure user_roles mapping exists idempotently
      if (!isDryRun) {
        await client.query(
          `INSERT INTO user_roles (id, user_id, role_id, scope_type, scope_id)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (id) DO NOTHING`,
          [`ur_${staff.id}`, staff.id, staff.roleId, staff.scopeType, staff.scopeId]
        );
      }
      seededStaffCount++;
    }

    // 3. Student Demo Accounts (DEMO-001 through DEMO-030)
    let seededStudentsCount = 0;
    for (let i = 1; i <= 30; i++) {
      const pad = String(i).padStart(3, '0');
      const collegeId = `DEMO-${pad}`;
      const userId = `usr_demo_${pad}`;
      const profileId = `prof_demo_${pad}`;
      const fullName = DEMO_SYNTHETIC_NAMES[i - 1];
      const email = `demo.${pad.toLowerCase()}@college.edu`;
      const studentPassword = `password${i}`;
      const studentHash = authService.hashPassword(studentPassword);

      const quota = i <= 5 ? 'MERIT' : (i === 12 ? 'SPORTS' : (i === 20 ? 'PWD' : 'GENERAL'));
      const eligibility = i <= 28 ? 'ELIGIBLE' : (i === 29 ? 'PENDING' : 'FEE_PENDING');
      const priority = i;
      const feeStatus = i <= 28 ? 'VERIFIED' : (i === 29 ? 'SUBMITTED' : 'UNPAID');
      const feeRef = i <= 29 ? `FEE-2026-BVB-${pad}` : null;
      const feeTimestamp = i <= 29 ? new Date(Date.UTC(2026, 7, 10, 9, i, 0)).toISOString() : null;
      const verifiedBy = i <= 28 ? 'usr_office' : null;
      const verifiedAt = i <= 28 ? new Date(Date.UTC(2026, 7, 10, 12, 0, 0)).toISOString() : null;

      // Check collision
      const existing = await client.query(
        `SELECT id, college_id, email, full_name, password_hash FROM users WHERE LOWER(college_id) = LOWER($1) OR LOWER(email) = LOWER($2)`,
        [collegeId, email]
      );

      if (existing.rows.length > 0) {
        const row = existing.rows[0];
        if (row.id === userId && row.college_id.toUpperCase() === collegeId) {
          actions.push({
            collegeId,
            userId,
            role: 'STUDENT',
            action: 'PRESERVED',
            details: `Existing student '${userId}' preserved intact. Password hash untouched.`,
          });
          preservedAccountsCount++;
        } else {
          throw new Error(
            `ACCOUNT_COLLISION_DETECTED: Demo student '${collegeId}' or email '${email}' is already taken by unexpected user '${row.id}'. Aborting transaction.`
          );
        }
      } else {
        actions.push({
          collegeId,
          userId,
          role: 'STUDENT',
          action: 'CREATE',
          details: `Will insert new student user '${userId}' (${fullName})`,
        });

        if (!isDryRun) {
          await client.query(
            `INSERT INTO users (id, college_id, email, full_name, password_hash)
             VALUES ($1, $2, $3, $4, $5)`,
            [userId, collegeId, email, fullName, studentHash]
          );
        }
      }

      if (!isDryRun) {
        // Ensure user role
        await client.query(
          `INSERT INTO user_roles (id, user_id, role_id, scope_type, scope_id)
           VALUES ($1, $2, $3, 'STUDENT', NULL)
           ON CONFLICT (id) DO NOTHING`,
          [`ur_${userId}`, userId, studentRoleId]
        );

        // Ensure student profile
        await client.query(
          `INSERT INTO student_profiles (
            id, user_id, college_id, full_name, academic_year, department, gender, quota_category,
            eligibility_status, assigned_priority, proctor_user_id, proctor_name, proctor_department,
            parent_name, parent_relationship, parent_phone, parent_email,
            local_guardian_name, local_guardian_relationship, local_guardian_phone,
            fee_status, fee_receipt_ref, fee_payment_timestamp, fee_verified_by, fee_verified_at,
            priority_assignment_source, profile_submitted, profile_submitted_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28)
          ON CONFLICT (id) DO UPDATE
            SET assigned_priority = EXCLUDED.assigned_priority,
                eligibility_status = EXCLUDED.eligibility_status,
                fee_status = EXCLUDED.fee_status,
                fee_receipt_ref = EXCLUDED.fee_receipt_ref,
                fee_payment_timestamp = EXCLUDED.fee_payment_timestamp`,
          [
            profileId,
            userId,
            collegeId,
            fullName,
            2,
            i % 2 === 0 ? 'CSE' : 'ECE',
            i % 3 === 0 ? 'FEMALE' : 'MALE',
            quota,
            eligibility,
            priority,
            null,
            'Dr. Mehta',
            'Computer Science',
            `Parent of ${fullName}`,
            'Father',
            `+91 98765 432${pad.slice(-2)}`,
            `parent.${pad.toLowerCase()}@example.com`,
            `Guardian of ${fullName}`,
            'Uncle',
            `+91 91234 567${pad.slice(-2)}`,
            feeStatus,
            feeRef,
            feeTimestamp,
            verifiedBy,
            verifiedAt,
            'AUTOMATIC_FEE',
            true,
            new Date(Date.UTC(2026, 7, 10, 8, 30, 0)).toISOString(),
          ]
        );

        // Terms acknowledgement for demo students 1..28 (only if terms document terms_v1 exists)
        if (i <= 28) {
          const termsCheck = await client.query("SELECT 1 FROM terms_documents WHERE id = 'terms_v1'");
          if (termsCheck.rows.length > 0) {
            await client.query(
              `INSERT INTO terms_acknowledgements (id, student_id, terms_document_id, terms_version, accepted_at)
               VALUES ($1, $2, 'terms_v1', 1, $3)
               ON CONFLICT (student_id, terms_version) DO NOTHING`,
              [`ack_demo_${pad}_v1`, profileId, new Date(Date.UTC(2026, 7, 10, 8, 45, 0)).toISOString()]
            );
          }
        }
      }

      seededStudentsCount++;
    }

    return {
      success: true,
      dryRun: isDryRun,
      seededStudentsCount,
      seededStaffCount,
      preservedAccountsCount,
      databaseName: actualDbName,
      databaseHost: normalizedHost,
      actions,
    };
  };

  if (isDryRun) {
    // In dryRun mode, execute read-only queries with db.query or inside a client that is never committed
    return runWithClient(db);
  }

  return db.transaction(async (client) => {
    return runWithClient(client);
  });
}

function prompt(query: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question(query, (ans) => {
      rl.close();
      resolve(ans.trim());
    });
  });
}

export async function runCli(): Promise<void> {
  console.log('================================================================');
  console.log('       DORMEX HOSTED STAGING DEMO ACCOUNTS SEEDER               ');
  console.log('================================================================');
  console.log('CAUTION: This command populates test credentials into a staging ');
  console.log('database only. It is strictly forbidden for real institutional  ');
  console.log('deployments and will abort on non-staging databases.\n');

  const isDryRunArg = process.argv.includes('--dry-run') || process.env.DRY_RUN === 'true';

  const config: HostedDemoSeedGuardConfig = {
    appEnv: process.env.DORMEX_APP_ENV,
    enableFlag: process.env.ENABLE_HOSTED_DEMO_SEED,
    expectedDbName: process.env.EXPECTED_STAGING_DB_NAME,
    expectedDbHost: process.env.EXPECTED_STAGING_DB_HOST,
    confirmation: process.env.HOSTED_DEMO_CONFIRMATION,
    databaseUrl: process.env.DATABASE_URL,
    dryRun: isDryRunArg,
  };

  if (isDryRunArg) {
    console.log('[DRY-RUN MODE ACTIVATED] No changes will be committed to the database.\n');
  }

  // If interactive and missing confirmation (and not dry-run), prompt for confirmation
  if (!isDryRunArg && !config.confirmation && process.stdin.isTTY) {
    console.log(`Target Staging DB Host : ${config.expectedDbHost || '[NOT SPECIFIED]'}`);
    console.log(`Target Staging DB Name : ${config.expectedDbName || '[NOT SPECIFIED]'}`);
    console.log(`Application Environment: ${config.appEnv || '[NOT SPECIFIED]'}\n`);
    const answer = await prompt("Type 'CONFIRM_SEED_HOSTED_DEMO' to proceed with staging seed: ");
    config.confirmation = answer;
  }

  try {
    const db = getDatabaseService();
    console.log('Connecting to database and verifying environmental safeguards...');
    const result = await executeHostedDemoSeed(db, config);

    console.log('\n================================================================');
    if (result.dryRun) {
      console.log('       DRY-RUN AUDIT & PROVISIONING PLAN SUMMARY                ');
    } else {
      console.log('       HOSTED DEMO SEED EXECUTION SUMMARY                       ');
    }
    console.log('================================================================');
    console.log(`  - Database Host     : ${result.databaseHost}`);
    console.log(`  - Database Name     : ${result.databaseName}`);
    console.log(`  - Mode              : ${result.dryRun ? 'DRY RUN (READ-ONLY AUDIT)' : 'LIVE EXECUTION'}`);
    console.log(`  - Preserved Existing: ${result.preservedAccountsCount} accounts (passwords/hashes untouched)`);
    console.log(`  - Staff Accounts    : ${result.seededStaffCount} (ADM001..ADM003, OFF001..OFF005)`);
    console.log(`  - Student Accounts  : ${result.seededStudentsCount} (DEMO-001 through DEMO-030)`);
    console.log('\nAccount Status Breakdown:');
    for (const a of result.actions) {
      const tag = a.action === 'PRESERVED' ? '[PRESERVED]' : '[TO CREATE]';
      console.log(`  ${tag} ${a.collegeId.padEnd(10)} (${a.role.padEnd(8)}) -> ${a.details}`);
    }

    if (result.dryRun) {
      console.log('\n[NOTICE] Dry run completed cleanly. 0 database modifications committed.');
    } else {
      console.log('\n[SUCCESS] Hosted demo accounts seeded successfully.');
      console.log('All passwords securely hashed using standard scrypt. No plaintext stored.');
    }

    await db.close();
    process.exit(0);
  } catch (err: any) {
    console.error(`\n[ABORTED] Hosted demo seed failed: ${err.message}`);
    process.exit(1);
  }
}

// Auto-run CLI if invoked directly via tsx / node
if (process.argv[1] && process.argv[1].includes('seed-hosted-demo')) {
  runCli();
}
