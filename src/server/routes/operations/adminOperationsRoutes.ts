import { Router } from 'express';
import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../../../db/index.ts';
import {
  bakerySettings,
  cashTransactions,
  customerPayments,
  customers,
  notifications,
  roles,
  users,
  userSessions,
} from '../../../db/schema.ts';
import {
  type AuthRequest,
  DEFAULT_AGENT_PERMISSIONS,
  requireRole,
} from '../../../middleware/auth.ts';
import { generateReference, recordAuditLog } from '../../audit.ts';
import { hashPassword, isValidSafeDataUri } from '../../security.ts';
import {
  ALLOWED_AVATAR_MIMES,
  VALID_PERMISSIONS,
  VALID_SHIFTS,
} from '../../services/operationsService.ts';

const router = Router();

router.post('/customers/:id/payments', requireRole('OWNER'), async (req: AuthRequest, res) => {
  try {
    const customerId = Number(req.params.id);
    const schema = z.object({
      amount: z.coerce.number().positive('مبلغ التحصيل يجب أن يكون أكبر من صفر'),
      date: z.string().trim().min(8).optional(),
      method: z.enum(['نقداً', 'تحويل بنكي (بنكك)', 'شيك']).default('نقداً'),
      notes: z.string().optional(),
      clientTxId: z.string().trim().optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!Number.isInteger(customerId) || !parsed.success) {
      return res.status(400).json({ error: 'بيانات التحصيل غير صالحة.' });
    }
    const d = parsed.data;
    const opDate = d.date || new Date().toISOString().slice(0, 10);

    const outcome = await db.transaction(async (tx) => {
      if (d.clientTxId) {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${d.clientTxId}))`);
        const [dup] = await tx
          .select()
          .from(customerPayments)
          .where(eq(customerPayments.clientTxId, d.clientTxId))
          .limit(1);
        if (dup) throw new Error('DUPLICATE_TX');
      }

      await tx.execute(sql`SELECT pg_advisory_xact_lock(${700000 + customerId})`);
      const [cust] = await tx.select().from(customers).where(eq(customers.id, customerId)).limit(1);
      if (!cust) throw new Error('NOT_FOUND');

      const ref = generateReference('CPY');
      const [payRow] = await tx
        .insert(customerPayments)
        .values({
          reference: ref,
          clientTxId: d.clientTxId ?? null,
          customerId: cust.id,
          amount: d.amount.toFixed(2),
          date: opDate,
          method: d.method,
          notes: d.notes ?? null,
          recordedByUserId: req.authUser!.id,
          recordedBy: req.authUser!.fullName,
        })
        .returning();

      const nextPaid = Number((Number(cust.totalPayments) + d.amount).toFixed(2));
      const nextBal = Number(
        (Number(cust.totalCreditSales) - nextPaid + Number(cust.adjustments)).toFixed(2)
      );
      await tx
        .update(customers)
        .set({
          totalPayments: nextPaid.toFixed(2),
          outstandingBalance: nextBal.toFixed(2),
          lastActivityDate: opDate,
        })
        .where(eq(customers.id, cust.id));

      await tx.insert(cashTransactions).values({
        reference: generateReference('CSH'),
        type: 'تحصيل عميل',
        category: 'تحصيل عميل',
        direction: 'IN',
        amount: d.amount.toFixed(2),
        date: opDate,
        paymentMethod: d.method,
        relatedEntity: cust.name,
        notes: d.notes ?? null,
        recordedByUserId: req.authUser!.id,
        recordedBy: req.authUser!.fullName,
      });

      await recordAuditLog(tx, {
        userId: req.authUser!.id,
        userName: req.authUser!.fullName,
        role: 'OWNER',
        operationType: 'تحصيل مديونية عميل',
        entityType: 'customers',
        entityId: String(cust.id),
        affectedRecord: cust.name,
        newValue: `تحصيل ${d.amount.toFixed(2)} ج.س (${d.method}) · الرصيد المتبقي: ${nextBal.toFixed(2)} ج.س`,
        reference: ref,
      });

      return { paymentId: String(payRow.id), reference: ref, remainingBalance: nextBal };
    });

    return res.json({ ok: true, ...outcome });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : '';
    if (msg === 'DUPLICATE_TX') {
      return res.status(409).json({ error: 'تم تسجيل هذه الدفعة مسبقاً.' });
    }
    if (msg === 'NOT_FOUND') {
      return res.status(404).json({ error: 'العميل غير موجود.' });
    }
    console.error('Customer payment error:', error);
    return res.status(500).json({ error: 'تعذر تسجيل التحصيل.' });
  }
});

const agentCreateSchema = z.object({
  fullName: z.string().trim().min(2, 'الاسم الكامل مطلوب'),
  username: z.string().trim().min(3, 'اسم المستخدم مطلوب (3 أحرف على الأقل)'),
  phone: z.string().trim().min(6, 'رقم الهاتف مطلوب'),
  assignedShift: z.enum(VALID_SHIFTS),
  password: z.string().min(4, 'كلمة المرور يجب أن تكون 4 أحرف على الأقل').default('123456'),
  avatarUrl: z.string().max(400_000, 'حجم الصورة يتجاوز الحد المسموح').optional(),
  permissions: z
    .array(z.enum(VALID_PERMISSIONS))
    .default([...DEFAULT_AGENT_PERMISSIONS]),
});

router.post('/agents', requireRole('OWNER'), async (req: AuthRequest, res) => {
  try {
    const parsed = agentCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message || 'بيانات الوكيل غير مكتملة.' });
    }
    const d = parsed.data;
    if (d.avatarUrl && !isValidSafeDataUri(d.avatarUrl, ALLOWED_AVATAR_MIMES)) {
      return res.status(400).json({ error: 'صيغة الصورة غير مدعومة. يُسمح فقط بصور JPG أو PNG أو WEBP.' });
    }

    const created = await db.transaction(async (tx) => {
      const normalized = d.username.toLowerCase();
      const [dup] = await tx
        .select({ id: users.id })
        .from(users)
        .where(eq(users.username, normalized))
        .limit(1);
      if (dup) throw new Error('DUPLICATE_USERNAME');

      const [agentRole] = await tx.select().from(roles).where(eq(roles.code, 'AGENT')).limit(1);
      const [row] = await tx
        .insert(users)
        .values({
          uid: `sbms-agent-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
          username: normalized,
          passwordHash: hashPassword(d.password),
          fullName: d.fullName,
          phone: d.phone,
          roleId: agentRole?.id,
          roleCode: 'AGENT',
          assignedShift: d.assignedShift,
          avatarUrl: d.avatarUrl || null,
          permissions: d.permissions,
          isActive: true,
        })
        .returning();

      await recordAuditLog(tx, {
        userId: req.authUser!.id,
        userName: req.authUser!.fullName,
        role: 'OWNER',
        operationType: 'إضافة وكيل جديد',
        entityType: 'users',
        entityId: String(row.id),
        affectedRecord: row.fullName,
        newValue: `اسم المستخدم: ${row.username} · ${d.assignedShift} · الصلاحيات: ${d.permissions.join(', ')}`,
      });
      return row;
    });

    return res.status(201).json({ id: String(created.id), username: created.username });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : '';
    if (msg === 'DUPLICATE_USERNAME') {
      return res.status(409).json({ error: 'اسم المستخدم مسجل مسبقاً.' });
    }
    console.error('Create agent error:', error);
    return res.status(500).json({ error: 'تعذر إضافة الوكيل.' });
  }
});

