import { Router } from 'express';
import { and, desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../../../db/index.ts';
import {
  cashTransactions,
  customerAdjustments,
  customerPayments,
  customers,
  sales,
} from '../../../db/schema.ts';
import { type AuthRequest } from '../../../middleware/auth.ts';
import { generateReference, recordAuditLog } from '../../audit.ts';
import {
  add2,
  calculateCustomerBalance,
  calculateRunningLedgerBalance,
  sub2,
  sumDecimal2,
} from '../../accounting/formulas.ts';

const router = Router();

router.post('/customers', async (req: AuthRequest, res) => {
  try {
    const schema = z.object({
      name: z.string().trim().min(2, 'اسم العميل مطلوب'),
      phone: z.string().trim().min(6, 'رقم الهاتف مطلوب'),
      address: z.string().trim().default('الخرطوم'),
      creditLimit: z.coerce.number().min(0).default(500000),
      notes: z.string().optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message || 'بيانات العميل غير مكتملة.' });
    }
    const d = parsed.data;
    const today = new Date().toISOString().slice(0, 10);

    const created = await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(customers)
        .values({
          name: d.name,
          phone: d.phone,
          address: d.address,
          creditLimit: d.creditLimit.toFixed(2),
          status: 'نشط',
          notes: d.notes ?? null,
          lastActivityDate: today,
        })
        .returning();

      await recordAuditLog(tx, {
        userId: req.authUser!.id,
        userName: req.authUser!.fullName,
        role: 'OWNER',
        operationType: 'إضافة عميل آجل جديد',
        entityType: 'customers',
        entityId: String(row.id),
        affectedRecord: row.name,
        newValue: `هاتف: ${row.phone} · سقف الائتمان: ${d.creditLimit} ج.س`,
      });
      return row;
    });

    return res.status(201).json({
      customer: {
        id: String(created.id),
        name: created.name,
        phone: created.phone,
        address: created.address,
        creditLimit: Number(created.creditLimit),
        totalCreditSales: Number(created.totalCreditSales),
        totalPayments: Number(created.totalPayments),
        adjustments: Number(created.adjustments),
        outstandingBalance: Number(created.outstandingBalance),
        status: created.status,
        notes: created.notes ?? undefined,
        lastActivityDate: created.lastActivityDate,
      },
    });
  } catch (error) {
    console.error('Create customer error:', error);
    return res.status(500).json({ error: 'تعذر إضافة العميل.' });
  }
});

router.patch('/customers/:id', async (req: AuthRequest, res) => {
  try {
    const customerId = Number(req.params.id);
    if (!Number.isInteger(customerId)) {
      return res.status(400).json({ error: 'معرف العميل غير صالح.' });
    }
    const schema = z.object({
      name: z.string().trim().min(2).optional(),
      phone: z.string().trim().min(6).optional(),
      address: z.string().trim().optional(),
      creditLimit: z.coerce.number().min(0).optional(),
      status: z.enum(['نشط', 'موقوف']).optional(),
      notes: z.string().optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'بيانات تحديث العميل غير صالحة.' });
    }
    const d = parsed.data;

    const updated = await db.transaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(customers)
        .where(eq(customers.id, customerId))
        .limit(1);
      if (!existing) return null;

      const [next] = await tx
        .update(customers)
        .set({
          ...(d.name ? { name: d.name } : {}),
          ...(d.phone ? { phone: d.phone } : {}),
          ...(d.address !== undefined ? { address: d.address } : {}),
          ...(d.creditLimit !== undefined ? { creditLimit: d.creditLimit.toFixed(2) } : {}),
          ...(d.status ? { status: d.status } : {}),
          ...(d.notes !== undefined ? { notes: d.notes } : {}),
        })
        .where(eq(customers.id, customerId))
        .returning();

      await recordAuditLog(tx, {
        userId: req.authUser!.id,
        userName: req.authUser!.fullName,
        role: 'OWNER',
        operationType: 'تعديل بيانات عميل',
        entityType: 'customers',
        entityId: String(customerId),
        affectedRecord: next.name,
        previousValue: `${existing.name} · حد ${existing.creditLimit}`,
        newValue: `${next.name} · حد ${next.creditLimit} · الحالة ${next.status}`,
      });
      return next;
    });

    if (!updated) return res.status(404).json({ error: 'العميل غير موجود.' });
    return res.json({ ok: true });
  } catch (error) {
    console.error('Update customer error:', error);
    return res.status(500).json({ error: 'تعذر تحديث بيانات العميل.' });
  }
});

