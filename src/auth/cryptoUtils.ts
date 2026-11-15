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
    // For test environment, version 1 has a fallback if not explicitly set; other versions require explicit configuration
    if (process.env.NODE_ENV === 'test' && version === 1) {
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

/**
 * Get active encryption key version from environment or default to 1.
 */
export function getActiveKeyVersion(): number {
  const ver = process.env.MFA_CURRENT_KEY_VERSION;
  if (ver) {
    const parsed = parseInt(ver, 10);
    if (!isNaN(parsed) && parsed > 0) return parsed;
  }
  return 1;
}

export interface KeyRotationSummary {
  inspected: number;
  reEncrypted: number;
  alreadyCurrent: number;
  failed: number;
  targetVersion: number;
}

/**
 * Resumable, safe key rotation utility.
 * Re-encrypts user MFA secrets from their stored key version to targetVersion.
 * Decrypts and verifies first before any row update.
 */
export async function rotateMfaSecrets(
  db: { query: (text: string, params?: any[]) => Promise<any>; transaction: (fn: (client: any) => Promise<any>) => Promise<any> },
  targetVersion = getActiveKeyVersion()
): Promise<KeyRotationSummary> {
  // Ensure target key is available before starting
  getEncryptionKey(targetVersion);

  const rowsRes = await db.query(
    `SELECT id, user_id, encrypted_secret, secret_iv, secret_tag, key_version 
     FROM user_mfa_settings`
  );

  const summary: KeyRotationSummary = {
    inspected: rowsRes.rows.length,
    reEncrypted: 0,
    alreadyCurrent: 0,
    failed: 0,
    targetVersion,
  };

  for (const row of rowsRes.rows) {
    const currentVersion = Number(row.key_version);
    if (currentVersion === targetVersion) {
      summary.alreadyCurrent++;
      continue;
    }

    try {
      // 1. Decrypt using stored key_version
      const decryptedSecret = decryptAesGcm({
        ciphertext: row.encrypted_secret,
        iv: row.secret_iv,
        tag: row.secret_tag,
        keyVersion: currentVersion,
      });

      // 2. Encrypt using targetVersion
      const reEncrypted = encryptAesGcm(decryptedSecret, targetVersion);

      // 3. Atomically update row only if key_version matches currentVersion (optimistic concurrency)
      await db.transaction(async (client) => {
        const updateRes = await client.query(
          `UPDATE user_mfa_settings
           SET encrypted_secret = $1,
               secret_iv = $2,
               secret_tag = $3,
               key_version = $4,
               updated_at = CURRENT_TIMESTAMP
           WHERE id = $5 AND key_version = $6
           RETURNING id`,
          [
            reEncrypted.ciphertext,
            reEncrypted.iv,
            reEncrypted.tag,
            targetVersion,
            row.id,
            currentVersion,
          ]
        );

        if (updateRes.rows.length > 0) {
          const auditId = `aud_mfa_rot_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
          await client.query(
            `INSERT INTO audit_logs (id, actor_id, action, target_type, target_id, reason)
             VALUES ($1, $2, 'MFA_KEY_ROTATED', 'USER', $2, $3)`,
            [
              auditId,
              row.user_id,
              `Rotated secret encryption key from v${currentVersion} to v${targetVersion}`,
            ]
          );
        }
      });

      summary.reEncrypted++;
    } catch (err: any) {
      summary.failed++;
      throw new Error(
        `KEY_ROTATION_ABORTED: Failed re-encrypting secret for user ${row.user_id} (v${currentVersion} -> v${targetVersion}): ${err.message}`
      );
    }
  }

  return summary;
}
