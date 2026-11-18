import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { db } from '../../db/index.ts';
import {
  cashTransactions,
  inventoryBatches,
  inventoryItems,
  notifications,
  shiftHandovers,
  shifts,
  stockMovements,
  type breadMovements,
} from '../../db/schema.ts';
import { type AuthRequest } from '../../middleware/auth.ts';
import { generateReference, recordAuditLog } from '../audit.ts';

export const ALLOWED_ATTACHMENT_MIMES = [
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'application/pdf',
  'text/plain',
] as const;

export const ALLOWED_AVATAR_MIMES = [
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
] as const;

export const VALID_SHIFTS = [
  'الوردية الصباحية',
  'الوردية المسائية',
  'الوردية الليلية',
] as const;

export const VALID_PERMISSIONS = [
  'PRODUCTION_LOG',
  'SALES_LOG',
  'EXPENSES_LOG',
  'SHIFT_MANAGE',
] as const;

export type TxType = Parameters<Parameters<typeof db.transaction>[0]>[0];

// Helper: Deduct quantity from inventory item & its active batches (FEFO)
export async function deductInventoryFefo(
  tx: TxType,
  params: {
    item: typeof inventoryItems.$inferSelect;
    qty: number;
    date: string;
    userId: number;
    userName: string;
    notes: string;
    allowNegative: boolean;
  }
) {
  const { item, qty, date, userId, userName, notes, allowNegative } = params;
  const avail = Number(item.availableQuantity);
  if (!allowNegative && avail < qty) {
    throw new Error(`LOW_STOCK:${item.name}:${avail}:${item.unit}`);
  }

  const nextQty = Number((avail - qty).toFixed(3));
  await tx
    .update(inventoryItems)
    .set({ availableQuantity: nextQty.toFixed(3), lastUpdated: date })
    .where(eq(inventoryItems.id, item.id));

  // Deduct from batches FEFO (earliest expiry first, then oldest)
  let toDeduct = qty;
  const activeBatches = await tx
    .select()
    .from(inventoryBatches)
    .where(eq(inventoryBatches.inventoryItemId, item.id))
    .orderBy(asc(inventoryBatches.expiryDate), asc(inventoryBatches.id));

  for (const batch of activeBatches) {
    if (toDeduct <= 0) break;
    const rem = Number(batch.quantityRemaining);
    if (rem <= 0) continue;
    const used = Math.min(rem, toDeduct);
    await tx
      .update(inventoryBatches)
      .set({ quantityRemaining: Number((rem - used).toFixed(3)).toFixed(3) })
      .where(eq(inventoryBatches.id, batch.id));
    toDeduct = Number((toDeduct - used).toFixed(3));
  }

  await tx.insert(stockMovements).values({
    reference: generateReference('STK'),
    inventoryItemId: item.id,
    itemName: item.name,
    type: 'استهلاك إنتاج',
    quantityDelta: (-qty).toFixed(3),
    unit: item.unit,
    balanceAfter: nextQty.toFixed(3),
    date,
    performedByUserId: userId,
    performedBy: userName,
    notes,
  });

  if (nextQty <= Number(item.minimumStock)) {
    await tx.insert(notifications).values({
      ruleCode: `RULE_LOW_STOCK_${item.sku}`,
      severity: 'تحذير',
      title: `انخفاض رصيد ${item.name}`,
      message: `الرصيد بعد الإنتاج: ${nextQty} ${item.unit} (الحد الأدنى: ${Number(item.minimumStock)} ${item.unit})`,
      timestamp: new Date().toISOString().slice(0, 16).replace('T', ' '),
      isRead: false,
      targetNav: 'inventory',
    });
  }

  return nextQty;
}