const agentUpdateSchema = z.object({
  fullName: z.string().trim().min(2).optional(),
  phone: z.string().trim().min(6).optional(),
  assignedShift: z.enum(VALID_SHIFTS).optional(),
  password: z.string().min(4).optional().or(z.literal('')),
  avatarUrl: z.string().max(400_000).nullable().optional(),
  permissions: z.array(z.enum(VALID_PERMISSIONS)).optional(),
  isActive: z.boolean().optional(),
});

router.patch('/agents/:id', requireRole('OWNER'), async (req: AuthRequest, res) => {
  try {
    const agentId = Number(req.params.id);
    if (!Number.isInteger(agentId)) {
      return res.status(400).json({ error: 'معرف الوكيل غير صالح.' });
    }
    const parsed = agentUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message || 'بيانات التحديث غير صالحة.' });
    }
    const d = parsed.data;
    if (d.avatarUrl && !isValidSafeDataUri(d.avatarUrl, ALLOWED_AVATAR_MIMES)) {
      return res.status(400).json({ error: 'صيغة الصورة غير مدعومة. يُسمح فقط بصور JPG أو PNG أو WEBP.' });
    }

    const updated = await db.transaction(async (tx) => {
      const [ag] = await tx.select().from(users).where(eq(users.id, agentId)).limit(1);
      if (!ag || ag.roleCode !== 'AGENT') return null;

      const [next] = await tx
        .update(users)
        .set({
          ...(d.fullName ? { fullName: d.fullName } : {}),
          ...(d.phone ? { phone: d.phone } : {}),
          ...(d.assignedShift ? { assignedShift: d.assignedShift } : {}),
          ...(d.password ? { passwordHash: hashPassword(d.password) } : {}),
          ...(d.avatarUrl !== undefined ? { avatarUrl: d.avatarUrl } : {}),
          ...(d.permissions !== undefined ? { permissions: d.permissions } : {}),
          ...(d.isActive !== undefined ? { isActive: d.isActive } : {}),
          updatedAt: new Date(),
        })
        .where(eq(users.id, agentId))
        .returning();

      if (d.isActive === false || d.password) {
        await tx
          .update(userSessions)
          .set({ revoked: true })
          .where(eq(userSessions.userId, agentId));
      }

      await recordAuditLog(tx, {
        userId: req.authUser!.id,
        userName: req.authUser!.fullName,
        role: 'OWNER',
        operationType: 'تحديث بيانات وصلاحيات وكيل',
        entityType: 'users',
        entityId: String(agentId),
        affectedRecord: next.fullName,
        previousValue: `${ag.assignedShift} · ${ag.isActive ? 'نشط' : 'موقوف'}`,
        newValue: `${next.assignedShift} · ${next.isActive ? 'نشط' : 'موقوف'} · الصلاحيات: ${(next.permissions || []).join(', ')}`,
      });

      return next;
    });

    if (!updated) return res.status(404).json({ error: 'الوكيل غير موجود.' });
    return res.json({ ok: true });
  } catch (error) {
    console.error('Update agent error:', error);
    return res.status(500).json({ error: 'تعذر تحديث بيانات الوكيل.' });
  }
});

