import dotenv from 'dotenv';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool, type PoolConfig } from 'pg';
import * as schema from './schema.ts';

dotenv.config({ quiet: true });

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

type DiscreteDbSource = 'POSTGRES_HOST' | 'SQL_HOST' | 'PGHOST';

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
      /^postgres(ql)?:\/\//i.test(val) &&
      (key.endsWith('_DATABASE_URL') || key.endsWith('_POSTGRES_URL'))
    ) {
      return { source: key, connectionString: val };
    }
  }

  if (process.env.POSTGRES_HOST?.trim()) {
    return { source: 'POSTGRES_HOST' };
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

function buildDatabaseSslOptions(connectionString?: string): {
  rejectUnauthorized: boolean;
  ca?: string;
} {
  const explicitReject = process.env.DB_SSL_REJECT_UNAUTHORIZED?.trim().toLowerCase();
  let rejectUnauthorized = explicitReject !== 'false';
  if (!explicitReject && connectionString && /sslmode=(no-verify|allow|prefer)/i.test(connectionString)) {
    rejectUnauthorized = false;
  }

  const rawCa = process.env.DB_SSL_CA?.trim();
  const ca = rawCa ? rawCa.replace(/\\n/g, '\n') : undefined;
  return {
    rejectUnauthorized,
    ...(ca ? { ca } : {}),
  };
}

function resolveDiscreteCredentials(source: DiscreteDbSource) {
  const postgresPort = process.env.POSTGRES_PORT?.trim();
  const sqlPort = process.env.SQL_PORT?.trim();
  const pgPort = process.env.PGPORT?.trim();

  const postgresDatabase =
    process.env.POSTGRES_DATABASE?.trim() || process.env.POSTGRES_DB?.trim();
  const sqlDatabase = process.env.SQL_DB_NAME?.trim();
  const pgDatabase = process.env.PGDATABASE?.trim();

  const postgresUser = process.env.POSTGRES_USER?.trim();
  const sqlUser = process.env.SQL_USER?.trim() || process.env.SQL_ADMIN_USER?.trim();
  const pgUser = process.env.PGUSER?.trim();

  const postgresPassword = process.env.POSTGRES_PASSWORD;
  const sqlPassword = process.env.SQL_PASSWORD ?? process.env.SQL_ADMIN_PASSWORD;
  const pgPassword = process.env.PGPASSWORD;

  let host: string | undefined;
  let rawPort: string | undefined;
  let user: string | undefined;
  let password: string | undefined;
  let database: string | undefined;

  if (source === 'POSTGRES_HOST') {
    host = process.env.POSTGRES_HOST?.trim();
    rawPort = postgresPort || sqlPort || pgPort;
    user = postgresUser || sqlUser || pgUser;
    password = postgresPassword ?? sqlPassword ?? pgPassword;
    database = postgresDatabase || sqlDatabase || pgDatabase;
  } else if (source === 'SQL_HOST') {
    host = process.env.SQL_HOST?.trim();
    rawPort = sqlPort || postgresPort || pgPort;
    user = sqlUser || postgresUser || pgUser;
    password = sqlPassword ?? postgresPassword ?? pgPassword;
    database = sqlDatabase || postgresDatabase || pgDatabase;
  } else {
    host = process.env.PGHOST?.trim();
    rawPort = pgPort || postgresPort || sqlPort;
    user = pgUser || postgresUser || sqlUser;
    password = pgPassword ?? postgresPassword ?? sqlPassword;
    database = pgDatabase || postgresDatabase || sqlDatabase;
  }

  const parsedPort = rawPort ? Number(rawPort) : 5432;
  const port = Number.isFinite(parsedPort) && parsedPort > 0 ? parsedPort : 5432;

  return { host, port, user, password, database };
}

function buildPoolConfig(): PoolConfig {
  const { source, connectionString } = resolveDatabaseConnection();

  const isVercel = Boolean(process.env.VERCEL);
  const maxConnections = isVercel ? 1 : 10;
  const idleTimeoutMillis = isVercel ? 5000 : 30000;

  if (connectionString) {
    const isLocalUrl =
      connectionString.includes('localhost') ||
      connectionString.includes('127.0.0.1') ||
      connectionString.includes('::1') ||
      connectionString.includes('sslmode=disable');
    const shouldUseSsl = process.env.DB_SSL !== 'false' && !isLocalUrl;

    return {
      connectionString,
      max: maxConnections,
      idleTimeoutMillis,
      connectionTimeoutMillis: 10000,
      ...(isVercel ? { allowExitOnIdle: true } : {}),
      ...(shouldUseSsl ? { ssl: buildDatabaseSslOptions(connectionString) } : {}),
    };
  }

  const discreteSource: DiscreteDbSource =
    source === 'POSTGRES_HOST' || source === 'SQL_HOST' || source === 'PGHOST'
      ? source
      : 'POSTGRES_HOST';
  const { host, port, user, password, database } = resolveDiscreteCredentials(discreteSource);
  const isUnixSocket = Boolean(host && host.startsWith('/'));
  const isLocalHost =
    !host || host === 'localhost' || host === '127.0.0.1' || host === '::1';
  const shouldUseSsl = process.env.DB_SSL !== 'false' && !isUnixSocket && !isLocalHost;

  return {
    host,
    port,
    user,
    password,
    database,
    max: maxConnections,
    idleTimeoutMillis,
    connectionTimeoutMillis: 10000,
    ...(isVercel ? { allowExitOnIdle: true } : {}),
    ...(shouldUseSsl ? { ssl: buildDatabaseSslOptions() } : {}),
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
