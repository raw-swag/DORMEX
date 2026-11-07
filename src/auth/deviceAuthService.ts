import { DatabaseService } from '../db/index.js';
import crypto from 'crypto';
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
  VerifiedRegistrationResponse,
  VerifiedAuthenticationResponse,
} from '@simplewebauthn/server';
import type {
  RegistrationResponseJSON,
  AuthenticationResponseJSON,
} from '@simplewebauthn/server';

export interface DeviceSlotInfo {
  slot_id: 'SLOT_01' | 'SLOT_02';
  device_label: string;
  platform: 'WINDOWS' | 'ANDROID';
  credential_id: string | null;
  public_key: string | null;
  counter: number;
  aaguid: string | null;
  backup_eligible: boolean | null;
  backup_state: boolean | null;
  transports: string[] | null;
  registered_at: string | null;
  last_authenticated_at: string | null;
  is_revoked: boolean;
  revoked_at: string | null;
  registered_by: string | null;
  is_active: boolean;
}

export interface DemoSessionRecord {
  token: string;
  slot_id: 'SLOT_01' | 'SLOT_02';
  device_label: string;
  platform: 'WINDOWS' | 'ANDROID';
  user_verified: boolean;
  created_at: string;
  expires_at: string;
}

export class DeviceAuthService {
  private db: DatabaseService;
  // Ephemeral challenge storage with TTL
  private challenges: Map<string, { challenge: string; slot_id?: 'SLOT_01' | 'SLOT_02'; expectedType: 'registration' | 'authentication'; adminUserId?: string; expiresAt: number }> = new Map();
  // Ephemeral demo sessions (in addition to token signing for high reliability & immediate revocation)
  private activeDemoSessions: Map<string, DemoSessionRecord> = new Map();
  // Rate limiting map: tracks failed attempts per IP with cooldown
  private rateLimits: Map<string, { attempts: number; blockedUntil: number }> = new Map();

  public checkRateLimit(ip: string): void {
    const record = this.rateLimits.get(ip);
    if (record) {
      if (record.blockedUntil > Date.now()) {
        const remainingSec = Math.ceil((record.blockedUntil - Date.now()) / 1000);
        throw new Error(`RATE_LIMIT_EXCEEDED: Too many attempts. Please retry in ${remainingSec} seconds.`);
      }
      if (Date.now() > record.blockedUntil && record.blockedUntil > 0) {
        this.rateLimits.delete(ip);
      }
    }
  }

  public recordFailedAttempt(ip: string): void {
    const record = this.rateLimits.get(ip) || { attempts: 0, blockedUntil: 0 };
    record.attempts += 1;
    if (record.attempts >= 5) {
      record.blockedUntil = Date.now() + 60 * 1000; // Block for 60 seconds after 5 failed attempts
    }
    this.rateLimits.set(ip, record);
  }

  public recordSuccessfulAttempt(ip: string): void {
    this.rateLimits.delete(ip);
  }


  constructor(db: DatabaseService) {
    this.db = db;
    // Periodic garbage collection for expired challenges and demo sessions
    setInterval(() => {
      const now = Date.now();
      for (const [k, v] of this.challenges.entries()) {
        if (v.expiresAt < now) this.challenges.delete(k);
      }
      for (const [tok, sess] of this.activeDemoSessions.entries()) {
        if (new Date(sess.expires_at).getTime() < now) this.activeDemoSessions.delete(tok);
      }
    }, 60000).unref?.();
  }

  /**
   * Determine RP ID from request host / domain
   */
  public getRpIdFromReq(req: any): string {
    // 1. Prefer client's origin or referer (e.g. https://dormex-sit.vercel.app)
    const originHeader = req.headers['origin'] || req.headers['Origin'] || req.headers['referer'] || req.headers['Referer'];
    if (originHeader && typeof originHeader === 'string') {
      try {
        const u = new URL(originHeader);
        const host = u.hostname.toLowerCase();
        if (host === 'localhost' || host === '127.0.0.1') return 'localhost';
        return host;
      } catch {
        // ignore malformed
      }
    }

    // 2. Check X-Forwarded-Host from Vercel / Cloudflare reverse proxy
    const xForwardedHost = req.headers['x-forwarded-host'];
    if (xForwardedHost && typeof xForwardedHost === 'string') {
      const cleanFwd = xForwardedHost.split(',')[0].trim().split(':')[0].toLowerCase();
      if (cleanFwd === 'localhost' || cleanFwd === '127.0.0.1') return 'localhost';
      return cleanFwd;
    }

    // 3. Fallback to direct request hostname
    const host = (req.hostname || req.headers['host'] || 'localhost').split(':')[0].toLowerCase();
    if (host === 'localhost' || host === '127.0.0.1') return 'localhost';
    return host;
  }

