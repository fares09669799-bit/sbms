import React, { useMemo, useState } from 'react';
import {
  Plus,
  RotateCcw,
  ArrowDownLeft,
  ArrowUpRight,
  Wallet,
  Receipt,
  Printer,
  FileText,
  UserPlus,
  SlidersHorizontal,
  Edit3,
  CalendarCheck,
  Banknote,
  Paperclip,
  Search,
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
  CashTransactionRecord,
  Customer,
  CustomerProfileData,
  Employee,
  EmployeeProfileData,
  ExpenseRecord,
  PaymentMethod,
} from '../../types/sbms';

const EXPENSE_CATEGORIES = [
  'كهرباء',
  'مياه',
  'ترحيل ومواصلات',
  'وقود وغاز',
  'صيانة',
  'إيجار',
  'رواتب وأجور',
  'مصروفات تشغيلية أخرى',
] as const;

const PAYMENT_METHODS: PaymentMethod[] = ['نقداً', 'تحويل بنكي (بنكك)', 'شيك'];

// ==========================================
// 1. CASH MANAGEMENT & EXPENSES PAGE
// ==========================================
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

// ==========================================
// 2. CUSTOMERS & RECEIVABLES PAGE
// ==========================================
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

// ==========================================
// 3. EMPLOYEES, ATTENDANCE & PAYROLL PAGE
// ==========================================
export const EmployeesPage: React.FC = () => {
  const {
    employees,
    addEmployee,
    updateEmployee,
    fetchEmployeeProfile,
    recordEmployeeAttendance,
    recordEmployeePayroll,
    reverseEmployeePayroll,
    settings,
  } = useSbms();

  const today = new Date().toISOString().slice(0, 10);
  const currentMonth = today.slice(0, 7);

  const [search, setSearch] = useState('');
  const [shiftFilter, setShiftFilter] = useState('ALL');

  // Add/Edit Employee Modal
  const [empModalOpen, setEmpModalOpen] = useState(false);
  const [editingEmp, setEditingEmp] = useState<Employee | null>(null);
  const [eName, setEName] = useState('');
  const [eJob, setEJob] = useState('');
  const [ePhone, setEPhone] = useState('');
  const [eSalary, setESalary] = useState('200000');
  const [eShift, setEShift] = useState<'الوردية الصباحية' | 'الوردية المسائية' | 'الوردية الليلية'>(
    'الوردية الصباحية'
  );
  const [eStatus, setEStatus] = useState<'نشط' | 'موقوف'>('نشط');
  const [eNotes, setENotes] = useState('');
  const [eError, setEError] = useState('');
  const [savingEmp, setSavingEmp] = useState(false);

  // Attendance Modal
  const [attEmp, setAttEmp] = useState<Employee | null>(null);
  const [attDate, setAttDate] = useState(today);
  const [attStatus, setAttStatus] = useState<'حاضر' | 'غائب' | 'إجازة'>('حاضر');
  const [attNotes, setAttNotes] = useState('');
  const [attError, setAttError] = useState('');
  const [savingAtt, setSavingAtt] = useState(false);

  // Payroll Modal
  const [payEmp, setPayEmp] = useState<Employee | null>(null);
  const [payMonth, setPayMonth] = useState(currentMonth);
  const [payAmount, setPayAmount] = useState('100000');
  const [payDate, setPayDate] = useState(today);
  const [payMethod, setPayMethod] = useState<PaymentMethod>('نقداً');
  const [payNotes, setPayNotes] = useState('');
  const [payError, setPayError] = useState('');
  const [savingPay, setSavingPay] = useState(false);

  // Profile / History Modal
  const [profileOpen, setProfileOpen] = useState(false);
  const [loadingProfile, setLoadingProfile] = useState(false);
  const [profileData, setProfileData] = useState<EmployeeProfileData | null>(null);
  const [revPayrollId, setRevPayrollId] = useState<string | null>(null);
  const [revPayrollReason, setRevPayrollReason] = useState('تصحيح قيد صرف راتب');
  const [reversingPayroll, setReversingPayroll] = useState(false);

  const summary = useMemo(() => {
    const active = employees.filter((e) => (e.status || 'نشط') === 'نشط');
    const totalMonthly = active.reduce((a, e) => a + e.monthlySalary, 0);
    const totalPaid = active.reduce((a, e) => a + e.paidThisMonth, 0);
    return {
      activeCount: active.length,
      totalMonthly,
      totalPaid,
      remainingPayable: Math.max(0, totalMonthly - totalPaid),
    };
  }, [employees]);

  const filteredEmployees = useMemo(() => {
    const q = search.trim().toLowerCase();
    return employees.filter((emp) => {
      if (shiftFilter !== 'ALL' && emp.shift !== shiftFilter) return false;
      if (
        q &&
        !emp.name.toLowerCase().includes(q) &&
        !emp.jobTitle.toLowerCase().includes(q) &&
        !emp.phone.toLowerCase().includes(q)
      ) {
        return false;
      }
      return true;
    });
  }, [employees, search, shiftFilter]);

  const openCreateEmp = () => {
    setEditingEmp(null);
    setEName('');
    setEJob('');
    setEPhone('');
    setESalary('200000');
    setEShift('الوردية الصباحية');
    setEStatus('نشط');
    setENotes('');
    setEError('');
    setEmpModalOpen(true);
  };

  const openEditEmp = (emp: Employee) => {
    setEditingEmp(emp);
    setEName(emp.name);
    setEJob(emp.jobTitle);
    setEPhone(emp.phone);
    setESalary(String(emp.monthlySalary));
    setEShift(emp.shift as typeof eShift);
    setEStatus((emp.status as 'نشط' | 'موقوف') || 'نشط');
    setENotes(emp.notes || '');
    setEError('');
    setEmpModalOpen(true);
  };

  const handleSaveEmp = async (e: React.FormEvent) => {
    e.preventDefault();
    setEError('');
    setSavingEmp(true);
    const res = editingEmp
      ? await updateEmployee(editingEmp.id, {
          name: eName,
          jobTitle: eJob,
          phone: ePhone,
          monthlySalary: Number(eSalary),
          shift: eShift,
          status: eStatus,
          notes: eNotes,
        })
      : await addEmployee({
          name: eName,
          jobTitle: eJob,
          phone: ePhone,
          monthlySalary: Number(eSalary),
          shift: eShift,
          notes: eNotes || undefined,
        });
    setSavingEmp(false);
    if (!res.ok) {
      setEError(res.error || 'تعذر حفظ بيانات الموظف');
      return;
    }
    setEmpModalOpen(false);
  };

  const handleAttSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!attEmp) return;
    setAttError('');
    setSavingAtt(true);
    const res = await recordEmployeeAttendance(attEmp.id, {
      date: attDate,
      status: attStatus,
      notes: attNotes.trim() || undefined,
    });
    setSavingAtt(false);
    if (!res.ok) {
      setAttError(res.error || 'تعذر تسجيل الحضور');
      return;
    }
    const empId = attEmp.id;
    setAttEmp(null);
    setAttNotes('');
    if (profileOpen && profileData?.employee.id === empId) {
      const updated = await fetchEmployeeProfile(empId);
      setProfileData(updated);
    }
  };

  const handlePaySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!payEmp) return;
    setPayError('');
    setSavingPay(true);
    const res = await recordEmployeePayroll(payEmp.id, {
      month: payMonth,
      amountPaid: Number(payAmount),
      paidDate: payDate,
      paymentMethod: payMethod,
      notes: payNotes.trim() || undefined,
    });
    setSavingPay(false);
    if (!res.ok) {
      setPayError(res.error || 'تعذر صرف الراتب');
      return;
    }
    const empId = payEmp.id;
    setPayEmp(null);
    setPayNotes('');
    if (profileOpen && profileData?.employee.id === empId) {
      const updated = await fetchEmployeeProfile(empId);
      setProfileData(updated);
    }
  };

  const openProfile = async (empId: string) => {
    setProfileOpen(true);
    setLoadingProfile(true);
    setProfileData(null);
    const data = await fetchEmployeeProfile(empId);
    setProfileData(data);
    setLoadingProfile(false);
  };

  const handleConfirmReversePayroll = async () => {
    if (!revPayrollId) return;
    setReversingPayroll(true);
    const res = await reverseEmployeePayroll(revPayrollId, revPayrollReason.trim());
    setReversingPayroll(false);
    setRevPayrollId(null);
    if (res.ok && profileData) {
      const updated = await fetchEmployeeProfile(profileData.employee.id);
      setProfileData(updated);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-[#142D35]">الموظفون والرواتب والحضور</h2>
          <p className="text-xs text-[#5A6B6E] mt-1">
            إدارة ملفات العاملين بالأفران والترحيل، تسجيل الحضور اليومي، وصرف الرواتب المرتبط بالخزينة والمصروفات.
          </p>
        </div>
        <Button onClick={openCreateEmp}>
          <UserPlus className="w-4 h-4" />
          <span>إضافة موظف جديد</span>
        </Button>
      </div>

      {/* KPI Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        <Card>
          <div className="text-xs text-[#5A6B6E]">الموظفون النشطون</div>
          <div className="text-xl font-bold font-mono tabular-nums text-[#142D35] mt-1.5">
            {formatNumber(summary.activeCount)} موظف
          </div>
        </Card>
        <Card>
          <div className="text-xs text-[#5A6B6E]">إجمالي الرواتب الشهرية</div>
          <div className="text-xl font-bold font-mono tabular-nums text-[#142D35] mt-1.5">
            {formatCurrency(summary.totalMonthly, settings.currencySymbol)}
          </div>
        </Card>
        <Card>
          <div className="text-xs text-[#5A6B6E]">المنصرف هذا الشهر</div>
          <div className="text-xl font-bold font-mono tabular-nums text-[#176B55] mt-1.5">
            {formatCurrency(summary.totalPaid, settings.currencySymbol)}
          </div>
        </Card>
        <Card>
          <div className="text-xs text-[#5A6B6E]">المتبقي المستحق للشهر</div>
          <div className="text-xl font-bold font-mono tabular-nums text-[#9A6714] mt-1.5">
            {formatCurrency(summary.remainingPayable, settings.currencySymbol)}
          </div>
        </Card>
      </div>

      <Card padding="sm">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Input
            label="بحث في الموظفين"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="الاسم، المسمى الوظيفي، أو الهاتف..."
          />
          <Select
            label="تصفية حسب الوردية"
            value={shiftFilter}
            onChange={(e) => setShiftFilter(e.target.value)}
          >
            <option value="ALL">جميع الورديات</option>
            <option value="الوردية الصباحية">الوردية الصباحية</option>
            <option value="الوردية المسائية">الوردية المسائية</option>
            <option value="الوردية الليلية">الوردية الليلية</option>
          </Select>
        </div>
      </Card>

      <Card padding="none" className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-right">
            <thead className="bg-[#F5F7F6] text-xs text-[#5A6B6E] border-b border-[#E2E7E5]">
              <tr>
                <th className="py-3 px-4 font-medium">الموظف / الهاتف</th>
                <th className="py-3 px-4 font-medium">المسمى الوظيفي</th>
                <th className="py-3 px-4 font-medium">الوردية</th>
                <th className="py-3 px-4 font-medium">الحضور</th>
                <th className="py-3 px-4 font-medium">الراتب الشهري</th>
                <th className="py-3 px-4 font-medium">المنصرف</th>
                <th className="py-3 px-4 font-medium">المتبقي</th>
                <th className="py-3 px-4 font-medium">الإجراءات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E2E7E5]">
              {filteredEmployees.map((emp) => {
                const rem = Math.max(0, emp.monthlySalary - emp.paidThisMonth);
                return (
                  <tr key={emp.id} className="hover:bg-[#F5F7F6]/60">
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-[#142D35]">{emp.name}</span>
                        <StatusText
                          tone={(emp.status || 'نشط') === 'نشط' ? 'success' : 'neutral'}
                          label={emp.status || 'نشط'}
                        />
                      </div>
                      <div className="text-xs font-mono text-[#5A6B6E]" dir="ltr">
                        {emp.phone}
                      </div>
                    </td>
                    <td className="py-3 px-4 text-xs">{emp.jobTitle}</td>
                    <td className="py-3 px-4 text-xs text-[#5A6B6E]">{emp.shift}</td>
                    <td className="py-3 px-4 font-mono tabular-nums">
                      {formatNumber(emp.attendanceDays)} يوم
                    </td>
                    <td className="py-3 px-4 font-mono tabular-nums">
                      {formatCurrency(emp.monthlySalary)}
                    </td>
                    <td className="py-3 px-4 font-mono tabular-nums text-[#176B55]">
                      {formatCurrency(emp.paidThisMonth)}
                    </td>
                    <td className="py-3 px-4 font-mono tabular-nums font-bold text-[#9A6714]">
                      {formatCurrency(rem)}
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setAttDate(today);
                            setAttStatus('حاضر');
                            setAttNotes('');
                            setAttError('');
                            setAttEmp(emp);
                          }}
                        >
                          <CalendarCheck className="w-3.5 h-3.5" />
                          <span>حضور</span>
                        </Button>
                        <Button
                          size="sm"
                          onClick={() => {
                            setPayMonth(currentMonth);
                            setPayAmount(String(rem > 0 ? rem : emp.monthlySalary));
                            setPayDate(today);
                            setPayNotes('');
                            setPayError('');
                            setPayEmp(emp);
                          }}
                        >
                          <Banknote className="w-3.5 h-3.5" />
                          <span>صرف راتب</span>
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => openProfile(emp.id)}>
                          <FileText className="w-3.5 h-3.5" />
                          <span>السجل</span>
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => openEditEmp(emp)}
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

      {/* Add/Edit Employee Modal */}
      <Modal
        isOpen={empModalOpen}
        onClose={() => setEmpModalOpen(false)}
        title={editingEmp ? `تعديل بيانات الموظف: ${editingEmp.name}` : 'إضافة موظف جديد'}
      >
        <form onSubmit={handleSaveEmp} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input
              label="الاسم الكامل"
              required
              value={eName}
              onChange={(e) => setEName(e.target.value)}
            />
            <Input
              label="المسمى الوظيفي"
              required
              value={eJob}
              onChange={(e) => setEJob(e.target.value)}
              placeholder="مثال: خباز / فني عجانة / عامل ترحيل"
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Input
              label="رقم الهاتف"
              required
              value={ePhone}
              onChange={(e) => setEPhone(e.target.value)}
            />
            <Input
              label="الراتب الشهري (ج.س)"
              type="number"
              min="1"
              required
              value={eSalary}
              onChange={(e) => setESalary(e.target.value)}
            />
            <Select
              label="الوردية"
              value={eShift}
              onChange={(e) => setEShift(e.target.value as typeof eShift)}
            >
              <option value="الوردية الصباحية">الوردية الصباحية</option>
              <option value="الوردية المسائية">الوردية المسائية</option>
              <option value="الوردية الليلية">الوردية الليلية</option>
            </Select>
          </div>
          {editingEmp && (
            <Select
              label="الحالة"
              value={eStatus}
              onChange={(e) => setEStatus(e.target.value as 'نشط' | 'موقوف')}
            >
              <option value="نشط">نشط</option>
              <option value="موقوف">موقوف</option>
            </Select>
          )}
          <Input label="ملاحظات" value={eNotes} onChange={(e) => setENotes(e.target.value)} />
          {eError && <div className="text-xs text-[#B91C1C] font-medium">{eError}</div>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setEmpModalOpen(false)}>
              إلغاء
            </Button>
            <Button type="submit" disabled={savingEmp}>
              {savingEmp ? 'جاري الحفظ...' : 'حفظ الموظف'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Attendance Modal */}
      <Modal
        isOpen={Boolean(attEmp)}
        onClose={() => setAttEmp(null)}
        title={`تسجيل حضور: ${attEmp?.name || ''}`}
      >
        <form onSubmit={handleAttSubmit} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input
              label="التاريخ"
              type="date"
              required
              value={attDate}
              onChange={(e) => setAttDate(e.target.value)}
            />
            <Select
              label="حالة الدوام"
              value={attStatus}
              onChange={(e) => setAttStatus(e.target.value as 'حاضر' | 'غائب' | 'إجازة')}
            >
              <option value="حاضر">حاضر</option>
              <option value="غائب">غائب</option>
              <option value="إجازة">إجازة</option>
            </Select>
          </div>
          <Input
            label="ملاحظات"
            value={attNotes}
            onChange={(e) => setAttNotes(e.target.value)}
            placeholder="ملاحظة عن التأخير أو الإجازة"
          />
          {attError && <div className="text-xs text-[#B91C1C] font-medium">{attError}</div>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setAttEmp(null)}>
              إلغاء
            </Button>
            <Button type="submit" disabled={savingAtt}>
              {savingAtt ? 'جاري الحفظ...' : 'اعتماد الحضور'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Payroll Payment Modal */}
      <Modal
        isOpen={Boolean(payEmp)}
        onClose={() => setPayEmp(null)}
        title={`صرف راتب / دفعة للموظف: ${payEmp?.name || ''}`}
        subtitle="يتم ترحيل صرف الراتب تلقائياً إلى سجل المصروفات التشغيلية (رواتب وأجور) والخصم من الخزينة."
      >
        <form onSubmit={handlePaySubmit} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input
              label="الشهر المستحق"
              type="month"
              required
              value={payMonth}
              onChange={(e) => setPayMonth(e.target.value)}
            />
            <Input
              label="تاريخ الصرف"
              type="date"
              required
              value={payDate}
              onChange={(e) => setPayDate(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input
              label="المبلغ المصروف (ج.س)"
              type="number"
              min="1"
              step="any"
              required
              value={payAmount}
              onChange={(e) => setPayAmount(e.target.value)}
            />
            <Select
              label="طريقة الصرف"
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
            label="ملاحظات الصرف"
            value={payNotes}
            onChange={(e) => setPayNotes(e.target.value)}
            placeholder="سلفة، حافز، أو دفعة راتب"
          />
          {payError && <div className="text-xs text-[#B91C1C] font-medium">{payError}</div>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setPayEmp(null)}>
              إلغاء
            </Button>
            <Button type="submit" disabled={savingPay}>
              {savingPay ? 'جاري الاعتماد...' : 'اعتماد وصرف الراتب'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Employee Account History Modal */}
      <Modal
        isOpen={profileOpen}
        onClose={() => setProfileOpen(false)}
        title="سجل الموظف والحضور والرواتب"
        maxWidth="xl"
      >
        {loadingProfile ? (
          <div className="py-10 text-center text-xs text-[#5A6B6E]">جاري تحميل السجل...</div>
        ) : !profileData ? (
          <div className="py-10 text-center text-xs text-[#B91C1C]">تعذر تحميل بيانات الموظف.</div>
        ) : (
          <div className="space-y-5 text-xs">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="p-3 rounded-lg bg-[#F5F7F6] border border-[#E2E7E5]">
                <div className="text-[#5A6B6E]">الموظف</div>
                <div className="font-bold text-sm mt-1">{profileData.employee.name}</div>
                <div className="text-[#5A6B6E]">{profileData.employee.jobTitle}</div>
              </div>
              <div className="p-3 rounded-lg bg-[#F5F7F6] border border-[#E2E7E5]">
                <div className="text-[#5A6B6E]">الراتب الشهري</div>
                <div className="font-mono font-bold text-sm mt-1">
                  {formatCurrency(profileData.employee.monthlySalary)}
                </div>
              </div>
              <div className="p-3 rounded-lg bg-[#F5F7F6] border border-[#E2E7E5]">
                <div className="text-[#5A6B6E]">المنصرف</div>
                <div className="font-mono font-bold text-sm text-[#176B55] mt-1">
                  {formatCurrency(profileData.employee.paidThisMonth)}
                </div>
              </div>
              <div className="p-3 rounded-lg bg-[#F5F7F6] border border-[#E2E7E5]">
                <div className="text-[#5A6B6E]">أيام الحضور / المتبقي</div>
                <div className="font-mono font-bold text-sm mt-1">
                  {profileData.employee.attendanceDays} يوم ·{' '}
                  {formatCurrency(profileData.employee.remainingSalary)}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className="border border-[#E2E7E5] rounded-lg overflow-hidden">
                <div className="px-4 py-2.5 bg-[#F5F7F6] font-semibold text-[#142D35] border-b border-[#E2E7E5]">
                  سجل صرف الرواتب ({profileData.payroll.length})
                </div>
                {profileData.payroll.length === 0 ? (
                  <div className="p-4 text-center text-[#5A6B6E]">لا توجد دفعات رواتب مسجلة بعد.</div>
                ) : (
                  <table className="w-full text-right">
                    <thead className="bg-[#F5F7F6]/60 text-[#5A6B6E] border-b border-[#E2E7E5]">
                      <tr>
                        <th className="py-2 px-3">المرجع / الشهر</th>
                        <th className="py-2 px-3">الوسيلة</th>
                        <th className="py-2 px-3">المبلغ</th>
                        <th className="py-2 px-3">تصحيح</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#E2E7E5]">
                      {profileData.payroll.map((p) => (
                        <tr key={p.id}>
                          <td className="py-2 px-3 font-mono">
                            <div>{p.reference}</div>
                            <div className="text-[#5A6B6E]">
                              {p.month} · {p.paidDate}
                            </div>
                          </td>
                          <td className="py-2 px-3">{p.paymentMethod}</td>
                          <td
                            className={`py-2 px-3 font-mono font-bold ${
                              p.amountPaid < 0 ? 'text-[#B91C1C]' : 'text-[#176B55]'
                            }`}
                          >
                            {formatCurrency(p.amountPaid)}
                          </td>
                          <td className="py-2 px-3">
                            {!p.isReversal && p.amountPaid > 0 ? (
                              <button
                                type="button"
                                onClick={() => {
                                  setRevPayrollReason('تصحيح قيد صرف راتب');
                                  setRevPayrollId(p.id);
                                }}
                                className="inline-flex items-center gap-1 text-[#9A6714] hover:underline cursor-pointer"
                              >
                                <RotateCcw className="w-3 h-3" />
                                <span>عكس</span>
                              </button>
                            ) : (
                              <span className="text-[#5A6B6E]">معكوس</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>

              <div className="border border-[#E2E7E5] rounded-lg overflow-hidden">
                <div className="px-4 py-2.5 bg-[#F5F7F6] font-semibold text-[#142D35] border-b border-[#E2E7E5]">
                  سجل الحضور والدوام ({profileData.attendance.length})
                </div>
                {profileData.attendance.length === 0 ? (
                  <div className="p-4 text-center text-[#5A6B6E]">لا توجد سجلات حضور مضافة بعد.</div>
                ) : (
                  <table className="w-full text-right">
                    <thead className="bg-[#F5F7F6]/60 text-[#5A6B6E] border-b border-[#E2E7E5]">
                      <tr>
                        <th className="py-2 px-3">التاريخ</th>
                        <th className="py-2 px-3">الحالة</th>
                        <th className="py-2 px-3">ملاحظات</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#E2E7E5]">
                      {profileData.attendance.map((a) => (
                        <tr key={a.id}>
                          <td className="py-2 px-3 font-mono">{a.date}</td>
                          <td className="py-2 px-3">
                            <StatusText
                              tone={
                                a.status === 'حاضر'
                                  ? 'success'
                                  : a.status === 'غائب'
                                  ? 'danger'
                                  : 'warning'
                              }
                              label={a.status}
                            />
                          </td>
                          <td className="py-2 px-3 text-[#5A6B6E]">{a.notes || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          </div>
        )}
      </Modal>

      <ConfirmDialog
        isOpen={Boolean(revPayrollId)}
        onClose={() => setRevPayrollId(null)}
        onConfirm={handleConfirmReversePayroll}
        loading={reversingPayroll}
        tone="warning"
        title="تأكيد عكس صرف راتب"
        message="سيتم عكس قيد الراتب وإلغاء أثره في المصروفات والخزينة وتحديث المنصرف للموظف."
        confirmLabel="تنفيذ القيد العكسي"
      >
        <Input
          label="سبب القيد العكسي"
          value={revPayrollReason}
          onChange={(e) => setRevPayrollReason(e.target.value)}
        />
      </ConfirmDialog>
    </div>
  );
};

// Keep unused icon clean
void Receipt;
void Search;
