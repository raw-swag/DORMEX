import crypto from 'crypto';

export interface EncryptedPayload {
  ciphertext: string; // hex
  iv: string;         // hex
  tag: string;        // hex
  keyVersion: number;
}

/**
 * Retrieves the encryption key from environment configuration for the specified key version.
 * Requires 32-byte (256-bit) hexadecimal string.
 * Defaults to MFA_ENCRYPTION_KEY_V1 or MFA_ENCRYPTION_SECRET.
 */
export function getEncryptionKey(version = 1): Buffer {
  const envKey =
    process.env[`MFA_ENCRYPTION_KEY_V${version}`] ||
    (version === 1 ? process.env.MFA_ENCRYPTION_SECRET : undefined);

  if (!envKey) {
    // For test environment, provide a stable deterministic fallback key if not explicitly set
    if (process.env.NODE_ENV === 'test') {
      return Buffer.from('0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef', 'hex');
    }
    throw new Error(
      `MFA_ENCRYPTION_KEY_MISSING: No 256-bit AES-GCM encryption key found for key version ${version}`
    );
  }

  const keyBuffer = Buffer.from(envKey.trim(), 'hex');
  if (keyBuffer.length !== 32) {
    throw new Error(
      `MFA_ENCRYPTION_KEY_INVALID: Encryption key for version ${version} must be exactly 32 bytes (64 hex characters)`
    );
  }

  return keyBuffer;
}

/**
 * Encrypt a plaintext buffer using AES-256-GCM with a fresh 12-byte IV.
 */
export function encryptAesGcm(
  plaintext: Buffer | string,
  keyVersion = 1
): EncryptedPayload {
  const key = getEncryptionKey(keyVersion);
  const iv = crypto.randomBytes(12); // Recommended 96 bits for GCM
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

  const inputBuffer = typeof plaintext === 'string' ? Buffer.from(plaintext, 'utf8') : plaintext;
  const ciphertext = Buffer.concat([cipher.update(inputBuffer), cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    ciphertext: ciphertext.toString('hex'),
    iv: iv.toString('hex'),
    tag: tag.toString('hex'),
    keyVersion,
  };
}

/**
 * Decrypt AES-256-GCM ciphertext using the specified key version.
 * Fails closed if tampered or key is wrong.
 */
export function decryptAesGcm(payload: EncryptedPayload): Buffer {
  const key = getEncryptionKey(payload.keyVersion);
  const iv = Buffer.from(payload.iv, 'hex');
  const tag = Buffer.from(payload.tag, 'hex');
  const ciphertext = Buffer.from(payload.ciphertext, 'hex');

  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);

  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return decrypted;
}