  public getRpId(hostname: string): string {
    const cleanHost = hostname.split(':')[0].toLowerCase();
    if (cleanHost === 'localhost' || cleanHost === '127.0.0.1') {
      return 'localhost';
    }
    return cleanHost;
  }

  /**
   * Determine expected origin from request
   */
  public getExpectedOrigin(req: any): string {
    const origin = req.headers['origin'] || req.headers['Origin'] || req.headers['referer'] || req.headers['Referer'];
    if (origin && typeof origin === 'string') {
      try {
        const u = new URL(origin);
        return `${u.protocol}//${u.host}`;
      } catch {
        // ignore malformed
      }
    }
    const xForwardedHost = req.headers['x-forwarded-host'];
    const xForwardedProto = req.headers['x-forwarded-proto'] || 'https';
    if (xForwardedHost && typeof xForwardedHost === 'string') {
      const cleanFwd = xForwardedHost.split(',')[0].trim();
      return `${xForwardedProto}://${cleanFwd}`;
    }
    const host = req.headers['host'] || 'localhost:3000';
    const proto = req.headers['x-forwarded-proto'] || 'http';
    return `${proto}://${host}`;
  }

  /**
   * Get all device registration slots
   */
  public async getDeviceSlots(): Promise<DeviceSlotInfo[]> {
    const res = await this.db.query(`
      SELECT 
        slot_id,
        device_label,
        platform,
        credential_id,
        public_key,
        counter,
        aaguid,
        backup_eligible,
        backup_state,
        transports,
        registered_at,
        last_authenticated_at,
        is_revoked,
        revoked_at,
        registered_by
      FROM device_registration_slots
      ORDER BY slot_id ASC
    `);

    return res.rows.map((row: any) => ({
      slot_id: row.slot_id,
      device_label: row.device_label,
      platform: row.platform,
      credential_id: row.credential_id,
      public_key: row.public_key,
      counter: Number(row.counter || 0),
      aaguid: row.aaguid,
      backup_eligible: row.backup_eligible === null ? null : Boolean(row.backup_eligible),
      backup_state: row.backup_state === null ? null : Boolean(row.backup_state),
      transports: typeof row.transports === 'string' ? JSON.parse(row.transports) : (row.transports || null),
      registered_at: row.registered_at ? new Date(row.registered_at).toISOString() : null,
      last_authenticated_at: row.last_authenticated_at ? new Date(row.last_authenticated_at).toISOString() : null,
      is_revoked: Boolean(row.is_revoked),
      revoked_at: row.revoked_at ? new Date(row.revoked_at).toISOString() : null,
      registered_by: row.registered_by || null,
      is_active: Boolean(row.credential_id && !row.is_revoked),
    }));
  }

