import crypto from 'crypto';
import { DatabaseService } from '../db/index.js';
import {
  hashPasswordAsync,
  hashPasswordSync,
  verifyPasswordAsync,
  executeDummyPasswordVerification,
  validatePasswordStrength,
} from './passwordUtils.js';
import {
  generateTotpSecret,
  computeTotpCode,
  verifyTotpCode,
  generateKeyUri,
  getCurrentTimestep,
  base32Encode,
} from './totpService.js';
import { encryptAesGcm, decryptAesGcm } from './cryptoUtils.js';
import {
  generateRecoveryCodes,
  hashRecoveryCode,
  verifyRecoveryCode,
} from './recoveryCodeService.js';
import { DistributedRateLimiter } from './rateLimiter.js';

export type InternalDeliveryOutcome = 'EMAIL_SENT' | 'EMAIL_FAILED' | 'OFFICE_ASSISTANCE' | 'NO_ACCOUNT_MATCH';

export interface OutboxEmailMessage {
  to: string;
  subject: string;
  token: string;
  expiresAt: Date;
  deliveryMethod: 'EMAIL' | 'TEST_MAILER' | 'OFFICE_ASSISTANCE';
  dispatchedAt: Date;
  purpose?: string;
}

export class TestEmailOutbox {
  private messages: OutboxEmailMessage[] = [];
  private lastDeliveryOutcome: InternalDeliveryOutcome = 'NO_ACCOUNT_MATCH';

  record(message: OutboxEmailMessage): void {
    this.messages.push(message);
  }

  setLastDeliveryOutcome(outcome: InternalDeliveryOutcome): void {
    this.lastDeliveryOutcome = outcome;
  }

  getLastDeliveryOutcome(): InternalDeliveryOutcome {
    return this.lastDeliveryOutcome;
  }

  getMessages(): readonly OutboxEmailMessage[] {
    return this.messages;
  }

  getLatestMessage(): OutboxEmailMessage | undefined {
    return this.messages[this.messages.length - 1];
  }

  getLatestTokenForUser(emailOrCollegeId: string): string | undefined {
    const target = emailOrCollegeId.trim().toLowerCase();
    const found = [...this.messages].reverse().find(
      (m) => m.to.toLowerCase() === target || m.subject.toLowerCase().includes(target)
    );
    return found?.token;
  }

  clear(): void {
    this.messages = [];
    this.lastDeliveryOutcome = 'NO_ACCOUNT_MATCH';
  }
}

export const testEmailOutbox = new TestEmailOutbox();

export interface PasswordResetRequestResult {
  success: boolean;
  message: string;
  status: 'REQUEST_ACCEPTED';
}

export interface ActivationVoucherResult {
  success: boolean;
  voucherId: string;
  token: string;
  userId: string;
  collegeId: string;
  fullName: string;
  expiresAt: Date;
}

export interface AccountActivationResult {
  success: boolean;
  message: string;
  userId: string;
  collegeId: string;
}

export interface MfaEnrollmentInitResult {
  success: boolean;
  base32Secret: string;
  keyUri: string;
  accountName: string;
  issuer: string;
  expiresAt: Date;
}

export interface MfaVerificationResult {
  success: boolean;
  message: string;
  recoveryCodes?: string[];
}

export interface MfaChallengeRecord {
  token: string;
  userId: string;
  role: string;
  collegeId: string;
  expiresAt: number;
}

export class AuthService {
  private rateLimiter: DistributedRateLimiter;
  // Ephemeral in-flight challenge cache with 5-minute TTL
  private pendingMfaChallenges: Map<string, MfaChallengeRecord> = new Map();
  // Ephemeral in-flight enrollment cache with 10-minute TTL
  private pendingEnrollments: Map<string, { base32Secret: string; expiresAt: number }> = new Map();

  constructor(private db: DatabaseService) {
    this.rateLimiter = new DistributedRateLimiter(db);
  }

  getRateLimiter(): DistributedRateLimiter {
    return this.rateLimiter;
  }

  /**
   * Cryptographically hash password using modern Argon2id asynchronously.
   */
  async hashPasswordArgon2(password: string): Promise<string> {
    return hashPasswordAsync(password);
  }

