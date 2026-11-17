import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool, type PoolConfig } from 'pg';
import * as schema from './schema.ts';

declare global {
  var _postgresPool: Pool | undefined;
  var _drizzleDb: NodePgDatabase<typeof schema> | undefined;
}

export function isDatabaseConfigured(): boolean {
  return Boolean(
    process.env.DATABASE_URL?.trim() ||
      process.env.POSTGRES_URL?.trim() ||
      process.env.POSTGRES_PRISMA_URL?.trim() ||
      process.env.SQL_HOST?.trim()
  );
}

function buildPoolConfig(): PoolConfig {
  const connectionString =
    process.env.DATABASE_URL?.trim() ||
    process.env.POSTGRES_URL?.trim() ||
    process.env.POSTGRES_PRISMA_URL?.trim();

  const isVercel = Boolean(process.env.VERCEL);
  const maxConnections = isVercel ? 1 : 10;
  const idleTimeoutMillis = isVercel ? 5000 : 30000;

  if (connectionString) {
    const isLocalUrl =
      connectionString.includes('localhost') ||
      connectionString.includes('127.0.0.1') ||
      connectionString.includes('sslmode=disable');
    const shouldUseSsl = process.env.DB_SSL !== 'false' && !isLocalUrl;

    return {
      connectionString,
      max: maxConnections,
      idleTimeoutMillis,
      connectionTimeoutMillis: 10000,
      ...(isVercel ? { allowExitOnIdle: true } : {}),
      ...(shouldUseSsl ? { ssl: { rejectUnauthorized: false } } : {}),
    };
  }

  const host = process.env.SQL_HOST?.trim();
  const isUnixSocket = Boolean(host && host.startsWith('/'));
  const isLocalHost = !host || host === 'localhost' || host === '127.0.0.1';
  const shouldUseSsl = process.env.DB_SSL !== 'false' && !isUnixSocket && !isLocalHost;

  return {
    host,
    port: process.env.SQL_PORT ? Number(process.env.SQL_PORT) : 5432,
    user: process.env.SQL_USER,
    password: process.env.SQL_PASSWORD,
    database: process.env.SQL_DB_NAME,
    max: maxConnections,
    idleTimeoutMillis,
    connectionTimeoutMillis: 10000,
    ...(isVercel ? { allowExitOnIdle: true } : {}),
    ...(shouldUseSsl ? { ssl: { rejectUnauthorized: false } } : {}),
  };
}

export const createPool = (): Pool => {
  if (!global._postgresPool) {
    if (!isDatabaseConfigured()) {
      throw new Error('DATABASE_NOT_CONFIGURED');
    }
    global._postgresPool = new Pool(buildPoolConfig());

    global._postgresPool.on('error', (err) => {
      console.error('Unexpected error on idle SQL pool client:', err);
    });
  }
  return global._postgresPool;
};

function getLazyDb(): NodePgDatabase<typeof schema> {
  if (!global._drizzleDb) {
    global._drizzleDb = drizzle(createPool(), { schema });
  }
  return global._drizzleDb;
}

export const pool: Pool = new Proxy({} as Pool, {
  get(_target, prop, receiver) {
    const realPool = createPool();
    const value = Reflect.get(realPool, prop, receiver);
    return typeof value === 'function' ? value.bind(realPool) : value;
  },
});

export const db: NodePgDatabase<typeof schema> = new Proxy({} as NodePgDatabase<typeof schema>, {
  get(_target, prop, receiver) {
    const realDb = getLazyDb();
    const value = Reflect.get(realDb, prop, receiver);
    return typeof value === 'function' ? value.bind(realDb) : value;
  },
});
