import express, { type NextFunction, type Request, type Response } from 'express';
import dotenv from 'dotenv';
import authRoutes from './routes/authRoutes.ts';
import supplierRoutes from './routes/supplierRoutes.ts';
import inventoryRoutes from './routes/inventoryRoutes.ts';
import operationsRoutes from './routes/operationsRoutes.ts';
import accountingRoutes from './routes/accountingRoutes.ts';
import { createRateLimiter } from './security.ts';
import { createPool, isDatabaseConfigured, resolveDatabaseConnection } from '../db/index.ts';

dotenv.config();

export function createApiApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  // Security headers (preserve iframe embed compatibility)
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
    if (
      process.env.NODE_ENV === 'production' ||
      req.secure ||
      req.headers['x-forwarded-proto'] === 'https'
    ) {
      res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }
    next();
  });

  // Strict CORS middleware supporting APP_URL, Vercel, Cloud Run, Firebase, and localhost
  const configuredOrigin = process.env.APP_URL?.trim().replace(/\/+$/, '');
  const vercelOrigin = process.env.VERCEL_URL?.trim()
    ? `https://${process.env.VERCEL_URL.trim().replace(/^https?:\/\//, '').replace(/\/+$/, '')}`
    : undefined;

  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin) {
      const normalized = origin.replace(/\/+$/, '');
      const isAllowed =
        (configuredOrigin && normalized === configuredOrigin) ||
        (vercelOrigin && normalized === vercelOrigin) ||
        /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(normalized) ||
        /^https:\/\/[a-z0-9.-]+\.(vercel\.app|run\.app|web\.app|firebaseapp\.com|aistudio\.google\.com|scf\.usercontent\.goog)$/i.test(
          normalized
        );

      if (isAllowed) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Vary', 'Origin');
        res.setHeader('Access-Control-Allow-Credentials', 'true');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      }
      if (req.method === 'OPTIONS') {
        return res.status(isAllowed ? 204 : 403).end();
      }
    }
    return next();
  });

  app.use(express.json({ limit: '1mb' }));

  const apiRateLimiter = createRateLimiter({
    windowMs: 60 * 1000,
    max: 180,
    message: 'تم تجاوز حد الطلبات المسموح. يرجى المحاولة بعد قليل.',
  });
  app.use('/api', apiRateLimiter);

  // Health probe (never throws; always returns 200 JSON)
  app.get('/api/health', async (_req, res) => {
    const { source: dbSource } = resolveDatabaseConnection();
    const dbConfigured = dbSource !== null;
    let dbReachable = false;
    let tablesReady = false;

    if (dbConfigured) {
      let timeoutId: ReturnType<typeof setTimeout> | undefined;
      try {
        const timeoutPromise = new Promise<never>((_, reject) => {
          timeoutId = setTimeout(() => reject(new Error('DB_HEALTH_TIMEOUT')), 3000);
        });
        const queryPromise = createPool().query<{ ok: number; tables_ready: boolean }>(
          "SELECT 1 AS ok, to_regclass('public.users') IS NOT NULL AS tables_ready"
        );
        queryPromise.catch(() => null);
        const result = await Promise.race([queryPromise, timeoutPromise]);
        dbReachable = result.rows[0]?.ok === 1;
        tablesReady = Boolean(result.rows[0]?.tables_ready);
      } catch {
        dbReachable = false;
        tablesReady = false;
      } finally {
        if (timeoutId) clearTimeout(timeoutId);
      }
    }

    return res.status(200).json({
      ok: true,
      service: 'sbms-api',
      dbConfigured,
      dbSource,
      dbReachable,
      tablesReady,
      timestamp: new Date().toISOString(),
    });
  });

  // REST API Routes
  app.use('/api/auth', authRoutes);
  app.use('/api/suppliers', supplierRoutes);
  app.use('/api/inventory', inventoryRoutes);
  app.use('/api/accounting', accountingRoutes);
  app.use('/api', operationsRoutes);

  // Unknown API route guard (always return JSON instead of HTML)
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'نقطة النهاية المطلوبة غير موجودة.' });
  });

  // JSON error handler for API requests
  app.use('/api', (err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    console.error('Unhandled API error:', err);
    if (!isDatabaseConfigured()) {
      return res.status(503).json({
        error: 'قاعدة البيانات غير مهيأة في متغيرات البيئة (DATABASE_URL أو POSTGRES_HOST أو SQL_HOST).',
      });
    }
    return res.status(500).json({ error: 'حدث خطأ داخلي في الخادم.' });
  });

  return app;
}
