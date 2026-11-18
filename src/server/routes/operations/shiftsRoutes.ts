import { Router } from 'express';
import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../../../db/index.ts';
import {
  breadMovements,
  expenses,
  notifications,
  productionRecords,
  sales,
  shiftHandovers,
  shifts,
} from '../../../db/schema.ts';
import {
  type AuthRequest,
  requirePermission,
  requireRole,
} from '../../../middleware/auth.ts';
import { recordAuditLog } from '../../audit.ts';
import {
  computeBreadBalance,
  confirmShiftAndHandover,
  mapBreadMovement,
  mapShift,
  VALID_SHIFTS,
} from '../../services/operationsService.ts';

const router = Router();

router.post('/shifts/open', requirePermission('SHIFT_MANAGE'), async (req: AuthRequest, res) => {
  try {
    const schema = z.object({
      date: z.string().trim().min(8).optional(),
      shiftName: z.enum(VALID_SHIFTS).optional(),
      openingCash: z.coerce.number().min(0, 'العهدة النقدية لا يمكن أن تكون سالبة'),
      openingBread: z.coerce.number().int().min(0, 'الرصيد الافتتاحي للخبز لا يمكن أن يكون سالباً'),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message || 'بيانات فتح الوردية غير صالحة.' });
    }

    const created = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(${550000 + req.authUser!.id})`);
      const [existingOpen] = await tx
        .select()
        .from(shifts)
        .where(and(eq(shifts.agentId, req.authUser!.id), eq(shifts.status, 'مفتوحة')))
        .limit(1);

      if (existingOpen) {
        throw new Error('ALREADY_HAS_OPEN_SHIFT');
      }

      const opDate = parsed.data.date || new Date().toISOString().slice(0, 10);
      const shiftName =
        parsed.data.shiftName ||
        (req.authUser!.assignedShift as (typeof VALID_SHIFTS)[number]) ||
        'الوردية الصباحية';

      const [row] = await tx
        .insert(shifts)
        .values({
          shiftName,
          date: opDate,
          agentId: req.authUser!.id,
          agentName: req.authUser!.fullName,
          status: 'مفتوحة',
          openingCash: parsed.data.openingCash.toFixed(2),
          openingBread: parsed.data.openingBread,
          expectedCash: parsed.data.openingCash.toFixed(2),
          openedAt: new Date(),
        })
        .returning();

      await recordAuditLog(tx, {
        userId: req.authUser!.id,
        userName: req.authUser!.fullName,
        role: req.authUser!.role,
        operationType: 'فتح وردية عمل',
        entityType: 'shifts',
        entityId: String(row.id),
        affectedRecord: `${shiftName} (${opDate})`,
        newValue: `عهدة افتتاحية: ${parsed.data.openingCash} ج.س · ${parsed.data.openingBread} رغيف`,
      });
      return row;
    });

    return res.status(201).json({ id: String(created.id), shift: mapShift(created) });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : '';
    if (msg === 'ALREADY_HAS_OPEN_SHIFT') {
      return res.status(409).json({
        error: 'لديك وردية مفتوحة حالياً بالفعل. يجب إغلاق الوردية الحالية قبل فتح وردية جديدة.',
      });
    }
    console.error('Open shift error:', error);
    return res.status(500).json({ error: 'تعذر فتح الوردية.' });
  }
});

router.post('/shifts/:id/close', requirePermission('SHIFT_MANAGE'), async (req: AuthRequest, res) => {
  try {
    const shiftId = Number(req.params.id);
    const schema = z.object({
      actualCash: z.coerce.number().min(0, 'النقدية الفعلية لا يمكن أن تكون سالبة'),
      closingBread: z.coerce.number().int().min(0, 'الخبز المتبقي لا يمكن أن يكون سالباً'),
      receivedByName: z.string().trim().min(2).optional(),
      notes: z.string().default(''),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success || !Number.isInteger(shiftId)) {
      return res.status(400).json({
        error: parsed.success ? 'معرف الوردية غير صالح.' : parsed.error.issues[0]?.message || 'بيانات الإغلاق غير مكتملة.',
      });
    }

    const result = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(${500000 + shiftId})`);
      const [sh] = await tx.select().from(shifts).where(eq(shifts.id, shiftId)).limit(1);
      if (!sh) throw new Error('SHIFT_NOT_FOUND');
      if (req.authUser!.role === 'AGENT' && sh.agentId !== req.authUser!.id) {
        throw new Error('SHIFT_FORBIDDEN');
      }
      if (sh.status !== 'مفتوحة') throw new Error('INVALID_SHIFT_STATUS');

      // Ensure required operational records exist before closing
      const shiftProd = await tx
        .select()
        .from(productionRecords)
        .where(eq(productionRecords.shiftId, shiftId));
      const shiftSales = await tx
        .select()
        .from(sales)
        .where(eq(sales.shiftId, shiftId));

      const hasProdActivity = shiftProd.length > 0 || sh.producedBread > 0;
      const hasSalesActivity = shiftSales.length > 0 || sh.soldBread > 0;
      if (!hasProdActivity && !hasSalesActivity) {
        throw new Error('MISSING_REQUIRED_RECORDS');
      }

      const expectedCash = Number(
        (
          Number(sh.openingCash) +
          Number(sh.cashSalesAmount) -
          Number(sh.totalExpenses)
        ).toFixed(2)
      );
      const cashDiff = Number((parsed.data.actualCash - expectedCash).toFixed(2));
      if (Math.abs(cashDiff) > 0.01 && parsed.data.notes.trim().length < 3) {
        throw new Error('CASH_VARIANCE_NOTE_REQUIRED');
      }

      const { available: availableBread, expectedClosing: expectedClosingBread } =
        computeBreadBalance(sh);
      const breadDifference = parsed.data.closingBread - expectedClosingBread;
      const receiverName = parsed.data.receivedByName?.trim() || 'إدارة المخبز';
      const now = new Date();

      const [updatedShift] = await tx
        .update(shifts)
        .set({
          status: 'مغلقة بانتظار المراجعة',
          expectedCash: expectedCash.toFixed(2),
          actualCash: parsed.data.actualCash.toFixed(2),
          cashDifference: cashDiff.toFixed(2),
          closingBread: parsed.data.closingBread,
          handoverNotes: parsed.data.notes,
          closedAt: now,
        })
        .where(eq(shifts.id, shiftId))
        .returning();

      const [handover] = await tx
        .insert(shiftHandovers)
        .values({
          shiftId,
          fromAgentId: sh.agentId ?? req.authUser!.id,
          expectedCash: expectedCash.toFixed(2),
          handedCash: parsed.data.actualCash.toFixed(2),
          cashDifference: cashDiff.toFixed(2),
          expectedBread: expectedClosingBread,
          handedBread: parsed.data.closingBread,
          breadDifference,
          receivedByName: receiverName,
          notes: parsed.data.notes || null,
          approvedByOwner: false,
          handedAt: now,
        })
        .returning();

      if (Math.abs(cashDiff) > 0.01) {
        await tx.insert(notifications).values({
          ruleCode: 'RULE_SHIFT_VARIANCE',
          severity: 'تنبيه حرج',
          title: `فارق نقدي عند إغلاق ${sh.shiftName}`,
          message: `الوكيل ${sh.agentName} أغلق الوردية بفارق ${cashDiff.toFixed(2)} ج.س (المتوقع: ${expectedCash.toFixed(2)} — الفعلي: ${parsed.data.actualCash.toFixed(2)}).`,
          timestamp: now.toISOString().slice(0, 16).replace('T', ' '),
          isRead: false,
          targetNav: 'agents-shifts',
        });
      }

      await recordAuditLog(tx, {
        userId: req.authUser!.id,
        userName: req.authUser!.fullName,
        role: req.authUser!.role,
        operationType: 'إغلاق وردية وتسليم عهدة',
        entityType: 'shifts',
        entityId: String(shiftId),
        affectedRecord: `${sh.shiftName} — ${sh.agentName}`,
        newValue: `المتوقع: ${expectedCash} · المسلم: ${parsed.data.actualCash} · الفارق: ${cashDiff} · المستلم: ${receiverName}`,
      });

      return {
        shift: mapShift(updatedShift),
        handoverId: String(handover.id),
        report: {
          shiftId: String(updatedShift.id),
          shiftName: updatedShift.shiftName,
          date: updatedShift.date,
          agentName: updatedShift.agentName,
          totalProduction: updatedShift.producedBread,
          cashSalesAmount: Number(updatedShift.cashSalesAmount),
          creditSalesAmount: Number(updatedShift.creditSalesAmount),
          totalSalesAmount: Number(
            (Number(updatedShift.cashSalesAmount) + Number(updatedShift.creditSalesAmount)).toFixed(2)
          ),
          totalExpenses: Number(updatedShift.totalExpenses),
          openingCash: Number(updatedShift.openingCash),
          expectedCash,
          actualCash: parsed.data.actualCash,
          cashDifference: cashDiff,
          openingBread: updatedShift.openingBread,
          returnedBread: updatedShift.returnedBread,
          availableBread,
          soldBread: updatedShift.soldBread,
          damagedBread: updatedShift.damagedBread,
          authorizedAdjustments: updatedShift.authorizedAdjustments ?? 0,
          expectedClosingBread,
          actualClosingBread: parsed.data.closingBread,
          breadDifference,
          receivedByName: receiverName,
          handedAt: now.toISOString(),
        },
      };
    });

    return res.json({ ok: true, ...result });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : '';
    if (msg === 'SHIFT_NOT_FOUND') {
      return res.status(404).json({ error: 'الوردية غير موجودة.' });
    }
    if (msg === 'SHIFT_FORBIDDEN') {
      return res.status(403).json({ error: 'لا يمكنك إغلاق وردية وكيل آخر.' });
    }
    if (msg === 'INVALID_SHIFT_STATUS') {
      return res.status(400).json({ error: 'هذه الوردية مغلقة بالفعل.' });
    }
    if (msg === 'MISSING_REQUIRED_RECORDS') {
      return res.status(400).json({
        error: 'لا يمكن إغلاق الوردية قبل تسجيل بيانات الإنتاج أو المبيعات المطلوبة خلال الوردية.',
      });
    }
    if (msg === 'CASH_VARIANCE_NOTE_REQUIRED') {
      return res.status(400).json({
        error: 'يوجد فارق بين النقدية المتوقعة والفعلية؛ يرجى كتابة سبب الفارق في ملاحظات التسليم.',
      });
    }
    console.error('Close shift error:', error);
    return res.status(400).json({ error: 'تعذر إغلاق الوردية.' });
  }
});

