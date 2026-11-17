import { Router } from 'express';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db, isDatabaseConfigured } from '../../db/index.ts';
import { ensureSeeded } from '../../db/seed.ts';
import { users, userSessions } from '../../db/schema.ts';
import { adminAuth } from '../../lib/firebase-admin.ts';
import { type AuthRequest, DEFAULT_AGENT_PERMISSIONS, getOrCreateFirebaseUser, requireAuth } from '../../middleware/auth.ts';
import {
  createRateLimiter,
  hashPassword,
  hashToken,
  REFRESH_TOKEN_TTL_MS,
  signAccessToken,
  signRefreshToken,
  verifyPassword,
  verifyRefreshToken,
} from '../security.ts';
import { recordAuditLog } from '../audit.ts';

const router = Router();

const authLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: 30,
  message: 'تم تجاوز الحد المسموح لمحاولات تسجيل الدخول. يرجى المحاولة بعد دقيقة.',
});

const loginSchema = z.object({
  username: z.string().trim().min(2, 'اسم المستخدم مطلوب'),
  password: z.string().min(4, 'كلمة المرور مطلوبة'),
});

router.post('/login', authLimiter, async (req, res) => {
  try {
    await ensureSeeded();
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message || 'بيانات غير صالحة' });
    }

    const normalizedUsername = parsed.data.username.toLowerCase();
    const [dbUser] = await db
      .select()
      .from(users)
      .where(eq(users.username, normalizedUsername))
      .limit(1);

    if (!dbUser || !verifyPassword(parsed.data.password, dbUser.passwordHash)) {
      return res.status(401).json({
        error: 'اسم المستخدم أو كلمة المرور غير صحيحة.',
      });
    }

    if (!dbUser.isActive) {
      return res.status(403).json({
        error: 'هذا الحساب موقوف حالياً. يرجى مراجعة مالك المخبز.',
      });
    }

    const role = dbUser.roleCode === 'OWNER' ? 'OWNER' : 'AGENT';
    const jwtPayload = {
      sub: dbUser.id,
      uid: dbUser.uid,
      username: dbUser.username,
      role,
    } as const;

    const accessToken = signAccessToken(jwtPayload);
    const refreshToken = signRefreshToken(jwtPayload);

    await db.insert(userSessions).values({
      userId: dbUser.id,
      tokenHash: hashToken(refreshToken),
      expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
      revoked: false,
    });

    await recordAuditLog(db, {
      userId: dbUser.id,
      userName: dbUser.fullName,
      role,
      operationType: 'تسجيل دخول للنظام',
      entityType: 'users',
      entityId: String(dbUser.id),
      affectedRecord: dbUser.username,
      newValue: `دخول مصادق بصلاحية ${role}`,
    });

    return res.json({
      accessToken,
      refreshToken,
      user: {
        id: String(dbUser.id),
        username: dbUser.username,
        fullName: dbUser.fullName,
        role,
        phone: dbUser.phone,
        branchName: dbUser.branchName,
        assignedShift: dbUser.assignedShift ?? undefined,
        avatarUrl: dbUser.avatarUrl ?? undefined,
        permissions:
          role === 'OWNER'
            ? ['ALL', ...DEFAULT_AGENT_PERMISSIONS]
            : Array.isArray(dbUser.permissions)
            ? dbUser.permissions
            : [...DEFAULT_AGENT_PERMISSIONS],
      },
    });
  } catch (error) {
    console.error('Login error:', error);
    if (!isDatabaseConfigured()) {
      return res.status(503).json({
        error: 'قاعدة البيانات غير مهيأة في متغيرات البيئة (DATABASE_URL أو SQL_HOST).',
      });
    }
    const errObj = error as { code?: string; cause?: { code?: string }; message?: string } | null;
    const pgCode = errObj?.code || errObj?.cause?.code;
    if (
      pgCode === '42P01' ||
      (typeof errObj?.message === 'string' && /relation\s+.*\s+does not exist/i.test(errObj.message))
    ) {
      return res.status(503).json({
        error: 'الجداول غير مُنشأة في قاعدة البيانات، شغّل الأمر npm run db:push ثم أعد المحاولة.',
      });
    }
    return res.status(500).json({ error: 'تعذر إتمام تسجيل الدخول حالياً.' });
  }
});

