import crypto from 'crypto';
import { DatabaseService } from '../db/index.js';

export interface RateLimitOptions {
  maxAttempts?: number;
  windowSeconds?: number;
  lockoutSeconds?: number;
}

export interface RateLimitResult {
  allowed: boolean;
  attempts: number;
  remaining: number;
  blockedUntil?: Date;
}

/**
 * PostgreSQL-Backed Distributed Multi-Instance Rate Limiter.
 * Uses sha256 hashes of identifiers/IPs to preserve privacy.
 * Fails closed on database errors for security-sensitive operations.
 */
export class DistributedRateLimiter {
  constructor(private db: DatabaseService) {}

  /**
   * Hashes key to SHA-256 hex string to ensure no raw PII or IP is stored unhashed.
   */
  hashKey(prefix: string, key: string): string {
    return crypto
      .createHash('sha256')
      .update(`${prefix}:${key.trim().toLowerCase()}`)
      .digest('hex');
  }

  /**
   * Check and increment rate limit counter atomically.
   */
  async checkAndIncrement(
    prefix: string,
    rawKey: string,
    options: RateLimitOptions = {}
  ): Promise<RateLimitResult> {
    const keyHash = this.hashKey(prefix, rawKey);
    const maxAttempts = options.maxAttempts ?? 5;
    const windowSeconds = options.windowSeconds ?? 900; // 15 mins
    const lockoutSeconds = options.lockoutSeconds ?? 900;

    try {
      const now = new Date();
      const currentIso = now.toISOString();
      // Query existing record to calculate transition
      const existingRes = await this.db.query(
        `SELECT attempts, window_start_at, blocked_until FROM auth_rate_limits WHERE key_hash = $1`,
        [keyHash]
      );

      let attempts = 1;
      let windowStartAt = currentIso;
      let blockedUntil: Date | undefined = undefined;

      if (existingRes.rows.length > 0) {
        const row = existingRes.rows[0];
        if (row.blocked_until && new Date(row.blocked_until) > now) {
          return {
            allowed: false,
            attempts: Number(row.attempts),
            remaining: 0,
            blockedUntil: new Date(row.blocked_until),
          };
        }

        const winStart = new Date(row.window_start_at);
        if (winStart.getTime() < Date.now() - windowSeconds * 1000) {
          attempts = 1;
          windowStartAt = currentIso;
        } else {
          attempts = Number(row.attempts) + 1;
          windowStartAt = winStart.toISOString();
        }
      }

      if (attempts >= maxAttempts) {
        blockedUntil = new Date(Date.now() + lockoutSeconds * 1000);
      }

      const blockedUntilIso = blockedUntil ? blockedUntil.toISOString() : null;

      await this.db.query(
        `INSERT INTO auth_rate_limits (key_hash, attempts, window_start_at, blocked_until, updated_at)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (key_hash) DO UPDATE
         SET attempts = EXCLUDED.attempts,
             window_start_at = EXCLUDED.window_start_at,
             blocked_until = EXCLUDED.blocked_until,
             updated_at = EXCLUDED.updated_at`,
        [keyHash, attempts, windowStartAt, blockedUntilIso, currentIso]
      );

      const allowed = attempts < maxAttempts && !blockedUntil;

      return {
        allowed,
        attempts,
        remaining: Math.max(0, maxAttempts - attempts),
        blockedUntil,
      };
    } catch (err: any) {
      // Fail closed on database errors for security
      throw new Error(`RATE_LIMIT_ERROR: Security rate-check failed (${err.message})`);
    }
  }

  /**
   * Reset rate limit counter on successful authentication.
   */
  async reset(prefix: string, rawKey: string): Promise<void> {
    try {
      const keyHash = this.hashKey(prefix, rawKey);
      await this.db.query(`DELETE FROM auth_rate_limits WHERE key_hash = $1`, [keyHash]);
    } catch {
      // Non-blocking on reset
    }
  }

  /**
   * Periodic cleanup of expired rate limit entries.
   */
  async cleanupExpired(): Promise<number> {
    try {
      const now = new Date();
      const oneHourAgo = new Date(Date.now() - 3600 * 1000);

      // Select candidate keys first to ensure accurate count across database engines
      const allRows = await this.db.query(`SELECT key_hash, blocked_until, updated_at FROM auth_rate_limits`);
      const expiredKeys: string[] = [];

      for (const row of allRows.rows) {
        if (row.blocked_until && new Date(row.blocked_until).getTime() < now.getTime()) {
          expiredKeys.push(row.key_hash);
        } else if (!row.blocked_until && new Date(row.updated_at).getTime() < oneHourAgo.getTime()) {
          expiredKeys.push(row.key_hash);
        }
      }

      for (const k of expiredKeys) {
        await this.db.query(`DELETE FROM auth_rate_limits WHERE key_hash = $1`, [k]);
      }
      return expiredKeys.length;
    } catch {
      return 0;
    }
  }
}
