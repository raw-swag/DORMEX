import crypto from 'crypto';
import readline from 'readline';
import { DatabaseService, getDatabaseService } from '../src/db/index.js';
import { AuthService } from '../src/auth/service.js';

/**
 * PostgreSQL 64-bit Advisory Lock Key for DORMEX SUPER_ADMIN Bootstrap.
 * Uses a stable 64-bit integer derived deterministically from 'dormex:bootstrap:super_admin'.
 * 0x444f524d45584253n translates to ASCII "DORMEXBS" in hex.
 */
export const BOOTSTRAP_ADVISORY_LOCK_ID = '4922253381656003411'; // BigInt('0x444f524d45584253').toString()

export interface BootstrapAdminParams {
  staffId: string;
  fullName: string;
  email: string;
  password?: string; // Optional: if omitted, a cryptographically secure random password is generated
}

export interface BootstrapResult {
  success: boolean;
  userId: string;
  staffId: string;
  fullName: string;
  email: string;
  generatedPassword?: string;
  alreadyInitialized?: boolean;
}

export function generateSecureInitialPassword(): string {
  // 16 bytes of cryptographically secure random entropy (128 bits) encoded as base64url,
  // flanked by special character/digit sequences for strict complexity compliance.
  const randomChars = crypto.randomBytes(16).toString('base64url');
  return `Dx@${randomChars}#9`;
}

export function validateBootstrapParams(params: BootstrapAdminParams): void {
  if (!params.staffId || params.staffId.trim().length === 0) {
    throw new Error('VALIDATION_FAILED: Official administrator Staff ID is required (e.g. ADM001).');
  }

  if (!params.fullName || params.fullName.trim().length === 0) {
    throw new Error('VALIDATION_FAILED: Official administrator full name is required.');
  }

  if (!params.email || params.email.trim().length === 0) {
    throw new Error('VALIDATION_FAILED: Institutional email address is required.');
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(params.email.trim())) {
    throw new Error('VALIDATION_FAILED: Invalid email address format.');
  }

  if (params.password && params.password.length < 12) {
    throw new Error('VALIDATION_FAILED: Provided password must be at least 12 characters in length.');
  }
}

/**
 * Execute the first administrator bootstrap atomically within a single database transaction
 * protected by a PostgreSQL transaction-scoped advisory lock: pg_advisory_xact_lock.
 */
export async function executeBootstrapSuperAdmin(
  db: DatabaseService,
  params: BootstrapAdminParams
): Promise<BootstrapResult> {
  validateBootstrapParams(params);

  const staffId = params.staffId.trim().toUpperCase();
  const email = params.email.trim().toLowerCase();
  const fullName = params.fullName.trim();
  const initialPassword = params.password || generateSecureInitialPassword();

  const authService = new AuthService(db);
  const passwordHash = authService.hashPassword(initialPassword);
  const userId = `usr_admin_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  const userRoleId = `ur_${userId}`;
  const auditId = `aud_bootstrap_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;

  return db.transaction(async (client) => {
    // 1. Acquire transaction-scoped advisory lock in PostgreSQL (Fails CLOSED)
    // This lock automatically releases when the transaction commits or rolls back
    try {
      await client.query(`SELECT pg_advisory_xact_lock($1::bigint)`, [BOOTSTRAP_ADVISORY_LOCK_ID]);
    } catch (lockErr: any) {
      // In-memory test engine (pg-mem) fallback is permitted ONLY if db explicitly declares isInMemory === true
      // AND the environment is explicitly 'test'. Any failure in production or real PostgreSQL halts immediately.
      const isTestEnv = process.env.NODE_ENV === 'test' && db.isInMemory === true;
      if (!isTestEnv) {
        throw new Error(
          `LOCK_ACQUISITION_FAILED: Failed to acquire PostgreSQL bootstrap advisory lock: ${lockErr.message}`
        );
      }
    }

    // 2. Concurrency & Idempotency check: Verify that NO SUPER_ADMIN exists
    const existingAdminRes = await client.query(`
      SELECT u.id, u.college_id, u.email
      FROM users u
      JOIN user_roles ur ON u.id = ur.user_id
      JOIN roles r ON ur.role_id = r.id
      WHERE r.name = 'SUPER_ADMIN'
    `);

    if (existingAdminRes.rows.length > 0) {
      throw new Error(
        `BOOTSTRAP_ALREADY_INITIALIZED: A SUPER_ADMIN account already exists in this database. Additional administrator accounts must be provisioned through the official administrative portal.`
      );
    }

    // 3. Verify that the required SUPER_ADMIN role exists
    const roleRes = await client.query(`SELECT id FROM roles WHERE name = 'SUPER_ADMIN'`);
    if (roleRes.rows.length === 0) {
      throw new Error(
        `ROLE_NOT_FOUND: The 'SUPER_ADMIN' system role is not defined in the roles table. Please ensure migrations are run first.`
      );
    }
    const superAdminRoleId = roleRes.rows[0].id;

    // 4. Check for conflicting email or staff ID
    const conflictingUser = await client.query(
      `SELECT id, college_id, email FROM users WHERE LOWER(college_id) = LOWER($1) OR LOWER(email) = LOWER($2)`,
      [staffId, email]
    );

    if (conflictingUser.rows.length > 0) {
      throw new Error(
        `CONFLICTING_USER: A user with this Staff ID or email already exists with a different role.`
      );
    }

    // 5. Insert new administrator user
    await client.query(
      `INSERT INTO users (id, college_id, email, full_name, password_hash, is_active)
       VALUES ($1, $2, $3, $4, $5, TRUE)`,
      [userId, staffId, email, fullName, passwordHash]
    );

    // 6. Assign SUPER_ADMIN role with SYSTEM scope
    await client.query(
      `INSERT INTO user_roles (id, user_id, role_id, scope_type, scope_id)
       VALUES ($1, $2, $3, 'SYSTEM', NULL)`,
      [userRoleId, userId, superAdminRoleId]
    );

    // 7. Insert audit event record
    await client.query(
      `INSERT INTO audit_logs (id, actor_id, action, target_type, target_id, reason)
       VALUES ($1, $2, 'BOOTSTRAP_SUPER_ADMIN_CREATED', 'USER', $3, $4)`,
      [
        auditId,
        userId,
        userId,
        `First authorized production SUPER_ADMIN account bootstrapped for staff ID ${staffId} (${email})`
      ]
    );

    return {
      success: true,
      userId,
      staffId,
      fullName,
      email,
      generatedPassword: params.password ? undefined : initialPassword,
    };
  });
}

