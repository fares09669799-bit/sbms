import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { signInWithPopup } from 'firebase/auth';
import {
  AgentProfile,
  AuditLogEntry,
  AuthUser,
  BakerySettings,
  BreadMovementRecord,
  CashTransactionRecord,
  Customer,
  CustomerAdjustmentRecord,
  CustomerPaymentRecord,
  CustomerProfileData,
  Employee,
  EmployeeAttendanceRecord,
  EmployeeProfileData,
  ExpenseRecord,
  InventoryBatch,
  InventoryItem,
  OfflineQueuedAction,
  PaymentMethod,
  PayrollRecord,
  ProductionRecipe,
  ProductionRecord,
  PurchaseInvoice,
  RawMaterialOption,
  RecipeOtherIngredient,
  SaleRecord,
  ShiftFinalReport,
  ShiftHandoverRecord,
  ShiftRecord,
  StockMovement,
  Supplier,
  SupplierPayment,
  SystemNotification,
} from '../types/sbms';
import { DEMO_BAKERY_SETTINGS } from '../data/demoData';
import {
  apiRequest,
  clearAuthTokens,
  getStoredRefreshToken,
  setAuthTokens,
} from '../lib/apiClient';
import { auth, googleAuthProvider } from '../lib/firebase';

interface BootstrapPayload {
  settings: BakerySettings | null;
  suppliers: Supplier[];
  invoices: PurchaseInvoice[];
  payments: SupplierPayment[];
  inventory: InventoryItem[];
  rawMaterials: RawMaterialOption[];
  batches: InventoryBatch[];
  movements: StockMovement[];
  recipes: ProductionRecipe[];
  productionRecords: ProductionRecord[];
  sales: SaleRecord[];
  breadMovements: BreadMovementRecord[];
  expenses: ExpenseRecord[];
  customers: Customer[];
  agents: AgentProfile[];
  shifts: ShiftRecord[];
  handovers: ShiftHandoverRecord[];
  employees: Employee[];
  cashTransactions: CashTransactionRecord[];
  customerPayments: CustomerPaymentRecord[];
  customerAdjustments: CustomerAdjustmentRecord[];
  payrollRecords: PayrollRecord[];
  employeeAttendance: EmployeeAttendanceRecord[];
  notifications: SystemNotification[];
  auditLogs: AuditLogEntry[];
}

interface ActionResult {
  ok: boolean;
  error?: string;
  reference?: string;
  invoiceNumber?: string;
  report?: ShiftFinalReport;
}

