import { db } from '../../db/index.ts';
import {
  breadMovements,
  cashTransactions,
  customerPayments,
  customers,
  expenses,
  inventoryItems,
  productionIngredients,
  productionRecords,
  purchaseInvoices,
  sales,
  shiftHandovers,
  shifts,
  suppliers,
} from '../../db/schema.ts';
import {
  add2,
  calculateCustomerBalance,
  calculateGrossProfit,
  calculateIngredientRowsCost,
  calculateLegacyProductionCost,
  calculateNetProfit,
  calculateSupplierBalance,
  sub2,
  sumDecimal2,
  toDecimal,
} from '../accounting/formulas.ts';

export const PAYMENT_METHODS = ['نقداً', 'تحويل بنكي (بنكك)', 'شيك'] as const;
export const VALID_SHIFTS = ['الوردية الصباحية', 'الوردية المسائية', 'الوردية الليلية'] as const;

export function inDateRange(dateStr: string, dateFrom?: string, dateTo?: string): boolean {
  if (dateFrom && dateStr < dateFrom) return false;
  if (dateTo && dateStr > dateTo) return false;
  return true;
}

export function getIsoWeekKey(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return dateStr.slice(0, 7);
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

export async function computeFinancialPeriodSnapshot(params: {
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
      return calculateIngredientRowsCost(
        rows.map((pi) => ({
          quantityUsed: Number(pi.quantityUsed),
          averageCost: Number(invById.get(pi.inventoryItemId)?.averageCost ?? 0),
        }))
      );
    }
    return calculateLegacyProductionCost({
      flourConsumedBags: Number(p.flourConsumedBags),
      flourUnitCost: flourCost,
      oilConsumedLiters: Number(p.oilConsumedLiters),
      oilUnitCost: oilCost,
      yeastConsumedGrams: Number(p.yeastConsumedGrams),
      yeastUnitCost: yeastCost,
      saltConsumedGrams: Number(p.saltConsumedGrams),
      saltUnitCost: saltCost,
      sugarConsumedGrams: Number(p.sugarConsumedGrams),
      sugarUnitCost: sugarCost,
    });
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
  const salesRevenue = sumDecimal2(filteredSales.map((s) => s.totalAmount));
  const cashSalesRevenue = sumDecimal2(
    filteredSales.filter((s) => s.paymentType === 'نقدي').map((s) => s.totalAmount)
  );
  const creditSalesRevenue = sumDecimal2(
    filteredSales.filter((s) => s.paymentType === 'آجل').map((s) => s.totalAmount)
  );
  const customerPaymentsCollected = sumDecimal2(filteredCustPayments.map((p) => p.amount));
  const cashCollected = add2(cashSalesRevenue, customerPaymentsCollected);

  const costOfGoodsConsumed = sumDecimal2(filteredProd.map((p) => prodCostForRecord(p)));
  const operatingExpenses = sumDecimal2(filteredExpenses.map((e) => e.amount));

  const grossProfit = calculateGrossProfit(salesRevenue, costOfGoodsConsumed);
  const netEstimatedProfit = calculateNetProfit(
    salesRevenue,
    costOfGoodsConsumed,
    operatingExpenses
  );

  // Live Position Balances (across ledger)
  const cashBalance = sumDecimal2(
    allCash
      .map((c) => (c.direction === 'IN' ? toDecimal(c.amount) : toDecimal(c.amount).negated()))
      .map((d) => d.toString())
  );
  const outstandingReceivables = sumDecimal2(
    allCustomers.map((c) =>
      calculateCustomerBalance(c.totalCreditSales, c.totalPayments, c.adjustments)
    )
  );
  const supplierLiabilities = sumDecimal2(
    allSuppliers.map((s) =>
      calculateSupplierBalance(s.totalPurchases, s.totalPayments, s.adjustments)
    )
  );
  const inventoryValue = sumDecimal2(
    allInv.map((i) =>
      toDecimal(i.availableQuantity).times(toDecimal(i.averageCost)).toString()
    )
  );

  const periodCashInflows = sumDecimal2(
    filteredCash.filter((c) => c.direction === 'IN').map((c) => c.amount)
  );
  const periodCashOutflows = sumDecimal2(
    filteredCash.filter((c) => c.direction === 'OUT').map((c) => c.amount)
  );

  // Expenses grouped by category (exclude netted-zero reversed categories)
  const expenseMap = new Map<string, number>();
  for (const e of filteredExpenses) {
    expenseMap.set(e.category, add2(expenseMap.get(e.category) || 0, e.amount));
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
      periodNetCashFlow: sub2(periodCashInflows, periodCashOutflows),
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
