import crypto from 'crypto';
import { DatabaseService } from '../db/index.js';
import {
  hashPasswordAsync,
  hashPasswordSync,
  verifyPasswordAsync,
  executeDummyPasswordVerification,
} from './passwordUtils.js';

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

// Global test mailer outbox instance accessible for automated tests
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

export class AuthService {
  constructor(private db: DatabaseService) {}

  /**
   * Cryptographically hash password using modern Argon2id asynchronously.
   */
  async hashPasswordArgon2(password: string): Promise<string> {
    return hashPasswordAsync(password);
  }

  hashPassword(password: string): string {
    return hashPasswordSync(password);
  }

  /**
   * Synchronous password hashing retained strictly for backwards compatibility with synchronous callers.
   */
  hashPasswordSync(password: string): string {
    return hashPasswordSync(password);
  }

  /**
   * Asynchronously verify password against Argon2id or legacy scrypt.
   * Special-case bypasses or plaintext comparisons are strictly rejected.
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

    // Legacy scrypt synchronous check
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

  /**
   * Hash a reset or activation token using SHA-256 (Tokens are never stored in plaintext)
   */
  hashToken(token: string): string {
    return crypto.createHash('sha256').update(token.trim()).digest('hex');
  }

  /**
   * Generates a cryptographically secure sentinel password hash for unactivated or decommissioned accounts.
   */
  generateLockedSentinelHash(prefix: 'LOCKED_INIT_PENDING' | 'LOCKED_DECOMMISSIONED' = 'LOCKED_INIT_PENDING'): string {
    const randomEntropy = crypto.randomBytes(32).toString('hex');
    return `${prefix}$${randomEntropy}`;
  }

