import React, { useEffect, useMemo, useState } from 'react';
import { Plus, ShoppingBag, RotateCcw } from 'lucide-react';
import { useSbms } from '../../context/SbmsContext';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Input, Select } from '../../components/ui/FormControls';
import { Modal } from '../../components/ui/Modal';
import { StatusText } from '../../components/ui/StatusText';
import { formatCurrency, formatNumber } from '../../lib/utils';

export const SalesPage: React.FC = () => {
  const {
    sales,
    breadMovements,
    recipes,
    customers,
    shifts,
    agents,
    registerSale,
    registerBreadMovement,
    settings,
  } = useSbms();

  const [activeTab, setActiveTab] = useState<'sales' | 'movements'>('sales');
  const [filterPayment, setFilterPayment] = useState<'ALL' | 'نقدي' | 'آجل'>('ALL');
  const [filterShift, setFilterShift] = useState<string>('ALL');
  const [filterAgent, setFilterAgent] = useState<string>('ALL');
  const [filterDate, setFilterDate] = useState<string>('');
  const [selectedShiftId, setSelectedShiftId] = useState<string>('');

  // Sale Modal
  const [modalOpen, setModalOpen] = useState(false);
  const [saleDate, setSaleDate] = useState(new Date().toISOString().slice(0, 10));
  const [shiftName, setShiftName] = useState('الوردية الصباحية');
  const [breadType, setBreadType] = useState(recipes[0]?.breadType || 'عيش بلدي سوداني');
  const [quantity, setQuantity] = useState('400');
  const [returnedQty, setReturnedQty] = useState('0');
  const [unitPrice, setUnitPrice] = useState('250');
  const [paymentType, setPaymentType] = useState<'نقدي' | 'آجل'>('نقدي');
  const [customerId, setCustomerId] = useState(customers[0]?.id || '');
  const [saleNotes, setSaleNotes] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Separate Bread Movement Modal
  const [movModalOpen, setMovModalOpen] = useState(false);
  const [movDate, setMovDate] = useState(new Date().toISOString().slice(0, 10));
  const [movShiftName, setMovShiftName] = useState('الوردية الصباحية');
  const [movBreadType, setMovBreadType] = useState(recipes[0]?.breadType || 'عيش بلدي سوداني');
  const [movType, setMovType] = useState<'مرتجع' | 'تالف' | 'تعديل معتمد'>('مرتجع');
  const [movQuantity, setMovQuantity] = useState('20');
  const [movReason, setMovReason] = useState('');
  const [movError, setMovError] = useState('');
  const [submittingMov, setSubmittingMov] = useState(false);

  useEffect(() => {
    if (!customerId && customers.length > 0) setCustomerId(customers[0].id);
  }, [customers, customerId]);

  useEffect(() => {
    if (recipes.length > 0 && !recipes.some((r) => r.breadType === breadType)) {
      setBreadType(recipes[0].breadType);
      setUnitPrice(String(recipes[0].unitSellingPrice));
    }
    if (recipes.length > 0 && !recipes.some((r) => r.breadType === movBreadType)) {
      setMovBreadType(recipes[0].breadType);
    }
  }, [recipes, breadType, movBreadType]);

  const activeShift = useMemo(() => {
    if (selectedShiftId) {
      const found = shifts.find((s) => s.id === selectedShiftId);
      if (found) return found;
    }
    return shifts.find((s) => s.status === 'مفتوحة') || shifts[0];
  }, [shifts, selectedShiftId]);

  const breadFlow = useMemo(() => {
    const opening = activeShift?.openingBread ?? 0;
    const produced = activeShift?.producedBread ?? 0;
    const returned = activeShift?.returnedBread ?? 0;
    const sold = activeShift?.soldBread ?? 0;
    const damaged = activeShift?.damagedBread ?? 0;
    const adjustments = activeShift?.authorizedAdjustments ?? 0;
    const available = opening + produced + returned;
    const expectedClosing = available - sold - damaged - adjustments;
    return {
      opening,
      produced,
      returned,
      sold,
      damaged,
      adjustments,
      available,
      expectedClosing,
    };
  }, [activeShift]);

  const filteredSales = useMemo(() => {
    return sales.filter((s) => {
      if (filterPayment !== 'ALL' && s.paymentType !== filterPayment) return false;
      if (filterShift !== 'ALL' && s.shiftName !== filterShift) return false;
      if (filterAgent !== 'ALL' && s.agentName !== filterAgent) return false;
      if (filterDate && s.date !== filterDate) return false;
      return true;
    });
  }, [sales, filterPayment, filterShift, filterAgent, filterDate]);

  const filteredMovements = useMemo(() => {
    return breadMovements.filter((m) => {
      if (filterShift !== 'ALL' && m.shiftName !== filterShift) return false;
      if (filterAgent !== 'ALL' && m.agentName !== filterAgent) return false;
      if (filterDate && m.date !== filterDate) return false;
      return true;
    });
  }, [breadMovements, filterShift, filterAgent, filterDate]);

  const cashSalesTotal = filteredSales
    .filter((s) => s.paymentType === 'نقدي')
    .reduce((a, s) => a + s.totalAmount, 0);
  const creditSalesTotal = filteredSales
    .filter((s) => s.paymentType === 'آجل')
    .reduce((a, s) => a + s.totalAmount, 0);

  const handleBreadTypeChange = (nextBread: string) => {
    setBreadType(nextBread);
    const rec = recipes.find((r) => r.breadType === nextBread);
    if (rec) setUnitPrice(String(rec.unitSellingPrice));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    const res = await registerSale({
      date: saleDate,
      shiftName,
      breadType,
      quantity: Number(quantity),
      returnedQuantity: Number(returnedQty) || 0,
      unitPrice: Number(unitPrice),
      paymentType,
      customerId: paymentType === 'آجل' ? customerId : undefined,
      notes: saleNotes.trim() || undefined,
    });
    setSubmitting(false);
    if (!res.ok) {
      setError(res.error || 'تعذر تسجيل عملية البيع');
      return;
    }
    setSaleNotes('');
    setModalOpen(false);
  };

  const handleSubmitMovement = async (e: React.FormEvent) => {
    e.preventDefault();
    setMovError('');
    setSubmittingMov(true);
    const res = await registerBreadMovement({
      date: movDate,
      shiftName: movShiftName,
      breadType: movBreadType,
      type: movType,
      quantity: Number(movQuantity),
      reason: movReason.trim(),
    });
    setSubmittingMov(false);
    if (!res.ok) {
      setMovError(res.error || 'تعذر تسجيل حركة الخبز');
      return;
    }
    setMovReason('');
    setMovModalOpen(false);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-[#142D35]">إدارة المبيعات ومطابقة حركة الخبز</h2>
          <p className="text-xs text-[#5A6B6E] mt-1">
            فصل كامل بين معاملات الإنتاج والمبيعات النقدية والآجلة والمرتجعات والتالف والتسويات المعتمدة.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => setMovModalOpen(true)}>
            <RotateCcw className="w-4 h-4" />
            <span>تسجيل مرتجع / تالف / تسوية</span>
          </Button>
          <Button onClick={() => setModalOpen(true)}>
            <Plus className="w-4 h-4" />
            <span>تسجيل عملية بيع</span>
          </Button>
        </div>
      </div>

      {/* Bread Balance Equation Card */}
      <Card>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-3">
          <div className="text-xs font-semibold text-[#142D35] flex items-center gap-2">
            <ShoppingBag className="w-4 h-4 text-[#176B55]" />
            <span>
              معادلة رصيد الخبز ({activeShift ? `${activeShift.shiftName} — ${activeShift.agentName}` : 'لا توجد وردية'})
            </span>
          </div>
          {shifts.length > 0 && (
            <div className="flex items-center gap-2 w-full sm:w-auto">
              <Select
                value={activeShift?.id || ''}
                onChange={(e) => setSelectedShiftId(e.target.value)}
                className="w-full sm:w-56 text-xs"
              >
                {shifts.map((sh) => (
                  <option key={sh.id} value={sh.id}>
                    {sh.shiftName} · {sh.agentName} ({sh.date})
                  </option>
                ))}
              </Select>
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-4 pt-2 border-t border-[#E2E7E5]">
          <div>
            <div className="text-[11px] text-[#5A6B6E]">رصيد أول الوردية</div>
            <div className="text-base font-bold font-mono tabular-nums mt-0.5">
              {formatNumber(breadFlow.opening)}
            </div>
          </div>
          <div>
            <div className="text-[11px] text-[#5A6B6E]">+ الإنتاج المسجل</div>
            <div className="text-base font-bold font-mono tabular-nums text-[#176B55] mt-0.5">
              {formatNumber(breadFlow.produced)}
            </div>
          </div>
          <div>
            <div className="text-[11px] text-[#5A6B6E]">+ المرتجعات</div>
            <div className="text-base font-bold font-mono tabular-nums mt-0.5">
              {formatNumber(breadFlow.returned)}
            </div>
          </div>
          <div>
            <div className="text-[11px] text-[#5A6B6E]">= المتاح للبيع</div>
            <div className="text-base font-bold font-mono tabular-nums text-[#142D35] mt-0.5">
              {formatNumber(breadFlow.available)}
            </div>
          </div>
          <div>
            <div className="text-[11px] text-[#5A6B6E]">− المباع / التالف</div>
            <div className="text-base font-bold font-mono tabular-nums text-[#B91C1C] mt-0.5">
              {formatNumber(breadFlow.sold)} / {formatNumber(breadFlow.damaged)}
            </div>
          </div>
          <div>
            <div className="text-[11px] text-[#5A6B6E]">− تسويات معتمدة</div>
            <div className="text-base font-bold font-mono tabular-nums text-[#9A6714] mt-0.5">
              {formatNumber(breadFlow.adjustments)}
            </div>
          </div>
          <div>
            <div className="text-[11px] text-[#5A6B6E]">= الإغلاق المتوقع</div>
            <div className="text-base font-bold font-mono tabular-nums text-[#176B55] mt-0.5">
              {formatNumber(breadFlow.expectedClosing)} رغيف
            </div>
          </div>
        </div>
      </Card>

      {/* Tabs + Revenue Split + Multi-Filters */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-4">
          <div className="inline-flex items-center gap-1 p-1 bg-[#E2E7E5]/50 rounded-lg">
            <button
              type="button"
              onClick={() => setActiveTab('sales')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md cursor-pointer ${
                activeTab === 'sales' ? 'bg-white text-[#142D35]' : 'text-[#5A6B6E]'
              }`}
            >
              سجل المبيعات اليومية ({filteredSales.length})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('movements')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md cursor-pointer ${
                activeTab === 'movements' ? 'bg-white text-[#142D35]' : 'text-[#5A6B6E]'
              }`}
            >
              المرتجعات والتالف والتسويات ({filteredMovements.length})
            </button>
          </div>

          <div className="flex items-center gap-4 text-xs">
            <div>
              <span className="text-[#5A6B6E]">النقدي: </span>
              <span className="font-mono tabular-nums font-bold text-[#176B55]">
                {formatCurrency(cashSalesTotal, settings.currencySymbol)}
              </span>
            </div>
            <div>
              <span className="text-[#5A6B6E]">الآجل: </span>
              <span className="font-mono tabular-nums font-bold text-[#9A6714]">
                {formatCurrency(creditSalesTotal, settings.currencySymbol)}
              </span>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 w-full lg:w-auto">
          <Input
            type="date"
            value={filterDate}
            onChange={(e) => setFilterDate(e.target.value)}
            className="w-full sm:w-36"
          />
          <Select
            value={filterShift}
            onChange={(e) => setFilterShift(e.target.value)}
            className="w-full sm:w-36"
          >
            <option value="ALL">كل الورديات</option>
            <option value="الوردية الصباحية">الوردية الصباحية</option>
            <option value="الوردية المسائية">الوردية المسائية</option>
            <option value="الوردية الليلية">الوردية الليلية</option>
          </Select>
          <Select
            value={filterAgent}
            onChange={(e) => setFilterAgent(e.target.value)}
            className="w-full sm:w-40"
          >
            <option value="ALL">كل الوكلاء</option>
            {agents.map((ag) => (
              <option key={ag.id} value={ag.fullName}>
                {ag.fullName}
              </option>
            ))}
          </Select>
          {activeTab === 'sales' && (
            <div className="inline-flex items-center gap-1 p-1 bg-[#E2E7E5]/50 rounded-lg">
              {(['ALL', 'نقدي', 'آجل'] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setFilterPayment(t)}
                  className={`px-2.5 py-1 text-xs font-medium rounded-md cursor-pointer ${
                    filterPayment === t ? 'bg-white text-[#142D35]' : 'text-[#5A6B6E]'
                  }`}
                >
                  {t === 'ALL' ? 'الكل' : t}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {activeTab === 'sales' ? (
        <Card padding="none" className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-right">
              <thead className="bg-[#F5F7F6] text-xs text-[#5A6B6E] border-b border-[#E2E7E5]">
                <tr>
                  <th className="py-3 px-4 font-medium">المرجع / التاريخ</th>
                  <th className="py-3 px-4 font-medium">الوكيل والوردية</th>
                  <th className="py-3 px-4 font-medium">الصنف</th>
                  <th className="py-3 px-4 font-medium">الكمية المباعة</th>
                  <th className="py-3 px-4 font-medium">سعر الوحدة</th>
                  <th className="py-3 px-4 font-medium">الإجمالي</th>
                  <th className="py-3 px-4 font-medium">طريقة الدفع / العميل</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E2E7E5]">
                {filteredSales.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-8 text-center text-xs text-[#5A6B6E]">
                      لا توجد عمليات بيع مطابقة للفلتر المحدد.
                    </td>
                  </tr>
                ) : (
                  filteredSales.map((s) => (
                    <tr key={s.id} className="hover:bg-[#F5F7F6]/60">
                      <td className="py-3.5 px-4">
                        <div className="font-mono text-xs font-semibold">{s.reference}</div>
                        <div className="font-mono text-[11px] text-[#5A6B6E]">{s.date}</div>
                      </td>
                      <td className="py-3.5 px-4 text-xs">
                        <div className="font-medium text-[#142D35]">{s.agentName}</div>
                        <div className="text-[#5A6B6E]">{s.shiftName}</div>
                      </td>
                      <td className="py-3.5 px-4 font-medium">{s.breadType}</td>
                      <td className="py-3.5 px-4 font-mono tabular-nums font-semibold">
                        {formatNumber(s.quantity)} رغيف
                      </td>
                      <td className="py-3.5 px-4 font-mono tabular-nums text-xs">
                        {formatCurrency(s.unitPrice, settings.currencySymbol)}
                      </td>
                      <td className="py-3.5 px-4 font-mono tabular-nums font-bold text-[#176B55]">
                        {formatCurrency(s.totalAmount, settings.currencySymbol)}
                      </td>
                      <td className="py-3.5 px-4">
                        <StatusText
                          tone={s.paymentType === 'نقدي' ? 'success' : 'warning'}
                          label={s.customerName ? `${s.paymentType} · ${s.customerName}` : s.paymentType}
                        />
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </Card>
      ) : (
        <Card padding="none" className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-right">
              <thead className="bg-[#F5F7F6] text-xs text-[#5A6B6E] border-b border-[#E2E7E5]">
                <tr>
                  <th className="py-3 px-4 font-medium">المرجع / التاريخ</th>
                  <th className="py-3 px-4 font-medium">النوع</th>
                  <th className="py-3 px-4 font-medium">الوكيل والوردية</th>
                  <th className="py-3 px-4 font-medium">صنف الخبز</th>
                  <th className="py-3 px-4 font-medium">الكمية</th>
                  <th className="py-3 px-4 font-medium">السبب / التوضيح</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E2E7E5]">
                {filteredMovements.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-8 text-center text-xs text-[#5A6B6E]">
                      لا توجد معاملات مرتجعات أو تالف أو تسويات منفصلة مسجلة حتى الآن.
                    </td>
                  </tr>
                ) : (
                  filteredMovements.map((m) => (
                    <tr key={m.id} className="hover:bg-[#F5F7F6]/60">
                      <td className="py-3.5 px-4">
                        <div className="font-mono text-xs font-semibold">{m.reference}</div>
                        <div className="font-mono text-[11px] text-[#5A6B6E]">{m.date}</div>
                      </td>
                      <td className="py-3.5 px-4">
                        <StatusText
                          tone={
                            m.type === 'مرتجع'
                              ? 'neutral'
                              : m.type === 'تالف'
                              ? 'danger'
                              : 'warning'
                          }
                          label={m.type}
                        />
                      </td>
                      <td className="py-3.5 px-4 text-xs">
                        <div className="font-medium text-[#142D35]">{m.agentName}</div>
                        <div className="text-[#5A6B6E]">{m.shiftName}</div>
                      </td>
                      <td className="py-3.5 px-4 font-medium">{m.breadType}</td>
                      <td className="py-3.5 px-4 font-mono tabular-nums font-bold">
                        {formatNumber(m.quantity)} رغيف
                      </td>
                      <td className="py-3.5 px-4 text-xs text-[#5A6B6E]">{m.reason}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Register Sale Modal */}
      <Modal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        title="تسجيل فاتورة بيع خبز"
        subtitle="فصل البيع النقدي عن البيع الآجل المضاف لرصيد العميل"
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
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
              onChange={(e) => handleBreadTypeChange(e.target.value)}
            >
              {recipes.map((r) => (
                <option key={r.id} value={r.breadType}>
                  {r.breadType}
                </option>
              ))}
            </Select>
            <Select label="الوردية" value={shiftName} onChange={(e) => setShiftName(e.target.value)}>
              <option value="الوردية الصباحية">الوردية الصباحية</option>
              <option value="الوردية المسائية">الوردية المسائية</option>
              <option value="الوردية الليلية">الوردية الليلية</option>
            </Select>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Input
              label="الكمية المباعة (رغيف)"
              type="number"
              min="1"
              required
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
            />
            <Input
              label="المرتجع المرافق (رغيف)"
              type="number"
              min="0"
              value={returnedQty}
              onChange={(e) => setReturnedQty(e.target.value)}
            />
            <Input
              label="سعر الرغيف (ج.س)"
              type="number"
              min="1"
              required
              value={unitPrice}
              onChange={(e) => setUnitPrice(e.target.value)}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Select
              label="نوع السداد"
              value={paymentType}
              onChange={(e) => setPaymentType(e.target.value as 'نقدي' | 'آجل')}
            >
              <option value="نقدي">بيع نقدي فوري</option>
              <option value="آجل">بيع آجل (على حساب العميل)</option>
            </Select>
            {paymentType === 'آجل' && (
              <Select
                label="العميل"
                value={customerId}
                onChange={(e) => setCustomerId(e.target.value)}
              >
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            )}
          </div>

          <Input
            label="ملاحظات البيع"
            value={saleNotes}
            onChange={(e) => setSaleNotes(e.target.value)}
            placeholder="ملاحظات اختيارية"
          />

          <div className="p-3 rounded-lg bg-[#F5F7F6] border border-[#E2E7E5] flex items-center justify-between text-xs">
            <span>إجمالي المبلغ:</span>
            <span className="font-mono tabular-nums font-bold text-sm text-[#176B55]">
              {formatCurrency((Number(quantity) || 0) * (Number(unitPrice) || 0), settings.currencySymbol)}
            </span>
          </div>

          {error && <div className="text-xs text-[#B91C1C]">{error}</div>}

          <div className="flex items-center justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => setModalOpen(false)}>
              إلغاء
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? 'جاري الحفظ...' : 'حفظ عملية البيع'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Separate Bread Movement Modal */}
      <Modal
        isOpen={movModalOpen}
        onClose={() => setMovModalOpen(false)}
        title="تسجيل معاملة خبز منفصلة (مرتجع / تالف / تسوية معتمدة)"
        subtitle="تسجل كمعاملة مستقلة تؤثر مباشرة على معادلة رصيد الخبز بالوردية"
      >
        <form onSubmit={handleSubmitMovement} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input
              label="التاريخ"
              type="date"
              required
              value={movDate}
              onChange={(e) => setMovDate(e.target.value)}
            />
            <Select
              label="نوع الحركة"
              value={movType}
              onChange={(e) => setMovType(e.target.value as 'مرتجع' | 'تالف' | 'تعديل معتمد')}
            >
              <option value="مرتجع">مرتجع خبز (+) يُضاف للمتاح</option>
              <option value="تالف">خبز تالف (−) يُخصم من الرصيد</option>
              <option value="تعديل معتمد">تسوية / تعديل معتمد (−) للمالك فقط</option>
            </Select>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Select
              label="صنف الخبز"
              value={movBreadType}
              onChange={(e) => setMovBreadType(e.target.value)}
            >
              {recipes.map((r) => (
                <option key={r.id} value={r.breadType}>
                  {r.breadType}
                </option>
              ))}
            </Select>
            <Select
              label="الوردية"
              value={movShiftName}
              onChange={(e) => setMovShiftName(e.target.value)}
            >
              <option value="الوردية الصباحية">الوردية الصباحية</option>
              <option value="الوردية المسائية">الوردية المسائية</option>
              <option value="الوردية الليلية">الوردية الليلية</option>
            </Select>
            <Input
              label="الكمية (رغيف)"
              type="number"
              min="1"
              required
              value={movQuantity}
              onChange={(e) => setMovQuantity(e.target.value)}
            />
          </div>

          <Input
            label="السبب / الملاحظة المعتمدة"
            required
            value={movReason}
            onChange={(e) => setMovReason(e.target.value)}
            placeholder="مثال: مرتجع من بقالة النور أو تلف رطوبة الفرن"
          />

          {movError && <div className="text-xs text-[#B91C1C]">{movError}</div>}

          <div className="flex items-center justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => setMovModalOpen(false)}>
              إلغاء
            </Button>
            <Button type="submit" disabled={submittingMov}>
              {submittingMov ? 'جاري التسجيل...' : 'تأكيد تسجيل الحركة'}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
