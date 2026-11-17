import { Router } from 'express';
import { and, asc, desc, eq, gt, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../../db/index.ts';
import { ensureSeeded } from '../../db/seed.ts';
import {
  auditLogs,
  bakerySettings,
  breadMovements,
  cashTransactions,
  customerAdjustments,
  customerPayments,
  customers,
  employeeAttendance,
  employees,
  expenses,
  inventoryBatches,
  inventoryItems,
  notifications,
  payroll,
  productionIngredients,
  productionRecipes,
  productionRecords,
  purchaseInvoiceItems,
  purchaseInvoices,
  roles,
  saleItems,
  sales,
  shiftHandovers,
  shifts,
  stockMovements,
  supplierPayments,
  suppliers,
  users,
  userSessions,
} from '../../db/schema.ts';
import {
  type AuthRequest,
  DEFAULT_AGENT_PERMISSIONS,
  requireAuth,
  requirePermission,
  requireRole,
} from '../../middleware/auth.ts';
import { generateReference, recordAuditLog } from '../audit.ts';
import { hashPassword, isValidSafeDataUri } from '../security.ts';

const ALLOWED_ATTACHMENT_MIMES = [
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'application/pdf',
  'text/plain',
] as const;

const ALLOWED_AVATAR_MIMES = [
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
] as const;

const router = Router();
router.use(requireAuth);

const VALID_SHIFTS = ['الوردية الصباحية', 'الوردية المسائية', 'الوردية الليلية'] as const;
const VALID_PERMISSIONS = [
  'PRODUCTION_LOG',
  'SALES_LOG',
  'EXPENSES_LOG',
  'SHIFT_MANAGE',
] as const;

type TxType = Parameters<Parameters<typeof db.transaction>[0]>[0];

// Helper: Deduct quantity from inventory item & its active batches (FEFO)
async function deductInventoryFefo(
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
async function resolveOperationalShift(
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

function computeBreadBalance(sh: typeof shifts.$inferSelect) {
  const available = sh.openingBread + sh.producedBread + sh.returnedBread;
  const expectedClosing =
    available - sh.soldBread - sh.damagedBread - (sh.authorizedAdjustments ?? 0);
  return { available, expectedClosing };
}

function mapShift(s: typeof shifts.$inferSelect) {
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

function mapBreadMovement(b: typeof breadMovements.$inferSelect) {
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

router.get('/workspace/bootstrap', async (req: AuthRequest, res) => {
  try {
    await ensureSeeded();
    const isOwner = req.authUser!.role === 'OWNER';
    const uid = req.authUser!.id;

    const [settingsRow] = await db.select().from(bakerySettings).limit(1);
    const recipeRows = await db.select().from(productionRecipes).orderBy(productionRecipes.id);
    const customerRows = await db.select().from(customers).orderBy(customers.id);
    const inventoryRows = await db.select().from(inventoryItems).orderBy(inventoryItems.id);

    const allShifts = await db.select().from(shifts).orderBy(desc(shifts.id));
    const allProd = await db.select().from(productionRecords).orderBy(desc(productionRecords.id));
    const allSales = await db.select().from(sales).orderBy(desc(sales.id));
    const allBreadMov = await db.select().from(breadMovements).orderBy(desc(breadMovements.id));
    const allExpenses = await db.select().from(expenses).orderBy(desc(expenses.id));
    const allHandovers = await db.select().from(shiftHandovers).orderBy(desc(shiftHandovers.id));
    const allUsers = await db.select().from(users);

    const userById = new Map(allUsers.map((u) => [u.id, u]));
    const shiftById = new Map(allShifts.map((s) => [s.id, s]));

    const mapSettings = settingsRow
      ? {
          bakeryName: settingsRow.bakeryName,
          city: settingsRow.city,
          address: settingsRow.address,
          phone: settingsRow.phone,
          currencySymbol: settingsRow.currencySymbol,
          allowNegativeInventory: settingsRow.allowNegativeInventory,
          standardLoafPrice: Number(settingsRow.standardLoafPrice),
        }
      : null;

    const mapRecipes = recipeRows.map((r) => ({
      id: String(r.id),
      breadType: r.breadType,
      expectedYieldLoaves: r.expectedYieldLoaves,
      unitSellingPrice: Number(r.unitSellingPrice),
      flourBags: Number(r.flourBags),
      oilLiters: Number(r.oilLiters),
      yeastGrams: Number(r.yeastGrams),
      saltGrams: Number(r.saltGrams),
      sugarGrams: Number(r.sugarGrams),
      otherIngredients: Array.isArray(r.otherIngredients) ? r.otherIngredients : [],
      isActive: r.isActive,
      notes: r.notes ?? undefined,
    }));

    const rawMaterials = inventoryRows.map((i) => ({
      id: String(i.id),
      sku: i.sku,
      name: i.name,
      unit: i.unit,
      availableQuantity: Number(i.availableQuantity),
    }));

    const mapProd = (p: typeof productionRecords.$inferSelect) => ({
      id: String(p.id),
      reference: p.reference,
      date: p.date,
      shiftId: p.shiftId ? String(p.shiftId) : undefined,
      shiftName: p.shiftName,
      agentId: p.agentId ? String(p.agentId) : '',
      agentName: p.agentName,
      recipeId: p.recipeId ? String(p.recipeId) : '',
      breadType: p.breadType,
      flourConsumedBags: Number(p.flourConsumedBags),
      oilConsumedLiters: Number(p.oilConsumedLiters),
      yeastConsumedGrams: Number(p.yeastConsumedGrams),
      saltConsumedGrams: Number(p.saltConsumedGrams),
      sugarConsumedGrams: Number(p.sugarConsumedGrams),
      otherIngredientsSummary: p.otherIngredientsSummary ?? undefined,
      producedLoaves: p.producedLoaves,
      damagedLoaves: p.damagedLoaves,
      notes: p.notes ?? undefined,
    });

    const mapSale = (s: typeof sales.$inferSelect) => ({
      id: String(s.id),
      reference: s.reference,
      date: s.date,
      shiftId: s.shiftId ? String(s.shiftId) : undefined,
      shiftName: s.shiftName,
      agentId: s.agentId ? String(s.agentId) : '',
      agentName: s.agentName,
      breadType: s.breadType,
      quantity: s.quantity,
      returnedQuantity: s.returnedQuantity,
      unitPrice: Number(s.unitPrice),
      totalAmount: Number(s.totalAmount),
      paymentType: s.paymentType,
      customerId: s.customerId ? String(s.customerId) : undefined,
      customerName: s.customerName ?? undefined,
      notes: s.notes ?? undefined,
    });

    const mapExpense = (e: typeof expenses.$inferSelect) => ({
      id: String(e.id),
      reference: e.reference,
      date: e.date,
      category: e.category,
      amount: Number(e.amount),
      description: e.description,
      paymentMethod: e.paymentMethod,
      responsibleUser: e.responsibleUser,
      shiftId: e.shiftId ? String(e.shiftId) : undefined,
      attachmentName: e.attachmentName ?? undefined,
      attachmentData: e.attachmentData ?? undefined,
      status: e.status,
      isReversal: e.isReversal,
      reversedExpenseId: e.reversedExpenseId ? String(e.reversedExpenseId) : undefined,
    });

    const mapHandover = (h: typeof shiftHandovers.$inferSelect) => {
      const sh = shiftById.get(h.shiftId);
      const agent = h.fromAgentId ? userById.get(h.fromAgentId) : undefined;
      return {
        id: String(h.id),
        shiftId: String(h.shiftId),
        shiftName: sh?.shiftName || '',
        shiftDate: sh?.date || '',
        fromAgentId: h.fromAgentId ? String(h.fromAgentId) : '',
        agentName: agent?.fullName || sh?.agentName || '',
        expectedCash: Number(h.expectedCash),
        handedCash: Number(h.handedCash),
        cashDifference: Number(h.cashDifference),
        expectedBread: h.expectedBread,
        handedBread: h.handedBread,
        breadDifference: h.breadDifference,
        receivedByName: h.receivedByName,
        notes: h.notes ?? undefined,
        approvedByOwner: h.approvedByOwner,
        approvedByName: h.approvedByName ?? undefined,
        handedAt: h.handedAt.toISOString(),
        approvedAt: h.approvedAt ? h.approvedAt.toISOString() : undefined,
      };
    };

    // Strict RBAC filtering for AGENT vs OWNER
    if (!isOwner) {
      return res.json({
        settings: mapSettings,
        recipes: mapRecipes,
        rawMaterials,
        customers: customerRows.map((c) => ({
          id: String(c.id),
          name: c.name,
          phone: '',
          address: '',
          creditLimit: 0,
          totalCreditSales: 0,
          totalPayments: 0,
          outstandingBalance: 0,
          lastActivityDate: '',
        })),
        shifts: allShifts.filter((s) => s.agentId === uid).map(mapShift),
        handovers: allHandovers.filter((h) => h.fromAgentId === uid).map(mapHandover),
        productionRecords: allProd.filter((p) => p.agentId === uid).map(mapProd),
        sales: allSales.filter((s) => s.agentId === uid).map(mapSale),
        breadMovements: allBreadMov.filter((b) => b.agentId === uid).map(mapBreadMovement),
        expenses: allExpenses.filter((e) => e.responsibleUserId === uid).map(mapExpense),
        suppliers: [],
        invoices: [],
        payments: [],
        inventory: [],
        batches: [],
        movements: [],
        agents: [],
        employees: [],
        cashTransactions: [],
        customerPayments: [],
        customerAdjustments: [],
        payrollRecords: [],
        employeeAttendance: [],
        notifications: [],
        auditLogs: [],
      });
    }

    const supplierRows = await db.select().from(suppliers).orderBy(desc(suppliers.id));
    const invRows = await db.select().from(purchaseInvoices).orderBy(desc(purchaseInvoices.id));
    const invItemRows = await db.select().from(purchaseInvoiceItems);
    const payRows = await db.select().from(supplierPayments).orderBy(desc(supplierPayments.id));
    const batchRows = await db
      .select()
      .from(inventoryBatches)
      .where(gt(inventoryBatches.quantityRemaining, '0'))
      .orderBy(asc(inventoryBatches.expiryDate), asc(inventoryBatches.id));
    const movementRows = await db.select().from(stockMovements).orderBy(desc(stockMovements.id)).limit(200);
    const agentUsers = allUsers.filter((u) => u.roleCode === 'AGENT');
    const employeeRows = await db.select().from(employees).orderBy(employees.id);
    const cashTxRows = await db.select().from(cashTransactions).orderBy(desc(cashTransactions.id));
    const custPayRows = await db.select().from(customerPayments).orderBy(desc(customerPayments.id));
    const custAdjRows = await db.select().from(customerAdjustments).orderBy(desc(customerAdjustments.id));
    const payrollRows = await db.select().from(payroll).orderBy(desc(payroll.id));
    const empAttRows = await db.select().from(employeeAttendance).orderBy(desc(employeeAttendance.date));
    const notifRows = await db.select().from(notifications).orderBy(desc(notifications.id));
    const auditRows = await db.select().from(auditLogs).orderBy(desc(auditLogs.id)).limit(100);

    const supNameById = new Map(supplierRows.map((s) => [s.id, s.name]));
    const invNumById = new Map(invRows.map((i) => [i.id, i.invoiceNumber]));
    const invItemMap = new Map(inventoryRows.map((it) => [it.id, it]));
    const todayStr = new Date().toISOString().slice(0, 10);

    return res.json({
      settings: mapSettings,
      suppliers: supplierRows.map((s) => ({
        id: String(s.id),
        code: s.code,
        name: s.name,
        phone: s.phone,
        address: s.address,
        categories: s.categories || [],
        totalPurchases: Number(s.totalPurchases),
        totalPayments: Number(s.totalPayments),
        adjustments: Number(s.adjustments),
        status: s.status,
        lastTransactionDate: s.lastTransactionDate,
        notes: s.notes ?? undefined,
      })),
      invoices: invRows.map((inv) => ({
        id: String(inv.id),
        invoiceNumber: inv.invoiceNumber,
        supplierId: String(inv.supplierId),
        supplierName: supNameById.get(inv.supplierId) || '',
        date: inv.date,
        items: invItemRows
          .filter((it) => it.invoiceId === inv.id)
          .map((it) => ({
            inventoryItemId: String(it.inventoryItemId),
            itemName: it.itemName,
            quantity: Number(it.quantity),
            unit: it.unit,
            unitPrice: Number(it.unitPrice),
            total: Number(it.total),
            batchCode: it.batchCode ?? undefined,
            expiryDate: it.expiryDate ?? undefined,
          })),
        totalAmount: Number(inv.totalAmount),
        initialPayment: Number(inv.initialPayment),
        initialPaymentMethod: inv.initialPaymentMethod,
        paidAmount: Number(inv.paidAmount),
        remainingBalance: Number(inv.remainingBalance),
        status: inv.status,
        workflowStatus: inv.workflowStatus,
        cancelledReason: inv.cancelledReason ?? undefined,
        notes: inv.notes ?? undefined,
        createdBy: inv.createdBy,
      })),
      payments: payRows.map((p) => ({
        id: String(p.id),
        reference: p.reference,
        supplierId: String(p.supplierId),
        invoiceId: p.invoiceId ? String(p.invoiceId) : undefined,
        invoiceNumber: p.invoiceId ? invNumById.get(p.invoiceId) : undefined,
        date: p.date,
        amount: Number(p.amount),
        method: p.method,
        notes: p.notes ?? undefined,
        recordedBy: p.recordedBy,
        isReversal: p.isReversal,
      })),
      inventory: inventoryRows.map((i) => ({
        id: String(i.id),
        sku: i.sku,
        name: i.name,
        category: i.category,
        unit: i.unit,
        availableQuantity: Number(i.availableQuantity),
        averageCost: Number(i.averageCost),
        minimumStock: Number(i.minimumStock),
        primarySupplierId: i.primarySupplierId ? String(i.primarySupplierId) : '',
        primarySupplierName: i.primarySupplierName,
        batchCode: i.batchCode,
        expiryDate: i.expiryDate ?? undefined,
        lastUpdated: i.lastUpdated,
      })),
      rawMaterials,
      batches: batchRows.map((b) => {
        const it = invItemMap.get(b.inventoryItemId);
        return {
          id: String(b.id),
          inventoryItemId: String(b.inventoryItemId),
          itemName: it?.name ?? '',
          unit: it?.unit ?? 'جوال',
          batchCode: b.batchCode,
          quantityRemaining: Number(b.quantityRemaining),
          unitCost: Number(b.unitCost),
          expiryDate: b.expiryDate ?? undefined,
          receivedDate: b.receivedDate,
        };
      }),
      movements: movementRows.map((m) => ({
        id: String(m.id),
        reference: m.reference,
        inventoryItemId: String(m.inventoryItemId),
        itemName: m.itemName,
        type: m.type,
        quantityDelta: Number(m.quantityDelta),
        unit: m.unit,
        balanceAfter: Number(m.balanceAfter),
        batchCode: m.batchCode ?? undefined,
        expiryDate: m.expiryDate ?? undefined,
        relatedSupplierId: m.relatedSupplierId ? String(m.relatedSupplierId) : undefined,
        date: m.date,
        performedBy: m.performedBy,
        notes: m.notes ?? undefined,
      })),
      recipes: mapRecipes,
      productionRecords: allProd.map(mapProd),
      sales: allSales.map(mapSale),
      breadMovements: allBreadMov.map(mapBreadMovement),
      expenses: allExpenses.map(mapExpense),
      customers: customerRows.map((c) => ({
        id: String(c.id),
        name: c.name,
        phone: c.phone,
        address: c.address,
        creditLimit: Number(c.creditLimit),
        totalCreditSales: Number(c.totalCreditSales),
        totalPayments: Number(c.totalPayments),
        adjustments: Number(c.adjustments),
        outstandingBalance: Number(
          (Number(c.totalCreditSales) - Number(c.totalPayments) + Number(c.adjustments)).toFixed(2)
        ),
        status: c.status,
        notes: c.notes ?? undefined,
        lastActivityDate: c.lastActivityDate,
      })),
      agents: agentUsers.map((ag) => {
        const agProds = allProd.filter((p) => p.agentId === ag.id);
        const agTodayProd = agProds
          .filter((p) => p.date === todayStr)
          .reduce((a, p) => a + p.producedLoaves, 0);
        const agTotalProd = agProds.reduce((a, p) => a + p.producedLoaves, 0);
        const agDamagedFromProd = agProds.reduce((a, p) => a + p.damagedLoaves, 0);
        const agDamagedFromMov = allBreadMov
          .filter((b) => b.agentId === ag.id && b.type === 'تالف')
          .reduce((a, b) => a + b.quantity, 0);
        const agTotalDamaged = agDamagedFromProd + agDamagedFromMov;

        const agSalesRows = allSales.filter((s) => s.agentId === ag.id);
        const agTodaySales = agSalesRows
          .filter((s) => s.date === todayStr)
          .reduce((a, s) => a + Number(s.totalAmount), 0);
        const agTotalSales = agSalesRows.reduce((a, s) => a + Number(s.totalAmount), 0);
        const agCashSales = agSalesRows
          .filter((s) => s.paymentType === 'نقدي')
          .reduce((a, s) => a + Number(s.totalAmount), 0);
        const agCreditSales = agSalesRows
          .filter((s) => s.paymentType === 'آجل')
          .reduce((a, s) => a + Number(s.totalAmount), 0);

        const agShifts = allShifts.filter((s) => s.agentId === ag.id);
        const closedShifts = agShifts.filter((s) => s.status !== 'مفتوحة');
        const expectedSum = closedShifts.reduce((a, s) => a + Math.max(0, Number(s.expectedCash)), 0);
        const absDiffSum = closedShifts.reduce(
          (a, s) => a + Math.abs(Number(s.cashDifference ?? 0)),
          0
        );
        const totalCashDiff = closedShifts.reduce(
          (a, s) => a + Number(s.cashDifference ?? 0),
          0
        );
        const cashAccuracyRate =
          expectedSum > 0
            ? Number(Math.max(0, 100 - Math.min(100, (absDiffSum / expectedSum) * 100)).toFixed(1))
            : 100;

        return {
          id: String(ag.id),
          fullName: ag.fullName,
          username: ag.username,
          phone: ag.phone,
          avatarUrl: ag.avatarUrl ?? undefined,
          assignedShift: (ag.assignedShift || 'الوردية الصباحية') as
            | 'الوردية الصباحية'
            | 'الوردية المسائية'
            | 'الوردية الليلية',
          status: ag.isActive ? 'نشط' : 'موقوف',
          permissions: Array.isArray(ag.permissions)
            ? ag.permissions
            : [...DEFAULT_AGENT_PERMISSIONS],
          todayProduction: agTodayProd > 0 ? agTodayProd : agTotalProd,
          totalProduction: agTotalProd,
          totalDamaged: agTotalDamaged,
          todaySales: agTodaySales > 0 ? agTodaySales : agTotalSales,
          totalSales: agTotalSales,
          cashSales: agCashSales,
          creditSales: agCreditSales,
          shiftsCount: agShifts.length,
          openShiftsCount: agShifts.filter((s) => s.status === 'مفتوحة').length,
          closedShiftsCount: closedShifts.length,
          totalCashDifference: Number(totalCashDiff.toFixed(2)),
          cashAccuracyRate,
        };
      }),
      shifts: allShifts.map(mapShift),
      handovers: allHandovers.map(mapHandover),
      employees: employeeRows.map((emp) => ({
        id: String(emp.id),
        name: emp.name,
        jobTitle: emp.jobTitle,
        phone: emp.phone,
        monthlySalary: Number(emp.monthlySalary),
        shift: emp.shift,
        attendanceDays: emp.attendanceDays,
        paidThisMonth: Number(emp.paidThisMonth),
        status: emp.status,
        notes: emp.notes ?? undefined,
      })),
      cashTransactions: cashTxRows.map((c) => ({
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
      customerPayments: custPayRows.map((p) => ({
        id: String(p.id),
        reference: p.reference,
        customerId: String(p.customerId),
        amount: Number(p.amount),
        date: p.date,
        method: p.method,
        notes: p.notes ?? undefined,
        recordedBy: p.recordedBy,
        isReversal: p.isReversal,
      })),
      customerAdjustments: custAdjRows.map((a) => ({
        id: String(a.id),
        reference: a.reference,
        customerId: String(a.customerId),
        amount: Number(a.amount),
        date: a.date,
        reason: a.reason,
        recordedBy: a.recordedBy,
      })),
      payrollRecords: payrollRows.map((p) => ({
        id: String(p.id),
        reference: p.reference,
        employeeId: String(p.employeeId),
        month: p.month,
        amountPaid: Number(p.amountPaid),
        paidDate: p.paidDate,
        paymentMethod: p.paymentMethod,
        notes: p.notes ?? undefined,
        recordedBy: p.recordedBy,
        isReversal: p.isReversal,
      })),
      employeeAttendance: empAttRows.map((a) => ({
        id: String(a.id),
        employeeId: String(a.employeeId),
        date: a.date,
        status: a.status as 'حاضر' | 'غائب' | 'إجازة',
        notes: a.notes ?? undefined,
        recordedBy: a.recordedBy ?? undefined,
      })),
      notifications: notifRows.map((n) => ({
        id: String(n.id),
        ruleCode: n.ruleCode,
        severity: n.severity,
        title: n.title,
        message: n.message,
        timestamp: n.timestamp,
        isRead: n.isRead,
        targetNav: n.targetNav ?? undefined,
      })),
      auditLogs: auditRows.map((a) => ({
        id: String(a.id),
        reference: a.reference,
        userId: String(a.userId ?? ''),
        userName: a.userName,
        role: a.role,
        operationType: a.operationType,
        affectedRecord: a.affectedRecord,
        previousValue: a.previousValue ?? undefined,
        newValue: a.newValue,
        timestamp: a.timestamp,
      })),
    });
  } catch (error) {
    console.error('Bootstrap error:', error);
    return res.status(500).json({ error: 'تعذر تحميل بيانات النظام من قاعدة البيانات.' });
  }
});

// ==========================================
// 1. PRODUCTION RECIPES (OWNER ONLY)
// ==========================================
const recipeOtherIngredientSchema = z.object({
  inventoryItemId: z.coerce.number().int().positive(),
  name: z.string().trim().min(1),
  quantity: z.coerce.number().positive(),
  unit: z.string().trim().min(1),
});

const recipeCreateSchema = z.object({
  breadType: z.string().trim().min(2, 'اسم نوع الخبز مطلوب'),
  expectedYieldLoaves: z.coerce.number().int().positive('الإنتاج المتوقع يجب أن يكون أكبر من صفر'),
  unitSellingPrice: z.coerce.number().positive('سعر البيع يجب أن يكون أكبر من صفر'),
  flourBags: z.coerce.number().min(0),
  oilLiters: z.coerce.number().min(0),
  yeastGrams: z.coerce.number().min(0),
  saltGrams: z.coerce.number().min(0).default(0),
  sugarGrams: z.coerce.number().min(0).default(0),
  otherIngredients: z.array(recipeOtherIngredientSchema).default([]),
  notes: z.string().optional(),
});

router.post('/recipes', requireRole('OWNER'), async (req: AuthRequest, res) => {
  try {
    const parsed = recipeCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message || 'بيانات الوصفة غير صالحة.' });
    }
    const d = parsed.data;

    const created = await db.transaction(async (tx) => {
      const [dup] = await tx
        .select()
        .from(productionRecipes)
        .where(eq(productionRecipes.breadType, d.breadType))
        .limit(1);
      if (dup) throw new Error('DUPLICATE_RECIPE');

      const [row] = await tx
        .insert(productionRecipes)
        .values({
          breadType: d.breadType,
          expectedYieldLoaves: d.expectedYieldLoaves,
          unitSellingPrice: d.unitSellingPrice.toFixed(2),
          flourBags: d.flourBags.toFixed(2),
          oilLiters: d.oilLiters.toFixed(2),
          yeastGrams: d.yeastGrams.toFixed(2),
          saltGrams: d.saltGrams.toFixed(2),
          sugarGrams: d.sugarGrams.toFixed(2),
          otherIngredients: d.otherIngredients,
          isActive: true,
          notes: d.notes ?? null,
        })
        .returning();

      await recordAuditLog(tx, {
        userId: req.authUser!.id,
        userName: req.authUser!.fullName,
        role: 'OWNER',
        operationType: 'إنشاء وصفة إنتاج جديدة',
        entityType: 'production_recipes',
        entityId: String(row.id),
        affectedRecord: row.breadType,
        newValue: `إنتاج قياسي ${row.expectedYieldLoaves} رغيف · سعر ${d.unitSellingPrice} ج.س`,
      });

      return row;
    });

    return res.status(201).json({ id: String(created.id), breadType: created.breadType });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : '';
    if (msg === 'DUPLICATE_RECIPE') {
      return res.status(409).json({ error: 'يوجد نوع خبز مسجل بهذا الاسم مسبقاً.' });
    }
    console.error('Create recipe error:', error);
    return res.status(500).json({ error: 'تعذر إنشاء الوصفة.' });
  }
});

router.put('/recipes/:id', requireRole('OWNER'), async (req: AuthRequest, res) => {
  try {
    const id = Number(req.params.id);
    const schema = z.object({
      breadType: z.string().trim().min(2).optional(),
      expectedYieldLoaves: z.coerce.number().int().positive(),
      unitSellingPrice: z.coerce.number().positive(),
      flourBags: z.coerce.number().min(0),
      oilLiters: z.coerce.number().min(0),
      yeastGrams: z.coerce.number().min(0),
      saltGrams: z.coerce.number().min(0).default(0),
      sugarGrams: z.coerce.number().min(0).default(0),
      otherIngredients: z.array(recipeOtherIngredientSchema).optional(),
      isActive: z.boolean().optional(),
      notes: z.string().optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success || !Number.isInteger(id)) {
      return res.status(400).json({ error: 'بيانات الوصفة غير صالحة.' });
    }

    const updated = await db.transaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(productionRecipes)
        .where(eq(productionRecipes.id, id))
        .limit(1);
      if (!existing) return null;

      const [next] = await tx
        .update(productionRecipes)
        .set({
          ...(parsed.data.breadType ? { breadType: parsed.data.breadType } : {}),
          expectedYieldLoaves: parsed.data.expectedYieldLoaves,
          unitSellingPrice: parsed.data.unitSellingPrice.toFixed(2),
          flourBags: parsed.data.flourBags.toFixed(2),
          oilLiters: parsed.data.oilLiters.toFixed(2),
          yeastGrams: parsed.data.yeastGrams.toFixed(2),
          saltGrams: parsed.data.saltGrams.toFixed(2),
          sugarGrams: parsed.data.sugarGrams.toFixed(2),
          ...(parsed.data.otherIngredients !== undefined
            ? { otherIngredients: parsed.data.otherIngredients }
            : {}),
          ...(parsed.data.isActive !== undefined ? { isActive: parsed.data.isActive } : {}),
          ...(parsed.data.notes !== undefined ? { notes: parsed.data.notes } : {}),
          updatedAt: new Date(),
        })
        .where(eq(productionRecipes.id, id))
        .returning();

      await recordAuditLog(tx, {
        userId: req.authUser!.id,
        userName: req.authUser!.fullName,
        role: 'OWNER',
        operationType: 'تعديل وصفة إنتاج',
        entityType: 'production_recipes',
        entityId: String(id),
        affectedRecord: next.breadType,
        previousValue: `إنتاج ${existing.expectedYieldLoaves} · سعر ${existing.unitSellingPrice}`,
        newValue: `إنتاج ${next.expectedYieldLoaves} · سعر ${next.unitSellingPrice}`,
      });

      return next;
    });

    if (!updated) return res.status(404).json({ error: 'الوصفة غير موجودة.' });
    return res.json({ ok: true });
  } catch {
    return res.status(500).json({ error: 'تعذر تحديث الوصفة.' });
  }
});

router.patch('/recipes/:id/toggle', requireRole('OWNER'), async (req: AuthRequest, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'معرف الوصفة غير صالح.' });

    const toggled = await db.transaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(productionRecipes)
        .where(eq(productionRecipes.id, id))
        .limit(1);
      if (!existing) return null;

      const nextActive = !existing.isActive;
      await tx
        .update(productionRecipes)
        .set({ isActive: nextActive, updatedAt: new Date() })
        .where(eq(productionRecipes.id, id));

      await recordAuditLog(tx, {
        userId: req.authUser!.id,
        userName: req.authUser!.fullName,
        role: 'OWNER',
        operationType: nextActive ? 'تفعيل وصفة إنتاج' : 'إيقاف وصفة إنتاج',
        entityType: 'production_recipes',
        entityId: String(id),
        affectedRecord: existing.breadType,
        previousValue: existing.isActive ? 'نشطة' : 'موقوفة',
        newValue: nextActive ? 'نشطة' : 'موقوفة',
      });

      return nextActive;
    });

    if (toggled === null) return res.status(404).json({ error: 'الوصفة غير موجودة.' });
    return res.json({ ok: true, isActive: toggled });
  } catch {
    return res.status(500).json({ error: 'تعذر تغيير حالة الوصفة.' });
  }
});

