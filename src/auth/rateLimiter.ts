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
      // First check if already blocked
      const existingRes = await this.db.query(
        `SELECT attempts, window_start_at, blocked_until FROM auth_rate_limits WHERE key_hash = $1`,
        [keyHash]
      );

      if (existingRes.rows.length > 0) {
        const row = existingRes.rows[0];
        if (row.blocked_until && new Date(row.blocked_until) > now) {
          return {
            allowed: false,
            attempts: row.attempts,
            remaining: 0,
            blockedUntil: new Date(row.blocked_until),
          };
        }
      }

      // Upsert attempt count
      const result = await this.db.query(
        `INSERT INTO auth_rate_limits (key_hash, attempts, window_start_at, blocked_until, updated_at)
         VALUES ($1, 1, CURRENT_TIMESTAMP, NULL, CURRENT_TIMESTAMP)
         ON CONFLICT (key_hash) DO UPDATE
         SET attempts = CASE 
                 WHEN auth_rate_limits.window_start_at < CURRENT_TIMESTAMP - ($2 || ' seconds')::INTERVAL THEN 1
                 ELSE auth_rate_limits.attempts + 1
             END,
             window_start_at = CASE 
                 WHEN auth_rate_limits.window_start_at < CURRENT_TIMESTAMP - ($2 || ' seconds')::INTERVAL THEN CURRENT_TIMESTAMP
                 ELSE auth_rate_limits.window_start_at
             END,
             blocked_until = CASE
                 WHEN (CASE WHEN auth_rate_limits.window_start_at < CURRENT_TIMESTAMP - ($2 || ' seconds')::INTERVAL THEN 1 ELSE auth_rate_limits.attempts + 1 END) >= $3
                 THEN CURRENT_TIMESTAMP + ($4 || ' seconds')::INTERVAL
                 ELSE NULL
             END,
             updated_at = CURRENT_TIMESTAMP
         RETURNING attempts, blocked_until;`,
        [keyHash, windowSeconds.toString(), maxAttempts, lockoutSeconds.toString()]
      );

      const row = result.rows[0];
      const attempts = row.attempts;
      const blockedUntil = row.blocked_until ? new Date(row.blocked_until) : undefined;
      const allowed = attempts <= maxAttempts && !blockedUntil;

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
      const res = await this.db.query(
        `DELETE FROM auth_rate_limits 
         WHERE (blocked_until IS NOT NULL AND blocked_until < CURRENT_TIMESTAMP)
            OR (blocked_until IS NULL AND updated_at < CURRENT_TIMESTAMP - INTERVAL '1 hour')`
      );
      return res.rowCount || 0;
    } catch {
      return 0;
    }
  }
}
