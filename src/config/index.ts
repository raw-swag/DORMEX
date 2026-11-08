/**
 * DORMEX Server & Environment Configuration Module
 * 
 * Centralized, type-safe, validated runtime configuration.
 * Parses and validates environment variables once at startup.
 * Strictly prevents secret leakage in error messages and logs.
 */

export type AppEnvironment = 'development' | 'test' | 'staging' | 'production';

export interface DatabaseConfig {
  url?: string;
  isSsl: boolean;
  rejectUnauthorized: boolean;
  maxConnections: number;
  idleTimeoutMs: number;
  connectionTimeoutMs: number;
  isRenderInternal: boolean;
}

export interface AuthConfig {
  jwtSecret: string;
  cookieSecret?: string;
  initialAdminEmail?: string;
  initialAdminPassword?: string;
  initialAdminHash?: string;
}

export interface ServerConfig {
  env: AppEnvironment;
  isProduction: boolean;
  isTest: boolean;
  isDevelopment: boolean;
  port: number;
  host: string;
  corsAllowedOrigins: string[];
  database: DatabaseConfig;
  auth: AuthConfig;
  smtp: {
    isConfigured: boolean;
    host?: string;
    port: number;
    user?: string;
    from: string;
  };
  demo: {
    allowDemoSeed: boolean;
  };
}

/**
 * Standard default RP IDs and origins for WebAuthn & CORS.
 */
export const PRODUCTION_DEFAULT_ALLOWED_ORIGINS = [
  'https://dormex-sit.vercel.app',
  'https://dormex-api-s4qq.onrender.com',
];

export const DEVELOPMENT_LOCAL_ORIGINS = [
  'http://localhost:5173',
  'http://localhost:3000',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:3000',
];

export const DEFAULT_ALLOWED_ORIGINS = [
  ...PRODUCTION_DEFAULT_ALLOWED_ORIGINS,
  ...DEVELOPMENT_LOCAL_ORIGINS,
];

export const PRODUCTION_DEFAULT_RP_IDS = [
  'dormex-sit.vercel.app',
  'dormex-api-s4qq.onrender.com',
];

export const DEVELOPMENT_LOCAL_RP_IDS = [
  'localhost',
  '127.0.0.1',
];

export const DEFAULT_RP_IDS = [
  ...PRODUCTION_DEFAULT_RP_IDS,
  ...DEVELOPMENT_LOCAL_RP_IDS,
];

/**
 * Validates and loads application configuration from process.env.
 * Throws explicit, safe errors with zero secret disclosure if mandatory production configuration is missing.
 */
