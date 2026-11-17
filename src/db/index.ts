import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool, type PoolConfig } from 'pg';
import * as schema from './schema.ts';

declare global {
  var _postgresPool: Pool | undefined;
  var _drizzleDb: NodePgDatabase<typeof schema> | undefined;
}

const PREFERRED_URL_KEYS = [
  'DATABASE_URL',
  'POSTGRES_URL',
  'POSTGRES_PRISMA_URL',
  'PRISMA_DATABASE_URL',
  'POSTGRES_URL_NON_POOLING',
  'DATABASE_URL_UNPOOLED',
  'NEON_DATABASE_URL',
  'SUPABASE_DB_URL',
  'SUPABASE_POSTGRES_URL',
] as const;

export function resolveDatabaseConnection(): {
  source: string | null;
  connectionString?: string;
} {
  for (const key of PREFERRED_URL_KEYS) {
    const val = process.env[key]?.trim();
    if (val) {
      return { source: key, connectionString: val };
    }
  }

  // Fallback for Vercel Storage integrations configured with a custom prefix (e.g. SBMS_DATABASE_URL)
  for (const [key, rawVal] of Object.entries(process.env)) {
    const val = rawVal?.trim();
    if (
      val &&
      (/^postgres(ql)?:\/\//i.test(val)) &&
      (key.endsWith('_DATABASE_URL') || key.endsWith('_POSTGRES_URL'))
    ) {
      return { source: key, connectionString: val };
    }
  }

  if (process.env.SQL_HOST?.trim()) {
    return { source: 'SQL_HOST' };
  }
  if (process.env.PGHOST?.trim()) {
    return { source: 'PGHOST' };
  }

  return { source: null };
}

export function isDatabaseConfigured(): boolean {
  return resolveDatabaseConnection().source !== null;
}

function buildPoolConfig(): PoolConfig {
  const { connectionString } = resolveDatabaseConnection();

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

  const host = process.env.SQL_HOST?.trim() || process.env.PGHOST?.trim();
  const isUnixSocket = Boolean(host && host.startsWith('/'));
  const isLocalHost = !host || host === 'localhost' || host === '127.0.0.1';
  const shouldUseSsl = process.env.DB_SSL !== 'false' && !isUnixSocket && !isLocalHost;

  return {
    host,
    port: Number(process.env.SQL_PORT || process.env.PGPORT || 5432),
    user: process.env.SQL_USER || process.env.PGUSER,
    password: process.env.SQL_PASSWORD || process.env.PGPASSWORD,
    database: process.env.SQL_DB_NAME || process.env.PGDATABASE,
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