interface SbmsContextValue {
  user: AuthUser | null;
  isBootstrapping: boolean;
  dataError: string | null;
  login: (username: string, password: string, remember: boolean) => Promise<ActionResult>;
  loginWithGoogle: () => Promise<ActionResult>;
  logout: () => Promise<void>;
  changePassword: (currentPassword: string, newPassword: string) => Promise<ActionResult>;
  refreshWorkspace: () => Promise<void>;
  settings: BakerySettings;
  updateSettings: (next: Partial<BakerySettings>) => Promise<ActionResult>;
  suppliers: Supplier[];
  addSupplier: (
    sup: Omit<Supplier, 'id' | 'totalPurchases' | 'totalPayments' | 'adjustments' | 'lastTransactionDate'>
  ) => Promise<ActionResult>;
  updateSupplier: (id: string, data: Partial<Supplier>) => Promise<ActionResult>;
  invoices: PurchaseInvoice[];
  createPurchaseInvoice: (payload: {
    supplierId: string;
    invoiceNumber?: string;
    date: string;
    workflowStatus?: 'مسودة' | 'مرحّلة';
    items: {
      inventoryItemId: string;
      quantity: number;
      unit?: string;
      unitPrice: number;
      batchCode?: string;
      expiryDate?: string;
    }[];
    initialPayment: number;
    initialPaymentMethod?: 'نقداً' | 'تحويل بنكي (بنكك)' | 'شيك';
    notes?: string;
    clientTxId?: string;
  }) => Promise<ActionResult>;
  postPurchaseInvoice: (invoiceId: string) => Promise<ActionResult>;
  cancelPurchaseInvoice: (invoiceId: string, reason: string) => Promise<ActionResult>;
  payments: SupplierPayment[];
  recordSupplierPayment: (payload: {
    supplierId: string;
    invoiceId?: string;
    date: string;
    amount: number;
    method: 'نقداً' | 'تحويل بنكي (بنكك)' | 'شيك';
    notes?: string;
    clientTxId?: string;
  }) => Promise<ActionResult>;
  reverseSupplierPayment: (paymentId: string, reason: string) => Promise<ActionResult>;
  inventory: InventoryItem[];
  batches: InventoryBatch[];
  movements: StockMovement[];
  adjustInventory: (payload: {
    inventoryItemId: string;
    type:
      | 'استلام مشتريات'
      | 'استهلاك إنتاج'
      | 'تعديل جرد'
      | 'تحويل داخلي'
      | 'مرتجع لمورد'
      | 'مرتجع مخزني';
    quantityDelta: number;
    unit?: string;
    batchCode?: string;
    expiryDate?: string;
    supplierId?: string;
    adjustSupplierBalance?: boolean;
    notes?: string;
    clientTxId?: string;
  }) => Promise<ActionResult>;
  addInventoryItem: (payload: {
    sku: string;
    name: string;
    category: string;
    unit: string;
    minimumStock: number;
    averageCost: number;
    primarySupplierId?: string;
    expiryDate?: string;
  }) => Promise<ActionResult>;
  updateInventoryItem: (
    itemId: string,
    payload: {
      name?: string;
      category?: string;
      minimumStock?: number;
      primarySupplierId?: string | null;
      expiryDate?: string | null;
    }
  ) => Promise<ActionResult>;
  rawMaterials: RawMaterialOption[];
  recipes: ProductionRecipe[];
  createRecipe: (payload: {
    breadType: string;
    expectedYieldLoaves: number;
    unitSellingPrice: number;
    flourBags: number;
    oilLiters: number;
    yeastGrams: number;
    saltGrams: number;
    sugarGrams: number;
    otherIngredients?: RecipeOtherIngredient[];
    notes?: string;
  }) => Promise<ActionResult>;
  updateRecipe: (recipe: ProductionRecipe) => Promise<ActionResult>;
  toggleRecipeStatus: (recipeId: string) => Promise<ActionResult>;
  productionRecords: ProductionRecord[];
  registerProduction: (payload: {
    date?: string;
    shiftId?: string;
    recipeId: string;
    shiftName: string;
    flourBags: number;
    oilLiters: number;
    yeastGrams: number;
    saltGrams: number;
    sugarGrams: number;
    otherIngredients?: { inventoryItemId: number; quantity: number }[];
    producedLoaves: number;
    damagedLoaves: number;
    notes?: string;
    clientTxId?: string;
  }) => Promise<ActionResult>;
  sales: SaleRecord[];
  registerSale: (payload: {
    date?: string;
    shiftId?: string;
    shiftName: string;
    breadType: string;
    quantity: number;
    returnedQuantity: number;
    unitPrice: number;
    paymentType: 'نقدي' | 'آجل';
    customerId?: string;
    notes?: string;
    clientTxId?: string;
  }) => Promise<ActionResult>;
  breadMovements: BreadMovementRecord[];
  registerBreadMovement: (payload: {
    date?: string;
    shiftId?: string;
    shiftName?: string;
    breadType: string;
    type: 'مرتجع' | 'تالف' | 'تعديل معتمد';
    quantity: number;
    reason: string;
    clientTxId?: string;
  }) => Promise<ActionResult>;
  expenses: ExpenseRecord[];
  addExpense: (
    payload: Omit<ExpenseRecord, 'id' | 'reference' | 'responsibleUser'> & { clientTxId?: string }
  ) => Promise<ActionResult>;
  reverseExpense: (expenseId: string, reason: string) => Promise<ActionResult>;
  cashTransactions: CashTransactionRecord[];
  createCashTransaction: (payload: {
    type: 'إيداع نقدي' | 'سحب نقدي';
    amount: number;
    date?: string;
    paymentMethod: PaymentMethod;
    relatedEntity: string;
    notes?: string;
    clientTxId?: string;
  }) => Promise<ActionResult>;
  reverseCashTransaction: (txId: string, reason: string) => Promise<ActionResult>;
  customers: Customer[];
  customerPayments: CustomerPaymentRecord[];
  customerAdjustments: CustomerAdjustmentRecord[];
  addCustomer: (payload: {
    name: string;
    phone: string;
    address: string;
    creditLimit: number;
    notes?: string;
  }) => Promise<ActionResult>;
  updateCustomer: (
    customerId: string,
    payload: Partial<{
      name: string;
      phone: string;
      address: string;
      creditLimit: number;
      status: 'نشط' | 'موقوف';
      notes: string;
    }>
  ) => Promise<ActionResult>;
  fetchCustomerProfile: (customerId: string) => Promise<CustomerProfileData | null>;
  recordCustomerPayment: (
    customerId: string,
    amount: number,
    options?: { date?: string; method?: PaymentMethod; notes?: string; clientTxId?: string }
  ) => Promise<ActionResult>;
  reverseCustomerPayment: (paymentId: string, reason: string) => Promise<ActionResult>;
  recordCustomerAdjustment: (
    customerId: string,
    payload: { amount: number; date?: string; reason: string }
  ) => Promise<ActionResult>;
  agents: AgentProfile[];
  toggleAgentStatus: (agentId: string) => Promise<ActionResult>;
  addAgent: (
    agent: Omit<AgentProfile, 'id' | 'todayProduction' | 'todaySales' | 'cashAccuracyRate'> & {
      password?: string;
    }
  ) => Promise<ActionResult>;
  updateAgent: (
    agentId: string,
    payload: {
      fullName?: string;
      phone?: string;
      assignedShift?: 'الوردية الصباحية' | 'الوردية المسائية' | 'الوردية الليلية';
      password?: string;
      avatarUrl?: string | null;
      permissions?: string[];
      isActive?: boolean;
    }
  ) => Promise<ActionResult>;
  shifts: ShiftRecord[];
  handovers: ShiftHandoverRecord[];
  openAgentShift: (
    openingCash: number,
    openingBread: number,
    shiftName?: 'الوردية الصباحية' | 'الوردية المسائية' | 'الوردية الليلية',
    date?: string
  ) => Promise<ActionResult>;
  closeAgentShift: (
    shiftId: string,
    actualCash: number,
    closingBread: number,
    notes: string,
    receivedByName?: string
  ) => Promise<{ ok: boolean; error?: string; report?: unknown }>;
  fetchShiftReport: (shiftId: string) => Promise<ShiftFinalReport | null>;
  approveShift: (shiftId: string, receivedByName?: string, notes?: string) => Promise<ActionResult>;
  confirmHandover: (handoverId: string, receivedByName?: string, notes?: string) => Promise<ActionResult>;
  employees: Employee[];
  employeeAttendance: EmployeeAttendanceRecord[];
  payrollRecords: PayrollRecord[];
  addEmployee: (payload: {
    name: string;
    jobTitle: string;
    phone: string;
    monthlySalary: number;
    shift: 'الوردية الصباحية' | 'الوردية المسائية' | 'الوردية الليلية';
    notes?: string;
  }) => Promise<ActionResult>;
  updateEmployee: (
    employeeId: string,
    payload: Partial<{
      name: string;
      jobTitle: string;
      phone: string;
      monthlySalary: number;
      shift: 'الوردية الصباحية' | 'الوردية المسائية' | 'الوردية الليلية';
      status: 'نشط' | 'موقوف';
      notes: string;
    }>
  ) => Promise<ActionResult>;
  fetchEmployeeProfile: (employeeId: string) => Promise<EmployeeProfileData | null>;
  recordEmployeeAttendance: (
    employeeId: string,
    payload: { date: string; status: 'حاضر' | 'غائب' | 'إجازة'; notes?: string }
  ) => Promise<ActionResult>;
  recordEmployeePayroll: (
    employeeId: string,
    payload: {
      month: string;
      amountPaid: number;
      paidDate?: string;
      paymentMethod: PaymentMethod;
      notes?: string;
      clientTxId?: string;
    }
  ) => Promise<ActionResult>;
  reverseEmployeePayroll: (payrollId: string, reason: string) => Promise<ActionResult>;
  notifications: SystemNotification[];
  markAllNotificationsRead: () => Promise<void>;
  auditLogs: AuditLogEntry[];
  isOfflineMode: boolean;
  setIsOfflineMode: (val: boolean) => void;
  offlineQueue: OfflineQueuedAction[];
  syncOfflineQueue: () => Promise<void>;
}