  /**
   * Generate WebAuthn registration options for a designated slot (SLOT_01 or SLOT_02)
   */
  public async generateRegistrationOptionsForSlot(params: {
    slot_id: 'SLOT_01' | 'SLOT_02';
    adminUserId: string;
    hostname: string;
  }) {
    const { slot_id, adminUserId, hostname } = params;
    if (slot_id !== 'SLOT_01' && slot_id !== 'SLOT_02') {
      throw new Error('INVALID_SLOT: Only SLOT_01 and SLOT_02 are supported.');
    }

    // Verify slot state
    const slotRes = await this.db.query(
      `SELECT slot_id, device_label, platform, credential_id, is_revoked FROM device_registration_slots WHERE slot_id = $1`,
      [slot_id]
    );

    if (slotRes.rows.length === 0) {
      throw new Error(`SLOT_NOT_FOUND: Predefined slot ${slot_id} does not exist.`);
    }

    const slot = slotRes.rows[0];
    if (slot.credential_id && !slot.is_revoked) {
      throw new Error(`SLOT_OCCUPIED: Slot ${slot_id} is already registered and active. Revoke it before enrolling a replacement.`);
    }

    // Check count of active registered devices across the system (strictly max 2)
    const activeCountRes = await this.db.query(
      `SELECT COUNT(*)::int as count FROM device_registration_slots WHERE credential_id IS NOT NULL AND is_revoked = FALSE AND slot_id != $1`,
      [slot_id]
    );
    if ((activeCountRes.rows[0]?.count || 0) >= 2) {
      throw new Error('DEVICE_LIMIT_EXCEEDED: Maximum of two active device credentials permitted.');
    }

    const rpID = this.getRpId(hostname);
    const rpName = 'DORMEX Secure Demo Access';

    // Existing active credentials to exclude
    const existingCredsRes = await this.db.query(
      `SELECT credential_id, transports FROM device_registration_slots WHERE credential_id IS NOT NULL AND is_revoked = FALSE`
    );

    const excludeCredentials = existingCredsRes.rows.map((r: any) => ({
      id: r.credential_id,
      transports: typeof r.transports === 'string' ? JSON.parse(r.transports) : (r.transports || undefined),
    }));

    const options = await generateRegistrationOptions({
      rpName,
      rpID,
      userID: new Uint8Array(Buffer.from(`dormex_slot_${slot_id}`)),
      userName: `demo_${slot_id.toLowerCase()}`,
      userDisplayName: `DORMEX Demo ${slot.device_label}`,
      attestationType: 'none',
      excludeCredentials,
      authenticatorSelection: {
        authenticatorAttachment: 'platform', // Enforce platform authenticator (Windows Hello / Android Biometric)
        userVerification: 'required',         // Enforce user verification (PIN or Biometric)
        residentKey: 'preferred',
      },
    });

    // Store ephemeral registration challenge tied to slot
    const challengeKey = `reg_${slot_id}_${crypto.randomBytes(16).toString('hex')}`;
    this.challenges.set(challengeKey, {
      challenge: options.challenge,
      slot_id,
      expectedType: 'registration',
      expiresAt: Date.now() + 5 * 60 * 1000, // 5 min TTL
    });

    return {
      options,
      challengeToken: challengeKey,
      slot_id,
      device_label: slot.device_label,
      platform: slot.platform,
    };
  }