// Final Shift Report endpoint
router.get('/shifts/:id/report', async (req: AuthRequest, res) => {
  try {
    const shiftId = Number(req.params.id);
    if (!Number.isInteger(shiftId)) {
      return res.status(400).json({ error: 'معرف الوردية غير صالح.' });
    }

    const [sh] = await db.select().from(shifts).where(eq(shifts.id, shiftId)).limit(1);
    if (!sh) return res.status(404).json({ error: 'الوردية غير موجودة.' });

    if (req.authUser!.role === 'AGENT' && sh.agentId !== req.authUser!.id) {
      return res.status(403).json({ error: 'غير مصرح لك بالاطلاع على تقرير وردية وكيل آخر.' });
    }

    const [prodRows, saleRows, breadMovRows, expRows, handoverRows] = await Promise.all([
      db.select().from(productionRecords).where(eq(productionRecords.shiftId, shiftId)),
      db.select().from(sales).where(eq(sales.shiftId, shiftId)),
      db.select().from(breadMovements).where(eq(breadMovements.shiftId, shiftId)),
      db.select().from(expenses).where(eq(expenses.shiftId, shiftId)),
      db.select().from(shiftHandovers).where(eq(shiftHandovers.shiftId, shiftId)),
    ]);

    const { available, expectedClosing } = computeBreadBalance(sh);
    const ho = handoverRows[0];

    return res.json({
      shift: mapShift(sh),
      breadReconciliation: {
        openingBread: sh.openingBread,
        producedBread: sh.producedBread,
        returnedBread: sh.returnedBread,
        availableBread: available,
        soldBread: sh.soldBread,
        damagedBread: sh.damagedBread,
        authorizedAdjustments: sh.authorizedAdjustments ?? 0,
        expectedClosingBread: expectedClosing,
        actualClosingBread: sh.closingBread ?? expectedClosing,
        breadDifference:
          sh.closingBread !== null ? sh.closingBread - expectedClosing : 0,
      },
      handover: ho
        ? {
            id: String(ho.id),
            expectedCash: Number(ho.expectedCash),
            handedCash: Number(ho.handedCash),
            cashDifference: Number(ho.cashDifference),
            expectedBread: ho.expectedBread,
            handedBread: ho.handedBread,
            breadDifference: ho.breadDifference,
            receivedByName: ho.receivedByName,
            approvedByOwner: ho.approvedByOwner,
            approvedByName: ho.approvedByName ?? undefined,
            handedAt: ho.handedAt.toISOString(),
            approvedAt: ho.approvedAt ? ho.approvedAt.toISOString() : undefined,
            notes: ho.notes ?? undefined,
          }
        : null,
      productionBatches: prodRows.map((p) => ({
        id: String(p.id),
        reference: p.reference,
        breadType: p.breadType,
        producedLoaves: p.producedLoaves,
        damagedLoaves: p.damagedLoaves,
        flourConsumedBags: Number(p.flourConsumedBags),
      })),
      sales: saleRows.map((s) => ({
        id: String(s.id),
        reference: s.reference,
        breadType: s.breadType,
        quantity: s.quantity,
        totalAmount: Number(s.totalAmount),
        paymentType: s.paymentType,
        customerName: s.customerName ?? undefined,
      })),
      breadMovements: breadMovRows.map(mapBreadMovement),
      expenses: expRows.map((e) => ({
        id: String(e.id),
        reference: e.reference,
        category: e.category,
        description: e.description,
        amount: Number(e.amount),
      })),
    });
  } catch (error) {
    console.error('Shift report error:', error);
    return res.status(500).json({ error: 'تعذر تحميل تقرير الوردية.' });
  }
});

