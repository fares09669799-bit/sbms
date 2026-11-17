import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  FileSpreadsheet,
  FileDown,
  Printer,
  ChevronRight,
  ChevronLeft,
  Info,
  Search,
} from 'lucide-react';
import bakeryEmblem from '../../assets/images/bakery_brand_emblem_1794753872653.jpg';
import { useSbms } from '../../context/SbmsContext';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Select, Input } from '../../components/ui/FormControls';
import { apiRequest } from '../../lib/apiClient';
import { exportElementToPdf, exportToExcelXlsx } from '../../lib/exportUtils';
import { formatCurrency, formatNumber } from '../../lib/utils';
import { FinancialReportResponse } from '../../types/sbms';

export type ReportKind =
  | 'pnl'
  | 'cash-flow'
  | 'daily-sales'
  | 'weekly-sales'
  | 'monthly-sales'
  | 'annual-sales'
  | 'production'
  | 'inventory'
  | 'supplier-balances'
  | 'customer-debts'
  | 'expenses'
  | 'agent-performance'
  | 'shift-reconciliation';

const REPORT_TYPES: { id: ReportKind; label: string }[] = [
  { id: 'pnl', label: 'تقرير الأرباح والخسائر (P&L)' },
  { id: 'cash-flow', label: 'تقرير التدفقات النقدية (Cash Flow)' },
  { id: 'daily-sales', label: 'تقرير المبيعات اليومي' },
  { id: 'weekly-sales', label: 'تقرير المبيعات الأسبوعي' },
  { id: 'monthly-sales', label: 'تقرير المبيعات الشهري' },
  { id: 'annual-sales', label: 'تقرير المبيعات السنوي' },
  { id: 'production', label: 'تقرير الإنتاج واستهلاك المواد' },
  { id: 'inventory', label: 'تقرير الجرد وتقييم المخزون' },
  { id: 'supplier-balances', label: 'تقرير أرصدة ومستحقات الموردين' },
  { id: 'customer-debts', label: 'تقرير مديونيات العملاء' },
  { id: 'expenses', label: 'تقرير المصروفات التشغيلية' },
  { id: 'agent-performance', label: 'تقرير أداء الوكلاء' },
  { id: 'shift-reconciliation', label: 'تقرير مطابقة الورديات والنقدية' },
];

const SUMMARY_META: Record<string, { label: string; isCount?: boolean }> = {
  salesRevenue: { label: 'إجمالي إيرادات المبيعات' },
  cashCollected: { label: 'النقدية المحصلة فعلياً' },
  creditSalesRevenue: { label: 'المبيعات الآجلة' },
  costOfGoodsConsumed: { label: 'تكلفة المواد المستهلكة' },
  grossProfit: { label: 'إجمالي الربح التشغيلي' },
  operatingExpenses: { label: 'المصروفات التشغيلية' },
  netEstimatedProfit: { label: 'صافي الربح التقديري' },
  operatingIn: { label: 'التدفق التشغيلي الداخل' },
  operatingOut: { label: 'التدفق التشغيلي الخارج' },
  netOperatingCash: { label: 'صافي النقد التشغيلي' },
  financingIn: { label: 'إيداعات التمويل' },
  financingOut: { label: 'مسحوبات الخزينة' },
  netCashFlow: { label: 'صافي التدفق للفترة' },
  closingCashBalance: { label: 'رصيد الخزينة الفعلي' },
  transactionsCount: { label: 'عدد العمليات', isCount: true },
  totalQuantity: { label: 'إجمالي الأرغفة', isCount: true },
  cashSales: { label: 'المبيعات النقدية' },
  creditSales: { label: 'المبيعات الآجلة' },
  totalRevenue: { label: 'إجمالي الإيرادات' },
  batchesCount: { label: 'عدد التشغيلات', isCount: true },
  totalProducedLoaves: { label: 'إجمالي الإنتاج (رغيف)', isCount: true },
  totalDamagedLoaves: { label: 'إجمالي التالف (رغيف)', isCount: true },
  totalFlourBags: { label: 'الدقيق المستهلك (جوال)', isCount: true },
  totalIngredientCost: { label: 'تكلفة المكونات المستهلكة' },
  itemsCount: { label: 'عدد الأصناف', isCount: true },
  lowStockCount: { label: 'أصناف دون الحد الأدنى', isCount: true },
  totalInventoryValue: { label: 'إجمالي قيمة المخزون' },
  suppliersCount: { label: 'عدد الموردين', isCount: true },
  totalPurchases: { label: 'إجمالي المشتريات' },
  totalPayments: { label: 'إجمالي المدفوعات / التحصيلات' },
  totalLiabilities: { label: 'إجمالي مديونية الموردين' },
  customersCount: { label: 'عدد العملاء', isCount: true },
  totalCreditSales: { label: 'إجمالي المبيعات الآجلة' },
  outstandingReceivables: { label: 'إجمالي الذمم القائمة' },
  recordsCount: { label: 'عدد القيود', isCount: true },
  totalOperatingExpenses: { label: 'إجمالي المصروفات التشغيلية' },
  agentsCount: { label: 'عدد الوكلاء', isCount: true },
  totalProduced: { label: 'إجمالي الإنتاج (رغيف)', isCount: true },
  totalSales: { label: 'إجمالي المبيعات' },
  shiftsCount: { label: 'عدد الورديات', isCount: true },
  totalExpectedCash: { label: 'إجمالي النقدية المتوقعة' },
  totalActualCash: { label: 'إجمالي النقدية الفعلية' },
  totalCashDifference: { label: 'صافي فروقات النقدية' },
};

