import { Router } from 'express';
import {
  add2,
  calculateCustomerBalance,
  calculateSupplierBalance,
  mul2,
  sub2,
  sumDecimal2,
} from '../../accounting/formulas.ts';
import {
  computeFinancialPeriodSnapshot,
  getIsoWeekKey,
  inDateRange,
} from '../../services/financialSnapshotService.ts';

const router = Router();

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
      entry.sales = add2(entry.sales, s.totalAmount);
      dailyMap.set(s.date, entry);
    }
    for (const e of snap.filteredExpenses) {
      const entry = dailyMap.get(e.date) || {
        label: e.date.slice(5),
        date: e.date,
        sales: 0,
        expenses: 0,
      };
      entry.expenses = add2(entry.expenses, e.amount);
      dailyMap.set(e.date, entry);
    }

    const monthlyMap = new Map<string, { label: string; sales: number; expenses: number }>();
    for (const s of snap.allSales) {
      const key = s.date.slice(0, 7);
      const entry = monthlyMap.get(key) || { label: key, sales: 0, expenses: 0 };
      entry.sales = add2(entry.sales, s.totalAmount);
      monthlyMap.set(key, entry);
    }
    for (const e of snap.allExpenses) {
      const key = e.date.slice(0, 7);
      const entry = monthlyMap.get(key) || { label: key, sales: 0, expenses: 0 };
      entry.expenses = add2(entry.expenses, e.amount);
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
      const operatingIn = sumDecimal2(
        txList
          .filter((c) => c.direction === 'IN' && c.category !== 'تمويل وخزينة')
          .map((c) => c.amount)
      );
      const operatingOut = sumDecimal2(
        txList
          .filter((c) => c.direction === 'OUT' && c.category !== 'تمويل وخزينة')
          .map((c) => c.amount)
      );
      const financingIn = sumDecimal2(
        txList
          .filter((c) => c.direction === 'IN' && c.category === 'تمويل وخزينة')
          .map((c) => c.amount)
      );
      const financingOut = sumDecimal2(
        txList
          .filter((c) => c.direction === 'OUT' && c.category === 'تمويل وخزينة')
          .map((c) => c.amount)
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
      const netOperatingCash = sub2(operatingIn, operatingOut);
      summary = {
        operatingIn,
        operatingOut,
        netOperatingCash,
        financingIn,
        financingOut,
        netCashFlow: add2(netOperatingCash, sub2(financingIn, financingOut)),
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
        if (s.paymentType === 'نقدي') cur.cashAmount = add2(cur.cashAmount, s.totalAmount);
        else cur.creditAmount = add2(cur.creditAmount, s.totalAmount);
        cur.totalAmount = add2(cur.totalAmount, s.totalAmount);
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
        totalFlourBags: sumDecimal2(snap.filteredProd.map((p) => p.flourConsumedBags)),
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
        totalValue: mul2(i.availableQuantity, i.averageCost),
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
        outstandingBalance: calculateSupplierBalance(
          s.totalPurchases,
          s.totalPayments,
          s.adjustments
        ),
        status: s.status,
      }));
      summary = {
        suppliersCount: rows.length,
        totalPurchases: sumDecimal2(sups.map((s) => s.totalPurchases)),
        totalPayments: sumDecimal2(sups.map((s) => s.totalPayments)),
        totalLiabilities: sumDecimal2(rows.map((r) => r.outstandingBalance)),
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
        outstandingBalance: calculateCustomerBalance(
          c.totalCreditSales,
          c.totalPayments,
          c.adjustments
        ),
      }));
      summary = {
        customersCount: rows.length,
        totalCreditSales: sumDecimal2(snap.allCustomers.map((c) => c.totalCreditSales)),
        totalPayments: sumDecimal2(snap.allCustomers.map((c) => c.totalPayments)),
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
        if (s.paymentType === 'نقدي') a.cashSales = add2(a.cashSales, s.totalAmount);
        else a.creditSales = add2(a.creditSales, s.totalAmount);
        a.totalSales = add2(a.totalSales, s.totalAmount);
      }
      for (const sh of snap.allShifts.filter(
        (sh) => inDateRange(sh.date, dateFrom, dateTo) && (!agentIdParam || sh.agentId === agentIdParam)
      )) {
        const a = ensureAg(sh.agentName);
        a.shiftsCount += 1;
        a.cashDifference = add2(a.cashDifference, sh.cashDifference ?? 0);
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
        totalExpectedCash: sumDecimal2(rows.map((r) => r.expectedCash)),
        totalActualCash: sumDecimal2(rows.map((r) => r.actualCash)),
        totalCashDifference: sumDecimal2(rows.map((r) => r.cashDifference)),
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

export default router;