// ==========================================
// 2. PRODUCTION REGISTRATION (OWNER or permitted AGENT)
// ==========================================
const productionSchema = z.object({
  date: z.string().trim().min(8).optional(),
  shiftId: z.coerce.number().int().positive().optional(),
  shiftName: z.string().trim().min(2),
  recipeId: z.coerce.number().int().positive(),
  flourBags: z.coerce.number().min(0),
  oilLiters: z.coerce.number().min(0),
  yeastGrams: z.coerce.number().min(0),
  saltGrams: z.coerce.number().min(0).default(0),
  sugarGrams: z.coerce.number().min(0).default(0),
  otherIngredients: z
    .array(
      z.object({
        inventoryItemId: z.coerce.number().int().positive(),
        quantity: z.coerce.number().positive(),
      })
    )
    .optional(),
  producedLoaves: z.coerce.number().int().positive('الكمية المنتجة يجب أن تكون أكبر من صفر'),
  damagedLoaves: z.coerce.number().int().min(0).default(0),
  notes: z.string().optional(),
  clientTxId: z.string().optional(),
});

router.post('/production', requirePermission('PRODUCTION_LOG'), async (req: AuthRequest, res) => {
  try {
    const parsed = productionSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message || 'بيانات الإنتاج غير مكتملة.' });
    }
    const d = parsed.data;
    const opDate = d.date || new Date().toISOString().slice(0, 10);

    const record = await db.transaction(async (tx) => {
      if (d.clientTxId) {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${d.clientTxId}))`);
        const [dup] = await tx
          .select()
          .from(productionRecords)
          .where(eq(productionRecords.clientTxId, d.clientTxId))
          .limit(1);
        if (dup) throw new Error('DUPLICATE_TX');
      }

      const [recipe] = await tx
        .select()
        .from(productionRecipes)
        .where(eq(productionRecipes.id, d.recipeId))
        .limit(1);
      if (!recipe) throw new Error('RECIPE_NOT_FOUND');
      if (!recipe.isActive) throw new Error('RECIPE_INACTIVE');

      const activeShift = await resolveOperationalShift(tx, req.authUser!, d.shiftId);

      // Serialize multi-ingredient inventory checks & deductions to prevent concurrent negative stock races
      await tx.execute(sql`SELECT pg_advisory_xact_lock(499999)`);

      const [settingsRow] = await tx.select().from(bakerySettings).limit(1);
      const allowNeg = settingsRow?.allowNegativeInventory ?? false;

      const allInv = await tx.select().from(inventoryItems);
      const invById = new Map(allInv.map((i) => [i.id, i]));
      const flourItem = allInv.find((i) => i.sku === 'RM-FLR-01');
      const oilItem = allInv.find((i) => i.sku === 'RM-OIL-02');
      const yeastItem = allInv.find((i) => i.sku === 'RM-YST-03');
      const saltItem = allInv.find((i) => i.sku === 'RM-SLT-04');
      const sugarItem = allInv.find((i) => i.sku === 'RM-SGR-05');

      const deductions: { item: typeof inventoryItems.$inferSelect | undefined; qty: number }[] = [
        { item: flourItem, qty: d.flourBags },
        { item: oilItem, qty: d.oilLiters },
        { item: yeastItem, qty: d.yeastGrams },
        { item: saltItem, qty: d.saltGrams / 1000 },
        { item: sugarItem, qty: d.sugarGrams / 1000 },
      ];

      const otherSummaryParts: string[] = [];
      if (d.otherIngredients && d.otherIngredients.length > 0) {
        for (const extra of d.otherIngredients) {
          const item = invById.get(extra.inventoryItemId);
          if (!item) throw new Error('INGREDIENT_NOT_FOUND');
          deductions.push({ item, qty: extra.quantity });
          otherSummaryParts.push(`${item.name}: ${extra.quantity} ${item.unit}`);
        }
      }

      // Check cumulative available stock before deducting
      const requiredByItem = new Map<number, { item: typeof inventoryItems.$inferSelect; totalQty: number }>();
      for (const entry of deductions) {
        if (entry.item && entry.qty > 0) {
          const prev = requiredByItem.get(entry.item.id);
          requiredByItem.set(entry.item.id, {
            item: entry.item,
            totalQty: Number(((prev?.totalQty ?? 0) + entry.qty).toFixed(3)),
          });
        }
      }

      for (const { item, totalQty } of requiredByItem.values()) {
        const avail = Number(item.availableQuantity);
        if (!allowNeg && avail < totalQty) {
          throw new Error(`LOW_STOCK:${item.name}:${avail}:${item.unit}`);
        }
      }

      const ref = generateReference('PRD');
      const effectiveShiftName = activeShift?.shiftName || d.shiftName;

      const [created] = await tx
        .insert(productionRecords)
        .values({
          reference: ref,
          clientTxId: d.clientTxId ?? null,
          date: opDate,
          shiftId: activeShift?.id ?? null,
          shiftName: effectiveShiftName,
          agentId: req.authUser!.id,
          agentName: req.authUser!.fullName,
          recipeId: recipe.id,
          breadType: recipe.breadType,
          flourConsumedBags: d.flourBags.toFixed(2),
          oilConsumedLiters: d.oilLiters.toFixed(2),
          yeastConsumedGrams: d.yeastGrams.toFixed(2),
          saltConsumedGrams: d.saltGrams.toFixed(2),
          sugarConsumedGrams: d.sugarGrams.toFixed(2),
          otherIngredientsSummary: otherSummaryParts.length > 0 ? otherSummaryParts.join('، ') : null,
          producedLoaves: d.producedLoaves,
          damagedLoaves: d.damagedLoaves,
          notes: d.notes ?? null,
        })
        .returning();

      for (const { item, totalQty } of requiredByItem.values()) {
        await deductInventoryFefo(tx, {
          item,
          qty: totalQty,
          date: opDate,
          userId: req.authUser!.id,
          userName: req.authUser!.fullName,
          notes: `دفعة إنتاج ${ref} (${recipe.breadType})`,
          allowNegative: allowNeg,
        });

        await tx.insert(productionIngredients).values({
          productionRecordId: created.id,
          inventoryItemId: item.id,
          quantityUsed: totalQty.toFixed(3),
          unit: item.unit,
        });
      }

      if (activeShift) {
        await tx
          .update(shifts)
          .set({
            producedBread: activeShift.producedBread + d.producedLoaves,
            damagedBread: activeShift.damagedBread + d.damagedLoaves,
          })
          .where(eq(shifts.id, activeShift.id));
      }

      await recordAuditLog(tx, {
        userId: req.authUser!.id,
        userName: req.authUser!.fullName,
        role: req.authUser!.role,
        operationType: 'تسجيل دفعة إنتاج',
        entityType: 'production_records',
        entityId: String(created.id),
        affectedRecord: `${ref} (${recipe.breadType})`,
        newValue: `إنتاج ${d.producedLoaves} رغيف · تالف ${d.damagedLoaves} · خصم ${d.flourBags} جوال دقيق`,
        reference: ref,
      });

      return created;
    });

    return res.status(201).json({ id: String(record.id), reference: record.reference });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : '';
    if (msg === 'DUPLICATE_TX') {
      return res.status(409).json({ error: 'تم تسجيل هذه العملية مسبقاً (منع التكرار).' });
    }
    if (msg === 'RECIPE_NOT_FOUND') {
      return res.status(404).json({ error: 'الوصفة المحددة غير موجودة.' });
    }
    if (msg === 'RECIPE_INACTIVE') {
      return res.status(400).json({ error: 'هذه الوصفة موقوفة حالياً ولا يمكن استخدامها لإنتاج جديد.' });
    }
    if (msg === 'INGREDIENT_NOT_FOUND') {
      return res.status(404).json({ error: 'أحد الأصناف الإضافية المحددة غير موجود بالمستودع.' });
    }
    if (msg === 'AGENT_NO_OPEN_SHIFT') {
      return res.status(400).json({ error: 'يجب فتح وردية عمل أولاً قبل تسجيل الإنتاج.' });
    }
    if (msg === 'SHIFT_FORBIDDEN') {
      return res.status(403).json({ error: 'لا يمكنك التسجيل على وردية وكيل آخر.' });
    }
    if (msg === 'SHIFT_NOT_OPEN' || msg === 'SHIFT_NOT_FOUND') {
      return res.status(400).json({ error: 'الوردية المحددة غير مفتوحة أو غير موجودة.' });
    }
    if (msg.startsWith('LOW_STOCK:')) {
      const [, name, avail, unit] = msg.split(':');
      return res.status(400).json({
        error: `رصيد (${name}) المتاح (${avail} ${unit}) لا يكفي لهذه العملية.`,
      });
    }
    console.error('Production error:', error);
    return res.status(500).json({ error: 'تعذر تسجيل الإنتاج.' });
  }
});

// ==========================================
// 3. SALES & SEPARATE BREAD MOVEMENTS
// ==========================================
const saleSchema = z.object({
  date: z.string().trim().min(8).optional(),
  shiftId: z.coerce.number().int().positive().optional(),
  shiftName: z.string().trim().min(2),
  breadType: z.string().trim().min(2),
  quantity: z.coerce.number().int().positive('الكمية المباعة يجب أن تكون أكبر من صفر'),
  returnedQuantity: z.coerce.number().int().min(0).default(0),
  unitPrice: z.coerce.number().positive('سعر البيع يجب أن يكون أكبر من صفر'),
  paymentType: z.enum(['نقدي', 'آجل']),
  customerId: z.coerce.number().int().positive().optional(),
  notes: z.string().optional(),
  clientTxId: z.string().optional(),
});

router.post('/sales', requirePermission('SALES_LOG'), async (req: AuthRequest, res) => {
  try {
    const parsed = saleSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message || 'بيانات البيع غير مكتملة.' });
    }
    const d = parsed.data;
    if (d.paymentType === 'آجل' && !d.customerId) {
      return res.status(400).json({ error: 'يرجى تحديد العميل في حالة البيع الآجل.' });
    }
    const opDate = d.date || new Date().toISOString().slice(0, 10);

    const createdSale = await db.transaction(async (tx) => {
      if (d.clientTxId) {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${d.clientTxId}))`);
        const [dup] = await tx
          .select()
          .from(sales)
          .where(eq(sales.clientTxId, d.clientTxId))
          .limit(1);
        if (dup) throw new Error('DUPLICATE_TX');
      }

      const activeShift = await resolveOperationalShift(tx, req.authUser!, d.shiftId);

      // Check available bread balance inside active shift (prevent selling unavailable bread)
      if (activeShift) {
        const { expectedClosing } = computeBreadBalance(activeShift);
        const effectiveAvail = expectedClosing + d.returnedQuantity;
        if (d.quantity > effectiveAvail) {
          throw new Error(`INSUFFICIENT_BREAD:${effectiveAvail}:${d.quantity}`);
        }
      }

      const totalAmount = Number((d.quantity * d.unitPrice).toFixed(2));
      let customerName: string | null = null;
      if (d.paymentType === 'آجل' && d.customerId) {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(${700000 + d.customerId})`);
        const [cust] = await tx
          .select()
          .from(customers)
          .where(eq(customers.id, d.customerId))
          .limit(1);
        if (!cust) throw new Error('CUSTOMER_NOT_FOUND');
        customerName = cust.name;

        await tx
          .update(customers)
          .set({
            totalCreditSales: (Number(cust.totalCreditSales) + totalAmount).toFixed(2),
            outstandingBalance: (Number(cust.outstandingBalance) + totalAmount).toFixed(2),
            lastActivityDate: opDate,
          })
          .where(eq(customers.id, cust.id));
      }

      const ref = generateReference('SAL');
      const effectiveShiftName = activeShift?.shiftName || d.shiftName;

      const [saleRow] = await tx
        .insert(sales)
        .values({
          reference: ref,
          clientTxId: d.clientTxId ?? null,
          date: opDate,
          shiftId: activeShift?.id ?? null,
          shiftName: effectiveShiftName,
          agentId: req.authUser!.id,
          agentName: req.authUser!.fullName,
          breadType: d.breadType,
          quantity: d.quantity,
          returnedQuantity: d.returnedQuantity,
          unitPrice: d.unitPrice.toFixed(2),
          totalAmount: totalAmount.toFixed(2),
          paymentType: d.paymentType,
          customerId: d.customerId ?? null,
          customerName,
          notes: d.notes ?? null,
        })
        .returning();

      await tx.insert(saleItems).values({
        saleId: saleRow.id,
        breadType: d.breadType,
        quantity: d.quantity,
        unitPrice: d.unitPrice.toFixed(2),
        lineTotal: totalAmount.toFixed(2),
      });

      if (d.paymentType === 'نقدي') {
        await tx.insert(cashTransactions).values({
          reference: generateReference('CSH'),
          type: 'إيداع مبيعات',
          category: 'مبيعات',
          direction: 'IN',
          amount: totalAmount.toFixed(2),
          date: opDate,
          paymentMethod: 'نقداً',
          relatedEntity: `${d.breadType} (${ref})`,
          shiftId: activeShift?.id ?? null,
          recordedByUserId: req.authUser!.id,
          recordedBy: req.authUser!.fullName,
        });
      }

      if (activeShift) {
        const nextCashSales =
          d.paymentType === 'نقدي'
            ? Number(activeShift.cashSalesAmount) + totalAmount
            : Number(activeShift.cashSalesAmount);
        const nextCreditSales =
          d.paymentType === 'آجل'
            ? Number(activeShift.creditSalesAmount) + totalAmount
            : Number(activeShift.creditSalesAmount);
        const nextExpected =
          d.paymentType === 'نقدي'
            ? Number(activeShift.expectedCash) + totalAmount
            : Number(activeShift.expectedCash);

        await tx
          .update(shifts)
          .set({
            soldBread: activeShift.soldBread + d.quantity,
            returnedBread: activeShift.returnedBread + d.returnedQuantity,
            cashSalesAmount: nextCashSales.toFixed(2),
            creditSalesAmount: nextCreditSales.toFixed(2),
            expectedCash: nextExpected.toFixed(2),
          })
          .where(eq(shifts.id, activeShift.id));
      }

      await recordAuditLog(tx, {
        userId: req.authUser!.id,
        userName: req.authUser!.fullName,
        role: req.authUser!.role,
        operationType: 'تسجيل عملية بيع',
        entityType: 'sales',
        entityId: String(saleRow.id),
        affectedRecord: ref,
        newValue: `${d.quantity} رغيف (${d.breadType}) · ${totalAmount} ج.س (${d.paymentType})`,
        reference: ref,
      });

      return saleRow;
    });

    return res.status(201).json({
      id: String(createdSale.id),
      reference: createdSale.reference,
      totalAmount: Number(createdSale.totalAmount),
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : '';
    if (msg === 'DUPLICATE_TX') {
      return res.status(409).json({ error: 'عملية البيع مسجلة مسبقاً.' });
    }
    if (msg === 'CUSTOMER_NOT_FOUND') {
      return res.status(404).json({ error: 'العميل غير موجود.' });
    }
    if (msg === 'AGENT_NO_OPEN_SHIFT') {
      return res.status(400).json({ error: 'يجب فتح وردية عمل أولاً قبل تسجيل المبيعات.' });
    }
    if (msg === 'SHIFT_FORBIDDEN') {
      return res.status(403).json({ error: 'لا يمكنك التسجيل على وردية وكيل آخر.' });
    }
    if (msg === 'SHIFT_NOT_OPEN' || msg === 'SHIFT_NOT_FOUND') {
      return res.status(400).json({ error: 'الوردية المحددة غير مفتوحة أو غير موجودة.' });
    }
    if (msg.startsWith('INSUFFICIENT_BREAD:')) {
      const [, avail, reqQty] = msg.split(':');
      return res.status(400).json({
        error: `الخبز المتاح في الوردية (${avail} رغيف) أقل من الكمية المطلوب بيعها (${reqQty} رغيف).`,
      });
    }
    console.error('Sales error:', error);
    return res.status(500).json({ error: 'تعذر تسجيل عملية البيع.' });
  }
});

// Separate Bread Returns, Damaged Bread, and Authorized Adjustments
const breadMovementSchema = z.object({
  date: z.string().trim().min(8).optional(),
  shiftId: z.coerce.number().int().positive().optional(),
  shiftName: z.string().trim().min(2).optional(),
  breadType: z.string().trim().min(2),
  type: z.enum(['مرتجع', 'تالف', 'تعديل معتمد']),
  quantity: z.coerce.number().int().positive('الكمية يجب أن تكون أكبر من صفر'),
  reason: z.string().trim().min(2, 'يرجى كتابة السبب أو الملاحظة'),
  clientTxId: z.string().optional(),
});

router.post('/bread-movements', async (req: AuthRequest, res) => {
  try {
    const parsed = breadMovementSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: parsed.error.issues[0]?.message || 'بيانات حركة الخبز غير مكتملة.',
      });
    }
    const d = parsed.data;
    const user = req.authUser!;

    // RBAC / Permission enforcement per movement type
    if (d.type === 'تعديل معتمد' && user.role !== 'OWNER') {
      return res.status(403).json({ error: 'التعديلات المعتمدة على رصيد الخبز مخصصة للمالك فقط.' });
    }
    if (user.role === 'AGENT') {
      if (d.type === 'مرتجع' && !user.permissions.includes('SALES_LOG')) {
        return res.status(403).json({ error: 'ليست لديك صلاحية تسجيل مرتجعات الخبز.' });
      }
      if (
        d.type === 'تالف' &&
        !user.permissions.includes('SALES_LOG') &&
        !user.permissions.includes('PRODUCTION_LOG')
      ) {
        return res.status(403).json({ error: 'ليست لديك صلاحية تسجيل الخبز التالف.' });
      }
    }

    const opDate = d.date || new Date().toISOString().slice(0, 10);

    const created = await db.transaction(async (tx) => {
      if (d.clientTxId) {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${d.clientTxId}))`);
        const [dup] = await tx
          .select()
          .from(breadMovements)
          .where(eq(breadMovements.clientTxId, d.clientTxId))
          .limit(1);
        if (dup) throw new Error('DUPLICATE_TX');
      }

      const activeShift = await resolveOperationalShift(tx, user, d.shiftId);

      if (activeShift && (d.type === 'تالف' || d.type === 'تعديل معتمد')) {
        const { expectedClosing } = computeBreadBalance(activeShift);
        if (d.quantity > expectedClosing) {
          throw new Error(`INSUFFICIENT_BREAD:${expectedClosing}:${d.quantity}`);
        }
      }

      const ref = generateReference('BRD');
      const effectiveShiftName = activeShift?.shiftName || d.shiftName || 'الوردية الصباحية';

      const [row] = await tx
        .insert(breadMovements)
        .values({
          reference: ref,
          clientTxId: d.clientTxId ?? null,
          date: opDate,
          shiftId: activeShift?.id ?? null,
          shiftName: effectiveShiftName,
          agentId: user.id,
          agentName: user.fullName,
          breadType: d.breadType,
          type: d.type,
          quantity: d.quantity,
          reason: d.reason,
        })
        .returning();

      if (activeShift) {
        await tx
          .update(shifts)
          .set({
            ...(d.type === 'مرتجع'
              ? { returnedBread: activeShift.returnedBread + d.quantity }
              : d.type === 'تالف'
              ? { damagedBread: activeShift.damagedBread + d.quantity }
              : {
                  authorizedAdjustments:
                    (activeShift.authorizedAdjustments ?? 0) + d.quantity,
                }),
          })
          .where(eq(shifts.id, activeShift.id));
      }

      await recordAuditLog(tx, {
        userId: user.id,
        userName: user.fullName,
        role: user.role,
        operationType: `تسجيل ${d.type} خبز`,
        entityType: 'bread_movements',
        entityId: String(row.id),
        affectedRecord: `${ref} (${d.breadType})`,
        newValue: `${d.type}: ${d.quantity} رغيف · السبب: ${d.reason}`,
        reference: ref,
      });

      return row;
    });

    return res.status(201).json({
      id: String(created.id),
      reference: created.reference,
      movement: mapBreadMovement(created),
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : '';
    if (msg === 'DUPLICATE_TX') {
      return res.status(409).json({ error: 'تم تسجيل حركة الخبز هذه مسبقاً.' });
    }
    if (msg === 'AGENT_NO_OPEN_SHIFT') {
      return res.status(400).json({ error: 'يجب فتح وردية عمل أولاً قبل تسجيل المرتجعات أو التالف.' });
    }
    if (msg === 'SHIFT_FORBIDDEN') {
      return res.status(403).json({ error: 'لا يمكنك التسجيل على وردية وكيل آخر.' });
    }
    if (msg === 'SHIFT_NOT_OPEN' || msg === 'SHIFT_NOT_FOUND') {
      return res.status(400).json({ error: 'الوردية المحددة غير مفتوحة أو غير موجودة.' });
    }
    if (msg.startsWith('INSUFFICIENT_BREAD:')) {
      const [, avail, reqQty] = msg.split(':');
      return res.status(400).json({
        error: `الرصيد المتاح (${avail} رغيف) لا يكفي لتسجيل هذه الكمية (${reqQty} رغيف).`,
      });
    }
    console.error('Bread movement error:', error);
    return res.status(500).json({ error: 'تعذر تسجيل حركة الخبز.' });
  }
});