  /**
   * Verify WebAuthn registration response and commit device credential to database
   */
  public async verifyAndSaveRegistration(params: {
    slot_id: 'SLOT_01' | 'SLOT_02';
    challengeToken: string;
    response: RegistrationResponseJSON;
    expectedOrigin: string;
    hostname: string;
    adminUserId: string;
  }) {
    const { slot_id, challengeToken, response, expectedOrigin, hostname, adminUserId } = params;

    const storedChallenge = this.challenges.get(challengeToken);
    if (!storedChallenge || storedChallenge.expectedType !== 'registration' || storedChallenge.slot_id !== slot_id || storedChallenge.adminUserId !== adminUserId) {
      throw new Error('CHALLENGE_EXPIRED_OR_INVALID: Registration challenge is invalid or has expired. Please re-initiate enrollment.');
    }
    // Invalidate challenge immediately (single use, prevents replay)
    this.challenges.delete(challengeToken);

    const rpID = this.getRpId(hostname);

    let verification: VerifiedRegistrationResponse;
    try {
      verification = await verifyRegistrationResponse({
        response,
        expectedChallenge: storedChallenge.challenge,
        expectedOrigin,
        expectedRPID: rpID,
        requireUserVerification: true,
      });
    } catch (err: any) {
      throw new Error(`REGISTRATION_VERIFICATION_FAILED: ${err.message || 'Signature or origin verification failed'}`);
    }

    if (!verification.verified || !verification.registrationInfo) {
      throw new Error('REGISTRATION_NOT_VERIFIED: WebAuthn response could not be cryptographically verified.');
    }

    const {
      credential,
      credentialDeviceType,
      credentialBackedUp,
      aaguid,
    } = verification.registrationInfo;

    // Check backup flags directly from registrationInfo:
    // In WebAuthn L3 / SimpleWebAuthn, single-device vs multi-device is derived from the backup eligibility flag (BE flag in authenticatorData).
    // credentialDeviceType is either 'singleDevice' or 'multiDevice'.
    if (credentialDeviceType === 'multiDevice') {
      throw new Error(
        'SYNCED_PASSKEY_REJECTED: The authenticator reported backup eligibility (multi-device synced passkey). ' +
        'DORMEX requires a strict, hardware-bound, non-synced platform authenticator (e.g. Windows Hello TPM or Android device-bound platform keystore).'
      );
    }

    const credentialID = credential.id;
    const publicKeyBase64 = Buffer.from(credential.publicKey).toString('base64');
    const counter = credential.counter;
    const transports = response.response.transports || ['internal'];

    // Transactional commit with conflict prevention
    await this.db.query('BEGIN');
    try {
      // Check total active device count again inside transaction with locking
      const checkRes = await this.db.query(
        `SELECT slot_id, credential_id, is_revoked 
         FROM device_registration_slots 
         WHERE slot_id = $1 
         FOR UPDATE`,
        [slot_id]
      );

      if (checkRes.rows.length === 0) {
        throw new Error(`SLOT_NOT_FOUND: ${slot_id}`);
      }

      const currentSlot = checkRes.rows[0];
      if (currentSlot.credential_id && !currentSlot.is_revoked) {
        throw new Error(`SLOT_OCCUPIED: Slot ${slot_id} was already registered during this transaction.`);
      }

      // Check system-wide active registrations limit
      const activeRes = await this.db.query(
        `SELECT COUNT(*)::int as count 
         FROM device_registration_slots 
         WHERE credential_id IS NOT NULL AND is_revoked = FALSE AND slot_id != $1`,
        [slot_id]
      );

      if ((activeRes.rows[0]?.count || 0) >= 2) {
        throw new Error('MAX_TWO_DEVICES_EXCEEDED: Cannot register more than two active devices.');
      }

      // Check if credential ID already registered anywhere
      const duplicateRes = await this.db.query(
        `SELECT slot_id FROM device_registration_slots WHERE credential_id = $1`,
        [credentialID]
      );
      if (duplicateRes.rows.length > 0) {
        throw new Error('CREDENTIAL_ALREADY_REGISTERED: This credential is already assigned to a device slot.');
      }

      // Update slot with verified credential
      await this.db.query(
        `UPDATE device_registration_slots
         SET credential_id = $1,
             public_key = $2,
             counter = $3,
             aaguid = $4,
             backup_eligible = FALSE,
             backup_state = $5,
             transports = $6,
             registered_at = CURRENT_TIMESTAMP,
             last_authenticated_at = NULL,
             is_revoked = FALSE,
             revoked_at = NULL,
             registered_by = $7,
             updated_at = CURRENT_TIMESTAMP
         WHERE slot_id = $8`,
        [
          credentialID,
          publicKeyBase64,
          counter,
          aaguid || null,
          Boolean(credentialBackedUp),
          JSON.stringify(transports),
          adminUserId,
          slot_id,
        ]
      );

      // Audit log entry
      await this.db.query(
        `INSERT INTO audit_logs (id, actor_id, action, target_type, target_id, before_state, after_state)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          `audit_${crypto.randomUUID()}`,
          adminUserId,
          'DEVICE_ENROLLED',
          'DEVICE_SLOT',
          slot_id,
          JSON.stringify({ previous_credential: currentSlot.credential_id, was_revoked: currentSlot.is_revoked }),
          JSON.stringify({
            credential_id: credentialID,
            platform: slot_id === 'SLOT_01' ? 'WINDOWS' : 'ANDROID',
            credentialDeviceType,
            backup_eligible: false,
            aaguid,
          }),
        ]
      );

      await this.db.query('COMMIT');
    } catch (txErr) {
      await this.db.query('ROLLBACK');
      throw txErr;
    }

    return {
      success: true,
      slot_id,
      credential_id: credentialID,
      credentialDeviceType,
      verified: true,
    };
  }

  /**
   * Generate authentication options for demo access
   */
  public async generateAuthenticationOptionsForDemo(hostname: string) {
    const rpID = this.getRpId(hostname);

    // Retrieve active registered credentials
    const credsRes = await this.db.query(
      `SELECT slot_id, device_label, credential_id, transports 
       FROM device_registration_slots 
       WHERE credential_id IS NOT NULL AND is_revoked = FALSE`
    );

    if (credsRes.rows.length === 0) {
      throw new Error('NO_DEVICES_REGISTERED: No demo devices have been enrolled yet. Contact the system administrator.');
    }

    const allowCredentials = credsRes.rows.map((row: any) => ({
      id: row.credential_id,
      transports: typeof row.transports === 'string' ? JSON.parse(row.transports) : (row.transports || undefined),
    }));

    const options = await generateAuthenticationOptions({
      rpID,
      allowCredentials,
      userVerification: 'required', // Enforce PIN or biometric
    });

    const challengeToken = `auth_${crypto.randomBytes(16).toString('hex')}`;
    this.challenges.set(challengeToken, {
      challenge: options.challenge,
      expectedType: 'authentication',
      expiresAt: Date.now() + 3 * 60 * 1000, // 3 min TTL
    });

    return {
      options,
      challengeToken,
      availableSlots: credsRes.rows.map((r: any) => ({ slot_id: r.slot_id, device_label: r.device_label })),
    };
  }

  /**
   * Verify WebAuthn authentication assertion and issue short-lived demo session
   */
  public async verifyAndAuthenticateDemo(params: {
    challengeToken: string;
    response: AuthenticationResponseJSON;
    expectedOrigin: string;
    hostname: string;
  }): Promise<{ success: boolean; sessionToken: string; slot_id: 'SLOT_01' | 'SLOT_02'; device_label: string; expires_at: string }> {
    const { challengeToken, response, expectedOrigin, hostname } = params;

    const storedChallenge = this.challenges.get(challengeToken);
    if (!storedChallenge || storedChallenge.expectedType !== 'authentication') {
      throw new Error('CHALLENGE_INVALID_OR_EXPIRED: Authentication challenge has expired or is invalid. Please try again.');
    }
    // Invalidate immediately (single use protection)
    this.challenges.delete(challengeToken);

    const credentialID = response.id;

    // Find the device slot owning this credential
    const slotRes = await this.db.query(
      `SELECT 
        slot_id, 
        device_label, 
        platform, 
        credential_id, 
        public_key, 
        counter, 
        backup_eligible, 
        is_revoked 
       FROM device_registration_slots 
       WHERE credential_id = $1`,
      [credentialID]
    );

    if (slotRes.rows.length === 0) {
      throw new Error('UNAUTHORIZED_DEVICE: Credential ID is not registered in any authorized device slot.');
    }

    const slot = slotRes.rows[0];

    // Verify slot active status
    if (slot.is_revoked) {
      throw new Error(`DEVICE_REVOKED: Device slot ${slot.slot_id} (${slot.device_label}) has been revoked. Access denied.`);
    }

    // Verify backup eligible invariant
    if (slot.backup_eligible === true) {
      throw new Error('MULTI_DEVICE_CREDENTIAL_REJECTED: Registered credential violates device-bound invariant.');
    }

    const rpID = this.getRpId(hostname);
    const publicKeyUint8 = new Uint8Array(Buffer.from(slot.public_key, 'base64'));

    let verification: VerifiedAuthenticationResponse;
    try {
      verification = await verifyAuthenticationResponse({
        response,
        expectedChallenge: storedChallenge.challenge,
        expectedOrigin,
        expectedRPID: rpID,
        credential: {
          id: slot.credential_id,
          publicKey: publicKeyUint8,
          counter: Number(slot.counter || 0),
        },
        requireUserVerification: true,
      });
    } catch (err: any) {
      throw new Error(`AUTHENTICATION_VERIFICATION_FAILED: ${err.message || 'Assertion verification failed'}`);
    }

    if (!verification.verified || !verification.authenticationInfo) {
      throw new Error('AUTHENTICATION_FAILED: Assertion signature was invalid.');
    }

    const { newCounter, userVerified, credentialDeviceType } = verification.authenticationInfo;

    // Check device type on authentication assertion as well
    if (credentialDeviceType === 'multiDevice') {
      throw new Error('SYNCED_CREDENTIAL_ASSERTION_REJECTED: Authenticator assertion reported multi-device sync eligibility.');
    }

    // Update counter and last_authenticated_at in database
    await this.db.query(
      `UPDATE device_registration_slots
       SET counter = $1,
           last_authenticated_at = CURRENT_TIMESTAMP,
           updated_at = CURRENT_TIMESTAMP
       WHERE slot_id = $2`,
      [newCounter, slot.slot_id]
    );

    // Issue short-lived demo session (15 minutes duration)
    const sessionToken = `demo_sess_${crypto.randomBytes(32).toString('hex')}`;
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();

    const sessionRecord: DemoSessionRecord = {
      token: sessionToken,
      slot_id: slot.slot_id,
      device_label: slot.device_label,
      platform: slot.platform,
      user_verified: Boolean(userVerified),
      created_at: new Date().toISOString(),
      expires_at: expiresAt,
    };

    this.activeDemoSessions.set(sessionToken, sessionRecord);

    return {
      success: true,
      sessionToken,
      slot_id: slot.slot_id,
      device_label: slot.device_label,
      expires_at: expiresAt,
    };
  }

  /**
   * Validate an active demo session token
   */
  public async validateDemoSession(token: string | undefined): Promise<DemoSessionRecord | null> {
    if (!token) return null;

    const session = this.activeDemoSessions.get(token);
    if (!session) return null;

    // Check expiration
    if (new Date(session.expires_at).getTime() < Date.now()) {
      this.activeDemoSessions.delete(token);
      return null;
    }

    // Check if slot was revoked since session creation
    const slotCheck = await this.db.query(
      `SELECT is_revoked FROM device_registration_slots WHERE slot_id = $1`,
      [session.slot_id]
    );

    if (slotCheck.rows.length === 0 || slotCheck.rows[0].is_revoked) {
      this.activeDemoSessions.delete(token);
      return null;
    }

    return session;
  }

  /**
   * Invalidate demo session (logout)
   */
  public invalidateDemoSession(token: string | undefined): void {
    if (token) {
      this.activeDemoSessions.delete(token);
    }
  }

  /**
   * Revoke a registered device slot
   */
  public async revokeDeviceSlot(params: {
    slot_id: 'SLOT_01' | 'SLOT_02';
    adminUserId: string;
    reason?: string;
  }): Promise<{ success: boolean; slot_id: string }> {
    const { slot_id, adminUserId, reason } = params;

    const slotRes = await this.db.query(
      `SELECT slot_id, credential_id, is_revoked, device_label FROM device_registration_slots WHERE slot_id = $1`,
      [slot_id]
    );

    if (slotRes.rows.length === 0) {
      throw new Error(`SLOT_NOT_FOUND: ${slot_id}`);
    }

    const slot = slotRes.rows[0];

    // Mark revoked in database
    await this.db.query(
      `UPDATE device_registration_slots
       SET is_revoked = TRUE,
           revoked_at = CURRENT_TIMESTAMP,
           updated_at = CURRENT_TIMESTAMP
       WHERE slot_id = $1`,
      [slot_id]
    );

    // Invalidate all active demo sessions associated with this slot immediately
    for (const [tok, sess] of this.activeDemoSessions.entries()) {
      if (sess.slot_id === slot_id) {
        this.activeDemoSessions.delete(tok);
      }
    }

    // Insert audit log
    await this.db.query(
      `INSERT INTO audit_logs (id, actor_id, action, target_type, target_id, before_state, after_state)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        `audit_${crypto.randomUUID()}`,
        adminUserId,
        'DEVICE_REVOKED',
        'DEVICE_SLOT',
        slot_id,
        JSON.stringify({ credential_id: slot.credential_id, is_revoked: slot.is_revoked }),
        JSON.stringify({ is_revoked: true, reason: reason || 'Administrative revocation' }),
      ]
    );

    return { success: true, slot_id };
  }

