import React, { useEffect, useMemo, useState } from 'react';
import {
  Plus,
  Search,
  FilePlus2,
  Phone,
  MapPin,
  ArrowUpLeft,
  Pencil,
  Trash2,
  Power,
  CheckCircle2,
  XCircle,
  Eye,
  ChevronRight,
  ChevronLeft,
} from 'lucide-react';
import { useSbms } from '../../context/SbmsContext';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Input, Select } from '../../components/ui/FormControls';
import { Modal } from '../../components/ui/Modal';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { StatusText } from '../../components/ui/StatusText';
import { formatCurrency, formatNumber } from '../../lib/utils';
import { PurchaseInvoice, Supplier } from '../../types/sbms';

interface SuppliersPageProps {
  onOpenProfile: (supplierId: string) => void;
}

interface InvoiceDraftLine {
  key: string;
  inventoryItemId: string;
  quantity: string;
  unitPrice: string;
  batchCode: string;
  expiryDate: string;
}

export const SuppliersPage: React.FC<SuppliersPageProps> = ({ onOpenProfile }) => {
  const {
    suppliers,
    invoices,
    inventory,
    addSupplier,
    updateSupplier,
    createPurchaseInvoice,
    postPurchaseInvoice,
    cancelPurchaseInvoice,
    settings,
  } = useSbms();

  const [activeTab, setActiveTab] = useState<'suppliers' | 'invoices'>('suppliers');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'نشط' | 'موقوف'>('ALL');
  const [categoryFilter, setCategoryFilter] = useState<string>('ALL');
  const [supPage, setSupPage] = useState(1);
  const supPageSize = 8;

  // Invoices filters & pagination
  const [invSearch, setInvSearch] = useState('');
  const [invWorkflowFilter, setInvWorkflowFilter] = useState<'ALL' | 'مرحّلة' | 'مسودة' | 'ملغاة'>('ALL');
  const [invPayFilter, setInvPayFilter] = useState<'ALL' | 'مدفوعة بالكامل' | 'مدفوعة جزئياً' | 'آجلة'>('ALL');
  const [invPage, setInvPage] = useState(1);
  const invPageSize = 8;

  // Modals
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [editingSupplier, setEditingSupplier] = useState<(Supplier & { categoriesText: string }) | null>(null);
  const [invoiceModalOpen, setInvoiceModalOpen] = useState(false);
  const [viewingInvoice, setViewingInvoice] = useState<PurchaseInvoice | null>(null);

  // Confirm dialogs
  const [toggleTarget, setToggleTarget] = useState<Supplier | null>(null);
  const [toggling, setToggling] = useState(false);
  const [postTarget, setPostTarget] = useState<PurchaseInvoice | null>(null);
  const [posting, setPosting] = useState(false);
  const [cancelTarget, setCancelTarget] = useState<PurchaseInvoice | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [cancelling, setCancelling] = useState(false);
  const [actionBannerError, setActionBannerError] = useState('');

  // Add Supplier state
  const [supName, setSupName] = useState('');
  const [supPhone, setSupPhone] = useState('');
  const [supAddress, setSupAddress] = useState('');
  const [supCategory, setSupCategory] = useState('دقيق قمح');
  const [supNotes, setSupNotes] = useState('');
  const [supError, setSupError] = useState('');
  const [submittingSup, setSubmittingSup] = useState(false);
  const [submittingEdit, setSubmittingEdit] = useState(false);
  const [editError, setEditError] = useState('');

  // Multi-item Purchase Invoice state
  const activeSuppliers = useMemo(() => suppliers.filter((s) => s.status === 'نشط'), [suppliers]);
  const [invSupplierId, setInvSupplierId] = useState('');
  const [invAutoNum, setInvAutoNum] = useState(true);
  const [invNumber, setInvNumber] = useState('');
  const [invDate, setInvDate] = useState(new Date().toISOString().slice(0, 10));
  const [invWorkflow, setInvWorkflow] = useState<'مرحّلة' | 'مسودة'>('مرحّلة');
  const [invLines, setInvLines] = useState<InvoiceDraftLine[]>([]);
  const [invInitialPay, setInvInitialPay] = useState('0');
  const [invPayMethod, setInvPayMethod] = useState<'نقداً' | 'تحويل بنكي (بنكك)' | 'شيك'>('نقداً');
  const [invNotes, setInvNotes] = useState('');
  const [invError, setInvError] = useState('');
  const [submittingInv, setSubmittingInv] = useState(false);

  useEffect(() => {
    if (!invSupplierId && activeSuppliers.length > 0) {
      setInvSupplierId(activeSuppliers[0].id);
    }
  }, [activeSuppliers, invSupplierId]);

  useEffect(() => {
    if (invLines.length === 0 && inventory.length > 0) {
      const first = inventory[0];
      setInvLines([
        {
          key: `line-${Date.now()}`,
          inventoryItemId: first.id,
          quantity: '10',
          unitPrice: String(first.averageCost || 1000),
          batchCode: '',
          expiryDate: '',
        },
      ]);
    }
  }, [inventory, invLines.length]);

  const allCategories = useMemo(() => {
    const set = new Set<string>();
    suppliers.forEach((s) => s.categories.forEach((c) => set.add(c)));
    return Array.from(set);
  }, [suppliers]);

  const filteredSuppliers = useMemo(() => {
    return suppliers.filter((s) => {
      const q = search.trim().toLowerCase();
      const matchesSearch =
        !q ||
        s.name.toLowerCase().includes(q) ||
        s.phone.toLowerCase().includes(q) ||
        s.code.toLowerCase().includes(q) ||
        s.address.toLowerCase().includes(q);
      const matchesStatus = statusFilter === 'ALL' || s.status === statusFilter;
      const matchesCat =
        categoryFilter === 'ALL' || s.categories.some((c) => c === categoryFilter);
      return matchesSearch && matchesStatus && matchesCat;
    });
  }, [suppliers, search, statusFilter, categoryFilter]);

  const supTotalPages = Math.max(1, Math.ceil(filteredSuppliers.length / supPageSize));
  const pagedSuppliers = useMemo(() => {
    const safePage = Math.min(supPage, supTotalPages);
    return filteredSuppliers.slice((safePage - 1) * supPageSize, safePage * supPageSize);
  }, [filteredSuppliers, supPage, supTotalPages]);

  const filteredInvoices = useMemo(() => {
    return invoices.filter((inv) => {
      const q = invSearch.trim().toLowerCase();
      const matchesSearch =
        !q ||
        inv.invoiceNumber.toLowerCase().includes(q) ||
        inv.supplierName.toLowerCase().includes(q) ||
        inv.items.some((it) => it.itemName.toLowerCase().includes(q));
      const wf = inv.workflowStatus || 'مرحّلة';
      const matchesWf = invWorkflowFilter === 'ALL' || wf === invWorkflowFilter;
      const matchesPay = invPayFilter === 'ALL' || inv.status === invPayFilter;
      return matchesSearch && matchesWf && matchesPay;
    });
  }, [invoices, invSearch, invWorkflowFilter, invPayFilter]);

  const invTotalPages = Math.max(1, Math.ceil(filteredInvoices.length / invPageSize));
  const pagedInvoices = useMemo(() => {
    const safePage = Math.min(invPage, invTotalPages);
    return filteredInvoices.slice((safePage - 1) * invPageSize, safePage * invPageSize);
  }, [filteredInvoices, invPage, invTotalPages]);

  const totalDebt = suppliers.reduce(
    (acc, s) => acc + (s.totalPurchases - s.totalPayments + s.adjustments),
    0
  );
  const totalPurchasesSum = suppliers.reduce((acc, s) => acc + s.totalPurchases, 0);
  const totalPaymentsSum = suppliers.reduce((acc, s) => acc + s.totalPayments, 0);

  const invoiceGrandTotal = useMemo(() => {
    return invLines.reduce(
      (sum, l) => sum + (Number(l.quantity) || 0) * (Number(l.unitPrice) || 0),
      0
    );
  }, [invLines]);

  const addInvoiceLine = () => {
    if (inventory.length === 0) return;
    const item = inventory[Math.min(invLines.length, inventory.length - 1)];
    setInvLines((prev) => [
      ...prev,
      {
        key: `line-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        inventoryItemId: item.id,
        quantity: '5',
        unitPrice: String(item.averageCost || 1000),
        batchCode: '',
        expiryDate: '',
      },
    ]);
  };

  const updateInvoiceLine = (key: string, patch: Partial<InvoiceDraftLine>) => {
    setInvLines((prev) =>
      prev.map((line) => {
        if (line.key !== key) return line;
        const next = { ...line, ...patch };
        if (patch.inventoryItemId) {
          const item = inventory.find((i) => i.id === patch.inventoryItemId);
          if (item) {
            next.unitPrice = String(item.averageCost || 1000);
          }
        }
        return next;
      })
    );
  };

  const removeInvoiceLine = (key: string) => {
    if (invLines.length <= 1) return;
    setInvLines((prev) => prev.filter((l) => l.key !== key));
  };

  const handleAddSupplier = async (e: React.FormEvent) => {
    e.preventDefault();
    setSupError('');
    if (supName.trim().length < 2) {
      setSupError('يرجى إدخال اسم المورد (حرفين على الأقل).');
      return;
    }
    if (supPhone.trim().length < 6) {
      setSupError('يرجى إدخال رقم هاتف صحيح.');
      return;
    }
    setSubmittingSup(true);
    const categories = supCategory
      .split(/[،,]/)
      .map((s) => s.trim())
      .filter(Boolean);
    const res = await addSupplier({
      name: supName.trim(),
      code: `SUP-00${suppliers.length + 1}`,
      phone: supPhone.trim(),
      address: supAddress.trim() || 'الخرطوم',
      categories: categories.length > 0 ? categories : ['دقيق قمح'],
      status: 'نشط',
      notes: supNotes.trim() || undefined,
    });
    setSubmittingSup(false);
    if (!res.ok) {
      setSupError(res.error || 'تعذر حفظ بيانات المورد');
      return;
    }
    setSupName('');
    setSupPhone('');
    setSupAddress('');
    setSupNotes('');
    setAddModalOpen(false);
  };

  const handleEditSupplier = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingSupplier) return;
    setEditError('');
    setSubmittingEdit(true);
    const categories = editingSupplier.categoriesText
      .split(/[،,]/)
      .map((s) => s.trim())
      .filter(Boolean);
    const res = await updateSupplier(editingSupplier.id, {
      name: editingSupplier.name.trim(),
      phone: editingSupplier.phone.trim(),
      address: editingSupplier.address.trim(),
      categories: categories.length > 0 ? categories : editingSupplier.categories,
      status: editingSupplier.status,
      notes: editingSupplier.notes,
    });
    setSubmittingEdit(false);
    if (!res.ok) {
      setEditError(res.error || 'تعذر تحديث بيانات المورد');
      return;
    }
    setEditingSupplier(null);
  };

  const handleConfirmToggleSupplier = async () => {
    if (!toggleTarget) return;
    setToggling(true);
    setActionBannerError('');
    const nextStatus = toggleTarget.status === 'نشط' ? 'موقوف' : 'نشط';
    const res = await updateSupplier(toggleTarget.id, { status: nextStatus });
    setToggling(false);
    if (!res.ok) {
      setActionBannerError(res.error || 'تعذر تحديث حالة المورد');
    }
    setToggleTarget(null);
  };

  const handleCreateInvoice = async (e: React.FormEvent) => {
    e.preventDefault();
    setInvError('');

    if (!invSupplierId) {
      setInvError('يرجى اختيار مورد نشط.');
      return;
    }
    if (!invAutoNum && invNumber.trim().length < 2) {
      setInvError('يرجى إدخال رقم الفاتورة أو تفعيل التوليد التلقائي.');
      return;
    }
    if (invLines.length === 0) {
      setInvError('يرجى إضافة صنف واحد على الأقل.');
      return;
    }

    const mappedItems = invLines.map((l) => {
      const invItem = inventory.find((i) => i.id === l.inventoryItemId);
      return {
        inventoryItemId: l.inventoryItemId,
        quantity: Number(l.quantity),
        unit: invItem?.unit,
        unitPrice: Number(l.unitPrice),
        batchCode: l.batchCode.trim() || undefined,
        expiryDate: l.expiryDate.trim() || undefined,
      };
    });

    if (mappedItems.some((m) => !(m.quantity > 0) || !(m.unitPrice > 0))) {
      setInvError('يجب أن تكون الكمية وسعر الوحدة أكبر من صفر في جميع البنود.');
      return;
    }

    const initPay = Number(invInitialPay) || 0;
    if (initPay > invoiceGrandTotal) {
      setInvError('الدفعة الأولى لا يمكن أن تتجاوز إجمالي الفاتورة.');
      return;
    }

    setSubmittingInv(true);
    const res = await createPurchaseInvoice({
      supplierId: invSupplierId,
      invoiceNumber: invAutoNum ? 'AUTO' : invNumber.trim(),
      date: invDate,
      workflowStatus: invWorkflow,
      items: mappedItems,
      initialPayment: initPay,
      initialPaymentMethod: invPayMethod,
      notes: invNotes.trim() || undefined,
    });
    setSubmittingInv(false);
    if (!res.ok) {
      setInvError(res.error || 'تعذر حفظ الفاتورة');
      return;
    }
    setInvoiceModalOpen(false);
    setInvNumber('');
    setInvNotes('');
    setInvInitialPay('0');
    setInvLines([]);
  };

  const handleConfirmPostInvoice = async () => {
    if (!postTarget) return;
    setPosting(true);
    setActionBannerError('');
    const res = await postPurchaseInvoice(postTarget.id);
    setPosting(false);
    if (!res.ok) {
      setActionBannerError(res.error || 'تعذر ترحيل الفاتورة.');
    }
    setPostTarget(null);
  };

  const handleConfirmCancelInvoice = async () => {
    if (!cancelTarget) return;
    if (cancelReason.trim().length < 3) {
      setActionBannerError('يرجى كتابة سبب الإلغاء (3 أحرف على الأقل).');
      return;
    }
    setCancelling(true);
    setActionBannerError('');
    const res = await cancelPurchaseInvoice(cancelTarget.id, cancelReason.trim());
    setCancelling(false);
    if (!res.ok) {
      setActionBannerError(res.error || 'تعذر إلغاء الفاتورة.');
    }
    setCancelTarget(null);
    setCancelReason('');
  };

  return (
    <div className="space-y-6">
      {/* Header Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-[#142D35]">إدارة الموردين وفواتير المشتريات</h2>
          <p className="text-xs text-[#5A6B6E] mt-1">
            دليل الموردين، فواتير الشراء متعددة الأصناف، حالات المسودة والترحيل والإلغاء، وكشوف الحسابات.
          </p>
        </div>
        <div className="flex items-center gap-2.5 flex-wrap">
          <Button variant="outline" onClick={() => setAddModalOpen(true)}>
            <Plus className="w-4 h-4" />
            <span>إضافة مورد جديد</span>
          </Button>
          <Button onClick={() => setInvoiceModalOpen(true)}>
            <FilePlus2 className="w-4 h-4" />
            <span>فاتورة مشتريات جديدة</span>
          </Button>
        </div>
      </div>

      {actionBannerError && (
        <div className="p-3 rounded-lg bg-[#FEE2E2] border border-[#FECACA] text-xs text-[#B91C1C] font-medium flex items-center justify-between">
          <span>{actionBannerError}</span>
          <button
            type="button"
            onClick={() => setActionBannerError('')}
            className="underline cursor-pointer"
          >
            إغلاق
          </button>
        </div>
      )}

      {/* Summary Metrics */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <div className="text-xs text-[#5A6B6E]">إجمالي المشتريات التراكمية (المرحّلة)</div>
          <div className="text-xl font-bold text-[#142D35] font-mono tabular-nums mt-1.5">
            {formatCurrency(totalPurchasesSum, settings.currencySymbol)}
          </div>
        </Card>
        <Card>
          <div className="text-xs text-[#5A6B6E]">إجمالي المدفوعات المسددة</div>
          <div className="text-xl font-bold text-[#176B55] font-mono tabular-nums mt-1.5">
            {formatCurrency(totalPaymentsSum, settings.currencySymbol)}
          </div>
        </Card>
        <Card>
          <div className="text-xs text-[#5A6B6E]">الرصيد المستحق للموردين</div>
          <div className="text-xl font-bold text-[#B91C1C] font-mono tabular-nums mt-1.5">
            {formatCurrency(totalDebt, settings.currencySymbol)}
          </div>
        </Card>
      </div>

      {/* Sub-navigation tabs */}
      <div className="inline-flex items-center gap-1 p-1 bg-[#E2E7E5]/50 rounded-lg">
        <button
          type="button"
          onClick={() => setActiveTab('suppliers')}
          className={`px-4 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer ${
            activeTab === 'suppliers' ? 'bg-white text-[#142D35]' : 'text-[#5A6B6E] hover:text-[#142D35]'
          }`}
        >
          دليل الموردين ({suppliers.length})
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('invoices')}
          className={`px-4 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer ${
            activeTab === 'invoices' ? 'bg-white text-[#142D35]' : 'text-[#5A6B6E] hover:text-[#142D35]'
          }`}
        >
          سجل فواتير المشتريات ({invoices.length})
        </button>
      </div>

      {activeTab === 'suppliers' ? (
        <>
          {/* Suppliers Filter Bar */}
          <Card padding="sm">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
              <div className="flex flex-col sm:flex-row sm:items-center gap-2.5 flex-1">
                <div className="relative w-full sm:w-72">
                  <Search className="w-4 h-4 text-[#5A6B6E] absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type="text"
                    value={search}
                    onChange={(e) => {
                      setSearch(e.target.value);
                      setSupPage(1);
                    }}
                    placeholder="بحث باسم المورد، الكود، الهاتف..."
                    className="h-9 w-full rounded-lg border border-[#E2E7E5] pr-9 pl-3 text-xs text-[#142D35] focus:outline-none focus:border-[#176B55]"
                  />
                </div>
                <select
                  value={categoryFilter}
                  onChange={(e) => {
                    setCategoryFilter(e.target.value);
                    setSupPage(1);
                  }}
                  className="h-9 rounded-lg border border-[#E2E7E5] bg-white px-3 text-xs text-[#142D35]"
                >
                  <option value="ALL">جميع التصنيفات</option>
                  {allCategories.map((cat) => (
                    <option key={cat} value={cat}>
                      {cat}
                    </option>
                  ))}
                </select>
              </div>
              <div className="inline-flex items-center gap-1 p-1 bg-[#F5F7F6] rounded-lg border border-[#E2E7E5] self-start">
                {(['ALL', 'نشط', 'موقوف'] as const).map((st) => (
                  <button
                    key={st}
                    type="button"
                    onClick={() => {
                      setStatusFilter(st);
                      setSupPage(1);
                    }}
                    className={`px-3 py-1 text-xs font-medium rounded-md transition-colors cursor-pointer ${
                      statusFilter === st ? 'bg-white text-[#142D35]' : 'text-[#5A6B6E]'
                    }`}
                  >
                    {st === 'ALL' ? 'الكل' : st}
                  </button>
                ))}
              </div>
            </div>
          </Card>

          {/* Suppliers Table */}
          <Card padding="none" className="overflow-hidden">
            {pagedSuppliers.length === 0 ? (
              <div className="p-10 text-center text-sm text-[#5A6B6E]">
                لا يوجد موردون مطابقون لمعايير البحث والتصفية الحالية.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm text-right">
                  <thead className="bg-[#F5F7F6] text-xs text-[#5A6B6E] border-b border-[#E2E7E5]">
                    <tr>
                      <th className="py-3.5 px-4 font-medium">المورد</th>
                      <th className="py-3.5 px-4 font-medium">التواصل والعنوان</th>
                      <th className="py-3.5 px-4 font-medium">التصنيف</th>
                      <th className="py-3.5 px-4 font-medium">إجمالي المشتريات</th>
                      <th className="py-3.5 px-4 font-medium">المدفوع</th>
                      <th className="py-3.5 px-4 font-medium">الرصيد المتبقي</th>
                      <th className="py-3.5 px-4 font-medium">الحالة</th>
                      <th className="py-3.5 px-4 font-medium">الإجراءات</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#E2E7E5]">
                    {pagedSuppliers.map((sup) => {
                      const balance = sup.totalPurchases - sup.totalPayments + sup.adjustments;
                      return (
                        <tr key={sup.id} className="hover:bg-[#F5F7F6]/60 transition-colors">
                          <td className="py-3.5 px-4">
                            <button
                              type="button"
                              onClick={() => onOpenProfile(sup.id)}
                              className="flex items-center gap-3 text-right group cursor-pointer"
                            >
                              <div className="w-9 h-9 rounded-lg bg-[#142D35] text-[#D8AD65] flex items-center justify-center text-xs font-bold shrink-0">
                                {sup.name.slice(0, 2)}
                              </div>
                              <div>
                                <div className="font-semibold text-[#142D35] group-hover:text-[#176B55] transition-colors">
                                  {sup.name}
                                </div>
                                <div className="text-[11px] font-mono text-[#5A6B6E]">{sup.code}</div>
                              </div>
                            </button>
                          </td>
                          <td className="py-3.5 px-4 text-xs text-[#5A6B6E]">
                            <div className="flex items-center gap-1.5 font-mono" dir="ltr">
                              <Phone className="w-3 h-3 shrink-0" />
                              <span>{sup.phone}</span>
                            </div>
                            <div className="flex items-center gap-1.5 mt-0.5">
                              <MapPin className="w-3 h-3 shrink-0" />
                              <span className="truncate max-w-[180px]">{sup.address}</span>
                            </div>
                          </td>
                          <td className="py-3.5 px-4 text-xs text-[#5A6B6E]">
                            {sup.categories.join(' · ')}
                          </td>
                          <td className="py-3.5 px-4 font-mono tabular-nums font-medium">
                            {formatCurrency(sup.totalPurchases)}
                          </td>
                          <td className="py-3.5 px-4 font-mono tabular-nums text-[#176B55]">
                            {formatCurrency(sup.totalPayments)}
                          </td>
                          <td className="py-3.5 px-4 font-mono tabular-nums font-bold text-[#142D35]">
                            {formatCurrency(balance)}
                          </td>
                          <td className="py-3.5 px-4">
                            <StatusText
                              tone={sup.status === 'نشط' ? 'success' : 'neutral'}
                              label={sup.status}
                            />
                          </td>
                          <td className="py-3.5 px-4">
                            <div className="flex items-center gap-1.5">
                              <Button variant="outline" size="sm" onClick={() => onOpenProfile(sup.id)}>
                                <span>كشف الحساب</span>
                                <ArrowUpLeft className="w-3.5 h-3.5" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() =>
                                  setEditingSupplier({
                                    ...sup,
                                    categoriesText: sup.categories.join('، '),
                                  })
                                }
                                title="تعديل بيانات المورد"
                              >
                                <Pencil className="w-3.5 h-3.5" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setToggleTarget(sup)}
                                title={sup.status === 'نشط' ? 'إيقاف المورد' : 'تفعيل المورد'}
                              >
                                <Power
                                  className={`w-3.5 h-3.5 ${
                                    sup.status === 'نشط' ? 'text-[#B91C1C]' : 'text-[#176B55]'
                                  }`}
                                />
                              </Button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* Pagination Footer */}
            {filteredSuppliers.length > supPageSize && (
              <div className="px-4 py-3 border-t border-[#E2E7E5] flex items-center justify-between text-xs text-[#5A6B6E]">
                <span>
                  عرض {pagedSuppliers.length} من أصل {filteredSuppliers.length} مورد
                </span>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={supPage <= 1}
                    onClick={() => setSupPage((p) => Math.max(1, p - 1))}
                  >
                    <ChevronRight className="w-3.5 h-3.5" />
                    <span>السابق</span>
                  </Button>
                  <span className="font-mono">
                    {supPage} / {supTotalPages}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={supPage >= supTotalPages}
                    onClick={() => setSupPage((p) => Math.min(supTotalPages, p + 1))}
                  >
                    <span>التالي</span>
                    <ChevronLeft className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>
            )}
          </Card>
        </>
      ) : (
        <>
          {/* Invoices Filter Bar */}
          <Card padding="sm">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="relative">
                <Search className="w-4 h-4 text-[#5A6B6E] absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  value={invSearch}
                  onChange={(e) => {
                    setInvSearch(e.target.value);
                    setInvPage(1);
                  }}
                  placeholder="بحث برقم الفاتورة، المورد، أو الصنف..."
                  className="h-9 w-full rounded-lg border border-[#E2E7E5] pr-9 pl-3 text-xs text-[#142D35] focus:outline-none focus:border-[#176B55]"
                />
              </div>
              <select
                value={invWorkflowFilter}
                onChange={(e) => {
                  setInvWorkflowFilter(e.target.value as typeof invWorkflowFilter);
                  setInvPage(1);
                }}
                className="h-9 rounded-lg border border-[#E2E7E5] bg-white px-3 text-xs text-[#142D35]"
              >
                <option value="ALL">جميع حالات الفاتورة</option>
                <option value="مرحّلة">مرحّلة</option>
                <option value="مسودة">مسودة</option>
                <option value="ملغاة">ملغاة</option>
              </select>
              <select
                value={invPayFilter}
                onChange={(e) => {
                  setInvPayFilter(e.target.value as typeof invPayFilter);
                  setInvPage(1);
                }}
                className="h-9 rounded-lg border border-[#E2E7E5] bg-white px-3 text-xs text-[#142D35]"
              >
                <option value="ALL">جميع حالات السداد</option>
                <option value="مدفوعة بالكامل">مدفوعة بالكامل</option>
                <option value="مدفوعة جزئياً">مدفوعة جزئياً</option>
                <option value="آجلة">آجلة</option>
              </select>
            </div>
          </Card>

          {/* Invoices Table */}
          <Card padding="none" className="overflow-hidden">
            {pagedInvoices.length === 0 ? (
              <div className="p-10 text-center text-sm text-[#5A6B6E]">
                لا توجد فواتير مشتريات مطابقة للتصفية الحالية.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm text-right">
                  <thead className="bg-[#F5F7F6] text-xs text-[#5A6B6E] border-b border-[#E2E7E5]">
                    <tr>
                      <th className="py-3.5 px-4 font-medium">رقم الفاتورة / التاريخ</th>
                      <th className="py-3.5 px-4 font-medium">المورد</th>
                      <th className="py-3.5 px-4 font-medium">الأصناف</th>
                      <th className="py-3.5 px-4 font-medium">الإجمالي</th>
                      <th className="py-3.5 px-4 font-medium">المدفوع / المتبقي</th>
                      <th className="py-3.5 px-4 font-medium">الحالة</th>
                      <th className="py-3.5 px-4 font-medium">إجراءات</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#E2E7E5]">
                    {pagedInvoices.map((inv) => {
                      const wf = inv.workflowStatus || 'مرحّلة';
                      return (
                        <tr key={inv.id} className="hover:bg-[#F5F7F6]/60">
                          <td className="py-3.5 px-4">
                            <div className="font-mono text-xs font-bold text-[#142D35]">
                              {inv.invoiceNumber}
                            </div>
                            <div className="font-mono text-[11px] text-[#5A6B6E]">{inv.date}</div>
                          </td>
                          <td className="py-3.5 px-4 text-xs font-medium text-[#142D35]">
                            <button
                              type="button"
                              onClick={() => onOpenProfile(inv.supplierId)}
                              className="hover:text-[#176B55] hover:underline cursor-pointer text-right"
                            >
                              {inv.supplierName}
                            </button>
                          </td>
                          <td className="py-3.5 px-4 text-xs text-[#5A6B6E]">
                            {inv.items.length === 1 ? (
                              <span>
                                {inv.items[0].itemName} ({formatNumber(inv.items[0].quantity)}{' '}
                                {inv.items[0].unit})
                              </span>
                            ) : (
                              <span>{inv.items.length} أصناف مخزنية</span>
                            )}
                          </td>
                          <td className="py-3.5 px-4 font-mono tabular-nums font-semibold">
                            {formatCurrency(inv.totalAmount)}
                          </td>
                          <td className="py-3.5 px-4 font-mono tabular-nums text-xs">
                            <div className="text-[#176B55]">مدفوع: {formatCurrency(inv.paidAmount)}</div>
                            <div className="text-[#B91C1C]">
                              متبقي: {formatCurrency(inv.remainingBalance)}
                            </div>
                          </td>
                          <td className="py-3.5 px-4 space-y-1">
                            <div>
                              <StatusText
                                tone={
                                  wf === 'مرحّلة'
                                    ? 'success'
                                    : wf === 'مسودة'
                                    ? 'warning'
                                    : 'neutral'
                                }
                                label={wf}
                              />
                            </div>
                            {wf === 'مرحّلة' && (
                              <div className="text-[11px] text-[#5A6B6E]">{inv.status}</div>
                            )}
                          </td>
                          <td className="py-3.5 px-4">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setViewingInvoice(inv)}
                                title="تفاصيل الفاتورة"
                              >
                                <Eye className="w-3.5 h-3.5" />
                              </Button>
                              {wf === 'مسودة' && (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => setPostTarget(inv)}
                                  title="ترحيل الفاتورة وتوريد المخزون"
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

            {filteredInvoices.length > invPageSize && (
              <div className="px-4 py-3 border-t border-[#E2E7E5] flex items-center justify-between text-xs text-[#5A6B6E]">
                <span>
                  عرض {pagedInvoices.length} من أصل {filteredInvoices.length} فاتورة
                </span>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={invPage <= 1}
                    onClick={() => setInvPage((p) => Math.max(1, p - 1))}
                  >
                    <ChevronRight className="w-3.5 h-3.5" />
                    <span>السابق</span>
                  </Button>
                  <span className="font-mono">
                    {invPage} / {invTotalPages}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={invPage >= invTotalPages}
                    onClick={() => setInvPage((p) => Math.min(invTotalPages, p + 1))}
                  >
                    <span>التالي</span>
                    <ChevronLeft className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>
            )}
          </Card>
        </>
      )}

      {/* Add Supplier Modal */}
      <Modal
        isOpen={addModalOpen}
        onClose={() => setAddModalOpen(false)}
        title="إضافة مورد جديد"
        subtitle="تسجيل بيانات المورد في الدليل المحاسبي"
      >
        <form onSubmit={handleAddSupplier} className="space-y-4">
          <Input
            label="اسم المورد / الشركة"
            required
            value={supName}
            onChange={(e) => setSupName(e.target.value)}
            placeholder="مثال: مطاحن الخرطوم الحديثة"
          />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input
              label="رقم الهاتف"
              required
              value={supPhone}
              onChange={(e) => setSupPhone(e.target.value)}
              placeholder="+249 91 ..."
            />
            <Input
              label="فئات التوريد (مفصولة بفاصلة)"
              value={supCategory}
              onChange={(e) => setSupCategory(e.target.value)}
              placeholder="دقيق قمح، زيت طعام"
            />
          </div>
          <Input
            label="العنوان"
            value={supAddress}
            onChange={(e) => setSupAddress(e.target.value)}
            placeholder="المدينة / المنطقة الصناعية"
          />
          <Input
            label="ملاحظات وتسهيلات السداد (اختياري)"
            value={supNotes}
            onChange={(e) => setSupNotes(e.target.value)}
            placeholder="مثال: مهلة سداد 14 يوماً"
          />
          {supError && <div className="text-xs text-[#B91C1C] font-medium">{supError}</div>}
          <div className="flex items-center justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => setAddModalOpen(false)}>
              إلغاء
            </Button>
            <Button type="submit" disabled={submittingSup}>
              {submittingSup ? 'جاري الحفظ...' : 'حفظ المورد'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Edit Supplier Modal */}
      <Modal
        isOpen={Boolean(editingSupplier)}
        onClose={() => setEditingSupplier(null)}
        title={`تعديل بيانات المورد: ${editingSupplier?.name || ''}`}
      >
        {editingSupplier && (
          <form onSubmit={handleEditSupplier} className="space-y-4">
            <Input
              label="اسم المورد"
              required
              value={editingSupplier.name}
              onChange={(e) => setEditingSupplier({ ...editingSupplier, name: e.target.value })}
            />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Input
                label="رقم الهاتف"
                required
                value={editingSupplier.phone}
                onChange={(e) => setEditingSupplier({ ...editingSupplier, phone: e.target.value })}
              />
              <Select
                label="الحالة"
                value={editingSupplier.status}
                onChange={(e) =>
                  setEditingSupplier({ ...editingSupplier, status: e.target.value as 'نشط' | 'موقوف' })
                }
              >
                <option value="نشط">نشط</option>
                <option value="موقوف">موقوف</option>
              </Select>
            </div>
            <Input
              label="فئات التوريد (مفصولة بفاصلة)"
              value={editingSupplier.categoriesText}
              onChange={(e) =>
                setEditingSupplier({ ...editingSupplier, categoriesText: e.target.value })
              }
            />
            <Input
              label="العنوان"
              value={editingSupplier.address}
              onChange={(e) => setEditingSupplier({ ...editingSupplier, address: e.target.value })}
            />
            <Input
              label="ملاحظات"
              value={editingSupplier.notes || ''}
              onChange={(e) => setEditingSupplier({ ...editingSupplier, notes: e.target.value })}
            />
            {editError && <div className="text-xs text-[#B91C1C] font-medium">{editError}</div>}
            <div className="flex items-center justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => setEditingSupplier(null)}>
                إلغاء
              </Button>
              <Button type="submit" disabled={submittingEdit}>
                {submittingEdit ? 'جاري التحديث...' : 'حفظ التعديلات'}
              </Button>
            </div>
          </form>
        )}
      </Modal>

      {/* Multi-item Create Purchase Invoice Modal */}
      <Modal
        isOpen={invoiceModalOpen}
        onClose={() => setInvoiceModalOpen(false)}
        title="تسجيل فاتورة مشتريات جديدة"
        subtitle="دعم تعدد الأصناف، حالات المسودة والترحيل الفوري، والتحديث الذري للمخزون وحساب المورد"
        maxWidth="xl"
      >
        <form onSubmit={handleCreateInvoice} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Select
              label="المورد (النشطون)"
              value={invSupplierId}
              onChange={(e) => setInvSupplierId(e.target.value)}
            >
              {activeSuppliers.length === 0 ? (
                <option value="">لا يوجد موردون نشطون</option>
              ) : (
                activeSuppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s.code})
                  </option>
                ))
              )}
            </Select>
            <Input
              label="تاريخ الفاتورة"
              type="date"
              required
              value={invDate}
              onChange={(e) => setInvDate(e.target.value)}
            />
            <Select
              label="حالة الاعتماد"
              value={invWorkflow}
              onChange={(e) => setInvWorkflow(e.target.value as 'مرحّلة' | 'مسودة')}
            >
              <option value="مرحّلة">ترحيل فوري (توريد المخزون)</option>
              <option value="مسودة">حفظ كمسودة (مراجعة لاحقة)</option>
            </Select>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-end">
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs font-medium text-[#142D35]">رقم الفاتورة</label>
                <label className="inline-flex items-center gap-1.5 text-[11px] text-[#5A6B6E] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={invAutoNum}
                    onChange={(e) => setInvAutoNum(e.target.checked)}
                    className="accent-[#176B55]"
                  />
                  <span>توليد رقم فريد تلقائياً</span>
                </label>
              </div>
              <input
                type="text"
                disabled={invAutoNum}
                value={invAutoNum ? 'سيتم التوليد تلقائياً عند الحفظ' : invNumber}
                onChange={(e) => setInvNumber(e.target.value)}
                placeholder="مثال: INV-2026-205"
                className="h-10 w-full rounded-lg border border-[#E2E7E5] bg-white px-3 text-sm text-[#142D35] disabled:bg-[#F5F7F6] disabled:text-[#5A6B6E]"
              />
            </div>
            <Input
              label="ملاحظات الفاتورة"
              value={invNotes}
              onChange={(e) => setInvNotes(e.target.value)}
              placeholder="رقم إشعار التوريد أو تفاصيل الشحنة"
            />
          </div>

          {/* Line Items Builder */}
          <div className="border border-[#E2E7E5] rounded-xl overflow-hidden">
            <div className="bg-[#F5F7F6] px-4 py-2.5 flex items-center justify-between border-b border-[#E2E7E5]">
              <span className="text-xs font-semibold text-[#142D35]">
                بنود الأصناف المشتراة ({invLines.length})
              </span>
              <Button type="button" variant="outline" size="sm" onClick={addInvoiceLine}>
                <Plus className="w-3.5 h-3.5" />
                <span>إضافة صنف آخر</span>
              </Button>
            </div>
            <div className="divide-y divide-[#E2E7E5] max-h-64 overflow-y-auto">
              {invLines.map((line, idx) => {
                const selectedInvItem = inventory.find((i) => i.id === line.inventoryItemId);
                const lineTotal = (Number(line.quantity) || 0) * (Number(line.unitPrice) || 0);
                return (
                  <div key={line.key} className="p-3 space-y-2.5 bg-white">
                    <div className="grid grid-cols-1 sm:grid-cols-12 gap-2.5 items-end">
                      <div className="sm:col-span-5">
                        <Select
                          label={`الصنف #${idx + 1}`}
                          value={line.inventoryItemId}
                          onChange={(e) =>
                            updateInvoiceLine(line.key, { inventoryItemId: e.target.value })
                          }
                        >
                          {inventory.map((item) => (
                            <option key={item.id} value={item.id}>
                              {item.name} ({item.unit})
                            </option>
                          ))}
                        </Select>
                      </div>
                      <div className="sm:col-span-2">
                        <Input
                          label={`الكمية (${selectedInvItem?.unit || ''})`}
                          type="number"
                          min="0.01"
                          step="any"
                          required
                          value={line.quantity}
                          onChange={(e) => updateInvoiceLine(line.key, { quantity: e.target.value })}
                        />
                      </div>
                      <div className="sm:col-span-3">
                        <Input
                          label="سعر الوحدة (ج.س)"
                          type="number"
                          min="1"
                          step="any"
                          required
                          value={line.unitPrice}
                          onChange={(e) =>
                            updateInvoiceLine(line.key, { unitPrice: e.target.value })
                          }
                        />
                      </div>
                      <div className="sm:col-span-2 flex items-center justify-between gap-2 pb-1">
                        <div className="text-xs">
                          <div className="text-[10px] text-[#5A6B6E]">الإجمالي</div>
                          <div className="font-mono font-bold text-[#142D35]">
                            {formatCurrency(lineTotal)}
                          </div>
                        </div>
                        <button
                          type="button"
                          disabled={invLines.length <= 1}
                          onClick={() => removeInvoiceLine(line.key)}
                          className="p-2 text-[#B91C1C] hover:bg-[#FEE2E2] rounded-lg disabled:opacity-30 cursor-pointer"
                          title="حذف البند"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                      <Input
                        label="كود التشغيلة / الدفعة (اختياري)"
                        value={line.batchCode}
                        onChange={(e) => updateInvoiceLine(line.key, { batchCode: e.target.value })}
                        placeholder="توليد تلقائي إن تُرك فارغاً"
                      />
                      <Input
                        label="تاريخ الصلاحية (اختياري)"
                        type="date"
                        value={line.expiryDate}
                        onChange={(e) =>
                          updateInvoiceLine(line.key, { expiryDate: e.target.value })
                        }
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Payment & Totals */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input
              label="الدفعة المسددة عند التوريد (ج.س)"
              type="number"
              min="0"
              step="any"
              value={invInitialPay}
              onChange={(e) => setInvInitialPay(e.target.value)}
            />
            <Select
              label="طريقة سداد الدفعة الأولى"
              value={invPayMethod}
              onChange={(e) => setInvPayMethod(e.target.value as typeof invPayMethod)}
            >
              <option value="نقداً">نقداً من الخزينة</option>
              <option value="تحويل بنكي (بنكك)">تحويل بنكي (بنكك)</option>
              <option value="شيك">شيك مصرفي</option>
            </Select>
          </div>

          <div className="p-3.5 rounded-lg bg-[#F5F7F6] border border-[#E2E7E5] grid grid-cols-2 gap-3 text-xs">
            <div className="flex items-center justify-between">
              <span className="text-[#5A6B6E]">إجمالي الفاتورة:</span>
              <span className="font-mono tabular-nums font-bold text-sm text-[#142D35]">
                {formatCurrency(invoiceGrandTotal, settings.currencySymbol)}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[#5A6B6E]">المتبقي على الحساب:</span>
              <span className="font-mono tabular-nums font-bold text-sm text-[#B91C1C]">
                {formatCurrency(
                  Math.max(0, invoiceGrandTotal - (Number(invInitialPay) || 0)),
                  settings.currencySymbol
                )}
              </span>
            </div>
          </div>

          {invError && <div className="text-xs text-[#B91C1C] font-medium">{invError}</div>}

          <div className="flex items-center justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => setInvoiceModalOpen(false)}>
              إلغاء
            </Button>
            <Button type="submit" disabled={submittingInv || activeSuppliers.length === 0}>
              {submittingInv
                ? 'جاري التنفيذ...'
                : invWorkflow === 'مسودة'
                ? 'حفظ الفاتورة كمسودة'
                : 'اعتماد الفاتورة وتوريد المخزون'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* View Invoice Details Modal */}
      <Modal
        isOpen={Boolean(viewingInvoice)}
        onClose={() => setViewingInvoice(null)}
        title={`تفاصيل فاتورة المشتريات: ${viewingInvoice?.invoiceNumber || ''}`}
        subtitle={viewingInvoice ? `${viewingInvoice.supplierName} · ${viewingInvoice.date}` : ''}
        maxWidth="lg"
      >
        {viewingInvoice && (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-3 p-3 rounded-lg bg-[#F5F7F6] text-xs">
              <div>
                <div className="text-[#5A6B6E]">حالة الاعتماد</div>
                <div className="font-bold text-[#142D35] mt-0.5">
                  {viewingInvoice.workflowStatus || 'مرحّلة'}
                </div>
              </div>
              <div>
                <div className="text-[#5A6B6E]">حالة السداد</div>
                <div className="font-bold text-[#142D35] mt-0.5">{viewingInvoice.status}</div>
              </div>
              <div>
                <div className="text-[#5A6B6E]">المسجل بواسطة</div>
                <div className="font-bold text-[#142D35] mt-0.5">{viewingInvoice.createdBy}</div>
              </div>
            </div>

            <div className="overflow-x-auto border border-[#E2E7E5] rounded-lg">
              <table className="w-full text-xs text-right">
                <thead className="bg-[#F5F7F6] text-[#5A6B6E] border-b border-[#E2E7E5]">
                  <tr>
                    <th className="py-2.5 px-3">الصنف</th>
                    <th className="py-2.5 px-3">الكمية</th>
                    <th className="py-2.5 px-3">سعر الوحدة</th>
                    <th className="py-2.5 px-3">الإجمالي</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E2E7E5]">
                  {viewingInvoice.items.map((it, idx) => (
                    <tr key={idx}>
                      <td className="py-2.5 px-3 font-medium">
                        {it.itemName}
                        {(it.batchCode || it.expiryDate) && (
                          <div className="text-[10px] font-mono text-[#5A6B6E]">
                            {it.batchCode ? `تشغيلة: ${it.batchCode}` : ''}
                            {it.expiryDate ? ` · صلاحية: ${it.expiryDate}` : ''}
                          </div>
                        )}
                      </td>
                      <td className="py-2.5 px-3 font-mono">
                        {formatNumber(it.quantity, 2)} {it.unit}
                      </td>
                      <td className="py-2.5 px-3 font-mono">{formatCurrency(it.unitPrice)}</td>
                      <td className="py-2.5 px-3 font-mono font-bold">
                        {formatCurrency(it.total)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="grid grid-cols-3 gap-3 text-xs pt-2 border-t border-[#E2E7E5]">
              <div>
                <span className="text-[#5A6B6E]">إجمالي الفاتورة:</span>
                <div className="font-mono font-bold text-sm text-[#142D35]">
                  {formatCurrency(viewingInvoice.totalAmount)}
                </div>
              </div>
              <div>
                <span className="text-[#5A6B6E]">المدفوع:</span>
                <div className="font-mono font-bold text-sm text-[#176B55]">
                  {formatCurrency(viewingInvoice.paidAmount)}
                </div>
              </div>
              <div>
                <span className="text-[#5A6B6E]">المتبقي:</span>
                <div className="font-mono font-bold text-sm text-[#B91C1C]">
                  {formatCurrency(viewingInvoice.remainingBalance)}
                </div>
              </div>
            </div>

            {viewingInvoice.cancelledReason && (
              <div className="p-3 rounded-lg bg-[#FEE2E2] text-xs text-[#B91C1C]">
                سبب الإلغاء: {viewingInvoice.cancelledReason}
              </div>
            )}
          </div>
        )}
      </Modal>

      {/* Confirm Deactivate / Activate Supplier */}
      <ConfirmDialog
        isOpen={Boolean(toggleTarget)}
        onClose={() => setToggleTarget(null)}
        onConfirm={handleConfirmToggleSupplier}
        loading={toggling}
        tone={toggleTarget?.status === 'نشط' ? 'danger' : 'primary'}
        title={toggleTarget?.status === 'نشط' ? 'تأكيد إيقاف المورد' : 'تأكيد إعادة تفعيل المورد'}
        message={
          toggleTarget?.status === 'نشط'
            ? `هل أنت متأكد من إيقاف المورد "${toggleTarget?.name}"؟ لن يمكن اعتماد فواتير مشتريات جديدة له حتى إعادة التفعيل.`
            : `هل تريد إعادة تفعيل المورد "${toggleTarget?.name}" في الدليل المحاسبي؟`
        }
        confirmLabel={toggleTarget?.status === 'نشط' ? 'إيقاف المورد' : 'تفعيل المورد'}
      />

      {/* Confirm Post Draft Invoice */}
      <ConfirmDialog
        isOpen={Boolean(postTarget)}
        onClose={() => setPostTarget(null)}
        onConfirm={handleConfirmPostInvoice}
        loading={posting}
        tone="primary"
        title="اعتماد وترحيل مسودة الفاتورة"
        message={`سيتم ترحيل الفاتورة (${postTarget?.invoiceNumber}) بمبلغ ${formatCurrency(
          postTarget?.totalAmount || 0
        )} وإضافة كمياتها للمستودع وتحديث رصيد المورد ذرياً. هل تريد المتابعة؟`}
        confirmLabel="ترحيل واعتماد الآن"
      />

      {/* Confirm Cancel Invoice */}
      <ConfirmDialog
        isOpen={Boolean(cancelTarget)}
        onClose={() => setCancelTarget(null)}
        onConfirm={handleConfirmCancelInvoice}
        loading={cancelling}
        tone="danger"
        title={`إلغاء فاتورة المشتريات (${cancelTarget?.invoiceNumber || ''})`}
        message={
          cancelTarget?.workflowStatus === 'مسودة'
            ? 'سيتم تغيير حالة المسودة إلى ملغاة دون أي أثر مخزني أو مالي.'
            : 'سيتم إلغاء الفاتورة وعكس الكميات الموردة من المخزون وإلغاء مديونية الفاتورة على المورد في معاملة ذرية.'
        }
        confirmLabel="تأكيد الإلغاء"
      >
        <Input
          label="سبب الإلغاء (مطلوب للتوثيق في سجل التدقيق)"
          required
          value={cancelReason}
          onChange={(e) => setCancelReason(e.target.value)}
          placeholder="مثال: خطأ في الأسعار أو إرجاع الشحنة بالكامل"
        />
      </ConfirmDialog>
    </div>
  );
};