// ==========================================
// 4. EXPENSES (OWNER or permitted AGENT)
// ==========================================
router.post('/expenses', requirePermission('EXPENSES_LOG'), async (req: AuthRequest, res) => {
  try {
    const schema = z.object({
      date: z.string().trim().min(8).optional(),
      category: z.string().trim().min(2),
      amount: z.coerce.number().positive('مبلغ المصروف يجب أن يكون أكبر من صفر'),
      description: z.string().trim().min(2, 'بيان المصروف مطلوب'),
      paymentMethod: z.enum(['نقداً', 'تحويل بنكي (بنكك)', 'شيك']).default('نقداً'),
      shiftId: z.coerce.number().int().positive().optional(),
      attachmentName: z.string().optional(),
      attachmentData: z.string().max(400_000, 'حجم المرفق يتجاوز الحد المسموح (400 كيلوبايت)').optional(),
      clientTxId: z.string().optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message || 'بيانات المصروف غير صالحة.' });
    }
    const d = parsed.data;
    if (d.attachmentData && !isValidSafeDataUri(d.attachmentData, ALLOWED_ATTACHMENT_MIMES)) {
      return res.status(400).json({
        error: 'صيغة المرفق غير مدعومة أو غير آمنة. يُسمح فقط بملفات الصور (JPG/PNG/WEBP) أو PDF أو TXT.',
      });
    }
    const opDate = d.date || new Date().toISOString().slice(0, 10);

    const exp = await db.transaction(async (tx) => {
      if (d.clientTxId) {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${d.clientTxId}))`);
        const [dup] = await tx
          .select()
          .from(expenses)
          .where(eq(expenses.clientTxId, d.clientTxId))
          .limit(1);
        if (dup) throw new Error('DUPLICATE_TX');
      }

      let activeShift: typeof shifts.$inferSelect | null = null;
      if (req.authUser!.role === 'AGENT' || d.shiftId) {
        activeShift = await resolveOperationalShift(tx, req.authUser!, d.shiftId);
      }

      const ref = generateReference('EXP');
      const [created] = await tx
        .insert(expenses)
        .values({
          reference: ref,
          clientTxId: d.clientTxId ?? null,
          date: opDate,
          category: d.category,
          amount: d.amount.toFixed(2),
          description: d.description,
          paymentMethod: d.paymentMethod,
          responsibleUserId: req.authUser!.id,
          responsibleUser: req.authUser!.fullName,
          shiftId: activeShift?.id ?? null,
          attachmentName: d.attachmentName ?? null,
          attachmentData: d.attachmentData ?? null,
          status: 'مرحّل',
        })
        .returning();

      await tx.insert(cashTransactions).values({
        reference: generateReference('CSH'),
        type: 'مصروف تشغيلي',
        category: 'مصروف تشغيلي',
        direction: 'OUT',
        amount: d.amount.toFixed(2),
        date: opDate,
        paymentMethod: d.paymentMethod,
        relatedEntity: `${d.category} — ${d.description}`,
        shiftId: activeShift?.id ?? null,
        recordedByUserId: req.authUser!.id,
        recordedBy: req.authUser!.fullName,
      });

      if (activeShift) {
        await tx
          .update(shifts)
          .set({
            totalExpenses: (Number(activeShift.totalExpenses) + d.amount).toFixed(2),
            expectedCash: (Number(activeShift.expectedCash) - d.amount).toFixed(2),
          })
          .where(eq(shifts.id, activeShift.id));
      }

      await recordAuditLog(tx, {
        userId: req.authUser!.id,
        userName: req.authUser!.fullName,
        role: req.authUser!.role,
        operationType: 'تسجيل مصروف تشغيلي',
        entityType: 'expenses',
        entityId: String(created.id),
        affectedRecord: ref,
        newValue: `${d.category}: ${d.amount} ج.س`,
        reference: ref,
      });

      return created;
    });

    return res.status(201).json({ id: String(exp.id), reference: exp.reference });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : '';
    if (msg === 'DUPLICATE_TX') {
      return res.status(409).json({ error: 'تم تسجيل هذا المصروف مسبقاً.' });
    }
    if (msg === 'AGENT_NO_OPEN_SHIFT') {
      return res.status(400).json({ error: 'يجب فتح وردية عمل أولاً قبل تسجيل مصروفات الوردية.' });
    }
    if (msg === 'SHIFT_FORBIDDEN') {
      return res.status(403).json({ error: 'لا يمكنك تسجيل مصروف على وردية وكيل آخر.' });
    }
    if (msg === 'SHIFT_NOT_OPEN' || msg === 'SHIFT_NOT_FOUND') {
      return res.status(400).json({ error: 'الوردية المحددة غير مفتوحة أو غير موجودة.' });
    }
    console.error('Expense error:', error);
    return res.status(500).json({ error: 'تعذر حفظ المصروف.' });
  }
});

// ==========================================
// 5. SHIFTS & CASH HANDOVERS
// ==========================================
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

// Approve Closed Shift & Handover (OWNER ONLY)
async function confirmShiftAndHandover(
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

// ==========================================
// 6. CUSTOMERS & AGENTS (OWNER ONLY)
// ==========================================
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

// Keep or import clean if unused
void or;

export default router;