  /**
   * Synchronous password hashing using standard scrypt (retained for synchronous seeders/fixtures).
   */
  hashPassword(password: string): string {
    return hashPasswordSync(password);
  }

  /**
   * Alias for synchronous password hashing.
   */
  hashPasswordSync(password: string): string {
    return hashPasswordSync(password);
  }

  /**
   * Asynchronously verify password against Argon2id or legacy scrypt.
   */
  async verifyPasswordAsync(
    password: string,
    storedHash: string
  ): Promise<{ valid: boolean; needsRehash: boolean }> {
    return verifyPasswordAsync(password, storedHash);
  }

  /**
   * Synchronous verification fallback for legacy code paths.
   */
  verifyPassword(password: string, storedHash: string): boolean {
    if (!storedHash || !password) return false;
    if (storedHash.startsWith('LOCKED_')) return false;

    const parts = storedHash.split('$');
    if (parts.length === 3 && parts[0] === 'scrypt') {
      const salt = parts[1];
      const key = parts[2];
      try {
        const derivedKey = crypto.scryptSync(password, salt, 64).toString('hex');
        return crypto.timingSafeEqual(Buffer.from(key, 'hex'), Buffer.from(derivedKey, 'hex'));
      } catch {
        return false;
      }
    }
    return false;
  }

  hashToken(token: string): string {
    return crypto.createHash('sha256').update(token.trim()).digest('hex');
  }

  generateLockedSentinelHash(prefix: 'LOCKED_INIT_PENDING' | 'LOCKED_DECOMMISSIONED' = 'LOCKED_INIT_PENDING'): string {
    const randomEntropy = crypto.randomBytes(32).toString('hex');
    return `${prefix}$${randomEntropy}`;
  }

  /**
   * Request password reset token.
   */
  async requestPasswordReset(identifier: string, ipAddress?: string): Promise<PasswordResetRequestResult> {
    const cleanId = (identifier || '').trim().toLowerCase();
    if (!cleanId) {
      throw new Error('IDENTIFIER_REQUIRED: Institutional ID or registered email is required');
    }

    const userRes = await this.db.query(
      `SELECT id, email, college_id, full_name, is_active FROM users
       WHERE LOWER(college_id) = $1 OR LOWER(email) = $1`,
      [cleanId]
    );

    const genericNeutralMessage =
      "If an eligible institutional account matches the supplied identifier, the password recovery request has been received. Follow the recovery instructions provided through your institution's approved process. For assistance, contact the Hostel Office Desk (OFF001).";

    if (userRes.rows.length === 0 || !userRes.rows[0].is_active || userRes.rows.length > 1) {
      await executeDummyPasswordVerification();
      testEmailOutbox.setLastDeliveryOutcome('NO_ACCOUNT_MATCH');
      return {
        success: true,
        message: genericNeutralMessage,
        status: 'REQUEST_ACCEPTED',
      };
    }

    const user = userRes.rows[0];
    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = this.hashToken(rawToken);
    const tokenId = `prt_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

    await this.db.query(
      `UPDATE password_reset_tokens SET used_at = CURRENT_TIMESTAMP
       WHERE user_id = $1 AND purpose = 'PASSWORD_RESET' AND used_at IS NULL`,
      [user.id]
    );

    await this.db.query(
      `INSERT INTO password_reset_tokens (id, user_id, token_hash, purpose, expires_at, requested_ip)
       VALUES ($1, $2, $3, 'PASSWORD_RESET', $4, $5)`,
      [tokenId, user.id, tokenHash, expiresAt.toISOString(), ipAddress || null]
    );

    const auditId = `aud_pwd_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    await this.db.query(
      `INSERT INTO audit_logs (id, actor_id, action, target_type, target_id, reason)
       VALUES ($1, $2, 'PASSWORD_RESET_REQUESTED', 'USER', $3, $4)`,
      [auditId, user.id, user.id, `Password reset token requested from IP ${ipAddress || 'unknown'}`]
    );

    const smtpConfigured = !!(process.env.SMTP_HOST && process.env.SMTP_USER);
    let internalOutcome: InternalDeliveryOutcome = 'OFFICE_ASSISTANCE';

    if (smtpConfigured) {
      internalOutcome = process.env.SIMULATE_SMTP_FAILURE === 'true' ? 'EMAIL_FAILED' : 'EMAIL_SENT';
    } else {
      internalOutcome = 'OFFICE_ASSISTANCE';
    }

    testEmailOutbox.setLastDeliveryOutcome(internalOutcome);

    if (process.env.NODE_ENV === 'test') {
      testEmailOutbox.record({
        to: user.email || user.college_id,
        subject: 'Institutional Password Reset Token (' + user.college_id + ')',
        token: rawToken,
        expiresAt,
        deliveryMethod: smtpConfigured ? 'EMAIL' : 'TEST_MAILER',
        dispatchedAt: new Date(),
        purpose: 'PASSWORD_RESET',
      });
    }

    return {
      success: true,
      message: genericNeutralMessage,
      status: 'REQUEST_ACCEPTED',
    };
  }

