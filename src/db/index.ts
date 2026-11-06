import { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';
import { newDb, IMemoryDb } from 'pg-mem';

export interface DatabaseService {
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

class PostgresDatabaseService implements DatabaseService {
  private pool: Pool;

  constructor(connectionString?: string) {
    const connStr = connectionString || process.env.DATABASE_URL;
    if (!connStr) {
      throw new Error('FATAL_DATABASE_CONFIG: DATABASE_URL must be provided for PostgreSQL connection');
    }

    // Auto-enable SSL for Neon or cloud PostgreSQL (sslmode=require, -pooler, or neon.tech) or if PG_SSL=true
    const isNeonOrCloud = connStr.includes('neon.tech') || connStr.includes('sslmode=require') || connStr.includes('-pooler');
    const isSsl = process.env.PG_SSL === 'true' || isNeonOrCloud;

    this.pool = new Pool({
      connectionString: connStr,
      max: parseInt(process.env.PG_MAX_CONNECTIONS || '20', 10),
      idleTimeoutMillis: parseInt(process.env.PG_IDLE_TIMEOUT_MS || '30000', 10),
      connectionTimeoutMillis: parseInt(process.env.PG_CONNECTION_TIMEOUT_MS || '5000', 10),
      ssl: isSsl ? { rejectUnauthorized: false } : undefined,
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
  private db: IMemoryDb;
  private adapter: any;

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

    const { Pool } = this.db.adapters.createPg();
    this.adapter = new Pool();
  }

  async query<T extends QueryResultRow = any>(text: string, params?: any[]): Promise<QueryResult<T>> {
    return this.adapter.query(text, params);
  }

  async getClient() {
    const client = await this.adapter.connect();
    return {
      query: <T extends QueryResultRow = any>(text: string, params?: any[]) => client.query(text, params),
      release: () => client.release(),
    };
  }

  async transaction<T>(fn: (client: {
    query<T extends QueryResultRow = any>(text: string, params?: any[]): Promise<QueryResult<T>>;
  }) => Promise<T>): Promise<T> {
    const client = await this.adapter.connect();
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
    throw new Error('FATAL_DATABASE_CONFIG: Production requires an externally supplied DATABASE_URL (Neon PostgreSQL)');
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
