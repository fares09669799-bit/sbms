import { Router } from 'express';
import { desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../../../db/index.ts';
import {
  cashTransactions,
  expenses,
  shiftHandovers,
  shifts,
} from '../../../db/schema.ts';
import { type AuthRequest } from '../../../middleware/auth.ts';
import { generateReference, recordAuditLog } from '../../audit.ts';
import { add2, sub2, sumDecimal2 } from '../../accounting/formulas.ts';
import { inDateRange, PAYMENT_METHODS } from '../../services/financialSnapshotService.ts';

const router = Router();

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
              totalExpenses: Math.max(0, sub2(sh.totalExpenses, origAmt)).toFixed(2),
              expectedCash: add2(sh.expectedCash, origAmt).toFixed(2),
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
    const cumulativeIn = sumDecimal2(
      allCash.filter((c) => c.direction === 'IN').map((c) => c.amount)
    );
    const cumulativeOut = sumDecimal2(
      allCash.filter((c) => c.direction === 'OUT').map((c) => c.amount)
    );
    const liveCashBalance = sub2(cumulativeIn, cumulativeOut);

    const periodCash = allCash.filter((c) => inDateRange(c.date, dateFrom, dateTo));
    const totalInflows = sumDecimal2(
      periodCash.filter((c) => c.direction === 'IN').map((c) => c.amount)
    );
    const totalOutflows = sumDecimal2(
      periodCash.filter((c) => c.direction === 'OUT').map((c) => c.amount)
    );

    const sumCat = (fn: (c: typeof cashTransactions.$inferSelect) => boolean) =>
      sumDecimal2(periodCash.filter(fn).map((c) => c.amount));

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
        periodNetCash: sub2(totalInflows, totalOutflows),
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

export default router;