  /**
   * Reset password with single-use token.
   */
  async resetPasswordWithToken(rawToken: string, newPassword: string): Promise<{ success: boolean; message: string }> {
    if (!rawToken || rawToken.trim().length === 0) {
      throw new Error('TOKEN_REQUIRED: Password reset token is required');
    }
    const pwCheck = validatePasswordStrength(newPassword);
    if (!pwCheck.valid) {
      throw new Error(`WEAK_PASSWORD: ${pwCheck.error}`);
    }

    const tokenHash = this.hashToken(rawToken.trim());
    const now = new Date();

    return this.db.transaction(async (client) => {
      const tokenRes = await client.query(
        `SELECT * FROM password_reset_tokens
         WHERE token_hash = $1 AND purpose = 'PASSWORD_RESET'
         FOR UPDATE`,
        [tokenHash]
      );

      if (tokenRes.rows.length === 0) {
        throw new Error('INVALID_TOKEN: Password reset token is invalid or does not exist');
      }

      const tokenRecord = tokenRes.rows[0];

      if (tokenRecord.used_at !== null) {
        throw new Error('TOKEN_REUSED: Password reset token has already been consumed');
      }

      const expiresAt = new Date(tokenRecord.expires_at);
      if (expiresAt.getTime() <= now.getTime()) {
        throw new Error('TOKEN_EXPIRED: Password reset token has expired. Please request a new link.');
      }

      // Verify that the user account is active and has not been retired
      const userRes = await client.query(
        `SELECT id, is_active, password_hash FROM users WHERE id = $1 FOR UPDATE`,
        [tokenRecord.user_id]
      );
      if (userRes.rows.length === 0) {
        throw new Error('USER_NOT_FOUND: Linked institutional account does not exist');
      }
      const user = userRes.rows[0];
      if (!user.is_active || (user.password_hash && user.password_hash.startsWith('RETIRED_'))) {
        throw new Error('ACCOUNT_INACTIVE: Deactivated or retired accounts cannot reset passwords');
      }

      const newPasswordHash = await hashPasswordAsync(newPassword);

      await client.query(
        `UPDATE users 
         SET password_hash = $1, 
             session_version = session_version + 1, 
             updated_at = CURRENT_TIMESTAMP 
         WHERE id = $2`,
        [newPasswordHash, tokenRecord.user_id]
      );

      await client.query(
        `UPDATE password_reset_tokens SET used_at = CURRENT_TIMESTAMP WHERE id = $1`,
        [tokenRecord.id]
      );

      const auditId = `aud_pwd_reset_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
      await client.query(
        `INSERT INTO audit_logs (id, actor_id, action, target_type, target_id, reason)
         VALUES ($1, $2, 'PASSWORD_RESET_COMPLETED', 'USER', $3, $4)`,
        [auditId, tokenRecord.user_id, tokenRecord.user_id, 'Password successfully reset via token']
      );

      return {
        success: true,
        message: 'Your password has been successfully updated. You may now log in with your new password.',
      };
    });
  }

  /**
   * Issue an institutional account activation voucher.
   */
  async issueActivationVoucher(
    identifier: string,
    issuerUserId: string,
    ipAddress?: string
  ): Promise<ActivationVoucherResult> {
    const cleanId = (identifier || '').trim().toLowerCase();
    if (!cleanId) {
      throw new Error('IDENTIFIER_REQUIRED: Institutional identifier is required to issue activation voucher');
    }

    const userRes = await this.db.query(
      `SELECT id, college_id, email, full_name, is_active, password_hash
       FROM users
       WHERE LOWER(college_id) = $1 OR LOWER(email) = $1`,
      [cleanId]
    );

    if (userRes.rows.length === 0) {
      throw new Error('USER_NOT_FOUND: No institutional user found matching the provided identifier');
    }
    if (userRes.rows.length > 1) {
      throw new Error('AMBIGUOUS_IDENTIFIER: Multiple accounts matched the provided identifier');
    }

    const user = userRes.rows[0];
    if (!user.is_active) {
      throw new Error('ACCOUNT_INACTIVE: Inactive accounts cannot be issued an activation voucher');
    }

    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = this.hashToken(rawToken);
    const tokenId = `act_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000);

    await this.db.query(
      `UPDATE password_reset_tokens 
       SET used_at = CURRENT_TIMESTAMP 
       WHERE user_id = $1 AND purpose = 'ACTIVATION' AND used_at IS NULL`,
      [user.id]
    );

    await this.db.query(
      `INSERT INTO password_reset_tokens (id, user_id, token_hash, purpose, expires_at, requested_ip)
       VALUES ($1, $2, $3, 'ACTIVATION', $4, $5)`,
      [tokenId, user.id, tokenHash, expiresAt.toISOString(), ipAddress || null]
    );

    const auditId = `aud_act_issue_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    await this.db.query(
      `INSERT INTO audit_logs (id, actor_id, action, target_type, target_id, reason)
       VALUES ($1, $2, 'ACTIVATION_VOUCHER_ISSUED', 'USER', $3, $4)`,
      [auditId, issuerUserId, user.id, `Activation voucher issued for ${user.college_id} from ${ipAddress || 'internal'}`]
    );

    if (process.env.NODE_ENV === 'test') {
      testEmailOutbox.record({
        to: user.email || user.college_id,
        subject: 'Institutional Account Activation Voucher',
        token: rawToken,
        expiresAt,
        deliveryMethod: 'OFFICE_ASSISTANCE',
        dispatchedAt: new Date(),
        purpose: 'ACTIVATION',
      });
    }

    return {
      success: true,
      voucherId: tokenId,
      token: rawToken,
      userId: user.id,
      collegeId: user.college_id,
      fullName: user.full_name,
      expiresAt,
    };
  }

  /**
   * Activate account with single-use activation token.
   */
  async activateAccountWithToken(
    rawToken: string,
    initialPassword: string
  ): Promise<AccountActivationResult> {
    if (!rawToken || rawToken.trim().length === 0) {
      throw new Error('TOKEN_REQUIRED: Activation token is required');
    }
    const pwCheck = validatePasswordStrength(initialPassword);
    if (!pwCheck.valid) {
      throw new Error(`WEAK_PASSWORD: ${pwCheck.error?.replace('Password', 'Initial password')}`);
    }

    const tokenHash = this.hashToken(rawToken.trim());
    const now = new Date();

    return this.db.transaction(async (client) => {
      const tokenRes = await client.query(
        `SELECT * FROM password_reset_tokens
         WHERE token_hash = $1 AND purpose = 'ACTIVATION'
         FOR UPDATE`,
        [tokenHash]
      );

      if (tokenRes.rows.length === 0) {
        throw new Error('INVALID_TOKEN: Activation token is invalid or does not exist');
      }

      const tokenRecord = tokenRes.rows[0];

      if (tokenRecord.used_at !== null) {
        throw new Error('TOKEN_REUSED: Activation token has already been consumed');
      }

      const expiresAt = new Date(tokenRecord.expires_at);
      if (expiresAt.getTime() <= now.getTime()) {
        throw new Error('TOKEN_EXPIRED: Activation token has expired. Please contact the Hostel Office Desk.');
      }

      const userRes = await client.query(
        `SELECT id, college_id, is_active, password_hash FROM users WHERE id = $1 FOR UPDATE`,
        [tokenRecord.user_id]
      );

      if (userRes.rows.length === 0) {
        throw new Error('USER_NOT_FOUND: Linked institutional account does not exist');
      }

      const user = userRes.rows[0];
      if (!user.is_active || (user.password_hash && user.password_hash.startsWith('RETIRED_'))) {
        throw new Error('ACCOUNT_INACTIVE: Deactivated or retired accounts cannot be activated');
      }

      const modernHash = await hashPasswordAsync(initialPassword);

      await client.query(
        `UPDATE users 
         SET password_hash = $1, 
             session_version = session_version + 1, 
             updated_at = CURRENT_TIMESTAMP 
         WHERE id = $2`,
        [modernHash, user.id]
      );

      await client.query(
        `UPDATE password_reset_tokens SET used_at = CURRENT_TIMESTAMP WHERE id = $1`,
        [tokenRecord.id]
      );

      const auditId = `aud_act_comp_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
      await client.query(
        `INSERT INTO audit_logs (id, actor_id, action, target_type, target_id, reason)
         VALUES ($1, $2, 'ACCOUNT_ACTIVATED', 'USER', $3, $4)`,
        [auditId, user.id, user.id, `Institutional account successfully activated with Argon2id credentials`]
      );

      return {
        success: true,
        message: 'Your institutional account has been successfully activated. You may now log in.',
        userId: user.id,
        collegeId: user.college_id,
      };
    });
  }

  // =========================================================================
  // TOTP MFA ENGINE, ENROLLMENT, VERIFICATION & RECOVERY CODES
  // =========================================================================

  /**
   * Initiate MFA Enrollment for the authenticated user.
   * Generates a 20-byte cryptographically secure pending secret, stored in memory for 10 minutes.
   */
  async initiateMfaEnrollment(userId: string): Promise<MfaEnrollmentInitResult> {
    const userRes = await this.db.query(
      `SELECT u.id, u.college_id, u.email, u.full_name, m.is_enabled
       FROM users u
       LEFT JOIN user_mfa_settings m ON u.id = m.user_id
       WHERE u.id = $1`,
      [userId]
    );

    if (userRes.rows.length === 0) {
      throw new Error('USER_NOT_FOUND: Authenticated user not found');
    }

    const user = userRes.rows[0];
    if (user.is_enabled) {
      throw new Error('MFA_ALREADY_ENROLLED: MFA is already active. Use reset flow to change device.');
    }

    const { rawSecret, base32Secret } = generateTotpSecret();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes expiry

    this.pendingEnrollments.set(userId, {
      base32Secret,
      expiresAt: expiresAt.getTime(),
    });

    const issuer = 'DORMEX SIT';
    const accountName = user.college_id;
    const keyUri = generateKeyUri(accountName, issuer, base32Secret);

    const auditId = `aud_mfa_init_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    await this.db.query(
      `INSERT INTO audit_logs (id, actor_id, action, target_type, target_id, reason)
       VALUES ($1, $2, 'MFA_ENROLLMENT_INITIATED', 'USER', $2, 'User requested TOTP MFA enrollment setup')`,
      [auditId, userId]
    );

    return {
      success: true,
      base32Secret,
      keyUri,
      accountName,
      issuer,
      expiresAt,
    };
  }

  /**
   * Finalize MFA Enrollment with code verification.
   * Encrypts secret with AES-256-GCM, generates 8 recovery codes, and marks MFA enrolled.
   */
  async finalizeMfaEnrollment(userId: string, code: string): Promise<MfaVerificationResult> {
    const pending = this.pendingEnrollments.get(userId);
    if (!pending) {
      throw new Error('ENROLLMENT_EXPIRED: No pending enrollment session found. Please initiate setup again.');
    }

    if (Date.now() > pending.expiresAt) {
      this.pendingEnrollments.delete(userId);
      throw new Error('ENROLLMENT_EXPIRED: Setup session has expired. Please initiate setup again.');
    }

    const { valid, matchedStep } = verifyTotpCode(pending.base32Secret, code);
    if (!valid || matchedStep === null) {
      throw new Error('INVALID_MFA_CODE: Verification code does not match authenticator.');
    }

    // Encrypt secret with AES-256-GCM (Key Version 1)
    const encrypted = encryptAesGcm(pending.base32Secret, 1);

    // Generate 8 single-use recovery codes and hash them with Argon2id
    const recoveryCodes = generateRecoveryCodes(8);
    const recoveryCodeHashes: string[] = [];
    for (const rc of recoveryCodes) {
      recoveryCodeHashes.push(await hashRecoveryCode(rc));
    }

    const mfaSettingId = `mfa_${crypto.randomBytes(12).toString('hex')}`;

    // Atomically persist in user_mfa_settings and bump session_version
    await this.db.transaction(async (client) => {
      await client.query(
        `INSERT INTO user_mfa_settings (
           id, user_id, encrypted_secret, secret_iv, secret_tag, key_version,
           is_enabled, enrolled_at, last_verified_step, recovery_code_hashes
         ) VALUES ($1, $2, $3, $4, $5, $6, TRUE, CURRENT_TIMESTAMP, $7, $8)
         ON CONFLICT (user_id) DO UPDATE SET
           encrypted_secret = EXCLUDED.encrypted_secret,
           secret_iv = EXCLUDED.secret_iv,
           secret_tag = EXCLUDED.secret_tag,
           key_version = EXCLUDED.key_version,
           is_enabled = TRUE,
           enrolled_at = CURRENT_TIMESTAMP,
           last_verified_step = EXCLUDED.last_verified_step,
           recovery_code_hashes = EXCLUDED.recovery_code_hashes,
           updated_at = CURRENT_TIMESTAMP`,
        [
          mfaSettingId,
          userId,
          encrypted.ciphertext,
          encrypted.iv,
          encrypted.tag,
          encrypted.keyVersion,
          matchedStep,
          recoveryCodeHashes,
        ]
      );

      // Increment session_version to force fresh MFA-level token issuance
      await client.query(`UPDATE users SET session_version = session_version + 1 WHERE id = $1`, [userId]);

      const auditId = `aud_mfa_enrolled_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
      await client.query(
        `INSERT INTO audit_logs (id, actor_id, action, target_type, target_id, reason)
         VALUES ($1, $2, 'MFA_ENROLLMENT_COMPLETED', 'USER', $2, 'User successfully enrolled TOTP authenticator')`,
        [auditId, userId]
      );
    });

    this.pendingEnrollments.delete(userId);

    return {
      success: true,
      message: 'MFA enrolled successfully. Save these recovery codes in a secure location.',
      recoveryCodes,
    };
  }

  /**
   * Verify TOTP code for an active user with atomic database anti-replay guard.
   */
  async verifyTotpForUser(userId: string, code: string): Promise<boolean> {
    const mfaRes = await this.db.query(
      `SELECT * FROM user_mfa_settings WHERE user_id = $1 AND is_enabled = TRUE`,
      [userId]
    );

    if (mfaRes.rows.length === 0) {
      throw new Error('MFA_NOT_ENROLLED: User does not have an active MFA registration');
    }

    const mfa = mfaRes.rows[0];

    // Decrypt secret using AES-256-GCM
    const decryptedBuffer = decryptAesGcm({
      ciphertext: mfa.encrypted_secret,
      iv: mfa.secret_iv,
      tag: mfa.secret_tag,
      keyVersion: mfa.key_version,
    });
    const base32Secret = decryptedBuffer.toString('utf8');

    // Verify TOTP code against drift window
    const { valid, matchedStep } = verifyTotpCode(base32Secret, code);
    if (!valid || matchedStep === null) {
      const auditId = `aud_mfa_fail_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
      await this.db.query(
        `INSERT INTO audit_logs (id, actor_id, action, target_type, target_id, reason)
         VALUES ($1, $2, 'MFA_VERIFICATION_FAILED', 'USER', $2, 'Invalid TOTP code supplied')`,
        [auditId, userId]
      );
      return false;
    }

    // Atomic database replay protection:
    // Determination of exact matched timestep ($matchedStep) is persisted.
    // Condition `last_verified_step < $matchedStep` guarantees no replay within window.
    const updateResult = await this.db.query(
      `UPDATE user_mfa_settings
       SET last_verified_step = $1,
           updated_at = CURRENT_TIMESTAMP
       WHERE user_id = $2
         AND last_verified_step < $1
       RETURNING id;`,
      [matchedStep, userId]
    );

    if (updateResult.rows.length === 0) {
      // Replay attempt detected
      const auditId = `aud_mfa_replay_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
      await this.db.query(
        `INSERT INTO audit_logs (id, actor_id, action, target_type, target_id, reason)
         VALUES ($1, $2, 'MFA_REPLAY_DETECTED', 'USER', $2, 'Rejected duplicate TOTP code consumption in timestep window')`,
        [auditId, userId]
      );
      throw new Error('TOTP_CODE_ALREADY_USED: This authentication code was already verified.');
    }

    const auditId = `aud_mfa_ok_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    await this.db.query(
      `INSERT INTO audit_logs (id, actor_id, action, target_type, target_id, reason)
       VALUES ($1, $2, 'MFA_VERIFIED', 'USER', $2, 'TOTP verification successful')`,
      [auditId, userId]
    );

    return true;
  }

  /**
   * Verify and consume a single-use recovery code.
   */
  async consumeRecoveryCode(userId: string, rawCode: string): Promise<{ success: boolean; remainingCodes: number }> {
    return this.db.transaction(async (client) => {
      const mfaRes = await client.query(
        `SELECT * FROM user_mfa_settings WHERE user_id = $1 AND is_enabled = TRUE FOR UPDATE`,
        [userId]
      );

      if (mfaRes.rows.length === 0) {
        throw new Error('MFA_NOT_ENROLLED: User does not have active MFA settings');
      }

      const mfa = mfaRes.rows[0];
      const hashes = mfa.recovery_code_hashes || [];

      const matchIdx = await verifyRecoveryCode(rawCode, hashes);
      if (matchIdx === -1) {
        const auditId = `aud_rc_fail_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
        await client.query(
          `INSERT INTO audit_logs (id, actor_id, action, target_type, target_id, reason)
           VALUES ($1, $2, 'RECOVERY_CODE_FAILED', 'USER', $2, 'Invalid recovery code attempt')`,
          [auditId, userId]
        );
        return { success: false, remainingCodes: hashes.length };
      }

      const matchedHash = hashes[matchIdx];
      // In MemoryDatabaseService (pg-mem), array_remove may not be natively supported
      // Filter out the matched hash in memory and update the array
      const remainingHashes = hashes.filter((h: string) => h !== matchedHash);

      await client.query(
        `UPDATE user_mfa_settings
         SET recovery_code_hashes = $1,
             updated_at = CURRENT_TIMESTAMP
         WHERE user_id = $2`,
        [remainingHashes, userId]
      );

      const auditId = `aud_rc_ok_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
      await client.query(
        `INSERT INTO audit_logs (id, actor_id, action, target_type, target_id, reason)
         VALUES ($1, $2, 'RECOVERY_CODE_CONSUMED', 'USER', $2, 'Emergency recovery code successfully consumed')`,
        [auditId, userId]
      );

      return { success: true, remainingCodes: remainingHashes.length };
    });
  }

  /**
   * Create an in-flight short-lived MFA login challenge for privileged accounts.
   */
  createMfaChallenge(user: { id: string; role_name: string; college_id: string }): string {
    const challengeToken = `mfa_ch_${Date.now()}_${crypto.randomBytes(16).toString('hex')}`;
    this.pendingMfaChallenges.set(challengeToken, {
      token: challengeToken,
      userId: user.id,
      role: user.role_name,
      collegeId: user.college_id,
      expiresAt: Date.now() + 5 * 60 * 1000, // 5 minutes
    });
    return challengeToken;
  }

  /**
   * Consume an in-flight MFA login challenge atomically.
   */
  consumeMfaChallenge(challengeToken: string): MfaChallengeRecord {
    const record = this.pendingMfaChallenges.get(challengeToken);
    if (!record) {
      throw new Error('INVALID_MFA_CHALLENGE: Challenge token does not exist or was already consumed');
    }
    if (Date.now() > record.expiresAt) {
      this.pendingMfaChallenges.delete(challengeToken);
      throw new Error('CHALLENGE_EXPIRED: MFA challenge has expired. Please sign in again.');
    }
    this.pendingMfaChallenges.delete(challengeToken);
    return record;
  }

  /**
   * Reset user's MFA settings (administrative or verified emergency self-service).
   * Atomically disables MFA, clears secret and recovery codes, and bumps session_version to revoke old sessions.
   */
  async resetUserMfa(
    targetUserId: string,
    actorId: string,
    reason: string
  ): Promise<{ success: boolean; message: string }> {
    return this.db.transaction(async (client) => {
      const userRes = await client.query(
        `SELECT id, college_id FROM users WHERE id = $1 FOR UPDATE`,
        [targetUserId]
      );
      if (userRes.rows.length === 0) {
        throw new Error('USER_NOT_FOUND: User not found for MFA reset');
      }

      await client.query(
        `DELETE FROM user_mfa_settings WHERE user_id = $1`,
        [targetUserId]
      );

      // Increment session_version to revoke any active sessions (including privileged ones)
      await client.query(
        `UPDATE users 
         SET session_version = session_version + 1, 
             updated_at = CURRENT_TIMESTAMP 
         WHERE id = $1`,
        [targetUserId]
      );

      const auditId = `aud_mfa_reset_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
      await client.query(
        `INSERT INTO audit_logs (id, actor_id, action, target_type, target_id, reason)
         VALUES ($1, $2, 'MFA_RESET_COMPLETED', 'USER', $3, $4)`,
        [auditId, actorId, targetUserId, `MFA configuration reset and sessions revoked: ${reason}`]
      );

      return {
        success: true,
        message: 'MFA configuration has been reset and all active sessions revoked.',
      };
    });
  }

  /**
   * Explicitly invalidate all sessions for a user (session revocation).
   */
  async revokeUserSessions(
    targetUserId: string,
    actorId: string,
    reason: string
  ): Promise<{ success: boolean; newSessionVersion: number }> {
    const res = await this.db.query(
      `UPDATE users 
       SET session_version = session_version + 1,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $1
       RETURNING session_version;`,
      [targetUserId]
    );

    if (res.rows.length === 0) {
      throw new Error('USER_NOT_FOUND: Target user does not exist');
    }

    const newVer = Number(res.rows[0].session_version);
    const auditId = `aud_rev_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    await this.db.query(
      `INSERT INTO audit_logs (id, actor_id, action, target_type, target_id, reason)
       VALUES ($1, $2, 'SESSIONS_REVOKED', 'USER', $3, $4)`,
      [auditId, actorId, targetUserId, reason]
    );

    return {
      success: true,
      newSessionVersion: newVer,
    };
  }

  /**
   * Deactivate a user account and immediately invalidate all active sessions.
   */
  async deactivateUser(
    targetUserId: string,
    actorId: string,
    reason: string
  ): Promise<{ success: boolean }> {
    return this.db.transaction(async (client) => {
      const res = await client.query(
        `UPDATE users 
         SET is_active = FALSE,
             session_version = session_version + 1,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $1
         RETURNING college_id;`,
        [targetUserId]
      );

      if (res.rows.length === 0) {
        throw new Error('USER_NOT_FOUND: Target user does not exist');
      }

      const auditId = `aud_deact_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
      await client.query(
        `INSERT INTO audit_logs (id, actor_id, action, target_type, target_id, reason)
         VALUES ($1, $2, 'ACCOUNT_DEACTIVATED', 'USER', $3, $4)`,
        [auditId, actorId, targetUserId, reason]
      );

      return { success: true };
    });
  }

  /**
   * Check if a user has enrolled and enabled MFA.
   */
  async isUserMfaEnrolled(userId: string): Promise<boolean> {
    const res = await this.db.query(
      `SELECT is_enabled FROM user_mfa_settings WHERE user_id = $1`,
      [userId]
    );
    return res.rows.length > 0 && res.rows[0].is_enabled === true;
  }
}
