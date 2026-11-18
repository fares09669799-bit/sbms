import { Router } from 'express';
import { and, desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../../../db/index.ts';
import {
  cashTransactions,
  employeeAttendance,
  employees,
  expenses,
  payroll,
} from '../../../db/schema.ts';
import { type AuthRequest } from '../../../middleware/auth.ts';
import { generateReference, recordAuditLog } from '../../audit.ts';
import { add2, sub2 } from '../../accounting/formulas.ts';
import { PAYMENT_METHODS, VALID_SHIFTS } from '../../services/financialSnapshotService.ts';

const router = Router();

router.post('/employees', async (req: AuthRequest, res) => {
  try {
    const schema = z.object({
      name: z.string().trim().min(2, 'اسم الموظف مطلوب'),
      jobTitle: z.string().trim().min(2, 'المسمى الوظيفي مطلوب'),
      phone: z.string().trim().min(6, 'رقم الهاتف مطلوب'),
      monthlySalary: z.coerce.number().positive('الراتب الشهري يجب أن يكون أكبر من صفر'),
      shift: z.enum(VALID_SHIFTS),
      notes: z.string().optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message || 'بيانات الموظف غير مكتملة.' });
    }
    const d = parsed.data;

    const created = await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(employees)
        .values({
          name: d.name,
          jobTitle: d.jobTitle,
          phone: d.phone,
          monthlySalary: d.monthlySalary.toFixed(2),
          shift: d.shift,
          status: 'نشط',
          notes: d.notes ?? null,
        })
        .returning();

      await recordAuditLog(tx, {
        userId: req.authUser!.id,
        userName: req.authUser!.fullName,
        role: 'OWNER',
        operationType: 'إضافة موظف جديد',
        entityType: 'employees',
        entityId: String(row.id),
        affectedRecord: row.name,
        newValue: `${row.jobTitle} · راتب ${d.monthlySalary} ج.س · ${row.shift}`,
      });
      return row;
    });

    return res.status(201).json({ id: String(created.id) });
  } catch (error) {
    console.error('Create employee error:', error);
    return res.status(500).json({ error: 'تعذر إضافة الموظف.' });
  }
});

router.patch('/employees/:id', async (req: AuthRequest, res) => {
  try {
    const employeeId = Number(req.params.id);
    if (!Number.isInteger(employeeId)) {
      return res.status(400).json({ error: 'معرف الموظف غير صالح.' });
    }
    const schema = z.object({
      name: z.string().trim().min(2).optional(),
      jobTitle: z.string().trim().min(2).optional(),
      phone: z.string().trim().min(6).optional(),
      monthlySalary: z.coerce.number().positive().optional(),
      shift: z.enum(VALID_SHIFTS).optional(),
      status: z.enum(['نشط', 'موقوف']).optional(),
      notes: z.string().optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'بيانات تحديث الموظف غير صالحة.' });
    }
    const d = parsed.data;

    const updated = await db.transaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(employees)
        .where(eq(employees.id, employeeId))
        .limit(1);
      if (!existing) return null;

      const [next] = await tx
        .update(employees)
        .set({
          ...(d.name ? { name: d.name } : {}),
          ...(d.jobTitle ? { jobTitle: d.jobTitle } : {}),
          ...(d.phone ? { phone: d.phone } : {}),
          ...(d.monthlySalary !== undefined ? { monthlySalary: d.monthlySalary.toFixed(2) } : {}),
          ...(d.shift ? { shift: d.shift } : {}),
          ...(d.status ? { status: d.status } : {}),
          ...(d.notes !== undefined ? { notes: d.notes } : {}),
        })
        .where(eq(employees.id, employeeId))
        .returning();

      await recordAuditLog(tx, {
        userId: req.authUser!.id,
        userName: req.authUser!.fullName,
        role: 'OWNER',
        operationType: 'تحديث بيانات موظف',
        entityType: 'employees',
        entityId: String(employeeId),
        affectedRecord: next.name,
        previousValue: `${existing.jobTitle} · راتب ${existing.monthlySalary}`,
        newValue: `${next.jobTitle} · راتب ${next.monthlySalary} · ${next.status}`,
      });
      return next;
    });

    if (!updated) return res.status(404).json({ error: 'الموظف غير موجود.' });
    return res.json({ ok: true });
  } catch (error) {
    console.error('Update employee error:', error);
    return res.status(500).json({ error: 'تعذر تحديث بيانات الموظف.' });
  }
});

