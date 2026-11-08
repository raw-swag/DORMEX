import { getServerConfig } from '../config/index.js';
import { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';
import { newDb, IMemoryDb } from 'pg-mem';

export interface DatabaseService {
  isInMemory?: boolean;
  query<T extends QueryResultRow = any>(text: string, params?: any[]): Promise<QueryResult<T>>;
  getClient(): Promise<{
    query<T extends QueryResultRow = any>(text: string, params?: any[]): Promise<QueryResult<T>>;
    release(): void;
  }>;
  transaction<T>(fn: (client: {
    query<T extends QueryResultRow = any>(text: string, params?: any[]): Promise<QueryResult<T>>;
  }) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

import dotenv from 'dotenv';
dotenv.config();

export class PostgresDatabaseService implements DatabaseService {
  public isInMemory = false;
  private pool: Pool;

  constructor(connectionString?: string) {
    const connStr = connectionString || process.env.DATABASE_URL;
    if (!connStr) {
      throw new Error('FATAL_DATABASE_CONFIG: DATABASE_URL must be provided for PostgreSQL connection');
    }

    // Auto-enable SSL for cloud PostgreSQL (sslmode=require, -pooler, or neon.tech) or if PG_SSL=true
    const isNeonOrCloud = connStr.includes('sslmode=require') || connStr.includes('-pooler');
    const isSsl = process.env.PG_SSL === 'true' || isNeonOrCloud;

    // TLS configuration: Render internal database uses private self-signed certificates
    // Fail-closed: Must bind explicitly to configured internal database host or strict .render.internal domain
    let isRenderInternal = false;
    try {
      const parsedUrl = new URL(connStr);
      let host = parsedUrl.hostname.trim().toLowerCase();
      if (host.endsWith('.')) host = host.slice(0, -1);

      const trustedInternalHost = process.env.RENDER_INTERNAL_DB_HOST
        ? process.env.RENDER_INTERNAL_DB_HOST.trim().toLowerCase()
        : 'dpg-dbnjeqrl550s73fcr1lg-a';

      const matchesExplicit = host === trustedInternalHost || host === `${trustedInternalHost}.internal`;
      const matchesRenderInternalDomain = host.startsWith('dpg-') && (host.endsWith('.render.internal') || host.endsWith('.oregon-postgres.render.internal'));

      isRenderInternal = (matchesExplicit || matchesRenderInternalDomain) && !host.endsWith('.render.com');
    } catch {
      isRenderInternal = false;
    }

    const rejectUnauthorized = process.env.PG_SSL_REJECT_UNAUTHORIZED === 'false' || isRenderInternal
      ? false
      : (process.env.PG_SSL_REJECT_UNAUTHORIZED === 'true' || true);

    const sslConfig = isSsl ? { rejectUnauthorized } : undefined;

    this.pool = new Pool({
      connectionString: connStr,
      max: parseInt(process.env.PG_MAX_CONNECTIONS || '20', 10),
      idleTimeoutMillis: parseInt(process.env.PG_IDLE_TIMEOUT_MS || '30000', 10),
      connectionTimeoutMillis: parseInt(process.env.PG_CONNECTION_TIMEOUT_MS || '5000', 10),
      ssl: sslConfig,
    });

    this.pool.on('error', (err) => {
      console.error('Unexpected idle client error in PostgreSQL pool', err);
    });
  }

  async testConnection(): Promise<boolean> {
    try {
      const res = await this.pool.query('SELECT 1 as alive');
      return res.rows[0]?.alive === 1;
    } catch (err) {
      console.error('PostgreSQL connection check failed:', err);
      return false;
    }
  }

  async query<T extends QueryResultRow = any>(text: string, params?: any[]): Promise<QueryResult<T>> {
    return this.pool.query<T>(text, params);
  }

  async getClient() {
    const client = await this.pool.connect();
    return {
      query: <T extends QueryResultRow = any>(text: string, params?: any[]) => client.query<T>(text, params),
      release: () => client.release(),
    };
  }

  async transaction<T>(fn: (client: {
    query<T extends QueryResultRow = any>(text: string, params?: any[]): Promise<QueryResult<T>>;
  }) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

class MemoryDatabaseService implements DatabaseService {
  public isInMemory = true;
  private db: IMemoryDb;
  private adapter: any;
  private txMutex: Promise<void> = Promise.resolve();

  constructor() {
    this.db = newDb({
      autoCreateForeignKeyIndices: true,
    });
    // Register uuid generation helper
    this.db.public.registerFunction({
      name: 'gen_random_uuid',
      returns: (this.db.public as any).getType('text'),
      implementation: () => crypto.randomUUID(),
    });
    this.db.public.registerFunction({
      name: 'current_database',
      returns: (this.db.public as any).getType('text'),
      implementation: () => process.env.TEST_DB_NAME || 'dormex_staging',
    });
    this.db.public.registerFunction({
      name: 'regexp_like',
      args: [(this.db.public as any).getType('text'), (this.db.public as any).getType('text')],
      returns: (this.db.public as any).getType('bool'),
      implementation: (val: string, pattern: string) => {
        if (!val || !pattern) return false;
        try {
          return new RegExp(pattern, 'i').test(val);
        } catch {
          return false;
        }
      },
    });

    // In pg-mem, information_schema.columns hardcodes is_nullable to 'NO'.
    // Provide a helper to accurately check column nullability from table metadata.
    this.db.public.registerFunction({
      name: '__pgmem_is_column_nullable',
      args: [(this.db.public as any).getType('text'), (this.db.public as any).getType('text')],
      returns: (this.db.public as any).getType('bool'),
      implementation: (tblName: string, colName: string) => {
        try {
          const tbl = (this.db.public as any).getTable(tblName);
          const colRef = tbl?.columnMgr?.get(colName);
          return colRef ? !colRef.notNull : true;
        } catch {
          return true;
        }
      },
    });

    const { Pool } = this.db.adapters.createPg();
    this.adapter = new Pool();
  }

  async query<T extends QueryResultRow = any>(text: string, params?: any[]): Promise<QueryResult<T>> {
    return this.adapter.query(text, params);
  }

  async getClient() {
    const client = await this.adapter.connect();
    (client as any).isInMemory = true;
    return {
      query: <T extends QueryResultRow = any>(text: string, params?: any[]) => client.query(text, params),
      release: () => client.release(),
      isInMemory: true,
    };
  }

  async transaction<T>(fn: (client: {
    query<T extends QueryResultRow = any>(text: string, params?: any[]): Promise<QueryResult<T>>;
    isInMemory?: boolean;
  }) => Promise<T>): Promise<T> {
    // Chain transaction executions to emulate PostgreSQL serial/atomic transaction locks
    let releaseLock: () => void = () => {};
    const currentLock = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });
    const previousLock = this.txMutex;
    this.txMutex = currentLock;

    await previousLock;
    const client = await this.adapter.connect();
    (client as any).isInMemory = true;
    let backupState: any = null;
    try {
      backupState = this.db.backup();
    } catch {}
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      if (backupState) {
        try {
          backupState.restore();
        } catch {}
      }
      throw err;
    } finally {
      client.release();
      releaseLock();
    }
  }

  async close(): Promise<void> {
    await this.adapter.end();
  }
}

let dbInstance: DatabaseService | null = null;

export function getDatabaseService(forceMemory: boolean = false): DatabaseService {
  if (dbInstance) {
    return dbInstance;
  }

  const isProduction = process.env.NODE_ENV === 'production';
  if (isProduction && !process.env.DATABASE_URL && !forceMemory) {
    throw new Error('FATAL_DATABASE_CONFIG: Production requires an externally supplied DATABASE_URL (PostgreSQL)');
  }

  if (forceMemory || process.env.NODE_ENV === 'test' || (!process.env.DATABASE_URL && !isProduction)) {
    dbInstance = new MemoryDatabaseService();
  } else {
    dbInstance = new PostgresDatabaseService();
  }

  return dbInstance;
}

export function resetDatabaseInstance(): void {
  dbInstance = null;
}
