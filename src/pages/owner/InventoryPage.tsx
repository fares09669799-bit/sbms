import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowDownUp,
  Search,
  AlertTriangle,
  Plus,
  Pencil,
  Layers,
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
import { InventoryItem } from '../../types/sbms';

const WAREHOUSE_IMG = '/src/assets/images/bakery_warehouse_flour_1794753872048.jpg';

const CATEGORIES = [
  'دقيق',
  'زيوت ودهون',
  'إضافات وخمائر',
  'تغليف',
  'وقود ومستهلكات',
  'مواد أخرى',
] as const;

const ALLOWED_UNITS = ['جوال', 'كجم', 'جرام', 'لتر', 'قطعة'] as const;

export const InventoryPage: React.FC = () => {
  const {
    inventory,
    batches,
    movements,
    suppliers,
    adjustInventory,
    addInventoryItem,
    updateInventoryItem,
    settings,
  } = useSbms();

  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('ALL');
  const [stockStatusFilter, setStockStatusFilter] = useState<'ALL' | 'LOW' | 'OK'>('ALL');
  const [tab, setTab] = useState<'items' | 'movements' | 'batches' | 'alerts'>('items');
  const [itemPage, setItemPage] = useState(1);
  const [movPage, setMovPage] = useState(1);
  const [movSearch, setMovSearch] = useState('');
  const [movTypeFilter, setMovTypeFilter] = useState('ALL');
  const pageSize = 10;

  const [adjustModalOpen, setAdjustModalOpen] = useState(false);
  const [newItemModalOpen, setNewItemModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<InventoryItem | null>(null);

  const [selectedItemId, setSelectedItemId] = useState(inventory[0]?.id || '');
  const [movementType, setMovementType] = useState<
    'استلام مشتريات' | 'استهلاك إنتاج' | 'تعديل جرد' | 'تحويل داخلي' | 'مرتجع لمورد' | 'مرتجع مخزني'
  >('تعديل جرد');
  const [deltaQty, setDeltaQty] = useState('5');
  const [batchCodeInput, setBatchCodeInput] = useState('');
  const [expiryDateInput, setExpiryDateInput] = useState('');
  const [returnSupplierId, setReturnSupplierId] = useState('');
  const [adjustSupplierBal, setAdjustSupplierBal] = useState(true);
  const [adjustNotes, setAdjustNotes] = useState('');
  const [adjustError, setAdjustError] = useState('');
  const [submittingAdjust, setSubmittingAdjust] = useState(false);
  const [confirmAdjustOpen, setConfirmAdjustOpen] = useState(false);

  // Add item state
  const [newSku, setNewSku] = useState('');
  const [newName, setNewName] = useState('');
  const [newCat, setNewCat] = useState('دقيق');
  const [newUnit, setNewUnit] = useState<string>('جوال');
  const [newMinStock, setNewMinStock] = useState('10');
  const [newAvgCost, setNewAvgCost] = useState('0');
  const [newSupplierId, setNewSupplierId] = useState('');
  const [newExpiry, setNewExpiry] = useState('');
  const [newItemError, setNewItemError] = useState('');
  const [submittingNewItem, setSubmittingNewItem] = useState(false);

  // Edit item state
  const [editItemError, setEditItemError] = useState('');
  const [submittingEditItem, setSubmittingEditItem] = useState(false);

  useEffect(() => {
    if (!selectedItemId && inventory.length > 0) setSelectedItemId(inventory[0].id);
  }, [inventory, selectedItemId]);

  useEffect(() => {
    if (!returnSupplierId && suppliers.length > 0) setReturnSupplierId(suppliers[0].id);
  }, [suppliers, returnSupplierId]);

  const selectedItem = useMemo(
    () => inventory.find((i) => i.id === selectedItemId),
    [inventory, selectedItemId]
  );

  const filteredItems = useMemo(() => {
    return inventory.filter((item) => {
      const q = search.trim().toLowerCase();
      const matchesSearch =
        !q ||
        item.name.toLowerCase().includes(q) ||
        item.sku.toLowerCase().includes(q) ||
        item.primarySupplierName.toLowerCase().includes(q);
      const matchesCat = categoryFilter === 'ALL' || item.category === categoryFilter;
      const isLow = item.availableQuantity <= item.minimumStock;
      const matchesStatus =
        stockStatusFilter === 'ALL' ||
        (stockStatusFilter === 'LOW' && isLow) ||
        (stockStatusFilter === 'OK' && !isLow);
      return matchesSearch && matchesCat && matchesStatus;
    });
  }, [inventory, search, categoryFilter, stockStatusFilter]);

  const itemTotalPages = Math.max(1, Math.ceil(filteredItems.length / pageSize));
  const pagedItems = useMemo(() => {
    const safe = Math.min(itemPage, itemTotalPages);
    return filteredItems.slice((safe - 1) * pageSize, safe * pageSize);
  }, [filteredItems, itemPage, itemTotalPages]);

  const filteredMovements = useMemo(() => {
    return movements.filter((m) => {
      const q = movSearch.trim().toLowerCase();
      const matchesSearch =
        !q ||
        m.itemName.toLowerCase().includes(q) ||
        m.reference.toLowerCase().includes(q) ||
        (m.notes || '').toLowerCase().includes(q);
      const matchesType = movTypeFilter === 'ALL' || m.type === movTypeFilter;
      return matchesSearch && matchesType;
    });
  }, [movements, movSearch, movTypeFilter]);

  const movTotalPages = Math.max(1, Math.ceil(filteredMovements.length / pageSize));
  const pagedMovements = useMemo(() => {
    const safe = Math.min(movPage, movTotalPages);
    return filteredMovements.slice((safe - 1) * pageSize, safe * pageSize);
  }, [filteredMovements, movPage, movTotalPages]);

  const totalValuation = inventory.reduce(
    (acc, i) => acc + i.availableQuantity * i.averageCost,
    0
  );
  const lowStockItems = useMemo(
    () => inventory.filter((i) => i.availableQuantity <= i.minimumStock),
    [inventory]
  );

  const soonDate = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() + 45);
    return d.toISOString().slice(0, 10);
  }, []);

  const todayDate = new Date().toISOString().slice(0, 10);
  const expiringBatches = useMemo(
    () => batches.filter((b) => b.expiryDate && b.expiryDate <= soonDate),
    [batches, soonDate]
  );

  const computeSignedDelta = () => {
    const qtyNum = Number(deltaQty);
    if (
      movementType === 'استهلاك إنتاج' ||
      movementType === 'تحويل داخلي' ||
      movementType === 'مرتجع لمورد'
    ) {
      return -Math.abs(qtyNum);
    }
    if (movementType === 'استلام مشتريات' || movementType === 'مرتجع مخزني') {
      return Math.abs(qtyNum);
    }
    return qtyNum;
  };

  const executeAdjust = async () => {
    const finalDelta = computeSignedDelta();
    setSubmittingAdjust(true);
    const res = await adjustInventory({
      inventoryItemId: selectedItemId,
      type: movementType,
      quantityDelta: finalDelta,
      unit: selectedItem?.unit,
      batchCode: batchCodeInput.trim() || undefined,
      expiryDate: expiryDateInput.trim() || undefined,
      supplierId: movementType === 'مرتجع لمورد' ? returnSupplierId || undefined : undefined,
      adjustSupplierBalance: movementType === 'مرتجع لمورد' ? adjustSupplierBal : undefined,
      notes: adjustNotes.trim() || undefined,
    });
    setSubmittingAdjust(false);
    setConfirmAdjustOpen(false);
    if (!res.ok) {
      setAdjustError(res.error || 'تعذر تنفيذ الحركة');
      return;
    }
    setAdjustModalOpen(false);
    setAdjustNotes('');
    setBatchCodeInput('');
    setExpiryDateInput('');
  };

  const handleAdjustSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAdjustError('');
    const qtyNum = Number(deltaQty);
    if (!qtyNum || Number.isNaN(qtyNum)) {
      setAdjustError('يرجى إدخال كمية صحيحة غير صفرية.');
      return;
    }
    const finalDelta = computeSignedDelta();
    if (finalDelta < 0) {
      setConfirmAdjustOpen(true);
      return;
    }
    await executeAdjust();
  };

  const handleAddItem = async (e: React.FormEvent) => {
    e.preventDefault();
    setNewItemError('');
    setSubmittingNewItem(true);
    const res = await addInventoryItem({
      sku: newSku.trim(),
      name: newName.trim(),
      category: newCat,
      unit: newUnit,
      minimumStock: Number(newMinStock) || 0,
      averageCost: Number(newAvgCost) || 0,
      primarySupplierId: newSupplierId || undefined,
      expiryDate: newExpiry || undefined,
    });
    setSubmittingNewItem(false);
    if (!res.ok) {
      setNewItemError(res.error || 'تعذر إضافة الصنف');
      return;
    }
    setNewSku('');
    setNewName('');
    setNewExpiry('');
    setNewItemModalOpen(false);
  };

  const handleEditItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingItem) return;
    setEditItemError('');
    setSubmittingEditItem(true);
    const res = await updateInventoryItem(editingItem.id, {
      name: editingItem.name.trim(),
      category: editingItem.category,
      minimumStock: Number(editingItem.minimumStock),
      primarySupplierId: editingItem.primarySupplierId || null,
      expiryDate: editingItem.expiryDate || null,
    });
    setSubmittingEditItem(false);
    if (!res.ok) {
      setEditItemError(res.error || 'تعذر تحديث الصنف');
      return;
    }
    setEditingItem(null);
  };

  const openMovementForItem = (item: InventoryItem) => {
    setSelectedItemId(item.id);
    setAdjustError('');
    setAdjustModalOpen(true);
  };

  return (
    <div className="space-y-6">
      {/* Warehouse Overview Header */}
      <Card padding="none" className="overflow-hidden">
        <div className="grid grid-cols-1 lg:grid-cols-12 items-stretch">
          <div className="lg:col-span-4 h-44 lg:h-auto bg-[#142D35] relative overflow-hidden">
            <img
              src={WAREHOUSE_IMG}
              alt="مستودع الدقيق والزيوت"
              referrerPolicy="no-referrer"
              className="w-full h-full object-cover"
            />
          </div>
          <div className="lg:col-span-8 p-6 flex flex-col justify-between gap-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-bold text-[#142D35]">إدارة المستودع والمخزون</h2>
                <p className="text-xs text-[#5A6B6E] mt-1">
                  مراقبة الدقيق، الزيوت، الخميرة، الملح، السكر، التغليف، التشغيلات والصلاحية، ومنع السحب السالب.
                </p>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <Button variant="outline" onClick={() => setNewItemModalOpen(true)}>
                  <Plus className="w-4 h-4" />
                  <span>إضافة صنف</span>
                </Button>
                <Button
                  onClick={() => {
                    setAdjustError('');
                    setAdjustModalOpen(true);
                  }}
                >
                  <ArrowDownUp className="w-4 h-4" />
                  <span>تسجيل حركة مخزنية</span>
                </Button>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 pt-4 border-t border-[#E2E7E5]">
              <div>
                <div className="text-xs text-[#5A6B6E]">إجمالي قيمة المخزون</div>
                <div className="text-base sm:text-lg font-bold font-mono tabular-nums text-[#142D35] mt-1">
                  {formatCurrency(totalValuation, settings.currencySymbol)}
                </div>
              </div>
              <div>
                <div className="text-xs text-[#5A6B6E]">الأصناف المسجلة</div>
                <div className="text-base sm:text-lg font-bold font-mono tabular-nums text-[#142D35] mt-1">
                  {inventory.length} أصناف
                </div>
              </div>
              <div>
                <div className="text-xs text-[#5A6B6E]">تنبيهات الحد الأدنى</div>
                <div className="text-base sm:text-lg font-bold font-mono tabular-nums text-[#B91C1C] mt-1 flex items-center gap-1.5">
                  {lowStockItems.length > 0 && <AlertTriangle className="w-4 h-4" />}
                  <span>{lowStockItems.length} أصناف</span>
                </div>
              </div>
              <div>
                <div className="text-xs text-[#5A6B6E]">دفعات قريبة الانتهاء</div>
                <div className="text-base sm:text-lg font-bold font-mono tabular-nums text-[#9A6714] mt-1 flex items-center gap-1.5">
                  <Layers className="w-4 h-4" />
                  <span>{expiringBatches.length} دفعات</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </Card>

      {/* Sub-navigation & Filters */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div className="inline-flex items-center gap-1 p-1 bg-[#E2E7E5]/50 rounded-lg self-start flex-wrap">
          <button
            type="button"
            onClick={() => setTab('items')}
            className={`px-3.5 py-1.5 text-xs font-medium rounded-md cursor-pointer ${
              tab === 'items' ? 'bg-white text-[#142D35]' : 'text-[#5A6B6E]'
            }`}
          >
            أرصدة المستودع ({inventory.length})
          </button>
          <button
            type="button"
            onClick={() => setTab('movements')}
            className={`px-3.5 py-1.5 text-xs font-medium rounded-md cursor-pointer ${
              tab === 'movements' ? 'bg-white text-[#142D35]' : 'text-[#5A6B6E]'
            }`}
          >
            سجل حركة المخزون ({movements.length})
          </button>
          <button
            type="button"
            onClick={() => setTab('batches')}
            className={`px-3.5 py-1.5 text-xs font-medium rounded-md cursor-pointer ${
              tab === 'batches' ? 'bg-white text-[#142D35]' : 'text-[#5A6B6E]'
            }`}
          >
            التشغيلات والصلاحية ({batches.length})
          </button>
          <button
            type="button"
            onClick={() => setTab('alerts')}
            className={`px-3.5 py-1.5 text-xs font-medium rounded-md cursor-pointer ${
              tab === 'alerts' ? 'bg-white text-[#142D35]' : 'text-[#5A6B6E]'
            }`}
          >
            التنبيهات ({lowStockItems.length + expiringBatches.length})
          </button>
        </div>

        {tab === 'items' && (
          <div className="flex items-center gap-2.5 flex-wrap w-full lg:w-auto">
            <div className="relative w-full sm:w-52">
              <Search className="w-4 h-4 text-[#5A6B6E] absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setItemPage(1);
                }}
                placeholder="بحث بالاسم، الكود، أو المورد..."
                className="h-9 w-full rounded-lg border border-[#E2E7E5] bg-white pr-9 pl-3 text-xs focus:outline-none focus:border-[#176B55]"
              />
            </div>
            <select
              value={categoryFilter}
              onChange={(e) => {
                setCategoryFilter(e.target.value);
                setItemPage(1);
              }}
              className="h-9 rounded-lg border border-[#E2E7E5] bg-white px-3 text-xs text-[#142D35]"
            >
              <option value="ALL">جميع التصنيفات</option>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <select
              value={stockStatusFilter}
              onChange={(e) => {
                setStockStatusFilter(e.target.value as typeof stockStatusFilter);
                setItemPage(1);
              }}
              className="h-9 rounded-lg border border-[#E2E7E5] bg-white px-3 text-xs text-[#142D35]"
            >
              <option value="ALL">جميع الأرصدة</option>
              <option value="LOW">نقص عن الحد الأدنى</option>
              <option value="OK">متوفر ضمن الحد</option>
            </select>
          </div>
        )}

        {tab === 'movements' && (
          <div className="flex items-center gap-2.5 flex-wrap w-full lg:w-auto">
            <div className="relative w-full sm:w-52">
              <Search className="w-4 h-4 text-[#5A6B6E] absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={movSearch}
                onChange={(e) => {
                  setMovSearch(e.target.value);
                  setMovPage(1);
                }}
                placeholder="بحث بالمرجع أو الصنف..."
                className="h-9 w-full rounded-lg border border-[#E2E7E5] bg-white pr-9 pl-3 text-xs focus:outline-none focus:border-[#176B55]"
              />
            </div>
            <select
              value={movTypeFilter}
              onChange={(e) => {
                setMovTypeFilter(e.target.value);
                setMovPage(1);
              }}
              className="h-9 rounded-lg border border-[#E2E7E5] bg-white px-3 text-xs text-[#142D35]"
            >
              <option value="ALL">جميع الحركات</option>
              <option value="استلام مشتريات">استلام مشتريات</option>
              <option value="استهلاك إنتاج">استهلاك إنتاج</option>
              <option value="تعديل جرد">تعديل جرد</option>
              <option value="تحويل داخلي">تحويل داخلي</option>
              <option value="مرتجع لمورد">مرتجع لمورد</option>
              <option value="مرتجع مخزني">مرتجع مخزني</option>
              <option value="إلغاء فاتورة شراء">إلغاء فاتورة شراء</option>
            </select>
          </div>
        )}
      </div>

      {/* Tab 1: Items */}
      {tab === 'items' && (
        <Card padding="none" className="overflow-hidden">
          {pagedItems.length === 0 ? (
            <div className="p-10 text-center text-sm text-[#5A6B6E]">
              لا توجد أصناف مخزنية مطابقة لمعايير البحث الحالية.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-right">
                <thead className="bg-[#F5F7F6] text-xs text-[#5A6B6E] border-b border-[#E2E7E5]">
                  <tr>
                    <th className="py-3 px-4 font-medium">الصنف / الكود</th>
                    <th className="py-3 px-4 font-medium">التصنيف</th>
                    <th className="py-3 px-4 font-medium">الكمية المتاحة</th>
                    <th className="py-3 px-4 font-medium">الحد الأدنى</th>
                    <th className="py-3 px-4 font-medium">متوسط التكلفة</th>
                    <th className="py-3 px-4 font-medium">التقييم المالي</th>
                    <th className="py-3 px-4 font-medium">التشغيلة / الصلاحية</th>
                    <th className="py-3 px-4 font-medium">الحالة</th>
                    <th className="py-3 px-4 font-medium">إجراءات</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E2E7E5]">
                  {pagedItems.map((item) => {
                    const isLow = item.availableQuantity <= item.minimumStock;
                    const valuation = item.availableQuantity * item.averageCost;
                    return (
                      <tr key={item.id} className="hover:bg-[#F5F7F6]/60">
                        <td className="py-3.5 px-4">
                          <div className="font-semibold text-[#142D35]">{item.name}</div>
                          <div className="text-[11px] text-[#5A6B6E] font-mono">
                            {item.sku}
                            {item.primarySupplierName ? ` · ${item.primarySupplierName}` : ''}
                          </div>
                        </td>
                        <td className="py-3.5 px-4 text-xs text-[#5A6B6E]">{item.category}</td>
                        <td className="py-3.5 px-4 font-mono tabular-nums font-bold text-[#142D35]">
                          {formatNumber(item.availableQuantity, 2)} {item.unit}
                        </td>
                        <td className="py-3.5 px-4 font-mono tabular-nums text-xs text-[#5A6B6E]">
                          {formatNumber(item.minimumStock)} {item.unit}
                        </td>
                        <td className="py-3.5 px-4 font-mono tabular-nums text-xs">
                          {formatCurrency(item.averageCost)}
                        </td>
                        <td className="py-3.5 px-4 font-mono tabular-nums font-medium">
                          {formatCurrency(valuation)}
                        </td>
                        <td className="py-3.5 px-4 text-xs text-[#5A6B6E] font-mono">
                          {item.batchCode}
                          {item.expiryDate ? ` · ${item.expiryDate}` : ''}
                        </td>
                        <td className="py-3.5 px-4">
                          <StatusText
                            tone={isLow ? 'danger' : 'success'}
                            label={isLow ? 'نقص عن الحد الأدنى' : 'متوفر'}
                          />
                        </td>
                        <td className="py-3.5 px-4">
                          <div className="flex items-center gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => openMovementForItem(item)}
                              title="تسجيل حركة على هذا الصنف"
                            >
                              <ArrowDownUp className="w-3.5 h-3.5 text-[#176B55]" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setEditingItem(item)}
                              title="تعديل بيانات الصنف"
                            >
                              <Pencil className="w-3.5 h-3.5" />
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

          {filteredItems.length > pageSize && (
            <div className="px-4 py-3 border-t border-[#E2E7E5] flex items-center justify-between text-xs text-[#5A6B6E]">
              <span>
                عرض {pagedItems.length} من أصل {filteredItems.length} صنف
              </span>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={itemPage <= 1}
                  onClick={() => setItemPage((p) => Math.max(1, p - 1))}
                >
                  <ChevronRight className="w-3.5 h-3.5" />
                  <span>السابق</span>
                </Button>
                <span className="font-mono">
                  {itemPage} / {itemTotalPages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={itemPage >= itemTotalPages}
                  onClick={() => setItemPage((p) => Math.min(itemTotalPages, p + 1))}
                >
                  <span>التالي</span>
                  <ChevronLeft className="w-3.5 h-3.5" />
                </Button>
              </div>
            </div>
          )}
        </Card>
      )}

      {/* Tab 2: Stock Movements */}
      {tab === 'movements' && (
        <Card padding="none" className="overflow-hidden">
          {pagedMovements.length === 0 ? (
            <div className="p-10 text-center text-sm text-[#5A6B6E]">
              لا توجد حركات مخزنية مطابقة للبحث الحالي.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-right">
                <thead className="bg-[#F5F7F6] text-xs text-[#5A6B6E] border-b border-[#E2E7E5]">
                  <tr>
                    <th className="py-3 px-4 font-medium">المرجع</th>
                    <th className="py-3 px-4 font-medium">الصنف</th>
                    <th className="py-3 px-4 font-medium">نوع الحركة</th>
                    <th className="py-3 px-4 font-medium">التغير</th>
                    <th className="py-3 px-4 font-medium">الرصيد بعد الحركة</th>
                    <th className="py-3 px-4 font-medium">التاريخ</th>
                    <th className="py-3 px-4 font-medium">المسؤول / الملاحظات</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E2E7E5]">
                  {pagedMovements.map((mov) => (
                    <tr key={mov.id} className="hover:bg-[#F5F7F6]/60">
                      <td className="py-3 px-4 font-mono text-xs">{mov.reference}</td>
                      <td className="py-3 px-4 font-medium text-[#142D35]">{mov.itemName}</td>
                      <td className="py-3 px-4 text-xs">{mov.type}</td>
                      <td
                        className={`py-3 px-4 font-mono tabular-nums font-semibold ${
                          mov.quantityDelta >= 0 ? 'text-[#176B55]' : 'text-[#B91C1C]'
                        }`}
                      >
                        {mov.quantityDelta > 0 ? '+' : ''}
                        {formatNumber(mov.quantityDelta, 2)} {mov.unit}
                      </td>
                      <td className="py-3 px-4 font-mono tabular-nums">
                        {formatNumber(mov.balanceAfter, 2)} {mov.unit}
                      </td>
                      <td className="py-3 px-4 font-mono text-xs text-[#5A6B6E]">{mov.date}</td>
                      <td className="py-3 px-4 text-xs text-[#5A6B6E]">
                        <div>{mov.performedBy}</div>
                        {mov.notes && <div className="text-[11px]">{mov.notes}</div>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {filteredMovements.length > pageSize && (
            <div className="px-4 py-3 border-t border-[#E2E7E5] flex items-center justify-between text-xs text-[#5A6B6E]">
              <span>
                عرض {pagedMovements.length} من أصل {filteredMovements.length} حركة
              </span>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={movPage <= 1}
                  onClick={() => setMovPage((p) => Math.max(1, p - 1))}
                >
                  <ChevronRight className="w-3.5 h-3.5" />
                  <span>السابق</span>
                </Button>
                <span className="font-mono">
                  {movPage} / {movTotalPages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={movPage >= movTotalPages}
                  onClick={() => setMovPage((p) => Math.min(movTotalPages, p + 1))}
                >
                  <span>التالي</span>
                  <ChevronLeft className="w-3.5 h-3.5" />
                </Button>
              </div>
            </div>
          )}
        </Card>
      )}

      {/* Tab 3: Batches & Expiry */}
      {tab === 'batches' && (
        <Card padding="none" className="overflow-hidden">
          {batches.length === 0 ? (
            <div className="p-10 text-center text-sm text-[#5A6B6E]">
              لا توجد تشغيلات نشطة برصيد متبقٍ حالياً.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-right">
                <thead className="bg-[#F5F7F6] text-xs text-[#5A6B6E] border-b border-[#E2E7E5]">
                  <tr>
                    <th className="py-3 px-4 font-medium">كود التشغيلة</th>
                    <th className="py-3 px-4 font-medium">الصنف</th>
                    <th className="py-3 px-4 font-medium">الكمية المتبقية</th>
                    <th className="py-3 px-4 font-medium">تكلفة الوحدة</th>
                    <th className="py-3 px-4 font-medium">تاريخ الاستلام</th>
                    <th className="py-3 px-4 font-medium">تاريخ الصلاحية</th>
                    <th className="py-3 px-4 font-medium">حالة الصلاحية</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E2E7E5]">
                  {batches.map((b) => {
                    const isExpired = b.expiryDate && b.expiryDate < todayDate;
                    const isSoon = b.expiryDate && !isExpired && b.expiryDate <= soonDate;
                    return (
                      <tr key={b.id} className="hover:bg-[#F5F7F6]/60">
                        <td className="py-3 px-4 font-mono text-xs font-semibold text-[#142D35]">
                          {b.batchCode}
                        </td>
                        <td className="py-3 px-4 font-medium">{b.itemName}</td>
                        <td className="py-3 px-4 font-mono tabular-nums font-bold">
                          {formatNumber(b.quantityRemaining, 2)} {b.unit}
                        </td>
                        <td className="py-3 px-4 font-mono tabular-nums text-xs">
                          {formatCurrency(b.unitCost)}
                        </td>
                        <td className="py-3 px-4 font-mono text-xs text-[#5A6B6E]">
                          {b.receivedDate}
                        </td>
                        <td className="py-3 px-4 font-mono text-xs text-[#5A6B6E]">
                          {b.expiryDate || 'غير محدد'}
                        </td>
                        <td className="py-3 px-4">
                          <StatusText
                            tone={isExpired ? 'danger' : isSoon ? 'warning' : 'success'}
                            label={
                              isExpired
                                ? 'منتهية الصلاحية'
                                : isSoon
                                ? 'تقترب من الانتهاء'
                                : 'سارية'
                            }
                          />
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

      {/* Tab 4: Low Stock & Expiry Alerts */}
      {tab === 'alerts' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card>
            <h3 className="text-sm font-bold text-[#142D35] mb-3 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-[#B91C1C]" />
              <span>أصناف وصلت أو قلت عن الحد الأدنى ({lowStockItems.length})</span>
            </h3>
            {lowStockItems.length === 0 ? (
              <p className="text-xs text-[#5A6B6E]">جميع الأصناف فوق الحد الأدنى المعتمد.</p>
            ) : (
              <div className="divide-y divide-[#E2E7E5]">
                {lowStockItems.map((item) => (
                  <div key={item.id} className="py-3 flex items-center justify-between gap-3">
                    <div>
                      <div className="text-xs font-bold text-[#142D35]">{item.name}</div>
                      <div className="text-[11px] text-[#5A6B6E]">
                        المتاح: {formatNumber(item.availableQuantity, 2)} {item.unit} · الحد الأدنى:{' '}
                        {formatNumber(item.minimumStock)} {item.unit}
                      </div>
                    </div>
                    <Button variant="outline" size="sm" onClick={() => openMovementForItem(item)}>
                      توريد / تسوية
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card>
            <h3 className="text-sm font-bold text-[#142D35] mb-3 flex items-center gap-2">
              <Layers className="w-4 h-4 text-[#9A6714]" />
              <span>دفعات قريبة الانتهاء أو منتهية ({expiringBatches.length})</span>
            </h3>
            {expiringBatches.length === 0 ? (
              <p className="text-xs text-[#5A6B6E]">لا توجد دفعات قريبة الانتهاء خلال 45 يوماً.</p>
            ) : (
              <div className="divide-y divide-[#E2E7E5]">
                {expiringBatches.map((b) => (
                  <div key={b.id} className="py-3 flex items-center justify-between gap-3 text-xs">
                    <div>
                      <div className="font-bold text-[#142D35]">
                        {b.itemName} ({b.batchCode})
                      </div>
                      <div className="text-[#5A6B6E] font-mono">
                        الكمية: {formatNumber(b.quantityRemaining, 2)} {b.unit} · الصلاحية:{' '}
                        {b.expiryDate}
                      </div>
                    </div>
                    <StatusText
                      tone={b.expiryDate && b.expiryDate < todayDate ? 'danger' : 'warning'}
                      label={b.expiryDate && b.expiryDate < todayDate ? 'منتهية' : 'قريبة الانتهاء'}
                    />
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      )}

      {/* Adjust Stock Modal */}
      <Modal
        isOpen={adjustModalOpen}
        onClose={() => setAdjustModalOpen(false)}
        title="تسجيل حركة مخزنية"
        subtitle="التحقق من وحدة القياس، تتبع التشغيلات، ومنع الرصيد السالب تلقائياً"
      >
        <form onSubmit={handleAdjustSubmit} className="space-y-4">
          <Select
            label="الصنف"
            value={selectedItemId}
            onChange={(e) => setSelectedItemId(e.target.value)}
          >
            {inventory.map((i) => (
              <option key={i.id} value={i.id}>
                {i.name} (المتاح: {i.availableQuantity} {i.unit})
              </option>
            ))}
          </Select>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Select
              label="نوع الحركة"
              value={movementType}
              onChange={(e) => setMovementType(e.target.value as typeof movementType)}
            >
              <option value="تعديل جرد">تعديل جرد (+ إضافة أو - خصم)</option>
              <option value="استلام مشتريات">استلام توريد للمخزن (+)</option>
              <option value="استهلاك إنتاج">صرف / استهلاك للتشغيل (-)</option>
              <option value="مرتجع لمورد">مرتجع مخزني لمورد (-)</option>
              <option value="مرتجع مخزني">مرتجع للمستودع (+)</option>
              <option value="تحويل داخلي">تحويل داخلي (-)</option>
            </Select>
            <Input
              label={`الكمية (${selectedItem?.unit || ''})`}
              type="number"
              step="any"
              required
              value={deltaQty}
              onChange={(e) => setDeltaQty(e.target.value)}
            />
          </div>

          {(movementType === 'استلام مشتريات' || movementType === 'مرتجع مخزني' || (movementType === 'تعديل جرد' && Number(deltaQty) > 0)) && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Input
                label="كود التشغيلة (اختياري)"
                value={batchCodeInput}
                onChange={(e) => setBatchCodeInput(e.target.value)}
                placeholder="مثال: BCH-2611-X"
              />
              <Input
                label="تاريخ الصلاحية (اختياري)"
                type="date"
                value={expiryDateInput}
                onChange={(e) => setExpiryDateInput(e.target.value)}
              />
            </div>
          )}

          {movementType === 'مرتجع لمورد' && (
            <div className="p-3 rounded-lg bg-[#F5F7F6] border border-[#E2E7E5] space-y-3">
              <Select
                label="المورد المستلم للمرتجع"
                value={returnSupplierId}
                onChange={(e) => setReturnSupplierId(e.target.value)}
              >
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s.code})
                  </option>
                ))}
              </Select>
              <label className="flex items-center gap-2 text-xs text-[#142D35] cursor-pointer">
                <input
                  type="checkbox"
                  checked={adjustSupplierBal}
                  onChange={(e) => setAdjustSupplierBal(e.target.checked)}
                  className="accent-[#176B55]"
                />
                <span>خصم قيمة المرتجع (بمتوسط التكلفة) من رصيد المورد المستحق تلقائياً</span>
              </label>
            </div>
          )}

          <Input
            label="ملاحظات وسبب الحركة"
            value={adjustNotes}
            onChange={(e) => setAdjustNotes(e.target.value)}
            placeholder="مثال: تسوية الجرد الأسبوعي للمستودع"
          />

          {selectedItem && (
            <div className="p-2.5 rounded-lg bg-[#F5F7F6] text-xs flex items-center justify-between">
              <span className="text-[#5A6B6E]">الرصيد المتوقع بعد الحركة:</span>
              <span className="font-mono font-bold text-[#142D35]">
                {formatNumber(
                  selectedItem.availableQuantity + (Number.isNaN(Number(deltaQty)) ? 0 : computeSignedDelta()),
                  2
                )}{' '}
                {selectedItem.unit}
              </span>
            </div>
          )}

          {adjustError && <div className="text-xs text-[#B91C1C] font-medium">{adjustError}</div>}

          <div className="flex items-center justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => setAdjustModalOpen(false)}>
              إلغاء
            </Button>
            <Button type="submit" disabled={submittingAdjust}>
              {submittingAdjust ? 'جاري التنفيذ...' : 'تنفيذ الحركة'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Confirm Deduction / Return Movement */}
      <ConfirmDialog
        isOpen={confirmAdjustOpen}
        onClose={() => setConfirmAdjustOpen(false)}
        onConfirm={executeAdjust}
        loading={submittingAdjust}
        tone="warning"
        title="تأكيد خصم كمية من المخزون"
        message={`سيتم خصم ${Math.abs(computeSignedDelta())} ${selectedItem?.unit || ''} من الصنف (${
          selectedItem?.name || ''
        }) بنوع حركة "${movementType}". هل تريد اعتماد الحركة؟`}
        confirmLabel="تأكيد الخصم"
      />

      {/* Add Inventory Item Modal */}
      <Modal
        isOpen={newItemModalOpen}
        onClose={() => setNewItemModalOpen(false)}
        title="إضافة صنف مخزني جديد"
        subtitle="تعريف مادة خام أو مستلزم تغليف في المستودع"
      >
        <form onSubmit={handleAddItem} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input
              label="كود الصنف (SKU)"
              required
              value={newSku}
              onChange={(e) => setNewSku(e.target.value)}
              placeholder="مثال: RM-SES-07"
            />
            <Input
              label="اسم الصنف"
              required
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="مثال: سمسم أبيض محمص"
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Select label="التصنيف" value={newCat} onChange={(e) => setNewCat(e.target.value)}>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
            <Select label="وحدة القياس" value={newUnit} onChange={(e) => setNewUnit(e.target.value)}>
              {ALLOWED_UNITS.map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </Select>
            <Input
              label="الحد الأدنى للتنبيه"
              type="number"
              min="0"
              step="any"
              value={newMinStock}
              onChange={(e) => setNewMinStock(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Input
              label="التكلفة المبدئية للوحدة"
              type="number"
              min="0"
              step="any"
              value={newAvgCost}
              onChange={(e) => setNewAvgCost(e.target.value)}
            />
            <Select
              label="المورد الأساسي (اختياري)"
              value={newSupplierId}
              onChange={(e) => setNewSupplierId(e.target.value)}
            >
              <option value="">غير محدد</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
            <Input
              label="تاريخ الصلاحية (اختياري)"
              type="date"
              value={newExpiry}
              onChange={(e) => setNewExpiry(e.target.value)}
            />
          </div>
          {newItemError && <div className="text-xs text-[#B91C1C] font-medium">{newItemError}</div>}
          <div className="flex items-center justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => setNewItemModalOpen(false)}>
              إلغاء
            </Button>
            <Button type="submit" disabled={submittingNewItem}>
              {submittingNewItem ? 'جاري الحفظ...' : 'إضافة الصنف'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Edit Inventory Item Modal */}
      <Modal
        isOpen={Boolean(editingItem)}
        onClose={() => setEditingItem(null)}
        title={`تعديل بيانات الصنف: ${editingItem?.name || ''}`}
        subtitle="الرصيد المتاح يتغير فقط عبر حركات المخزون أو فواتير المشتريات"
      >
        {editingItem && (
          <form onSubmit={handleEditItem} className="space-y-4">
            <Input
              label="اسم الصنف"
              required
              value={editingItem.name}
              onChange={(e) => setEditingItem({ ...editingItem, name: e.target.value })}
            />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Select
                label="التصنيف"
                value={editingItem.category}
                onChange={(e) =>
                  setEditingItem({
                    ...editingItem,
                    category: e.target.value as InventoryItem['category'],
                  })
                }
              >
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </Select>
              <Input
                label={`الحد الأدنى للتنبيه (${editingItem.unit})`}
                type="number"
                min="0"
                step="any"
                value={editingItem.minimumStock}
                onChange={(e) =>
                  setEditingItem({ ...editingItem, minimumStock: Number(e.target.value) || 0 })
                }
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Select
                label="المورد الأساسي"
                value={editingItem.primarySupplierId}
                onChange={(e) =>
                  setEditingItem({ ...editingItem, primarySupplierId: e.target.value })
                }
              >
                <option value="">غير محدد</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
              <Input
                label="تاريخ الصلاحية"
                type="date"
                value={editingItem.expiryDate || ''}
                onChange={(e) =>
                  setEditingItem({ ...editingItem, expiryDate: e.target.value || undefined })
                }
              />
            </div>
            {editItemError && (
              <div className="text-xs text-[#B91C1C] font-medium">{editItemError}</div>
            )}
            <div className="flex items-center justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => setEditingItem(null)}>
                إلغاء
              </Button>
              <Button type="submit" disabled={submittingEditItem}>
                {submittingEditItem ? 'جاري التحديث...' : 'حفظ التعديلات'}
              </Button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
};
