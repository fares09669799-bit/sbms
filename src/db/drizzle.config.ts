import { defineConfig } from 'drizzle-kit';
import * as dotenv from 'dotenv';

dotenv.config();

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
    if (val) return val;
  }
  for (const [key, rawVal] of Object.entries(process.env)) {
    const val = rawVal?.trim();
    if (
      val &&
      /^postgres(ql)?:\/\//i.test(val) &&
      (key.endsWith('_DATABASE_URL') || key.endsWith('_POSTGRES_URL'))
    ) {
      return val;
    }
  }
  return undefined;
}

const databaseUrl = resolveDrizzleUrl();

const sqlHost = process.env.SQL_HOST || process.env.PGHOST;
const sqlDbName = process.env.SQL_DB_NAME || process.env.PGDATABASE;
const user = process.env.SQL_ADMIN_USER || process.env.SQL_USER || process.env.PGUSER;
const password = process.env.SQL_ADMIN_PASSWORD || process.env.SQL_PASSWORD || process.env.PGPASSWORD;

if (!databaseUrl) {
  if (!sqlHost) {
    throw new Error('SQL_HOST or DATABASE_URL must be set in environment variables.');
  }
  if (!sqlDbName) {
    throw new Error('SQL_DB_NAME must be set in environment variables.');
  }
  if (!user) {
    throw new Error('SQL_ADMIN_USER must be set in environment variables.');
  }
  if (!password) {
    throw new Error('SQL_ADMIN_PASSWORD must be set in environment variables.');
  }
}

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  schemaFilter: ['public'],
  dbCredentials: databaseUrl
    ? { url: databaseUrl }
    : {
        host: sqlHost!,
        user: user!,
        password: password!,
        database: sqlDbName!,
        ssl: false,
      },
  verbose: true,
});
