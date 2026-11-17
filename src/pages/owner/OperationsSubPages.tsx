import React, { useEffect, useState } from 'react';
import {
  Check,
  Plus,
  ShieldCheck,
  KeyRound,
  Edit3,
  FileText,
  Upload,
  Printer,
  Trash2,
  HandCoins,
} from 'lucide-react';
import { useSbms } from '../../context/SbmsContext';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Input, Select } from '../../components/ui/FormControls';
import { Modal } from '../../components/ui/Modal';
import { StatusText } from '../../components/ui/StatusText';
import { formatCurrency, formatNumber } from '../../lib/utils';
import { AgentProfile, ShiftFinalReport } from '../../types/sbms';

const PERMISSION_OPTIONS = [
  { code: 'PRODUCTION_LOG', label: 'تسجيل الإنتاج' },
  { code: 'SALES_LOG', label: 'تسجيل المبيعات والمرتجعات' },
  { code: 'EXPENSES_LOG', label: 'تسجيل المصروفات' },
  { code: 'SHIFT_MANAGE', label: 'فتح وإغلاق الوردية' },
] as const;

const PERM_LABELS: Record<string, string> = {
  PRODUCTION_LOG: 'الإنتاج',
  SALES_LOG: 'المبيعات',
  EXPENSES_LOG: 'المصروفات',
  SHIFT_MANAGE: 'الوردية',
};

async function compressAvatarFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('تعذر قراءة ملف الصورة'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('ملف الصورة غير صالح'));
      img.onload = () => {
        const size = 240;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(String(reader.result));
          return;
        }
        const minDim = Math.min(img.width, img.height);
        const sx = (img.width - minDim) / 2;
        const sy = (img.height - minDim) / 2;
        ctx.drawImage(img, sx, sy, minDim, minDim, 0, 0, size, size);
        resolve(canvas.toDataURL('image/jpeg', 0.82));
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

