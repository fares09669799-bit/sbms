import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from 'recharts';
import {
  AlertTriangle,
  ArrowUpLeft,
  TrendingUp,
  Users,
  Package,
  Clock,
  Wallet,
  CalendarRange,
} from 'lucide-react';
import { useSbms } from '../../context/SbmsContext';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/FormControls';
import { StatusText } from '../../components/ui/StatusText';
import { apiRequest } from '../../lib/apiClient';
import { formatCurrency, formatNumber } from '../../lib/utils';
import { AccountingDashboardResponse, OwnerNavKey } from '../../types/sbms';

interface OwnerDashboardProps {
  onNavigate: (nav: OwnerNavKey) => void;
}

const EXPENSE_PALETTE = ['#142D35', '#176B55', '#D8AD65', '#4B6B73', '#8AA39B', '#9A6714'];

export const OwnerDashboard: React.FC<OwnerDashboardProps> = ({ onNavigate }) => {
  const {
    sales,
    productionRecords,
    breadMovements,
    expenses,
    cashTransactions,
    suppliers,
    customers,
    inventory,
    agents,
    shifts,
    movements,
    settings,
  } = useSbms();

  const [chartRange, setChartRange] = useState<'daily' | 'monthly'>('daily');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [activePreset, setActivePreset] = useState<'all' | 'month' | 'week' | 'today' | 'custom'>('all');
  const [dashboardData, setDashboardData] = useState<AccountingDashboardResponse | null>(null);
  const [loadingDash, setLoadingDash] = useState(false);

  const loadDashboard = useCallback(async () => {
    setLoadingDash(true);
    const params = new URLSearchParams();
    if (dateFrom) params.set('dateFrom', dateFrom);
    if (dateTo) params.set('dateTo', dateTo);
    const qs = params.toString();
    const res = await apiRequest<AccountingDashboardResponse>(
      `/api/accounting/dashboard${qs ? `?${qs}` : ''}`
    );
    setLoadingDash(false);
    if (res.ok && res.data) {
      setDashboardData(res.data);
    }
  }, [dateFrom, dateTo]);

  useEffect(() => {
    void loadDashboard();
  }, [
    loadDashboard,
    sales.length,
    expenses.length,
    productionRecords.length,
    cashTransactions.length,
    customers.length,
    suppliers.length,
    shifts.length,
  ]);

  const applyPreset = (preset: 'all' | 'month' | 'week' | 'today') => {
    const now = new Date();
    const todayStr = now.toISOString().slice(0, 10);
    setActivePreset(preset);
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

  const operationalMetrics = useMemo(() => {
    const openShifts = shifts.filter((s) => s.status === 'مفتوحة');
    const closedShifts = shifts.filter((s) => s.status !== 'مفتوحة');
    const remainingBread = openShifts.reduce((acc, sh) => {
      const avail = sh.openingBread + sh.producedBread + sh.returnedBread;
      const expected = avail - sh.soldBread - sh.damagedBread - (sh.authorizedAdjustments ?? 0);
      return acc + Math.max(0, expected);
    }, 0);

    const totalCashDiscrepancies = closedShifts.reduce(
      (acc, sh) => acc + (sh.cashDifference ?? 0),
      0
    );

    const totalProducedAll = productionRecords.reduce((acc, p) => acc + p.producedLoaves, 0);
    const totalLossesAll =
      productionRecords.reduce((acc, p) => acc + p.damagedLoaves, 0) +
      breadMovements.filter((b) => b.type === 'تالف').reduce((acc, b) => acc + b.quantity, 0);
    const lossRatePercent =
      totalProducedAll > 0 ? Number(((totalLossesAll / totalProducedAll) * 100).toFixed(2)) : 0;

    const flourItem = inventory.find((i) => i.sku === 'RM-FLR-01' || i.name.includes('دقيق'));
    const lowStockItems = inventory.filter((i) => i.availableQuantity <= i.minimumStock);
    const activeAgentsCount = agents.filter((a) => a.status === 'نشط').length;

    return {
      openShiftsCount: openShifts.length,
      closedShiftsCount: closedShifts.length,
      remainingBread,
      totalCashDiscrepancies,
      totalLossesAll,
      lossRatePercent,
      flourStock: flourItem?.availableQuantity ?? 0,
      lowStockItems,
      activeAgentsCount,
    };
  }, [shifts, productionRecords, breadMovements, inventory, agents]);

  const metrics = dashboardData?.metrics;

  const expenseBreakdown = useMemo(() => {
    if (!metrics) return [];
    return metrics.expenseByCategory.map((item, idx) => ({
      name: item.category,
      value: item.amount,
      color: EXPENSE_PALETTE[idx % EXPENSE_PALETTE.length],
    }));
  }, [metrics]);

  const inventoryMovementData = useMemo(() => {
    return inventory.slice(0, 6).map((item) => ({
      name: item.name.split(' ')[0] + ' ' + (item.name.split(' ')[1] || ''),
      available: item.availableQuantity,
      minimum: item.minimumStock,
    }));
  }, [inventory]);

  const activeChartData = useMemo(() => {
    if (!dashboardData) return [];
    return chartRange === 'daily' ? dashboardData.dailySeries : dashboardData.monthlySeries;
  }, [dashboardData, chartRange]);

  const periodDisplayText = useMemo(() => {
    if (dateFrom && dateTo) return `من ${dateFrom} إلى ${dateTo}`;
    if (dateFrom) return `من ${dateFrom}`;
    if (dateTo) return `حتى ${dateTo}`;
    return 'كامل الفترة التشغيلية المسجلة';
  }, [dateFrom, dateTo]);

  return (
    <div className="space-y-6">
      {/* Reporting Period Filter Bar */}
      <Card padding="sm">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 flex-wrap">
            <CalendarRange className="w-4 h-4 text-[#176B55]" />
            <span className="text-xs font-bold text-[#142D35]">الفترة المحاسبية:</span>
            <span className="text-xs font-medium text-[#176B55]">{periodDisplayText}</span>
            <div className="flex items-center gap-1.5 mr-2 flex-wrap">
              {(
                [
                  { id: 'all', label: 'كامل الفترة' },
                  { id: 'month', label: 'هذا الشهر' },
                  { id: 'week', label: 'آخر 7 أيام' },
                  { id: 'today', label: 'اليوم' },
                ] as const
              ).map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => applyPreset(p.id)}
                  className={`px-2.5 py-1 text-xs rounded-md border cursor-pointer transition-colors ${
                    activePreset === p.id
                      ? 'bg-[#142D35] text-white border-[#142D35]'
                      : 'bg-white text-[#5A6B6E] border-[#E2E7E5] hover:border-[#142D35]'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <div className="w-36">
              <Input
                type="date"
                aria-label="من تاريخ"
                value={dateFrom}
                onChange={(e) => {
                  setDateFrom(e.target.value);
                  setActivePreset('custom');
                }}
              />
            </div>
            <span className="text-xs text-[#5A6B6E]">إلى</span>
            <div className="w-36">
              <Input
                type="date"
                aria-label="إلى تاريخ"
                value={dateTo}
                onChange={(e) => {
                  setDateTo(e.target.value);
                  setActivePreset('custom');
                }}
              />
            </div>
            {loadingDash && <span className="text-[11px] text-[#5A6B6E]">جاري التحديث...</span>}
          </div>
        </div>
      </Card>

      {/* Low Stock Banner */}
      {operationalMetrics.lowStockItems.length > 0 && (
        <Card className="bg-[#F7EFE0]/45 border-[#D8AD65]/50" padding="sm">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-start sm:items-center gap-3">
              <AlertTriangle className="w-5 h-5 text-[#9A6714] shrink-0 mt-0.5 sm:mt-0" />
              <div className="text-xs text-[#142D35]">
                <span className="font-semibold">
                  تنبيه مخزون منخفض ({operationalMetrics.lowStockItems.length} أصناف):{' '}
                </span>
                <span>
                  {operationalMetrics.lowStockItems
                    .map((i) => `${i.name} (${formatNumber(i.availableQuantity)} ${i.unit})`)
                    .join(' · ')}
                </span>
              </div>
            </div>
            <Button variant="outline" size="sm" onClick={() => onNavigate('inventory')}>
              مراجعة المستودع
            </Button>
          </div>
        </Card>
      )}

      {/* Primary Accrual vs Cash Financial KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <div className="text-xs text-[#5A6B6E]">إجمالي الإيرادات (المبيعات)</div>
          <div className="text-2xl font-bold text-[#142D35] font-mono tabular-nums mt-2">
            {formatCurrency(metrics?.salesRevenue ?? 0, settings.currencySymbol)}
          </div>
          <div className="text-xs text-[#5A6B6E] mt-2 flex items-center justify-between">
            <span className="text-[#176B55] flex items-center gap-1">
              <TrendingUp className="w-3.5 h-3.5" />
              <span>{formatNumber(metrics?.soldBreadLoaves ?? 0)} رغيف</span>
            </span>
            <span className="font-mono text-[11px]">
              آجل: {formatCurrency(metrics?.creditSalesRevenue ?? 0)}
            </span>
          </div>
        </Card>

        <Card>
          <div className="text-xs text-[#5A6B6E]">النقدية المحصلة فعلياً</div>
          <div className="text-2xl font-bold text-[#176B55] font-mono tabular-nums mt-2">
            {formatCurrency(metrics?.cashCollected ?? 0, settings.currencySymbol)}
          </div>
          <div className="text-xs text-[#5A6B6E] mt-2 flex items-center justify-between">
            <span>مبيعات نقدية: {formatCurrency(metrics?.cashSalesRevenue ?? 0)}</span>
            <span className="font-mono text-[11px]">
              تحصيل: {formatCurrency(metrics?.customerPaymentsCollected ?? 0)}
            </span>
          </div>
        </Card>

        <Card>
          <div className="text-xs text-[#5A6B6E]">التكلفة والمصروفات التشغيلية</div>
          <div className="text-2xl font-bold text-[#B91C1C] font-mono tabular-nums mt-2">
            {formatCurrency(
              (metrics?.costOfGoodsConsumed ?? 0) + (metrics?.operatingExpenses ?? 0),
              settings.currencySymbol
            )}
          </div>
          <div className="text-xs text-[#5A6B6E] mt-2 flex items-center justify-between">
            <span>خامات: {formatCurrency(metrics?.costOfGoodsConsumed ?? 0)}</span>
            <span>مصروفات: {formatCurrency(metrics?.operatingExpenses ?? 0)}</span>
          </div>
        </Card>

        <Card className="bg-[#142D35] text-white border-[#142D35]">
          <div className="text-xs text-white/75">صافي الربح التقديري (الاستحقاق)</div>
          <div
            className={`text-2xl font-bold font-mono tabular-nums mt-2 ${
              (metrics?.netEstimatedProfit ?? 0) >= 0 ? 'text-[#D8AD65]' : 'text-[#FCA5A5]'
            }`}
          >
            {formatCurrency(metrics?.netEstimatedProfit ?? 0, settings.currencySymbol)}
          </div>
          <div className="text-xs text-white/75 mt-2">
            مجمل الربح:{' '}
            <span className="font-mono tabular-nums text-white">
              {formatCurrency(metrics?.grossProfit ?? 0)}
            </span>
          </div>
        </Card>
      </div>

      {/* Live Financial Position Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card padding="sm" className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Wallet className="w-5 h-5 text-[#176B55]" />
            <div>
              <div className="text-xs text-[#5A6B6E]">رصيد الخزينة الفعلي</div>
              <div className="text-lg font-bold text-[#176B55] font-mono tabular-nums mt-0.5">
                {formatCurrency(metrics?.cashBalance ?? 0, settings.currencySymbol)}
              </div>
            </div>
          </div>
          <Button variant="ghost" size="sm" onClick={() => onNavigate('cash-expenses')}>
            <span>الخزينة</span>
            <ArrowUpLeft className="w-3.5 h-3.5" />
          </Button>
        </Card>

        <Card padding="sm" className="flex items-center justify-between">
          <div>
            <div className="text-xs text-[#5A6B6E]">ذمم العملاء (المدينون)</div>
            <div className="text-lg font-bold text-[#9A6714] font-mono tabular-nums mt-0.5">
              {formatCurrency(metrics?.outstandingReceivables ?? 0, settings.currencySymbol)}
            </div>
          </div>
          <Button variant="ghost" size="sm" onClick={() => onNavigate('customers')}>
            <span>التحصيل</span>
            <ArrowUpLeft className="w-3.5 h-3.5" />
          </Button>
        </Card>

        <Card padding="sm" className="flex items-center justify-between">
          <div>
            <div className="text-xs text-[#5A6B6E]">مديونية الموردين (الدائنون)</div>
            <div className="text-lg font-bold text-[#B91C1C] font-mono tabular-nums mt-0.5">
              {formatCurrency(metrics?.supplierLiabilities ?? 0, settings.currencySymbol)}
            </div>
          </div>
          <Button variant="ghost" size="sm" onClick={() => onNavigate('suppliers')}>
            <span>الموردون</span>
            <ArrowUpLeft className="w-3.5 h-3.5" />
          </Button>
        </Card>

        <Card padding="sm" className="flex items-center justify-between">
          <div>
            <div className="text-xs text-[#5A6B6E]">قيمة المخزون ({formatNumber(operationalMetrics.flourStock)} جوال دقيق)</div>
            <div className="text-lg font-bold text-[#142D35] font-mono tabular-nums mt-0.5">
              {formatCurrency(metrics?.inventoryValue ?? 0, settings.currencySymbol)}
            </div>
          </div>
          <Button variant="ghost" size="sm" onClick={() => onNavigate('inventory')}>
            <span>المستودع</span>
            <ArrowUpLeft className="w-3.5 h-3.5" />
          </Button>
        </Card>
      </div>

      {/* Operational Shift & Production Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card padding="sm" className="flex items-center justify-between">
          <div>
            <div className="text-xs text-[#5A6B6E]">الخبز المتبقي بالورديات النشطة</div>
            <div className="text-base font-bold text-[#176B55] font-mono tabular-nums mt-0.5">
              {formatNumber(operationalMetrics.remainingBread)} رغيف
            </div>
          </div>
          <Button variant="ghost" size="sm" onClick={() => onNavigate('sales')}>
            <span>المطابقة</span>
            <ArrowUpLeft className="w-3.5 h-3.5" />
          </Button>
        </Card>

        <Card padding="sm" className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Clock className="w-4 h-4 text-[#D8AD65]" />
            <div>
              <div className="text-xs text-[#5A6B6E]">الورديات المفتوحة / المغلقة</div>
              <div className="text-base font-bold text-[#142D35] font-mono tabular-nums">
                {operationalMetrics.openShiftsCount} مفتوحة · {operationalMetrics.closedShiftsCount} مغلقة
              </div>
            </div>
          </div>
          <Button variant="ghost" size="sm" onClick={() => onNavigate('agents-shifts')}>
            متابعة
          </Button>
        </Card>

        <Card padding="sm" className="flex items-center justify-between">
          <div>
            <div className="text-xs text-[#5A6B6E]">الإنتاج والتالف للفترة</div>
            <div className="text-base font-bold text-[#142D35] font-mono tabular-nums mt-0.5">
              {formatNumber(metrics?.producedBreadLoaves ?? 0)} رغيف ·{' '}
              <span className="text-[#B91C1C]">
                تالف {formatNumber(metrics?.damagedBreadLoaves ?? operationalMetrics.totalLossesAll)}
              </span>
            </div>
          </div>
          <Button variant="ghost" size="sm" onClick={() => onNavigate('production')}>
            التفاصيل
          </Button>
        </Card>

        <Card padding="sm" className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Users className="w-4 h-4 text-[#176B55]" />
            <div>
              <div className="text-xs text-[#5A6B6E]">فروقات النقدية بالورديات</div>
              <div
                className={`text-base font-bold font-mono tabular-nums mt-0.5 ${
                  operationalMetrics.totalCashDiscrepancies === 0
                    ? 'text-[#176B55]'
                    : 'text-[#B91C1C]'
                }`}
              >
                {formatCurrency(operationalMetrics.totalCashDiscrepancies, settings.currencySymbol)}
              </div>
            </div>
          </div>
          <div className="text-[11px] text-[#5A6B6E] font-mono">
            {operationalMetrics.activeAgentsCount} وكيل نشط
          </div>
        </Card>
      </div>

      {/* Charts Row 1 */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        <Card className="lg:col-span-8">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-5">
            <div>
              <h2 className="text-base font-semibold text-[#142D35]">تحليل المبيعات والمصروفات</h2>
              <p className="text-xs text-[#5A6B6E] mt-0.5">
                بيانات محاسبية مباشرة من قاعدة البيانات ({periodDisplayText})
              </p>
            </div>
            <div className="inline-flex items-center gap-1 p-1 bg-[#F5F7F6] rounded-lg border border-[#E2E7E5] self-start">
              {(
                [
                  { id: 'daily', label: 'يومي' },
                  { id: 'monthly', label: 'شهري' },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setChartRange(tab.id)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer ${
                    chartRange === tab.id
                      ? 'bg-white text-[#142D35] shadow-xs'
                      : 'text-[#5A6B6E] hover:text-[#142D35]'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          <div className="h-72 w-full" dir="ltr">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={activeChartData} margin={{ top: 10, right: 16, left: 10, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E2E7E5" vertical={false} />
                <XAxis dataKey="label" tick={{ fill: '#5A6B6E', fontSize: 12 }} />
                <YAxis tick={{ fill: '#5A6B6E', fontSize: 11 }} />
                <Tooltip
                  formatter={(value) => formatCurrency(Number(value ?? 0), settings.currencySymbol)}
                  contentStyle={{
                    backgroundColor: '#FFFFFF',
                    border: '1px solid #E2E7E5',
                    borderRadius: '8px',
                    fontSize: '12px',
                    direction: 'rtl',
                  }}
                />
                <Bar dataKey="sales" name="المبيعات" fill="#176B55" radius={[4, 4, 0, 0]} />
                <Bar dataKey="expenses" name="المصروفات" fill="#D8AD65" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card className="lg:col-span-4 flex flex-col justify-between">
          <div>
            <h2 className="text-base font-semibold text-[#142D35]">توزيع المصروفات التشغيلية</h2>
            <p className="text-xs text-[#5A6B6E] mt-0.5">نسب البنود المرحلة خلال الفترة المختارة</p>
          </div>
          {expenseBreakdown.length === 0 ? (
            <div className="py-16 text-center text-xs text-[#5A6B6E]">
              لا توجد مصروفات تشغيلية مسجلة في هذه الفترة.
            </div>
          ) : (
            <>
              <div className="h-52 w-full my-2" dir="ltr">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={expenseBreakdown}
                      dataKey="value"
                      nameKey="name"
                      innerRadius={50}
                      outerRadius={78}
                      paddingAngle={2}
                    >
                      {expenseBreakdown.map((entry, idx) => (
                        <Cell key={idx} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip
                      formatter={(val) => formatCurrency(Number(val ?? 0), settings.currencySymbol)}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="space-y-2 border-t border-[#E2E7E5] pt-3">
                {expenseBreakdown.slice(0, 5).map((item) => (
                  <div key={item.name} className="flex items-center justify-between text-xs">
                    <span className="text-[#142D35] flex items-center gap-2">
                      <span
                        className="w-2.5 h-2.5 rounded-xs inline-block shrink-0"
                        style={{ backgroundColor: item.color }}
                      />
                      <span>{item.name}</span>
                    </span>
                    <span className="font-mono tabular-nums font-medium text-[#142D35]">
                      {formatCurrency(item.value)}
                    </span>
                  </div>
                ))}
              </div>
            </>
          )}
        </Card>
      </div>

      {/* Charts Row 2: Inventory Levels vs Minimum + Agent Performance */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        <Card className="lg:col-span-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-base font-semibold text-[#142D35]">مستويات المخزون مقارنة بالحد الأدنى</h2>
              <p className="text-xs text-[#5A6B6E] mt-0.5">آخر الحركات: {movements.length} حركة مسجلة</p>
            </div>
            <Package className="w-4 h-4 text-[#5A6B6E]" />
          </div>
          <div className="h-60 w-full" dir="ltr">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={inventoryMovementData} margin={{ top: 10, right: 10, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E2E7E5" />
                <XAxis dataKey="name" tick={{ fill: '#5A6B6E', fontSize: 11 }} />
                <YAxis tick={{ fill: '#5A6B6E', fontSize: 11 }} />
                <Tooltip />
                <Line
                  type="monotone"
                  dataKey="available"
                  name="المتاح"
                  stroke="#176B55"
                  strokeWidth={2}
                  dot={{ r: 4 }}
                />
                <Line
                  type="monotone"
                  dataKey="minimum"
                  name="الحد الأدنى"
                  stroke="#B91C1C"
                  strokeDasharray="4 4"
                  strokeWidth={2}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card className="lg:col-span-7 overflow-hidden" padding="none">
          <div className="px-5 py-4 border-b border-[#E2E7E5] flex items-center justify-between">
            <div>
              <h2 className="text-base font-semibold text-[#142D35]">أداء الوكلاء والورديات</h2>
              <p className="text-xs text-[#5A6B6E] mt-0.5">الإنتاج والمبيعات ودقة المطابقة النقدية</p>
            </div>
            <Button variant="outline" size="sm" onClick={() => onNavigate('agents-shifts')}>
              عرض الكل
            </Button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-right">
              <thead className="bg-[#F5F7F6] text-xs text-[#5A6B6E] border-b border-[#E2E7E5]">
                <tr>
                  <th className="py-3 px-4 font-medium">الوكيل</th>
                  <th className="py-3 px-4 font-medium">الوردية</th>
                  <th className="py-3 px-4 font-medium">الإنتاج الكلي</th>
                  <th className="py-3 px-4 font-medium">المبيعات الكلية</th>
                  <th className="py-3 px-4 font-medium">دقة النقدية</th>
                  <th className="py-3 px-4 font-medium">الحالة</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E2E7E5]">
                {agents.map((ag) => (
                  <tr key={ag.id} className="hover:bg-[#F5F7F6]/60 transition-colors">
                    <td className="py-3 px-4 font-medium text-[#142D35]">{ag.fullName}</td>
                    <td className="py-3 px-4 text-xs text-[#5A6B6E]">{ag.assignedShift}</td>
                    <td className="py-3 px-4 font-mono tabular-nums">
                      {formatNumber(ag.totalProduction ?? ag.todayProduction)}
                    </td>
                    <td className="py-3 px-4 font-mono tabular-nums font-medium">
                      {formatCurrency(ag.totalSales ?? ag.todaySales)}
                    </td>
                    <td className="py-3 px-4 font-mono tabular-nums text-[#176B55]">
                      {ag.cashAccuracyRate}%
                    </td>
                    <td className="py-3 px-4">
                      <StatusText
                        tone={ag.status === 'نشط' ? 'success' : 'neutral'}
                        label={ag.status}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      {/* Recent Cash & Sales Movements + Accounting Basis Note */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        <Card padding="none" className="lg:col-span-8 overflow-hidden">
          <div className="px-5 py-4 border-b border-[#E2E7E5] flex items-center justify-between">
            <div>
              <h2 className="text-base font-semibold text-[#142D35]">أحدث الحركات المالية والتشغيلية</h2>
              <p className="text-xs text-[#5A6B6E] mt-0.5">آخر فواتير المبيعات المسجلة في النظام</p>
            </div>
            <Button variant="outline" size="sm" onClick={() => onNavigate('reports')}>
              مركز التقارير (13 تقريراً)
            </Button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-right">
              <thead className="bg-[#F5F7F6] text-xs text-[#5A6B6E] border-b border-[#E2E7E5]">
                <tr>
                  <th className="py-3 px-4 font-medium">المرجع</th>
                  <th className="py-3 px-4 font-medium">البيان</th>
                  <th className="py-3 px-4 font-medium">الوردية / الجهة</th>
                  <th className="py-3 px-4 font-medium">التاريخ</th>
                  <th className="py-3 px-4 font-medium">القيمة</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E2E7E5]">
                {sales.slice(0, 5).map((sale) => (
                  <tr key={sale.id} className="hover:bg-[#F5F7F6]/60">
                    <td className="py-3 px-4 font-mono text-xs text-[#5A6B6E]">{sale.reference}</td>
                    <td className="py-3 px-4 font-medium text-[#142D35]">
                      بيع {formatNumber(sale.quantity)} رغيف ({sale.breadType})
                    </td>
                    <td className="py-3 px-4 text-xs text-[#5A6B6E]">
                      {sale.agentName} · {sale.paymentType}
                    </td>
                    <td className="py-3 px-4 font-mono text-xs text-[#5A6B6E]">{sale.date}</td>
                    <td className="py-3 px-4 font-mono tabular-nums font-semibold text-[#176B55]">
                      {formatCurrency(sale.totalAmount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <Card className="lg:col-span-4 space-y-3">
          <div className="text-sm font-bold text-[#142D35]">السياسة المحاسبية المعتمدة</div>
          <div className="text-xs text-[#5A6B6E] leading-relaxed space-y-2">
            <div>
              <strong className="text-[#142D35]">الأساس:</strong>{' '}
              {dashboardData?.accountingBasis.basisName ||
                'أساس الاستحقاق التشغيلي مع فصل التدفق النقدي'}
            </div>
            <div>
              <strong className="text-[#142D35]">معادلة الربح:</strong>{' '}
              {dashboardData?.accountingBasis.profitFormula ||
                'إجمالي المبيعات (نقدي + آجل) − تكلفة المكونات المستهلكة − المصروفات التشغيلية'}
            </div>
            <div>
              <strong className="text-[#142D35]">ضبط الخزينة:</strong>{' '}
              {dashboardData?.accountingBasis.cashRule ||
                'الإيداعات النقدية المباشرة وسداد الموردين لا تُحتسب إيراداً أو مصروفاً في قائمة الدخل.'}
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
};
