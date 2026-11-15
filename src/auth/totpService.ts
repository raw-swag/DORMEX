import crypto from 'crypto';

/**
 * Standard RFC 4648 Base32 Alphabet
 */
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/**
 * Encode a Buffer to Base32 string (without padding)
 */
export function base32Encode(buffer: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = '';

  for (let i = 0; i < buffer.length; i++) {
    value = (value << 8) | buffer[i];
    bits += 8;

    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }

  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }

  return output;
}

/**
 * Decode a Base32 string to Buffer
 */
export function base32Decode(base32Str: string): Buffer {
  const cleanStr = base32Str.toUpperCase().replace(/=+$/, '').replace(/\s+/g, '');
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];

  for (let i = 0; i < cleanStr.length; i++) {
    const idx = BASE32_ALPHABET.indexOf(cleanStr[i]);
    if (idx === -1) {
      throw new Error(`INVALID_BASE32_CHAR: Character '${cleanStr[i]}' is not in RFC 4648 Base32 alphabet`);
    }

    value = (value << 5) | idx;
    bits += 5;

    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }

  return Buffer.from(bytes);
}

/**
 * Generate a 20-byte cryptographically secure random secret (160 bits)
 * returned as a Base32 encoded string.
 */
export function generateTotpSecret(): { rawSecret: Buffer; base32Secret: string } {
  const rawSecret = crypto.randomBytes(20);
  const base32Secret = base32Encode(rawSecret);
  return { rawSecret, base32Secret };
}

/**
 * Compute RFC 6238 TOTP code for a given secret at a given timestep.
 * Defaults to 30s step, 6 digits, HMAC-SHA1.
 */
export function computeTotpCode(secret: Buffer | string, timestep: number, digits = 6): string {
  const secretBuffer = typeof secret === 'string' ? base32Decode(secret) : secret;
  const counterBuffer = Buffer.alloc(8);
  // Write 64-bit integer big-endian
  counterBuffer.writeBigInt64BE(BigInt(timestep), 0);

  const hmac = crypto.createHmac('sha1', secretBuffer);
  hmac.update(counterBuffer);
  const digest = hmac.digest();

  // Dynamic truncation (RFC 4226 section 5.4)
  const offset = digest[digest.length - 1] & 0x0f;
  const binaryCode =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);

  const otp = binaryCode % Math.pow(10, digits);
  return otp.toString().padStart(digits, '0');
}

/**
 * Current 30-second timestep from Unix epoch
 */
export function getCurrentTimestep(timeMs = Date.now(), stepSeconds = 30): number {
  return Math.floor(timeMs / 1000 / stepSeconds);
}

/**
 * Verify a TOTP code against a secret within the allowed window drift (+-1 timestep = 90s total window).
 * Returns the exact matched timestep if valid, or null if invalid.
 */
export function verifyTotpCode(
  secret: Buffer | string,
  code: string,
  timeMs = Date.now(),
  allowedDriftSteps = 1,
  digits = 6
): { valid: boolean; matchedStep: number | null } {
  if (!code || typeof code !== 'string') {
    return { valid: false, matchedStep: null };
  }

  const cleanCode = code.trim();
  if (cleanCode.length !== digits || !/^\d+$/.test(cleanCode)) {
    return { valid: false, matchedStep: null };
  }

  const currentStep = getCurrentTimestep(timeMs);
  const minStep = currentStep - allowedDriftSteps;
  const maxStep = currentStep + allowedDriftSteps;

  let matchedStep: number | null = null;

  for (let step = minStep; step <= maxStep; step++) {
    const expected = computeTotpCode(secret, step, digits);
    if (crypto.timingSafeEqual(Buffer.from(cleanCode), Buffer.from(expected))) {
      matchedStep = step;
      break;
    }
  }

  return {
    valid: matchedStep !== null,
    matchedStep,
  };
}

/**
 * Generate standard otpauth:// provisioning URI for Authenticator apps
 */
export function generateKeyUri(
  accountName: string,
  issuer: string,
  base32Secret: string
): string {
  const encAccount = encodeURIComponent(accountName);
  const encIssuer = encodeURIComponent(issuer);
  return `otpauth://totp/${encIssuer}:${encAccount}?secret=${base32Secret}&issuer=${encIssuer}&algorithm=SHA1&digits=6&period=30`;
}
