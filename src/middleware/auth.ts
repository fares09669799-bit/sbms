import type { NextFunction, Request, Response } from 'express';
import { eq } from 'drizzle-orm';
import { adminAuth } from '../lib/firebase-admin.ts';
import { db, isDatabaseConfigured } from '../db/index.ts';
import { users } from '../db/schema.ts';
import { verifyAccessToken } from '../server/security.ts';

export const DEFAULT_AGENT_PERMISSIONS = [
  'PRODUCTION_LOG',
  'SALES_LOG',
  'EXPENSES_LOG',
  'SHIFT_MANAGE',
] as const;

export interface AuthenticatedDbUser {
  id: number;
  uid: string;
  username: string;
  fullName: string;
  role: 'OWNER' | 'AGENT';
  phone: string;
  branchName: string;
  assignedShift: string | null;
  avatarUrl: string | null;
  permissions: string[];
}

export interface AuthRequest extends Request {
  authUser?: AuthenticatedDbUser;
}

export async function getOrCreateFirebaseUser(uid: string, email: string, name?: string) {
  const usernameBase = email.split('@')[0] || `user_${uid.slice(0, 6)}`;
  const [record] = await db
    .insert(users)
    .values({
      uid,
      username: `${usernameBase}_${uid.slice(0, 4)}`,
      email,
      fullName: name || usernameBase,
      roleCode: 'AGENT',
      permissions: [...DEFAULT_AGENT_PERMISSIONS],
      isActive: true,
    })
    .onConflictDoUpdate({
      target: users.uid,
      set: {
        email,
        updatedAt: new Date(),
      },
    })
    .returning();

  return record;
}

function mapAuthUser(dbUser: typeof users.$inferSelect): AuthenticatedDbUser {
  const role = dbUser.roleCode === 'OWNER' ? 'OWNER' : 'AGENT';
  const rawPerms = Array.isArray(dbUser.permissions)
    ? dbUser.permissions
    : [...DEFAULT_AGENT_PERMISSIONS];
  return {
    id: dbUser.id,
    uid: dbUser.uid,
    username: dbUser.username,
    fullName: dbUser.fullName,
    role,
    phone: dbUser.phone,
    branchName: dbUser.branchName,
    assignedShift: dbUser.assignedShift,
    avatarUrl: dbUser.avatarUrl ?? null,
    permissions:
      role === 'OWNER'
        ? ['ALL', ...DEFAULT_AGENT_PERMISSIONS]
        : rawPerms,
  };
}

export const requireAuth = async (req: AuthRequest, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'غير مصرح: رمز المصادقة مفقود.' });
  }

  const token = authHeader.slice(7).trim();
  if (!token) {
    return res.status(401).json({ error: 'غير مصرح: رمز المصادقة غير صالح.' });
  }

  try {
    // 1. Try SBMS JWT verification first
    let sbmsDecoded: ReturnType<typeof verifyAccessToken> | null = null;
    try {
      sbmsDecoded = verifyAccessToken(token);
    } catch {
      sbmsDecoded = null;
    }

    if (sbmsDecoded) {
      const [dbUser] = await db.select().from(users).where(eq(users.id, sbmsDecoded.sub)).limit(1);
      if (!dbUser) {
        return res.status(401).json({ error: 'حساب المستخدم غير موجود.' });
      }
      if (!dbUser.isActive) {
        return res.status(403).json({ error: 'تم إيقاف هذا الحساب من قبل إدارة المخبز.' });
      }
      req.authUser = mapAuthUser(dbUser);
      return next();
    }

    // 2. Fallback to Firebase ID Token verification only for RS256 tokens with a kid header
    let isFirebaseCandidate = false;
    try {
      const headerPart = token.split('.')[0];
      if (headerPart) {
        const header = JSON.parse(Buffer.from(headerPart, 'base64url').toString('utf8')) as {
          alg?: string;
          kid?: string;
        };
        isFirebaseCandidate = header.alg === 'RS256' && typeof header.kid === 'string' && header.kid.length > 0;
      }
    } catch {
      isFirebaseCandidate = false;
    }

    if (!isFirebaseCandidate) {
      return res.status(401).json({ error: 'انتهت الجلسة أو رمز المصادقة غير صالح.' });
    }

    const decodedFirebase = await adminAuth.verifyIdToken(token);
    const email = decodedFirebase.email || `${decodedFirebase.uid}@sbms.local`;
    const dbUser = await getOrCreateFirebaseUser(
      decodedFirebase.uid,
      email,
      decodedFirebase.name
    );

    if (!dbUser.isActive) {
      return res.status(403).json({ error: 'تم إيقاف هذا الحساب من قبل إدارة المخبز.' });
    }

    req.authUser = mapAuthUser(dbUser);
    return next();
  } catch (error) {
    console.error('Authentication failure:', error);
    const errObj = error as { code?: string; cause?: { code?: string }; message?: string } | null;
    const errCode = errObj?.code || errObj?.cause?.code;
    const errMsg = typeof errObj?.message === 'string' ? errObj.message : '';

    if (!isDatabaseConfigured() || errMsg === 'DATABASE_NOT_CONFIGURED') {
      return res.status(503).json({
        error: 'قاعدة البيانات غير مهيأة في متغيرات البيئة (DATABASE_URL أو POSTGRES_HOST أو SQL_HOST).',
      });
    }
    if (errCode === '42P01' || /relation\s+.*\s+does not exist/i.test(errMsg)) {
      return res.status(503).json({
        error: 'الجداول غير مُنشأة في قاعدة البيانات، شغّل الأمر npm run db:push ثم أعد المحاولة.',
      });
    }
    if (
      errCode === 'ECONNREFUSED' ||
      errCode === 'ENOTFOUND' ||
      errCode === 'ETIMEDOUT' ||
      errCode === 'ECONNRESET' ||
      errCode === '28P01'
    ) {
      return res.status(503).json({
        error: 'تعذر الاتصال بقاعدة البيانات حالياً. يرجى التحقق من إعدادات الاتصال.',
      });
    }
    return res.status(401).json({ error: 'انتهت الجلسة أو رمز المصادقة غير صالح.' });
  }
};

export const requireRole = (...allowedRoles: ('OWNER' | 'AGENT')[]) => {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.authUser) {
      return res.status(401).json({ error: 'يجب تسجيل الدخول أولاً.' });
    }
    if (!allowedRoles.includes(req.authUser.role)) {
      return res.status(403).json({
        error: 'غير مصرح لك بالوصول إلى هذه العملية الإدارية أو المالية.',
      });
    }
    return next();
  };
};

export const requirePermission = (permissionCode: string) => {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.authUser) {
      return res.status(401).json({ error: 'يجب تسجيل الدخول أولاً.' });
    }
    if (req.authUser.role === 'OWNER') {
      return next();
    }
    if (!req.authUser.permissions.includes(permissionCode)) {
      return res.status(403).json({
        error: 'ليست لديك صلاحية لتنفيذ هذه العملية التشغيلية. يرجى مراجعة مالك المخبز.',
      });
    }
    return next();
  };
};
