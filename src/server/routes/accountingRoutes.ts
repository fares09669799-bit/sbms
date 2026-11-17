import { Router } from 'express';
import { and, desc, eq, gte, lte, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../../db/index.ts';
import {
  breadMovements,
  cashTransactions,
  customerAdjustments,
  customerPayments,
  customers,
  employeeAttendance,
  employees,
  expenses,
  inventoryItems,
  payroll,
  productionIngredients,
  productionRecords,
  purchaseInvoices,
  sales,
  shiftHandovers,
  shifts,
  suppliers,
} from '../../db/schema.ts';
import { type AuthRequest, requireAuth, requireRole } from '../../middleware/auth.ts';
import { generateReference, recordAuditLog } from '../audit.ts';

const router = Router();
router.use(requireAuth, requireRole('OWNER'));

const PAYMENT_METHODS = ['نقداً', 'تحويل بنكي (بنكك)', 'شيك'] as const;
const VALID_SHIFTS = ['الوردية الصباحية', 'الوردية المسائية', 'الوردية الليلية'] as const;

function round2(n: number): number {
  return Number((Number.isFinite(n) ? n : 0).toFixed(2));
}

function inDateRange(dateStr: string, dateFrom?: string, dateTo?: string): boolean {
  if (dateFrom && dateStr < dateFrom) return false;
  if (dateTo && dateStr > dateTo) return false;
  return true;
}

// ==========================================
// 1. EXPENSE REVERSAL (CORRECTION MECHANISM)
// ==========================================
router.post('/expenses/:id/reverse', async (req: AuthRequest, res) => {
  try {
    const expenseId = Number(req.params.id);
    const reason = String(req.body?.reason || 'عكس قيد مصروف بقرار المالك').trim();
    if (!Number.isInteger(expenseId) || reason.length < 3) {
      return res.status(400).json({ error: 'يرجى تحديد معرف المصروف وسبب العكس.' });
    }

    const result = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(${900000 + expenseId})`);
      const [orig] = await tx
        .select()
        .from(expenses)
        .where(eq(expenses.id, expenseId))
        .limit(1);
      if (!orig) throw new Error('NOT_FOUND');
      if (orig.isReversal || orig.status === 'معكوس') throw new Error('ALREADY_REVERSED');

      const revRef = `REV-${orig.reference}`;
      const [dup] = await tx
        .select()
        .from(expenses)
        .where(eq(expenses.reference, revRef))
        .limit(1);
      if (dup) throw new Error('ALREADY_REVERSED');

      const origAmt = Number(orig.amount);
      const today = new Date().toISOString().slice(0, 10);

      await tx
        .update(expenses)
        .set({ status: 'معكوس' })
        .where(eq(expenses.id, orig.id));

      const [revExpense] = await tx
        .insert(expenses)
        .values({
          reference: revRef,
          date: today,
          category: orig.category,
          amount: (-origAmt).toFixed(2),
          description: `قيد عكسي للمصروف ${orig.reference}: ${reason}`,
          paymentMethod: orig.paymentMethod,
          responsibleUserId: req.authUser!.id,
          responsibleUser: req.authUser!.fullName,
          shiftId: orig.shiftId,
          status: 'معكوس',
          isReversal: true,
          reversedExpenseId: orig.id,
        })
        .returning();

      await tx.insert(cashTransactions).values({
        reference: generateReference('CSH'),
        type: 'قيد عكسي مصروف',
        category: 'قيد عكسي',
        direction: 'IN',
        amount: origAmt.toFixed(2),
        date: today,
        paymentMethod: orig.paymentMethod,
        relatedEntity: `${orig.category} (${orig.reference})`,
        notes: reason,
        shiftId: orig.shiftId,
        recordedByUserId: req.authUser!.id,
        recordedBy: req.authUser!.fullName,
        isReversal: true,
      });

      if (orig.shiftId) {
        const [sh] = await tx
          .select()
          .from(shifts)
          .where(eq(shifts.id, orig.shiftId))
          .limit(1);
        if (sh && sh.status === 'مفتوحة') {
          await tx
            .update(shifts)
            .set({
              totalExpenses: Math.max(0, round2(Number(sh.totalExpenses) - origAmt)).toFixed(2),
              expectedCash: round2(Number(sh.expectedCash) + origAmt).toFixed(2),
            })
            .where(eq(shifts.id, sh.id));
        }
      }

      await recordAuditLog(tx, {
        userId: req.authUser!.id,
        userName: req.authUser!.fullName,
        role: 'OWNER',
        operationType: 'عكس قيد مصروف تشغيلي',
        entityType: 'expenses',
        entityId: String(orig.id),
        affectedRecord: orig.reference,
        previousValue: `${orig.category}: ${origAmt} ج.س`,
        newValue: `قيد عكسي بمبلغ -${origAmt} ج.س · السبب: ${reason}`,
        reference: revRef,
      });

      return revExpense;
    });

    return res.json({ ok: true, reference: result.reference });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : '';
    if (msg === 'NOT_FOUND') return res.status(404).json({ error: 'المصروف غير موجود.' });
    if (msg === 'ALREADY_REVERSED') {
      return res.status(409).json({ error: 'تم عكس هذا المصروف مسبقاً.' });
    }
    console.error('Reverse expense error:', error);
    return res.status(500).json({ error: 'تعذر عكس المصروف.' });
  }
});

// ==========================================
// 2. CASH MANAGEMENT (INFLOWS, OUTFLOWS, DEPOSITS, WITHDRAWALS, HANDOVERS)
// ==========================================
router.get('/cash', async (req, res) => {
  try {
    const dateFrom = String(req.query.dateFrom || '').trim() || undefined;
    const dateTo = String(req.query.dateTo || '').trim() || undefined;
    const direction = String(req.query.direction || 'ALL').trim();
    const category = String(req.query.category || 'ALL').trim();
    const search = String(req.query.search || '').trim().toLowerCase();
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));

    const [allCash, allHandovers, allShifts] = await Promise.all([
      db.select().from(cashTransactions).orderBy(desc(cashTransactions.id)),
      db.select().from(shiftHandovers).orderBy(desc(shiftHandovers.id)),
      db.select().from(shifts),
    ]);

    const shiftById = new Map(allShifts.map((s) => [s.id, s]));

    // Cumulative overall live cash balance across entire ledger
    const cumulativeIn = round2(
      allCash.filter((c) => c.direction === 'IN').reduce((a, c) => a + Number(c.amount), 0)
    );
    const cumulativeOut = round2(
      allCash.filter((c) => c.direction === 'OUT').reduce((a, c) => a + Number(c.amount), 0)
    );
    const liveCashBalance = round2(cumulativeIn - cumulativeOut);

    const periodCash = allCash.filter((c) => inDateRange(c.date, dateFrom, dateTo));
    const totalInflows = round2(
      periodCash.filter((c) => c.direction === 'IN').reduce((a, c) => a + Number(c.amount), 0)
    );
    const totalOutflows = round2(
      periodCash.filter((c) => c.direction === 'OUT').reduce((a, c) => a + Number(c.amount), 0)
    );

    const sumCat = (fn: (c: typeof cashTransactions.$inferSelect) => boolean) =>
      round2(periodCash.filter(fn).reduce((a, c) => a + Number(c.amount), 0));

    let filtered = periodCash;
    if (direction === 'IN' || direction === 'OUT') {
      filtered = filtered.filter((c) => c.direction === direction);
    }
    if (category && category !== 'ALL') {
      filtered = filtered.filter((c) => c.type === category || c.category === category);
    }
    if (search) {
      filtered = filtered.filter(
        (c) =>
          c.reference.toLowerCase().includes(search) ||
          c.type.toLowerCase().includes(search) ||
          c.relatedEntity.toLowerCase().includes(search) ||
          c.recordedBy.toLowerCase().includes(search)
      );
    }

    const total = filtered.length;
    const totalPages = Math.max(1, Math.ceil(total / limit));
    const offset = (page - 1) * limit;

    const handovers = allHandovers
      .filter((h) => {
        const sh = shiftById.get(h.shiftId);
        return sh ? inDateRange(sh.date, dateFrom, dateTo) : true;
      })
      .map((h) => {
        const sh = shiftById.get(h.shiftId);
        return {
          id: String(h.id),
          shiftId: String(h.shiftId),
          shiftName: sh?.shiftName || '',
          date: sh?.date || h.handedAt.toISOString().slice(0, 10),
          agentName: sh?.agentName || '',
          expectedCash: Number(h.expectedCash),
          handedCash: Number(h.handedCash),
          cashDifference: Number(h.cashDifference),
          receivedByName: h.receivedByName,
          approvedByOwner: h.approvedByOwner,
          approvedByName: h.approvedByName ?? undefined,
          handedAt: h.handedAt.toISOString(),
        };
      });

    return res.json({
      summary: {
        liveCashBalance,
        cumulativeIn,
        cumulativeOut,
        totalInflows,
        totalOutflows,
        periodNetCash: round2(totalInflows - totalOutflows),
        cashSalesIn: sumCat((c) => c.direction === 'IN' && c.type === 'إيداع مبيعات'),
        customerPaymentsIn: sumCat((c) => c.direction === 'IN' && c.type === 'تحصيل عميل'),
        manualDepositsIn: sumCat((c) => c.direction === 'IN' && c.type === 'إيداع نقدي'),
        supplierPaymentsOut: sumCat((c) => c.direction === 'OUT' && c.type === 'سحب سداد مورد'),
        expensesOut: sumCat((c) => c.direction === 'OUT' && c.type === 'مصروف تشغيلي'),
        payrollOut: sumCat((c) => c.direction === 'OUT' && c.type === 'صرف رواتب'),
        manualWithdrawalsOut: sumCat((c) => c.direction === 'OUT' && c.type === 'سحب نقدي'),
      },
      transactions: filtered.slice(offset, offset + limit).map((c) => ({
        id: String(c.id),
        reference: c.reference,
        type: c.type,
        category: c.category,
        direction: c.direction as 'IN' | 'OUT',
        amount: Number(c.amount),
        date: c.date,
        paymentMethod: c.paymentMethod,
        relatedEntity: c.relatedEntity,
        notes: c.notes ?? undefined,
        recordedBy: c.recordedBy,
        isReversal: c.isReversal,
      })),
      handovers,
      pagination: { total, page, limit, totalPages },
    });
  } catch (error) {
    console.error('Cash summary error:', error);
    return res.status(500).json({ error: 'تعذر تحميل بيانات الخزينة والتدفقات النقدية.' });
  }
});

router.post('/cash/transactions', async (req: AuthRequest, res) => {
  try {
    const schema = z.object({
      type: z.enum(['إيداع نقدي', 'سحب نقدي']),
      amount: z.coerce.number().positive('المبلغ يجب أن يكون أكبر من صفر'),
      date: z.string().trim().min(8).optional(),
      paymentMethod: z.enum(PAYMENT_METHODS).default('نقداً'),
      relatedEntity: z.string().trim().min(2, 'يرجى تحديد الجهة أو البيان'),
      notes: z.string().optional(),
      clientTxId: z.string().trim().optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message || 'بيانات الحركة النقدية غير صالحة.' });
    }
    const d = parsed.data;
    const opDate = d.date || new Date().toISOString().slice(0, 10);
    const direction = d.type === 'إيداع نقدي' ? 'IN' : 'OUT';

    const created = await db.transaction(async (tx) => {
      if (d.clientTxId) {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${d.clientTxId}))`);
        const [dup] = await tx
          .select()
          .from(cashTransactions)
          .where(eq(cashTransactions.clientTxId, d.clientTxId))
          .limit(1);
        if (dup) throw new Error('DUPLICATE_TX');
      }

      const ref = generateReference('CSH');
      const [row] = await tx
        .insert(cashTransactions)
        .values({
          reference: ref,
          clientTxId: d.clientTxId ?? null,
          type: d.type,
          category: 'تمويل وخزينة',
          direction,
          amount: d.amount.toFixed(2),
          date: opDate,
          paymentMethod: d.paymentMethod,
          relatedEntity: d.relatedEntity,
          notes: d.notes ?? null,
          recordedByUserId: req.authUser!.id,
          recordedBy: req.authUser!.fullName,
        })
        .returning();

      await recordAuditLog(tx, {
        userId: req.authUser!.id,
        userName: req.authUser!.fullName,
        role: 'OWNER',
        operationType: d.type === 'إيداع نقدي' ? 'إيداع نقدي بالخزينة' : 'سحب نقدي من الخزينة',
        entityType: 'cash_transactions',
        entityId: String(row.id),
        affectedRecord: ref,
        newValue: `${d.type} بمبلغ ${d.amount.toFixed(2)} ج.س (${d.paymentMethod}) — ${d.relatedEntity}`,
        reference: ref,
      });

      return row;
    });

    return res.status(201).json({
      id: String(created.id),
      reference: created.reference,
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : '';
    if (msg === 'DUPLICATE_TX') {
      return res.status(409).json({ error: 'تم تسجيل هذه الحركة النقدية مسبقاً.' });
    }
    console.error('Create cash transaction error:', error);
    return res.status(500).json({ error: 'تعذر تسجيل الحركة النقدية.' });
  }
});