router.get('/customers/:id', async (req, res) => {
  try {
    const customerId = Number(req.params.id);
    if (!Number.isInteger(customerId)) {
      return res.status(400).json({ error: 'معرف العميل غير صالح.' });
    }

    const [cust] = await db
      .select()
      .from(customers)
      .where(eq(customers.id, customerId))
      .limit(1);
    if (!cust) return res.status(404).json({ error: 'العميل غير موجود.' });

    const [creditSales, payRows, adjRows] = await Promise.all([
      db
        .select()
        .from(sales)
        .where(and(eq(sales.customerId, customerId), eq(sales.paymentType, 'آجل')))
        .orderBy(desc(sales.id)),
      db
        .select()
        .from(customerPayments)
        .where(eq(customerPayments.customerId, customerId))
        .orderBy(desc(customerPayments.id)),
      db
        .select()
        .from(customerAdjustments)
        .where(eq(customerAdjustments.customerId, customerId))
        .orderBy(desc(customerAdjustments.id)),
    ]);

    const totalCreditSales = Number(cust.totalCreditSales);
    const totalPayments = Number(cust.totalPayments);
    const adjustments = Number(cust.adjustments);
    const formulaBalance = calculateCustomerBalance(totalCreditSales, totalPayments, adjustments);

    // Note: seeded customers may have historical opening credit balance before individual sales rows were logged.
    const recordedCreditSalesSum = sumDecimal2(creditSales.map((s) => s.totalAmount));
    const recordedPaymentsSum = sumDecimal2(payRows.map((p) => p.amount));
    const openingSalesCarried = sub2(totalCreditSales, recordedCreditSalesSum);
    const openingPaymentsCarried = sub2(totalPayments, recordedPaymentsSum);
    const openingBalance = sub2(openingSalesCarried, openingPaymentsCarried);

    const ledgerEntries: {
      id: string;
      date: string;
      type: string;
      reference: string;
      description: string;
      debit: number;
      credit: number;
    }[] = [
      ...creditSales.map((s) => ({
        id: `sal-${s.id}`,
        date: s.date,
        type: 'سحب آجل (فاتورة بيع)',
        reference: s.reference,
        description: `${s.breadType} — ${s.quantity} رغيف × ${Number(s.unitPrice)} ج.س`,
        debit: Number(s.totalAmount),
        credit: 0,
      })),
      ...payRows.map((p) => ({
        id: `pay-${p.id}`,
        date: p.date,
        type: p.isReversal ? 'قيد عكسي لتحصيل' : 'دفعة سداد عميل',
        reference: p.reference,
        description: `${p.method}${p.notes ? ` · ${p.notes}` : ''}`,
        debit: Number(p.amount) < 0 ? Math.abs(Number(p.amount)) : 0,
        credit: Number(p.amount) > 0 ? Number(p.amount) : 0,
      })),
      ...adjRows.map((a) => ({
        id: `adj-${a.id}`,
        date: a.date,
        type: 'تسوية رصيد عميل',
        reference: a.reference,
        description: a.reason,
        debit: Number(a.amount) > 0 ? Number(a.amount) : 0,
        credit: Number(a.amount) < 0 ? Math.abs(Number(a.amount)) : 0,
      })),
    ].sort((a, b) => (a.date > b.date ? 1 : a.date < b.date ? -1 : a.id.localeCompare(b.id)));

    const statementWithOpening =
      Math.abs(openingBalance) > 0.01
        ? [
            {
              id: 'opening-balance',
              date: ledgerEntries[0]?.date || cust.lastActivityDate || '—',
              type: 'رصيد مرحّل سابق',
              reference: 'OPN-BAL',
              description: 'رصيد حساب سابق قبل الحركات التفصيلية المسجلة',
              debit: openingBalance > 0 ? openingBalance : 0,
              credit: openingBalance < 0 ? Math.abs(openingBalance) : 0,
            },
            ...ledgerEntries,
          ]
        : ledgerEntries;

    let runningBalance = 0;
    const statement = statementWithOpening.map((entry) => {
      runningBalance = calculateRunningLedgerBalance(runningBalance, entry.debit, entry.credit);
      return { ...entry, runningBalance };
    });

    return res.json({
      customer: {
        id: String(cust.id),
        name: cust.name,
        phone: cust.phone,
        address: cust.address,
        creditLimit: Number(cust.creditLimit),
        totalCreditSales,
        totalPayments,
        adjustments,
        outstandingBalance: formulaBalance,
        status: cust.status,
        notes: cust.notes ?? undefined,
        lastActivityDate: cust.lastActivityDate,
      },
      creditSales: creditSales.map((s) => ({
        id: String(s.id),
        reference: s.reference,
        date: s.date,
        breadType: s.breadType,
        quantity: s.quantity,
        unitPrice: Number(s.unitPrice),
        totalAmount: Number(s.totalAmount),
        agentName: s.agentName,
      })),
      payments: payRows.map((p) => ({
        id: String(p.id),
        reference: p.reference,
        date: p.date,
        amount: Number(p.amount),
        method: p.method,
        notes: p.notes ?? undefined,
        recordedBy: p.recordedBy,
        isReversal: p.isReversal,
      })),
      adjustmentsList: adjRows.map((a) => ({
        id: String(a.id),
        reference: a.reference,
        date: a.date,
        amount: Number(a.amount),
        reason: a.reason,
        recordedBy: a.recordedBy,
      })),
      statement,
    });
  } catch (error) {
    console.error('Get customer profile error:', error);
    return res.status(500).json({ error: 'تعذر تحميل كشف حساب العميل.' });
  }
});

