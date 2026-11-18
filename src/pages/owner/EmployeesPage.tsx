import React, { useMemo, useState } from 'react';
import {
  RotateCcw,
  FileText,
  UserPlus,
  Edit3,
  CalendarCheck,
  Banknote,
} from 'lucide-react';
import { useSbms } from '../../context/SbmsContext';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Input, Select } from '../../components/ui/FormControls';
import { Modal } from '../../components/ui/Modal';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { StatusText } from '../../components/ui/StatusText';
import { formatCurrency, formatNumber } from '../../lib/utils';
import {
  Employee,
  EmployeeProfileData,
  PaymentMethod,
} from '../../types/sbms';
import { PAYMENT_METHODS } from './accountingConstants';

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