router.post('/shifts/:id/approve', requireRole('OWNER'), async (req: AuthRequest, res) => {
  try {
    const shiftId = Number(req.params.id);
    if (!Number.isInteger(shiftId)) return res.status(400).json({ error: 'معرف الوردية غير صالح.' });

    await db.transaction(async (tx) => {
      await confirmShiftAndHandover(
        tx,
        shiftId,
        req.authUser!,
        req.body?.receivedByName,
        req.body?.notes
      );
    });
    return res.json({ ok: true });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : '';
    if (msg === 'SHIFT_NOT_FOUND') return res.status(404).json({ error: 'الوردية غير موجودة.' });
    if (msg === 'SHIFT_STILL_OPEN') {
      return res.status(400).json({ error: 'لا يمكن اعتماد وردية ما زالت مفتوحة.' });
    }
    return res.status(500).json({ error: 'تعذر اعتماد الوردية.' });
  }
});

router.post('/handovers/:id/confirm', requireRole('OWNER'), async (req: AuthRequest, res) => {
  try {
    const handoverId = Number(req.params.id);
    if (!Number.isInteger(handoverId)) {
      return res.status(400).json({ error: 'معرف التسليم غير صالح.' });
    }

    await db.transaction(async (tx) => {
      const [ho] = await tx
        .select()
        .from(shiftHandovers)
        .where(eq(shiftHandovers.id, handoverId))
        .limit(1);
      if (!ho) throw new Error('HANDOVER_NOT_FOUND');

      await confirmShiftAndHandover(
        tx,
        ho.shiftId,
        req.authUser!,
        req.body?.receivedByName,
        req.body?.notes
      );
    });

    return res.json({ ok: true });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : '';
    if (msg === 'HANDOVER_NOT_FOUND') {
      return res.status(404).json({ error: 'سجل التسليم غير موجود.' });
    }
    return res.status(500).json({ error: 'تعذر اعتماد تسليم العهدة.' });
  }
});

export default router;
