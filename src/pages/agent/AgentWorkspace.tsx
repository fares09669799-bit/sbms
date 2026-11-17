import React, { useEffect, useMemo, useState } from 'react';
import {
  Flame,
  ShoppingBag,
  Receipt,
  Clock,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  Plus,
  Trash2,
  FileText,
  Printer,
  ShieldAlert,
} from 'lucide-react';
import { useSbms } from '../../context/SbmsContext';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Input, Select } from '../../components/ui/FormControls';
import { Modal } from '../../components/ui/Modal';
import { StatusText } from '../../components/ui/StatusText';
import { AgentNavKey, ShiftFinalReport } from '../../types/sbms';
import { formatCurrency, formatNumber } from '../../lib/utils';

interface AgentWorkspaceProps {
  activeTab: AgentNavKey;
  onNavigate: (tab: AgentNavKey) => void;
}

export const AgentWorkspace: React.FC<AgentWorkspaceProps> = ({ activeTab, onNavigate }) => {
  const {
    user,
    shifts,
    handovers,
    recipes,
    rawMaterials,
    customers,
    productionRecords,
    sales,
    breadMovements,
    expenses,
    settings,
    registerProduction,
    registerSale,
    registerBreadMovement,
    addExpense,
    openAgentShift,
    closeAgentShift,
    fetchShiftReport,
    isOfflineMode,
    offlineQueue,
    syncOfflineQueue,
  } = useSbms();

  const agentPerms = useMemo(
    () =>
      Array.isArray(user?.permissions)
        ? user.permissions
        : ['PRODUCTION_LOG', 'SALES_LOG', 'EXPENSES_LOG', 'SHIFT_MANAGE'],
    [user?.permissions]
  );

  const hasPerm = (code: string) => user?.role === 'OWNER' || agentPerms.includes(code);

  const activeShift = useMemo(
    () => shifts.find((s) => s.status === 'مفتوحة' && s.agentId === user?.id),
    [shifts, user?.id]
  );

  const latestShift = activeShift || shifts[0];
  const activeRecipes = useMemo(() => recipes.filter((r) => r.isActive !== false), [recipes]);
  const todayStr = new Date().toISOString().slice(0, 10);

  // Production form state
  const [prodDate, setProdDate] = useState(todayStr);
  const [recipeId, setRecipeId] = useState('');
  const [flourBags, setFlourBags] = useState('2');
  const [oilLiters, setOilLiters] = useState('3');
  const [yeastGrams, setYeastGrams] = useState('500');
  const [saltGrams, setSaltGrams] = useState('1000');
  const [sugarGrams, setSugarGrams] = useState('400');
  const [otherIngredients, setOtherIngredients] = useState<
    { inventoryItemId: number; quantity: number }[]
  >([]);
  const [producedLoaves, setProducedLoaves] = useState('1300');
  const [damagedLoaves, setDamagedLoaves] = useState('10');
  const [prodNotes, setProdNotes] = useState('');
  const [prodMsg, setProdMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [submittingProd, setSubmittingProd] = useState(false);

  // Sales & Separate Loss/Return form state
  const [salesMode, setSalesMode] = useState<'sale' | 'return' | 'damaged'>('sale');
  const [saleDate, setSaleDate] = useState(todayStr);
  const [breadType, setBreadType] = useState('');
  const [saleQty, setSaleQty] = useState('200');
  const [unitPrice, setUnitPrice] = useState('250');
  const [paymentType, setPaymentType] = useState<'نقدي' | 'آجل'>('نقدي');
  const [customerId, setCustomerId] = useState('');
  const [saleNotes, setSaleNotes] = useState('');
  const [saleMsg, setSaleMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [submittingSale, setSubmittingSale] = useState(false);

  const [movBreadType, setMovBreadType] = useState('');
  const [movDate, setMovDate] = useState(todayStr);
  const [movQty, setMovQty] = useState('15');
  const [movReason, setMovReason] = useState('');
  const [movMsg, setMovMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [submittingMov, setSubmittingMov] = useState(false);

  // Expenses form state
  const [expDate, setExpDate] = useState(todayStr);
  const [expCategory, setExpCategory] = useState<
    'وقود وغاز' | 'ترحيل ومواصلات' | 'مياه' | 'كهرباء' | 'صيانة' | 'مصروفات تشغيلية أخرى'
  >('وقود وغاز');
  const [expAmount, setExpAmount] = useState('15000');
  const [expMethod, setExpMethod] = useState<'نقداً' | 'تحويل بنكي (بنكك)' | 'شيك'>('نقداً');
  const [expDesc, setExpDesc] = useState('');
  const [expMsg, setExpMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [submittingExp, setSubmittingExp] = useState(false);

  // Shift open/close form state
  const [openDate, setOpenDate] = useState(todayStr);
  const [openShiftName, setOpenShiftName] = useState<
    'الوردية الصباحية' | 'الوردية المسائية' | 'الوردية الليلية'
  >(
    (user?.assignedShift as 'الوردية الصباحية' | 'الوردية المسائية' | 'الوردية الليلية') ||
      'الوردية الصباحية'
  );
  const [openingCash, setOpeningCash] = useState('100000');
  const [openingBread, setOpeningBread] = useState('150');
  const [actualCash, setActualCash] = useState('');
  const [closingBread, setClosingBread] = useState('');
  const [receivedByName, setReceivedByName] = useState('إدارة المخبز');
  const [handoverNotes, setHandoverNotes] = useState('');
  const [shiftError, setShiftError] = useState('');
  const [submittingShift, setSubmittingShift] = useState(false);

  // Shift Final Report Modal state
  const [reportModalOpen, setReportModalOpen] = useState(false);
  const [loadingReport, setLoadingReport] = useState(false);
  const [activeReport, setActiveReport] = useState<ShiftFinalReport | null>(null);

  useEffect(() => {
    if (!recipeId && activeRecipes.length > 0) {
      const first = activeRecipes[0];
      setRecipeId(first.id);
      setFlourBags(String(first.flourBags));
      setOilLiters(String(first.oilLiters));
      setYeastGrams(String(first.yeastGrams));
      setSaltGrams(String(first.saltGrams));
      setSugarGrams(String(first.sugarGrams));
      setProducedLoaves(String(first.expectedYieldLoaves));
      setOtherIngredients(
        (first.otherIngredients || []).map((o) => ({
          inventoryItemId: o.inventoryItemId,
          quantity: o.quantity,
        }))
      );
    }
    if (recipes.length > 0 && !breadType) {
      setBreadType(recipes[0].breadType);
      setUnitPrice(String(recipes[0].unitSellingPrice));
    }
    if (recipes.length > 0 && !movBreadType) {
      setMovBreadType(recipes[0].breadType);
    }
  }, [activeRecipes, recipes, recipeId, breadType, movBreadType]);

  useEffect(() => {
    if (!customerId && customers.length > 0) setCustomerId(customers[0].id);
  }, [customers, customerId]);

  const myProduction = productionRecords.filter((p) => !user?.id || p.agentId === user.id);
  const mySales = sales.filter((s) => !user?.id || s.agentId === user.id);
  const myBreadMovements = breadMovements.filter((m) => !user?.id || m.agentId === user.id);
  const myExpenses = expenses.filter((e) => !user?.fullName || e.responsibleUser === user.fullName);
  const pendingOffline = offlineQueue.filter((q) => q.syncStatus === 'في الانتظار');

  const openReportViewer = async (shiftId: string) => {
    setReportModalOpen(true);
    setLoadingReport(true);
    setActiveReport(null);
    const data = await fetchShiftReport(shiftId);
    setActiveReport(data);
    setLoadingReport(false);
  };

  const renderPermissionDenied = (label: string) => (
    <Card className="max-w-xl mx-auto text-center space-y-3 py-8">
      <ShieldAlert className="w-8 h-8 text-[#B91C1C] mx-auto" />
      <h3 className="text-base font-bold text-[#142D35]">غير مصرح لك بالوصول إلى ({label})</h3>
      <p className="text-xs text-[#5A6B6E]">
        صلاحيات حسابك الحالية لا تتضمن هذه العملية. يمكنك مراجعة المالك لتعديل صلاحياتك.
      </p>
      <Button variant="outline" onClick={() => onNavigate('agent-dashboard')}>
        العودة إلى لوحة الوكيل
      </Button>
    </Card>
  );

  if (activeTab === 'agent-dashboard') {
    const refShift = activeShift || latestShift;
    const availableBread = refShift
      ? refShift.openingBread + refShift.producedBread + refShift.returnedBread
      : 0;
    const expectedRemainingBread = refShift
      ? availableBread -
        refShift.soldBread -
        refShift.damagedBread -
        (refShift.authorizedAdjustments ?? 0)
      : 0;
    const shiftTotalSales = refShift
      ? refShift.cashSalesAmount + refShift.creditSalesAmount
      : mySales
          .filter((s) => s.date === todayStr)
          .reduce((a, s) => a + s.totalAmount, 0);

    return (
      <div className="space-y-6">
        {(isOfflineMode || pendingOffline.length > 0) && (
          <Card className="bg-[#F7EFE0]/55 border-[#D8AD65]" padding="sm">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-start sm:items-center gap-3">
                <AlertTriangle className="w-5 h-5 text-[#9A6714] shrink-0" />
                <div className="text-xs text-[#142D35]">
                  <div className="font-semibold">
                    طابور العمليات المحلي: {pendingOffline.length} عملية بانتظار المزامنة
                  </div>
                  <div className="text-[#5A6B6E] mt-0.5">
                    يتم حفظ كل عملية بمعرف فريد لمنع التكرار عند عودة الاتصال.
                  </div>
                </div>
              </div>
              <Button size="sm" variant="secondary" onClick={syncOfflineQueue}>
                <RefreshCw className="w-3.5 h-3.5" />
                <span>مزامنة الآن</span>
              </Button>
            </div>
          </Card>
        )}

        {/* Current Shift Header + 8 Required Operational Metrics */}
        <Card>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-[#E2E7E5]">
            <div>
              <div className="text-xs text-[#5A6B6E]">الوردية الحالية وحالة الدوام</div>
              <h2 className="text-lg font-bold text-[#142D35] mt-0.5">
                {activeShift
                  ? `${activeShift.shiftName} — ${activeShift.date}`
                  : latestShift
                  ? `آخر وردية: ${latestShift.shiftName} (${latestShift.date})`
                  : 'لا توجد وردية مفتوحة حالياً'}
              </h2>
            </div>
            <div className="flex items-center gap-3">
              {activeShift ? (
                <StatusText tone="success" label="حالة الوردية: مفتوحة ونشطة" />
              ) : (
                <>
                  <StatusText
                    tone={latestShift?.status === 'معتمدة' ? 'success' : 'warning'}
                    label={latestShift ? `حالة الوردية: ${latestShift.status}` : 'حالة الوردية: مغلقة'}
                  />
                  {hasPerm('SHIFT_MANAGE') && (
                    <Button size="sm" onClick={() => onNavigate('agent-shift')}>
                      فتح وردية جديدة
                    </Button>
                  )}
                </>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 pt-4">
            <div className="p-3 rounded-lg bg-[#F5F7F6] border border-[#E2E7E5]">
              <div className="text-[11px] text-[#5A6B6E]">العهدة النقدية الافتتاحية</div>
              <div className="text-lg font-bold font-mono tabular-nums text-[#142D35] mt-1">
                {formatCurrency(refShift?.openingCash ?? 0, settings.currencySymbol)}
              </div>
            </div>
            <div className="p-3 rounded-lg bg-[#F5F7F6] border border-[#E2E7E5]">
              <div className="text-[11px] text-[#5A6B6E]">إنتاج اليوم / الوردية</div>
              <div className="text-lg font-bold font-mono tabular-nums text-[#176B55] mt-1">
                {formatNumber(refShift?.producedBread ?? 0)} رغيف
              </div>
            </div>
            <div className="p-3 rounded-lg bg-[#F5F7F6] border border-[#E2E7E5]">
              <div className="text-[11px] text-[#5A6B6E]">مبيعات اليوم (نقدي + آجل)</div>
              <div className="text-lg font-bold font-mono tabular-nums text-[#142D35] mt-1">
                {formatCurrency(shiftTotalSales, settings.currencySymbol)}
              </div>
              <div className="text-[11px] text-[#5A6B6E] font-mono">
                نقدي: {formatCurrency(refShift?.cashSalesAmount ?? 0)}
              </div>
            </div>
            <div className="p-3 rounded-lg bg-[#F5F7F6] border border-[#E2E7E5]">
              <div className="text-[11px] text-[#5A6B6E]">النقدية المتوقعة بالدرج</div>
              <div className="text-lg font-bold font-mono tabular-nums text-[#176B55] mt-1">
                {formatCurrency(refShift?.expectedCash ?? 0, settings.currencySymbol)}
              </div>
            </div>
            <div className="p-3 rounded-lg bg-[#F5F7F6] border border-[#E2E7E5]">
              <div className="text-[11px] text-[#5A6B6E]">الخبز التالف المسجل</div>
              <div className="text-lg font-bold font-mono tabular-nums text-[#B91C1C] mt-1">
                {formatNumber(refShift?.damagedBread ?? 0)} رغيف
              </div>
            </div>
            <div className="p-3 rounded-lg bg-[#F5F7F6] border border-[#E2E7E5]">
              <div className="text-[11px] text-[#5A6B6E]">المصروفات المسجلة</div>
              <div className="text-lg font-bold font-mono tabular-nums text-[#B91C1C] mt-1">
                {formatCurrency(refShift?.totalExpenses ?? 0, settings.currencySymbol)}
              </div>
            </div>
            <div className="p-3 rounded-lg bg-[#F5F7F6] border border-[#E2E7E5]">
              <div className="text-[11px] text-[#5A6B6E]">الخبز المتاح / المباع</div>
              <div className="text-lg font-bold font-mono tabular-nums text-[#142D35] mt-1">
                {formatNumber(availableBread)} / {formatNumber(refShift?.soldBread ?? 0)}
              </div>
            </div>
            <div className="p-3 rounded-lg bg-[#F5F7F6] border border-[#E2E7E5]">
              <div className="text-[11px] text-[#5A6B6E]">المتبقي المتوقع من الخبز</div>
              <div className="text-lg font-bold font-mono tabular-nums text-[#176B55] mt-1">
                {formatNumber(expectedRemainingBread)} رغيف
              </div>
            </div>
          </div>
        </Card>

        {/* Quick Operational Actions filtered by permissions */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {hasPerm('PRODUCTION_LOG') && (
            <button
              type="button"
              onClick={() => onNavigate('agent-production')}
              className="p-5 bg-white border border-[#E2E7E5] rounded-xl text-right hover:border-[#176B55] transition-colors cursor-pointer"
            >
              <Flame className="w-5 h-5 text-[#D8AD65] mb-3" />
              <div className="text-sm font-bold text-[#142D35]">تسجيل دفعة إنتاج</div>
              <p className="text-xs text-[#5A6B6E] mt-1">إدخال المواد المستهلكة والخبز الناتج</p>
            </button>
          )}

          {hasPerm('SALES_LOG') && (
            <button
              type="button"
              onClick={() => onNavigate('agent-sales')}
              className="p-5 bg-white border border-[#E2E7E5] rounded-xl text-right hover:border-[#176B55] transition-colors cursor-pointer"
            >
              <ShoppingBag className="w-5 h-5 text-[#176B55] mb-3" />
              <div className="text-sm font-bold text-[#142D35]">مبيعات الخبز والمرتجعات</div>
              <p className="text-xs text-[#5A6B6E] mt-1">بيع نقدي/آجل وتسجيل المرتجع والتالف</p>
            </button>
          )}

          {hasPerm('EXPENSES_LOG') && (
            <button
              type="button"
              onClick={() => onNavigate('agent-expenses')}
              className="p-5 bg-white border border-[#E2E7E5] rounded-xl text-right hover:border-[#176B55] transition-colors cursor-pointer"
            >
              <Receipt className="w-5 h-5 text-[#142D35] mb-3" />
              <div className="text-sm font-bold text-[#142D35]">المصروفات اليومية</div>
              <p className="text-xs text-[#5A6B6E] mt-1">غاز، ترحيل، ومصروفات الوردية</p>
            </button>
          )}

          {hasPerm('SHIFT_MANAGE') && (
            <button
              type="button"
              onClick={() => onNavigate('agent-shift')}
              className="p-5 bg-white border border-[#E2E7E5] rounded-xl text-right hover:border-[#176B55] transition-colors cursor-pointer"
            >
              <Clock className="w-5 h-5 text-[#9A6714] mb-3" />
              <div className="text-sm font-bold text-[#142D35]">إدارة الوردية والتسليم</div>
              <p className="text-xs text-[#5A6B6E] mt-1">جرد النقدية ومطابقة العهدة والتقارير</p>
            </button>
          )}
        </div>

        {/* Agent Handovers Summary */}
        {handovers.length > 0 && (
          <Card padding="none" className="overflow-hidden">
            <div className="px-5 py-3.5 border-b border-[#E2E7E5] text-sm font-semibold text-[#142D35]">
              سجل تسليم عهدتي النقدية
            </div>
            <div className="divide-y divide-[#E2E7E5]">
              {handovers.slice(0, 5).map((ho) => (
                <div key={ho.id} className="px-5 py-3 flex items-center justify-between gap-4 text-xs">
                  <div>
                    <span className="font-semibold text-[#142D35]">{ho.shiftName}</span>
                    <span className="font-mono text-[#5A6B6E] mr-2">({ho.shiftDate})</span>
                    <span className="text-[#5A6B6E] mr-2">المستلم: {ho.receivedByName}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="font-mono font-bold text-[#142D35]">
                      {formatCurrency(ho.handedCash)}
                    </span>
                    <StatusText
                      tone={ho.approvedByOwner ? 'success' : 'warning'}
                      label={ho.approvedByOwner ? 'معتمدة' : 'بانتظار الاعتماد'}
                    />
                  </div>
                </div>
              ))}
            </div>
          </Card>
        )}
      </div>
    );
  }

  if (activeTab === 'agent-production') {
    if (!hasPerm('PRODUCTION_LOG')) return renderPermissionDenied('تسجيل الإنتاج');

    const handleSelectRecipe = (id: string) => {
      setRecipeId(id);
      const rec = activeRecipes.find((r) => r.id === id);
      if (rec) {
        setFlourBags(String(rec.flourBags));
        setOilLiters(String(rec.oilLiters));
        setYeastGrams(String(rec.yeastGrams));
        setSaltGrams(String(rec.saltGrams));
        setSugarGrams(String(rec.sugarGrams));
        setProducedLoaves(String(rec.expectedYieldLoaves));
        setOtherIngredients(
          (rec.otherIngredients || []).map((o) => ({
            inventoryItemId: o.inventoryItemId,
            quantity: o.quantity,
          }))
        );
      }
    };

    const handleProdSubmit = async (e: React.FormEvent) => {
      e.preventDefault();
      setProdMsg(null);
      setSubmittingProd(true);
      const res = await registerProduction({
        date: prodDate,
        shiftId: activeShift?.id,
        recipeId,
        shiftName: activeShift?.shiftName || user?.assignedShift || 'الوردية الصباحية',
        flourBags: Number(flourBags),
        oilLiters: Number(oilLiters),
        yeastGrams: Number(yeastGrams),
        saltGrams: Number(saltGrams),
        sugarGrams: Number(sugarGrams),
        otherIngredients: otherIngredients.filter((o) => o.inventoryItemId > 0 && o.quantity > 0),
        producedLoaves: Number(producedLoaves),
        damagedLoaves: Number(damagedLoaves),
        notes: prodNotes,
      });
      setSubmittingProd(false);
      if (!res.ok) {
        setProdMsg({ ok: false, text: res.error || 'تعذر التسجيل' });
        return;
      }
      setProdMsg({ ok: true, text: 'تم تسجيل الإنتاج وخصم المواد الخام من المخزون بنجاح.' });
      setProdNotes('');
    };

    return (
      <div className="space-y-4">
        {!activeShift && (
          <Card className="bg-[#F7EFE0]/60 border-[#D8AD65]" padding="sm">
            <div className="flex items-center justify-between gap-3 text-xs">
              <span className="font-medium text-[#142D35]">
                يجب فتح وردية عمل أولاً قبل تسجيل دفعات الإنتاج.
              </span>
              {hasPerm('SHIFT_MANAGE') && (
                <Button size="sm" onClick={() => onNavigate('agent-shift')}>
                  فتح وردية الآن
                </Button>
              )}
            </div>
          </Card>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <Card className="lg:col-span-5">
            <h2 className="text-base font-bold text-[#142D35] mb-1">تسجيل دفعة إنتاج جديدة</h2>
            <p className="text-xs text-[#5A6B6E] mb-4">
              الوردية النشطة: {activeShift ? `${activeShift.shiftName} (${activeShift.date})` : 'لا توجد وردية مفتوحة'}
            </p>
            <form onSubmit={handleProdSubmit} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Input
                  label="تاريخ الإنتاج"
                  type="date"
                  required
                  value={prodDate}
                  onChange={(e) => setProdDate(e.target.value)}
                />
                <Select label="نوع الخبز" value={recipeId} onChange={(e) => handleSelectRecipe(e.target.value)}>
                  {activeRecipes.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.breadType}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                <Input label="دقيق (جوال)" type="number" step="any" min="0" required value={flourBags} onChange={(e) => setFlourBags(e.target.value)} />
                <Input label="زيت (لتر)" type="number" step="any" min="0" required value={oilLiters} onChange={(e) => setOilLiters(e.target.value)} />
                <Input label="خميرة (جم)" type="number" step="any" min="0" required value={yeastGrams} onChange={(e) => setYeastGrams(e.target.value)} />
                <Input label="ملح (جم)" type="number" step="any" min="0" value={saltGrams} onChange={(e) => setSaltGrams(e.target.value)} />
                <Input label="سكر (جم)" type="number" step="any" min="0" value={sugarGrams} onChange={(e) => setSugarGrams(e.target.value)} />
              </div>

              {/* Extra ingredients */}
              <div className="space-y-2 border-t border-[#E2E7E5] pt-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-[#142D35]">مكونات أخرى مستهلكة</span>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      if (rawMaterials.length === 0) return;
                      setOtherIngredients([
                        ...otherIngredients,
                        { inventoryItemId: Number(rawMaterials[0].id), quantity: 1 },
                      ]);
                    }}
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>مكون إضافي</span>
                  </Button>
                </div>
                {otherIngredients.map((extra, idx) => (
                  <div key={idx} className="grid grid-cols-12 gap-2 items-end">
                    <div className="col-span-7">
                      <Select
                        value={String(extra.inventoryItemId)}
                        onChange={(e) => {
                          const next = [...otherIngredients];
                          next[idx] = { ...next[idx], inventoryItemId: Number(e.target.value) };
                          setOtherIngredients(next);
                        }}
                      >
                        {rawMaterials.map((rm) => (
                          <option key={rm.id} value={rm.id}>
                            {rm.name} ({rm.unit})
                          </option>
                        ))}
                      </Select>
                    </div>
                    <div className="col-span-4">
                      <Input
                        type="number"
                        step="any"
                        min="0.01"
                        value={extra.quantity}
                        onChange={(e) => {
                          const next = [...otherIngredients];
                          next[idx] = { ...next[idx], quantity: Number(e.target.value) };
                          setOtherIngredients(next);
                        }}
                      />
                    </div>
                    <div className="col-span-1 flex justify-end">
                      <button
                        type="button"
                        onClick={() =>
                          setOtherIngredients(otherIngredients.filter((_, i) => i !== idx))
                        }
                        className="p-2 text-[#B91C1C] hover:bg-[#FEF2F2] rounded-lg cursor-pointer"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <Input label="الخبز المنتج (رغيف)" type="number" min="1" required value={producedLoaves} onChange={(e) => setProducedLoaves(e.target.value)} />
                <Input label="التالف أثناء الإنتاج (رغيف)" type="number" min="0" required value={damagedLoaves} onChange={(e) => setDamagedLoaves(e.target.value)} />
              </div>
              <Input label="ملاحظات" value={prodNotes} onChange={(e) => setProdNotes(e.target.value)} placeholder="جودة العجين أو حالة الفرن" />
              {prodMsg && (
                <div className={`text-xs font-medium ${prodMsg.ok ? 'text-[#176B55]' : 'text-[#B91C1C]'}`}>
                  {prodMsg.text}
                </div>
              )}
              <Button type="submit" className="w-full" size="lg" disabled={submittingProd || !activeShift}>
                {submittingProd ? 'جاري الحفظ...' : 'تأكيد وحفظ الإنتاج'}
              </Button>
            </form>
          </Card>

          <Card padding="none" className="lg:col-span-7 overflow-hidden">
            <div className="px-5 py-4 border-b border-[#E2E7E5] text-sm font-semibold text-[#142D35]">
              سجل إنتاجي المسجل ({myProduction.length})
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-right">
                <thead className="bg-[#F5F7F6] text-xs text-[#5A6B6E] border-b border-[#E2E7E5]">
                  <tr>
                    <th className="py-3 px-4 font-medium">المرجع / التاريخ</th>
                    <th className="py-3 px-4 font-medium">الصنف</th>
                    <th className="py-3 px-4 font-medium">الدقيق والمواد</th>
                    <th className="py-3 px-4 font-medium">المنتج</th>
                    <th className="py-3 px-4 font-medium">التالف</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E2E7E5]">
                  {myProduction.map((p) => (
                    <tr key={p.id}>
                      <td className="py-3 px-4 font-mono text-xs">
                        <div className="font-semibold">{p.reference}</div>
                        <div className="text-[#5A6B6E]">{p.date}</div>
                      </td>
                      <td className="py-3 px-4">{p.breadType}</td>
                      <td className="py-3 px-4 text-xs font-mono tabular-nums">
                        {p.flourConsumedBags} جوال · {p.oilConsumedLiters} لتر
                      </td>
                      <td className="py-3 px-4 font-mono tabular-nums font-bold text-[#176B55]">
                        {formatNumber(p.producedLoaves)}
                      </td>
                      <td className="py-3 px-4 font-mono tabular-nums text-[#B91C1C]">{p.damagedLoaves}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      </div>
    );
  }

  if (activeTab === 'agent-sales') {
    if (!hasPerm('SALES_LOG')) return renderPermissionDenied('تسجيل المبيعات والمرتجعات');

    const shiftBreadBalance = activeShift
      ? activeShift.openingBread +
        activeShift.producedBread +
        activeShift.returnedBread -
        activeShift.soldBread -
        activeShift.damagedBread -
        (activeShift.authorizedAdjustments ?? 0)
      : 0;

    const handleSaleSubmit = async (e: React.FormEvent) => {
      e.preventDefault();
      setSaleMsg(null);
      setSubmittingSale(true);
      const res = await registerSale({
        date: saleDate,
        shiftId: activeShift?.id,
        shiftName: activeShift?.shiftName || user?.assignedShift || 'الوردية الصباحية',
        breadType,
        quantity: Number(saleQty),
        returnedQuantity: 0,
        unitPrice: Number(unitPrice),
        paymentType,
        customerId: paymentType === 'آجل' ? customerId : undefined,
        notes: saleNotes.trim() || undefined,
      });
      setSubmittingSale(false);
      if (!res.ok) {
        setSaleMsg({ ok: false, text: res.error || 'خطأ في التسجيل' });
        return;
      }
      setSaleNotes('');
      setSaleMsg({ ok: true, text: 'تم تسجيل عملية البيع وتحديث رصيد الوردية بنجاح.' });
    };

    const handleMovementSubmit = async (e: React.FormEvent) => {
      e.preventDefault();
      setMovMsg(null);
      setSubmittingMov(true);
      const res = await registerBreadMovement({
        date: movDate,
        shiftId: activeShift?.id,
        shiftName: activeShift?.shiftName,
        breadType: movBreadType,
        type: salesMode === 'return' ? 'مرتجع' : 'تالف',
        quantity: Number(movQty),
        reason: movReason.trim(),
      });
      setSubmittingMov(false);
      if (!res.ok) {
        setMovMsg({ ok: false, text: res.error || 'تعذر تسجيل الحركة' });
        return;
      }
      setMovReason('');
      setMovMsg({
        ok: true,
        text:
          salesMode === 'return'
            ? 'تم تسجيل مرتجع الخبز كمعاملة مستقلة وإضافته للمتاح.'
            : 'تم تسجيل الخبز التالف كمعاملة مستقلة وخصمه من الرصيد.',
      });
    };

    return (
      <div className="space-y-4">
        {!activeShift && (
          <Card className="bg-[#F7EFE0]/60 border-[#D8AD65]" padding="sm">
            <div className="flex items-center justify-between gap-3 text-xs">
              <span className="font-medium text-[#142D35]">
                يجب فتح وردية عمل أولاً قبل تسجيل المبيعات أو المرتجعات أو التالف.
              </span>
              {hasPerm('SHIFT_MANAGE') && (
                <Button size="sm" onClick={() => onNavigate('agent-shift')}>
                  فتح وردية الآن
                </Button>
              )}
            </div>
          </Card>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <Card className="lg:col-span-5 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-bold text-[#142D35]">معاملات الخبز اليومية</h2>
              {activeShift && (
                <span className="text-xs font-mono text-[#176B55] font-semibold">
                  المتاح: {formatNumber(shiftBreadBalance)} رغيف
                </span>
              )}
            </div>

            <div className="grid grid-cols-3 gap-1 p-1 bg-[#E2E7E5]/50 rounded-lg text-xs">
              <button
                type="button"
                onClick={() => setSalesMode('sale')}
                className={`py-1.5 font-medium rounded-md cursor-pointer ${
                  salesMode === 'sale' ? 'bg-white text-[#142D35]' : 'text-[#5A6B6E]'
                }`}
              >
                بيع خبز
              </button>
              <button
                type="button"
                onClick={() => setSalesMode('return')}
                className={`py-1.5 font-medium rounded-md cursor-pointer ${
                  salesMode === 'return' ? 'bg-white text-[#142D35]' : 'text-[#5A6B6E]'
                }`}
              >
                مرتجع منفصل
              </button>
              <button
                type="button"
                onClick={() => setSalesMode('damaged')}
                className={`py-1.5 font-medium rounded-md cursor-pointer ${
                  salesMode === 'damaged' ? 'bg-white text-[#B91C1C]' : 'text-[#5A6B6E]'
                }`}
              >
                تالف منفصل
              </button>
            </div>

            {salesMode === 'sale' ? (
              <form onSubmit={handleSaleSubmit} className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <Input
                    label="التاريخ"
                    type="date"
                    required
                    value={saleDate}
                    onChange={(e) => setSaleDate(e.target.value)}
                  />
                  <Select
                    label="نوع الخبز"
                    value={breadType}
                    onChange={(e) => {
                      setBreadType(e.target.value);
                      const rec = recipes.find((r) => r.breadType === e.target.value);
                      if (rec) setUnitPrice(String(rec.unitSellingPrice));
                    }}
                  >
                    {recipes.map((r) => (
                      <option key={r.id} value={r.breadType}>
                        {r.breadType}
                      </option>
                    ))}
                  </Select>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <Input label="الكمية (رغيف)" type="number" min="1" required value={saleQty} onChange={(e) => setSaleQty(e.target.value)} />
                  <Input label="سعر الوحدة" type="number" min="1" required value={unitPrice} onChange={(e) => setUnitPrice(e.target.value)} />
                </div>

                <Select label="طريقة الدفع" value={paymentType} onChange={(e) => setPaymentType(e.target.value as 'نقدي' | 'آجل')}>
                  <option value="نقدي">بيع نقدي</option>
                  <option value="آجل">بيع آجل (على عميل)</option>
                </Select>

                {paymentType === 'آجل' && (
                  <Select label="العميل" value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
                    {customers.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </Select>
                )}

                <Input
                  label="ملاحظات"
                  value={saleNotes}
                  onChange={(e) => setSaleNotes(e.target.value)}
                  placeholder="اختياري"
                />

                <div className="p-3 rounded-lg bg-[#F5F7F6] border border-[#E2E7E5] flex items-center justify-between text-xs">
                  <span>الإجمالي:</span>
                  <span className="font-mono tabular-nums font-bold text-sm text-[#176B55]">
                    {formatCurrency((Number(saleQty) || 0) * (Number(unitPrice) || 0))}
                  </span>
                </div>

                {saleMsg && (
                  <div className={`text-xs font-medium ${saleMsg.ok ? 'text-[#176B55]' : 'text-[#B91C1C]'}`}>
                    {saleMsg.text}
                  </div>
                )}

                <Button type="submit" className="w-full" size="lg" disabled={submittingSale || !activeShift}>
                  {submittingSale ? 'جاري الحفظ...' : 'حفظ عملية البيع'}
                </Button>
              </form>
            ) : (
              <form onSubmit={handleMovementSubmit} className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <Input
                    label="التاريخ"
                    type="date"
                    required
                    value={movDate}
                    onChange={(e) => setMovDate(e.target.value)}
                  />
                  <Select
                    label="نوع الخبز"
                    value={movBreadType}
                    onChange={(e) => setMovBreadType(e.target.value)}
                  >
                    {recipes.map((r) => (
                      <option key={r.id} value={r.breadType}>
                        {r.breadType}
                      </option>
                    ))}
                  </Select>
                </div>

                <Input
                  label={salesMode === 'return' ? 'كمية المرتجع (رغيف)' : 'كمية الخبز التالف (رغيف)'}
                  type="number"
                  min="1"
                  required
                  value={movQty}
                  onChange={(e) => setMovQty(e.target.value)}
                />
                <Input
                  label="السبب / الملاحظة"
                  required
                  value={movReason}
                  onChange={(e) => setMovReason(e.target.value)}
                  placeholder={salesMode === 'return' ? 'مرتجع من موزع أو عميل' : 'سبب تلف الخبز'}
                />

                {movMsg && (
                  <div className={`text-xs font-medium ${movMsg.ok ? 'text-[#176B55]' : 'text-[#B91C1C]'}`}>
                    {movMsg.text}
                  </div>
                )}

                <Button type="submit" className="w-full" size="lg" disabled={submittingMov || !activeShift}>
                  {submittingMov
                    ? 'جاري التسجيل...'
                    : salesMode === 'return'
                    ? 'تسجيل المرتجع في السجل المنفصل'
                    : 'تسجيل الخبز التالف في السجل المنفصل'}
                </Button>
              </form>
            )}
          </Card>

          <div className="lg:col-span-7 space-y-6">
            <Card padding="none" className="overflow-hidden">
              <div className="px-5 py-4 border-b border-[#E2E7E5] text-sm font-semibold text-[#142D35]">
                سجل مبيعاتي ({mySales.length})
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm text-right">
                  <thead className="bg-[#F5F7F6] text-xs text-[#5A6B6E] border-b border-[#E2E7E5]">
                    <tr>
                      <th className="py-3 px-4 font-medium">المرجع / التاريخ</th>
                      <th className="py-3 px-4 font-medium">الصنف</th>
                      <th className="py-3 px-4 font-medium">الكمية</th>
                      <th className="py-3 px-4 font-medium">السداد</th>
                      <th className="py-3 px-4 font-medium">الإجمالي</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#E2E7E5]">
                    {mySales.map((s) => (
                      <tr key={s.id}>
                        <td className="py-3 px-4 font-mono text-xs">
                          <div>{s.reference}</div>
                          <div className="text-[#5A6B6E]">{s.date}</div>
                        </td>
                        <td className="py-3 px-4">{s.breadType}</td>
                        <td className="py-3 px-4 font-mono tabular-nums">{formatNumber(s.quantity)}</td>
                        <td className="py-3 px-4 text-xs">
                          {s.customerName ? `${s.paymentType} (${s.customerName})` : s.paymentType}
                        </td>
                        <td className="py-3 px-4 font-mono tabular-nums font-semibold text-[#176B55]">
                          {formatCurrency(s.totalAmount)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>

            <Card padding="none" className="overflow-hidden">
              <div className="px-5 py-4 border-b border-[#E2E7E5] text-sm font-semibold text-[#142D35]">
                المرتجعات والتالف المنفصلة ({myBreadMovements.length})
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm text-right">
                  <thead className="bg-[#F5F7F6] text-xs text-[#5A6B6E] border-b border-[#E2E7E5]">
                    <tr>
                      <th className="py-3 px-4 font-medium">المرجع</th>
                      <th className="py-3 px-4 font-medium">النوع</th>
                      <th className="py-3 px-4 font-medium">الصنف</th>
                      <th className="py-3 px-4 font-medium">الكمية</th>
                      <th className="py-3 px-4 font-medium">السبب</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#E2E7E5]">
                    {myBreadMovements.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="py-6 text-center text-xs text-[#5A6B6E]">
                          لا توجد مرتجعات أو تالف مسجل.
                        </td>
                      </tr>
                    ) : (
                      myBreadMovements.map((m) => (
                        <tr key={m.id}>
                          <td className="py-3 px-4 font-mono text-xs">{m.reference}</td>
                          <td className="py-3 px-4">
                            <StatusText tone={m.type === 'مرتجع' ? 'neutral' : 'danger'} label={m.type} />
                          </td>
                          <td className="py-3 px-4 text-xs">{m.breadType}</td>
                          <td className="py-3 px-4 font-mono tabular-nums font-bold">
                            {formatNumber(m.quantity)}
                          </td>
                          <td className="py-3 px-4 text-xs text-[#5A6B6E]">{m.reason}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </Card>
          </div>
        </div>
      </div>
    );
  }

  if (activeTab === 'agent-expenses') {
    if (!hasPerm('EXPENSES_LOG')) return renderPermissionDenied('تسجيل المصروفات');

    const handleExpSubmit = async (e: React.FormEvent) => {
      e.preventDefault();
      setExpMsg(null);
      setSubmittingExp(true);
      const res = await addExpense({
        date: expDate,
        category: expCategory,
        amount: Number(expAmount),
        paymentMethod: expMethod,
        description: expDesc,
        shiftId: activeShift?.id,
      });
      setSubmittingExp(false);
      if (!res.ok) {
        setExpMsg({ ok: false, text: res.error || 'تعذر حفظ المصروف' });
        return;
      }
      setExpDesc('');
      setExpMsg({ ok: true, text: 'تم تسجيل المصروف وخصمه من النقدية المتوقعة للوردية.' });
    };

    return (
      <div className="space-y-4">
        {!activeShift && (
          <Card className="bg-[#F7EFE0]/60 border-[#D8AD65]" padding="sm">
            <div className="flex items-center justify-between gap-3 text-xs">
              <span className="font-medium text-[#142D35]">
                يجب فتح وردية عمل أولاً قبل تسجيل مصروفات الوردية.
              </span>
              {hasPerm('SHIFT_MANAGE') && (
                <Button size="sm" onClick={() => onNavigate('agent-shift')}>
                  فتح وردية الآن
                </Button>
              )}
            </div>
          </Card>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <Card className="lg:col-span-5">
            <h2 className="text-base font-bold text-[#142D35] mb-4">تسجيل مصروفات الوردية</h2>
            <form onSubmit={handleExpSubmit} className="space-y-4">
              <Input
                label="تاريخ المصروف"
                type="date"
                required
                value={expDate}
                onChange={(e) => setExpDate(e.target.value)}
              />
              <Select label="البند" value={expCategory} onChange={(e) => setExpCategory(e.target.value as typeof expCategory)}>
                <option value="وقود وغاز">وقود وغاز</option>
                <option value="ترحيل ومواصلات">ترحيل ومواصلات</option>
                <option value="مياه">مياه</option>
                <option value="كهرباء">كهرباء</option>
                <option value="صيانة">صيانة</option>
                <option value="مصروفات تشغيلية أخرى">مصروفات تشغيلية أخرى</option>
              </Select>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Input label="المبلغ (ج.س)" type="number" min="1" required value={expAmount} onChange={(e) => setExpAmount(e.target.value)} />
                <Select label="طريقة الدفع" value={expMethod} onChange={(e) => setExpMethod(e.target.value as typeof expMethod)}>
                  <option value="نقداً">نقداً</option>
                  <option value="تحويل بنكي (بنكك)">تحويل بنكي (بنكك)</option>
                  <option value="شيك">شيك</option>
                </Select>
              </div>
              <Input label="الوصف" required value={expDesc} onChange={(e) => setExpDesc(e.target.value)} placeholder="مثال: تعبئة غاز الفرن" />
              {expMsg && (
                <div className={`text-xs font-medium ${expMsg.ok ? 'text-[#176B55]' : 'text-[#B91C1C]'}`}>
                  {expMsg.text}
                </div>
              )}
              <Button type="submit" className="w-full" size="lg" disabled={submittingExp || !activeShift}>
                {submittingExp ? 'جاري الحفظ...' : 'حفظ المصروف'}
              </Button>
            </form>
          </Card>

          <Card padding="none" className="lg:col-span-7 overflow-hidden">
            <div className="px-5 py-4 border-b border-[#E2E7E5] text-sm font-semibold text-[#142D35]">
              المصروفات المسجلة بواسطتي ({myExpenses.length})
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-right">
                <thead className="bg-[#F5F7F6] text-xs text-[#5A6B6E] border-b border-[#E2E7E5]">
                  <tr>
                    <th className="py-3 px-4 font-medium">المرجع / التاريخ</th>
                    <th className="py-3 px-4 font-medium">البند</th>
                    <th className="py-3 px-4 font-medium">البيان</th>
                    <th className="py-3 px-4 font-medium">المبلغ</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E2E7E5]">
                  {myExpenses.map((ex) => (
                    <tr key={ex.id}>
                      <td className="py-3 px-4 font-mono text-xs">
                        <div>{ex.reference}</div>
                        <div className="text-[#5A6B6E]">{ex.date}</div>
                      </td>
                      <td className="py-3 px-4 font-medium">{ex.category}</td>
                      <td className="py-3 px-4 text-xs text-[#5A6B6E]">{ex.description}</td>
                      <td className="py-3 px-4 font-mono tabular-nums text-[#B91C1C] font-semibold">
                        {formatCurrency(ex.amount)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      </div>
    );
  }

  if (activeTab === 'agent-shift') {
    if (!hasPerm('SHIFT_MANAGE')) return renderPermissionDenied('إدارة الوردية والتسليم');

    const handleOpen = async (e: React.FormEvent) => {
      e.preventDefault();
      setShiftError('');
      setSubmittingShift(true);
      const res = await openAgentShift(
        Number(openingCash),
        Number(openingBread),
        openShiftName,
        openDate
      );
      setSubmittingShift(false);
      if (!res.ok) setShiftError(res.error || 'تعذر فتح الوردية');
    };

    const handleClose = async (e: React.FormEvent) => {
      e.preventDefault();
      setShiftError('');
      if (!activeShift) return;
      if (!actualCash.trim() || !closingBread.trim()) {
        setShiftError('يرجى إدخال النقدية الفعلية والخبز المتبقي لإتمام الإغلاق.');
        return;
      }
      const closingId = activeShift.id;
      setSubmittingShift(true);
      const res = await closeAgentShift(
        closingId,
        Number(actualCash),
        Number(closingBread),
        handoverNotes,
        receivedByName.trim() || 'إدارة المخبز'
      );
      setSubmittingShift(false);
      if (!res.ok) {
        setShiftError(res.error || 'تعذر إغلاق الوردية');
        return;
      }
      setActualCash('');
      setClosingBread('');
      setHandoverNotes('');
      await openReportViewer(closingId);
    };

    const expectedClosingBread = activeShift
      ? activeShift.openingBread +
        activeShift.producedBread +
        activeShift.returnedBread -
        activeShift.soldBread -
        activeShift.damagedBread -
        (activeShift.authorizedAdjustments ?? 0)
      : 0;

    const liveCashDiff =
      activeShift && actualCash !== '' ? Number(actualCash) - activeShift.expectedCash : null;
    const liveBreadDiff =
      activeShift && closingBread !== '' ? Number(closingBread) - expectedClosingBread : null;
    const missingRequiredActivity =
      activeShift ? activeShift.producedBread === 0 && activeShift.soldBread === 0 : false;

    return (
      <div className="max-w-4xl space-y-6">
        {!activeShift ? (
          <Card>
            <h2 className="text-base font-bold text-[#142D35] mb-2">فتح وردية عمل جديدة</h2>
            <p className="text-xs text-[#5A6B6E] mb-4">
              حدد التاريخ ونوع الوردية والعهدة النقدية الافتتاحية وعدد الأرغفة المستلمة.
            </p>
            <form onSubmit={handleOpen} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Input
                  label="تاريخ الوردية"
                  type="date"
                  required
                  value={openDate}
                  onChange={(e) => setOpenDate(e.target.value)}
                />
                <Select
                  label="نوع الوردية"
                  value={openShiftName}
                  onChange={(e) => setOpenShiftName(e.target.value as typeof openShiftName)}
                >
                  <option value="الوردية الصباحية">الوردية الصباحية</option>
                  <option value="الوردية المسائية">الوردية المسائية</option>
                  <option value="الوردية الليلية">الوردية الليلية</option>
                </Select>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Input
                  label="النقدية الافتتاحية (ج.س)"
                  type="number"
                  min="0"
                  required
                  value={openingCash}
                  onChange={(e) => setOpeningCash(e.target.value)}
                />
                <Input
                  label="الخبز الافتتاحي (رغيف)"
                  type="number"
                  min="0"
                  required
                  value={openingBread}
                  onChange={(e) => setOpeningBread(e.target.value)}
                />
              </div>
              {shiftError && <div className="text-xs text-[#B91C1C] font-medium">{shiftError}</div>}
              <Button type="submit" size="lg" disabled={submittingShift}>
                {submittingShift ? 'جاري البدء...' : 'بدء وفتح الوردية'}
              </Button>
            </form>
          </Card>
        ) : (
          <Card>
            <div className="flex items-center justify-between pb-4 border-b border-[#E2E7E5]">
              <div>
                <h2 className="text-base font-bold text-[#142D35]">إغلاق الوردية وتسليم العهدة</h2>
                <p className="text-xs text-[#5A6B6E] mt-0.5">
                  {activeShift.shiftName} · {activeShift.date}
                </p>
              </div>
              <StatusText tone="success" label="مفتوحة" />
            </div>

            {missingRequiredActivity && (
              <div className="mt-4 p-3 rounded-lg bg-[#F7EFE0]/70 border border-[#D8AD65] text-xs text-[#9A6714]">
                تنبيه: لا يمكن إغلاق الوردية قبل تسجيل بيانات الإنتاج أو المبيعات المطلوبة خلال الوردية.
              </div>
            )}

            <div className="grid grid-cols-2 sm:grid-cols-5 gap-4 py-4 border-b border-[#E2E7E5]">
              <div>
                <div className="text-xs text-[#5A6B6E]">عهدة افتتاحية</div>
                <div className="font-mono tabular-nums font-semibold mt-1">
                  {formatCurrency(activeShift.openingCash)}
                </div>
              </div>
              <div>
                <div className="text-xs text-[#5A6B6E]">+ مبيعات نقدية</div>
                <div className="font-mono tabular-nums font-semibold text-[#176B55] mt-1">
                  {formatCurrency(activeShift.cashSalesAmount)}
                </div>
              </div>
              <div>
                <div className="text-xs text-[#5A6B6E]">− مصروفات</div>
                <div className="font-mono tabular-nums font-semibold text-[#B91C1C] mt-1">
                  {formatCurrency(activeShift.totalExpenses)}
                </div>
              </div>
              <div>
                <div className="text-xs text-[#5A6B6E]">= النقدية المتوقعة</div>
                <div className="font-mono tabular-nums font-bold text-[#142D35] mt-1">
                  {formatCurrency(activeShift.expectedCash)}
                </div>
              </div>
              <div>
                <div className="text-xs text-[#5A6B6E]">الخبز المتوقع</div>
                <div className="font-mono tabular-nums font-bold text-[#176B55] mt-1">
                  {formatNumber(expectedClosingBread)} رغيف
                </div>
              </div>
            </div>

            <form onSubmit={handleClose} className="space-y-4 pt-4">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <Input
                  label="النقدية الفعلية المسلمة (ج.س)"
                  type="number"
                  min="0"
                  required
                  value={actualCash}
                  onChange={(e) => setActualCash(e.target.value)}
                  placeholder={String(activeShift.expectedCash)}
                />
                <Input
                  label="الخبز المتبقي الفعلي (رغيف)"
                  type="number"
                  min="0"
                  required
                  value={closingBread}
                  onChange={(e) => setClosingBread(e.target.value)}
                  placeholder={String(expectedClosingBread)}
                />
                <Input
                  label="اسم مستلم العهدة"
                  required
                  value={receivedByName}
                  onChange={(e) => setReceivedByName(e.target.value)}
                />
              </div>

              {(liveCashDiff !== null || liveBreadDiff !== null) && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                  {liveCashDiff !== null && (
                    <div
                      className={`p-3 rounded-lg border flex items-center justify-between ${
                        liveCashDiff === 0
                          ? 'bg-[#176B55]/10 border-[#176B55]/30 text-[#176B55]'
                          : 'bg-[#FEF2F2] border-[#B91C1C]/30 text-[#B91C1C]'
                      }`}
                    >
                      <span>فارق النقدية:</span>
                      <span className="font-mono tabular-nums font-bold">
                        {liveCashDiff === 0 ? 'مطابق (0 ج.س)' : formatCurrency(liveCashDiff)}
                      </span>
                    </div>
                  )}
                  {liveBreadDiff !== null && (
                    <div
                      className={`p-3 rounded-lg border flex items-center justify-between ${
                        liveBreadDiff === 0
                          ? 'bg-[#176B55]/10 border-[#176B55]/30 text-[#176B55]'
                          : 'bg-[#F7EFE0]/70 border-[#D8AD65] text-[#9A6714]'
                      }`}
                    >
                      <span>فارق رصيد الخبز:</span>
                      <span className="font-mono tabular-nums font-bold">
                        {liveBreadDiff === 0 ? 'مطابق (0 رغيف)' : `${formatNumber(liveBreadDiff)} رغيف`}
                      </span>
                    </div>
                  )}
                </div>
              )}

              <Input
                label="ملاحظات التسليم وتفسير أي فارق"
                value={handoverNotes}
                onChange={(e) => setHandoverNotes(e.target.value)}
                placeholder="إلزامي عند وجود فارق نقدي"
              />

              {shiftError && <div className="text-xs text-[#B91C1C] font-medium">{shiftError}</div>}

              <Button type="submit" size="lg" className="w-full" disabled={submittingShift}>
                <CheckCircle2 className="w-4 h-4" />
                <span>{submittingShift ? 'جاري الإغلاق...' : 'إغلاق الوردية وإصدار التقرير الختامي'}</span>
              </Button>
            </form>
          </Card>
        )}

        {/* Shift History & Reports */}
        <Card padding="none" className="overflow-hidden">
          <div className="px-5 py-3.5 border-b border-[#E2E7E5] text-sm font-semibold text-[#142D35]">
            سجل وردياتي وتقارير الإغلاق
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-right">
              <thead className="bg-[#F5F7F6] text-xs text-[#5A6B6E] border-b border-[#E2E7E5]">
                <tr>
                  <th className="py-3 px-4 font-medium">الوردية / التاريخ</th>
                  <th className="py-3 px-4 font-medium">الإنتاج</th>
                  <th className="py-3 px-4 font-medium">المتوقع / المسلم</th>
                  <th className="py-3 px-4 font-medium">الحالة</th>
                  <th className="py-3 px-4 font-medium">التقرير</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E2E7E5]">
                {shifts.map((sh) => (
                  <tr key={sh.id}>
                    <td className="py-3 px-4 text-xs">
                      <div className="font-semibold text-[#142D35]">{sh.shiftName}</div>
                      <div className="font-mono text-[#5A6B6E]">{sh.date}</div>
                    </td>
                    <td className="py-3 px-4 font-mono tabular-nums text-xs">
                      {formatNumber(sh.producedBread)} رغيف
                    </td>
                    <td className="py-3 px-4 font-mono tabular-nums text-xs">
                      {formatCurrency(sh.expectedCash)} /{' '}
                      {sh.actualCash !== undefined ? formatCurrency(sh.actualCash) : '—'}
                    </td>
                    <td className="py-3 px-4">
                      <StatusText
                        tone={
                          sh.status === 'معتمدة'
                            ? 'success'
                            : sh.status === 'مفتوحة'
                            ? 'neutral'
                            : 'warning'
                        }
                        label={sh.status}
                      />
                    </td>
                    <td className="py-3 px-4">
                      <Button variant="outline" size="sm" onClick={() => openReportViewer(sh.id)}>
                        <FileText className="w-3.5 h-3.5" />
                        <span>التقرير</span>
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        {/* Final Shift Report Modal */}
        <Modal
          isOpen={reportModalOpen}
          onClose={() => setReportModalOpen(false)}
          title="التقرير الختامي للوردية"
          maxWidth="xl"
        >
          {loadingReport ? (
            <div className="py-10 text-center text-xs text-[#5A6B6E]">جاري إعداد التقرير...</div>
          ) : !activeReport ? (
            <div className="py-10 text-center text-xs text-[#B91C1C]">تعذر تحميل التقرير.</div>
          ) : (
            <div className="space-y-4 text-xs">
              <div className="flex items-center justify-between pb-3 border-b border-[#E2E7E5]">
                <div>
                  <div className="text-sm font-bold text-[#142D35]">
                    {activeReport.shift.shiftName} — {activeReport.shift.agentName}
                  </div>
                  <div className="font-mono text-[#5A6B6E]">{activeReport.shift.date}</div>
                </div>
                <Button variant="outline" size="sm" onClick={() => window.print()} className="no-print">
                  <Printer className="w-3.5 h-3.5" />
                  <span>طباعة</span>
                </Button>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="p-3 rounded-lg bg-[#F5F7F6] border border-[#E2E7E5]">
                  <div className="text-[#5A6B6E]">إجمالي الإنتاج</div>
                  <div className="font-mono font-bold text-sm mt-1">
                    {formatNumber(activeReport.breadReconciliation.producedBread)} رغيف
                  </div>
                </div>
                <div className="p-3 rounded-lg bg-[#F5F7F6] border border-[#E2E7E5]">
                  <div className="text-[#5A6B6E]">المبيعات النقدية / الآجلة</div>
                  <div className="font-mono font-bold text-sm text-[#176B55] mt-1">
                    {formatCurrency(activeReport.shift.cashSalesAmount)}
                  </div>
                  <div className="font-mono text-[11px] text-[#9A6714]">
                    آجل: {formatCurrency(activeReport.shift.creditSalesAmount)}
                  </div>
                </div>
                <div className="p-3 rounded-lg bg-[#F5F7F6] border border-[#E2E7E5]">
                  <div className="text-[#5A6B6E]">المصروفات</div>
                  <div className="font-mono font-bold text-sm text-[#B91C1C] mt-1">
                    {formatCurrency(activeReport.shift.totalExpenses)}
                  </div>
                </div>
                <div className="p-3 rounded-lg bg-[#F5F7F6] border border-[#E2E7E5]">
                  <div className="text-[#5A6B6E]">المسلم / الفارق</div>
                  <div className="font-mono font-bold text-sm mt-1">
                    {formatCurrency(activeReport.shift.actualCash ?? activeReport.shift.expectedCash)}
                  </div>
                  <div className="font-mono text-[11px]">
                    الفارق: {formatCurrency(activeReport.shift.cashDifference ?? 0)}
                  </div>
                </div>
              </div>
              {activeReport.handover && (
                <div className="p-3 rounded-lg bg-[#176B55]/5 border border-[#176B55]/25">
                  المستلم: <strong>{activeReport.handover.receivedByName}</strong> · الحالة:{' '}
                  {activeReport.handover.approvedByOwner ? 'معتمدة من المالك' : 'بانتظار مراجعة المالك'}
                </div>
              )}
            </div>
          )}
        </Modal>
      </div>
    );
  }

  // agent-history
  return (
    <Card padding="none" className="overflow-hidden">
      <div className="px-5 py-4 border-b border-[#E2E7E5]">
        <h2 className="text-base font-bold text-[#142D35]">سجل النشاط الشخصي للوكيل</h2>
        <p className="text-xs text-[#5A6B6E] mt-0.5">
          عمليات الإنتاج والمبيعات والمرتجعات المسجلة تحت حساب: {user?.fullName}
        </p>
      </div>
      <div className="divide-y divide-[#E2E7E5]">
        {myProduction.map((p) => (
          <div key={p.id} className="px-5 py-3.5 flex items-center justify-between text-xs">
            <div>
              <div className="font-semibold text-[#142D35]">
                إنتاج {formatNumber(p.producedLoaves)} رغيف ({p.breadType})
              </div>
              <div className="text-[#5A6B6E] font-mono mt-0.5">
                {p.reference} · {p.date}
              </div>
            </div>
            <span className="font-mono text-[#176B55]">-{p.flourConsumedBags} جوال دقيق</span>
          </div>
        ))}
        {mySales.map((s) => (
          <div key={s.id} className="px-5 py-3.5 flex items-center justify-between text-xs">
            <div>
              <div className="font-semibold text-[#142D35]">
                بيع {formatNumber(s.quantity)} رغيف ({s.paymentType})
              </div>
              <div className="text-[#5A6B6E] font-mono mt-0.5">
                {s.reference} · {s.date}
              </div>
            </div>
            <span className="font-mono font-semibold text-[#142D35]">{formatCurrency(s.totalAmount)}</span>
          </div>
        ))}
        {myBreadMovements.map((m) => (
          <div key={m.id} className="px-5 py-3.5 flex items-center justify-between text-xs">
            <div>
              <div className="font-semibold text-[#142D35]">
                {m.type} {formatNumber(m.quantity)} رغيف ({m.breadType})
              </div>
              <div className="text-[#5A6B6E] font-mono mt-0.5">
                {m.reference} · {m.date} · {m.reason}
              </div>
            </div>
            <StatusText tone={m.type === 'مرتجع' ? 'neutral' : 'danger'} label={m.type} />
          </div>
        ))}
      </div>
    </Card>
  );
};