router.get('/employees/:id', async (req, res) => {
  try {
    const employeeId = Number(req.params.id);
    if (!Number.isInteger(employeeId)) {
      return res.status(400).json({ error: 'معرف الموظف غير صالح.' });
    }

    const [emp] = await db
      .select()
      .from(employees)
      .where(eq(employees.id, employeeId))
      .limit(1);
    if (!emp) return res.status(404).json({ error: 'الموظف غير موجود.' });

    const [attRows, payRows] = await Promise.all([
      db
        .select()
        .from(employeeAttendance)
        .where(eq(employeeAttendance.employeeId, employeeId))
        .orderBy(desc(employeeAttendance.date)),
      db
        .select()
        .from(payroll)
        .where(eq(payroll.employeeId, employeeId))
        .orderBy(desc(payroll.id)),
    ]);

    return res.json({
      employee: {
        id: String(emp.id),
        name: emp.name,
        jobTitle: emp.jobTitle,
        phone: emp.phone,
        monthlySalary: Number(emp.monthlySalary),
        shift: emp.shift,
        attendanceDays: emp.attendanceDays,
        paidThisMonth: Number(emp.paidThisMonth),
        remainingSalary: Math.max(0, sub2(emp.monthlySalary, emp.paidThisMonth)),
        status: emp.status,
        notes: emp.notes ?? undefined,
      },
      attendance: attRows.map((a) => ({
        id: String(a.id),
        date: a.date,
        status: a.status as 'حاضر' | 'غائب' | 'إجازة',
        notes: a.notes ?? undefined,
        recordedBy: a.recordedBy ?? undefined,
      })),
      payroll: payRows.map((p) => ({
        id: String(p.id),
        reference: p.reference,
        month: p.month,
        amountPaid: Number(p.amountPaid),
        paidDate: p.paidDate,
        paymentMethod: p.paymentMethod,
        notes: p.notes ?? undefined,
        recordedBy: p.recordedBy,
        isReversal: p.isReversal,
      })),
    });
  } catch (error) {
    console.error('Get employee profile error:', error);
    return res.status(500).json({ error: 'تعذر تحميل سجل الموظف.' });
  }
});

