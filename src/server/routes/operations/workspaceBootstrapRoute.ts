import { Router } from 'express';
import { asc, desc, gt } from 'drizzle-orm';
import { db } from '../../../db/index.ts';
import { ensureSeeded } from '../../../db/seed.ts';
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
  productionRecipes,
  productionRecords,
  purchaseInvoiceItems,
  purchaseInvoices,
  sales,
  shiftHandovers,
  shifts,
  stockMovements,
  supplierPayments,
  suppliers,
  users,
} from '../../../db/schema.ts';
import {
  type AuthRequest,
  DEFAULT_AGENT_PERMISSIONS,
} from '../../../middleware/auth.ts';
import { mapBreadMovement, mapShift } from '../../services/operationsService.ts';

const router = Router();

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
    const movementRows = await db
      .select()
      .from(stockMovements)
      .orderBy(desc(stockMovements.id))
      .limit(200);
    const agentUsers = allUsers.filter((u) => u.roleCode === 'AGENT');
    const employeeRows = await db.select().from(employees).orderBy(employees.id);
    const cashTxRows = await db.select().from(cashTransactions).orderBy(desc(cashTransactions.id));
    const custPayRows = await db.select().from(customerPayments).orderBy(desc(customerPayments.id));
    const custAdjRows = await db
      .select()
      .from(customerAdjustments)
      .orderBy(desc(customerAdjustments.id));
    const payrollRows = await db.select().from(payroll).orderBy(desc(payroll.id));
    const empAttRows = await db
      .select()
      .from(employeeAttendance)
      .orderBy(desc(employeeAttendance.date));
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

export default router;