// Helper: Resolve shift for operational transaction
export async function resolveOperationalShift(
  tx: TxType,
  user: NonNullable<AuthRequest['authUser']>,
  requestedShiftId?: number
): Promise<typeof shifts.$inferSelect | null> {
  if (requestedShiftId) {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${500000 + requestedShiftId})`);
    const [sh] = await tx.select().from(shifts).where(eq(shifts.id, requestedShiftId)).limit(1);
    if (!sh) throw new Error('SHIFT_NOT_FOUND');
    if (user.role === 'AGENT' && sh.agentId !== user.id) {
      throw new Error('SHIFT_FORBIDDEN');
    }
    if (sh.status !== 'مفتوحة') {
      throw new Error('SHIFT_NOT_OPEN');
    }
    return sh;
  }

  if (user.role === 'AGENT') {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${550000 + user.id})`);
    const [agentShift] = await tx
      .select()
      .from(shifts)
      .where(and(eq(shifts.agentId, user.id), eq(shifts.status, 'مفتوحة')))
      .orderBy(desc(shifts.id))
      .limit(1);
    if (!agentShift) {
      throw new Error('AGENT_NO_OPEN_SHIFT');
    }
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${500000 + agentShift.id})`);
    const [lockedShift] = await tx
      .select()
      .from(shifts)
      .where(eq(shifts.id, agentShift.id))
      .limit(1);
    return lockedShift ?? agentShift;
  }

  // OWNER may attach to an existing open shift or operate standalone
  const [anyOpen] = await tx
    .select()
    .from(shifts)
    .where(eq(shifts.status, 'مفتوحة'))
    .orderBy(desc(shifts.id))
    .limit(1);
  if (!anyOpen) return null;
  await tx.execute(sql`SELECT pg_advisory_xact_lock(${500000 + anyOpen.id})`);
  const [lockedOpen] = await tx
    .select()
    .from(shifts)
    .where(and(eq(shifts.id, anyOpen.id), eq(shifts.status, 'مفتوحة')))
    .limit(1);
  return lockedOpen ?? null;
}

export function computeBreadBalance(sh: typeof shifts.$inferSelect) {
  const available = sh.openingBread + sh.producedBread + sh.returnedBread;
  const expectedClosing =
    available - sh.soldBread - sh.damagedBread - (sh.authorizedAdjustments ?? 0);
  return { available, expectedClosing };
}

export function mapShift(s: typeof shifts.$inferSelect) {
  return {
    id: String(s.id),
    shiftName: s.shiftName,
    date: s.date,
    agentId: s.agentId ? String(s.agentId) : '',
    agentName: s.agentName,
    status: s.status,
    openingCash: Number(s.openingCash),
    openingBread: s.openingBread,
    producedBread: s.producedBread,
    returnedBread: s.returnedBread,
    soldBread: s.soldBread,
    damagedBread: s.damagedBread,
    authorizedAdjustments: s.authorizedAdjustments ?? 0,
    cashSalesAmount: Number(s.cashSalesAmount),
    creditSalesAmount: Number(s.creditSalesAmount),
    totalExpenses: Number(s.totalExpenses),
    expectedCash: Number(s.expectedCash),
    actualCash: s.actualCash !== null ? Number(s.actualCash) : undefined,
    cashDifference: s.cashDifference !== null ? Number(s.cashDifference) : undefined,
    closingBread: s.closingBread ?? undefined,
    handoverNotes: s.handoverNotes ?? undefined,
    openedAt: s.openedAt ? s.openedAt.toISOString() : undefined,
    closedAt: s.closedAt ? s.closedAt.toISOString() : undefined,
  };
}

export function mapBreadMovement(b: typeof breadMovements.$inferSelect) {
  return {
    id: String(b.id),
    reference: b.reference,
    date: b.date,
    shiftId: b.shiftId ? String(b.shiftId) : undefined,
    shiftName: b.shiftName,
    agentId: b.agentId ? String(b.agentId) : '',
    agentName: b.agentName,
    breadType: b.breadType,
    type: b.type as 'مرتجع' | 'تالف' | 'تعديل معتمد',
    quantity: b.quantity,
    reason: b.reason,
  };
}

// Approve Closed Shift & Handover (OWNER ONLY)
export async function confirmShiftAndHandover(
  tx: TxType,
  shiftId: number,
  owner: NonNullable<AuthRequest['authUser']>,
  receivedByName?: string,
  notes?: string
) {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(${500000 + shiftId})`);
  const [sh] = await tx.select().from(shifts).where(eq(shifts.id, shiftId)).limit(1);
  if (!sh) throw new Error('SHIFT_NOT_FOUND');
  if (sh.status === 'مفتوحة') throw new Error('SHIFT_STILL_OPEN');

  const now = new Date();
  await tx.update(shifts).set({ status: 'معتمدة' }).where(eq(shifts.id, shiftId));

  const existingHandovers = await tx
    .select()
    .from(shiftHandovers)
    .where(eq(shiftHandovers.shiftId, shiftId));

  const receiver = receivedByName?.trim() || owner.fullName;

  if (existingHandovers.length > 0) {
    await tx
      .update(shiftHandovers)
      .set({
        approvedByOwner: true,
        approvedByUserId: owner.id,
        approvedByName: owner.fullName,
        receivedByUserId: owner.id,
        receivedByName: receiver,
        approvedAt: now,
        ...(notes ? { notes } : {}),
      })
      .where(eq(shiftHandovers.shiftId, shiftId));
  } else {
    const { expectedClosing } = computeBreadBalance(sh);
    await tx.insert(shiftHandovers).values({
      shiftId,
      fromAgentId: sh.agentId,
      expectedCash: sh.expectedCash,
      handedCash: sh.actualCash ?? sh.expectedCash,
      cashDifference: sh.cashDifference ?? '0.00',
      expectedBread: expectedClosing,
      handedBread: sh.closingBread ?? expectedClosing,
      breadDifference:
        sh.closingBread !== null ? sh.closingBread - expectedClosing : 0,
      receivedByUserId: owner.id,
      receivedByName: receiver,
      approvedByOwner: true,
      approvedByUserId: owner.id,
      approvedByName: owner.fullName,
      handedAt: sh.closedAt ?? now,
      approvedAt: now,
      notes: notes ?? sh.handoverNotes ?? null,
    });
  }

  // Record any cash handover variance settlement once upon owner approval
  const cashDiff = Number(sh.cashDifference ?? 0);
  if (Math.abs(cashDiff) > 0.01) {
    const handoverRef = `HND-SH-${shiftId}`;
    const [existingCashHnd] = await tx
      .select()
      .from(cashTransactions)
      .where(eq(cashTransactions.reference, handoverRef))
      .limit(1);
    if (!existingCashHnd) {
      await tx.insert(cashTransactions).values({
        reference: handoverRef,
        type: 'تسوية عهدة وردية',
        category: 'تسليم وردية',
        direction: cashDiff > 0 ? 'IN' : 'OUT',
        amount: Math.abs(cashDiff).toFixed(2),
        date: sh.date,
        paymentMethod: 'نقداً',
        relatedEntity: `${sh.shiftName} — ${sh.agentName} (${cashDiff > 0 ? 'فائض' : 'عجز'} تسليم)`,
        notes: notes ?? sh.handoverNotes ?? null,
        shiftId,
        recordedByUserId: owner.id,
        recordedBy: owner.fullName,
      });
    }
  }

  await recordAuditLog(tx, {
    userId: owner.id,
    userName: owner.fullName,
    role: 'OWNER',
    operationType: 'اعتماد إغلاق وردية واستلام العهدة',
    entityType: 'shifts',
    entityId: String(shiftId),
    affectedRecord: `${sh.shiftName} (${sh.agentName})`,
    previousValue: sh.status,
    newValue: `معتمدة · المستلم: ${receiver} · الفارق: ${sh.cashDifference ?? '0.00'} ج.س`,
  });
}
