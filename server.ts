import express from 'express';
import dotenv from 'dotenv';
import path from 'path';
import authRoutes from './src/server/routes/authRoutes.ts';
import supplierRoutes from './src/server/routes/supplierRoutes.ts';
import inventoryRoutes from './src/server/routes/inventoryRoutes.ts';
import operationsRoutes from './src/server/routes/operationsRoutes.ts';
import accountingRoutes from './src/server/routes/accountingRoutes.ts';
import { createRateLimiter } from './src/server/security.ts';

dotenv.config();

const PORT = 3000;

async function startServer() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  // Security headers (preserve iframe embed compatibility for AI Studio preview)
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

  // Strict CORS middleware for same-origin, localhost dev, APP_URL, and Cloud Run origins
  const configuredOrigin = process.env.APP_URL?.trim().replace(/\/+$/, '');
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin) {
      const normalized = origin.replace(/\/+$/, '');
      const isAllowed =
        (configuredOrigin && normalized === configuredOrigin) ||
        /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(normalized) ||
        /^https:\/\/[a-z0-9.-]+\.(run\.app|web\.app|firebaseapp\.com|aistudio\.google\.com|scf\.usercontent\.goog)$/i.test(
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

  // Health probe
  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, service: 'sbms-api', timestamp: new Date().toISOString() });
  });

  // REST API Routes
  app.use('/api/auth', authRoutes);
  app.use('/api/suppliers', supplierRoutes);
  app.use('/api/inventory', inventoryRoutes);
  app.use('/api/accounting', accountingRoutes);
  app.use('/api', operationsRoutes);

  // Vite middleware in development, static dist in production
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(process.cwd(), 'dist');
    app.use(
      express.static(distPath, {
        maxAge: '7d',
        setHeaders: (res, filePath) => {
          if (filePath.endsWith('.html')) {
            res.setHeader('Cache-Control', 'no-cache');
          }
        },
      })
    );
    app.get('*', (_req, res) => {
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`SBMS Full-Stack Server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start SBMS server:', err);
  process.exit(1);
});
