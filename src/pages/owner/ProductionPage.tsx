import React, { useEffect, useMemo, useState } from 'react';
import { Flame, Settings2, Plus, Trash2, Power } from 'lucide-react';
import { useSbms } from '../../context/SbmsContext';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Input, Select } from '../../components/ui/FormControls';
import { Modal } from '../../components/ui/Modal';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { StatusText } from '../../components/ui/StatusText';
import { formatCurrency, formatNumber } from '../../lib/utils';
import { ProductionRecipe, RecipeOtherIngredient } from '../../types/sbms';

export const ProductionPage: React.FC = () => {
  const {
    recipes,
    rawMaterials,
    createRecipe,
    updateRecipe,
    toggleRecipeStatus,
    productionRecords,
    registerProduction,
    settings,
  } = useSbms();

  const [tab, setTab] = useState<'records' | 'recipes'>('records');
  const [searchQuery, setSearchQuery] = useState('');
  const [shiftFilter, setShiftFilter] = useState<'ALL' | string>('ALL');

  // Register production modal state
  const [prodModalOpen, setProdModalOpen] = useState(false);
  const activeRecipes = useMemo(
    () => recipes.filter((r) => r.isActive !== false),
    [recipes]
  );

  const [prodDate, setProdDate] = useState(new Date().toISOString().slice(0, 10));
  const [recipeId, setRecipeId] = useState('');
  const [shiftName, setShiftName] = useState('الوردية الصباحية');
  const [flourBags, setFlourBags] = useState('4');
  const [oilLiters, setOilLiters] = useState('6');
  const [yeastGrams, setYeastGrams] = useState('1000');
  const [saltGrams, setSaltGrams] = useState('2000');
  const [sugarGrams, setSugarGrams] = useState('800');
  const [batchExtras, setBatchExtras] = useState<{ inventoryItemId: number; quantity: number }[]>([]);
  const [producedLoaves, setProducedLoaves] = useState('2600');
  const [damagedLoaves, setDamagedLoaves] = useState('20');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');
  const [submittingBatch, setSubmittingBatch] = useState(false);

  // Create recipe modal state
  const [createRecipeOpen, setCreateRecipeOpen] = useState(false);
  const [newBreadType, setNewBreadType] = useState('');
  const [newYield, setNewYield] = useState('1300');
  const [newPrice, setNewPrice] = useState(String(settings.standardLoafPrice || 250));
  const [newFlour, setNewFlour] = useState('2');
  const [newOil, setNewOil] = useState('3');
  const [newYeast, setNewYeast] = useState('500');
  const [newSalt, setNewSalt] = useState('1000');
  const [newSugar, setNewSugar] = useState('400');
  const [newNotes, setNewNotes] = useState('');
  const [newExtras, setNewExtras] = useState<RecipeOtherIngredient[]>([]);
  const [createRecipeError, setCreateRecipeError] = useState('');
  const [creatingRecipe, setCreatingRecipe] = useState(false);

  // Edit / Toggle recipe modal state
  const [editingRecipe, setEditingRecipe] = useState<ProductionRecipe | null>(null);
  const [recipeError, setRecipeError] = useState('');
  const [submittingRecipe, setSubmittingRecipe] = useState(false);
  const [toggleTarget, setToggleTarget] = useState<ProductionRecipe | null>(null);
  const [togglingRecipe, setTogglingRecipe] = useState(false);

  useEffect(() => {
    if (!recipeId && activeRecipes.length > 0) {
      const first = activeRecipes[0];
      setRecipeId(first.id);
      setFlourBags(String(first.flourBags * 2));
      setOilLiters(String(first.oilLiters * 2));
      setYeastGrams(String(first.yeastGrams * 2));
      setSaltGrams(String(first.saltGrams * 2));
      setSugarGrams(String(first.sugarGrams * 2));
      setProducedLoaves(String(first.expectedYieldLoaves * 2));
      setBatchExtras(
        (first.otherIngredients || []).map((o) => ({
          inventoryItemId: o.inventoryItemId,
          quantity: Number((o.quantity * 2).toFixed(3)),
        }))
      );
    }
  }, [activeRecipes, recipeId]);

  const handleSelectRecipeForBatch = (id: string) => {
    setRecipeId(id);
    const rec = activeRecipes.find((r) => r.id === id);
    if (rec) {
      const batches = 2;
      setFlourBags(String(rec.flourBags * batches));
      setOilLiters(String(rec.oilLiters * batches));
      setYeastGrams(String(rec.yeastGrams * batches));
      setSaltGrams(String(rec.saltGrams * batches));
      setSugarGrams(String(rec.sugarGrams * batches));
      setProducedLoaves(String(rec.expectedYieldLoaves * batches));
      setBatchExtras(
        (rec.otherIngredients || []).map((o) => ({
          inventoryItemId: o.inventoryItemId,
          quantity: Number((o.quantity * batches).toFixed(3)),
        }))
      );
    }
  };

  const handleSubmitBatch = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSubmittingBatch(true);
    const res = await registerProduction({
      date: prodDate,
      recipeId,
      shiftName,
      flourBags: Number(flourBags),
      oilLiters: Number(oilLiters),
      yeastGrams: Number(yeastGrams),
      saltGrams: Number(saltGrams),
      sugarGrams: Number(sugarGrams),
      otherIngredients: batchExtras.filter((ex) => ex.inventoryItemId > 0 && ex.quantity > 0),
      producedLoaves: Number(producedLoaves),
      damagedLoaves: Number(damagedLoaves),
      notes,
    });
    setSubmittingBatch(false);
    if (!res.ok) {
      setError(res.error || 'تعذر تسجيل الإنتاج');
      return;
    }
    setProdModalOpen(false);
    setNotes('');
  };

  const handleCreateRecipe = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateRecipeError('');
    if (!newBreadType.trim()) {
      setCreateRecipeError('يرجى إدخال اسم نوع الخبز.');
      return;
    }
    setCreatingRecipe(true);
    const res = await createRecipe({
      breadType: newBreadType.trim(),
      expectedYieldLoaves: Number(newYield),
      unitSellingPrice: Number(newPrice),
      flourBags: Number(newFlour),
      oilLiters: Number(newOil),
      yeastGrams: Number(newYeast),
      saltGrams: Number(newSalt),
      sugarGrams: Number(newSugar),
      otherIngredients: newExtras.filter((ex) => ex.inventoryItemId > 0 && ex.quantity > 0),
      notes: newNotes.trim() || undefined,
    });
    setCreatingRecipe(false);
    if (!res.ok) {
      setCreateRecipeError(res.error || 'تعذر إنشاء الوصفة');
      return;
    }
    setNewBreadType('');
    setNewExtras([]);
    setNewNotes('');
    setCreateRecipeOpen(false);
  };

  const handleSaveRecipe = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingRecipe) return;
    setRecipeError('');
    setSubmittingRecipe(true);
    const res = await updateRecipe({
      ...editingRecipe,
      otherIngredients: (editingRecipe.otherIngredients || []).filter(
        (ex) => ex.inventoryItemId > 0 && ex.quantity > 0
      ),
    });
    setSubmittingRecipe(false);
    if (!res.ok) {
      setRecipeError(res.error || 'تعذر تحديث الوصفة');
      return;
    }
    setEditingRecipe(null);
  };

  const handleConfirmToggle = async () => {
    if (!toggleTarget) return;
    setTogglingRecipe(true);
    await toggleRecipeStatus(toggleTarget.id);
    setTogglingRecipe(false);
    setToggleTarget(null);
  };

  const filteredRecords = useMemo(() => {
    return productionRecords.filter((rec) => {
      const matchesShift = shiftFilter === 'ALL' || rec.shiftName === shiftFilter;
      const q = searchQuery.trim().toLowerCase();
      const matchesQ =
        !q ||
        rec.reference.toLowerCase().includes(q) ||
        rec.breadType.toLowerCase().includes(q) ||
        rec.agentName.toLowerCase().includes(q) ||
        rec.date.includes(q);
      return matchesShift && matchesQ;
    });
  }, [productionRecords, shiftFilter, searchQuery]);

  const totalLoaves = productionRecords.reduce((a, r) => a + r.producedLoaves, 0);
  const totalFlour = productionRecords.reduce((a, r) => a + r.flourConsumedBags, 0);
  const totalDamaged = productionRecords.reduce((a, r) => a + r.damagedLoaves, 0);

  const addExtraRowToNew = () => {
    if (rawMaterials.length === 0) return;
    const first = rawMaterials[0];
    setNewExtras([
      ...newExtras,
      { inventoryItemId: Number(first.id), name: first.name, quantity: 1, unit: first.unit },
    ]);
  };

  const addExtraRowToEdit = () => {
    if (!editingRecipe || rawMaterials.length === 0) return;
    const first = rawMaterials[0];
    setEditingRecipe({
      ...editingRecipe,
      otherIngredients: [
        ...(editingRecipe.otherIngredients || []),
        { inventoryItemId: Number(first.id), name: first.name, quantity: 1, unit: first.unit },
      ],
    });
  };

  const addExtraRowToBatch = () => {
    if (rawMaterials.length === 0) return;
    setBatchExtras([
      ...batchExtras,
      { inventoryItemId: Number(rawMaterials[0].id), quantity: 1 },
    ]);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-[#142D35]">مراقبة الإنتاج والوصفات المعيارية</h2>
          <p className="text-xs text-[#5A6B6E] mt-1">
            ضبط المقادير لكل عجنة ودعم أنواع الخبز المتعددة والخصم التلقائي من المستودع.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => setCreateRecipeOpen(true)}>
            <Plus className="w-4 h-4" />
            <span>إضافة وصفة خبز</span>
          </Button>
          <Button onClick={() => setProdModalOpen(true)} disabled={activeRecipes.length === 0}>
            <Plus className="w-4 h-4" />
            <span>تسجيل دفعة إنتاج</span>
          </Button>
        </div>
      </div>

      {/* Summary KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <div className="text-xs text-[#5A6B6E]">إجمالي الخبز المنتج (السجل النشط)</div>
          <div className="text-xl font-bold text-[#142D35] font-mono tabular-nums mt-1.5">
            {formatNumber(totalLoaves)} رغيف
          </div>
        </Card>
        <Card>
          <div className="text-xs text-[#5A6B6E]">إجمالي الدقيق المستهلك</div>
          <div className="text-xl font-bold text-[#176B55] font-mono tabular-nums mt-1.5">
            {formatNumber(totalFlour, 1)} جوال (50 كجم)
          </div>
        </Card>
        <Card>
          <div className="text-xs text-[#5A6B6E]">الخبز التالف / المرفوض</div>
          <div className="text-xl font-bold text-[#B91C1C] font-mono tabular-nums mt-1.5">
            {formatNumber(totalDamaged)} رغيف
          </div>
        </Card>
      </div>

      {/* Tabs + Search */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="inline-flex items-center gap-1 p-1 bg-[#E2E7E5]/50 rounded-lg self-start">
          <button
            type="button"
            onClick={() => setTab('records')}
            className={`px-3.5 py-1.5 text-xs font-medium rounded-md cursor-pointer ${
              tab === 'records' ? 'bg-white text-[#142D35]' : 'text-[#5A6B6E]'
            }`}
          >
            سجل دفعات الإنتاج ({productionRecords.length})
          </button>
          <button
            type="button"
            onClick={() => setTab('recipes')}
            className={`px-3.5 py-1.5 text-xs font-medium rounded-md cursor-pointer ${
              tab === 'recipes' ? 'bg-white text-[#142D35]' : 'text-[#5A6B6E]'
            }`}
          >
            وصفات الإنتاج المعتمدة ({recipes.length})
          </button>
        </div>

        {tab === 'records' && (
          <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="بحث بالمرجع أو الوكيل أو الصنف..."
              className="w-full sm:w-56"
            />
            <Select
              value={shiftFilter}
              onChange={(e) => setShiftFilter(e.target.value)}
              className="w-full sm:w-40"
            >
              <option value="ALL">جميع الورديات</option>
              <option value="الوردية الصباحية">الوردية الصباحية</option>
              <option value="الوردية المسائية">الوردية المسائية</option>
              <option value="الوردية الليلية">الوردية الليلية</option>
            </Select>
          </div>
        )}
      </div>

      {tab === 'records' ? (
        <Card padding="none" className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-right">
              <thead className="bg-[#F5F7F6] text-xs text-[#5A6B6E] border-b border-[#E2E7E5]">
                <tr>
                  <th className="py-3 px-4 font-medium">المرجع / التاريخ</th>
                  <th className="py-3 px-4 font-medium">الوردية والوكيل</th>
                  <th className="py-3 px-4 font-medium">نوع الخبز</th>
                  <th className="py-3 px-4 font-medium">المواد المستهلكة</th>
                  <th className="py-3 px-4 font-medium">الإنتاج الفعلي</th>
                  <th className="py-3 px-4 font-medium">التالف</th>
                  <th className="py-3 px-4 font-medium">ملاحظات</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E2E7E5]">
                {filteredRecords.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-8 text-center text-xs text-[#5A6B6E]">
                      لا توجد سجلات إنتاج مطابقة لمعايير البحث.
                    </td>
                  </tr>
                ) : (
                  filteredRecords.map((rec) => (
                    <tr key={rec.id} className="hover:bg-[#F5F7F6]/60">
                      <td className="py-3.5 px-4">
                        <div className="font-mono text-xs font-semibold">{rec.reference}</div>
                        <div className="font-mono text-[11px] text-[#5A6B6E]">{rec.date}</div>
                      </td>
                      <td className="py-3.5 px-4 text-xs">
                        <div className="font-medium text-[#142D35]">{rec.agentName}</div>
                        <div className="text-[#5A6B6E]">{rec.shiftName}</div>
                      </td>
                      <td className="py-3.5 px-4 font-medium text-[#142D35]">{rec.breadType}</td>
                      <td className="py-3.5 px-4 text-xs text-[#5A6B6E] font-mono tabular-nums">
                        <div>
                          دقيق: {rec.flourConsumedBags} جوال · زيت: {rec.oilConsumedLiters} لتر · خميرة:{' '}
                          {rec.yeastConsumedGrams} جم
                        </div>
                        <div className="text-[11px] mt-0.5">
                          ملح: {rec.saltConsumedGrams} جم · سكر: {rec.sugarConsumedGrams} جم
                          {rec.otherIngredientsSummary ? ` · ${rec.otherIngredientsSummary}` : ''}
                        </div>
                      </td>
                      <td className="py-3.5 px-4 font-mono tabular-nums font-bold text-[#176B55]">
                        {formatNumber(rec.producedLoaves)} رغيف
                      </td>
                      <td className="py-3.5 px-4 font-mono tabular-nums text-[#B91C1C]">
                        {formatNumber(rec.damagedLoaves)}
                      </td>
                      <td className="py-3.5 px-4 text-xs text-[#5A6B6E] max-w-[200px] truncate">
                        {rec.notes || '—'}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {recipes.map((recipe) => {
            const isActive = recipe.isActive !== false;
            return (
              <Card key={recipe.id} className="flex flex-col justify-between gap-4">
                <div>
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-2">
                        <Flame className="w-4 h-4 text-[#D8AD65]" />
                        <h3 className="text-base font-bold text-[#142D35]">{recipe.breadType}</h3>
                      </div>
                      <div className="mt-1">
                        <StatusText
                          tone={isActive ? 'success' : 'neutral'}
                          label={isActive ? 'نشطة ومفعلة' : 'موقوفة'}
                        />
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setEditingRecipe(recipe)}
                        className="text-xs text-[#176B55] hover:underline flex items-center gap-1 cursor-pointer"
                      >
                        <Settings2 className="w-3.5 h-3.5" />
                        <span>تعديل</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setToggleTarget(recipe)}
                        className={`text-xs hover:underline flex items-center gap-1 cursor-pointer ${
                          isActive ? 'text-[#B91C1C]' : 'text-[#176B55]'
                        }`}
                      >
                        <Power className="w-3.5 h-3.5" />
                        <span>{isActive ? 'إيقاف' : 'تفعيل'}</span>
                      </button>
                    </div>
                  </div>

                  <div className="mt-3 text-xs text-[#5A6B6E] flex items-center justify-between py-2 border-b border-[#E2E7E5]">
                    <span>الإنتاجية القياسية لكل عجنة</span>
                    <span className="font-mono tabular-nums font-bold text-[#142D35]">
                      {formatNumber(recipe.expectedYieldLoaves)} رغيف
                    </span>
                  </div>
                  <div className="text-xs text-[#5A6B6E] flex items-center justify-between py-2 border-b border-[#E2E7E5]">
                    <span>سعر البيع الافتراضي</span>
                    <span className="font-mono tabular-nums font-bold text-[#176B55]">
                      {formatCurrency(recipe.unitSellingPrice, settings.currencySymbol)}
                    </span>
                  </div>
                </div>

                <div className="space-y-1.5 text-xs text-[#142D35]">
                  <div className="flex justify-between">
                    <span className="text-[#5A6B6E]">دقيق قمح</span>
                    <span className="font-mono tabular-nums">{recipe.flourBags} جوال</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#5A6B6E]">زيت طعام</span>
                    <span className="font-mono tabular-nums">{recipe.oilLiters} لتر</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#5A6B6E]">خميرة فورية</span>
                    <span className="font-mono tabular-nums">{recipe.yeastGrams} جرام</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#5A6B6E]">ملح / سكر</span>
                    <span className="font-mono tabular-nums">
                      {recipe.saltGrams} جم / {recipe.sugarGrams} جم
                    </span>
                  </div>
                  {recipe.otherIngredients && recipe.otherIngredients.length > 0 && (
                    <div className="pt-1 border-t border-[#E2E7E5]/70 space-y-1">
                      <div className="text-[11px] text-[#5A6B6E]">مكونات إضافية:</div>
                      {recipe.otherIngredients.map((extra, idx) => (
                        <div key={idx} className="flex justify-between text-[11px]">
                          <span>{extra.name}</span>
                          <span className="font-mono tabular-nums">
                            {extra.quantity} {extra.unit}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                  {recipe.notes && (
                    <div className="text-[11px] text-[#5A6B6E] pt-1">{recipe.notes}</div>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* Register Production Modal */}
      <Modal
        isOpen={prodModalOpen}
        onClose={() => setProdModalOpen(false)}
        title="تسجيل دفعة إنتاج جديدة"
        subtitle="يتم خصم المواد المستهلكة مباشرة من أرصدة المستودع والدفعات وفق نظام FEFO"
      >
        <form onSubmit={handleSubmitBatch} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Input
              label="تاريخ الإنتاج"
              type="date"
              required
              value={prodDate}
              onChange={(e) => setProdDate(e.target.value)}
            />
            <Select
              label="وصفة / نوع الخبز"
              value={recipeId}
              onChange={(e) => handleSelectRecipeForBatch(e.target.value)}
            >
              {activeRecipes.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.breadType}
                </option>
              ))}
            </Select>
            <Select
              label="الوردية"
              value={shiftName}
              onChange={(e) => setShiftName(e.target.value)}
            >
              <option value="الوردية الصباحية">الوردية الصباحية</option>
              <option value="الوردية المسائية">الوردية المسائية</option>
              <option value="الوردية الليلية">الوردية الليلية</option>
            </Select>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <Input
              label="الدقيق (جوال)"
              type="number"
              step="any"
              required
              value={flourBags}
              onChange={(e) => setFlourBags(e.target.value)}
            />
            <Input
              label="الزيت (لتر)"
              type="number"
              step="any"
              required
              value={oilLiters}
              onChange={(e) => setOilLiters(e.target.value)}
            />
            <Input
              label="الخميرة (جم)"
              type="number"
              step="any"
              required
              value={yeastGrams}
              onChange={(e) => setYeastGrams(e.target.value)}
            />
            <Input
              label="الملح (جم)"
              type="number"
              step="any"
              value={saltGrams}
              onChange={(e) => setSaltGrams(e.target.value)}
            />
            <Input
              label="السكر (جم)"
              type="number"
              step="any"
              value={sugarGrams}
              onChange={(e) => setSugarGrams(e.target.value)}
            />
          </div>

          {/* Other ingredients */}
          <div className="space-y-2 border-t border-[#E2E7E5] pt-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-[#142D35]">مكونات أخرى إضافية من المستودع</span>
              <Button type="button" variant="outline" size="sm" onClick={addExtraRowToBatch}>
                <Plus className="w-3.5 h-3.5" />
                <span>إضافة مكون</span>
              </Button>
            </div>
            {batchExtras.map((extra, idx) => (
              <div key={idx} className="grid grid-cols-12 gap-2 items-end">
                <div className="col-span-7">
                  <Select
                    value={String(extra.inventoryItemId)}
                    onChange={(e) => {
                      const next = [...batchExtras];
                      next[idx] = { ...next[idx], inventoryItemId: Number(e.target.value) };
                      setBatchExtras(next);
                    }}
                  >
                    {rawMaterials.map((rm) => (
                      <option key={rm.id} value={rm.id}>
                        {rm.name} ({rm.availableQuantity} {rm.unit})
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
                      const next = [...batchExtras];
                      next[idx] = { ...next[idx], quantity: Number(e.target.value) };
                      setBatchExtras(next);
                    }}
                  />
                </div>
                <div className="col-span-1 flex justify-end">
                  <button
                    type="button"
                    onClick={() => setBatchExtras(batchExtras.filter((_, i) => i !== idx))}
                    className="p-2 text-[#B91C1C] hover:bg-[#FEF2F2] rounded-lg cursor-pointer"
                    aria-label="حذف"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input
              label="إجمالي الخبز المنتج (رغيف)"
              type="number"
              min="1"
              required
              value={producedLoaves}
              onChange={(e) => setProducedLoaves(e.target.value)}
            />
            <Input
              label="الخبز التالف (رغيف)"
              type="number"
              min="0"
              required
              value={damagedLoaves}
              onChange={(e) => setDamagedLoaves(e.target.value)}
            />
          </div>

          <Input
            label="ملاحظات التشغيل"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="ملاحظات جودة التخمير أو الفرن"
          />

          {error && <div className="text-xs text-[#B91C1C] font-medium">{error}</div>}

          <div className="flex items-center justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => setProdModalOpen(false)}>
              إلغاء
            </Button>
            <Button type="submit" disabled={submittingBatch}>
              {submittingBatch ? 'جاري الحفظ...' : 'حفظ الإنتاج وخصم المخزون'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Create New Recipe Modal */}
      <Modal
        isOpen={createRecipeOpen}
        onClose={() => setCreateRecipeOpen(false)}
        title="إنشاء وصفة إنتاج جديدة"
        subtitle="تحديد نوع الخبز والمقادير القياسية لكل عجنة والإنتاجية المتوقعة"
      >
        <form onSubmit={handleCreateRecipe} className="space-y-4">
          <Input
            label="اسم نوع الخبز"
            required
            value={newBreadType}
            onChange={(e) => setNewBreadType(e.target.value)}
            placeholder="مثال: خبز شامي أبيض"
          />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input
              label="الإنتاج المتوقع (رغيف)"
              type="number"
              min="1"
              required
              value={newYield}
              onChange={(e) => setNewYield(e.target.value)}
            />
            <Input
              label="سعر البيع الافتراضي (ج.س)"
              type="number"
              min="1"
              required
              value={newPrice}
              onChange={(e) => setNewPrice(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <Input
              label="دقيق (جوال)"
              type="number"
              step="any"
              min="0"
              required
              value={newFlour}
              onChange={(e) => setNewFlour(e.target.value)}
            />
            <Input
              label="زيت (لتر)"
              type="number"
              step="any"
              min="0"
              required
              value={newOil}
              onChange={(e) => setNewOil(e.target.value)}
            />
            <Input
              label="خميرة (جم)"
              type="number"
              step="any"
              min="0"
              required
              value={newYeast}
              onChange={(e) => setNewYeast(e.target.value)}
            />
            <Input
              label="ملح (جم)"
              type="number"
              step="any"
              min="0"
              value={newSalt}
              onChange={(e) => setNewSalt(e.target.value)}
            />
            <Input
              label="سكر (جم)"
              type="number"
              step="any"
              min="0"
              value={newSugar}
              onChange={(e) => setNewSugar(e.target.value)}
            />
          </div>

          <div className="space-y-2 border-t border-[#E2E7E5] pt-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-[#142D35]">مكونات إضافية اختيارية</span>
              <Button type="button" variant="outline" size="sm" onClick={addExtraRowToNew}>
                <Plus className="w-3.5 h-3.5" />
                <span>إضافة مكون</span>
              </Button>
            </div>
            {newExtras.map((extra, idx) => (
              <div key={idx} className="grid grid-cols-12 gap-2 items-end">
                <div className="col-span-7">
                  <Select
                    value={String(extra.inventoryItemId)}
                    onChange={(e) => {
                      const rm = rawMaterials.find((m) => m.id === e.target.value);
                      if (!rm) return;
                      const next = [...newExtras];
                      next[idx] = {
                        ...next[idx],
                        inventoryItemId: Number(rm.id),
                        name: rm.name,
                        unit: rm.unit,
                      };
                      setNewExtras(next);
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
                      const next = [...newExtras];
                      next[idx] = { ...next[idx], quantity: Number(e.target.value) };
                      setNewExtras(next);
                    }}
                  />
                </div>
                <div className="col-span-1 flex justify-end">
                  <button
                    type="button"
                    onClick={() => setNewExtras(newExtras.filter((_, i) => i !== idx))}
                    className="p-2 text-[#B91C1C] hover:bg-[#FEF2F2] rounded-lg cursor-pointer"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>

          <Input
            label="ملاحظات الوصفة"
            value={newNotes}
            onChange={(e) => setNewNotes(e.target.value)}
            placeholder="تعليمات الخلط أو درجة حرارة الفرن"
          />

          {createRecipeError && (
            <div className="text-xs text-[#B91C1C] font-medium">{createRecipeError}</div>
          )}

          <div className="flex items-center justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => setCreateRecipeOpen(false)}>
              إلغاء
            </Button>
            <Button type="submit" disabled={creatingRecipe}>
              {creatingRecipe ? 'جاري الإنشاء...' : 'اعتماد الوصفة الجديدة'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Edit Recipe Modal */}
      <Modal
        isOpen={Boolean(editingRecipe)}
        onClose={() => setEditingRecipe(null)}
        title={`تعديل الوصفة القياسية: ${editingRecipe?.breadType || ''}`}
      >
        {editingRecipe && (
          <form onSubmit={handleSaveRecipe} className="space-y-4">
            <Input
              label="اسم نوع الخبز"
              required
              value={editingRecipe.breadType}
              onChange={(e) =>
                setEditingRecipe({ ...editingRecipe, breadType: e.target.value })
              }
            />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Input
                label="الإنتاج المتوقع (رغيف)"
                type="number"
                min="1"
                required
                value={editingRecipe.expectedYieldLoaves}
                onChange={(e) =>
                  setEditingRecipe({
                    ...editingRecipe,
                    expectedYieldLoaves: Number(e.target.value),
                  })
                }
              />
              <Input
                label="سعر البيع الافتراضي (ج.س)"
                type="number"
                min="1"
                required
                value={editingRecipe.unitSellingPrice}
                onChange={(e) =>
                  setEditingRecipe({
                    ...editingRecipe,
                    unitSellingPrice: Number(e.target.value),
                  })
                }
              />
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <Input
                label="دقيق (جوال)"
                type="number"
                step="any"
                min="0"
                value={editingRecipe.flourBags}
                onChange={(e) =>
                  setEditingRecipe({ ...editingRecipe, flourBags: Number(e.target.value) })
                }
              />
              <Input
                label="زيت (لتر)"
                type="number"
                step="any"
                min="0"
                value={editingRecipe.oilLiters}
                onChange={(e) =>
                  setEditingRecipe({ ...editingRecipe, oilLiters: Number(e.target.value) })
                }
              />
              <Input
                label="خميرة (جم)"
                type="number"
                step="any"
                min="0"
                value={editingRecipe.yeastGrams}
                onChange={(e) =>
                  setEditingRecipe({ ...editingRecipe, yeastGrams: Number(e.target.value) })
                }
              />
              <Input
                label="ملح (جم)"
                type="number"
                step="any"
                min="0"
                value={editingRecipe.saltGrams}
                onChange={(e) =>
                  setEditingRecipe({ ...editingRecipe, saltGrams: Number(e.target.value) })
                }
              />
              <Input
                label="سكر (جم)"
                type="number"
                step="any"
                min="0"
                value={editingRecipe.sugarGrams}
                onChange={(e) =>
                  setEditingRecipe({ ...editingRecipe, sugarGrams: Number(e.target.value) })
                }
              />
            </div>

            <div className="space-y-2 border-t border-[#E2E7E5] pt-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-[#142D35]">مكونات أخرى</span>
                <Button type="button" variant="outline" size="sm" onClick={addExtraRowToEdit}>
                  <Plus className="w-3.5 h-3.5" />
                  <span>إضافة مكون</span>
                </Button>
              </div>
              {(editingRecipe.otherIngredients || []).map((extra, idx) => (
                <div key={idx} className="grid grid-cols-12 gap-2 items-end">
                  <div className="col-span-7">
                    <Select
                      value={String(extra.inventoryItemId)}
                      onChange={(e) => {
                        const rm = rawMaterials.find((m) => m.id === e.target.value);
                        if (!rm) return;
                        const next = [...(editingRecipe.otherIngredients || [])];
                        next[idx] = {
                          ...next[idx],
                          inventoryItemId: Number(rm.id),
                          name: rm.name,
                          unit: rm.unit,
                        };
                        setEditingRecipe({ ...editingRecipe, otherIngredients: next });
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
                        const next = [...(editingRecipe.otherIngredients || [])];
                        next[idx] = { ...next[idx], quantity: Number(e.target.value) };
                        setEditingRecipe({ ...editingRecipe, otherIngredients: next });
                      }}
                    />
                  </div>
                  <div className="col-span-1 flex justify-end">
                    <button
                      type="button"
                      onClick={() =>
                        setEditingRecipe({
                          ...editingRecipe,
                          otherIngredients: (editingRecipe.otherIngredients || []).filter(
                            (_, i) => i !== idx
                          ),
                        })
                      }
                      className="p-2 text-[#B91C1C] hover:bg-[#FEF2F2] rounded-lg cursor-pointer"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>

            <Input
              label="ملاحظات"
              value={editingRecipe.notes || ''}
              onChange={(e) => setEditingRecipe({ ...editingRecipe, notes: e.target.value })}
            />

            {recipeError && <div className="text-xs text-[#B91C1C] font-medium">{recipeError}</div>}
            <div className="flex items-center justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => setEditingRecipe(null)}>
                إلغاء
              </Button>
              <Button type="submit" disabled={submittingRecipe}>
                {submittingRecipe ? 'جاري الحفظ...' : 'حفظ الوصفة'}
              </Button>
            </div>
          </form>
        )}
      </Modal>

      <ConfirmDialog
        isOpen={Boolean(toggleTarget)}
        onClose={() => setToggleTarget(null)}
        onConfirm={handleConfirmToggle}
        title={toggleTarget?.isActive !== false ? 'إيقاف وصفة إنتاج' : 'تفعيل وصفة إنتاج'}
        message={
          toggleTarget?.isActive !== false
            ? `سيتم إيقاف وصفة "${toggleTarget?.breadType}" ومنع اختيارها في دفعات الإنتاج الجديدة دون التأثير على السجلات التاريخية.`
            : `هل تريد إعادة تفعيل وصفة "${toggleTarget?.breadType}" لإتاحتها في الإنتاج اليومي؟`
        }
        confirmLabel={toggleTarget?.isActive !== false ? 'إيقاف الوصفة' : 'تفعيل الوصفة'}
        tone={toggleTarget?.isActive !== false ? 'warning' : 'primary'}
        loading={togglingRecipe}
      />
    </div>
  );
};