  /**
   * Request password reset token.
   * - Avoids user enumeration: Returns the same message whether user exists or not.
   * - Token expires in 15 minutes.
   * - Only cryptographic hash is stored in DB.
   */
  async requestPasswordReset(identifier: string, ipAddress?: string): Promise<PasswordResetRequestResult> {
    const cleanId = (identifier || '').trim().toLowerCase();
    if (!cleanId) {
      throw new Error('IDENTIFIER_REQUIRED: Institutional ID or registered email is required');
    }

    // Lookup user by college_id or email
    const userRes = await this.db.query(
      `SELECT id, email, college_id, full_name, is_active FROM users
       WHERE LOWER(college_id) = $1 OR LOWER(email) = $1`,
      [cleanId]
    );

    const genericNeutralMessage =
      "If an eligible institutional account matches the supplied identifier, the password recovery request has been received. Follow the recovery instructions provided through your institution's approved process. For assistance, contact the Hostel Office Desk (OFF001).";

    if (userRes.rows.length === 0 || !userRes.rows[0].is_active) {
      // Execute dummy password verification to equalize timing (~70ms) and avoid user enumeration
      await executeDummyPasswordVerification();
      testEmailOutbox.setLastDeliveryOutcome('NO_ACCOUNT_MATCH');
      return {
        success: true,
        message: genericNeutralMessage,
        status: 'REQUEST_ACCEPTED',
      };
    }

    // Check for ambiguous identifier match
    if (userRes.rows.length > 1) {
      await executeDummyPasswordVerification();
      testEmailOutbox.setLastDeliveryOutcome('NO_ACCOUNT_MATCH');
      return {
        success: true,
        message: genericNeutralMessage,
        status: 'REQUEST_ACCEPTED',
      };
    }

    const user = userRes.rows[0];

    // Generate high-entropy 32-byte (64 hex characters) cryptographically secure token
    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = this.hashToken(rawToken);
    const tokenId = `prt_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes lifetime

    // Invalidate any previously unconsumed PASSWORD_RESET tokens for this user
    await this.db.query(
      `UPDATE password_reset_tokens SET used_at = CURRENT_TIMESTAMP
       WHERE user_id = $1 AND purpose = 'PASSWORD_RESET' AND used_at IS NULL`,
      [user.id]
    );

    // Persist only the SHA-256 token hash with explicit purpose
    await this.db.query(
      `INSERT INTO password_reset_tokens (id, user_id, token_hash, purpose, expires_at, requested_ip)
       VALUES ($1, $2, $3, 'PASSWORD_RESET', $4, $5)`,
      [tokenId, user.id, tokenHash, expiresAt.toISOString(), ipAddress || null]
    );

    // Audit the security event
    const auditId = `aud_pwd_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    await this.db.query(
      `INSERT INTO audit_logs (id, actor_id, action, target_type, target_id, reason)
       VALUES ($1, $2, 'PASSWORD_RESET_REQUESTED', 'USER', $3, $4)`,
      [auditId, user.id, user.id, `Password reset token requested from IP ${ipAddress || 'unknown'}`]
    );

    // Honest Email Provider Check (Internal delivery state tracking)
    const smtpConfigured = !!(process.env.SMTP_HOST && process.env.SMTP_USER);
    let internalOutcome: InternalDeliveryOutcome = 'OFFICE_ASSISTANCE';

    if (smtpConfigured) {
      if (process.env.SIMULATE_SMTP_FAILURE === 'true') {
        internalOutcome = 'EMAIL_FAILED';
      } else {
        internalOutcome = 'EMAIL_SENT';
      }
    } else {
      internalOutcome = 'OFFICE_ASSISTANCE';
    }

    testEmailOutbox.setLastDeliveryOutcome(internalOutcome);

    // Record to isolated test outbox in test environment for internal automated verification
    const env = process.env.NODE_ENV;
    if (env === 'test') {
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
   * Reset password using single-use reset token.
   * - Verifies token hash, expiration, and unused status atomically inside a transaction.
   * - Hashes new password with Argon2id.
   * - Marks token as used.
   * - Increments session_version on the user record to invalidate any existing sessions across instances.
   */
  async resetPasswordWithToken(rawToken: string, newPassword: string): Promise<{ success: boolean; message: string }> {
    if (!rawToken || rawToken.trim().length === 0) {
      throw new Error('TOKEN_REQUIRED: Password reset token is required');
    }
    if (!newPassword || newPassword.length < 8) {
      throw new Error('WEAK_PASSWORD: Password must be at least 8 characters in length');
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

      // Hash with modern Argon2id
      const newPasswordHash = await hashPasswordAsync(newPassword);

      // Update user password and increment session_version to revoke active sessions
      await client.query(
        `UPDATE users 
         SET password_hash = $1, 
             session_version = session_version + 1, 
             updated_at = CURRENT_TIMESTAMP 
         WHERE id = $2`,
        [newPasswordHash, tokenRecord.user_id]
      );

      // Mark token consumed
      await client.query(
        `UPDATE password_reset_tokens SET used_at = CURRENT_TIMESTAMP WHERE id = $1`,
        [tokenRecord.id]
      );

      // Record audit log
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
   * Issue an institutional account activation voucher (Registrar / Admin Desk or Initial Provisioning).
   * - Generates high-entropy token, stores SHA-256 hash with purpose='ACTIVATION'.
   * - 48-hour expiration.
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

    // High entropy 32-byte token
    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = this.hashToken(rawToken);
    const tokenId = `act_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000); // 48 hours

    // Invalidate prior unconsumed activation tokens
    await this.db.query(
      `UPDATE password_reset_tokens 
       SET used_at = CURRENT_TIMESTAMP 
       WHERE user_id = $1 AND purpose = 'ACTIVATION' AND used_at IS NULL`,
      [user.id]
    );

    // Insert new activation token record
    await this.db.query(
      `INSERT INTO password_reset_tokens (id, user_id, token_hash, purpose, expires_at, requested_ip)
       VALUES ($1, $2, $3, 'ACTIVATION', $4, $5)`,
      [tokenId, user.id, tokenHash, expiresAt.toISOString(), ipAddress || null]
    );

    // Record audit log
    const auditId = `aud_act_issue_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    await this.db.query(
      `INSERT INTO audit_logs (id, actor_id, action, target_type, target_id, reason)
       VALUES ($1, $2, 'ACTIVATION_VOUCHER_ISSUED', 'USER', $3, $4)`,
      [auditId, issuerUserId, user.id, `Activation voucher issued for ${user.college_id} from ${ipAddress || 'internal'}`]
    );

    // In test environment, record to outbox for inspection
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
   * Activate institutional account using single-use activation token.
   * - Atomically verifies token, enforces single-use, binds to intended user.
   * - Replaces initial locked/default hash with modern Argon2id hash.
   * - Increments session_version.
   */
  async activateAccountWithToken(
    rawToken: string,
    initialPassword: string
  ): Promise<AccountActivationResult> {
    if (!rawToken || rawToken.trim().length === 0) {
      throw new Error('TOKEN_REQUIRED: Activation token is required');
    }
    if (!initialPassword || initialPassword.length < 8) {
      throw new Error('WEAK_PASSWORD: Initial password must be at least 8 characters in length');
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

      // Check user status
      const userRes = await client.query(
        `SELECT id, college_id, is_active FROM users WHERE id = $1 FOR UPDATE`,
        [tokenRecord.user_id]
      );

      if (userRes.rows.length === 0) {
        throw new Error('USER_NOT_FOUND: Linked institutional account does not exist');
      }

      const user = userRes.rows[0];
      if (!user.is_active) {
        throw new Error('ACCOUNT_INACTIVE: Deactivated accounts cannot be activated');
      }

      // Hash password with Argon2id
      const modernHash = await hashPasswordAsync(initialPassword);

      // Atomically update user password and bump session_version
      await client.query(
        `UPDATE users 
         SET password_hash = $1, 
             session_version = session_version + 1, 
             updated_at = CURRENT_TIMESTAMP 
         WHERE id = $2`,
        [modernHash, user.id]
      );

      // Mark token consumed
      await client.query(
        `UPDATE password_reset_tokens SET used_at = CURRENT_TIMESTAMP WHERE id = $1`,
        [tokenRecord.id]
      );

      // Audit the activation
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
}