router.post('/customers/payments/:paymentId/reverse', async (req: AuthRequest, res) => {
  try {
    const paymentId = Number(req.params.paymentId);
    const reason = String(req.body?.reason || 'عكس تحصيل عميل بقرار المالك').trim();
    if (!Number.isInteger(paymentId) || reason.length < 3) {
      return res.status(400).json({ error: 'يرجى تحديد الدفعة وسبب العكس.' });
    }

    const revRef = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(${750000 + paymentId})`);
      const [orig] = await tx
        .select()
        .from(customerPayments)
        .where(eq(customerPayments.id, paymentId))
        .limit(1);
      if (!orig) throw new Error('NOT_FOUND');
      if (orig.isReversal) throw new Error('ALREADY_REVERSED');

      const expectedRevRef = `REV-${orig.reference}`;
      const [dup] = await tx
        .select()
        .from(customerPayments)
        .where(eq(customerPayments.reference, expectedRevRef))
        .limit(1);
      if (dup) throw new Error('ALREADY_REVERSED');

      const [cust] = await tx
        .select()
        .from(customers)
        .where(eq(customers.id, orig.customerId))
        .limit(1);
      if (!cust) throw new Error('NOT_FOUND');

      const origAmt = Number(orig.amount);
      const today = new Date().toISOString().slice(0, 10);

      await tx.insert(customerPayments).values({
        reference: expectedRevRef,
        customerId: cust.id,
        amount: (-origAmt).toFixed(2),
        date: today,
        method: orig.method,
        notes: `قيد عكسي: ${reason}`,
        recordedByUserId: req.authUser!.id,
        recordedBy: req.authUser!.fullName,
        isReversal: true,
        reversedPaymentId: orig.id,
      });

      const nextPaid = sub2(cust.totalPayments, origAmt);
      const nextBal = calculateCustomerBalance(
        Number(cust.totalCreditSales),
        nextPaid,
        Number(cust.adjustments)
      );

      await tx
        .update(customers)
        .set({
          totalPayments: nextPaid.toFixed(2),
          outstandingBalance: nextBal.toFixed(2),
          lastActivityDate: today,
        })
        .where(eq(customers.id, cust.id));

      await tx.insert(cashTransactions).values({
        reference: generateReference('CSH'),
        type: 'قيد عكسي تحصيل عميل',
        category: 'قيد عكسي',
        direction: 'OUT',
        amount: origAmt.toFixed(2),
        date: today,
        paymentMethod: orig.method,
        relatedEntity: `${cust.name} (${orig.reference})`,
        notes: reason,
        recordedByUserId: req.authUser!.id,
        recordedBy: req.authUser!.fullName,
        isReversal: true,
      });

      await recordAuditLog(tx, {
        userId: req.authUser!.id,
        userName: req.authUser!.fullName,
        role: 'OWNER',
        operationType: 'عكس دفعة تحصيل عميل',
        entityType: 'customer_payments',
        entityId: String(orig.id),
        affectedRecord: `${cust.name} (${orig.reference})`,
        previousValue: `تحصيل ${origAmt} ج.س`,
        newValue: `قيد عكسي -${origAmt} ج.س · السبب: ${reason}`,
        reference: expectedRevRef,
      });

      return expectedRevRef;
    });

    return res.json({ ok: true, reference: revRef });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : '';
    if (msg === 'NOT_FOUND') return res.status(404).json({ error: 'دفعة التحصيل غير موجودة.' });
    if (msg === 'ALREADY_REVERSED') return res.status(409).json({ error: 'تم عكس هذه الدفعة مسبقاً.' });
    console.error('Reverse customer payment error:', error);
    return res.status(500).json({ error: 'تعذر عكس دفعة العميل.' });
  }
});

router.post('/customers/:id/adjustments', async (req: AuthRequest, res) => {
  try {
    const customerId = Number(req.params.id);
    const schema = z.object({
      amount: z.coerce.number().refine((v) => Math.abs(v) > 0.01, 'قيمة التسوية لا يمكن أن تكون صفراً'),
      date: z.string().trim().min(8).optional(),
      reason: z.string().trim().min(3, 'يرجى كتابة سبب التسوية'),
    });
    const parsed = schema.safeParse(req.body);
    if (!Number.isInteger(customerId) || !parsed.success) {
      return res.status(400).json({
        error: parsed.success ? 'معرف العميل غير صالح.' : parsed.error.issues[0]?.message || 'بيانات التسوية غير صالحة.',
      });
    }
    const d = parsed.data;
    const opDate = d.date || new Date().toISOString().slice(0, 10);

    const ref = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(${700000 + customerId})`);
      const [cust] = await tx
        .select()
        .from(customers)
        .where(eq(customers.id, customerId))
        .limit(1);
      if (!cust) throw new Error('NOT_FOUND');

      const adjRef = generateReference('CADJ');
      await tx.insert(customerAdjustments).values({
        reference: adjRef,
        customerId: cust.id,
        amount: d.amount.toFixed(2),
        date: opDate,
        reason: d.reason,
        recordedByUserId: req.authUser!.id,
        recordedBy: req.authUser!.fullName,
      });

      const nextAdj = add2(cust.adjustments, d.amount);
      const nextBal = calculateCustomerBalance(
        Number(cust.totalCreditSales),
        Number(cust.totalPayments),
        nextAdj
      );

      await tx
        .update(customers)
        .set({
          adjustments: nextAdj.toFixed(2),
          outstandingBalance: nextBal.toFixed(2),
          lastActivityDate: opDate,
        })
        .where(eq(customers.id, cust.id));

      await recordAuditLog(tx, {
        userId: req.authUser!.id,
        userName: req.authUser!.fullName,
        role: 'OWNER',
        operationType: 'تسوية رصيد عميل',
        entityType: 'customers',
        entityId: String(cust.id),
        affectedRecord: cust.name,
        previousValue: `الرصيد السابق: ${cust.outstandingBalance} ج.س`,
        newValue: `تسوية ${d.amount > 0 ? '+' : ''}${d.amount.toFixed(2)} ج.س · السبب: ${d.reason}`,
        reference: adjRef,
      });

      return adjRef;
    });

    return res.status(201).json({ ok: true, reference: ref });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : '';
    if (msg === 'NOT_FOUND') return res.status(404).json({ error: 'العميل غير موجود.' });
    console.error('Customer adjustment error:', error);
    return res.status(500).json({ error: 'تعذر تسجيل تسوية حساب العميل.' });
  }
});

export default router;