export function loadServerConfig(env: NodeJS.ProcessEnv = process.env, allowMemoryDb: boolean = false): ServerConfig {
  // Detect Render cloud environment automatically (Render sets RENDER=true or IS_RENDER=true)
  const isRenderEnvironment = env.RENDER === 'true' || !!env.IS_RENDER;
  const rawEnv = (env.NODE_ENV || (isRenderEnvironment ? 'production' : 'development')).trim().toLowerCase();
  const validEnvs: AppEnvironment[] = ['development', 'test', 'staging', 'production'];
  
  if (!validEnvs.includes(rawEnv as AppEnvironment)) {
    throw new Error(`FATAL_CONFIG_ERROR: Invalid NODE_ENV '${rawEnv}'. Must be one of: ${validEnvs.join(', ')}.`);
  }

  const appEnv = rawEnv as AppEnvironment;
  const isProduction = appEnv === 'production';
  const isTest = appEnv === 'test';
  const isDevelopment = appEnv === 'development';

  // 1. Port & Host validation
  const port = parseInt(env.PORT || '3000', 10);
  if (isNaN(port) || port < 1 || port > 65535) {
    throw new Error(`FATAL_CONFIG_ERROR: Invalid PORT '${env.PORT}'. Must be an integer between 1 and 65535.`);
  }

  // Host: Render requires binding to 0.0.0.0 in production; local dev defaults to 127.0.0.1
  const host = env.HOST || (isProduction || isRenderEnvironment ? '0.0.0.0' : '127.0.0.1');

  // 2. Database validation
  const dbUrl = env.DATABASE_URL ? env.DATABASE_URL.trim() : undefined;
  // In production, DATABASE_URL is mandatory unless allowMemoryDb override is provided
  if (isProduction && !dbUrl && !allowMemoryDb && env.ALLOW_MEMORY_DB !== 'true') {
    throw new Error('FATAL_DATABASE_CONFIG: Production requires an externally supplied DATABASE_URL (PostgreSQL)');
  }

  // Detect SSL requirement: cloud postgres, neon, -pooler, or explicit PG_SSL=true
  const isCloudOrSslUrl = !!dbUrl && (
    dbUrl.includes('sslmode=require') ||
    dbUrl.includes('-pooler') ||
    dbUrl.includes('neon.tech') ||
    dbUrl.includes('.render.com')
  );
  const isSsl = env.PG_SSL === 'true' || isCloudOrSslUrl;

  // PostgreSQL TLS configuration:
  // Render internal managed database endpoints use private internal certificates.
  // To eliminate spoofing or arbitrary "dpg-" hostname bypasses:
  // 1. Explicit internal host binding via RENDER_INTERNAL_DB_HOST or trusted canonical internal host
  // 2. Exact match against the authenticated Render private internal domain structure
  // Any public domain (including dpg-*.com, dpg-*.example.com, or *.render.com) MUST retain strict CA verification.
  let isRenderInternal = false;
  if (dbUrl) {
    try {
      const parsedUrl = new URL(dbUrl);
      let host = parsedUrl.hostname.trim().toLowerCase();
      if (host.endsWith('.')) host = host.slice(0, -1);

      // Endpoint-specific TLS trust:
      // The internal TLS exception is granted EXCLUSIVELY to the explicitly configured internal endpoint.
      // Arbitrary hostnames or suffix patterns (e.g. *.render.internal, *.oregon-postgres.render.internal)
      // are NEVER trusted by default to eliminate lookalike and rogue internal spoofing.
      // Default: the production Render database instance ('dpg-dbnjeqrl550s73fcr1lg-a').
      // Non-production or staging environments must explicitly configure RENDER_INTERNAL_DB_HOST.
      const trustedInternalHost = env.RENDER_INTERNAL_DB_HOST
        ? env.RENDER_INTERNAL_DB_HOST.trim().toLowerCase()
        : 'dpg-dbnjeqrl550s73fcr1lg-a';

      const isExactTrusted = host === trustedInternalHost || host === `${trustedInternalHost}.internal`;
      isRenderInternal = isExactTrusted && !host.endsWith('.render.com');
    } catch {
      isRenderInternal = false;
    }
  }
  const rejectUnauthorized = env.PG_SSL_REJECT_UNAUTHORIZED === 'false' || isRenderInternal
    ? false
    : (env.PG_SSL_REJECT_UNAUTHORIZED === 'true' || true);

  const maxConnections = parseInt(env.PG_MAX_CONNECTIONS || '20', 10);
  const idleTimeoutMs = parseInt(env.PG_IDLE_TIMEOUT_MS || '30000', 10);
  const connectionTimeoutMs = parseInt(env.PG_CONNECTION_TIMEOUT_MS || '5000', 10);

  // 3. Authentication & JWT validation
  const rawJwtSecret = env.JWT_SECRET ? env.JWT_SECRET.trim() : '';
  if (isProduction && rawJwtSecret.length < 32) {
    throw new Error('FATAL_CONFIG_ERROR: Production requires an externally supplied JWT_SECRET with at least 32 characters');
  }

  const effectiveJwtSecret = rawJwtSecret || 'dormex-super-secure-jwt-signing-key-2026';

  const rawCookieSecret = env.COOKIE_SECRET ? env.COOKIE_SECRET.trim() : '';
  if (isProduction && rawCookieSecret.length < 32) {
    throw new Error('FATAL_CONFIG_ERROR: Production requires an externally supplied COOKIE_SECRET with at least 32 characters');
  }

  // 4. CORS Allowed Origins (Production strictly enforces production origins and excludes localhost)
  const configuredOrigins = env.CORS_ALLOWED_ORIGINS || env.FRONTEND_ORIGIN || '';
  const parsedOrigins = configuredOrigins
    .split(',')
    .map(o => o.trim())
    .filter(Boolean);

  const baseOrigins = isProduction ? PRODUCTION_DEFAULT_ALLOWED_ORIGINS : DEFAULT_ALLOWED_ORIGINS;
  const corsAllowedOrigins = Array.from(new Set([...baseOrigins, ...parsedOrigins]));

  // 5. SMTP configuration
  const smtpHost = env.SMTP_HOST ? env.SMTP_HOST.trim() : undefined;
  const smtpUser = env.SMTP_USER ? env.SMTP_USER.trim() : undefined;
  const smtpPort = parseInt(env.SMTP_PORT || '587', 10);
  const smtpFrom = env.SMTP_FROM || 'DORMEX Hostel Office <hostel-office@college.edu>';
  const smtpConfigured = !!(smtpHost && smtpUser);

  // 6. Demo seeding permissions
  // Production ALWAYS strictly blocks synthetic 30-demo-student seeding regardless of SEED_DEMO_DATA
  const allowDemoSeed = !isProduction && (env.SEED_DEMO_DATA === 'true' || isTest || isDevelopment);

  return {
    env: appEnv,
    isProduction,
    isTest,
    isDevelopment,
    port,
    host,
    corsAllowedOrigins,
    database: {
      url: dbUrl,
      isSsl,
      rejectUnauthorized,
      maxConnections,
      idleTimeoutMs,
      connectionTimeoutMs,
      isRenderInternal,
    },
    auth: {
      jwtSecret: effectiveJwtSecret,
      cookieSecret: env.COOKIE_SECRET ? env.COOKIE_SECRET.trim() : undefined,
      initialAdminEmail: env.INITIAL_ADMIN_EMAIL,
      initialAdminPassword: env.INITIAL_ADMIN_PASSWORD,
      initialAdminHash: env.INITIAL_ADMIN_HASH,
    },
    smtp: {
      isConfigured: smtpConfigured,
      host: smtpHost,
      port: isNaN(smtpPort) ? 587 : smtpPort,
      user: smtpUser,
      from: smtpFrom,
    },
    demo: {
      allowDemoSeed,
    },
  };
}

