import React, { useMemo, useState } from 'react';
import {
  ArrowRight,
  Printer,
  CreditCard,
  RotateCcw,
  Receipt,
  CheckCircle2,
  XCircle,
} from 'lucide-react';
import { useSbms } from '../../context/SbmsContext';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Input, Select } from '../../components/ui/FormControls';
import { Modal } from '../../components/ui/Modal';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { StatusText } from '../../components/ui/StatusText';
import { formatCurrency, formatNumber } from '../../lib/utils';
import { PurchaseInvoice, SupplierPayment } from '../../types/sbms';

interface SupplierProfilePageProps {
  supplierId: string;
  onBack: () => void;
}

export const SupplierProfilePage: React.FC<SupplierProfilePageProps> = ({
  supplierId,
  onBack,
}) => {
  const {
    suppliers,
    invoices,
    payments,
    recordSupplierPayment,
    reverseSupplierPayment,
    postPurchaseInvoice,
    cancelPurchaseInvoice,
    settings,
  } = useSbms();

  const supplier = suppliers.find((s) => s.id === supplierId) || suppliers[0];
  const [activeTab, setActiveTab] = useState<'invoices' | 'payments' | 'timeline' | 'statement'>('invoices');
  const [payModalOpen, setPayModalOpen] = useState(false);
  const [payAmount, setPayAmount] = useState('250000');
  const [payDate, setPayDate] = useState(new Date().toISOString().slice(0, 10));
  const [payMethod, setPayMethod] = useState<'نقداً' | 'تحويل بنكي (بنكك)' | 'شيك'>('تحويل بنكي (بنكك)');
  const [payInvoiceId, setPayInvoiceId] = useState('');
  const [payNotes, setPayNotes] = useState('');
  const [payError, setPayError] = useState('');
  const [submittingPay, setSubmittingPay] = useState(false);

  // Payment receipt preview
  const [receiptPayment, setReceiptPayment] = useState<SupplierPayment | null>(null);

  // Reversal confirm dialog
  const [reverseTarget, setReverseTarget] = useState<SupplierPayment | null>(null);
  const [reverseReason, setReverseReason] = useState('تصحيح إداري معتمد من المالك');
  const [reversing, setReversing] = useState(false);
  const [reversalError, setReversalError] = useState('');

  // Invoice post/cancel confirm
  const [postTarget, setPostTarget] = useState<PurchaseInvoice | null>(null);
  const [posting, setPosting] = useState(false);
  const [cancelTarget, setCancelTarget] = useState<PurchaseInvoice | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [cancelling, setCancelling] = useState(false);
  const [actionError, setActionError] = useState('');

  const supplierInvoices = useMemo(
    () => invoices.filter((i) => i.supplierId === supplier?.id),
    [invoices, supplier?.id]
  );

  const supplierPayments = useMemo(
    () => payments.filter((p) => p.supplierId === supplier?.id),
    [payments, supplier?.id]
  );

  const outstandingBalance = supplier
    ? supplier.totalPurchases - supplier.totalPayments + supplier.adjustments
    : 0;

  // Chronological ledger with running balance for printable statement
  const statementRows = useMemo(() => {
    if (!supplier) return [];
    const raw = [
      ...supplierInvoices
        .filter((inv) => (inv.workflowStatus || 'مرحّلة') === 'مرحّلة')
        .map((inv) => ({
          id: `inv-${inv.id}`,
          date: inv.date,
          type: 'فاتورة مشتريات',
          ref: inv.invoiceNumber,
          description: inv.items
            .map((it) => `${it.itemName} (${formatNumber(it.quantity, 2)} ${it.unit})`)
            .join('، '),
          debit: inv.totalAmount,
          credit: 0,
        })),
      ...supplierPayments.map((pay) => ({
        id: `pay-${pay.id}`,
        date: pay.date,
        type: pay.isReversal ? 'قيد عكسي لدفعة' : 'دفعة سداد',
        ref: pay.reference,
        description: `${pay.method}${pay.invoiceNumber ? ` · فاتورة ${pay.invoiceNumber}` : ''}${
          pay.notes ? ` · ${pay.notes}` : ''
        }`,
        debit: pay.amount < 0 ? Math.abs(pay.amount) : 0,
        credit: pay.amount > 0 ? pay.amount : 0,
      })),
    ].sort((a, b) => (a.date > b.date ? 1 : a.date < b.date ? -1 : a.id.localeCompare(b.id)));

    let running = supplier.adjustments;
    return raw.map((row) => {
      running = Number((running + row.debit - row.credit).toFixed(2));
      return { ...row, runningBalance: running };
    });
  }, [supplier, supplierInvoices, supplierPayments]);

  const timeline = useMemo(() => [...statementRows].reverse(), [statementRows]);

  if (!supplier) return null;

  const handleRecordPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    setPayError('');
    const numAmt = Number(payAmount);
    if (!(numAmt > 0)) {
      setPayError('يرجى إدخال مبلغ دفع صحيح أكبر من صفر.');
      return;
    }

    setSubmittingPay(true);
    const res = await recordSupplierPayment({
      supplierId: supplier.id,
      invoiceId: payInvoiceId || undefined,
      date: payDate,
      amount: numAmt,
      method: payMethod,
      notes: payNotes.trim() || undefined,
    });
    setSubmittingPay(false);
    if (!res.ok) {
      setPayError(res.error || 'فشل تسجيل الدفعة');
      return;
    }

    const linkedInv = supplierInvoices.find((i) => i.id === payInvoiceId);
    setPayModalOpen(false);
    setPayNotes('');
    setPayInvoiceId('');
    setReceiptPayment({
      id: `new-${Date.now()}`,
      reference: res.reference || `PAY-${Date.now()}`,
      supplierId: supplier.id,
      invoiceId: linkedInv?.id,
      invoiceNumber: linkedInv?.invoiceNumber,
      date: payDate,
      amount: numAmt,
      method: payMethod,
      notes: payNotes.trim() || undefined,
      recordedBy: 'مالك المخبز',
    });
  };

  const handleConfirmReversePayment = async () => {
    if (!reverseTarget) return;
    setReversing(true);
    setReversalError('');
    const res = await reverseSupplierPayment(
      reverseTarget.id,
      reverseReason.trim() || 'تصحيح إداري معتمد من المالك'
    );
    setReversing(false);
    if (!res.ok) {
      setReversalError(res.error || 'تعذر تنفيذ القيد العكسي');
    }
    setReverseTarget(null);
  };

  const handleConfirmPostInvoice = async () => {
    if (!postTarget) return;
    setPosting(true);
    setActionError('');
    const res = await postPurchaseInvoice(postTarget.id);
    setPosting(false);
    if (!res.ok) setActionError(res.error || 'تعذر ترحيل الفاتورة');
    setPostTarget(null);
  };

  const handleConfirmCancelInvoice = async () => {
    if (!cancelTarget) return;
    if (cancelReason.trim().length < 3) {
      setActionError('يرجى كتابة سبب الإلغاء.');
      return;
    }
    setCancelling(true);
    setActionError('');
    const res = await cancelPurchaseInvoice(cancelTarget.id, cancelReason.trim());
    setCancelling(false);
    if (!res.ok) setActionError(res.error || 'تعذر إلغاء الفاتورة');
    setCancelTarget(null);
    setCancelReason('');
  };

  return (
    <div className="space-y-6 print-container">
      {/* Header & Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 no-print">
        <div className="flex items-center gap-3">
          <Button variant="outline" size="sm" onClick={onBack}>
            <ArrowRight className="w-4 h-4" />
            <span>العودة للموردين</span>
          </Button>
          <div>
            <div className="flex items-center gap-2.5">
              <h2 className="text-lg font-bold text-[#142D35]">{supplier.name}</h2>
              <StatusText
                tone={supplier.status === 'نشط' ? 'success' : 'neutral'}
                label={supplier.status}
              />
            </div>
            <div className="text-xs text-[#5A6B6E] flex items-center gap-2 mt-0.5 flex-wrap">
              <span className="font-mono">{supplier.code}</span>
              <span aria-hidden="true">·</span>
              <span dir="ltr">{supplier.phone}</span>
              <span aria-hidden="true">·</span>
              <span>{supplier.address}</span>
              {supplier.categories.length > 0 && (
                <>
                  <span aria-hidden="true">·</span>
                  <span>{supplier.categories.join('، ')}</span>
                </>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2.5 flex-wrap">
          <Button
            variant="outline"
            onClick={() => {
              setActiveTab('statement');
              setTimeout(() => window.print(), 120);
            }}
          >
            <Printer className="w-4 h-4" />
            <span>طباعة كشف الحساب</span>
          </Button>
          <Button onClick={() => setPayModalOpen(true)}>
            <CreditCard className="w-4 h-4" />
            <span>تسجيل دفعة سداد</span>
          </Button>
        </div>
      </div>

      {actionError && (
        <div className="p-3 rounded-lg bg-[#FEE2E2] text-xs text-[#B91C1C] font-medium no-print">
          {actionError}
        </div>
      )}

      {/* Financial Equation Summary */}
      <Card>
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 divide-y sm:divide-y-0 sm:divide-x sm:divide-x-reverse divide-[#E2E7E5]">
          <div className="pt-2 sm:pt-0 sm:pl-4">
            <div className="text-xs text-[#5A6B6E]">إجمالي المشتريات</div>
            <div className="text-xl font-bold text-[#142D35] font-mono tabular-nums mt-1">
              {formatCurrency(supplier.totalPurchases, settings.currencySymbol)}
            </div>
          </div>
          <div className="pt-2 sm:pt-0 sm:px-4">
            <div className="text-xs text-[#5A6B6E]">إجمالي المدفوعات</div>
            <div className="text-xl font-bold text-[#176B55] font-mono tabular-nums mt-1">
              {formatCurrency(supplier.totalPayments, settings.currencySymbol)}
            </div>
          </div>
          <div className="pt-2 sm:pt-0 sm:px-4">
            <div className="text-xs text-[#5A6B6E]">التسويات / المرتجعات</div>
            <div className="text-xl font-bold text-[#5A6B6E] font-mono tabular-nums mt-1">
              {formatCurrency(supplier.adjustments, settings.currencySymbol)}
            </div>
          </div>
          <div className="pt-2 sm:pt-0 sm:pr-4">
            <div className="text-xs text-[#5A6B6E]">الرصيد المتبقي المستحق</div>
            <div className="text-xl font-bold text-[#B91C1C] font-mono tabular-nums mt-1">
              {formatCurrency(outstandingBalance, settings.currencySymbol)}
            </div>
          </div>
        </div>
        <div className="mt-4 pt-3 border-t border-[#E2E7E5] text-xs text-[#5A6B6E] flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <span>
            المعادلة المحاسبية: الرصيد المستحق = إجمالي المشتريات − إجمالي المدفوعات + التسويات المعتمدة.
          </span>
          {supplier.notes && <span className="text-[#142D35]">ملاحظات: {supplier.notes}</span>}
        </div>
      </Card>

      {/* Tabs */}
      <div className="inline-flex items-center gap-1 p-1 bg-[#E2E7E5]/50 rounded-lg no-print flex-wrap">
        {(
          [
            { id: 'invoices', label: `فواتير الشراء (${supplierInvoices.length})` },
            { id: 'payments', label: `سجل الدفعات (${supplierPayments.length})` },
            { id: 'timeline', label: 'الخط الزمني للمعاملات' },
            { id: 'statement', label: 'كشف حساب تفصيلي للطباعة' },
          ] as const
        ).map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={`px-3.5 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer ${
              activeTab === tab.id ? 'bg-white text-[#142D35]' : 'text-[#5A6B6E] hover:text-[#142D35]'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {activeTab === 'invoices' && (
        <Card padding="none" className="overflow-hidden">
          {supplierInvoices.length === 0 ? (
            <div className="p-8 text-center text-sm text-[#5A6B6E]">
              لا توجد فواتير مشتريات مسجلة لهذا المورد حتى الآن.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-right">
                <thead className="bg-[#F5F7F6] text-xs text-[#5A6B6E] border-b border-[#E2E7E5]">
                  <tr>
                    <th className="py-3 px-4 font-medium">رقم الفاتورة</th>
                    <th className="py-3 px-4 font-medium">التاريخ</th>
                    <th className="py-3 px-4 font-medium">الأصناف والكميات والأسعار</th>
                    <th className="py-3 px-4 font-medium">الإجمالي</th>
                    <th className="py-3 px-4 font-medium">المدفوع</th>
                    <th className="py-3 px-4 font-medium">المتبقي</th>
                    <th className="py-3 px-4 font-medium">الحالة</th>
                    <th className="py-3 px-4 font-medium no-print">إجراءات</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E2E7E5]">
                  {supplierInvoices.map((inv) => {
                    const wf = inv.workflowStatus || 'مرحّلة';
                    return (
                      <tr key={inv.id} className="hover:bg-[#F5F7F6]/60">
                        <td className="py-3.5 px-4 font-mono text-xs font-semibold">
                          {inv.invoiceNumber}
                        </td>
                        <td className="py-3.5 px-4 font-mono text-xs text-[#5A6B6E]">{inv.date}</td>
                        <td className="py-3.5 px-4 text-xs">
                          {inv.items.map((it, i) => (
                            <div key={i}>
                              {it.itemName} — {formatNumber(it.quantity, 2)} {it.unit} ×{' '}
                              <span className="font-mono">{formatCurrency(it.unitPrice)}</span>
                            </div>
                          ))}
                        </td>
                        <td className="py-3.5 px-4 font-mono tabular-nums font-medium">
                          {formatCurrency(inv.totalAmount)}
                        </td>
                        <td className="py-3.5 px-4 font-mono tabular-nums text-[#176B55]">
                          {formatCurrency(inv.paidAmount)}
                        </td>
                        <td className="py-3.5 px-4 font-mono tabular-nums font-semibold text-[#B91C1C]">
                          {formatCurrency(inv.remainingBalance)}
                        </td>
                        <td className="py-3.5 px-4">
                          <StatusText
                            tone={
                              wf === 'ملغاة'
                                ? 'neutral'
                                : wf === 'مسودة'
                                ? 'warning'
                                : inv.status === 'مدفوعة بالكامل'
                                ? 'success'
                                : inv.status === 'مدفوعة جزئياً'
                                ? 'warning'
                                : 'danger'
                            }
                            label={wf === 'مرحّلة' ? inv.status : wf}
                          />
                        </td>
                        <td className="py-3.5 px-4 no-print">
                          <div className="flex items-center gap-1.5">
                            {wf === 'مسودة' && (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => setPostTarget(inv)}
                              >
                                <CheckCircle2 className="w-3.5 h-3.5 text-[#176B55]" />
                                <span>ترحيل</span>
                              </Button>
                            )}
                            {wf !== 'ملغاة' && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => {
                                  setCancelReason('');
                                  setCancelTarget(inv);
                                }}
                                title="إلغاء الفاتورة"
                              >
                                <XCircle className="w-3.5 h-3.5 text-[#B91C1C]" />
                              </Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {activeTab === 'payments' && (
        <Card padding="none" className="overflow-hidden">
          {supplierPayments.length === 0 ? (
            <div className="p-8 text-center text-sm text-[#5A6B6E]">
              لا توجد دفعات سداد مسجلة لهذا المورد حتى الآن.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-right">
                <thead className="bg-[#F5F7F6] text-xs text-[#5A6B6E] border-b border-[#E2E7E5]">
                  <tr>
                    <th className="py-3 px-4 font-medium">المرجع</th>
                    <th className="py-3 px-4 font-medium">التاريخ</th>
                    <th className="py-3 px-4 font-medium">الفاتورة المرتبطة</th>
                    <th className="py-3 px-4 font-medium">طريقة السداد</th>
                    <th className="py-3 px-4 font-medium">المبلغ</th>
                    <th className="py-3 px-4 font-medium">ملاحظات</th>
                    <th className="py-3 px-4 font-medium no-print">الإيصال / التصحيح</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E2E7E5]">
                  {supplierPayments.map((pay) => (
                    <tr key={pay.id} className="hover:bg-[#F5F7F6]/60">
                      <td className="py-3 px-4 font-mono text-xs">{pay.reference}</td>
                      <td className="py-3 px-4 font-mono text-xs text-[#5A6B6E]">{pay.date}</td>
                      <td className="py-3 px-4 font-mono text-xs text-[#5A6B6E]">
                        {pay.invoiceNumber || 'دفعة على الحساب'}
                      </td>
                      <td className="py-3 px-4 text-xs">{pay.method}</td>
                      <td
                        className={`py-3 px-4 font-mono tabular-nums font-semibold ${
                          pay.amount < 0 ? 'text-[#B91C1C]' : 'text-[#176B55]'
                        }`}
                      >
                        {formatCurrency(pay.amount)}
                      </td>
                      <td className="py-3 px-4 text-xs text-[#5A6B6E]">{pay.notes || '—'}</td>
                      <td className="py-3 px-4 no-print">
                        <div className="flex items-center gap-3">
                          {pay.amount > 0 && (
                            <button
                              type="button"
                              onClick={() => setReceiptPayment(pay)}
                              className="inline-flex items-center gap-1 text-xs text-[#176B55] hover:underline cursor-pointer"
                            >
                              <Receipt className="w-3.5 h-3.5" />
                              <span>إيصال</span>
                            </button>
                          )}
                          {!pay.isReversal && pay.amount > 0 ? (
                            <button
                              type="button"
                              onClick={() => {
                                setReverseReason('تصحيح إداري معتمد من المالك');
                                setReverseTarget(pay);
                              }}
                              className="inline-flex items-center gap-1 text-xs text-[#9A6714] hover:underline cursor-pointer"
                            >
                              <RotateCcw className="w-3 h-3" />
                              <span>قيد عكسي</span>
                            </button>
                          ) : (
                            <span className="text-xs text-[#5A6B6E]">قيد عكسي</span>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {reversalError && (
            <div className="px-4 py-2.5 text-xs text-[#B91C1C] border-t border-[#E2E7E5]">
              {reversalError}
            </div>
          )}
        </Card>
      )}

      {(activeTab === 'timeline' || activeTab === 'statement') && (
        <Card padding="none" className="overflow-hidden">
          <div className="p-5 border-b border-[#E2E7E5] flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <h3 className="text-base font-bold text-[#142D35]">
                كشف حساب المورد — {supplier.name}
              </h3>
              <p className="text-xs text-[#5A6B6E] mt-0.5">
                {settings.bakeryName} · {settings.address} · كود المورد: {supplier.code} · هاتف:{' '}
                {supplier.phone}
              </p>
            </div>
            <div className="text-xs text-[#5A6B6E] font-mono">
              تاريخ الإصدار: {new Date().toISOString().slice(0, 10)}
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-right">
              <thead className="bg-[#F5F7F6] text-xs text-[#5A6B6E] border-b border-[#E2E7E5]">
                <tr>
                  <th className="py-3 px-4 font-medium">التاريخ</th>
                  <th className="py-3 px-4 font-medium">المرجع</th>
                  <th className="py-3 px-4 font-medium">نوع الحركة</th>
                  <th className="py-3 px-4 font-medium">التفاصيل</th>
                  <th className="py-3 px-4 font-medium">مدين (مشتريات)</th>
                  <th className="py-3 px-4 font-medium">دائن (مدفوعات)</th>
                  <th className="py-3 px-4 font-medium">الرصيد التراكمي</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E2E7E5]">
                {(activeTab === 'statement' ? statementRows : timeline).map((row) => (
                  <tr key={row.id}>
                    <td className="py-3 px-4 font-mono text-xs text-[#5A6B6E]">{row.date}</td>
                    <td className="py-3 px-4 font-mono text-xs">{row.ref}</td>
                    <td className="py-3 px-4 text-xs font-medium">{row.type}</td>
                    <td className="py-3 px-4 text-xs text-[#5A6B6E]">{row.description}</td>
                    <td className="py-3 px-4 font-mono tabular-nums">
                      {row.debit > 0 ? formatCurrency(row.debit) : '—'}
                    </td>
                    <td className="py-3 px-4 font-mono tabular-nums text-[#176B55]">
                      {row.credit > 0 ? formatCurrency(row.credit) : '—'}
                    </td>
                    <td className="py-3 px-4 font-mono tabular-nums font-bold text-[#142D35]">
                      {formatCurrency(row.runningBalance)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-[#F5F7F6] border-t border-[#E2E7E5] text-xs font-bold">
                <tr>
                  <td colSpan={4} className="py-3 px-4 text-[#142D35]">
                    الإجماليات والرصيد النهائي المستحق للمورد
                  </td>
                  <td className="py-3 px-4 font-mono tabular-nums">
                    {formatCurrency(supplier.totalPurchases)}
                  </td>
                  <td className="py-3 px-4 font-mono tabular-nums text-[#176B55]">
                    {formatCurrency(supplier.totalPayments)}
                  </td>
                  <td className="py-3 px-4 font-mono tabular-nums text-[#B91C1C]">
                    {formatCurrency(outstandingBalance)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </Card>
      )}

      {/* Record Payment Modal */}
      <Modal
        isOpen={payModalOpen}
        onClose={() => setPayModalOpen(false)}
        title={`تسجيل دفعة للمورد: ${supplier.name}`}
        subtitle={`الرصيد المتبقي الحالي: ${formatCurrency(outstandingBalance)}`}
      >
        <form onSubmit={handleRecordPayment} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Input
              label="المبلغ المدفوع (ج.س)"
              type="number"
              min="1"
              step="any"
              required
              value={payAmount}
              onChange={(e) => setPayAmount(e.target.value)}
            />
            <Input
              label="تاريخ الدفعة"
              type="date"
              required
              value={payDate}
              onChange={(e) => setPayDate(e.target.value)}
            />
            <Select
              label="طريقة الدفع"
              value={payMethod}
              onChange={(e) => setPayMethod(e.target.value as typeof payMethod)}
            >
              <option value="تحويل بنكي (بنكك)">تحويل بنكي (بنكك)</option>
              <option value="نقداً">نقداً من الخزينة</option>
              <option value="شيك">شيك مصرفي</option>
            </Select>
          </div>

          <Select
            label="ربط الدفعة بفاتورة محددة (اختياري)"
            value={payInvoiceId}
            onChange={(e) => setPayInvoiceId(e.target.value)}
          >
            <option value="">دفعة عامة على حساب المورد</option>
            {supplierInvoices
              .filter(
                (inv) =>
                  (inv.workflowStatus || 'مرحّلة') === 'مرحّلة' && inv.remainingBalance > 0
              )
              .map((inv) => (
                <option key={inv.id} value={inv.id}>
                  {inv.invoiceNumber} — المتبقي {formatCurrency(inv.remainingBalance)}
                </option>
              ))}
          </Select>

          <Input
            label="ملاحظات السداد"
            value={payNotes}
            onChange={(e) => setPayNotes(e.target.value)}
            placeholder="رقم إشعار بنكك أو رقم السند"
          />

          {payError && <div className="text-xs text-[#B91C1C] font-medium">{payError}</div>}

          <div className="flex items-center justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => setPayModalOpen(false)}>
              إلغاء
            </Button>
            <Button type="submit" disabled={submittingPay}>
              {submittingPay ? 'جاري الاعتماد...' : 'اعتماد الدفعة وإصدار الإيصال'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Printable Payment Receipt Modal */}
      <Modal
        isOpen={Boolean(receiptPayment)}
        onClose={() => setReceiptPayment(null)}
        title="إيصال سداد مورد رسمي"
        subtitle={settings.bakeryName}
        maxWidth="md"
      >
        {receiptPayment && (
          <div className="space-y-4 text-sm">
            <div className="p-4 rounded-xl bg-[#F5F7F6] border border-[#E2E7E5] space-y-2.5 text-xs">
              <div className="flex justify-between">
                <span className="text-[#5A6B6E]">رقم السند / المرجع:</span>
                <span className="font-mono font-bold text-[#142D35]">
                  {receiptPayment.reference}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#5A6B6E]">تاريخ السداد:</span>
                <span className="font-mono">{receiptPayment.date}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#5A6B6E]">المورد المستلم:</span>
                <span className="font-bold text-[#142D35]">
                  {supplier.name} ({supplier.code})
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#5A6B6E]">طريقة الدفع:</span>
                <span>{receiptPayment.method}</span>
              </div>
              {receiptPayment.invoiceNumber && (
                <div className="flex justify-between">
                  <span className="text-[#5A6B6E]">الفاتورة المرتبطة:</span>
                  <span className="font-mono">{receiptPayment.invoiceNumber}</span>
                </div>
              )}
              <div className="flex justify-between pt-2 border-t border-[#E2E7E5]">
                <span className="text-[#142D35] font-semibold">المبلغ المدفوع:</span>
                <span className="font-mono text-base font-bold text-[#176B55]">
                  {formatCurrency(receiptPayment.amount, settings.currencySymbol)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#5A6B6E]">رصيد المورد المتبقي بعد السداد:</span>
                <span className="font-mono font-bold text-[#142D35]">
                  {formatCurrency(outstandingBalance, settings.currencySymbol)}
                </span>
              </div>
              {receiptPayment.notes && (
                <div className="pt-1 text-[#5A6B6E]">ملاحظات: {receiptPayment.notes}</div>
              )}
            </div>
            <div className="flex items-center justify-between text-[11px] text-[#5A6B6E]">
              <span>المسؤول المعتمد: {receiptPayment.recordedBy}</span>
              <span>{settings.bakeryName}</span>
            </div>
            <div className="flex justify-end gap-2 pt-2 no-print">
              <Button variant="outline" onClick={() => setReceiptPayment(null)}>
                إغلاق
              </Button>
              <Button onClick={() => window.print()}>
                <Printer className="w-4 h-4" />
                <span>طباعة الإيصال</span>
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* Confirm Reverse Payment */}
      <ConfirmDialog
        isOpen={Boolean(reverseTarget)}
        onClose={() => setReverseTarget(null)}
        onConfirm={handleConfirmReversePayment}
        loading={reversing}
        tone="warning"
        title="تأكيد القيد العكسي للدفعة"
        message={`سيتم إنشاء قيد عكسي سالب بمبلغ ${formatCurrency(
          reverseTarget?.amount || 0
        )} للمرجع (${reverseTarget?.reference}) وتحديث رصيد المورد والخزينة والفاتورة المرتبطة.`}
        confirmLabel="تنفيذ القيد العكسي"
      >
        <Input
          label="سبب القيد العكسي"
          value={reverseReason}
          onChange={(e) => setReverseReason(e.target.value)}
        />
      </ConfirmDialog>

      {/* Confirm Post Draft Invoice */}
      <ConfirmDialog
        isOpen={Boolean(postTarget)}
        onClose={() => setPostTarget(null)}
        onConfirm={handleConfirmPostInvoice}
        loading={posting}
        tone="primary"
        title="اعتماد وترحيل مسودة الفاتورة"
        message={`هل تريد ترحيل الفاتورة (${postTarget?.invoiceNumber}) وتوريد أصنافها للمستودع وتحديث رصيد المورد؟`}
        confirmLabel="ترحيل الآن"
      />

      {/* Confirm Cancel Invoice */}
      <ConfirmDialog
        isOpen={Boolean(cancelTarget)}
        onClose={() => setCancelTarget(null)}
        onConfirm={handleConfirmCancelInvoice}
        loading={cancelling}
        tone="danger"
        title={`إلغاء الفاتورة (${cancelTarget?.invoiceNumber || ''})`}
        message="سيتم إلغاء الفاتورة وعكس آثارها المخزنية والمالية ذرياً."
        confirmLabel="تأكيد الإلغاء"
      >
        <Input
          label="سبب الإلغاء"
          required
          value={cancelReason}
          onChange={(e) => setCancelReason(e.target.value)}
          placeholder="يرجى كتابة السبب"
        />
      </ConfirmDialog>
    </div>
  );
};