const SbmsContext = createContext<SbmsContextValue | null>(null);

const OFFLINE_QUEUE_KEY = 'sbms_offline_queue_v1';

export const SbmsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isBootstrapping, setIsBootstrapping] = useState<boolean>(true);
  const [dataError, setDataError] = useState<string | null>(null);

  const [settings, setSettings] = useState<BakerySettings>(DEMO_BAKERY_SETTINGS);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [invoices, setInvoices] = useState<PurchaseInvoice[]>([]);
  const [payments, setPayments] = useState<SupplierPayment[]>([]);
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [rawMaterials, setRawMaterials] = useState<RawMaterialOption[]>([]);
  const [batches, setBatches] = useState<InventoryBatch[]>([]);
  const [movements, setMovements] = useState<StockMovement[]>([]);
  const [recipes, setRecipes] = useState<ProductionRecipe[]>([]);
  const [productionRecords, setProductionRecords] = useState<ProductionRecord[]>([]);
  const [sales, setSales] = useState<SaleRecord[]>([]);
  const [breadMovements, setBreadMovements] = useState<BreadMovementRecord[]>([]);
  const [expenses, setExpenses] = useState<ExpenseRecord[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [agents, setAgents] = useState<AgentProfile[]>([]);
  const [shifts, setShifts] = useState<ShiftRecord[]>([]);
  const [handovers, setHandovers] = useState<ShiftHandoverRecord[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [cashTransactions, setCashTransactions] = useState<CashTransactionRecord[]>([]);
  const [customerPayments, setCustomerPayments] = useState<CustomerPaymentRecord[]>([]);
  const [customerAdjustments, setCustomerAdjustments] = useState<CustomerAdjustmentRecord[]>([]);
  const [payrollRecords, setPayrollRecords] = useState<PayrollRecord[]>([]);
  const [employeeAttendance, setEmployeeAttendance] = useState<EmployeeAttendanceRecord[]>([]);
  const [notifications, setNotifications] = useState<SystemNotification[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([]);

  const [isOfflineMode, setIsOfflineMode] = useState<boolean>(false);
  const [offlineQueue, setOfflineQueue] = useState<OfflineQueuedAction[]>(() => {
    try {
      const saved = localStorage.getItem(OFFLINE_QUEUE_KEY);
      return saved ? (JSON.parse(saved) as OfflineQueuedAction[]) : [];
    } catch {
      return [];
    }
  });

  const persistOfflineQueue = (next: OfflineQueuedAction[]) => {
    setOfflineQueue(next);
    try {
      localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(next));
    } catch {
      // ignore
    }
  };

  const refreshWorkspace = useCallback(async () => {
    setDataError(null);
    const res = await apiRequest<BootstrapPayload>('/api/workspace/bootstrap');
    if (!res.ok || !res.data) {
      setDataError(res.error || 'تعذر تحميل البيانات من الخادم.');
      return;
    }
    const d = res.data;
    if (d.settings) setSettings(d.settings);
    setSuppliers(d.suppliers);
    setInvoices(d.invoices);
    setPayments(d.payments);
    setInventory(d.inventory);
    setRawMaterials(d.rawMaterials || []);
    setBatches(d.batches || []);
    setMovements(d.movements);
    setRecipes(d.recipes);
    setProductionRecords(d.productionRecords);
    setSales(d.sales);
    setBreadMovements(d.breadMovements || []);
    setExpenses(d.expenses);
    setCustomers(d.customers);
    setAgents(d.agents);
    setShifts(d.shifts);
    setHandovers(d.handovers || []);
    setEmployees(d.employees);
    setCashTransactions(d.cashTransactions || []);
    setCustomerPayments(d.customerPayments || []);
    setCustomerAdjustments(d.customerAdjustments || []);
    setPayrollRecords(d.payrollRecords || []);
    setEmployeeAttendance(d.employeeAttendance || []);
    setNotifications(d.notifications);
    setAuditLogs(d.auditLogs);
  }, []);

  // Restore session on reload if refresh token exists
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        if (getStoredRefreshToken()) {
          const meRes = await apiRequest<{ user: AuthUser }>('/api/auth/me');
          if (active && meRes.ok && meRes.data?.user) {
            setUser(meRes.data.user);
            await refreshWorkspace();
          } else {
            clearAuthTokens();
          }
        }
      } finally {
        if (active) setIsBootstrapping(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [refreshWorkspace]);

  const login = async (username: string, password: string, remember: boolean): Promise<ActionResult> => {
    const res = await apiRequest<{
      accessToken: string;
      refreshToken: string;
      user: AuthUser;
    }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });

    if (!res.ok || !res.data) {
      return { ok: false, error: res.error || 'فشل تسجيل الدخول.' };
    }

    setAuthTokens(res.data.accessToken, res.data.refreshToken, remember);
    setUser(res.data.user);
    await refreshWorkspace();
    return { ok: true };
  };

  const loginWithGoogle = async (): Promise<ActionResult> => {
    try {
      const cred = await signInWithPopup(auth, googleAuthProvider);
      const idToken = await cred.user.getIdToken();
      const res = await apiRequest<{
        accessToken: string;
        refreshToken: string;
        user: AuthUser;
      }>('/api/auth/firebase-sync', {
        method: 'POST',
        body: JSON.stringify({ idToken }),
      });

      if (!res.ok || !res.data) {
        return { ok: false, error: res.error || 'تعذر تسجيل الدخول بحساب Google.' };
      }

      setAuthTokens(res.data.accessToken, res.data.refreshToken, true);
      setUser(res.data.user);
      await refreshWorkspace();
      return { ok: true };
    } catch {
      return { ok: false, error: 'تم إلغاء تسجيل الدخول عبر Google أو تعذر إتمامه.' };
    }
  };

  const logout = async () => {
    const rt = getStoredRefreshToken();
    await apiRequest('/api/auth/logout', {
      method: 'POST',
      body: JSON.stringify({ refreshToken: rt }),
    });
    clearAuthTokens();
    setUser(null);
  };

  const changePassword = async (currentPassword: string, newPassword: string): Promise<ActionResult> => {
    const res = await apiRequest('/api/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({ currentPassword, newPassword }),
    });
    return { ok: res.ok, error: res.error };
  };

  const updateSettings = async (next: Partial<BakerySettings>): Promise<ActionResult> => {
    const res = await apiRequest('/api/settings', {
      method: 'PATCH',
      body: JSON.stringify(next),
    });
    if (res.ok) await refreshWorkspace();
    return { ok: res.ok, error: res.error };
  };

  const addSupplier: SbmsContextValue['addSupplier'] = async (sup) => {
    const res = await apiRequest('/api/suppliers', {
      method: 'POST',
      body: JSON.stringify(sup),
    });
    if (res.ok) await refreshWorkspace();
    return { ok: res.ok, error: res.error };
  };

  const updateSupplier: SbmsContextValue['updateSupplier'] = async (id, data) => {
    const res = await apiRequest(`/api/suppliers/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
    if (res.ok) await refreshWorkspace();
    return { ok: res.ok, error: res.error };
  };

  const createPurchaseInvoice: SbmsContextValue['createPurchaseInvoice'] = async (payload) => {
    const clientTxId =
      payload.clientTxId || `INV-TX-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
    const res = await apiRequest<{ invoiceId: string; invoiceNumber: string }>(
      '/api/suppliers/invoices',
      {
        method: 'POST',
        body: JSON.stringify({ ...payload, clientTxId }),
      }
    );
    if (res.ok) await refreshWorkspace();
    return {
      ok: res.ok,
      error: res.error,
      invoiceNumber: res.data?.invoiceNumber,
    };
  };

  const postPurchaseInvoice = async (invoiceId: string): Promise<ActionResult> => {
    const res = await apiRequest(`/api/suppliers/invoices/${invoiceId}/post`, {
      method: 'POST',
    });
    if (res.ok) await refreshWorkspace();
    return { ok: res.ok, error: res.error };
  };

  const cancelPurchaseInvoice = async (
    invoiceId: string,
    reason: string
  ): Promise<ActionResult> => {
    const res = await apiRequest(`/api/suppliers/invoices/${invoiceId}/cancel`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    });
    if (res.ok) await refreshWorkspace();
    return { ok: res.ok, error: res.error };
  };

  const recordSupplierPayment: SbmsContextValue['recordSupplierPayment'] = async (payload) => {
    const clientTxId =
      payload.clientTxId || `PAY-TX-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
    const res = await apiRequest<{ paymentId: string; reference: string }>(
      `/api/suppliers/${payload.supplierId}/payments`,
      {
        method: 'POST',
        body: JSON.stringify({
          invoiceId: payload.invoiceId,
          date: payload.date,
          amount: payload.amount,
          method: payload.method,
          notes: payload.notes,
          clientTxId,
        }),
      }
    );
    if (res.ok) await refreshWorkspace();
    return { ok: res.ok, error: res.error, reference: res.data?.reference };
  };

  const reverseSupplierPayment = async (paymentId: string, reason: string): Promise<ActionResult> => {
    const res = await apiRequest(`/api/suppliers/payments/${paymentId}/reverse`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    });
    if (res.ok) await refreshWorkspace();
    return { ok: res.ok, error: res.error };
  };

  const adjustInventory: SbmsContextValue['adjustInventory'] = async (payload) => {
    const clientTxId =
      payload.clientTxId || `STK-TX-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
    const res = await apiRequest<{ reference: string }>('/api/inventory/movements', {
      method: 'POST',
      body: JSON.stringify({ ...payload, clientTxId }),
    });
    if (res.ok) await refreshWorkspace();
    return { ok: res.ok, error: res.error, reference: res.data?.reference };
  };

  const addInventoryItem: SbmsContextValue['addInventoryItem'] = async (payload) => {
    const res = await apiRequest('/api/inventory/items', {
      method: 'POST',
      body: JSON.stringify({
        ...payload,
        primarySupplierId: payload.primarySupplierId ? Number(payload.primarySupplierId) : undefined,
      }),
    });
    if (res.ok) await refreshWorkspace();
    return { ok: res.ok, error: res.error };
  };

  const updateInventoryItem: SbmsContextValue['updateInventoryItem'] = async (itemId, payload) => {
    const res = await apiRequest(`/api/inventory/items/${itemId}`, {
      method: 'PATCH',
      body: JSON.stringify({
        ...payload,
        primarySupplierId:
          payload.primarySupplierId === null
            ? null
            : payload.primarySupplierId
            ? Number(payload.primarySupplierId)
            : undefined,
      }),
    });
    if (res.ok) await refreshWorkspace();
    return { ok: res.ok, error: res.error };
  };

  const createRecipe: SbmsContextValue['createRecipe'] = async (payload) => {
    const res = await apiRequest('/api/recipes', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    if (res.ok) await refreshWorkspace();
    return { ok: res.ok, error: res.error };
  };

  const updateRecipe = async (recipe: ProductionRecipe): Promise<ActionResult> => {
    const res = await apiRequest(`/api/recipes/${recipe.id}`, {
      method: 'PUT',
      body: JSON.stringify(recipe),
    });
    if (res.ok) await refreshWorkspace();
    return { ok: res.ok, error: res.error };
  };

  const toggleRecipeStatus = async (recipeId: string): Promise<ActionResult> => {
    const res = await apiRequest(`/api/recipes/${recipeId}/toggle`, {
      method: 'PATCH',
    });
    if (res.ok) await refreshWorkspace();
    return { ok: res.ok, error: res.error };
  };

  const registerProduction: SbmsContextValue['registerProduction'] = async (payload) => {
    const clientTxId =
      payload.clientTxId || `LOC-PRD-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
    if (isOfflineMode && user?.role === 'AGENT') {
      const next: OfflineQueuedAction[] = [
        {
          id: `off-${Date.now()}`,
          clientTxId,
          actionType: 'إنتاج',
          summary: `إنتاج ${payload.producedLoaves} رغيف (${payload.flourBags} جوال دقيق)`,
          createdAt: new Date().toLocaleTimeString('ar-SD', { hour: '2-digit', minute: '2-digit' }),
          syncStatus: 'في الانتظار',
          payload,
        } as OfflineQueuedAction & { payload?: unknown },
        ...offlineQueue,
      ];
      persistOfflineQueue(next);
      return { ok: true };
    }

    const res = await apiRequest<{ reference: string }>('/api/production', {
      method: 'POST',
      body: JSON.stringify({ ...payload, clientTxId }),
    });
    if (res.ok) await refreshWorkspace();
    return { ok: res.ok, error: res.error, reference: res.data?.reference };
  };

  const registerSale: SbmsContextValue['registerSale'] = async (payload) => {
    const clientTxId =
      payload.clientTxId || `LOC-SAL-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
    if (isOfflineMode && user?.role === 'AGENT') {
      const next: OfflineQueuedAction[] = [
        {
          id: `off-${Date.now()}`,
          clientTxId,
          actionType: 'بيع',
          summary: `بيع ${payload.paymentType} ${payload.quantity} رغيف (${payload.breadType})`,
          createdAt: new Date().toLocaleTimeString('ar-SD', { hour: '2-digit', minute: '2-digit' }),
          syncStatus: 'في الانتظار',
          payload,
        } as OfflineQueuedAction & { payload?: unknown },
        ...offlineQueue,
      ];
      persistOfflineQueue(next);
      return { ok: true };
    }

    const res = await apiRequest<{ reference: string }>('/api/sales', {
      method: 'POST',
      body: JSON.stringify({ ...payload, clientTxId }),
    });
    if (res.ok) await refreshWorkspace();
    return { ok: res.ok, error: res.error, reference: res.data?.reference };
  };

  const registerBreadMovement: SbmsContextValue['registerBreadMovement'] = async (payload) => {
    const clientTxId =
      payload.clientTxId || `BRD-TX-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
    const res = await apiRequest<{ reference: string }>('/api/bread-movements', {
      method: 'POST',
      body: JSON.stringify({ ...payload, clientTxId }),
    });
    if (res.ok) await refreshWorkspace();
    return { ok: res.ok, error: res.error, reference: res.data?.reference };
  };

  const addExpense: SbmsContextValue['addExpense'] = async (payload) => {
    const clientTxId =
      payload.clientTxId || `EXP-TX-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
    const res = await apiRequest<{ reference: string }>('/api/expenses', {
      method: 'POST',
      body: JSON.stringify({ ...payload, clientTxId }),
    });
    if (res.ok) await refreshWorkspace();
    return { ok: res.ok, error: res.error, reference: res.data?.reference };
  };

  const reverseExpense = async (expenseId: string, reason: string): Promise<ActionResult> => {
    const res = await apiRequest<{ reference: string }>(
      `/api/accounting/expenses/${expenseId}/reverse`,
      {
        method: 'POST',
        body: JSON.stringify({ reason }),
      }
    );
    if (res.ok) await refreshWorkspace();
    return { ok: res.ok, error: res.error, reference: res.data?.reference };
  };

  const createCashTransaction: SbmsContextValue['createCashTransaction'] = async (payload) => {
    const clientTxId =
      payload.clientTxId || `CSH-TX-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
    const res = await apiRequest<{ reference: string }>('/api/accounting/cash/transactions', {
      method: 'POST',
      body: JSON.stringify({ ...payload, clientTxId }),
    });
    if (res.ok) await refreshWorkspace();
    return { ok: res.ok, error: res.error, reference: res.data?.reference };
  };

  const reverseCashTransaction = async (txId: string, reason: string): Promise<ActionResult> => {
    const res = await apiRequest<{ reference: string }>(
      `/api/accounting/cash/transactions/${txId}/reverse`,
      {
        method: 'POST',
        body: JSON.stringify({ reason }),
      }
    );
    if (res.ok) await refreshWorkspace();
    return { ok: res.ok, error: res.error, reference: res.data?.reference };
  };

  const addCustomer: SbmsContextValue['addCustomer'] = async (payload) => {
    const res = await apiRequest('/api/accounting/customers', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    if (res.ok) await refreshWorkspace();
    return { ok: res.ok, error: res.error };
  };

  const updateCustomer: SbmsContextValue['updateCustomer'] = async (customerId, payload) => {
    const res = await apiRequest(`/api/accounting/customers/${customerId}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
    if (res.ok) await refreshWorkspace();
    return { ok: res.ok, error: res.error };
  };

  const fetchCustomerProfile = async (
    customerId: string
  ): Promise<CustomerProfileData | null> => {
    const res = await apiRequest<CustomerProfileData>(`/api/accounting/customers/${customerId}`);
    return res.ok && res.data ? res.data : null;
  };

  const recordCustomerPayment: SbmsContextValue['recordCustomerPayment'] = async (
    customerId,
    amount,
    options
  ) => {
    const clientTxId =
      options?.clientTxId || `CPY-TX-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
    const res = await apiRequest<{ reference?: string }>(`/api/customers/${customerId}/payments`, {
      method: 'POST',
      body: JSON.stringify({
        amount,
        date: options?.date,
        method: options?.method || 'نقداً',
        notes: options?.notes,
        clientTxId,
      }),
    });
    if (res.ok) await refreshWorkspace();
    return { ok: res.ok, error: res.error, reference: res.data?.reference };
  };

  const reverseCustomerPayment = async (
    paymentId: string,
    reason: string
  ): Promise<ActionResult> => {
    const res = await apiRequest<{ reference: string }>(
      `/api/accounting/customers/payments/${paymentId}/reverse`,
      {
        method: 'POST',
        body: JSON.stringify({ reason }),
      }
    );
    if (res.ok) await refreshWorkspace();
    return { ok: res.ok, error: res.error, reference: res.data?.reference };
  };

  const recordCustomerAdjustment: SbmsContextValue['recordCustomerAdjustment'] = async (
    customerId,
    payload
  ) => {
    const res = await apiRequest<{ reference: string }>(
      `/api/accounting/customers/${customerId}/adjustments`,
      {
        method: 'POST',
        body: JSON.stringify(payload),
      }
    );
    if (res.ok) await refreshWorkspace();
    return { ok: res.ok, error: res.error, reference: res.data?.reference };
  };

  const addEmployee: SbmsContextValue['addEmployee'] = async (payload) => {
    const res = await apiRequest('/api/accounting/employees', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    if (res.ok) await refreshWorkspace();
    return { ok: res.ok, error: res.error };
  };

  const updateEmployee: SbmsContextValue['updateEmployee'] = async (employeeId, payload) => {
    const res = await apiRequest(`/api/accounting/employees/${employeeId}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
    if (res.ok) await refreshWorkspace();
    return { ok: res.ok, error: res.error };
  };

  const fetchEmployeeProfile = async (
    employeeId: string
  ): Promise<EmployeeProfileData | null> => {
    const res = await apiRequest<EmployeeProfileData>(`/api/accounting/employees/${employeeId}`);
    return res.ok && res.data ? res.data : null;
  };

  const recordEmployeeAttendance: SbmsContextValue['recordEmployeeAttendance'] = async (
    employeeId,
    payload
  ) => {
    const res = await apiRequest(`/api/accounting/employees/${employeeId}/attendance`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    if (res.ok) await refreshWorkspace();
    return { ok: res.ok, error: res.error };
  };

  const recordEmployeePayroll: SbmsContextValue['recordEmployeePayroll'] = async (
    employeeId,
    payload
  ) => {
    const clientTxId =
      payload.clientTxId || `PAYR-TX-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
    const res = await apiRequest<{ reference: string }>(
      `/api/accounting/employees/${employeeId}/payroll`,
      {
        method: 'POST',
        body: JSON.stringify({ ...payload, clientTxId }),
      }
    );
    if (res.ok) await refreshWorkspace();
    return { ok: res.ok, error: res.error, reference: res.data?.reference };
  };

  const reverseEmployeePayroll = async (
    payrollId: string,
    reason: string
  ): Promise<ActionResult> => {
    const res = await apiRequest<{ reference: string }>(
      `/api/accounting/employees/payroll/${payrollId}/reverse`,
      {
        method: 'POST',
        body: JSON.stringify({ reason }),
      }
    );
    if (res.ok) await refreshWorkspace();
    return { ok: res.ok, error: res.error, reference: res.data?.reference };
  };

  const toggleAgentStatus = async (agentId: string): Promise<ActionResult> => {
    const res = await apiRequest(`/api/agents/${agentId}/toggle`, {
      method: 'PATCH',
    });
    if (res.ok) await refreshWorkspace();
    return { ok: res.ok, error: res.error };
  };

  const addAgent: SbmsContextValue['addAgent'] = async (agent) => {
    const res = await apiRequest('/api/agents', {
      method: 'POST',
      body: JSON.stringify(agent),
    });
    if (res.ok) await refreshWorkspace();
    return { ok: res.ok, error: res.error };
  };

  const updateAgent: SbmsContextValue['updateAgent'] = async (agentId, payload) => {
    const res = await apiRequest(`/api/agents/${agentId}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
    if (res.ok) await refreshWorkspace();
    return { ok: res.ok, error: res.error };
  };

  const openAgentShift: SbmsContextValue['openAgentShift'] = async (
    openingCash,
    openingBread,
    shiftName,
    date
  ) => {
    const res = await apiRequest('/api/shifts/open', {
      method: 'POST',
      body: JSON.stringify({ openingCash, openingBread, shiftName, date }),
    });
    if (res.ok) await refreshWorkspace();
    return { ok: res.ok, error: res.error };
  };

  const closeAgentShift: SbmsContextValue['closeAgentShift'] = async (
    shiftId,
    actualCash,
    closingBread,
    notes,
    receivedByName
  ) => {
    const res = await apiRequest<{ report?: ShiftFinalReport }>(`/api/shifts/${shiftId}/close`, {
      method: 'POST',
      body: JSON.stringify({ actualCash, closingBread, notes, receivedByName }),
    });
    if (res.ok) await refreshWorkspace();
    return { ok: res.ok, error: res.error, report: res.data?.report };
  };

  const fetchShiftReport = async (shiftId: string): Promise<ShiftFinalReport | null> => {
    const res = await apiRequest<ShiftFinalReport>(`/api/shifts/${shiftId}/report`);
    return res.ok && res.data ? res.data : null;
  };

  const approveShift = async (
    shiftId: string,
    receivedByName?: string,
    notes?: string
  ): Promise<ActionResult> => {
    const res = await apiRequest(`/api/shifts/${shiftId}/approve`, {
      method: 'POST',
      body: JSON.stringify({ receivedByName, notes }),
    });
    if (res.ok) await refreshWorkspace();
    return { ok: res.ok, error: res.error };
  };

  const confirmHandover = async (
    handoverId: string,
    receivedByName?: string,
    notes?: string
  ): Promise<ActionResult> => {
    const res = await apiRequest(`/api/handovers/${handoverId}/confirm`, {
      method: 'POST',
      body: JSON.stringify({ receivedByName, notes }),
    });
    if (res.ok) await refreshWorkspace();
    return { ok: res.ok, error: res.error };
  };

  const markAllNotificationsRead = async () => {
    const res = await apiRequest('/api/notifications/read-all', { method: 'POST' });
    if (res.ok) await refreshWorkspace();
  };

  const syncOfflineQueue = async () => {
    setIsOfflineMode(false);
    const updated: OfflineQueuedAction[] = [];
    for (const item of offlineQueue) {
      if (item.syncStatus !== 'في الانتظار') {
        updated.push(item);
        continue;
      }
      const rawPayload = (item as OfflineQueuedAction & { payload?: Record<string, unknown> }).payload;
      if (!rawPayload) {
        updated.push({ ...item, syncStatus: 'تمت المزامنة' });
        continue;
      }
      const endpoint = item.actionType === 'إنتاج' ? '/api/production' : '/api/sales';
      const res = await apiRequest(endpoint, {
        method: 'POST',
        body: JSON.stringify({ ...rawPayload, clientTxId: item.clientTxId }),
      });
      if (res.ok || res.status === 409) {
        updated.push({ ...item, syncStatus: 'تمت المزامنة' });
      } else {
        updated.push({ ...item, syncStatus: 'تعارض يتطلب مراجعة' });
      }
    }
    persistOfflineQueue(updated);
    await refreshWorkspace();
  };

  return (
    <SbmsContext.Provider
      value={{
        user,
        isBootstrapping,
        dataError,
        login,
        loginWithGoogle,
        logout,
        changePassword,
        refreshWorkspace,
        settings,
        updateSettings,
        suppliers,
        addSupplier,
        updateSupplier,
        invoices,
        createPurchaseInvoice,
        postPurchaseInvoice,
        cancelPurchaseInvoice,
        payments,
        recordSupplierPayment,
        reverseSupplierPayment,
        inventory,
        rawMaterials,
        batches,
        movements,
        adjustInventory,
        addInventoryItem,
        updateInventoryItem,
        recipes,
        createRecipe,
        updateRecipe,
        toggleRecipeStatus,
        productionRecords,
        registerProduction,
        sales,
        registerSale,
        breadMovements,
        registerBreadMovement,
        expenses,
        addExpense,
        reverseExpense,
        cashTransactions,
        createCashTransaction,
        reverseCashTransaction,
        customers,
        customerPayments,
        customerAdjustments,
        addCustomer,
        updateCustomer,
        fetchCustomerProfile,
        recordCustomerPayment,
        reverseCustomerPayment,
        recordCustomerAdjustment,
        agents,
        toggleAgentStatus,
        addAgent,
        updateAgent,
        shifts,
        handovers,
        openAgentShift,
        closeAgentShift,
        fetchShiftReport,
        approveShift,
        confirmHandover,
        employees,
        employeeAttendance,
        payrollRecords,
        addEmployee,
        updateEmployee,
        fetchEmployeeProfile,
        recordEmployeeAttendance,
        recordEmployeePayroll,
        reverseEmployeePayroll,
        notifications,
        markAllNotificationsRead,
        auditLogs,
        isOfflineMode,
        setIsOfflineMode,
        offlineQueue,
        syncOfflineQueue,
      }}
    >
      {children}
    </SbmsContext.Provider>
  );
};

export function useSbms() {
  const ctx = useContext(SbmsContext);
  if (!ctx) throw new Error('useSbms must be used inside SbmsProvider');
  return ctx;
}