/**
 * Returns safe diagnostic metadata about environment configuration.
 * Reports variable names and validation status, but NEVER values.
 */
export function getSafeConfigDiagnostics(config: ServerConfig): {
  environment: string;
  host: string;
  port: number;
  databaseConfigured: boolean;
  databaseSsl: boolean;
  renderInternalSsl: boolean;
  jwtConfigured: boolean;
  smtpConfigured: boolean;
  allowedOriginsCount: number;
} {
  return {
    environment: config.env,
    host: config.host,
    port: config.port,
    databaseConfigured: !!config.database.url,
    databaseSsl: config.database.isSsl,
    renderInternalSsl: config.database.isRenderInternal,
    jwtConfigured: !!config.auth.jwtSecret,
    smtpConfigured: config.smtp.isConfigured,
    allowedOriginsCount: config.corsAllowedOrigins.length,
  };
}

let cachedConfig: ServerConfig | null = null;

export function getServerConfig(allowMemoryDb: boolean = false): ServerConfig {
  if (!cachedConfig || allowMemoryDb) {
    const cfg = loadServerConfig(process.env, allowMemoryDb);
    if (!allowMemoryDb) cachedConfig = cfg;
    return cfg;
  }
  return cachedConfig;
}

export function resetServerConfig(): void {
  cachedConfig = null;
}