export const ReportsPage: React.FC = () => {
  const {
    agents,
    suppliers,
    recipes,
    settings,
    sales,
    expenses,
    productionRecords,
    cashTransactions,
  } = useSbms();

  const [reportType, setReportType] = useState<ReportKind>('pnl');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [agentFilter, setAgentFilter] = useState('ALL');
  const [supplierFilter, setSupplierFilter] = useState('ALL');
  const [breadFilter, setBreadFilter] = useState('ALL');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const limit = 50;

  const [report, setReport] = useState<FinancialReportResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [exportingPdf, setExportingPdf] = useState(false);

  const printableRef = useRef<HTMLDivElement>(null);

  const breadOptions = useMemo(() => {
    const names = Array.from(new Set(recipes.map((r) => r.breadType)));
    return names.length > 0
      ? names
      : ['عيش بلدي سوداني', 'عيش فينو (سندوتش)', 'رغيف فرنسي كبير'];
  }, [recipes]);

  const loadReport = useCallback(async () => {
    setLoading(true);
    setError('');
    const params = new URLSearchParams();
    params.set('type', reportType);
    if (dateFrom) params.set('dateFrom', dateFrom);
    if (dateTo) params.set('dateTo', dateTo);
    if (agentFilter !== 'ALL') params.set('agentId', agentFilter);
    if (supplierFilter !== 'ALL') params.set('supplierId', supplierFilter);
    if (breadFilter !== 'ALL') params.set('breadType', breadFilter);
    if (search.trim()) params.set('search', search.trim());
    params.set('page', String(page));
    params.set('limit', String(limit));

    const res = await apiRequest<FinancialReportResponse>(
      `/api/accounting/reports?${params.toString()}`
    );
    setLoading(false);
    if (!res.ok || !res.data) {
      setError(res.error || 'تعذر تحميل التقرير المالي.');
      return;
    }
    setReport(res.data);
  }, [
    reportType,
    dateFrom,
    dateTo,
    agentFilter,
    supplierFilter,
    breadFilter,
    search,
    page,
  ]);

  useEffect(() => {
    void loadReport();
  }, [
    loadReport,
    sales.length,
    expenses.length,
    productionRecords.length,
    cashTransactions.length,
  ]);

  const applyPresetRange = (preset: 'all' | 'today' | 'week' | 'month') => {
    const now = new Date();
    const todayStr = now.toISOString().slice(0, 10);
    setPage(1);
    if (preset === 'all') {
      setDateFrom('');
      setDateTo('');
    } else if (preset === 'today') {
      setDateFrom(todayStr);
      setDateTo(todayStr);
    } else if (preset === 'week') {
      const start = new Date(now);
      start.setDate(start.getDate() - 6);
      setDateFrom(start.toISOString().slice(0, 10));
      setDateTo(todayStr);
    } else {
      setDateFrom(`${todayStr.slice(0, 7)}-01`);
      setDateTo(todayStr);
    }
  };

  const periodLabel = useMemo(() => {
    if (dateFrom && dateTo) return `${dateFrom} إلى ${dateTo}`;
    if (dateFrom) return `من ${dateFrom}`;
    if (dateTo) return `حتى ${dateTo}`;
    return 'كامل السجل المالي المسجل';
  }, [dateFrom, dateTo]);

  const summaryEntries = useMemo(() => {
    if (!report) return [];
    return Object.entries(report.summary).map(([key, val]) => {
      const meta = SUMMARY_META[key] || { label: key, isCount: false };
      const numVal = Number(val ?? 0);
      return {
        key,
        label: meta.label,
        rawValue: val,
        formatted: meta.isCount
          ? formatNumber(numVal, Number.isInteger(numVal) ? 0 : 2)
          : formatCurrency(numVal, settings.currencySymbol),
        isNegative: numVal < 0,
      };
    });
  }, [report, settings.currencySymbol]);

  const handleExportExcel = () => {
    if (!report) return;
    exportToExcelXlsx({
      filename: `sbms-${report.reportType}-${new Date().toISOString().slice(0, 10)}.xlsx`,
      sheetName: report.reportType,
      bakeryName: settings.bakeryName,
      reportTitle: report.reportTitle,
      periodLabel,
      columns: report.columns,
      rows: report.allRowsForExport,
      summaryEntries: summaryEntries.map((s) => ({
        label: s.label,
        value: s.rawValue,
      })),
    });
  };

  const handleExportPdf = async () => {
    if (!printableRef.current || !report) return;
    setExportingPdf(true);
    try {
      await exportElementToPdf({
        element: printableRef.current,
        filename: `sbms-${report.reportType}-${new Date().toISOString().slice(0, 10)}.pdf`,
      });
    } catch {
      setError('تعذر توليد ملف PDF مباشرة. يمكنك استخدام زر الطباعة كبديل.');
    } finally {
      setExportingPdf(false);
    }
  };

  const generatedTimestamp = useMemo(() => {
    if (!report?.generatedAt) return '';
    return new Date(report.generatedAt).toLocaleString('ar-SD', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  }, [report?.generatedAt]);

  return (
    <div className="space-y-6">
      {/* Header & Export Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 no-print">
        <div>
          <h2 className="text-lg font-bold text-[#142D35]">مركز التقارير المالية والتشغيلية</h2>
          <p className="text-xs text-[#5A6B6E] mt-1">
            13 تقريراً مالياً وتشغيلياً من قاعدة البيانات الفعلية مع تصدير Excel (.xlsx) و PDF.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button
            variant="outline"
            onClick={handleExportExcel}
            disabled={!report || loading}
          >
            <FileSpreadsheet className="w-4 h-4 text-[#176B55]" />
            <span>تصدير Excel (.xlsx)</span>
          </Button>
          <Button
            variant="outline"
            onClick={handleExportPdf}
            disabled={!report || loading || exportingPdf}
          >
            <FileDown className="w-4 h-4 text-[#142D35]" />
            <span>{exportingPdf ? 'جاري التجهيز...' : 'تنزيل PDF'}</span>
          </Button>
          <Button onClick={() => window.print()} disabled={!report}>
            <Printer className="w-4 h-4" />
            <span>طباعة</span>
          </Button>
        </div>
      </div>

      {/* Filters Card */}
      <Card padding="sm" className="no-print space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#E2E7E5] pb-2.5">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-xs text-[#5A6B6E] ml-1">نطاق سريع:</span>
            <button
              type="button"
              onClick={() => applyPresetRange('all')}
              className={`px-2.5 py-1 text-xs rounded-md border cursor-pointer ${
                !dateFrom && !dateTo
                  ? 'bg-[#142D35] text-white border-[#142D35]'
                  : 'bg-white text-[#5A6B6E] border-[#E2E7E5]'
              }`}
            >
              كامل الفترة
            </button>
            <button
              type="button"
              onClick={() => applyPresetRange('month')}
              className="px-2.5 py-1 text-xs rounded-md border bg-white text-[#5A6B6E] border-[#E2E7E5] hover:border-[#142D35] cursor-pointer"
            >
              هذا الشهر
            </button>
            <button
              type="button"
              onClick={() => applyPresetRange('week')}
              className="px-2.5 py-1 text-xs rounded-md border bg-white text-[#5A6B6E] border-[#E2E7E5] hover:border-[#142D35] cursor-pointer"
            >
              آخر 7 أيام
            </button>
            <button
              type="button"
              onClick={() => applyPresetRange('today')}
              className="px-2.5 py-1 text-xs rounded-md border bg-white text-[#5A6B6E] border-[#E2E7E5] hover:border-[#142D35] cursor-pointer"
            >
              اليوم
            </button>
          </div>
          <div className="relative w-full sm:w-64">
            <Search className="w-3.5 h-3.5 text-[#5A6B6E] absolute right-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              placeholder="بحث في صفوف التقرير..."
              className="w-full h-8 pr-8 pl-3 text-xs rounded-md border border-[#E2E7E5] bg-white focus:outline-none focus:border-[#176B55]"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3">
          <div className="lg:col-span-2">
            <Select
              label="نوع التقرير"
              value={reportType}
              onChange={(e) => {
                setReportType(e.target.value as ReportKind);
                setPage(1);
              }}
            >
              {REPORT_TYPES.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.label}
                </option>
              ))}
            </Select>
          </div>

          <Input
            label="من تاريخ"
            type="date"
            value={dateFrom}
            onChange={(e) => {
              setDateFrom(e.target.value);
              setPage(1);
            }}
          />
          <Input
            label="إلى تاريخ"
            type="date"
            value={dateTo}
            onChange={(e) => {
              setDateTo(e.target.value);
              setPage(1);
            }}
          />

          <Select
            label="الوكيل"
            value={agentFilter}
            onChange={(e) => {
              setAgentFilter(e.target.value);
              setPage(1);
            }}
          >
            <option value="ALL">جميع الوكلاء</option>
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.fullName}
              </option>
            ))}
          </Select>

          {reportType === 'supplier-balances' ? (
            <Select
              label="المورد"
              value={supplierFilter}
              onChange={(e) => {
                setSupplierFilter(e.target.value);
                setPage(1);
              }}
            >
              <option value="ALL">جميع الموردين</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          ) : (
            <Select
              label="نوع الخبز"
              value={breadFilter}
              onChange={(e) => {
                setBreadFilter(e.target.value);
                setPage(1);
              }}
            >
              <option value="ALL">جميع الأصناف</option>
              {breadOptions.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </Select>
          )}
        </div>
      </Card>

      {error && (
        <Card className="border-[#B91C1C] bg-[#FEE2E2]/40 text-xs text-[#B91C1C]" padding="sm">
          {error}
        </Card>
      )}

      {/* Printable / Exportable Report Document */}
      <div ref={printableRef} className="space-y-4 print-container bg-white rounded-xl">
        <Card className="space-y-5">
          {/* Official Printable Header with Bakery Logo, Period & Timestamp */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b-2 border-[#142D35] pb-4">
            <div className="flex items-center gap-3.5">
              <img
                src={bakeryEmblem}
                alt={settings.bakeryName}
                className="w-12 h-12 rounded-lg object-cover border border-[#E2E7E5]"
              />
              <div>
                <div className="text-base font-bold text-[#142D35]">{settings.bakeryName}</div>
                <div className="text-xs text-[#5A6B6E]">
                  {settings.city} — {settings.address} · هاتف:{' '}
                  <span dir="ltr" className="font-mono">
                    {settings.phone}
                  </span>
                </div>
              </div>
            </div>
            <div className="text-right sm:text-left">
              <div className="text-sm font-bold text-[#176B55]">
                {report?.reportTitle || REPORT_TYPES.find((r) => r.id === reportType)?.label}
              </div>
              <div className="text-xs text-[#5A6B6E] mt-0.5">
                الفترة: <span className="font-medium text-[#142D35]">{periodLabel}</span>
              </div>
              {generatedTimestamp && (
                <div className="text-[11px] text-[#5A6B6E] font-mono mt-0.5">
                  تاريخ الإصدار: {generatedTimestamp}
                </div>
              )}
            </div>
          </div>

          {/* Transparent Accounting Basis Notice */}
          {report?.accountingBasis && (
            <div className="p-3 rounded-lg bg-[#F5F7F6] border border-[#E2E7E5] text-xs text-[#5A6B6E] flex items-start gap-2.5">
              <Info className="w-4 h-4 text-[#176B55] shrink-0 mt-0.5" />
              <div className="space-y-1 leading-relaxed">
                <div>
                  <strong className="text-[#142D35]">الإيرادات:</strong>{' '}
                  {report.accountingBasis.revenueDefinition}
                </div>
                <div>
                  <strong className="text-[#142D35]">النقد المحصل:</strong>{' '}
                  {report.accountingBasis.cashCollectedDefinition} ·{' '}
                  <strong className="text-[#142D35]">الربحية:</strong>{' '}
                  {report.accountingBasis.profitDefinition}
                </div>
              </div>
            </div>
          )}

          {/* Summary Totals Grid */}
          {summaryEntries.length > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              {summaryEntries.map((item) => (
                <div
                  key={item.key}
                  className={`p-3 rounded-lg border ${
                    item.key === 'netEstimatedProfit' || item.key === 'closingCashBalance'
                      ? 'bg-[#142D35] text-white border-[#142D35]'
                      : 'bg-[#F5F7F6] border-[#E2E7E5]'
                  }`}
                >
                  <div
                    className={`text-[11px] ${
                      item.key === 'netEstimatedProfit' || item.key === 'closingCashBalance'
                        ? 'text-white/75'
                        : 'text-[#5A6B6E]'
                    }`}
                  >
                    {item.label}
                  </div>
                  <div
                    className={`text-base font-bold font-mono tabular-nums mt-1 ${
                      item.key === 'netEstimatedProfit' || item.key === 'closingCashBalance'
                        ? 'text-[#D8AD65]'
                        : item.isNegative
                        ? 'text-[#B91C1C]'
                        : 'text-[#142D35]'
                    }`}
                  >
                    {item.formatted}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Report Table */}
          {loading && !report ? (
            <div className="py-12 text-center text-xs text-[#5A6B6E]">
              جاري احتساب التقرير من قاعدة البيانات...
            </div>
          ) : report ? (
            <div className="overflow-x-auto border border-[#E2E7E5] rounded-lg">
              <table className="w-full text-sm text-right">
                <thead className="bg-[#F5F7F6] text-xs text-[#5A6B6E] border-b border-[#E2E7E5]">
                  <tr>
                    {report.columns.map((col) => (
                      <th key={col.key} className="py-2.5 px-4 font-semibold whitespace-nowrap">
                        {col.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E2E7E5]">
                  {report.rows.length === 0 ? (
                    <tr>
                      <td
                        colSpan={Math.max(1, report.columns.length)}
                        className="py-8 text-center text-xs text-[#5A6B6E]"
                      >
                        لا توجد بيانات مطابقة للمرشحات المختارة في هذه الفترة.
                      </td>
                    </tr>
                  ) : (
                    report.rows.map((row, idx) => (
                      <tr key={idx} className="hover:bg-[#F5F7F6]/60">
                        {report.columns.map((col) => {
                          const raw = row[col.key];
                          if (col.format === 'currency') {
                            const num = Number(raw ?? 0);
                            return (
                              <td
                                key={col.key}
                                className={`py-2.5 px-4 font-mono tabular-nums font-semibold whitespace-nowrap ${
                                  num < 0
                                    ? 'text-[#B91C1C]'
                                    : col.key === 'outflow' && num > 0
                                    ? 'text-[#B91C1C]'
                                    : 'text-[#142D35]'
                                }`}
                              >
                                {formatCurrency(num, settings.currencySymbol)}
                              </td>
                            );
                          }
                          if (col.format === 'number') {
                            const num = Number(raw ?? 0);
                            return (
                              <td
                                key={col.key}
                                className="py-2.5 px-4 font-mono tabular-nums whitespace-nowrap"
                              >
                                {formatNumber(num, Number.isInteger(num) ? 0 : 2)}
                              </td>
                            );
                          }
                          return (
                            <td key={col.key} className="py-2.5 px-4 text-xs text-[#142D35]">
                              {raw === undefined || raw === null || raw === '' ? '—' : String(raw)}
                            </td>
                          );
                        })}
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          ) : null}

          {/* Pagination */}
          {report && report.pagination.totalPages > 1 && (
            <div className="flex items-center justify-between pt-2 text-xs text-[#5A6B6E] no-print">
              <span>
                إجمالي الصفوف: {formatNumber(report.pagination.total)} · صفحة{' '}
                {report.pagination.page} من {report.pagination.totalPages}
              </span>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  <ChevronRight className="w-3.5 h-3.5" />
                  <span>السابق</span>
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={page >= report.pagination.totalPages}
                  onClick={() => setPage((p) => p + 1)}
                >
                  <span>التالي</span>
                  <ChevronLeft className="w-3.5 h-3.5" />
                </Button>
              </div>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
};