router.post('/employees/:id/attendance', async (req: AuthRequest, res) => {
  try {
    const employeeId = Number(req.params.id);
    const schema = z.object({
      date: z.string().trim().min(8),
      status: z.enum(['حاضر', 'غائب', 'إجازة']),
      notes: z.string().optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!Number.isInteger(employeeId) || !parsed.success) {
      return res.status(400).json({ error: 'بيانات الحضور غير صالحة.' });
    }
    const d = parsed.data;

    const nextDays = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(${800000 + employeeId})`);
      const [emp] = await tx
        .select()
        .from(employees)
        .where(eq(employees.id, employeeId))
        .limit(1);
      if (!emp) throw new Error('NOT_FOUND');

      const [existing] = await tx
        .select()
        .from(employeeAttendance)
        .where(
          and(
            eq(employeeAttendance.employeeId, employeeId),
            eq(employeeAttendance.date, d.date)
          )
        )
        .limit(1);

      let deltaDays = 0;
      if (existing) {
        if (existing.status !== 'حاضر' && d.status === 'حاضر') deltaDays = 1;
        else if (existing.status === 'حاضر' && d.status !== 'حاضر') deltaDays = -1;

        await tx
          .update(employeeAttendance)
          .set({
            status: d.status,
            notes: d.notes ?? null,
            recordedBy: req.authUser!.fullName,
          })
          .where(eq(employeeAttendance.id, existing.id));
      } else {
        if (d.status === 'حاضر') deltaDays = 1;
        await tx.insert(employeeAttendance).values({
          employeeId,
          date: d.date,
          status: d.status,
          notes: d.notes ?? null,
          recordedBy: req.authUser!.fullName,
        });
      }

      const updatedDays = Math.max(0, emp.attendanceDays + deltaDays);
      await tx
        .update(employees)
        .set({ attendanceDays: updatedDays })
        .where(eq(employees.id, employeeId));

      await recordAuditLog(tx, {
        userId: req.authUser!.id,
        userName: req.authUser!.fullName,
        role: 'OWNER',
        operationType: 'تسجيل حضور موظف',
        entityType: 'employee_attendance',
        entityId: String(employeeId),
        affectedRecord: `${emp.name} (${d.date})`,
        newValue: `الحالة: ${d.status} · إجمالي الحضور: ${updatedDays} يوم`,
      });

      return updatedDays;
    });

    return res.json({ ok: true, attendanceDays: nextDays });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : '';
    if (msg === 'NOT_FOUND') return res.status(404).json({ error: 'الموظف غير موجود.' });
    console.error('Employee attendance error:', error);
    return res.status(500).json({ error: 'تعذر تسجيل حضور الموظف.' });
  }
});

router.post('/employees/:id/payroll', async (req: AuthRequest, res) => {
  try {
    const employeeId = Number(req.params.id);
    const schema = z.object({
      month: z.string().trim().min(6), // e.g. '2026-11'
      amountPaid: z.coerce.number().positive('مبلغ الراتب يجب أن يكون أكبر من صفر'),
      paidDate: z.string().trim().min(8).optional(),
      paymentMethod: z.enum(PAYMENT_METHODS).default('نقداً'),
      notes: z.string().optional(),
      clientTxId: z.string().trim().optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!Number.isInteger(employeeId) || !parsed.success) {
      return res.status(400).json({
        error: parsed.success ? 'معرف الموظف غير صالح.' : parsed.error.issues[0]?.message || 'بيانات صرف الراتب غير صالحة.',
      });
    }
    const d = parsed.data;
    const paidDate = d.paidDate || new Date().toISOString().slice(0, 10);

    const created = await db.transaction(async (tx) => {
      if (d.clientTxId) {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${d.clientTxId}))`);
        const [dup] = await tx
          .select()
          .from(payroll)
          .where(eq(payroll.clientTxId, d.clientTxId))
          .limit(1);
        if (dup) throw new Error('DUPLICATE_TX');
      }

      await tx.execute(sql`SELECT pg_advisory_xact_lock(${800000 + employeeId})`);

      const [emp] = await tx
        .select()
        .from(employees)
        .where(eq(employees.id, employeeId))
        .limit(1);
      if (!emp) throw new Error('NOT_FOUND');

      const payRef = generateReference('PAYR');
      const [payRow] = await tx
        .insert(payroll)
        .values({
          reference: payRef,
          clientTxId: d.clientTxId ?? null,
          employeeId: emp.id,
          month: d.month,
          amountPaid: d.amountPaid.toFixed(2),
          paidDate,
          paymentMethod: d.paymentMethod,
          notes: d.notes ?? null,
          recordedByUserId: req.authUser!.id,
          recordedBy: req.authUser!.fullName,
        })
        .returning();

      const nextPaidMonth = add2(emp.paidThisMonth, d.amountPaid);
      await tx
        .update(employees)
        .set({ paidThisMonth: nextPaidMonth.toFixed(2) })
        .where(eq(employees.id, emp.id));

      // Record operating salary expense & single cash outflow so P&L and Cash Flow stay aligned
      await tx.insert(expenses).values({
        reference: `EXP-${payRef}`,
        date: paidDate,
        category: 'رواتب وأجور',
        amount: d.amountPaid.toFixed(2),
        description: `صرف راتب (${d.month}): ${emp.name}${d.notes ? ` — ${d.notes}` : ''}`,
        paymentMethod: d.paymentMethod,
        responsibleUserId: req.authUser!.id,
        responsibleUser: req.authUser!.fullName,
      });

      await tx.insert(cashTransactions).values({
        reference: generateReference('CSH'),
        type: 'صرف رواتب',
        category: 'رواتب',
        direction: 'OUT',
        amount: d.amountPaid.toFixed(2),
        date: paidDate,
        paymentMethod: d.paymentMethod,
        relatedEntity: `${emp.name} (${d.month} · ${payRef})`,
        notes: d.notes ?? null,
        recordedByUserId: req.authUser!.id,
        recordedBy: req.authUser!.fullName,
      });

      await recordAuditLog(tx, {
        userId: req.authUser!.id,
        userName: req.authUser!.fullName,
        role: 'OWNER',
        operationType: 'صرف راتب / دفعة موظف',
        entityType: 'payroll',
        entityId: String(payRow.id),
        affectedRecord: emp.name,
        newValue: `صرف ${d.amountPaid.toFixed(2)} ج.س لشهر ${d.month} (${d.paymentMethod})`,
        reference: payRef,
      });

      return payRow;
    });

    return res.status(201).json({ ok: true, reference: created.reference });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : '';
    if (msg === 'NOT_FOUND') return res.status(404).json({ error: 'الموظف غير موجود.' });
    if (msg === 'DUPLICATE_TX') return res.status(409).json({ error: 'تم صرف هذه الدفعة مسبقاً.' });
    console.error('Payroll error:', error);
    return res.status(500).json({ error: 'تعذر تسجيل صرف الراتب.' });
  }
});

