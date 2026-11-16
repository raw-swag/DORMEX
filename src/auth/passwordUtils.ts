import crypto from 'crypto';
import util from 'util';
import argon2 from 'argon2';

const scryptAsync = util.promisify(crypto.scrypt);

export const ARGON2_CONFIG: argon2.HashOptions = {
  type: argon2.argon2id,
  timeCost: 3,
  memoryCost: 65536, // 64 MB
  parallelism: 4,
};

// Maximum password length to mitigate Denial-of-Service / memory blowup on extreme inputs
export const MAX_PASSWORD_LENGTH = 1024;
export const MIN_PASSWORD_LENGTH = 8;

export function validatePasswordStrength(password: string): { valid: boolean; error?: string } {
  if (!password || typeof password !== 'string') {
    return { valid: false, error: 'Password is required' };
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    return { valid: false, error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters in length` };
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    return { valid: false, error: `Password cannot exceed ${MAX_PASSWORD_LENGTH} characters` };
  }
  return { valid: true };
}

// Known dummy Argon2id hash used to equalize execution timing on invalid / nonexistent user lookups
export const DUMMY_ARGON2_HASH =
  '$argon2id$v=19$m=65536,t=3,p=4$4m9Yy5+Pq5XyUvXk3h4b9Q$DUMMYuD5Y+Pq5XyUvXk3h4b9Q4m9Yy5+Pq5XyUvXk3g';

/**
 * Modern Institutional Asynchronous Password Hashing & Verification Engine.
 * Supports:
 * 1. Standard Argon2id (v=19, timeCost=3, memoryCost=64MB, parallelism=4)
 * 2. Legacy scrypt (scrypt$<salt_hex>$<derivedKey_hex>) with async libuv execution
 * 3. Sentinel locked accounts (LOCKED_INIT_PENDING$*) which strictly fail closed
 */

/**
 * Asynchronously hash a password using modern Argon2id.
 */
export async function hashPasswordAsync(password: string): Promise<string> {
  if (!password || typeof password !== 'string') {
    throw new Error('PASSWORD_REQUIRED: Password string is required for hashing');
  }
  return argon2.hash(password, { ...ARGON2_CONFIG, raw: false });
}

/**
 * Synchronous hash method maintained for legacy seeding/bootstrap compatibility.
 * Modern Argon2id hashes take precedence on interactive user paths.
 */
export function hashPasswordSync(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derivedKey = crypto.scryptSync(password, salt, 64);
  return `scrypt$${salt}$${derivedKey.toString('hex')}`;
}

/**
 * Asynchronously verifies password against either Argon2id or legacy scrypt.
 * Unknown, malformed, or sentinel hashes (e.g. LOCKED_INIT_PENDING$) return false.
 */
export async function verifyPasswordAsync(
  password: string,
  storedHash: string
): Promise<{ valid: boolean; needsRehash: boolean }> {
  if (!password || !storedHash || typeof password !== 'string' || typeof storedHash !== 'string') {
    return { valid: false, needsRehash: false };
  }

  // 1. Explicitly reject sentinel / locked accounts
  if (
    storedHash.startsWith('LOCKED_INIT_PENDING$') ||
    storedHash.startsWith('LOCKED_DECOMMISSIONED$') ||
    storedHash.startsWith('LOCKED_')
  ) {
    return { valid: false, needsRehash: false };
  }

  // 2. Check for modern Argon2id ($argon2id$...)
  if (storedHash.startsWith('$argon2id$') || storedHash.startsWith('$argon2i$')) {
    try {
      const valid = await argon2.verify(storedHash, password);
      return { valid, needsRehash: false };
    } catch {
      return { valid: false, needsRehash: false };
    }
  }

  // 3. Check for legacy scrypt (scrypt$<salt>$<key>)
  if (storedHash.startsWith('scrypt$')) {
    const parts = storedHash.split('$');
    if (parts.length === 3 && parts[0] === 'scrypt') {
      const salt = parts[1];
      const expectedKeyHex = parts[2];
      try {
        const derivedKey = (await scryptAsync(password, salt, 64)) as Buffer;
        const expectedBuffer = Buffer.from(expectedKeyHex, 'hex');
        if (expectedBuffer.length !== derivedKey.length) {
          return { valid: false, needsRehash: false };
        }
        const valid = crypto.timingSafeEqual(expectedBuffer, derivedKey);
        return { valid, needsRehash: valid };
      } catch {
        return { valid: false, needsRehash: false };
      }
    }
    return { valid: false, needsRehash: false };
  }

  // 4. Any other format is unrecognized and fails closed
  return { valid: false, needsRehash: false };
}

/**
 * Execute a dummy Argon2id verification to equalize response timing (~70-100ms)
 * preventing timing side-channels on nonexistent accounts.
 */
export async function executeDummyPasswordVerification(): Promise<void> {
  try {
    await argon2.verify(DUMMY_ARGON2_HASH, 'dummyPasswordToPreventAccountEnumeration');
  } catch {
    // Expected to fail verification; time spent is the intended outcome
  }
}