export const AgentsShiftsPage: React.FC = () => {
  const {
    user,
    agents,
    shifts,
    handovers,
    toggleAgentStatus,
    addAgent,
    updateAgent,
    approveShift,
    confirmHandover,
    fetchShiftReport,
    settings,
  } = useSbms();

  const [shiftSubTab, setShiftSubTab] = useState<'shifts' | 'handovers'>('shifts');

  // Create Agent Modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [fullName, setFullName] = useState('');
  const [username, setUsername] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('123456');
  const [assignedShift, setAssignedShift] = useState<
    'الوردية الصباحية' | 'الوردية المسائية' | 'الوردية الليلية'
  >('الوردية المسائية');
  const [avatarUrl, setAvatarUrl] = useState<string>('');
  const [permissions, setPermissions] = useState<string[]>([
    'PRODUCTION_LOG',
    'SALES_LOG',
    'EXPENSES_LOG',
    'SHIFT_MANAGE',
  ]);
  const [agentError, setAgentError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Edit Agent Modal state
  const [editingAgent, setEditingAgent] = useState<AgentProfile | null>(null);
  const [editFullName, setEditFullName] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [editShift, setEditShift] = useState<
    'الوردية الصباحية' | 'الوردية المسائية' | 'الوردية الليلية'
  >('الوردية الصباحية');
  const [editPassword, setEditPassword] = useState('');
  const [editAvatarUrl, setEditAvatarUrl] = useState<string | null>(null);
  const [editPermissions, setEditPermissions] = useState<string[]>([]);
  const [editActive, setEditActive] = useState(true);
  const [editError, setEditError] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);

  // Shift Report Modal state
  const [reportModalOpen, setReportModalOpen] = useState(false);
  const [loadingReport, setLoadingReport] = useState(false);
  const [activeReport, setActiveReport] = useState<ShiftFinalReport | null>(null);

  // Confirm Handover / Approve Shift Modal state
  const [confirmTarget, setConfirmTarget] = useState<{
    mode: 'shift' | 'handover';
    id: string;
    label: string;
    expectedCash: number;
    actualCash?: number;
  } | null>(null);
  const [receiverName, setReceiverName] = useState(user?.fullName || 'المالك');
  const [confirmNotes, setConfirmNotes] = useState('');
  const [confirming, setConfirming] = useState(false);

  const openEditAgentModal = (ag: AgentProfile) => {
    setEditingAgent(ag);
    setEditFullName(ag.fullName);
    setEditPhone(ag.phone);
    setEditShift(ag.assignedShift);
    setEditPassword('');
    setEditAvatarUrl(ag.avatarUrl || null);
    setEditPermissions(
      Array.isArray(ag.permissions)
        ? ag.permissions
        : ['PRODUCTION_LOG', 'SALES_LOG', 'EXPENSES_LOG', 'SHIFT_MANAGE']
    );
    setEditActive(ag.status === 'نشط');
    setEditError('');
  };

  const handlePhotoUpload = async (
    e: React.ChangeEvent<HTMLInputElement>,
    setter: (val: string) => void,
    errSetter: (msg: string) => void
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      errSetter('يرجى اختيار ملف صورة صالح (JPG / PNG).');
      return;
    }
    try {
      const compressed = await compressAvatarFile(file);
      setter(compressed);
      errSetter('');
    } catch {
      errSetter('تعذر معالجة الصورة المختارة.');
    }
  };

  const togglePermInList = (list: string[], code: string) =>
    list.includes(code) ? list.filter((p) => p !== code) : [...list, code];

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    setAgentError('');
    if (!fullName.trim() || !username.trim()) return;
    setSubmitting(true);
    const res = await addAgent({
      fullName: fullName.trim(),
      username: username.trim(),
      phone: phone.trim(),
      password: password || '123456',
      assignedShift,
      avatarUrl: avatarUrl || undefined,
      status: 'نشط',
      permissions,
    });
    setSubmitting(false);
    if (!res.ok) {
      setAgentError(res.error || 'تعذر إضافة الوكيل');
      return;
    }
    setFullName('');
    setUsername('');
    setPhone('');
    setPassword('123456');
    setAvatarUrl('');
    setPermissions(['PRODUCTION_LOG', 'SALES_LOG', 'EXPENSES_LOG', 'SHIFT_MANAGE']);
    setModalOpen(false);
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingAgent) return;
    setEditError('');
    setSavingEdit(true);
    const res = await updateAgent(editingAgent.id, {
      fullName: editFullName.trim(),
      phone: editPhone.trim(),
      assignedShift: editShift,
      ...(editPassword.trim() ? { password: editPassword.trim() } : {}),
      avatarUrl: editAvatarUrl,
      permissions: editPermissions,
      isActive: editActive,
    });
    setSavingEdit(false);
    if (!res.ok) {
      setEditError(res.error || 'تعذر تحديث بيانات الوكيل');
      return;
    }
    setEditingAgent(null);
  };

  const handleOpenReport = async (shiftId: string) => {
    setReportModalOpen(true);
    setLoadingReport(true);
    setActiveReport(null);
    const data = await fetchShiftReport(shiftId);
    setActiveReport(data);
    setLoadingReport(false);
  };

  const handleConfirmHandoverSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!confirmTarget) return;
    setConfirming(true);
    if (confirmTarget.mode === 'shift') {
      await approveShift(confirmTarget.id, receiverName.trim() || user?.fullName, confirmNotes.trim() || undefined);
    } else {
      await confirmHandover(confirmTarget.id, receiverName.trim() || user?.fullName, confirmNotes.trim() || undefined);
    }
    setConfirming(false);
    setConfirmNotes('');
    setConfirmTarget(null);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-[#142D35]">إدارة الوكلاء والورديات وتسليم العهد</h2>
          <p className="text-xs text-[#5A6B6E] mt-1">
            حسابات الوكلاء، الصور الشخصية، الصلاحيات التشغيلية، تقارير الورديات، وسجل تسليم النقدية الدائم.
          </p>
        </div>
        <Button onClick={() => setModalOpen(true)}>
          <Plus className="w-4 h-4" />
          <span>إضافة وكيل جديد</span>
        </Button>
      </div>

      {/* Agents & Performance Table */}
      <Card padding="none" className="overflow-hidden">
        <div className="px-5 py-3.5 border-b border-[#E2E7E5] text-sm font-semibold text-[#142D35]">
          وكلاء الورديات والأداء الفعلي ({agents.length})
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-right">
            <thead className="bg-[#F5F7F6] text-xs text-[#5A6B6E] border-b border-[#E2E7E5]">
              <tr>
                <th className="py-3 px-4 font-medium">الوكيل</th>
                <th className="py-3 px-4 font-medium">الوردية والصلاحيات</th>
                <th className="py-3 px-4 font-medium">الإنتاج والتالف</th>
                <th className="py-3 px-4 font-medium">إجمالي المبيعات</th>
                <th className="py-3 px-4 font-medium">الورديات / دقة النقدية</th>
                <th className="py-3 px-4 font-medium">الحالة</th>
                <th className="py-3 px-4 font-medium">إجراءات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E2E7E5]">
              {agents.map((ag) => (
                <tr key={ag.id} className="hover:bg-[#F5F7F6]/60">
                  <td className="py-3 px-4">
                    <div className="flex items-center gap-3">
                      {ag.avatarUrl ? (
                        <img
                          src={ag.avatarUrl}
                          alt={ag.fullName}
                          className="w-9 h-9 rounded-full object-cover border border-[#E2E7E5] shrink-0"
                        />
                      ) : (
                        <div className="w-9 h-9 rounded-full bg-[#142D35]/10 text-[#142D35] flex items-center justify-center text-xs font-bold shrink-0">
                          {ag.fullName.slice(0, 2)}
                        </div>
                      )}
                      <div>
                        <div className="font-semibold text-[#142D35]">{ag.fullName}</div>
                        <div className="text-xs font-mono text-[#5A6B6E]">
                          {ag.username} · <span dir="ltr">{ag.phone}</span>
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="py-3 px-4 text-xs">
                    <div className="font-medium text-[#142D35]">{ag.assignedShift}</div>
                    <div className="text-[11px] text-[#5A6B6E] mt-0.5">
                      {(ag.permissions || []).map((p) => PERM_LABELS[p] || p).join(' · ') || 'دون صلاحيات'}
                    </div>
                  </td>
                  <td className="py-3 px-4 text-xs font-mono tabular-nums">
                    <div className="font-semibold text-[#142D35]">
                      {formatNumber(ag.totalProduction ?? ag.todayProduction)} رغيف
                    </div>
                    <div className="text-[#B91C1C]">
                      تالف: {formatNumber(ag.totalDamaged ?? 0)}
                    </div>
                  </td>
                  <td className="py-3 px-4 text-xs font-mono tabular-nums">
                    <div className="font-bold text-[#176B55]">
                      {formatCurrency(ag.totalSales ?? ag.todaySales, settings.currencySymbol)}
                    </div>
                    <div className="text-[11px] text-[#5A6B6E]">
                      نقدي: {formatCurrency(ag.cashSales ?? 0)} · آجل: {formatCurrency(ag.creditSales ?? 0)}
                    </div>
                  </td>
                  <td className="py-3 px-4 text-xs font-mono tabular-nums">
                    <div className="text-[#176B55] font-semibold">دقة {ag.cashAccuracyRate}%</div>
                    <div className="text-[11px] text-[#5A6B6E]">
                      {ag.shiftsCount ?? 0} وردية · فارق: {formatCurrency(ag.totalCashDifference ?? 0)}
                    </div>
                  </td>
                  <td className="py-3 px-4">
                    <StatusText
                      tone={ag.status === 'نشط' ? 'success' : 'neutral'}
                      label={ag.status}
                    />
                  </td>
                  <td className="py-3 px-4">
                    <div className="flex items-center gap-2">
                      <Button variant="outline" size="sm" onClick={() => openEditAgentModal(ag)}>
                        <Edit3 className="w-3.5 h-3.5" />
                        <span>تعديل</span>
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => toggleAgentStatus(ag.id)}>
                        {ag.status === 'نشط' ? 'إيقاف' : 'تفعيل'}
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Shifts & Handovers Switcher */}
      <div className="inline-flex items-center gap-1 p-1 bg-[#E2E7E5]/50 rounded-lg">
        <button
          type="button"
          onClick={() => setShiftSubTab('shifts')}
          className={`px-3.5 py-1.5 text-xs font-medium rounded-md cursor-pointer ${
            shiftSubTab === 'shifts' ? 'bg-white text-[#142D35]' : 'text-[#5A6B6E]'
          }`}
        >
          سجل الورديات والاعتماد ({shifts.length})
        </button>
        <button
          type="button"
          onClick={() => setShiftSubTab('handovers')}
          className={`px-3.5 py-1.5 text-xs font-medium rounded-md cursor-pointer ${
            shiftSubTab === 'handovers' ? 'bg-white text-[#142D35]' : 'text-[#5A6B6E]'
          }`}
        >
          سجل تسليم العهد النقدية الدائم ({handovers.length})
        </button>
      </div>

      {shiftSubTab === 'shifts' ? (
        <Card padding="none" className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-right">
              <thead className="bg-[#F5F7F6] text-xs text-[#5A6B6E] border-b border-[#E2E7E5]">
                <tr>
                  <th className="py-3 px-4 font-medium">الوردية / التاريخ</th>
                  <th className="py-3 px-4 font-medium">الوكيل</th>
                  <th className="py-3 px-4 font-medium">الإنتاج / المبيعات</th>
                  <th className="py-3 px-4 font-medium">المتوقع بالخزينة</th>
                  <th className="py-3 px-4 font-medium">الفعلي المسلم والفارق</th>
                  <th className="py-3 px-4 font-medium">الحالة</th>
                  <th className="py-3 px-4 font-medium">التقرير والاعتماد</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E2E7E5]">
                {shifts.map((sh) => (
                  <tr key={sh.id} className="hover:bg-[#F5F7F6]/60">
                    <td className="py-3 px-4 text-xs">
                      <div className="font-semibold text-[#142D35]">{sh.shiftName}</div>
                      <div className="font-mono text-[#5A6B6E]">{sh.date}</div>
                    </td>
                    <td className="py-3 px-4 text-xs font-medium">{sh.agentName}</td>
                    <td className="py-3 px-4 text-xs font-mono tabular-nums">
                      <div>إنتاج: {formatNumber(sh.producedBread)} رغيف</div>
                      <div className="text-[#176B55]">
                        نقدي: {formatCurrency(sh.cashSalesAmount)}
                      </div>
                    </td>
                    <td className="py-3 px-4 font-mono tabular-nums font-medium">
                      {formatCurrency(sh.expectedCash)}
                    </td>
                    <td className="py-3 px-4 font-mono tabular-nums text-xs">
                      {sh.actualCash !== undefined ? (
                        <div>
                          <div className="font-semibold">{formatCurrency(sh.actualCash)}</div>
                          <div
                            className={
                              (sh.cashDifference ?? 0) === 0
                                ? 'text-[#176B55]'
                                : 'text-[#B91C1C] font-semibold'
                            }
                          >
                            فارق: {formatCurrency(sh.cashDifference ?? 0)}
                          </div>
                        </div>
                      ) : (
                        '—'
                      )}
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
                      <div className="flex items-center gap-2">
                        <Button variant="outline" size="sm" onClick={() => handleOpenReport(sh.id)}>
                          <FileText className="w-3.5 h-3.5" />
                          <span>التقرير</span>
                        </Button>
                        {sh.status === 'مغلقة بانتظار المراجعة' && (
                          <Button
                            size="sm"
                            onClick={() => {
                              setReceiverName(user?.fullName || 'المالك');
                              setConfirmNotes('');
                              setConfirmTarget({
                                mode: 'shift',
                                id: sh.id,
                                label: `${sh.shiftName} — ${sh.agentName} (${sh.date})`,
                                expectedCash: sh.expectedCash,
                                actualCash: sh.actualCash,
                              });
                            }}
                          >
                            <Check className="w-3.5 h-3.5" />
                            <span>اعتماد</span>
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : (
        <Card padding="none" className="overflow-hidden">
          <div className="px-5 py-3.5 border-b border-[#E2E7E5] text-sm font-semibold text-[#142D35] flex items-center gap-2">
            <HandCoins className="w-4 h-4 text-[#176B55]" />
            <span>السجل الدائم لتسليم العهد النقدية للورديات</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-right">
              <thead className="bg-[#F5F7F6] text-xs text-[#5A6B6E] border-b border-[#E2E7E5]">
                <tr>
                  <th className="py-3 px-4 font-medium">تاريخ ووقت التسليم</th>
                  <th className="py-3 px-4 font-medium">الوكيل والوردية</th>
                  <th className="py-3 px-4 font-medium">المبلغ المتوقع</th>
                  <th className="py-3 px-4 font-medium">المبلغ المستلم</th>
                  <th className="py-3 px-4 font-medium">الفارق</th>
                  <th className="py-3 px-4 font-medium">المستلم</th>
                  <th className="py-3 px-4 font-medium">حالة التأكيد</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E2E7E5]">
                {handovers.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-8 text-center text-xs text-[#5A6B6E]">
                      لا توجد عمليات تسليم عهدة مسجلة حتى الآن.
                    </td>
                  </tr>
                ) : (
                  handovers.map((ho) => (
                    <tr key={ho.id} className="hover:bg-[#F5F7F6]/60">
                      <td className="py-3 px-4 font-mono text-xs">
                        <div>{ho.handedAt.slice(0, 10)}</div>
                        <div className="text-[#5A6B6E]">{ho.handedAt.slice(11, 16)}</div>
                      </td>
                      <td className="py-3 px-4 text-xs">
                        <div className="font-semibold text-[#142D35]">{ho.agentName}</div>
                        <div className="text-[#5A6B6E]">
                          {ho.shiftName} · {ho.shiftDate}
                        </div>
                      </td>
                      <td className="py-3 px-4 font-mono tabular-nums">
                        {formatCurrency(ho.expectedCash, settings.currencySymbol)}
                      </td>
                      <td className="py-3 px-4 font-mono tabular-nums font-bold text-[#142D35]">
                        {formatCurrency(ho.handedCash, settings.currencySymbol)}
                      </td>
                      <td
                        className={`py-3 px-4 font-mono tabular-nums font-semibold ${
                          ho.cashDifference === 0 ? 'text-[#176B55]' : 'text-[#B91C1C]'
                        }`}
                      >
                        {formatCurrency(ho.cashDifference, settings.currencySymbol)}
                      </td>
                      <td className="py-3 px-4 text-xs">
                        <div className="font-medium text-[#142D35]">{ho.receivedByName}</div>
                        {ho.notes && <div className="text-[#5A6B6E] max-w-[180px] truncate">{ho.notes}</div>}
                      </td>
                      <td className="py-3 px-4">
                        {ho.approvedByOwner ? (
                          <div className="text-xs">
                            <StatusText tone="success" label={`معتمدة (${ho.approvedByName || 'المالك'})`} />
                            {ho.approvedAt && (
                              <div className="font-mono text-[11px] text-[#5A6B6E] mt-0.5">
                                {ho.approvedAt.slice(0, 16).replace('T', ' ')}
                              </div>
                            )}
                          </div>
                        ) : (
                          <Button
                            size="sm"
                            onClick={() => {
                              setReceiverName(ho.receivedByName || user?.fullName || 'المالك');
                              setConfirmNotes(ho.notes || '');
                              setConfirmTarget({
                                mode: 'handover',
                                id: ho.id,
                                label: `${ho.shiftName} — ${ho.agentName}`,
                                expectedCash: ho.expectedCash,
                                actualCash: ho.handedCash,
                              });
                            }}
                          >
                            <Check className="w-3.5 h-3.5" />
                            <span>تأكيد الاستلام</span>
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Create Agent Modal */}
      <Modal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        title="إضافة وكيل وردية جديد"
        subtitle="تعيين بيانات الدخول، الصورة الشخصية، الوردية، والصلاحيات التشغيلية"
      >
        <form onSubmit={handleAdd} className="space-y-4">
          {/* Avatar Upload */}
          <div className="flex items-center gap-4 p-3 rounded-lg bg-[#F5F7F6] border border-[#E2E7E5]">
            {avatarUrl ? (
              <img
                src={avatarUrl}
                alt="صورة الوكيل"
                className="w-14 h-14 rounded-full object-cover border border-[#176B55]"
              />
            ) : (
              <div className="w-14 h-14 rounded-full bg-white border border-[#E2E7E5] flex items-center justify-center text-xs text-[#5A6B6E]">
                لا توجد صورة
              </div>
            )}
            <div className="flex-1 space-y-1">
              <div className="text-xs font-medium text-[#142D35]">صورة الوكيل الشخصية (اختياري)</div>
              <div className="flex items-center gap-2">
                <label className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#E2E7E5] bg-white text-xs font-medium text-[#142D35] hover:bg-[#F5F7F6] cursor-pointer">
                  <Upload className="w-3.5 h-3.5" />
                  <span>رفع صورة</span>
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => handlePhotoUpload(e, setAvatarUrl, setAgentError)}
                  />
                </label>
                {avatarUrl && (
                  <button
                    type="button"
                    onClick={() => setAvatarUrl('')}
                    className="text-xs text-[#B91C1C] hover:underline cursor-pointer"
                  >
                    إزالة
                  </button>
                )}
              </div>
            </div>
          </div>

          <Input label="الاسم الكامل" required value={fullName} onChange={(e) => setFullName(e.target.value)} />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input label="اسم المستخدم" required minLength={3} value={username} onChange={(e) => setUsername(e.target.value)} />
            <Input label="رقم الهاتف" required minLength={6} value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Select
              label="الوردية المخصصة"
              value={assignedShift}
              onChange={(e) => setAssignedShift(e.target.value as typeof assignedShift)}
            >
              <option value="الوردية الصباحية">الوردية الصباحية</option>
              <option value="الوردية المسائية">الوردية المسائية</option>
              <option value="الوردية الليلية">الوردية الليلية</option>
            </Select>
            <Input
              label="كلمة المرور المبدئية"
              type="password"
              required
              minLength={4}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>

          <div className="space-y-2 pt-1">
            <div className="text-xs font-medium text-[#142D35]">الصلاحيات التشغيلية المسموحة</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {PERMISSION_OPTIONS.map((perm) => (
                <label
                  key={perm.code}
                  className="flex items-center gap-2 p-2.5 rounded-lg border border-[#E2E7E5] text-xs cursor-pointer hover:bg-[#F5F7F6]"
                >
                  <input
                    type="checkbox"
                    className="w-4 h-4 accent-[#176B55]"
                    checked={permissions.includes(perm.code)}
                    onChange={() => setPermissions(togglePermInList(permissions, perm.code))}
                  />
                  <span>{perm.label}</span>
                </label>
              ))}
            </div>
          </div>

          {agentError && <div className="text-xs text-[#B91C1C] font-medium">{agentError}</div>}
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => setModalOpen(false)}>
              إلغاء
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? 'جاري الحفظ...' : 'حفظ الوكيل'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Edit Agent Modal */}
      <Modal
        isOpen={Boolean(editingAgent)}
        onClose={() => setEditingAgent(null)}
        title={`تعديل بيانات وصلاحيات: ${editingAgent?.fullName || ''}`}
      >
        {editingAgent && (
          <form onSubmit={handleSaveEdit} className="space-y-4">
            <div className="flex items-center gap-4 p-3 rounded-lg bg-[#F5F7F6] border border-[#E2E7E5]">
              {editAvatarUrl ? (
                <img
                  src={editAvatarUrl}
                  alt={editFullName}
                  className="w-14 h-14 rounded-full object-cover border border-[#176B55]"
                />
              ) : (
                <div className="w-14 h-14 rounded-full bg-white border border-[#E2E7E5] flex items-center justify-center text-xs font-bold text-[#142D35]">
                  {editFullName.slice(0, 2)}
                </div>
              )}
              <div className="flex-1 space-y-1">
                <div className="text-xs font-medium text-[#142D35]">تحديث الصورة الشخصية</div>
                <div className="flex items-center gap-2">
                  <label className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#E2E7E5] bg-white text-xs font-medium text-[#142D35] hover:bg-[#F5F7F6] cursor-pointer">
                    <Upload className="w-3.5 h-3.5" />
                    <span>تغيير الصورة</span>
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => handlePhotoUpload(e, (val) => setEditAvatarUrl(val), setEditError)}
                    />
                  </label>
                  {editAvatarUrl && (
                    <button
                      type="button"
                      onClick={() => setEditAvatarUrl(null)}
                      className="inline-flex items-center gap-1 text-xs text-[#B91C1C] hover:underline cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>حذف</span>
                    </button>
                  )}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Input
                label="الاسم الكامل"
                required
                value={editFullName}
                onChange={(e) => setEditFullName(e.target.value)}
              />
              <Input
                label="رقم الهاتف"
                required
                value={editPhone}
                onChange={(e) => setEditPhone(e.target.value)}
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Select
                label="الوردية المخصصة"
                value={editShift}
                onChange={(e) => setEditShift(e.target.value as typeof editShift)}
              >
                <option value="الوردية الصباحية">الوردية الصباحية</option>
                <option value="الوردية المسائية">الوردية المسائية</option>
                <option value="الوردية الليلية">الوردية الليلية</option>
              </Select>
              <Input
                label="كلمة مرور جديدة (اتركه فارغاً للإبقاء)"
                type="password"
                minLength={4}
                value={editPassword}
                onChange={(e) => setEditPassword(e.target.value)}
                placeholder="اختياري"
              />
            </div>

            <div className="space-y-2">
              <div className="text-xs font-medium text-[#142D35]">الصلاحيات التشغيلية</div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {PERMISSION_OPTIONS.map((perm) => (
                  <label
                    key={perm.code}
                    className="flex items-center gap-2 p-2.5 rounded-lg border border-[#E2E7E5] text-xs cursor-pointer hover:bg-[#F5F7F6]"
                  >
                    <input
                      type="checkbox"
                      className="w-4 h-4 accent-[#176B55]"
                      checked={editPermissions.includes(perm.code)}
                      onChange={() => setEditPermissions(togglePermInList(editPermissions, perm.code))}
                    />
                    <span>{perm.label}</span>
                  </label>
                ))}
              </div>
            </div>

            <label className="flex items-center justify-between p-3 rounded-lg border border-[#E2E7E5] text-xs cursor-pointer">
              <span className="font-medium text-[#142D35]">حساب نشط ومسموح له بالدخول</span>
              <input
                type="checkbox"
                className="w-4 h-4 accent-[#176B55]"
                checked={editActive}
                onChange={(e) => setEditActive(e.target.checked)}
              />
            </label>

            {editError && <div className="text-xs text-[#B91C1C] font-medium">{editError}</div>}

            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => setEditingAgent(null)}>
                إلغاء
              </Button>
              <Button type="submit" disabled={savingEdit}>
                {savingEdit ? 'جاري التحديث...' : 'حفظ التعديلات'}
              </Button>
            </div>
          </form>
        )}
      </Modal>

      {/* Final Shift Report Modal */}
      <Modal
        isOpen={reportModalOpen}
        onClose={() => setReportModalOpen(false)}
        title="التقرير الختامي الشامل للوردية"
        maxWidth="xl"
      >
        {loadingReport ? (
          <div className="py-10 text-center text-xs text-[#5A6B6E]">جاري تحميل بيانات تقرير الوردية...</div>
        ) : !activeReport ? (
          <div className="py-10 text-center text-xs text-[#B91C1C]">تعذر تحميل تفاصيل التقرير.</div>
        ) : (
          <div className="space-y-5 text-xs">
            <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-[#E2E7E5]">
              <div>
                <div className="text-sm font-bold text-[#142D35]">
                  {activeReport.shift.shiftName} — {activeReport.shift.agentName}
                </div>
                <div className="font-mono text-[#5A6B6E] mt-0.5">
                  التاريخ: {activeReport.shift.date} · الحالة: {activeReport.shift.status}
                </div>
              </div>
              <Button variant="outline" size="sm" onClick={() => window.print()} className="no-print">
                <Printer className="w-3.5 h-3.5" />
                <span>طباعة التقرير</span>
              </Button>
            </div>

            {/* Cash & Bread Summary */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="p-3 rounded-lg bg-[#F5F7F6] border border-[#E2E7E5]">
                <div className="text-[#5A6B6E]">العهدة الافتتاحية</div>
                <div className="font-mono font-bold text-sm mt-1">
                  {formatCurrency(activeReport.shift.openingCash, settings.currencySymbol)}
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
                <div className="text-[#5A6B6E]">المصروفات المسجلة</div>
                <div className="font-mono font-bold text-sm text-[#B91C1C] mt-1">
                  {formatCurrency(activeReport.shift.totalExpenses)}
                </div>
              </div>
              <div className="p-3 rounded-lg bg-[#F5F7F6] border border-[#E2E7E5]">
                <div className="text-[#5A6B6E]">المتوقع / الفعلي المسلم</div>
                <div className="font-mono font-bold text-sm text-[#142D35] mt-1">
                  {formatCurrency(activeReport.shift.expectedCash)}
                </div>
                {activeReport.shift.actualCash !== undefined && (
                  <div className="font-mono text-[11px] text-[#5A6B6E]">
                    مسلم: {formatCurrency(activeReport.shift.actualCash)} (فارق:{' '}
                    {formatCurrency(activeReport.shift.cashDifference ?? 0)})
                  </div>
                )}
              </div>
            </div>

            {/* Bread Equation */}
            <div className="p-3 rounded-lg border border-[#E2E7E5]">
              <div className="font-semibold text-[#142D35] mb-2">مطابقة حركة الخبز بالرغيف</div>
              <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 font-mono text-center">
                <div>
                  <div className="text-[11px] text-[#5A6B6E]">افتتاحي</div>
                  <div className="font-bold">{formatNumber(activeReport.breadReconciliation.openingBread)}</div>
                </div>
                <div>
                  <div className="text-[11px] text-[#5A6B6E]">+ إنتاج</div>
                  <div className="font-bold text-[#176B55]">
                    {formatNumber(activeReport.breadReconciliation.producedBread)}
                  </div>
                </div>
                <div>
                  <div className="text-[11px] text-[#5A6B6E]">+ مرتجع</div>
                  <div className="font-bold">{formatNumber(activeReport.breadReconciliation.returnedBread)}</div>
                </div>
                <div>
                  <div className="text-[11px] text-[#5A6B6E]">− مباع</div>
                  <div className="font-bold">{formatNumber(activeReport.breadReconciliation.soldBread)}</div>
                </div>
                <div>
                  <div className="text-[11px] text-[#5A6B6E]">− تالف/تسوية</div>
                  <div className="font-bold text-[#B91C1C]">
                    {formatNumber(
                      activeReport.breadReconciliation.damagedBread +
                        activeReport.breadReconciliation.authorizedAdjustments
                    )}
                  </div>
                </div>
                <div>
                  <div className="text-[11px] text-[#5A6B6E]">= المتوقع / الفعلي</div>
                  <div className="font-bold text-[#142D35]">
                    {formatNumber(activeReport.breadReconciliation.expectedClosingBread)} /{' '}
                    {formatNumber(activeReport.breadReconciliation.actualClosingBread)}
                  </div>
                </div>
              </div>
            </div>

            {/* Handover details if present */}
            {activeReport.handover && (
              <div className="p-3 rounded-lg bg-[#176B55]/5 border border-[#176B55]/25 space-y-1">
                <div className="font-semibold text-[#142D35]">تفاصيل تسليم العهدة</div>
                <div>
                  المستلم: <strong>{activeReport.handover.receivedByName}</strong> · وقت التسليم:{' '}
                  <span className="font-mono">{activeReport.handover.handedAt.slice(0, 16).replace('T', ' ')}</span>
                </div>
                <div>
                  حالة الاعتماد:{' '}
                  {activeReport.handover.approvedByOwner
                    ? `معتمدة بواسطة ${activeReport.handover.approvedByName || 'المالك'}`
                    : 'بانتظار تأكيد المالك'}
                </div>
                {activeReport.handover.notes && <div>ملاحظات: {activeReport.handover.notes}</div>}
              </div>
            )}

            {/* Breakdown counts */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-[11px]">
              <div className="p-3 rounded-lg border border-[#E2E7E5]">
                <div className="font-semibold text-[#142D35] mb-1">
                  دفعات الإنتاج ({activeReport.productionBatches.length})
                </div>
                {activeReport.productionBatches.map((b) => (
                  <div key={b.id} className="flex justify-between py-0.5">
                    <span>{b.breadType}</span>
                    <span className="font-mono">{formatNumber(b.producedLoaves)} رغيف</span>
                  </div>
                ))}
              </div>
              <div className="p-3 rounded-lg border border-[#E2E7E5]">
                <div className="font-semibold text-[#142D35] mb-1">
                  فواتير البيع ({activeReport.sales.length})
                </div>
                {activeReport.sales.map((s) => (
                  <div key={s.id} className="flex justify-between py-0.5">
                    <span>
                      {s.breadType} ({s.paymentType})
                    </span>
                    <span className="font-mono">{formatCurrency(s.totalAmount)}</span>
                  </div>
                ))}
              </div>
              <div className="p-3 rounded-lg border border-[#E2E7E5]">
                <div className="font-semibold text-[#142D35] mb-1">
                  المصروفات ({activeReport.expenses.length})
                </div>
                {activeReport.expenses.map((e) => (
                  <div key={e.id} className="flex justify-between py-0.5">
                    <span>{e.category}</span>
                    <span className="font-mono text-[#B91C1C]">{formatCurrency(e.amount)}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </Modal>

      {/* Confirm Shift / Handover Modal */}
      <Modal
        isOpen={Boolean(confirmTarget)}
        onClose={() => setConfirmTarget(null)}
        title="اعتماد إغلاق الوردية وتأكيد استلام العهدة النقدية"
      >
        {confirmTarget && (
          <form onSubmit={handleConfirmHandoverSubmit} className="space-y-4">
            <div className="p-3 rounded-lg bg-[#F5F7F6] border border-[#E2E7E5] text-xs space-y-1">
              <div className="font-bold text-[#142D35]">{confirmTarget.label}</div>
              <div>
                المتوقع: <span className="font-mono font-semibold">{formatCurrency(confirmTarget.expectedCash)}</span> · المسلم فعلياً:{' '}
                <span className="font-mono font-bold text-[#176B55]">
                  {formatCurrency(confirmTarget.actualCash ?? confirmTarget.expectedCash)}
                </span>
              </div>
            </div>

            <Input
              label="اسم المستلم للعهدة النقدية (المالك / الموظف المختص)"
              required
              value={receiverName}
              onChange={(e) => setReceiverName(e.target.value)}
            />
            <Input
              label="ملاحظات الاعتماد والمطابقة"
              value={confirmNotes}
              onChange={(e) => setConfirmNotes(e.target.value)}
              placeholder="ملاحظات المالك عند استلام العهدة"
            />

            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => setConfirmTarget(null)}>
                إلغاء
              </Button>
              <Button type="submit" disabled={confirming}>
                {confirming ? 'جاري الاعتماد...' : 'تأكيد الاستلام واعتماد الوردية'}
              </Button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
};

export { CashExpensesPage, CustomersPage, EmployeesPage } from './AccountingPages';

export const AuditNotificationsPage: React.FC = () => {
  const { auditLogs, notifications, markAllNotificationsRead } = useSbms();
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-[#142D35]">التنبيهات وسجل التدقيق المالي</h2>
          <p className="text-xs text-[#5A6B6E] mt-1">
            توثيق غير قابل للحذف لجميع العمليات المالية والتشغيلية وتنبيهات القواعد المبرمجة.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={markAllNotificationsRead}>
          تحديد جميع التنبيهات كمقروءة
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {notifications.map((n) => (
          <Card key={n.id}>
            <div className="flex items-center justify-between text-xs mb-1.5">
              <span className="font-mono text-[#5A6B6E]">{n.ruleCode}</span>
              <span className="font-mono text-[#5A6B6E]">{n.timestamp}</span>
            </div>
            <div className="text-sm font-bold text-[#142D35]">{n.title}</div>
            <p className="text-xs text-[#5A6B6E] mt-1">{n.message}</p>
          </Card>
        ))}
      </div>

      <Card padding="none" className="overflow-hidden">
        <div className="px-5 py-3.5 border-b border-[#E2E7E5] text-sm font-semibold text-[#142D35] flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-[#176B55]" />
          <span>سجل التدقيق الدائم (Audit Log)</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-right">
            <thead className="bg-[#F5F7F6] text-xs text-[#5A6B6E] border-b border-[#E2E7E5]">
              <tr>
                <th className="py-3 px-4 font-medium">المرجع / الوقت</th>
                <th className="py-3 px-4 font-medium">المستخدم</th>
                <th className="py-3 px-4 font-medium">العملية</th>
                <th className="py-3 px-4 font-medium">السجل المتأثر</th>
                <th className="py-3 px-4 font-medium">التفاصيل / القيم</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E2E7E5]">
              {auditLogs.map((log) => (
                <tr key={log.id}>
                  <td className="py-3 px-4 font-mono text-xs">
                    <div>{log.reference}</div>
                    <div className="text-[#5A6B6E]">{log.timestamp}</div>
                  </td>
                  <td className="py-3 px-4 text-xs font-medium">{log.userName}</td>
                  <td className="py-3 px-4 text-xs">{log.operationType}</td>
                  <td className="py-3 px-4 font-mono text-xs text-[#5A6B6E]">{log.affectedRecord}</td>
                  <td className="py-3 px-4 text-xs text-[#142D35]">{log.newValue}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
};

export const SettingsPage: React.FC = () => {
  const { settings, updateSettings, changePassword } = useSbms();
  const [form, setForm] = useState(settings);
  const [saved, setSaved] = useState(false);
  const [settingsError, setSettingsError] = useState('');
  const [savingSettings, setSavingSettings] = useState(false);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [pwMsg, setPwMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [savingPw, setSavingPw] = useState(false);

  useEffect(() => {
    setForm(settings);
  }, [settings]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSettingsError('');
    setSavingSettings(true);
    const res = await updateSettings(form);
    setSavingSettings(false);
    if (!res.ok) {
      setSettingsError(res.error || 'تعذر حفظ الإعدادات');
      return;
    }
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  const handlePasswordChange = async (e: React.FormEvent) => {
    e.preventDefault();
    setPwMsg(null);
    if (newPassword.length < 6) {
      setPwMsg({ ok: false, text: 'كلمة المرور الجديدة يجب أن تتكون من 6 أحرف على الأقل.' });
      return;
    }
    setSavingPw(true);
    const res = await changePassword(currentPassword, newPassword);
    setSavingPw(false);
    if (!res.ok) {
      setPwMsg({ ok: false, text: res.error || 'تعذر تغيير كلمة المرور.' });
      return;
    }
    setCurrentPassword('');
    setNewPassword('');
    setPwMsg({ ok: true, text: 'تم تحديث كلمة المرور بنجاح.' });
  };

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h2 className="text-lg font-bold text-[#142D35]">إعدادات المخبز والسياسات المحاسبية</h2>
        <p className="text-xs text-[#5A6B6E] mt-1">تكوين الاسم التجاري، العملة الافتراضية، وضوابط المخزون.</p>
      </div>

      <Card>
        <form onSubmit={handleSave} className="space-y-4">
          <Input
            label="اسم المخبز التجاري"
            value={form.bakeryName}
            onChange={(e) => setForm({ ...form, bakeryName: e.target.value })}
          />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input
              label="المدينة / الولاية"
              value={form.city}
              onChange={(e) => setForm({ ...form, city: e.target.value })}
            />
            <Input
              label="رمز العملة"
              value={form.currencySymbol}
              onChange={(e) => setForm({ ...form, currencySymbol: e.target.value })}
            />
          </div>
          <Input
            label="العنوان التفصيلي"
            value={form.address}
            onChange={(e) => setForm({ ...form, address: e.target.value })}
          />
          <div className="flex items-center justify-between py-2 border-t border-[#E2E7E5]">
            <div>
              <div className="text-sm font-medium text-[#142D35]">السماح بالمخزون السالب</div>
              <div className="text-xs text-[#5A6B6E]">
                مغلق افتراضياً لحماية دقة الأرصدة ومنع الصرف غير المغطى
              </div>
            </div>
            <input
              type="checkbox"
              checked={form.allowNegativeInventory}
              onChange={(e) => setForm({ ...form, allowNegativeInventory: e.target.checked })}
              className="w-4 h-4 accent-[#176B55]"
            />
          </div>

          {settingsError && <div className="text-xs text-[#B91C1C] font-medium">{settingsError}</div>}

          <div className="flex items-center justify-between pt-2">
            {saved ? <span className="text-xs font-medium text-[#176B55]">تم حفظ الإعدادات بنجاح.</span> : <span />}
            <Button type="submit" disabled={savingSettings}>
              {savingSettings ? 'جاري الحفظ...' : 'حفظ التغييرات'}
            </Button>
          </div>
        </form>
      </Card>

      <Card>
        <div className="flex items-center gap-2 pb-3 mb-4 border-b border-[#E2E7E5]">
          <KeyRound className="w-4 h-4 text-[#176B55]" />
          <h3 className="text-sm font-bold text-[#142D35]">تغيير كلمة المرور للحساب الحالي</h3>
        </div>
        <form onSubmit={handlePasswordChange} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input
              label="كلمة المرور الحالية"
              type="password"
              required
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
            />
            <Input
              label="كلمة المرور الجديدة"
              type="password"
              required
              minLength={6}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
            />
          </div>
          {pwMsg && (
            <div className={`text-xs font-medium ${pwMsg.ok ? 'text-[#176B55]' : 'text-[#B91C1C]'}`}>
              {pwMsg.text}
            </div>
          )}
          <div className="flex justify-end">
            <Button type="submit" variant="outline" disabled={savingPw}>
              {savingPw ? 'جاري التحديث...' : 'تحديث كلمة المرور'}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
};
