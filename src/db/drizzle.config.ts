import { defineConfig } from 'drizzle-kit';
import * as dotenv from 'dotenv';

const envFiles = [
  '.env.local',
  ...(process.env.NODE_ENV === 'production' ? ['.env.production.local', '.env.production'] : []),
  '.env',
];

for (const envPath of envFiles) {
  dotenv.config({ path: envPath, quiet: true });
}

function normalizeConnectionUrl(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    const hostname = parsed.hostname.toLowerCase();
    const isLocal = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';

    if (!isLocal && process.env.DB_SSL !== 'false' && !parsed.searchParams.has('sslmode')) {
      const rejectUnauthorized =
        process.env.DB_SSL_REJECT_UNAUTHORIZED?.trim().toLowerCase() !== 'false';
      parsed.searchParams.set('sslmode', rejectUnauthorized ? 'require' : 'no-verify');
    }
    return parsed.toString();
  } catch {
    return rawUrl;
  }
}

function resolveDrizzleUrl(): string | undefined {
  const preferredKeys = [
    'DATABASE_URL_UNPOOLED',
    'POSTGRES_URL_NON_POOLING',
    'DATABASE_URL',
    'POSTGRES_URL',
    'POSTGRES_PRISMA_URL',
    'PRISMA_DATABASE_URL',
    'NEON_DATABASE_URL',
    'SUPABASE_DB_URL',
    'SUPABASE_POSTGRES_URL',
  ];
  for (const key of preferredKeys) {
    const val = process.env[key]?.trim();
    if (val) return normalizeConnectionUrl(val);
  }
  for (const [key, rawVal] of Object.entries(process.env)) {
    const val = rawVal?.trim();
    if (
      val &&
      /^postgres(ql)?:\/\//i.test(val) &&
      (key.endsWith('_DATABASE_URL') || key.endsWith('_POSTGRES_URL'))
    ) {
      return normalizeConnectionUrl(val);
    }
  }
  return undefined;
}

const databaseUrl = resolveDrizzleUrl();

const rawHost =
  process.env.POSTGRES_HOST?.trim() ||
  process.env.SQL_HOST?.trim() ||
  process.env.PGHOST?.trim();
const rawPort =
  process.env.POSTGRES_PORT?.trim() ||
  process.env.SQL_PORT?.trim() ||
  process.env.PGPORT?.trim();
const sqlHost = rawHost;
const sqlPort = rawPort ? Number(rawPort) : 5432;
const sqlDbName =
  process.env.POSTGRES_DATABASE?.trim() ||
  process.env.POSTGRES_DB?.trim() ||
  process.env.SQL_DB_NAME?.trim() ||
  process.env.PGDATABASE?.trim();
const user =
  process.env.POSTGRES_USER?.trim() ||
  process.env.SQL_ADMIN_USER?.trim() ||
  process.env.SQL_USER?.trim() ||
  process.env.PGUSER?.trim();
const password =
  process.env.POSTGRES_PASSWORD ??
  process.env.SQL_ADMIN_PASSWORD ??
  process.env.SQL_PASSWORD ??
  process.env.PGPASSWORD;

if (!databaseUrl) {
  if (!sqlHost) {
    throw new Error('DATABASE_URL, POSTGRES_HOST, or SQL_HOST must be set in environment variables.');
  }
  if (!sqlDbName) {
    throw new Error('POSTGRES_DATABASE or SQL_DB_NAME must be set in environment variables.');
  }
  if (!user) {
    throw new Error('POSTGRES_USER or SQL_ADMIN_USER must be set in environment variables.');
  }
  if (!password) {
    throw new Error('POSTGRES_PASSWORD or SQL_ADMIN_PASSWORD must be set in environment variables.');
  }
}

const isUnixSocket = Boolean(sqlHost && sqlHost.startsWith('/'));
const isLocalHost =
  !sqlHost || sqlHost === 'localhost' || sqlHost === '127.0.0.1' || sqlHost === '::1';
const shouldUseHostSsl = process.env.DB_SSL !== 'false' && !isUnixSocket && !isLocalHost;
const sslRejectUnauthorized =
  process.env.DB_SSL_REJECT_UNAUTHORIZED?.trim().toLowerCase() !== 'false';
const sslCa = process.env.DB_SSL_CA?.trim();
const hostSslConfig = shouldUseHostSsl
  ? {
      rejectUnauthorized: sslRejectUnauthorized,
      ...(sslCa ? { ca: sslCa.replace(/\\n/g, '\n') } : {}),
    }
  : false;

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  schemaFilter: ['public'],
  dbCredentials: databaseUrl
    ? { url: databaseUrl }
    : {
        host: sqlHost!,
        port: Number.isFinite(sqlPort) && sqlPort > 0 ? sqlPort : 5432,
        user: user!,
        password: password!,
        database: sqlDbName!,
        ssl: hostSslConfig,
      },
  verbose: true,
});