router.post('/firebase-sync', authLimiter, async (req, res) => {
  try {
    await ensureSeeded();
    const idToken = String(req.body?.idToken || '').trim();
    if (!idToken) {
      return res.status(400).json({ error: 'رمز Firebase مفقود.' });
    }

    const decoded = await adminAuth.verifyIdToken(idToken);
    const email = decoded.email || `${decoded.uid}@sbms.local`;
    const dbUser = await getOrCreateFirebaseUser(decoded.uid, email, decoded.name);

    if (!dbUser.isActive) {
      return res.status(403).json({ error: 'تم إيقاف هذا الحساب.' });
    }

    const role = dbUser.roleCode === 'OWNER' ? 'OWNER' : 'AGENT';
    const jwtPayload = {
      sub: dbUser.id,
      uid: dbUser.uid,
      username: dbUser.username,
      role,
    } as const;

    const accessToken = signAccessToken(jwtPayload);
    const refreshToken = signRefreshToken(jwtPayload);

    await db.insert(userSessions).values({
      userId: dbUser.id,
      tokenHash: hashToken(refreshToken),
      expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
      revoked: false,
    });

    return res.json({
      accessToken,
      refreshToken,
      user: {
        id: String(dbUser.id),
        username: dbUser.username,
        fullName: dbUser.fullName,
        role,
        phone: dbUser.phone,
        branchName: dbUser.branchName,
        assignedShift: dbUser.assignedShift ?? undefined,
        avatarUrl: dbUser.avatarUrl ?? undefined,
        permissions:
          role === 'OWNER'
            ? ['ALL', ...DEFAULT_AGENT_PERMISSIONS]
            : Array.isArray(dbUser.permissions)
            ? dbUser.permissions
            : [...DEFAULT_AGENT_PERMISSIONS],
      },
    });
  } catch (error) {
    console.error('Firebase sync error:', error);
    return res.status(401).json({ error: 'فشل التحقق من حساب Google.' });
  }
});

router.post('/refresh', authLimiter, async (req, res) => {
  try {
    const refreshToken = String(req.body?.refreshToken || '').trim();
    if (!refreshToken) {
      return res.status(400).json({ error: 'Refresh token مفقود.' });
    }

    const decoded = verifyRefreshToken(refreshToken);
    const tokenHash = hashToken(refreshToken);

    const outcome = await db.transaction(async (tx) => {
      const [session] = await tx
        .select()
        .from(userSessions)
        .where(eq(userSessions.tokenHash, tokenHash))
        .limit(1);

      if (!session) {
        return { ok: false as const, status: 401, error: 'انتهت صلاحية الجلسة، يرجى إعادة تسجيل الدخول.' };
      }

      // Refresh token reuse detection: revoke all active sessions for this user
      if (session.revoked) {
        await tx
          .update(userSessions)
          .set({ revoked: true })
          .where(eq(userSessions.userId, session.userId));
        return { ok: false as const, status: 401, error: 'تم اكتشاف إعادة استخدام رمز التحديث، تم إغلاق الجلسات لحماية الحساب.' };
      }

      if (session.expiresAt < new Date()) {
        await tx.update(userSessions).set({ revoked: true }).where(eq(userSessions.id, session.id));
        return { ok: false as const, status: 401, error: 'انتهت صلاحية الجلسة، يرجى إعادة تسجيل الدخول.' };
      }

      // Atomically consume the current refresh token (single-use rotation)
      const [consumed] = await tx
        .update(userSessions)
        .set({ revoked: true })
        .where(and(eq(userSessions.id, session.id), eq(userSessions.revoked, false)))
        .returning({ id: userSessions.id });

      if (!consumed) {
        await tx
          .update(userSessions)
          .set({ revoked: true })
          .where(eq(userSessions.userId, session.userId));
        return { ok: false as const, status: 401, error: 'انتهت صلاحية رمز التحديث.' };
      }

      const [dbUser] = await tx.select().from(users).where(eq(users.id, decoded.sub)).limit(1);
      if (!dbUser || !dbUser.isActive) {
        return { ok: false as const, status: 403, error: 'الحساب غير مفعل.' };
      }

      const role = dbUser.roleCode === 'OWNER' ? 'OWNER' : 'AGENT';
      const jwtPayload = {
        sub: dbUser.id,
        uid: dbUser.uid,
        username: dbUser.username,
        role,
      } as const;

      const accessToken = signAccessToken(jwtPayload);
      const nextRefreshToken = signRefreshToken(jwtPayload);

      await tx.insert(userSessions).values({
        userId: dbUser.id,
        tokenHash: hashToken(nextRefreshToken),
        expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
        revoked: false,
      });

      return { ok: true as const, accessToken, refreshToken: nextRefreshToken };
    });

    if (!outcome.ok) {
      return res.status(outcome.status).json({ error: outcome.error });
    }

    return res.json({
      accessToken: outcome.accessToken,
      refreshToken: outcome.refreshToken,
    });
  } catch {
    return res.status(401).json({ error: 'رمز التحديث غير صالح.' });
  }
});

