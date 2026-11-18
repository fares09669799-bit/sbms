import React, { useMemo, useState } from 'react';
import {
  Plus,
  RotateCcw,
  ArrowDownLeft,
  ArrowUpRight,
  Wallet,
  Paperclip,
} from 'lucide-react';
import { useSbms } from '../../context/SbmsContext';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Input, Select } from '../../components/ui/FormControls';
import { Modal } from '../../components/ui/Modal';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { StatusText } from '../../components/ui/StatusText';
import { formatCurrency } from '../../lib/utils';
import {
  CashTransactionRecord,
  ExpenseRecord,
  PaymentMethod,
} from '../../types/sbms';
import { EXPENSE_CATEGORIES, PAYMENT_METHODS } from './accountingConstants';

export const CashExpensesPage: React.FC = () => {
  const {
    expenses,
    addExpense,
    reverseExpense,
    cashTransactions,
    createCashTransaction,
    reverseCashTransaction,
    handovers,
    settings,
  } = useSbms();

  const today = new Date().toISOString().slice(0, 10);
  const [activeTab, setActiveTab] = useState<'cash' | 'expenses'>('cash');

  // Filters
  const [cashDirFilter, setCashDirFilter] = useState<'ALL' | 'IN' | 'OUT'>('ALL');
  const [cashTypeFilter, setCashTypeFilter] = useState('ALL');
  const [cashSearch, setCashSearch] = useState('');
  const [expCategoryFilter, setExpCategoryFilter] = useState('ALL');
  const [expSearch, setExpSearch] = useState('');

  // Add Expense Modal
  const [expModalOpen, setExpModalOpen] = useState(false);
  const [expCategory, setExpCategory] = useState<string>('وقود وغاز');
  const [expDate, setExpDate] = useState(today);
  const [expAmount, setExpAmount] = useState('50000');
  const [expMethod, setExpMethod] = useState<PaymentMethod>('نقداً');
  const [expDescription, setExpDescription] = useState('');
  const [expAttachmentName, setExpAttachmentName] = useState<string | undefined>(undefined);
  const [expAttachmentData, setExpAttachmentData] = useState<string | undefined>(undefined);
  const [expError, setExpError] = useState('');
  const [submittingExp, setSubmittingExp] = useState(false);

  // Cash Deposit / Withdrawal Modal
  const [cashModalMode, setCashModalMode] = useState<'إيداع نقدي' | 'سحب نقدي' | null>(null);
  const [cashAmount, setCashAmount] = useState('100000');
  const [cashDate, setCashDate] = useState(today);
  const [cashMethod, setCashMethod] = useState<PaymentMethod>('نقداً');
  const [cashEntity, setCashEntity] = useState('');
  const [cashNotes, setCashNotes] = useState('');
  const [cashError, setCashError] = useState('');
  const [submittingCash, setSubmittingCash] = useState(false);

  // Reversal dialogs
  const [revExpTarget, setRevExpTarget] = useState<ExpenseRecord | null>(null);
  const [revExpReason, setRevExpReason] = useState('تصحيح قيد مصروف معتمد');
  const [reversingExp, setReversingExp] = useState(false);

  const [revCashTarget, setRevCashTarget] = useState<CashTransactionRecord | null>(null);
  const [revCashReason, setRevCashReason] = useState('تصحيح قيد خزينة معتمد');
  const [reversingCash, setReversingCash] = useState(false);
  const [actionError, setActionError] = useState('');

  // Attachment preview modal
  const [previewAttachment, setPreviewAttachment] = useState<{
    name: string;
    data: string;
  } | null>(null);

  const cashSummary = useMemo(() => {
    const totalIn = cashTransactions
      .filter((c) => c.direction === 'IN')
      .reduce((a, c) => a + c.amount, 0);
    const totalOut = cashTransactions
      .filter((c) => c.direction === 'OUT')
      .reduce((a, c) => a + c.amount, 0);
    const deposits = cashTransactions
      .filter((c) => c.type === 'إيداع نقدي')
      .reduce((a, c) => a + c.amount, 0);
    const withdrawals = cashTransactions
      .filter((c) => c.type === 'سحب نقدي')
      .reduce((a, c) => a + c.amount, 0);
    const netExpenses = expenses.reduce((a, e) => a + e.amount, 0);
    return {
      totalIn,
      totalOut,
      cashBalance: totalIn - totalOut,
      deposits,
      withdrawals,
      netExpenses,
    };
  }, [cashTransactions, expenses]);

  const filteredCash = useMemo(() => {
    const q = cashSearch.trim().toLowerCase();
    return cashTransactions.filter((c) => {
      if (cashDirFilter !== 'ALL' && c.direction !== cashDirFilter) return false;
      if (cashTypeFilter !== 'ALL' && c.type !== cashTypeFilter) return false;
      if (
        q &&
        !c.reference.toLowerCase().includes(q) &&
        !c.relatedEntity.toLowerCase().includes(q) &&
        !c.recordedBy.toLowerCase().includes(q) &&
        !c.type.toLowerCase().includes(q)
      ) {
        return false;
      }
      return true;
    });
  }, [cashTransactions, cashDirFilter, cashTypeFilter, cashSearch]);

  const filteredExpenses = useMemo(() => {
    const q = expSearch.trim().toLowerCase();
    return expenses.filter((e) => {
      if (expCategoryFilter !== 'ALL' && e.category !== expCategoryFilter) return false;
      if (
        q &&
        !e.reference.toLowerCase().includes(q) &&
        !e.description.toLowerCase().includes(q) &&
        !e.responsibleUser.toLowerCase().includes(q)
      ) {
        return false;
      }
      return true;
    });
  }, [expenses, expCategoryFilter, expSearch]);

  const handleAttachmentChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 280_000) {
      setExpError('حجم المرفق يجب أن يكون أقل من 280 كيلوبايت.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setExpAttachmentName(file.name);
      setExpAttachmentData(typeof reader.result === 'string' ? reader.result : undefined);
    };
    reader.readAsDataURL(file);
  };

  const handleAddExpense = async (e: React.FormEvent) => {
    e.preventDefault();
    setExpError('');
    setSubmittingExp(true);
    const res = await addExpense({
      date: expDate,
      category: expCategory,
      amount: Number(expAmount),
      description: expDescription,
      paymentMethod: expMethod,
      attachmentName: expAttachmentName,
      attachmentData: expAttachmentData,
    });
    setSubmittingExp(false);
    if (!res.ok) {
      setExpError(res.error || 'تعذر حفظ المصروف');
      return;
    }
    setExpDescription('');
    setExpAttachmentName(undefined);
    setExpAttachmentData(undefined);
    setExpModalOpen(false);
  };

  const handleCashSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!cashModalMode) return;
    setCashError('');
    setSubmittingCash(true);
    const res = await createCashTransaction({
      type: cashModalMode,
      amount: Number(cashAmount),
      date: cashDate,
      paymentMethod: cashMethod,
      relatedEntity: cashEntity,
      notes: cashNotes.trim() || undefined,
    });
    setSubmittingCash(false);
    if (!res.ok) {
      setCashError(res.error || 'تعذر تسجيل الحركة النقدية');
      return;
    }
    setCashEntity('');
    setCashNotes('');
    setCashModalMode(null);
  };

  const handleConfirmReverseExpense = async () => {
    if (!revExpTarget) return;
    setReversingExp(true);
    setActionError('');
    const res = await reverseExpense(revExpTarget.id, revExpReason.trim());
    setReversingExp(false);
    if (!res.ok) setActionError(res.error || 'تعذر عكس المصروف');
    setRevExpTarget(null);
  };

  const handleConfirmReverseCash = async () => {
    if (!revCashTarget) return;
    setReversingCash(true);
    setActionError('');
    const res = await reverseCashTransaction(revCashTarget.id, revCashReason.trim());
    setReversingCash(false);
    if (!res.ok) setActionError(res.error || 'تعذر عكس حركة الخزينة');
    setRevCashTarget(null);
  };

  const cashTypes = useMemo(
    () => Array.from(new Set(cashTransactions.map((c) => c.type))),
    [cashTransactions]
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-[#142D35]">إدارة الخزينة والمصروفات التشغيلية</h2>
          <p className="text-xs text-[#5A6B6E] mt-1">
            متابعة الرصيد النقدي الفعلي، الإيداعات والسحوبات، تسويات عهد الورديات، وبنود المصروفات مع القيود العكسية.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button
            variant="outline"
            onClick={() => {
              setCashError('');
              setCashEntity('إيداع رأس مال / تغذية خزينة');
              setCashModalMode('إيداع نقدي');
            }}
          >
            <ArrowDownLeft className="w-4 h-4 text-[#176B55]" />
            <span>إيداع نقدي</span>
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              setCashError('');
              setCashEntity('سحب نقدي من الخزينة / إيداع بنكي');
              setCashModalMode('سحب نقدي');
            }}
          >
            <ArrowUpRight className="w-4 h-4 text-[#9A6714]" />
            <span>سحب نقدي</span>
          </Button>
          <Button onClick={() => setExpModalOpen(true)}>
            <Plus className="w-4 h-4" />
            <span>تسجيل مصروف</span>
          </Button>
        </div>
      </div>

      {actionError && (
        <div className="p-3 rounded-lg bg-[#FEF2F2] border border-[#B91C1C]/30 text-xs text-[#B91C1C] font-medium">
          {actionError}
        </div>
      )}

      {/* Cash & Expenses KPI Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="bg-[#142D35] text-white border-[#142D35]">
          <div className="flex items-center justify-between">
            <div className="text-xs text-white/75">رصيد الخزينة الفعلي</div>
            <Wallet className="w-4 h-4 text-[#D8AD65]" />
          </div>
          <div className="text-xl font-bold font-mono tabular-nums text-[#D8AD65] mt-1.5">
            {formatCurrency(cashSummary.cashBalance, settings.currencySymbol)}
          </div>
          <div className="text-[11px] text-white/70 mt-1">صافي (التدفقات الداخلة − الخارجة)</div>
        </Card>

        <Card>
          <div className="text-xs text-[#5A6B6E]">إجمالي التدفقات الداخلة (IN)</div>
          <div className="text-xl font-bold font-mono tabular-nums text-[#176B55] mt-1.5">
            {formatCurrency(cashSummary.totalIn, settings.currencySymbol)}
          </div>
          <div className="text-[11px] text-[#5A6B6E] mt-1 font-mono">
            منها إيداعات تمويلية: {formatCurrency(cashSummary.deposits)}
          </div>
        </Card>

        <Card>
          <div className="text-xs text-[#5A6B6E]">إجمالي التدفقات الخارجة (OUT)</div>
          <div className="text-xl font-bold font-mono tabular-nums text-[#B91C1C] mt-1.5">
            {formatCurrency(cashSummary.totalOut, settings.currencySymbol)}
          </div>
          <div className="text-[11px] text-[#5A6B6E] mt-1 font-mono">
            منها مسحوبات يدوية: {formatCurrency(cashSummary.withdrawals)}
          </div>
        </Card>

        <Card>
          <div className="text-xs text-[#5A6B6E]">صافي المصروفات التشغيلية</div>
          <div className="text-xl font-bold font-mono tabular-nums text-[#142D35] mt-1.5">
            {formatCurrency(cashSummary.netExpenses, settings.currencySymbol)}
          </div>
          <div className="text-[11px] text-[#5A6B6E] mt-1">
            شاملة الرواتب والكهرباء والوقود والصيانة
          </div>
        </Card>
      </div>

      {/* Sub-Tabs */}
      <div className="inline-flex items-center gap-1 p-1 bg-[#E2E7E5]/50 rounded-lg">
        <button
          type="button"
          onClick={() => setActiveTab('cash')}
          className={`px-4 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer ${
            activeTab === 'cash' ? 'bg-white text-[#142D35]' : 'text-[#5A6B6E] hover:text-[#142D35]'
          }`}
        >
          دفتر الخزينة والتدفقات النقدية ({cashTransactions.length})
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('expenses')}
          className={`px-4 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer ${
            activeTab === 'expenses' ? 'bg-white text-[#142D35]' : 'text-[#5A6B6E] hover:text-[#142D35]'
          }`}
        >
          سجل المصروفات التشغيلية ({expenses.length})
        </button>
      </div>

      {activeTab === 'cash' && (
        <div className="space-y-6">
          <Card padding="sm">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Input
                label="بحث في حركات الخزينة"
                value={cashSearch}
                onChange={(e) => setCashSearch(e.target.value)}
                placeholder="المرجع، الجهة، أو المسؤول..."
              />
              <Select
                label="اتجاه الحركة"
                value={cashDirFilter}
                onChange={(e) => setCashDirFilter(e.target.value as 'ALL' | 'IN' | 'OUT')}
              >
                <option value="ALL">جميع الحركات (داخل وخارج)</option>
                <option value="IN">تدفق داخل (+) فقط</option>
                <option value="OUT">تدفق خارج (−) فقط</option>
              </Select>
              <Select
                label="نوع الحركة"
                value={cashTypeFilter}
                onChange={(e) => setCashTypeFilter(e.target.value)}
              >
                <option value="ALL">جميع الأنواع</option>
                {cashTypes.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </Select>
            </div>
          </Card>

          <Card padding="none" className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-right">
                <thead className="bg-[#F5F7F6] text-xs text-[#5A6B6E] border-b border-[#E2E7E5]">
                  <tr>
                    <th className="py-3 px-4 font-medium">المرجع / التاريخ</th>
                    <th className="py-3 px-4 font-medium">نوع الحركة</th>
                    <th className="py-3 px-4 font-medium">الوسيلة</th>
                    <th className="py-3 px-4 font-medium">الجهة / البيان</th>
                    <th className="py-3 px-4 font-medium">المسؤول</th>
                    <th className="py-3 px-4 font-medium">المبلغ</th>
                    <th className="py-3 px-4 font-medium">إجراء</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E2E7E5]">
                  {filteredCash.map((tx) => {
                    const isManualReversible =
                      !tx.isReversal && (tx.type === 'إيداع نقدي' || tx.type === 'سحب نقدي');
                    return (
                      <tr key={tx.id} className="hover:bg-[#F5F7F6]/60">
                        <td className="py-3 px-4 font-mono text-xs">
                          <div className="font-semibold text-[#142D35]">{tx.reference}</div>
                          <div className="text-[#5A6B6E]">{tx.date}</div>
                        </td>
                        <td className="py-3 px-4">
                          <StatusText
                            tone={
                              tx.isReversal
                                ? 'warning'
                                : tx.direction === 'IN'
                                ? 'success'
                                : 'danger'
                            }
                            label={tx.type}
                          />
                        </td>
                        <td className="py-3 px-4 text-xs text-[#5A6B6E]">{tx.paymentMethod}</td>
                        <td className="py-3 px-4 text-xs">
                          <div className="text-[#142D35] font-medium">{tx.relatedEntity}</div>
                          {tx.notes && <div className="text-[#5A6B6E]">{tx.notes}</div>}
                        </td>
                        <td className="py-3 px-4 text-xs">{tx.recordedBy}</td>
                        <td
                          className={`py-3 px-4 font-mono tabular-nums font-bold ${
                            tx.direction === 'IN' ? 'text-[#176B55]' : 'text-[#B91C1C]'
                          }`}
                        >
                          {tx.direction === 'IN' ? '+' : '−'}
                          {formatCurrency(tx.amount)}
                        </td>
                        <td className="py-3 px-4">
                          {isManualReversible ? (
                            <button
                              type="button"
                              onClick={() => {
                                setRevCashReason('تصحيح قيد خزينة معتمد');
                                setRevCashTarget(tx);
                              }}
                              className="inline-flex items-center gap-1 text-xs text-[#9A6714] hover:underline cursor-pointer"
                            >
                              <RotateCcw className="w-3 h-3" />
                              <span>قيد عكسي</span>
                            </button>
                          ) : (
                            <span className="text-[11px] text-[#5A6B6E]">
                              {tx.isReversal ? 'قيد عكسي' : 'مربوط بسجل مصدر'}
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>

          {handovers.length > 0 && (
            <Card padding="none" className="overflow-hidden">
              <div className="px-5 py-3.5 border-b border-[#E2E7E5] text-sm font-semibold text-[#142D35]">
                تسليمات عهد الورديات المرتبطة بالخزينة ({handovers.length})
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm text-right">
                  <thead className="bg-[#F5F7F6] text-xs text-[#5A6B6E] border-b border-[#E2E7E5]">
                    <tr>
                      <th className="py-2.5 px-4 font-medium">الوردية / التاريخ</th>
                      <th className="py-2.5 px-4 font-medium">الوكيل</th>
                      <th className="py-2.5 px-4 font-medium">المتوقع</th>
                      <th className="py-2.5 px-4 font-medium">المسلّم فعلياً</th>
                      <th className="py-2.5 px-4 font-medium">الفارق</th>
                      <th className="py-2.5 px-4 font-medium">المستلم / الاعتماد</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#E2E7E5]">
                    {handovers.map((h) => (
                      <tr key={h.id}>
                        <td className="py-2.5 px-4 text-xs">
                          <div className="font-medium text-[#142D35]">{h.shiftName}</div>
                          <div className="font-mono text-[#5A6B6E]">{h.shiftDate}</div>
                        </td>
                        <td className="py-2.5 px-4 text-xs">{h.agentName}</td>
                        <td className="py-2.5 px-4 font-mono tabular-nums text-xs">
                          {formatCurrency(h.expectedCash)}
                        </td>
                        <td className="py-2.5 px-4 font-mono tabular-nums text-xs font-semibold text-[#176B55]">
                          {formatCurrency(h.handedCash)}
                        </td>
                        <td
                          className={`py-2.5 px-4 font-mono tabular-nums text-xs font-bold ${
                            h.cashDifference === 0 ? 'text-[#176B55]' : 'text-[#B91C1C]'
                          }`}
                        >
                          {formatCurrency(h.cashDifference)}
                        </td>
                        <td className="py-2.5 px-4 text-xs">
                          <div>{h.receivedByName}</div>
                          <StatusText
                            tone={h.approvedByOwner ? 'success' : 'warning'}
                            label={h.approvedByOwner ? 'معتمدة بالخزينة' : 'بانتظار الاعتماد'}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </div>
      )}

      {activeTab === 'expenses' && (
        <div className="space-y-4">
          <Card padding="sm">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Input
                label="بحث في المصروفات"
                value={expSearch}
                onChange={(e) => setExpSearch(e.target.value)}
                placeholder="المرجع، الوصف، أو المسؤول..."
              />
              <Select
                label="تصفية حسب الفئة"
                value={expCategoryFilter}
                onChange={(e) => setExpCategoryFilter(e.target.value)}
              >
                <option value="ALL">جميع فئات المصروفات</option>
                {EXPENSE_CATEGORIES.map((cat) => (
                  <option key={cat} value={cat}>
                    {cat}
                  </option>
                ))}
              </Select>
            </div>
          </Card>

          <Card padding="none" className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-right">
                <thead className="bg-[#F5F7F6] text-xs text-[#5A6B6E] border-b border-[#E2E7E5]">
                  <tr>
                    <th className="py-3 px-4 font-medium">المرجع / التاريخ</th>
                    <th className="py-3 px-4 font-medium">الفئة</th>
                    <th className="py-3 px-4 font-medium">البيان والمرفق</th>
                    <th className="py-3 px-4 font-medium">طريقة الدفع</th>
                    <th className="py-3 px-4 font-medium">المسؤول</th>
                    <th className="py-3 px-4 font-medium">الحالة</th>
                    <th className="py-3 px-4 font-medium">المبلغ</th>
                    <th className="py-3 px-4 font-medium">تصحيح</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E2E7E5]">
                  {filteredExpenses.map((ex) => (
                    <tr key={ex.id} className="hover:bg-[#F5F7F6]/60">
                      <td className="py-3 px-4 font-mono text-xs">
                        <div className="font-semibold text-[#142D35]">{ex.reference}</div>
                        <div className="text-[#5A6B6E]">{ex.date}</div>
                      </td>
                      <td className="py-3 px-4 font-medium text-xs">{ex.category}</td>
                      <td className="py-3 px-4 text-xs text-[#5A6B6E]">
                        <div>{ex.description}</div>
                        {ex.attachmentName && (
                          <button
                            type="button"
                            onClick={() => {
                              if (ex.attachmentData) {
                                setPreviewAttachment({
                                  name: ex.attachmentName!,
                                  data: ex.attachmentData,
                                });
                              }
                            }}
                            className="inline-flex items-center gap-1 text-[11px] text-[#176B55] hover:underline mt-0.5 cursor-pointer"
                          >
                            <Paperclip className="w-3 h-3" />
                            <span>{ex.attachmentName}</span>
                          </button>
                        )}
                      </td>
                      <td className="py-3 px-4 text-xs">{ex.paymentMethod || 'نقداً'}</td>
                      <td className="py-3 px-4 text-xs">{ex.responsibleUser}</td>
                      <td className="py-3 px-4">
                        <StatusText
                          tone={ex.status === 'معكوس' || ex.isReversal ? 'neutral' : 'success'}
                          label={ex.isReversal ? 'قيد عكسي' : ex.status || 'مرحّل'}
                        />
                      </td>
                      <td
                        className={`py-3 px-4 font-mono tabular-nums font-bold ${
                          ex.amount < 0 ? 'text-[#176B55]' : 'text-[#B91C1C]'
                        }`}
                      >
                        {formatCurrency(ex.amount)}
                      </td>
                      <td className="py-3 px-4">
                        {!ex.isReversal && ex.status !== 'معكوس' ? (
                          <button
                            type="button"
                            onClick={() => {
                              setRevExpReason('تصحيح قيد مصروف معتمد');
                              setRevExpTarget(ex);
                            }}
                            className="inline-flex items-center gap-1 text-xs text-[#9A6714] hover:underline cursor-pointer"
                          >
                            <RotateCcw className="w-3 h-3" />
                            <span>عكس القيد</span>
                          </button>
                        ) : (
                          <span className="text-[11px] text-[#5A6B6E]">معكوس</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}

      {/* Record Expense Modal */}
      <Modal isOpen={expModalOpen} onClose={() => setExpModalOpen(false)} title="تسجيل مصروف تشغيلي جديد">
        <form onSubmit={handleAddExpense} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Select
              label="بند المصروف"
              value={expCategory}
              onChange={(e) => setExpCategory(e.target.value)}
            >
              {EXPENSE_CATEGORIES.map((cat) => (
                <option key={cat} value={cat}>
                  {cat}
                </option>
              ))}
            </Select>
            <Input
              label="التاريخ"
              type="date"
              required
              value={expDate}
              onChange={(e) => setExpDate(e.target.value)}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input
              label="المبلغ (ج.س)"
              type="number"
              min="1"
              step="any"
              required
              value={expAmount}
              onChange={(e) => setExpAmount(e.target.value)}
            />
            <Select
              label="طريقة الدفع"
              value={expMethod}
              onChange={(e) => setExpMethod(e.target.value as PaymentMethod)}
            >
              {PAYMENT_METHODS.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </Select>
          </div>

          <Input
            label="البيان / الوصف"
            required
            value={expDescription}
            onChange={(e) => setExpDescription(e.target.value)}
            placeholder="تفاصيل الفاتورة أو المستند المؤيد"
          />

          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-[#142D35]">
              مرفق مستند / إيصال داعم (اختياري — حد أقصى 280 كيلوبايت)
            </label>
            <input
              type="file"
              accept="image/*,.pdf"
              onChange={handleAttachmentChange}
              className="block w-full text-xs text-[#5A6B6E] file:ml-3 file:py-1.5 file:px-3 file:rounded-md file:border file:border-[#E2E7E5] file:bg-[#F5F7F6] file:text-xs file:font-medium file:text-[#142D35] hover:file:bg-[#E2E7E5]/50 cursor-pointer"
            />
            {expAttachmentName && (
              <div className="text-[11px] text-[#176B55]">تم إرفاق: {expAttachmentName}</div>
            )}
          </div>

          {expError && <div className="text-xs text-[#B91C1C] font-medium">{expError}</div>}

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => setExpModalOpen(false)}>
              إلغاء
            </Button>
            <Button type="submit" disabled={submittingExp}>
              {submittingExp ? 'جاري الحفظ...' : 'حفظ المصروف'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Cash Deposit / Withdrawal Modal */}
      <Modal
        isOpen={Boolean(cashModalMode)}
        onClose={() => setCashModalMode(null)}
        title={cashModalMode === 'إيداع نقدي' ? 'تسجيل إيداع نقدي بالخزينة' : 'تسجيل سحب نقدي من الخزينة'}
        subtitle="الإيداعات والسحوبات التمويلية تؤثر على رصيد الخزينة ولا تُحتسب إيراداً أو مصروفاً في قائمة الدخل."
      >
        <form onSubmit={handleCashSubmit} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Input
              label="المبلغ (ج.س)"
              type="number"
              min="1"
              step="any"
              required
              value={cashAmount}
              onChange={(e) => setCashAmount(e.target.value)}
            />
            <Input
              label="التاريخ"
              type="date"
              required
              value={cashDate}
              onChange={(e) => setCashDate(e.target.value)}
            />
            <Select
              label="الوسيلة"
              value={cashMethod}
              onChange={(e) => setCashMethod(e.target.value as PaymentMethod)}
            >
              {PAYMENT_METHODS.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </Select>
          </div>

          <Input
            label="الجهة / البيان الرئيسي"
            required
            value={cashEntity}
            onChange={(e) => setCashEntity(e.target.value)}
          />
          <Input
            label="ملاحظات إضافية"
            value={cashNotes}
            onChange={(e) => setCashNotes(e.target.value)}
            placeholder="رقم إشعار البنك أو سبب الحركة"
          />

          {cashError && <div className="text-xs text-[#B91C1C] font-medium">{cashError}</div>}
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => setCashModalMode(null)}>
              إلغاء
            </Button>
            <Button type="submit" disabled={submittingCash}>
              {submittingCash ? 'جاري التنفيذ...' : 'اعتماد الحركة النقدية'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Reverse Expense Confirm */}
      <ConfirmDialog
        isOpen={Boolean(revExpTarget)}
        onClose={() => setRevExpTarget(null)}
        onConfirm={handleConfirmReverseExpense}
        loading={reversingExp}
        tone="warning"
        title="تأكيد عكس قيد المصروف"
        message={`سيتم إنشاء قيد عكسي سالب للمصروف (${revExpTarget?.reference}) بمبلغ ${formatCurrency(
          revExpTarget?.amount || 0
        )} وإعادة المبلغ إلى رصيد الخزينة.`}
        confirmLabel="تنفيذ القيد العكسي"
      >
        <Input
          label="سبب القيد العكسي"
          value={revExpReason}
          onChange={(e) => setRevExpReason(e.target.value)}
        />
      </ConfirmDialog>

      {/* Reverse Cash Tx Confirm */}
      <ConfirmDialog
        isOpen={Boolean(revCashTarget)}
        onClose={() => setRevCashTarget(null)}
        onConfirm={handleConfirmReverseCash}
        loading={reversingCash}
        tone="warning"
        title="تأكيد عكس حركة الخزينة"
        message={`سيتم إنشاء قيد عكسي للحركة (${revCashTarget?.reference}) بمبلغ ${formatCurrency(
          revCashTarget?.amount || 0
        )}.`}
        confirmLabel="تنفيذ القيد العكسي"
      >
        <Input
          label="سبب القيد العكسي"
          value={revCashReason}
          onChange={(e) => setRevCashReason(e.target.value)}
        />
      </ConfirmDialog>

      {/* Attachment Preview Modal */}
      <Modal
        isOpen={Boolean(previewAttachment)}
        onClose={() => setPreviewAttachment(null)}
        title={`مرفق مستند: ${previewAttachment?.name || ''}`}
        maxWidth="lg"
      >
        {previewAttachment && (
          <div className="space-y-4">
            {previewAttachment.data.startsWith('data:image/') ? (
              <img
                src={previewAttachment.data}
                alt={previewAttachment.name}
                className="max-h-[65vh] mx-auto rounded-lg border border-[#E2E7E5]"
              />
            ) : (
              <div className="p-6 text-center bg-[#F5F7F6] rounded-lg border border-[#E2E7E5] text-xs space-y-3">
                <div>تم تحميل المستند المرفق: {previewAttachment.name}</div>
                <a
                  href={previewAttachment.data}
                  download={previewAttachment.name}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#142D35] text-white font-medium"
                >
                  تنزيل المرفق
                </a>
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
};
