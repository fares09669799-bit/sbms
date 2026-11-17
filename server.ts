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
      server: { middlewareMode: true, hmr: false, watch: null },
      appType: 'spa',
    });
    // Serve a WebSocket-free /@vite/client shim because HMR WebSockets are disabled in preview
    app.get('/@vite/client', (_req, res) => {
      res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      res.send(`
const sheetsMap = new Map();
const linkSheetsMap = new Map();
if ("document" in globalThis) {
  document.querySelectorAll("style[data-vite-dev-id]").forEach((el) => {
    sheetsMap.set(el.getAttribute("data-vite-dev-id"), el);
  });
  document.querySelectorAll('link[rel="stylesheet"][data-vite-dev-id]').forEach((el) => {
    linkSheetsMap.set(el.getAttribute("data-vite-dev-id"), el);
  });
}
let lastInsertedStyle;
export function updateStyle(id, content) {
  if (linkSheetsMap.has(id)) return;
  let style = sheetsMap.get(id);
  if (!style) {
    style = document.createElement("style");
    style.setAttribute("type", "text/css");
    style.setAttribute("data-vite-dev-id", id);
    style.textContent = content;
    if (!lastInsertedStyle) {
      document.head.appendChild(style);
      setTimeout(() => { lastInsertedStyle = undefined; }, 0);
    } else {
      lastInsertedStyle.insertAdjacentElement("afterend", style);
    }
    lastInsertedStyle = style;
  } else if (style.textContent !== content) {
    style.textContent = content;
  }
  sheetsMap.set(id, style);
}
export function removeStyle(id) {
  if (linkSheetsMap.has(id)) {
    document.querySelectorAll(\`link[rel="stylesheet"][data-vite-dev-id="\${CSS.escape(id)}"]\`).forEach((el) => el.remove());
    linkSheetsMap.delete(id);
  }
  const style = sheetsMap.get(id);
  if (style) {
    document.head.removeChild(style);
    sheetsMap.delete(id);
  }
}
export function createHotContext() {
  return {
    data: {},
    accept() {},
    acceptExports() {},
    dispose() {},
    prune() {},
    invalidate() {},
    decline() {},
    on() {},
    off() {},
    send() {},
  };
}
export function injectQuery(url, queryToInject) {
  if (url[0] !== "." && url[0] !== "/") return url;
  const pathname = url.replace(/[?#].*$/, "");
  const { search, hash } = new URL(url, "http://vite.dev");
  return \`\${pathname}?\${queryToInject}\${search ? "&" + search.slice(1) : ""}\${hash || ""}\`;
}
export class ErrorOverlay extends (globalThis.HTMLElement || class {}) {}
`);
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