router.post('/logout', async (req, res) => {
  try {
    const refreshToken = String(req.body?.refreshToken || '').trim();
    if (refreshToken) {
      await db
        .update(userSessions)
        .set({ revoked: true })
        .where(eq(userSessions.tokenHash, hashToken(refreshToken)));
    }
    return res.json({ ok: true });
  } catch {
    return res.json({ ok: true });
  }
});

router.get('/me', requireAuth, async (req: AuthRequest, res) => {
  return res.json({
    user: {
      id: String(req.authUser!.id),
      username: req.authUser!.username,
      fullName: req.authUser!.fullName,
      role: req.authUser!.role,
      phone: req.authUser!.phone,
      branchName: req.authUser!.branchName,
      assignedShift: req.authUser!.assignedShift ?? undefined,
      avatarUrl: req.authUser!.avatarUrl ?? undefined,
      permissions: req.authUser!.permissions,
    },
  });
});

const changePassSchema = z.object({
  currentPassword: z.string().min(4),
  newPassword: z.string().min(6, 'كلمة المرور الجديدة يجب أن تكون 6 أحرف على الأقل'),
});

router.post('/change-password', requireAuth, async (req: AuthRequest, res) => {
  try {
    const parsed = changePassSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message || 'بيانات غير صالحة' });
    }

    const [dbUser] = await db
      .select()
      .from(users)
      .where(eq(users.id, req.authUser!.id))
      .limit(1);

    if (!dbUser || !verifyPassword(parsed.data.currentPassword, dbUser.passwordHash)) {
      return res.status(400).json({ error: 'كلمة المرور الحالية غير صحيحة.' });
    }

    await db.transaction(async (tx) => {
      await tx
        .update(users)
        .set({ passwordHash: hashPassword(parsed.data.newPassword), updatedAt: new Date() })
        .where(eq(users.id, dbUser.id));

      await tx.update(userSessions).set({ revoked: true }).where(eq(userSessions.userId, dbUser.id));

      await recordAuditLog(tx, {
        userId: dbUser.id,
        userName: dbUser.fullName,
        role: req.authUser!.role,
        operationType: 'تغيير كلمة المرور',
        entityType: 'users',
        entityId: String(dbUser.id),
        affectedRecord: dbUser.username,
        newValue: 'تم تحديث كلمة المرور وإلغاء الجلسات السابقة',
      });
    });

    return res.json({ ok: true });
  } catch (error) {
    console.error('Change password error:', error);
    return res.status(500).json({ error: 'تعذر تغيير كلمة المرور.' });
  }
});

export default router;
