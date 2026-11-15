import crypto from 'crypto';
import argon2 from 'argon2';

/**
 * Generate 8 cryptographically secure single-use recovery codes.
 * Format: XXXX-XXXX-XXXX (12 alphanumeric characters, 48+ bits entropy per code).
 */
export function generateRecoveryCodes(count = 8): string[] {
  const codes: string[] = [];
  const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'; // Base32 unambiguous charset (no 0, 1, I, O)

  for (let i = 0; i < count; i++) {
    const bytes = crypto.randomBytes(12);
    let code = '';
    for (let b = 0; b < 12; b++) {
      code += chars[bytes[b] % chars.length];
      if (b === 3 || b === 7) {
        code += '-';
      }
    }
    codes.push(code);
  }

  return codes;
}

/**
 * Normalize recovery code: remove hyphens, whitespace, uppercase.
 */
export function normalizeRecoveryCode(rawCode: string): string {
  return rawCode.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/**
 * Hash recovery codes with Argon2id for secure storage in recovery_code_hashes TEXT[].
 */
export async function hashRecoveryCode(code: string): Promise<string> {
  const normalized = normalizeRecoveryCode(code);
  return argon2.hash(normalized, {
    type: argon2.argon2id,
    timeCost: 2,
    memoryCost: 32768, // 32MB for recovery codes
    parallelism: 2,
    raw: false,
  });
}

/**
 * Verify submitted recovery code against stored hashes.
 * Returns the matching hash index if valid, or -1 if invalid.
 */
export async function verifyRecoveryCode(
  rawCode: string,
  storedHashes: string[]
): Promise<number> {
  if (!rawCode || !Array.isArray(storedHashes) || storedHashes.length === 0) {
    return -1;
  }

  const normalized = normalizeRecoveryCode(rawCode);

  for (let i = 0; i < storedHashes.length; i++) {
    try {
      const match = await argon2.verify(storedHashes[i], normalized);
      if (match) {
        return i;
      }
    } catch {
      // Continue checking
    }
  }

  return -1;
}