/**
 * Interactive CLI Runner
 */
async function prompt(question: string, hidden: boolean = false): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    if (!hidden) {
      rl.question(question, (answer) => {
        rl.close();
        resolve(answer.trim());
      });
    } else {
      process.stdout.write(question);
      let buffer = '';
      process.stdin.setRawMode?.(true);
      process.stdin.resume();
      process.stdin.on('data', function onData(char) {
        const c = char.toString('utf-8');
        if (c === '\n' || c === '\r' || c === '\u0004') {
          process.stdin.setRawMode?.(false);
          process.stdin.removeListener('data', onData);
          rl.close();
          process.stdout.write('\n');
          resolve(buffer.trim());
        } else if (c === '\u0008' || c === '\x7f') {
          if (buffer.length > 0) {
            buffer = buffer.slice(0, -1);
            process.stdout.write('\b \b');
          }
        } else if (c === '\u0003') {
          process.exit(1);
        } else {
          buffer += c;
          process.stdout.write('*');
        }
      });
    }
  });
}

export async function runCli(): Promise<void> {
  console.log('================================================================');
  console.log('       DORMEX PRODUCTION SUPER_ADMIN BOOTSTRAP PROTOCOL         ');
  console.log('================================================================');
  console.log('NOTICE: This one-time ceremony creates the first authorized');
  console.log('SUPER_ADMIN institutional identity. It requires explicit institutional');
  console.log('authorization and will be permanently disabled once completed.\n');

  const envStaffId = process.env.BOOTSTRAP_ADMIN_ID;
  const envName = process.env.BOOTSTRAP_ADMIN_NAME;
  const envEmail = process.env.BOOTSTRAP_ADMIN_EMAIL;
  const envPassword = process.env.BOOTSTRAP_ADMIN_PASSWORD;

  let staffId = envStaffId;
  let fullName = envName;
  let email = envEmail;
  let customPassword = envPassword;

  if (!staffId || !fullName || !email) {
    if (!process.stdin.isTTY) {
      console.error('FATAL: Non-interactive terminal detected without required environment variables.');
      console.error('Supply BOOTSTRAP_ADMIN_ID, BOOTSTRAP_ADMIN_NAME, and BOOTSTRAP_ADMIN_EMAIL.');
      process.exit(1);
    }

    console.log('Please enter the authorized institutional administrator details:\n');
    staffId = await prompt('  1. Administrator Institutional Staff ID (e.g. ADM001): ');
    fullName = await prompt('  2. Administrator Official Full Name: ');
    email = await prompt('  3. Administrator Institutional Email: ');
    const choosePassword = await prompt('  4. Set custom password? (y/N - enter N to auto-generate high-entropy password): ');
    if (choosePassword.toLowerCase() === 'y') {
      customPassword = await prompt('     Enter new secure password (min 12 chars): ', true);
    }
  }

  const db = getDatabaseService();

  try {
    console.log('\n[1/3] Validating parameters & database connectivity...');
    const result = await executeBootstrapSuperAdmin(db, {
      staffId: staffId!,
      fullName: fullName!,
      email: email!,
      password: customPassword || undefined,
    });

    console.log('\n[2/3] Atomic bootstrap transaction committed successfully.');
    console.log('\n================================================================');
    console.log('       BOOTSTRAP INITIALIZATION COMPLETED SUCCESSFULLY          ');
    console.log('================================================================');
    console.log(`  Staff ID:         ${result.staffId}`);
    console.log(`  Full Name:        ${result.fullName}`);
    console.log(`  Email Address:    ${result.email}`);
    console.log(`  User ID:          ${result.userId}`);
    console.log(`  Assigned Role:    SUPER_ADMIN (Scope: SYSTEM)`);
    console.log(`  Audit Event:      BOOTSTRAP_SUPER_ADMIN_CREATED logged`);
    console.log('----------------------------------------------------------------');

    if (result.generatedPassword) {
      console.log('  INITIAL CREDENTIAL (PRINTED ONCE — RECORD IMMEDIATELY):');
      console.log(`  Password:  ${result.generatedPassword}`);
      console.log('----------------------------------------------------------------');
      console.log('  IMPORTANT: Store this password securely. It is NOT stored in');
      console.log('  plaintext and cannot be recovered from server logs or database.');
    } else {
      console.log('  Password:  [Custom Password Configured - Never Logged]');
    }

    console.log('================================================================\n');
    await db.close();
    process.exit(0);
  } catch (err: any) {
    console.error('\nFATAL: Bootstrap failed:', err.message);
    await db.close().catch(() => {});
    process.exit(1);
  }
}

// Only invoke runCli directly if executed as main module
if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, '/')}`) {
  runCli();
}
