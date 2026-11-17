import fs from 'fs';
import type { Auth } from 'firebase-admin/auth';

function resolveFirebaseProjectId(): string | undefined {
  const envId =
    process.env.FIREBASE_PROJECT_ID?.trim() || process.env.VITE_FIREBASE_PROJECT_ID?.trim();
  if (envId) return envId;

  try {
    const raw = fs.readFileSync(
      new URL('../../firebase-applet-config.json', import.meta.url),
      'utf8'
    );
    const parsed = JSON.parse(raw) as { projectId?: string };
    return parsed.projectId?.trim() || undefined;
  } catch {
    return undefined;
  }
}

let adminAuthPromise: Promise<Auth | null> | null = null;

async function getLazyAdminAuth(): Promise<Auth | null> {
  if (!adminAuthPromise) {
    adminAuthPromise = (async () => {
      try {
        const projectId = resolveFirebaseProjectId();
        if (!projectId) {
          return null;
        }
        const [{ initializeApp, getApps }, { getAuth }] = await Promise.all([
          import('firebase-admin/app'),
          import('firebase-admin/auth'),
        ]);
        if (!getApps().length) {
          initializeApp({ projectId });
        }
        return getAuth();
      } catch (err) {
        console.warn('Firebase Admin lazy initialization failed:', err);
        return null;
      }
    })();
  }
  return adminAuthPromise;
}

export const adminAuth = {
  async verifyIdToken(idToken: string, checkRevoked?: boolean) {
    const auth = await getLazyAdminAuth();
    if (!auth) {
      throw new Error('FIREBASE_ADMIN_UNAVAILABLE');
    }
    return auth.verifyIdToken(idToken, checkRevoked);
  },
};