router.patch('/agents/:id/toggle', requireRole('OWNER'), async (req: AuthRequest, res) => {
  try {
    const agentId = Number(req.params.id);
    if (!Number.isInteger(agentId)) return res.status(400).json({ error: 'معرف الوكيل غير صالح.' });

    const result = await db.transaction(async (tx) => {
      const [ag] = await tx.select().from(users).where(eq(users.id, agentId)).limit(1);
      if (!ag || ag.roleCode !== 'AGENT') return null;

      const nextActive = !ag.isActive;
      await tx
        .update(users)
        .set({ isActive: nextActive, updatedAt: new Date() })
        .where(eq(users.id, agentId));

      if (!nextActive) {
        await tx
          .update(userSessions)
          .set({ revoked: true })
          .where(eq(userSessions.userId, agentId));
      }

      await recordAuditLog(tx, {
        userId: req.authUser!.id,
        userName: req.authUser!.fullName,
        role: 'OWNER',
        operationType: ag.isActive ? 'إيقاف حساب وكيل' : 'تفعيل حساب وكيل',
        entityType: 'users',
        entityId: String(agentId),
        affectedRecord: ag.fullName,
        newValue: nextActive ? 'نشط' : 'موقوف',
      });

      return nextActive;
    });

    if (result === null) return res.status(404).json({ error: 'الوكيل غير موجود.' });
    return res.json({ ok: true, isActive: result });
  } catch {
    return res.status(500).json({ error: 'تعذر تحديث حالة الوكيل.' });
  }
});

router.post('/notifications/read-all', requireRole('OWNER'), async (_req, res) => {
  try {
    await db.update(notifications).set({ isRead: true });
    return res.json({ ok: true });
  } catch {
    return res.status(500).json({ error: 'تعذر تحديث التنبيهات.' });
  }
});

router.patch('/settings', requireRole('OWNER'), async (req: AuthRequest, res) => {
  try {
    const schema = z.object({
      bakeryName: z.string().trim().min(2).optional(),
      city: z.string().trim().min(2).optional(),
      address: z.string().trim().min(2).optional(),
      currencySymbol: z.string().trim().min(1).optional(),
      allowNegativeInventory: z.boolean().optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'بيانات الإعدادات غير صالحة.' });

    const [current] = await db.select().from(bakerySettings).limit(1);
    if (!current) return res.status(404).json({ error: 'الإعدادات غير مهيأة.' });

    await db
      .update(bakerySettings)
      .set({ ...parsed.data, updatedAt: new Date() })
      .where(eq(bakerySettings.id, current.id));

    await recordAuditLog(db, {
      userId: req.authUser!.id,
      userName: req.authUser!.fullName,
      role: 'OWNER',
      operationType: 'تحديث إعدادات المخبز',
      entityType: 'bakery_settings',
      entityId: String(current.id),
      affectedRecord: parsed.data.bakeryName || current.bakeryName,
      newValue: 'تم تحديث إعدادات المخبز والسياسات',
    });

    return res.json({ ok: true });
  } catch {
    return res.status(500).json({ error: 'تعذر حفظ الإعدادات.' });
  }
});

export default router;