router.post('/employees/payroll/:payrollId/reverse', async (req: AuthRequest, res) => {
  try {
    const payrollId = Number(req.params.payrollId);
    const reason = String(req.body?.reason || 'عكس قيد صرف راتب').trim();
    if (!Number.isInteger(payrollId) || reason.length < 3) {
      return res.status(400).json({ error: 'يرجى تحديد قيد الراتب وسبب العكس.' });
    }

    const revRef = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(${850000 + payrollId})`);
      const [orig] = await tx
        .select()
        .from(payroll)
        .where(eq(payroll.id, payrollId))
        .limit(1);
      if (!orig) throw new Error('NOT_FOUND');
      if (orig.isReversal) throw new Error('ALREADY_REVERSED');

      const expectedRevRef = `REV-${orig.reference}`;
      const [dup] = await tx
        .select()
        .from(payroll)
        .where(eq(payroll.reference, expectedRevRef))
        .limit(1);
      if (dup) throw new Error('ALREADY_REVERSED');

      const [emp] = await tx
        .select()
        .from(employees)
        .where(eq(employees.id, orig.employeeId))
        .limit(1);
      if (!emp) throw new Error('NOT_FOUND');

      const origAmt = Number(orig.amountPaid);
      const today = new Date().toISOString().slice(0, 10);

      await tx.insert(payroll).values({
        reference: expectedRevRef,
        employeeId: emp.id,
        month: orig.month,
        amountPaid: (-origAmt).toFixed(2),
        paidDate: today,
        paymentMethod: orig.paymentMethod,
        notes: `قيد عكسي: ${reason}`,
        recordedByUserId: req.authUser!.id,
        recordedBy: req.authUser!.fullName,
        isReversal: true,
        reversedPayrollId: orig.id,
      });

      await tx
        .update(employees)
        .set({
          paidThisMonth: Math.max(0, sub2(emp.paidThisMonth, origAmt)).toFixed(2),
        })
        .where(eq(employees.id, emp.id));

      // Reverse linked salary expense if it exists
      const linkedExpRef = `EXP-${orig.reference}`;
      const [linkedExp] = await tx
        .select()
        .from(expenses)
        .where(eq(expenses.reference, linkedExpRef))
        .limit(1);
      if (linkedExp && !linkedExp.isReversal) {
        await tx
          .update(expenses)
          .set({ status: 'معكوس' })
          .where(eq(expenses.id, linkedExp.id));
        await tx.insert(expenses).values({
          reference: `REV-${linkedExpRef}`,
          date: today,
          category: 'رواتب وأجور',
          amount: (-origAmt).toFixed(2),
          description: `عكس صرف راتب ${emp.name} (${orig.reference}): ${reason}`,
          paymentMethod: orig.paymentMethod,
          responsibleUserId: req.authUser!.id,
          responsibleUser: req.authUser!.fullName,
          status: 'معكوس',
          isReversal: true,
          reversedExpenseId: linkedExp.id,
        });
      }

      await tx.insert(cashTransactions).values({
        reference: generateReference('CSH'),
        type: 'قيد عكسي صرف راتب',
        category: 'قيد عكسي',
        direction: 'IN',
        amount: origAmt.toFixed(2),
        date: today,
        paymentMethod: orig.paymentMethod,
        relatedEntity: `${emp.name} (${orig.reference})`,
        notes: reason,
        recordedByUserId: req.authUser!.id,
        recordedBy: req.authUser!.fullName,
        isReversal: true,
      });

      await recordAuditLog(tx, {
        userId: req.authUser!.id,
        userName: req.authUser!.fullName,
        role: 'OWNER',
        operationType: 'عكس قيد صرف راتب',
        entityType: 'payroll',
        entityId: String(orig.id),
        affectedRecord: `${emp.name} (${orig.reference})`,
        previousValue: `صرف ${origAmt} ج.س`,
        newValue: `عكس بمبلغ -${origAmt} ج.س · السبب: ${reason}`,
        reference: expectedRevRef,
      });

      return expectedRevRef;
    });

    return res.json({ ok: true, reference: revRef });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : '';
    if (msg === 'NOT_FOUND') return res.status(404).json({ error: 'قيد الراتب غير موجود.' });
    if (msg === 'ALREADY_REVERSED') return res.status(409).json({ error: 'تم عكس هذا الراتب مسبقاً.' });
    console.error('Reverse payroll error:', error);
    return res.status(500).json({ error: 'تعذر عكس قيد الراتب.' });
  }
});

export default router;
