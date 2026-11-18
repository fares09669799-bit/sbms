import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createPool, isDatabaseConfigured, resolveDatabaseConnection } from './index.ts';

const DB_ENV_KEYS = [
  'DATABASE_URL',
  'POSTGRES_URL',
  'POSTGRES_PRISMA_URL',
  'PRISMA_DATABASE_URL',
  'POSTGRES_URL_NON_POOLING',
  'DATABASE_URL_UNPOOLED',
  'NEON_DATABASE_URL',
  'SUPABASE_DB_URL',
  'SUPABASE_POSTGRES_URL',
  'POSTGRES_HOST',
  'POSTGRES_PORT',
  'POSTGRES_USER',
  'POSTGRES_PASSWORD',
  'POSTGRES_DATABASE',
  'POSTGRES_DB',
  'SQL_HOST',
  'SQL_PORT',
  'SQL_USER',
  'SQL_PASSWORD',
  'SQL_DB_NAME',
  'SQL_ADMIN_USER',
  'SQL_ADMIN_PASSWORD',
  'PGHOST',
  'PGPORT',
  'PGUSER',
  'PGPASSWORD',
  'PGDATABASE',
] as const;

describe('PostgreSQL Connection Resolution (src/db/index.ts)', () => {
  const savedEnv = new Map<string, string | undefined>();
  const savedCustomKeys: string[] = [];

  beforeEach(() => {
    for (const key of Object.keys(process.env)) {
      if (key.endsWith('_DATABASE_URL') || key.endsWith('_POSTGRES_URL')) {
        savedEnv.set(key, process.env[key]);
        savedCustomKeys.push(key);
        delete process.env[key];
      }
    }
    for (const key of DB_ENV_KEYS) {
      savedEnv.set(key, process.env[key]);
      delete process.env[key];
    }
    global._postgresPool = undefined;
    global._drizzleDb = undefined;
  });

  afterEach(() => {
    for (const key of [...DB_ENV_KEYS, ...savedCustomKeys]) {
      const prev = savedEnv.get(key);
      if (prev === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = prev;
      }
    }
    savedEnv.clear();
    savedCustomKeys.length = 0;
    global._postgresPool = undefined;
    global._drizzleDb = undefined;
  });

  it('reports unconfigured and throws DATABASE_NOT_CONFIGURED when no DB env vars are present', () => {
    expect(resolveDatabaseConnection()).toEqual({ source: null });
    expect(isDatabaseConfigured()).toBe(false);
    expect(() => createPool()).toThrowError('DATABASE_NOT_CONFIGURED');
  });

  it('supports POSTGRES_HOST, POSTGRES_PORT, POSTGRES_USER, POSTGRES_PASSWORD, POSTGRES_DATABASE', () => {
    process.env.POSTGRES_HOST = 'db.example.supabase.co';
    process.env.POSTGRES_PORT = '6543';
    process.env.POSTGRES_USER = 'postgres.demo';
    process.env.POSTGRES_PASSWORD = 'demo-only-test-value';
    process.env.POSTGRES_DATABASE = 'postgres';

    expect(resolveDatabaseConnection()).toEqual({ source: 'POSTGRES_HOST' });
    expect(isDatabaseConfigured()).toBe(true);

    const pool = createPool();
    expect(pool.options.host).toBe('db.example.supabase.co');
    expect(pool.options.port).toBe(6543);
    expect(pool.options.user).toBe('postgres.demo');
    expect(pool.options.database).toBe('postgres');
  });

  it('prefers DATABASE_URL over discrete host variables when both are configured', () => {
    process.env.DATABASE_URL = 'postgresql://postgres:test@db.example.supabase.co:6543/postgres?sslmode=require';
    process.env.POSTGRES_HOST = 'fallback-host.example.com';

    const resolved = resolveDatabaseConnection();
    expect(resolved.source).toBe('DATABASE_URL');
    expect(resolved.connectionString).toContain('db.example.supabase.co:6543');
    expect(isDatabaseConfigured()).toBe(true);
  });

  it('continues supporting SQL_HOST when POSTGRES_HOST and URLs are absent', () => {
    process.env.SQL_HOST = '127.0.0.1';
    process.env.SQL_PORT = '5432';
    process.env.SQL_USER = 'sbms_user';
    process.env.SQL_PASSWORD = 'demo-only-test-value';
    process.env.SQL_DB_NAME = 'sbms';

    expect(resolveDatabaseConnection()).toEqual({ source: 'SQL_HOST' });
    const pool = createPool();
    expect(pool.options.host).toBe('127.0.0.1');
    expect(pool.options.port).toBe(5432);
    expect(pool.options.database).toBe('sbms');
  });
});