  /**
   * Clear registration on a revoked slot to permit replacement enrollment
   */
  public async resetDeviceSlotForReplacement(params: {
    slot_id: 'SLOT_01' | 'SLOT_02';
    adminUserId: string;
  }): Promise<{ success: boolean; slot_id: string }> {
    const { slot_id, adminUserId } = params;

    const slotRes = await this.db.query(
      `SELECT slot_id, credential_id, is_revoked FROM device_registration_slots WHERE slot_id = $1`,
      [slot_id]
    );

    if (slotRes.rows.length === 0) {
      throw new Error(`SLOT_NOT_FOUND: ${slot_id}`);
    }

    const slot = slotRes.rows[0];
    if (slot.credential_id && !slot.is_revoked) {
      throw new Error('CANNOT_RESET_ACTIVE_SLOT: The slot must be revoked before resetting it for a replacement device.');
    }

    await this.db.query(
      `UPDATE device_registration_slots
       SET credential_id = NULL,
           public_key = NULL,
           counter = 0,
           aaguid = NULL,
           backup_eligible = NULL,
           backup_state = NULL,
           transports = NULL,
           registered_at = NULL,
           last_authenticated_at = NULL,
           is_revoked = FALSE,
           revoked_at = NULL,
           registered_by = NULL,
           updated_at = CURRENT_TIMESTAMP
       WHERE slot_id = $1`,
      [slot_id]
    );

    // Audit log
    await this.db.query(
      `INSERT INTO audit_logs (id, actor_id, action, target_type, target_id, before_state, after_state)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        `audit_${crypto.randomUUID()}`,
        adminUserId,
        'DEVICE_SLOT_RESET',
        'DEVICE_SLOT',
        slot_id,
        JSON.stringify({ previous_credential: slot.credential_id }),
        JSON.stringify({ reset_for_enrollment: true }),
      ]
    );

    return { success: true, slot_id };
  }
}