router.post('/cash/transactions/:id/reverse', async (req: AuthRequest, res) => {
  try {
    const txId = Number(req.params.id);
    const reason = String(req.body?.reason || 'تصحيح قيد خزينة معتمد').trim();
    if (!Number.isInteger(txId) || reason.length < 3) {
      return res.status(400).json({ error: 'يرجى تحديد الحركة النقدية وسبب العكس.' });
    }

    const rev = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(${950000 + txId})`);
      const [orig] = await tx
        .select()
        .from(cashTransactions)
        .where(eq(cashTransactions.id, txId))
        .limit(1);
      if (!orig) throw new Error('NOT_FOUND');
      if (orig.isReversal) throw new Error('ALREADY_REVERSED');
      if (orig.type !== 'إيداع نقدي' && orig.type !== 'سحب نقدي') {
        throw new Error('USE_SOURCE_REVERSAL');
      }

      const [existingRev] = await tx
        .select()
        .from(cashTransactions)
        .where(eq(cashTransactions.reversedTxId, orig.id))
        .limit(1);
      if (existingRev) throw new Error('ALREADY_REVERSED');

      const today = new Date().toISOString().slice(0, 10);
      const revRef = `REV-${orig.reference}`;
      const [row] = await tx
        .insert(cashTransactions)
        .values({
          reference: revRef,
          type: 'قيد عكسي خزينة',
          category: 'قيد عكسي',
          direction: orig.direction === 'IN' ? 'OUT' : 'IN',
          amount: Number(orig.amount).toFixed(2),
          date: today,
          paymentMethod: orig.paymentMethod,
          relatedEntity: `عكس ${orig.reference}: ${orig.relatedEntity}`,
          notes: reason,
          recordedByUserId: req.authUser!.id,
          recordedBy: req.authUser!.fullName,
          isReversal: true,
          reversedTxId: orig.id,
        })
        .returning();

      await recordAuditLog(tx, {
        userId: req.authUser!.id,
        userName: req.authUser!.fullName,
        role: 'OWNER',
        operationType: 'قيد عكسي لحركة خزينة',
        entityType: 'cash_transactions',
        entityId: String(orig.id),
        affectedRecord: orig.reference,
        previousValue: `${orig.type} (${orig.direction}) ${orig.amount} ج.س`,
        newValue: `عكس بمبلغ ${orig.amount} ج.س · السبب: ${reason}`,
        reference: revRef,
      });

      return row;
    });

    return res.json({ ok: true, reference: rev.reference });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : '';
    if (msg === 'NOT_FOUND') return res.status(404).json({ error: 'الحركة غير موجودة.' });
    if (msg === 'ALREADY_REVERSED') return res.status(409).json({ error: 'تم عكس هذه الحركة مسبقاً.' });
    if (msg === 'USE_SOURCE_REVERSAL') {
      return res.status(400).json({
        error: 'الحركات النقدية المرتبطة بمصروف أو مورد أو عميل أو راتب يتم عكسها من سجلها الأصلي لضمان التطابق المحاسبي.',
      });
    }
    console.error('Reverse cash tx error:', error);
    return res.status(500).json({ error: 'تعذر تنفيذ القيد العكسي للخزينة.' });
  }
});

// ==========================================
// 3. CUSTOMER MANAGEMENT (CRUD, PAYMENTS, ADJUSTMENTS, STATEMENTS)
// ==========================================
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
    const formulaBalance = round2(totalCreditSales - totalPayments + adjustments);

    // Note: seeded customers may have historical opening credit balance before individual sales rows were logged.
    const recordedCreditSalesSum = round2(
      creditSales.reduce((a, s) => a + Number(s.totalAmount), 0)
    );
    const recordedPaymentsSum = round2(
      payRows.reduce((a, p) => a + Number(p.amount), 0)
    );
    const openingSalesCarried = round2(totalCreditSales - recordedCreditSalesSum);
    const openingPaymentsCarried = round2(totalPayments - recordedPaymentsSum);
    const openingBalance = round2(openingSalesCarried - openingPaymentsCarried);

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
      runningBalance = round2(runningBalance + entry.debit - entry.credit);
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

      const nextPaid = round2(Number(cust.totalPayments) - origAmt);
      const nextBal = round2(
        Number(cust.totalCreditSales) - nextPaid + Number(cust.adjustments)
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

      const nextAdj = round2(Number(cust.adjustments) + d.amount);
      const nextBal = round2(
        Number(cust.totalCreditSales) - Number(cust.totalPayments) + nextAdj
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

// ==========================================
// 4. EMPLOYEE MANAGEMENT (CRUD, ATTENDANCE, PAYROLL, ACCOUNT HISTORY)
// ==========================================
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
        remainingSalary: round2(Math.max(0, Number(emp.monthlySalary) - Number(emp.paidThisMonth))),
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

      const nextPaidMonth = round2(Number(emp.paidThisMonth) + d.amountPaid);
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
          paidThisMonth: Math.max(0, round2(Number(emp.paidThisMonth) - origAmt)).toFixed(2),
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

// ==========================================
// 5. FINANCIAL ACCOUNTING ENGINE (DASHBOARD & 13 REPORTS)
// ==========================================
async function computeFinancialPeriodSnapshot(params: {
  dateFrom?: string;
  dateTo?: string;
  agentId?: number;
  breadType?: string;
}) {
  const { dateFrom, dateTo, agentId, breadType } = params;

  const [
    allSales,
    allProd,
    allProdIngredients,
    allInv,
    allExpenses,
    allCash,
    allSuppliers,
    allCustomers,
    allCustPayments,
    allShifts,
    allBreadMov,
    allHandovers,
    allInvoices,
  ] = await Promise.all([
    db.select().from(sales),
    db.select().from(productionRecords),
    db.select().from(productionIngredients),
    db.select().from(inventoryItems),
    db.select().from(expenses),
    db.select().from(cashTransactions),
    db.select().from(suppliers),
    db.select().from(customers),
    db.select().from(customerPayments),
    db.select().from(shifts),
    db.select().from(breadMovements),
    db.select().from(shiftHandovers),
    db.select().from(purchaseInvoices),
  ]);

  const invById = new Map(allInv.map((i) => [i.id, i]));
  const flourCost = Number(allInv.find((i) => i.sku === 'RM-FLR-01')?.averageCost ?? 64500);
  const oilCost = Number(allInv.find((i) => i.sku === 'RM-OIL-02')?.averageCost ?? 6500);
  const yeastCost = Number(allInv.find((i) => i.sku === 'RM-YST-03')?.averageCost ?? 30);
  const saltCost = Number(allInv.find((i) => i.sku === 'RM-SLT-04')?.averageCost ?? 1200);
  const sugarCost = Number(allInv.find((i) => i.sku === 'RM-SGR-05')?.averageCost ?? 3400);

  const ingredientsByProdId = new Map<number, (typeof productionIngredients.$inferSelect)[]>();
  for (const pi of allProdIngredients) {
    const arr = ingredientsByProdId.get(pi.productionRecordId) || [];
    arr.push(pi);
    ingredientsByProdId.set(pi.productionRecordId, arr);
  }

  const prodCostForRecord = (p: typeof productionRecords.$inferSelect): number => {
    const rows = ingredientsByProdId.get(p.id);
    if (rows && rows.length > 0) {
      return round2(
        rows.reduce((sum, pi) => {
          const item = invById.get(pi.inventoryItemId);
          return sum + Number(pi.quantityUsed) * Number(item?.averageCost ?? 0);
        }, 0)
      );
    }
    return round2(
      Number(p.flourConsumedBags) * flourCost +
        Number(p.oilConsumedLiters) * oilCost +
        Number(p.yeastConsumedGrams) * yeastCost +
        (Number(p.saltConsumedGrams) / 1000) * saltCost +
        (Number(p.sugarConsumedGrams) / 1000) * sugarCost
    );
  };

  const filteredSales = allSales.filter(
    (s) =>
      inDateRange(s.date, dateFrom, dateTo) &&
      (!agentId || s.agentId === agentId) &&
      (!breadType || breadType === 'ALL' || s.breadType === breadType)
  );

  const filteredProd = allProd.filter(
    (p) =>
      inDateRange(p.date, dateFrom, dateTo) &&
      (!agentId || p.agentId === agentId) &&
      (!breadType || breadType === 'ALL' || p.breadType === breadType)
  );

  const filteredExpenses = allExpenses.filter((e) => inDateRange(e.date, dateFrom, dateTo));
  const filteredCustPayments = allCustPayments.filter((p) =>
    inDateRange(p.date, dateFrom, dateTo)
  );
  const filteredCash = allCash.filter((c) => inDateRange(c.date, dateFrom, dateTo));

  // Consistent Accrual vs Cash Accounting Basis
  const salesRevenue = round2(filteredSales.reduce((a, s) => a + Number(s.totalAmount), 0));
  const cashSalesRevenue = round2(
    filteredSales
      .filter((s) => s.paymentType === 'نقدي')
      .reduce((a, s) => a + Number(s.totalAmount), 0)
  );
  const creditSalesRevenue = round2(
    filteredSales
      .filter((s) => s.paymentType === 'آجل')
      .reduce((a, s) => a + Number(s.totalAmount), 0)
  );
  const customerPaymentsCollected = round2(
    filteredCustPayments.reduce((a, p) => a + Number(p.amount), 0)
  );
  const cashCollected = round2(cashSalesRevenue + customerPaymentsCollected);

  const costOfGoodsConsumed = round2(
    filteredProd.reduce((a, p) => a + prodCostForRecord(p), 0)
  );
  const operatingExpenses = round2(
    filteredExpenses.reduce((a, e) => a + Number(e.amount), 0)
  );

  const grossProfit = round2(salesRevenue - costOfGoodsConsumed);
  const netEstimatedProfit = round2(grossProfit - operatingExpenses);

  // Live Position Balances (across ledger)
  const cashBalance = round2(
    allCash.reduce(
      (a, c) => (c.direction === 'IN' ? a + Number(c.amount) : a - Number(c.amount)),
      0
    )
  );
  const outstandingReceivables = round2(
    allCustomers.reduce(
      (a, c) =>
        a + (Number(c.totalCreditSales) - Number(c.totalPayments) + Number(c.adjustments)),
      0
    )
  );
  const supplierLiabilities = round2(
    allSuppliers.reduce(
      (a, s) =>
        a + (Number(s.totalPurchases) - Number(s.totalPayments) + Number(s.adjustments)),
      0
    )
  );
  const inventoryValue = round2(
    allInv.reduce((a, i) => a + Number(i.availableQuantity) * Number(i.averageCost), 0)
  );

  const periodCashInflows = round2(
    filteredCash.filter((c) => c.direction === 'IN').reduce((a, c) => a + Number(c.amount), 0)
  );
  const periodCashOutflows = round2(
    filteredCash.filter((c) => c.direction === 'OUT').reduce((a, c) => a + Number(c.amount), 0)
  );

  // Expenses grouped by category (exclude netted-zero reversed categories)
  const expenseMap = new Map<string, number>();
  for (const e of filteredExpenses) {
    expenseMap.set(e.category, round2((expenseMap.get(e.category) || 0) + Number(e.amount)));
  }
  const expenseByCategory = Array.from(expenseMap.entries())
    .filter(([, val]) => Math.abs(val) > 0.01)
    .map(([category, amount]) => ({ category, amount }));

  return {
    allSales,
    allProd,
    allInv,
    allExpenses,
    allCash,
    allSuppliers,
    allCustomers,
    allCustPayments,
    allShifts,
    allBreadMov,
    allHandovers,
    allInvoices,
    filteredSales,
    filteredProd,
    filteredExpenses,
    filteredCustPayments,
    filteredCash,
    prodCostForRecord,
    metrics: {
      salesRevenue,
      cashSalesRevenue,
      creditSalesRevenue,
      customerPaymentsCollected,
      cashCollected,
      costOfGoodsConsumed,
      operatingExpenses,
      grossProfit,
      netEstimatedProfit,
      cashBalance,
      periodCashInflows,
      periodCashOutflows,
      periodNetCashFlow: round2(periodCashInflows - periodCashOutflows),
      outstandingReceivables,
      supplierLiabilities,
      inventoryValue,
      soldBreadLoaves: filteredSales.reduce((a, s) => a + s.quantity, 0),
      producedBreadLoaves: filteredProd.reduce((a, p) => a + p.producedLoaves, 0),
      damagedBreadLoaves:
        filteredProd.reduce((a, p) => a + p.damagedLoaves, 0) +
        allBreadMov
          .filter((b) => inDateRange(b.date, dateFrom, dateTo) && b.type === 'تالف')
          .reduce((a, b) => a + b.quantity, 0),
      expenseByCategory,
    },
  };
}

// GET /api/accounting/dashboard?dateFrom=&dateTo=
router.get('/dashboard', async (req, res) => {
  try {
    const dateFrom = String(req.query.dateFrom || '').trim() || undefined;
    const dateTo = String(req.query.dateTo || '').trim() || undefined;

    const snap = await computeFinancialPeriodSnapshot({ dateFrom, dateTo });

    // Build daily and monthly time series from real DB data
    const dailyMap = new Map<string, { label: string; date: string; sales: number; expenses: number }>();
    for (const s of snap.filteredSales) {
      const entry = dailyMap.get(s.date) || {
        label: s.date.slice(5),
        date: s.date,
        sales: 0,
        expenses: 0,
      };
      entry.sales = round2(entry.sales + Number(s.totalAmount));
      dailyMap.set(s.date, entry);
    }
    for (const e of snap.filteredExpenses) {
      const entry = dailyMap.get(e.date) || {
        label: e.date.slice(5),
        date: e.date,
        sales: 0,
        expenses: 0,
      };
      entry.expenses = round2(entry.expenses + Number(e.amount));
      dailyMap.set(e.date, entry);
    }

    const monthlyMap = new Map<string, { label: string; sales: number; expenses: number }>();
    for (const s of snap.allSales) {
      const key = s.date.slice(0, 7);
      const entry = monthlyMap.get(key) || { label: key, sales: 0, expenses: 0 };
      entry.sales = round2(entry.sales + Number(s.totalAmount));
      monthlyMap.set(key, entry);
    }
    for (const e of snap.allExpenses) {
      const key = e.date.slice(0, 7);
      const entry = monthlyMap.get(key) || { label: key, sales: 0, expenses: 0 };
      entry.expenses = round2(entry.expenses + Number(e.amount));
      monthlyMap.set(key, entry);
    }

    return res.json({
      period: {
        dateFrom: dateFrom || 'الكل',
        dateTo: dateTo || 'الكل',
      },
      accountingBasis: {
        basisName: 'أساس الاستحقاق التشغيلي مع فصل التدفق النقدي (Modified Accrual)',
        profitFormula:
          'إجمالي المبيعات (نقدي + آجل) − تكلفة المكونات المستهلكة فعلياً − المصروفات التشغيلية',
        cashRule: 'الإيداعات النقدية المباشرة وسداد فواتير الموردين لا تُحتسب إيراداً أو مصروفاً في قائمة الدخل.',
      },
      metrics: snap.metrics,
      dailySeries: Array.from(dailyMap.values())
        .sort((a, b) => a.date.localeCompare(b.date))
        .slice(-14),
      monthlySeries: Array.from(monthlyMap.values())
        .sort((a, b) => a.label.localeCompare(b.label))
        .slice(-12),
    });
  } catch (error) {
    console.error('Accounting dashboard error:', error);
    return res.status(500).json({ error: 'تعذر احتساب المؤشرات المالية من قاعدة البيانات.' });
  }
});

function getIsoWeekKey(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return dateStr.slice(0, 7);
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

// GET /api/accounting/reports?type=&dateFrom=&dateTo=&agentId=&supplierId=&breadType=&search=&page=&limit=
router.get('/reports', async (req, res) => {
  try {
    const type = String(req.query.type || 'pnl').trim();
    const dateFrom = String(req.query.dateFrom || '').trim() || undefined;
    const dateTo = String(req.query.dateTo || '').trim() || undefined;
    const agentIdParam =
      req.query.agentId && req.query.agentId !== 'ALL' ? Number(req.query.agentId) : undefined;
    const supplierIdParam =
      req.query.supplierId && req.query.supplierId !== 'ALL'
        ? Number(req.query.supplierId)
        : undefined;
    const breadType = String(req.query.breadType || 'ALL').trim();
    const search = String(req.query.search || '').trim().toLowerCase();
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 100));

    const snap = await computeFinancialPeriodSnapshot({
      dateFrom,
      dateTo,
      agentId: agentIdParam,
      breadType,
    });

    let columns: { key: string; label: string; format?: 'currency' | 'number' | 'text' }[] = [];
    let rows: Record<string, string | number>[] = [];
    let summary: Record<string, string | number> = {};
    let reportTitle = '';

    if (type === 'pnl') {
      reportTitle = 'قائمة الأرباح والخسائر (Profit & Loss)';
      columns = [
        { key: 'section', label: 'التصنيف المحاسبي', format: 'text' },
        { key: 'item', label: 'البند المالي', format: 'text' },
        { key: 'basisNote', label: 'ملاحظة القياس المحاسبي', format: 'text' },
        { key: 'amount', label: 'القيمة (ج.س)', format: 'currency' },
      ];
      rows = [
        {
          section: 'الإيرادات',
          item: 'المبيعات النقدية',
          basisNote: 'مبيعات الخبز المحصلة نقداً عند البيع',
          amount: snap.metrics.cashSalesRevenue,
        },
        {
          section: 'الإيرادات',
          item: 'المبيعات الآجلة',
          basisNote: 'إيرادات مستحقة على العملاء (ذمم مدينة)',
          amount: snap.metrics.creditSalesRevenue,
        },
        {
          section: 'الإيرادات',
          item: 'إجمالي إيرادات المبيعات',
          basisNote: 'مجموع المبيعات النقدية والآجلة خلال الفترة',
          amount: snap.metrics.salesRevenue,
        },
        {
          section: 'تكلفة الإنتاج',
          item: 'تكلفة المواد الخام المستهلكة (COGS)',
          basisNote: 'محسوبة من الاستهلاك الفعلي للمكونات × متوسط التكلفة المرجح',
          amount: -snap.metrics.costOfGoodsConsumed,
        },
        {
          section: 'مجمل الربح',
          item: 'إجمالي الربح التشغيلي (Gross Profit)',
          basisNote: 'إيرادات المبيعات − تكلفة المواد المستهلكة',
          amount: snap.metrics.grossProfit,
        },
        ...snap.metrics.expenseByCategory.map((ec) => ({
          section: 'المصروفات التشغيلية',
          item: ec.category,
          basisNote: 'مصروفات تشغيلية مرحّلة خلال الفترة',
          amount: -ec.amount,
        })),
        {
          section: 'المصروفات التشغيلية',
          item: 'إجمالي المصروفات التشغيلية',
          basisNote: 'شاملة الرواتب والوقود والكهرباء والصيانة والإيجار',
          amount: -snap.metrics.operatingExpenses,
        },
        {
          section: 'النتيجة النهائية',
          item: 'صافي الربح التقديري (Net Profit)',
          basisNote: 'مجمل الربح − إجمالي المصروفات التشغيلية',
          amount: snap.metrics.netEstimatedProfit,
        },
      ];
      summary = {
        salesRevenue: snap.metrics.salesRevenue,
        cashCollected: snap.metrics.cashCollected,
        creditSalesRevenue: snap.metrics.creditSalesRevenue,
        costOfGoodsConsumed: snap.metrics.costOfGoodsConsumed,
        grossProfit: snap.metrics.grossProfit,
        operatingExpenses: snap.metrics.operatingExpenses,
        netEstimatedProfit: snap.metrics.netEstimatedProfit,
      };
    } else if (type === 'cash-flow') {
      reportTitle = 'تقرير التدفقات النقدية (Cash Flow Statement)';
      const txList = snap.filteredCash;
      const operatingIn = round2(
        txList
          .filter((c) => c.direction === 'IN' && c.category !== 'تمويل وخزينة')
          .reduce((a, c) => a + Number(c.amount), 0)
      );
      const operatingOut = round2(
        txList
          .filter((c) => c.direction === 'OUT' && c.category !== 'تمويل وخزينة')
          .reduce((a, c) => a + Number(c.amount), 0)
      );
      const financingIn = round2(
        txList
          .filter((c) => c.direction === 'IN' && c.category === 'تمويل وخزينة')
          .reduce((a, c) => a + Number(c.amount), 0)
      );
      const financingOut = round2(
        txList
          .filter((c) => c.direction === 'OUT' && c.category === 'تمويل وخزينة')
          .reduce((a, c) => a + Number(c.amount), 0)
      );

      columns = [
        { key: 'reference', label: 'المرجع', format: 'text' },
        { key: 'date', label: 'التاريخ', format: 'text' },
        { key: 'type', label: 'نوع الحركة', format: 'text' },
        { key: 'paymentMethod', label: 'الوسيلة', format: 'text' },
        { key: 'relatedEntity', label: 'البيان / الجهة', format: 'text' },
        { key: 'inflow', label: 'داخل (+)', format: 'currency' },
        { key: 'outflow', label: 'خارج (−)', format: 'currency' },
        { key: 'recordedBy', label: 'المسؤول', format: 'text' },
      ];
      rows = txList.map((c) => ({
        reference: c.reference,
        date: c.date,
        type: c.type,
        paymentMethod: c.paymentMethod,
        relatedEntity: c.relatedEntity,
        inflow: c.direction === 'IN' ? Number(c.amount) : 0,
        outflow: c.direction === 'OUT' ? Number(c.amount) : 0,
        recordedBy: c.recordedBy,
      }));
      summary = {
        operatingIn,
        operatingOut,
        netOperatingCash: round2(operatingIn - operatingOut),
        financingIn,
        financingOut,
        netCashFlow: round2(operatingIn - operatingOut + financingIn - financingOut),
        closingCashBalance: snap.metrics.cashBalance,
      };
    } else if (type === 'daily-sales') {
      reportTitle = 'تقرير المبيعات اليومي';
      columns = [
        { key: 'reference', label: 'المرجع', format: 'text' },
        { key: 'date', label: 'التاريخ', format: 'text' },
        { key: 'shiftName', label: 'الوردية', format: 'text' },
        { key: 'agentName', label: 'الوكيل', format: 'text' },
        { key: 'breadType', label: 'نوع الخبز', format: 'text' },
        { key: 'quantity', label: 'الكمية', format: 'number' },
        { key: 'paymentType', label: 'الدفع', format: 'text' },
        { key: 'totalAmount', label: 'الإجمالي', format: 'currency' },
      ];
      rows = snap.filteredSales.map((s) => ({
        reference: s.reference,
        date: s.date,
        shiftName: s.shiftName,
        agentName: s.agentName,
        breadType: s.breadType,
        quantity: s.quantity,
        paymentType: s.paymentType,
        totalAmount: Number(s.totalAmount),
      }));
      summary = {
        transactionsCount: rows.length,
        totalQuantity: snap.metrics.soldBreadLoaves,
        cashSales: snap.metrics.cashSalesRevenue,
        creditSales: snap.metrics.creditSalesRevenue,
        totalRevenue: snap.metrics.salesRevenue,
      };
    } else if (type === 'weekly-sales' || type === 'monthly-sales' || type === 'annual-sales') {
      reportTitle =
        type === 'weekly-sales'
          ? 'تقرير المبيعات الأسبوعي'
          : type === 'monthly-sales'
          ? 'تقرير المبيعات الشهري'
          : 'تقرير المبيعات السنوي';
      const bucketMap = new Map<
        string,
        {
          period: string;
          invoicesCount: number;
          quantity: number;
          cashAmount: number;
          creditAmount: number;
          totalAmount: number;
        }
      >();
      for (const s of snap.filteredSales) {
        const key =
          type === 'weekly-sales'
            ? getIsoWeekKey(s.date)
            : type === 'monthly-sales'
            ? s.date.slice(0, 7)
            : s.date.slice(0, 4);
        const cur = bucketMap.get(key) || {
          period: key,
          invoicesCount: 0,
          quantity: 0,
          cashAmount: 0,
          creditAmount: 0,
          totalAmount: 0,
        };
        cur.invoicesCount += 1;
        cur.quantity += s.quantity;
        if (s.paymentType === 'نقدي') cur.cashAmount = round2(cur.cashAmount + Number(s.totalAmount));
        else cur.creditAmount = round2(cur.creditAmount + Number(s.totalAmount));
        cur.totalAmount = round2(cur.totalAmount + Number(s.totalAmount));
        bucketMap.set(key, cur);
      }
      columns = [
        { key: 'period', label: 'الفترة الزمنية', format: 'text' },
        { key: 'invoicesCount', label: 'عدد العمليات', format: 'number' },
        { key: 'quantity', label: 'إجمالي الأرغفة', format: 'number' },
        { key: 'cashAmount', label: 'المبيعات النقدية', format: 'currency' },
        { key: 'creditAmount', label: 'المبيعات الآجلة', format: 'currency' },
        { key: 'totalAmount', label: 'إجمالي المبيعات', format: 'currency' },
      ];
      rows = Array.from(bucketMap.values()).sort((a, b) => b.period.localeCompare(a.period));
      summary = {
        totalQuantity: snap.metrics.soldBreadLoaves,
        cashSales: snap.metrics.cashSalesRevenue,
        creditSales: snap.metrics.creditSalesRevenue,
        totalRevenue: snap.metrics.salesRevenue,
      };
    } else if (type === 'production') {
      reportTitle = 'تقرير الإنتاج واستهلاك المواد الخام';
      columns = [
        { key: 'reference', label: 'المرجع', format: 'text' },
        { key: 'date', label: 'التاريخ', format: 'text' },
        { key: 'agentName', label: 'الوكيل', format: 'text' },
        { key: 'breadType', label: 'نوع الخبز', format: 'text' },
        { key: 'flourConsumedBags', label: 'الدقيق (جوال)', format: 'number' },
        { key: 'oilConsumedLiters', label: 'الزيت (لتر)', format: 'number' },
        { key: 'producedLoaves', label: 'المنتج (رغيف)', format: 'number' },
        { key: 'damagedLoaves', label: 'التالف', format: 'number' },
        { key: 'ingredientCost', label: 'تكلفة المكونات', format: 'currency' },
      ];
      rows = snap.filteredProd.map((p) => ({
        reference: p.reference,
        date: p.date,
        agentName: p.agentName,
        breadType: p.breadType,
        flourConsumedBags: Number(p.flourConsumedBags),
        oilConsumedLiters: Number(p.oilConsumedLiters),
        producedLoaves: p.producedLoaves,
        damagedLoaves: p.damagedLoaves,
        ingredientCost: snap.prodCostForRecord(p),
      }));
      summary = {
        batchesCount: rows.length,
        totalProducedLoaves: snap.metrics.producedBreadLoaves,
        totalDamagedLoaves: snap.filteredProd.reduce((a, p) => a + p.damagedLoaves, 0),
        totalFlourBags: round2(snap.filteredProd.reduce((a, p) => a + Number(p.flourConsumedBags), 0)),
        totalIngredientCost: snap.metrics.costOfGoodsConsumed,
      };
    } else if (type === 'inventory') {
      reportTitle = 'تقرير الجرد وتقييم المخزون';
      columns = [
        { key: 'sku', label: 'الكود', format: 'text' },
        { key: 'name', label: 'الصنف', format: 'text' },
        { key: 'category', label: 'التصنيف', format: 'text' },
        { key: 'unit', label: 'الوحدة', format: 'text' },
        { key: 'availableQuantity', label: 'الرصيد المتاح', format: 'number' },
        { key: 'minimumStock', label: 'الحد الأدنى', format: 'number' },
        { key: 'averageCost', label: 'متوسط التكلفة', format: 'currency' },
        { key: 'totalValue', label: 'القيمة الإجمالية', format: 'currency' },
      ];
      rows = snap.allInv.map((i) => ({
        sku: i.sku,
        name: i.name,
        category: i.category,
        unit: i.unit,
        availableQuantity: Number(i.availableQuantity),
        minimumStock: Number(i.minimumStock),
        averageCost: Number(i.averageCost),
        totalValue: round2(Number(i.availableQuantity) * Number(i.averageCost)),
      }));
      summary = {
        itemsCount: rows.length,
        lowStockCount: snap.allInv.filter(
          (i) => Number(i.availableQuantity) <= Number(i.minimumStock)
        ).length,
        totalInventoryValue: snap.metrics.inventoryValue,
      };
    } else if (type === 'supplier-balances') {
      reportTitle = 'تقرير أرصدة ومستحقات الموردين';
      const sups = snap.allSuppliers.filter((s) => !supplierIdParam || s.id === supplierIdParam);
      columns = [
        { key: 'code', label: 'الكود', format: 'text' },
        { key: 'name', label: 'المورد', format: 'text' },
        { key: 'phone', label: 'الهاتف', format: 'text' },
        { key: 'totalPurchases', label: 'إجمالي المشتريات', format: 'currency' },
        { key: 'totalPayments', label: 'إجمالي المدفوعات', format: 'currency' },
        { key: 'adjustments', label: 'التسويات', format: 'currency' },
        { key: 'outstandingBalance', label: 'الرصيد المتبقي', format: 'currency' },
        { key: 'status', label: 'الحالة', format: 'text' },
      ];
      rows = sups.map((s) => ({
        code: s.code,
        name: s.name,
        phone: s.phone,
        totalPurchases: Number(s.totalPurchases),
        totalPayments: Number(s.totalPayments),
        adjustments: Number(s.adjustments),
        outstandingBalance: round2(
          Number(s.totalPurchases) - Number(s.totalPayments) + Number(s.adjustments)
        ),
        status: s.status,
      }));
      summary = {
        suppliersCount: rows.length,
        totalPurchases: round2(sups.reduce((a, s) => a + Number(s.totalPurchases), 0)),
        totalPayments: round2(sups.reduce((a, s) => a + Number(s.totalPayments), 0)),
        totalLiabilities: round2(
          rows.reduce((a, r) => a + Number(r.outstandingBalance), 0)
        ),
      };
    } else if (type === 'customer-debts') {
      reportTitle = 'تقرير مديونيات العملاء (الذمم المدينة)';
      columns = [
        { key: 'name', label: 'العميل', format: 'text' },
        { key: 'phone', label: 'الهاتف', format: 'text' },
        { key: 'creditLimit', label: 'سقف الائتمان', format: 'currency' },
        { key: 'totalCreditSales', label: 'المبيعات الآجلة', format: 'currency' },
        { key: 'totalPayments', label: 'التحصيلات', format: 'currency' },
        { key: 'adjustments', label: 'التسويات', format: 'currency' },
        { key: 'outstandingBalance', label: 'المديونية القائمة', format: 'currency' },
      ];
      rows = snap.allCustomers.map((c) => ({
        name: c.name,
        phone: c.phone,
        creditLimit: Number(c.creditLimit),
        totalCreditSales: Number(c.totalCreditSales),
        totalPayments: Number(c.totalPayments),
        adjustments: Number(c.adjustments),
        outstandingBalance: round2(
          Number(c.totalCreditSales) - Number(c.totalPayments) + Number(c.adjustments)
        ),
      }));
      summary = {
        customersCount: rows.length,
        totalCreditSales: round2(
          snap.allCustomers.reduce((a, c) => a + Number(c.totalCreditSales), 0)
        ),
        totalPayments: round2(
          snap.allCustomers.reduce((a, c) => a + Number(c.totalPayments), 0)
        ),
        outstandingReceivables: snap.metrics.outstandingReceivables,
      };
    } else if (type === 'expenses') {
      reportTitle = 'تقرير المصروفات التشغيلية';
      columns = [
        { key: 'reference', label: 'المرجع', format: 'text' },
        { key: 'date', label: 'التاريخ', format: 'text' },
        { key: 'category', label: 'البند', format: 'text' },
        { key: 'paymentMethod', label: 'طريقة الدفع', format: 'text' },
        { key: 'description', label: 'البيان', format: 'text' },
        { key: 'responsibleUser', label: 'المسؤول', format: 'text' },
        { key: 'status', label: 'الحالة', format: 'text' },
        { key: 'amount', label: 'المبلغ', format: 'currency' },
      ];
      rows = snap.filteredExpenses.map((e) => ({
        reference: e.reference,
        date: e.date,
        category: e.category,
        paymentMethod: e.paymentMethod,
        description: e.description,
        responsibleUser: e.responsibleUser,
        status: e.status,
        amount: Number(e.amount),
      }));
      summary = {
        recordsCount: rows.length,
        totalOperatingExpenses: snap.metrics.operatingExpenses,
      };
    } else if (type === 'agent-performance') {
      reportTitle = 'تقرير أداء الوكلاء والمبيعات';
      const byAgent = new Map<
        string,
        {
          agentName: string;
          producedLoaves: number;
          damagedLoaves: number;
          soldLoaves: number;
          cashSales: number;
          creditSales: number;
          totalSales: number;
          shiftsCount: number;
          cashDifference: number;
        }
      >();
      const ensureAg = (name: string) => {
        if (!byAgent.has(name)) {
          byAgent.set(name, {
            agentName: name,
            producedLoaves: 0,
            damagedLoaves: 0,
            soldLoaves: 0,
            cashSales: 0,
            creditSales: 0,
            totalSales: 0,
            shiftsCount: 0,
            cashDifference: 0,
          });
        }
        return byAgent.get(name)!;
      };
      for (const p of snap.filteredProd) {
        const a = ensureAg(p.agentName);
        a.producedLoaves += p.producedLoaves;
        a.damagedLoaves += p.damagedLoaves;
      }
      for (const s of snap.filteredSales) {
        const a = ensureAg(s.agentName);
        a.soldLoaves += s.quantity;
        if (s.paymentType === 'نقدي') a.cashSales = round2(a.cashSales + Number(s.totalAmount));
        else a.creditSales = round2(a.creditSales + Number(s.totalAmount));
        a.totalSales = round2(a.totalSales + Number(s.totalAmount));
      }
      for (const sh of snap.allShifts.filter(
        (sh) => inDateRange(sh.date, dateFrom, dateTo) && (!agentIdParam || sh.agentId === agentIdParam)
      )) {
        const a = ensureAg(sh.agentName);
        a.shiftsCount += 1;
        a.cashDifference = round2(a.cashDifference + Number(sh.cashDifference ?? 0));
      }
      columns = [
        { key: 'agentName', label: 'الوكيل', format: 'text' },
        { key: 'shiftsCount', label: 'الورديات', format: 'number' },
        { key: 'producedLoaves', label: 'الإنتاج (رغيف)', format: 'number' },
        { key: 'damagedLoaves', label: 'التالف', format: 'number' },
        { key: 'soldLoaves', label: 'المباع (رغيف)', format: 'number' },
        { key: 'cashSales', label: 'نقدي', format: 'currency' },
        { key: 'creditSales', label: 'آجل', format: 'currency' },
        { key: 'totalSales', label: 'إجمالي المبيعات', format: 'currency' },
        { key: 'cashDifference', label: 'فروقات النقدية', format: 'currency' },
      ];
      rows = Array.from(byAgent.values());
      summary = {
        agentsCount: rows.length,
        totalProduced: snap.metrics.producedBreadLoaves,
        totalSales: snap.metrics.salesRevenue,
      };
    } else if (type === 'shift-reconciliation') {
      reportTitle = 'تقرير مطابقة الورديات والعهد النقدية';
      const filteredShifts = snap.allShifts.filter(
        (sh) =>
          inDateRange(sh.date, dateFrom, dateTo) &&
          (!agentIdParam || sh.agentId === agentIdParam)
      );
      columns = [
        { key: 'date', label: 'التاريخ', format: 'text' },
        { key: 'shiftName', label: 'الوردية', format: 'text' },
        { key: 'agentName', label: 'الوكيل', format: 'text' },
        { key: 'producedBread', label: 'الإنتاج', format: 'number' },
        { key: 'soldBread', label: 'المباع', format: 'number' },
        { key: 'expectedCash', label: 'النقدية المتوقعة', format: 'currency' },
        { key: 'actualCash', label: 'النقدية الفعلية', format: 'currency' },
        { key: 'cashDifference', label: 'الفارق النقدي', format: 'currency' },
        { key: 'status', label: 'الحالة', format: 'text' },
      ];
      rows = filteredShifts.map((sh) => ({
        date: sh.date,
        shiftName: sh.shiftName,
        agentName: sh.agentName,
        producedBread: sh.producedBread,
        soldBread: sh.soldBread,
        expectedCash: Number(sh.expectedCash),
        actualCash: sh.actualCash !== null ? Number(sh.actualCash) : 0,
        cashDifference: sh.cashDifference !== null ? Number(sh.cashDifference) : 0,
        status: sh.status,
      }));
      summary = {
        shiftsCount: rows.length,
        totalExpectedCash: round2(rows.reduce((a, r) => a + Number(r.expectedCash), 0)),
        totalActualCash: round2(rows.reduce((a, r) => a + Number(r.actualCash), 0)),
        totalCashDifference: round2(rows.reduce((a, r) => a + Number(r.cashDifference), 0)),
      };
    } else {
      return res.status(400).json({ error: 'نوع التقرير المطلوب غير مدعوم.' });
    }

    if (search) {
      rows = rows.filter((r) =>
        Object.values(r).some((v) => String(v).toLowerCase().includes(search))
      );
    }

    const total = rows.length;
    const totalPages = Math.max(1, Math.ceil(total / limit));
    const offset = (page - 1) * limit;

    return res.json({
      reportType: type,
      reportTitle,
      generatedAt: new Date().toISOString(),
      filters: { dateFrom, dateTo, agentId: agentIdParam, supplierId: supplierIdParam, breadType, search },
      accountingBasis: {
        revenueDefinition: 'إجمالي المبيعات (نقدي + آجل) بغض النظر عن موعد التحصيل أو الإيداعات التمويلية.',
        cashCollectedDefinition: 'المبيعات النقدية + تحصيلات مديونيات العملاء فقط.',
        profitDefinition: 'إيرادات المبيعات − تكلفة المواد المستهلكة فعلياً − المصروفات التشغيلية.',
      },
      columns,
      rows: rows.slice(offset, offset + limit),
      allRowsForExport: rows,
      summary,
      pagination: { total, page, limit, totalPages },
    });
  } catch (error) {
    console.error('Accounting report error:', error);
    return res.status(500).json({ error: 'تعذر توليد التقرير المالي.' });
  }
});

// Unused import suppression check for Drizzle helpers if needed
void gte;
void lte;
void allUnusedGuard;
function allUnusedGuard() {
  void purchaseInvoices;
}

export default router;
