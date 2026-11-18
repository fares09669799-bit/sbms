import React, { useMemo, useState } from 'react';
import {
  RotateCcw,
  Printer,
  FileText,
  UserPlus,
  SlidersHorizontal,
  Edit3,
} from 'lucide-react';
import bakeryEmblem from '../../assets/images/bakery_brand_emblem_1794753872653.jpg';
import { useSbms } from '../../context/SbmsContext';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Input, Select } from '../../components/ui/FormControls';
import { Modal } from '../../components/ui/Modal';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { StatusText } from '../../components/ui/StatusText';
import { formatCurrency, formatNumber } from '../../lib/utils';
import {
  Customer,
  CustomerProfileData,
  PaymentMethod,
} from '../../types/sbms';
import { PAYMENT_METHODS } from './accountingConstants';

export const CustomersPage: React.FC = () => {
  const {
    customers,
    addCustomer,
    updateCustomer,
    fetchCustomerProfile,
    recordCustomerPayment,
    reverseCustomerPayment,
    recordCustomerAdjustment,
    settings,
  } = useSbms();

  const today = new Date().toISOString().slice(0, 10);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');

  // Create/Edit Customer Modal
  const [custModalOpen, setCustModalOpen] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
  const [cName, setCName] = useState('');
  const [cPhone, setCPhone] = useState('');
  const [cAddress, setCAddress] = useState('');
  const [cLimit, setCLimit] = useState('500000');
  const [cStatus, setCStatus] = useState<'نشط' | 'موقوف'>('نشط');
  const [cNotes, setCNotes] = useState('');
  const [cError, setCError] = useState('');
  const [savingCust, setSavingCust] = useState(false);

  // Payment Modal
  const [payingCustomer, setPayingCustomer] = useState<Customer | null>(null);
  const [payAmount, setPayAmount] = useState('100000');
  const [payDate, setPayDate] = useState(today);
  const [payMethod, setPayMethod] = useState<PaymentMethod>('نقداً');
  const [payNotes, setPayNotes] = useState('');
  const [payError, setPayError] = useState('');
  const [submittingPay, setSubmittingPay] = useState(false);

  // Adjustment Modal
  const [adjCustomer, setAdjCustomer] = useState<Customer | null>(null);
  const [adjAmount, setAdjAmount] = useState('0');
  const [adjDate, setAdjDate] = useState(today);
  const [adjReason, setAdjReason] = useState('');
  const [adjError, setAdjError] = useState('');
  const [submittingAdj, setSubmittingAdj] = useState(false);

  // Profile / Statement Modal
  const [profileOpen, setProfileOpen] = useState(false);
  const [loadingProfile, setLoadingProfile] = useState(false);
  const [profileData, setProfileData] = useState<CustomerProfileData | null>(null);
  const [profileTab, setProfileTab] = useState<'statement' | 'payments' | 'sales'>('statement');

  // Reversal
  const [revPayId, setRevPayId] = useState<string | null>(null);
  const [revPayReason, setRevPayReason] = useState('تصحيح تحصيل عميل معتمد');
  const [reversingPay, setReversingPay] = useState(false);

  const totals = useMemo(() => {
    return {
      totalCreditSales: customers.reduce((a, c) => a + c.totalCreditSales, 0),
      totalPayments: customers.reduce((a, c) => a + c.totalPayments, 0),
      totalAdjustments: customers.reduce((a, c) => a + (c.adjustments || 0), 0),
      totalReceivables: customers.reduce(
        (a, c) => a + (c.totalCreditSales - c.totalPayments + (c.adjustments || 0)),
        0
      ),
    };
  }, [customers]);

  const filteredCustomers = useMemo(() => {
    const q = search.trim().toLowerCase();
    return customers.filter((c) => {
      if (statusFilter !== 'ALL' && (c.status || 'نشط') !== statusFilter) return false;
      if (
        q &&
        !c.name.toLowerCase().includes(q) &&
        !c.phone.toLowerCase().includes(q) &&
        !c.address.toLowerCase().includes(q)
      ) {
        return false;
      }
      return true;
    });
  }, [customers, search, statusFilter]);

  const openCreateCustomer = () => {
    setEditingCustomer(null);
    setCName('');
    setCPhone('');
    setCAddress('الخرطوم');
    setCLimit('500000');
    setCStatus('نشط');
    setCNotes('');
    setCError('');
    setCustModalOpen(true);
  };

  const openEditCustomer = (c: Customer) => {
    setEditingCustomer(c);
    setCName(c.name);
    setCPhone(c.phone);
    setCAddress(c.address);
    setCLimit(String(c.creditLimit));
    setCStatus((c.status as 'نشط' | 'موقوف') || 'نشط');
    setCNotes(c.notes || '');
    setCError('');
    setCustModalOpen(true);
  };

  const handleSaveCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    setCError('');
    setSavingCust(true);
    const res = editingCustomer
      ? await updateCustomer(editingCustomer.id, {
          name: cName,
          phone: cPhone,
          address: cAddress,
          creditLimit: Number(cLimit),
          status: cStatus,
          notes: cNotes,
        })
      : await addCustomer({
          name: cName,
          phone: cPhone,
          address: cAddress,
          creditLimit: Number(cLimit),
          notes: cNotes || undefined,
        });
    setSavingCust(false);
    if (!res.ok) {
      setCError(res.error || 'تعذر حفظ بيانات العميل');
      return;
    }
    setCustModalOpen(false);
  };

  const openProfile = async (customerId: string) => {
    setProfileOpen(true);
    setLoadingProfile(true);
    setProfileData(null);
    setProfileTab('statement');
    const data = await fetchCustomerProfile(customerId);
    setProfileData(data);
    setLoadingProfile(false);
  };

  const handlePaymentSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!payingCustomer) return;
    setPayError('');
    setSubmittingPay(true);
    const res = await recordCustomerPayment(payingCustomer.id, Number(payAmount), {
      date: payDate,
      method: payMethod,
      notes: payNotes.trim() || undefined,
    });
    setSubmittingPay(false);
    if (!res.ok) {
      setPayError(res.error || 'تعذر تسجيل التحصيل');
      return;
    }
    const custId = payingCustomer.id;
    setPayingCustomer(null);
    setPayNotes('');
    if (profileOpen && profileData?.customer.id === custId) {
      const updated = await fetchCustomerProfile(custId);
      setProfileData(updated);
    }
  };

  const handleAdjSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!adjCustomer) return;
    setAdjError('');
    setSubmittingAdj(true);
    const res = await recordCustomerAdjustment(adjCustomer.id, {
      amount: Number(adjAmount),
      date: adjDate,
      reason: adjReason.trim(),
    });
    setSubmittingAdj(false);
    if (!res.ok) {
      setAdjError(res.error || 'تعذر تسجيل التسوية');
      return;
    }
    const custId = adjCustomer.id;
    setAdjCustomer(null);
    setAdjReason('');
    if (profileOpen && profileData?.customer.id === custId) {
      const updated = await fetchCustomerProfile(custId);
      setProfileData(updated);
    }
  };

  const handleConfirmReversePayment = async () => {
    if (!revPayId) return;
    setReversingPay(true);
    const res = await reverseCustomerPayment(revPayId, revPayReason.trim());
    setReversingPay(false);
    setRevPayId(null);
    if (res.ok && profileData) {
      const updated = await fetchCustomerProfile(profileData.customer.id);
      setProfileData(updated);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-[#142D35]">العملاء والمديونيات (الذمم المدينة)</h2>
          <p className="text-xs text-[#5A6B6E] mt-1">
            معادلة الرصيد المعتمدة: رصيد العميل = المبيعات الآجلة − التحصيلات + التسويات المعتمدة.
          </p>
        </div>
        <Button onClick={openCreateCustomer}>
          <UserPlus className="w-4 h-4" />
          <span>إضافة عميل جديد</span>
        </Button>
      </div>

      {/* KPI Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        <Card>
          <div className="text-xs text-[#5A6B6E]">إجمالي المبيعات الآجلة</div>
          <div className="text-xl font-bold font-mono tabular-nums text-[#142D35] mt-1.5">
            {formatCurrency(totals.totalCreditSales, settings.currencySymbol)}
          </div>
        </Card>
        <Card>
          <div className="text-xs text-[#5A6B6E]">إجمالي التحصيلات</div>
          <div className="text-xl font-bold font-mono tabular-nums text-[#176B55] mt-1.5">
            {formatCurrency(totals.totalPayments, settings.currencySymbol)}
          </div>
        </Card>
        <Card>
          <div className="text-xs text-[#5A6B6E]">التسويات المعتمدة</div>
          <div className="text-xl font-bold font-mono tabular-nums text-[#5A6B6E] mt-1.5">
            {formatCurrency(totals.totalAdjustments, settings.currencySymbol)}
          </div>
        </Card>
        <Card>
          <div className="text-xs text-[#5A6B6E]">صافي الذمم المدينة القائمة</div>
          <div className="text-xl font-bold font-mono tabular-nums text-[#B91C1C] mt-1.5">
            {formatCurrency(totals.totalReceivables, settings.currencySymbol)}
          </div>
        </Card>
      </div>

      <Card padding="sm">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="relative">
            <Input
              label="بحث عن عميل"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="الاسم، الهاتف، أو العنوان..."
            />
          </div>
          <Select
            label="حالة العميل"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="ALL">جميع العملاء ({customers.length})</option>
            <option value="نشط">نشط</option>
            <option value="موقوف">موقوف</option>
          </Select>
        </div>
      </Card>

      <Card padding="none" className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-right">
            <thead className="bg-[#F5F7F6] text-xs text-[#5A6B6E] border-b border-[#E2E7E5]">
              <tr>
                <th className="py-3 px-4 font-medium">العميل / العنوان</th>
                <th className="py-3 px-4 font-medium">الهاتف</th>
                <th className="py-3 px-4 font-medium">سقف الائتمان</th>
                <th className="py-3 px-4 font-medium">المسحوبات الآجلة</th>
                <th className="py-3 px-4 font-medium">التحصيلات</th>
                <th className="py-3 px-4 font-medium">التسويات</th>
                <th className="py-3 px-4 font-medium">الرصيد المتبقي</th>
                <th className="py-3 px-4 font-medium">الإجراءات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E2E7E5]">
              {filteredCustomers.map((c) => {
                const bal = Number(
                  (c.totalCreditSales - c.totalPayments + (c.adjustments || 0)).toFixed(2)
                );
                return (
                  <tr key={c.id} className="hover:bg-[#F5F7F6]/60">
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-[#142D35]">{c.name}</span>
                        <StatusText
                          tone={(c.status || 'نشط') === 'نشط' ? 'success' : 'neutral'}
                          label={c.status || 'نشط'}
                        />
                      </div>
                      <div className="text-xs text-[#5A6B6E]">{c.address}</div>
                    </td>
                    <td className="py-3 px-4 font-mono text-xs" dir="ltr">
                      {c.phone}
                    </td>
                    <td className="py-3 px-4 font-mono tabular-nums text-xs">
                      {formatCurrency(c.creditLimit)}
                    </td>
                    <td className="py-3 px-4 font-mono tabular-nums">
                      {formatCurrency(c.totalCreditSales)}
                    </td>
                    <td className="py-3 px-4 font-mono tabular-nums text-[#176B55]">
                      {formatCurrency(c.totalPayments)}
                    </td>
                    <td className="py-3 px-4 font-mono tabular-nums text-xs text-[#5A6B6E]">
                      {formatCurrency(c.adjustments || 0)}
                    </td>
                    <td className="py-3 px-4 font-mono tabular-nums font-bold text-[#B91C1C]">
                      {formatCurrency(bal)}
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <Button size="sm" variant="outline" onClick={() => openProfile(c.id)}>
                          <FileText className="w-3.5 h-3.5" />
                          <span>كشف حساب</span>
                        </Button>
                        <Button
                          size="sm"
                          onClick={() => {
                            setPayAmount(String(Math.max(1000, bal > 0 ? bal : 50000)));
                            setPayError('');
                            setPayingCustomer(c);
                          }}
                        >
                          تحصيل
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            setAdjAmount('0');
                            setAdjReason('');
                            setAdjError('');
                            setAdjCustomer(c);
                          }}
                          title="تسوية رصيد"
                        >
                          <SlidersHorizontal className="w-3.5 h-3.5" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => openEditCustomer(c)}
                          title="تعديل"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Add/Edit Customer Modal */}
      <Modal
        isOpen={custModalOpen}
        onClose={() => setCustModalOpen(false)}
        title={editingCustomer ? `تعديل بيانات العميل: ${editingCustomer.name}` : 'إضافة عميل آجل جديد'}
      >
        <form onSubmit={handleSaveCustomer} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input
              label="اسم العميل / المنشأة"
              required
              value={cName}
              onChange={(e) => setCName(e.target.value)}
            />
            <Input
              label="رقم الهاتف"
              required
              value={cPhone}
              onChange={(e) => setCPhone(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input
              label="العنوان"
              required
              value={cAddress}
              onChange={(e) => setCAddress(e.target.value)}
            />
            <Input
              label="سقف الائتمان المسموح (ج.س)"
              type="number"
              min="0"
              required
              value={cLimit}
              onChange={(e) => setCLimit(e.target.value)}
            />
          </div>
          {editingCustomer && (
            <Select
              label="الحالة"
              value={cStatus}
              onChange={(e) => setCStatus(e.target.value as 'نشط' | 'موقوف')}
            >
              <option value="نشط">نشط</option>
              <option value="موقوف">موقوف</option>
            </Select>
          )}
          <Input
            label="ملاحظات"
            value={cNotes}
            onChange={(e) => setCNotes(e.target.value)}
          />
          {cError && <div className="text-xs text-[#B91C1C] font-medium">{cError}</div>}
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => setCustModalOpen(false)}>
              إلغاء
            </Button>
            <Button type="submit" disabled={savingCust}>
              {savingCust ? 'جاري الحفظ...' : 'حفظ البيانات'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Customer Payment Modal */}
      <Modal
        isOpen={Boolean(payingCustomer)}
        onClose={() => setPayingCustomer(null)}
        title={`تحصيل دفعة من عميل: ${payingCustomer?.name || ''}`}
      >
        <form onSubmit={handlePaymentSubmit} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Input
              label="المبلغ المحصل (ج.س)"
              type="number"
              min="1"
              step="any"
              required
              value={payAmount}
              onChange={(e) => setPayAmount(e.target.value)}
            />
            <Input
              label="تاريخ التحصيل"
              type="date"
              required
              value={payDate}
              onChange={(e) => setPayDate(e.target.value)}
            />
            <Select
              label="طريقة التحصيل"
              value={payMethod}
              onChange={(e) => setPayMethod(e.target.value as PaymentMethod)}
            >
              {PAYMENT_METHODS.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </Select>
          </div>
          <Input
            label="ملاحظات / رقم الإيصال"
            value={payNotes}
            onChange={(e) => setPayNotes(e.target.value)}
            placeholder="رقم إشعار بنكك أو سند القبض"
          />
          {payError && <div className="text-xs text-[#B91C1C] font-medium">{payError}</div>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setPayingCustomer(null)}>
              إلغاء
            </Button>
            <Button type="submit" disabled={submittingPay}>
              {submittingPay ? 'جاري الاعتماد...' : 'اعتماد التحصيل'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Customer Balance Adjustment Modal */}
      <Modal
        isOpen={Boolean(adjCustomer)}
        onClose={() => setAdjCustomer(null)}
        title={`تسوية رصيد عميل: ${adjCustomer?.name || ''}`}
        subtitle="أدخل قيمة موجبة (+) لزيادة المديونية أو سالبة (−) لمنح خصم / تسوية دائنة."
      >
        <form onSubmit={handleAdjSubmit} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input
              label="قيمة التسوية (ج.س)"
              type="number"
              step="any"
              required
              value={adjAmount}
              onChange={(e) => setAdjAmount(e.target.value)}
            />
            <Input
              label="تاريخ التسوية"
              type="date"
              required
              value={adjDate}
              onChange={(e) => setAdjDate(e.target.value)}
            />
          </div>
          <Input
            label="سبب التسوية المحاسبية"
            required
            value={adjReason}
            onChange={(e) => setAdjReason(e.target.value)}
            placeholder="مثال: خصم مسموح به أو تسوية فروقات حساب"
          />
          {adjError && <div className="text-xs text-[#B91C1C] font-medium">{adjError}</div>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setAdjCustomer(null)}>
              إلغاء
            </Button>
            <Button type="submit" disabled={submittingAdj}>
              {submittingAdj ? 'جاري التسجيل...' : 'اعتماد التسوية'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Customer Statement & Profile Modal */}
      <Modal
        isOpen={profileOpen}
        onClose={() => setProfileOpen(false)}
        title="كشف حساب العميل وسجل المعاملات"
        maxWidth="xl"
      >
        {loadingProfile ? (
          <div className="py-10 text-center text-xs text-[#5A6B6E]">جاري تحميل كشف الحساب...</div>
        ) : !profileData ? (
          <div className="py-10 text-center text-xs text-[#B91C1C]">تعذر تحميل بيانات العميل.</div>
        ) : (
          <div className="space-y-4 print-container text-xs">
            {/* Printable Header with Bakery Logo */}
            <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-[#E2E7E5]">
              <div className="flex items-center gap-3">
                <img
                  src={bakeryEmblem}
                  alt={settings.bakeryName}
                  className="w-10 h-10 rounded-lg object-cover border border-[#E2E7E5]"
                />
                <div>
                  <div className="text-sm font-bold text-[#142D35]">
                    {settings.bakeryName} — كشف حساب: {profileData.customer.name}
                  </div>
                  <div className="text-[#5A6B6E]">
                    هاتف: <span dir="ltr">{profileData.customer.phone}</span> · {profileData.customer.address} · تاريخ الإصدار: {today}
                  </div>
                </div>
              </div>
              <Button variant="outline" size="sm" onClick={() => window.print()} className="no-print">
                <Printer className="w-3.5 h-3.5" />
                <span>طباعة كشف الحساب</span>
              </Button>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="p-3 rounded-lg bg-[#F5F7F6] border border-[#E2E7E5]">
                <div className="text-[#5A6B6E]">إجمالي المبيعات الآجلة</div>
                <div className="font-mono font-bold text-sm mt-1">
                  {formatCurrency(profileData.customer.totalCreditSales)}
                </div>
              </div>
              <div className="p-3 rounded-lg bg-[#F5F7F6] border border-[#E2E7E5]">
                <div className="text-[#5A6B6E]">إجمالي التحصيلات</div>
                <div className="font-mono font-bold text-sm text-[#176B55] mt-1">
                  {formatCurrency(profileData.customer.totalPayments)}
                </div>
              </div>
              <div className="p-3 rounded-lg bg-[#F5F7F6] border border-[#E2E7E5]">
                <div className="text-[#5A6B6E]">التسويات</div>
                <div className="font-mono font-bold text-sm mt-1">
                  {formatCurrency(profileData.customer.adjustments)}
                </div>
              </div>
              <div className="p-3 rounded-lg bg-[#F5F7F6] border border-[#E2E7E5]">
                <div className="text-[#5A6B6E]">الرصيد المستحق</div>
                <div className="font-mono font-bold text-sm text-[#B91C1C] mt-1">
                  {formatCurrency(profileData.customer.outstandingBalance)}
                </div>
              </div>
            </div>

            <div className="inline-flex items-center gap-1 p-1 bg-[#E2E7E5]/50 rounded-lg no-print">
              {(
                [
                  { id: 'statement', label: `كشف الحساب التراكمي (${profileData.statement.length})` },
                  { id: 'payments', label: `التحصيلات (${profileData.payments.length})` },
                  { id: 'sales', label: `المسحوبات الآجلة (${profileData.creditSales.length})` },
                ] as const
              ).map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setProfileTab(t.id)}
                  className={`px-3 py-1.5 rounded-md font-medium cursor-pointer ${
                    profileTab === t.id ? 'bg-white text-[#142D35]' : 'text-[#5A6B6E]'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>

            {profileTab === 'statement' && (
              <div className="overflow-x-auto border border-[#E2E7E5] rounded-lg">
                <table className="w-full text-right">
                  <thead className="bg-[#F5F7F6] text-[#5A6B6E] border-b border-[#E2E7E5]">
                    <tr>
                      <th className="py-2.5 px-3 font-medium">التاريخ</th>
                      <th className="py-2.5 px-3 font-medium">المرجع</th>
                      <th className="py-2.5 px-3 font-medium">نوع الحركة</th>
                      <th className="py-2.5 px-3 font-medium">البيان</th>
                      <th className="py-2.5 px-3 font-medium">مدين (+)</th>
                      <th className="py-2.5 px-3 font-medium">دائن (−)</th>
                      <th className="py-2.5 px-3 font-medium">الرصيد</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#E2E7E5]">
                    {profileData.statement.map((row) => (
                      <tr key={row.id}>
                        <td className="py-2.5 px-3 font-mono">{row.date}</td>
                        <td className="py-2.5 px-3 font-mono">{row.reference}</td>
                        <td className="py-2.5 px-3 font-medium">{row.type}</td>
                        <td className="py-2.5 px-3 text-[#5A6B6E]">{row.description}</td>
                        <td className="py-2.5 px-3 font-mono">
                          {row.debit > 0 ? formatCurrency(row.debit) : '—'}
                        </td>
                        <td className="py-2.5 px-3 font-mono text-[#176B55]">
                          {row.credit > 0 ? formatCurrency(row.credit) : '—'}
                        </td>
                        <td className="py-2.5 px-3 font-mono font-bold text-[#142D35]">
                          {formatCurrency(row.runningBalance)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {profileTab === 'payments' && (
              <div className="overflow-x-auto border border-[#E2E7E5] rounded-lg">
                <table className="w-full text-right">
                  <thead className="bg-[#F5F7F6] text-[#5A6B6E] border-b border-[#E2E7E5]">
                    <tr>
                      <th className="py-2.5 px-3 font-medium">المرجع / التاريخ</th>
                      <th className="py-2.5 px-3 font-medium">الوسيلة</th>
                      <th className="py-2.5 px-3 font-medium">الملاحظات</th>
                      <th className="py-2.5 px-3 font-medium">المبلغ</th>
                      <th className="py-2.5 px-3 font-medium no-print">إجراء</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#E2E7E5]">
                    {profileData.payments.map((p) => (
                      <tr key={p.id}>
                        <td className="py-2.5 px-3 font-mono">
                          <div>{p.reference}</div>
                          <div className="text-[#5A6B6E]">{p.date}</div>
                        </td>
                        <td className="py-2.5 px-3">{p.method}</td>
                        <td className="py-2.5 px-3 text-[#5A6B6E]">{p.notes || '—'}</td>
                        <td
                          className={`py-2.5 px-3 font-mono font-bold ${
                            p.amount < 0 ? 'text-[#B91C1C]' : 'text-[#176B55]'
                          }`}
                        >
                          {formatCurrency(p.amount)}
                        </td>
                        <td className="py-2.5 px-3 no-print">
                          {!p.isReversal && p.amount > 0 ? (
                            <button
                              type="button"
                              onClick={() => {
                                setRevPayReason('تصحيح تحصيل عميل معتمد');
                                setRevPayId(p.id);
                              }}
                              className="inline-flex items-center gap-1 text-[#9A6714] hover:underline cursor-pointer"
                            >
                              <RotateCcw className="w-3 h-3" />
                              <span>عكس التحصيل</span>
                            </button>
                          ) : (
                            <span className="text-[#5A6B6E]">قيد عكسي</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {profileTab === 'sales' && (
              <div className="overflow-x-auto border border-[#E2E7E5] rounded-lg">
                <table className="w-full text-right">
                  <thead className="bg-[#F5F7F6] text-[#5A6B6E] border-b border-[#E2E7E5]">
                    <tr>
                      <th className="py-2.5 px-3 font-medium">المرجع / التاريخ</th>
                      <th className="py-2.5 px-3 font-medium">الصنف</th>
                      <th className="py-2.5 px-3 font-medium">الكمية</th>
                      <th className="py-2.5 px-3 font-medium">الوكيل</th>
                      <th className="py-2.5 px-3 font-medium">الإجمالي</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#E2E7E5]">
                    {profileData.creditSales.map((s) => (
                      <tr key={s.id}>
                        <td className="py-2.5 px-3 font-mono">
                          <div>{s.reference}</div>
                          <div className="text-[#5A6B6E]">{s.date}</div>
                        </td>
                        <td className="py-2.5 px-3">{s.breadType}</td>
                        <td className="py-2.5 px-3 font-mono">{formatNumber(s.quantity)} رغيف</td>
                        <td className="py-2.5 px-3">{s.agentName}</td>
                        <td className="py-2.5 px-3 font-mono font-bold">
                          {formatCurrency(s.totalAmount)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </Modal>

      <ConfirmDialog
        isOpen={Boolean(revPayId)}
        onClose={() => setRevPayId(null)}
        onConfirm={handleConfirmReversePayment}
        loading={reversingPay}
        tone="warning"
        title="تأكيد عكس دفعة تحصيل عميل"
        message="سيتم إنشاء قيد عكسي سالب وإعادة المبلغ إلى مديونية العميل وخصمه من الخزينة."
        confirmLabel="تنفيذ القيد العكسي"
      >
        <Input
          label="سبب القيد العكسي"
          value={revPayReason}
          onChange={(e) => setRevPayReason(e.target.value)}
        />
      </ConfirmDialog>
    </div>
  );
};
