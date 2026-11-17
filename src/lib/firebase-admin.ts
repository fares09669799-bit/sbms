import fs from 'fs';
import { initializeApp, getApps } from 'firebase-admin/app';
import { getAuth, type Auth } from 'firebase-admin/auth';

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

let resolvedAdminAuth: Auth | null = null;

try {
  const projectId = resolveFirebaseProjectId();
  if (!getApps().length) {
    if (projectId) {
      initializeApp({ projectId });
      resolvedAdminAuth = getAuth();
    }
  } else {
    resolvedAdminAuth = getAuth();
  }
} catch (err) {
  console.warn('Firebase Admin initialization skipped:', err);
  resolvedAdminAuth = null;
}

export const adminAuth = resolvedAdminAuth;
