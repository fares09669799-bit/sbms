import { ComponentType, lazy, LazyExoticComponent } from 'react';

const RELOAD_STORAGE_KEY = 'sbms_module_reload_ts';
const RELOAD_COOLDOWN_MS = 15_000;

function isDynamicImportError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const msg = error.message.toLowerCase();
  return (
    msg.includes('failed to fetch dynamically imported module') ||
    msg.includes('error loading dynamically imported module') ||
    msg.includes('importing a module script failed') ||
    msg.includes('loading chunk') ||
    error.name === 'ChunkLoadError'
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function lazyWithRetry<T extends ComponentType<any>>(
  importer: () => Promise<{ default: T }>
): LazyExoticComponent<T> {
  return lazy(async () => {
    const retryDelays = [300, 800];
    let lastError: unknown;

    for (let attempt = 0; attempt <= retryDelays.length; attempt += 1) {
      try {
        return await importer();
      } catch (err) {
        lastError = err;
        if (!isDynamicImportError(err) || attempt === retryDelays.length) {
          break;
        }
        await sleep(retryDelays[attempt]);
      }
    }

    if (isDynamicImportError(lastError) && typeof window !== 'undefined') {
      try {
        const lastReloadRaw = window.sessionStorage.getItem(RELOAD_STORAGE_KEY);
        const lastReload = lastReloadRaw ? Number(lastReloadRaw) : 0;
        const now = Date.now();
        if (!Number.isFinite(lastReload) || now - lastReload > RELOAD_COOLDOWN_MS) {
          window.sessionStorage.setItem(RELOAD_STORAGE_KEY, String(now));
          window.location.reload();
          // Suspend resolution while browser reloads to avoid flashing an error frame
          return await new Promise<{ default: T }>(() => {});
        }
      } catch {
        // Ignore sessionStorage restrictions and fall through to RouteErrorBoundary
      }
    }

    throw lastError;
  });
}
