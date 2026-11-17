export type UserRole = 'OWNER' | 'AGENT';

export interface AuthUser {
  id: string;
  username: string;
  fullName: string;
  role: UserRole;
  phone: string;
  branchName: string;
  assignedShift?: string;
  avatarUrl?: string;
  permissions?: string[];
}

export type OwnerNavKey =
  | 'dashboard'
  | 'suppliers'
  | 'supplier-profile'
  | 'inventory'
  | 'production'
  | 'sales'
  | 'agents-shifts'
  | 'cash-expenses'
  | 'customers'
  | 'employees'
  | 'reports'
  | 'audit-notifications'
  | 'settings';

export type AgentNavKey =
  | 'agent-dashboard'
  | 'agent-production'
  | 'agent-sales'
  | 'agent-expenses'
  | 'agent-shift'
  | 'agent-history';

export type MeasurementUnit = 'جوال' | 'كجم' | 'جرام' | 'لتر' | 'قطعة';

export interface Supplier {
  id: string;
  name: string;
  code: string;
  phone: string;
  address: string;
  categories: string[];
  totalPurchases: number;
  totalPayments: number;
  adjustments: number;
  status: 'نشط' | 'موقوف';
  lastTransactionDate: string;
  notes?: string;
}

export interface PurchaseInvoiceItem {
  inventoryItemId: string;
  itemName: string;
  quantity: number;
  unit: MeasurementUnit;
  unitPrice: number;
  total: number;
  batchCode?: string;
  expiryDate?: string;
}

export interface PurchaseInvoice {
  id: string;
  invoiceNumber: string;
  supplierId: string;
  supplierName: string;
  date: string;
  items: PurchaseInvoiceItem[];
  totalAmount: number;
  initialPayment: number;
  initialPaymentMethod?: 'نقداً' | 'تحويل بنكي (بنكك)' | 'شيك';
  paidAmount: number;
  remainingBalance: number;
  status: 'مدفوعة بالكامل' | 'مدفوعة جزئياً' | 'آجلة' | 'مسودة' | 'ملغاة';
  workflowStatus?: 'مسودة' | 'مرحّلة' | 'ملغاة';
  cancelledReason?: string;
  notes?: string;
  createdBy: string;
}

export interface SupplierPayment {
  id: string;
  reference: string;
  supplierId: string;
  invoiceId?: string;
  invoiceNumber?: string;
  date: string;
  amount: number;
  method: 'نقداً' | 'تحويل بنكي (بنكك)' | 'شيك';
  notes?: string;
  recordedBy: string;
  isReversal?: boolean;
}

export interface InventoryItem {
  id: string;
  sku: string;
  name: string;
  category: 'دقيق' | 'زيوت ودهون' | 'إضافات وخمائر' | 'تغليف' | 'وقود ومستهلكات' | 'مواد أخرى';
  unit: MeasurementUnit;
  availableQuantity: number;
  averageCost: number;
  minimumStock: number;
  primarySupplierId: string;
  primarySupplierName: string;
  batchCode: string;
  expiryDate?: string;
  lastUpdated: string;
}

export interface InventoryBatch {
  id: string;
  inventoryItemId: string;
  itemName: string;
  unit: MeasurementUnit;
  batchCode: string;
  quantityRemaining: number;
  unitCost: number;
  expiryDate?: string;
  receivedDate: string;
}

export interface StockMovement {
  id: string;
  reference: string;
  inventoryItemId: string;
  itemName: string;
  type:
    | 'استلام مشتريات'
    | 'استهلاك إنتاج'
    | 'تعديل جرد'
    | 'تحويل داخلي'
    | 'مرتجع لمورد'
    | 'مرتجع مخزني'
    | 'إلغاء فاتورة شراء';
  quantityDelta: number;
  unit: MeasurementUnit;
  balanceAfter: number;
  batchCode?: string;
  expiryDate?: string;
  relatedSupplierId?: string;
  date: string;
  performedBy: string;
  notes?: string;
}

export interface RecipeOtherIngredient {
  inventoryItemId: number;
  name: string;
  quantity: number;
  unit: string;
}

export interface RawMaterialOption {
  id: string;
  sku: string;
  name: string;
  unit: MeasurementUnit;
  availableQuantity: number;
}

export interface ProductionRecipe {
  id: string;
  breadType: string;
  expectedYieldLoaves: number;
  unitSellingPrice: number;
  flourBags: number;
  oilLiters: number;
  yeastGrams: number;
  saltGrams: number;
  sugarGrams: number;
  otherIngredients?: RecipeOtherIngredient[];
  isActive?: boolean;
  notes?: string;
}

export interface ProductionRecord {
  id: string;
  reference: string;
  date: string;
  shiftId?: string;
  shiftName: string;
  agentId: string;
  agentName: string;
  recipeId: string;
  breadType: string;
  flourConsumedBags: number;
  oilConsumedLiters: number;
  yeastConsumedGrams: number;
  saltConsumedGrams: number;
  sugarConsumedGrams: number;
  otherIngredientsSummary?: string;
  producedLoaves: number;
  damagedLoaves: number;
  notes?: string;
}

export interface SaleRecord {
  id: string;
  reference: string;
  date: string;
  shiftId?: string;
  shiftName: string;
  agentId: string;
  agentName: string;
  breadType: string;
  quantity: number;
  returnedQuantity: number;
  unitPrice: number;
  totalAmount: number;
  paymentType: 'نقدي' | 'آجل';
  customerId?: string;
  customerName?: string;
  notes?: string;
}

export interface BreadMovementRecord {
  id: string;
  reference: string;
  date: string;
  shiftId?: string;
  shiftName: string;
  agentId: string;
  agentName: string;
  breadType: string;
  type: 'مرتجع' | 'تالف' | 'تعديل معتمد';
  quantity: number;
  reason: string;
}

export type PaymentMethod = 'نقداً' | 'تحويل بنكي (بنكك)' | 'شيك';

export type ExpenseCategory =
  | 'كهرباء'
  | 'مياه'
  | 'ترحيل ومواصلات'
  | 'وقود وغاز'
  | 'صيانة'
  | 'إيجار'
  | 'رواتب وأجور'
  | 'أجور عمال'
  | 'مصروفات تشغيلية أخرى';

export interface ExpenseRecord {
  id: string;
  reference: string;
  date: string;
  category: ExpenseCategory | string;
  amount: number;
  description: string;
  paymentMethod?: PaymentMethod | string;
  responsibleUser: string;
  shiftId?: string;
  attachmentName?: string;
  attachmentData?: string;
  status?: 'مرحّل' | 'معكوس' | string;
  isReversal?: boolean;
  reversedExpenseId?: string;
}

export interface CashTransactionRecord {
  id: string;
  reference: string;
  type: string;
  category: string;
  direction: 'IN' | 'OUT';
  amount: number;
  date: string;
  paymentMethod: PaymentMethod | string;
  relatedEntity: string;
  notes?: string;
  recordedBy: string;
  isReversal?: boolean;
}

export interface Customer {
  id: string;
  name: string;
  phone: string;
  address: string;
  creditLimit: number;
  totalCreditSales: number;
  totalPayments: number;
  adjustments: number;
  outstandingBalance: number;
  status?: 'نشط' | 'موقوف' | string;
  notes?: string;
  lastActivityDate: string;
}

export interface CustomerPaymentRecord {
  id: string;
  reference: string;
  customerId: string;
  amount: number;
  date: string;
  method: PaymentMethod | string;
  notes?: string;
  recordedBy: string;
  isReversal?: boolean;
}

export interface CustomerAdjustmentRecord {
  id: string;
  reference: string;
  customerId: string;
  amount: number;
  date: string;
  reason: string;
  recordedBy: string;
}

export interface CustomerStatementEntry {
  id: string;
  date: string;
  type: string;
  reference: string;
  description: string;
  debit: number;
  credit: number;
  runningBalance: number;
}

export interface CustomerProfileData {
  customer: Customer;
  creditSales: {
    id: string;
    reference: string;
    date: string;
    breadType: string;
    quantity: number;
    unitPrice: number;
    totalAmount: number;
    agentName: string;
  }[];
  payments: CustomerPaymentRecord[];
  adjustmentsList: CustomerAdjustmentRecord[];
  statement: CustomerStatementEntry[];
}

export interface AgentProfile {
  id: string;
  fullName: string;
  username: string;
  phone: string;
  avatarUrl?: string;
  assignedShift: 'الوردية الصباحية' | 'الوردية المسائية' | 'الوردية الليلية';
  status: 'نشط' | 'موقوف';
  permissions: string[];
  todayProduction: number;
  totalProduction?: number;
  totalDamaged?: number;
  todaySales: number;
  totalSales?: number;
  cashSales?: number;
  creditSales?: number;
  shiftsCount?: number;
  openShiftsCount?: number;
  closedShiftsCount?: number;
  totalCashDifference?: number;
  cashAccuracyRate: number;
}

export interface ShiftRecord {
  id: string;
  shiftName: 'الوردية الصباحية' | 'الوردية المسائية' | 'الوردية الليلية';
  date: string;
  agentId: string;
  agentName: string;
  status: 'مفتوحة' | 'مغلقة بانتظار المراجعة' | 'معتمدة';
  openingCash: number;
  openingBread: number;
  producedBread: number;
  returnedBread: number;
  soldBread: number;
  damagedBread: number;
  authorizedAdjustments?: number;
  cashSalesAmount: number;
  creditSalesAmount: number;
  totalExpenses: number;
  expectedCash: number;
  actualCash?: number;
  cashDifference?: number;
  closingBread?: number;
  handoverNotes?: string;
  openedAt?: string;
  closedAt?: string;
}

export interface ShiftHandoverRecord {
  id: string;
  shiftId: string;
  shiftName: string;
  shiftDate: string;
  fromAgentId: string;
  agentName: string;
  expectedCash: number;
  handedCash: number;
  cashDifference: number;
  expectedBread: number;
  handedBread: number;
  breadDifference: number;
  receivedByName: string;
  notes?: string;
  approvedByOwner: boolean;
  approvedByName?: string;
  handedAt: string;
  approvedAt?: string;
}

export interface ShiftFinalReport {
  shift: ShiftRecord;
  breadReconciliation: {
    openingBread: number;
    producedBread: number;
    returnedBread: number;
    availableBread: number;
    soldBread: number;
    damagedBread: number;
    authorizedAdjustments: number;
    expectedClosingBread: number;
    actualClosingBread: number;
    breadDifference: number;
  };
  handover: {
    id: string;
    expectedCash: number;
    handedCash: number;
    cashDifference: number;
    expectedBread: number;
    handedBread: number;
    breadDifference: number;
    receivedByName: string;
    approvedByOwner: boolean;
    approvedByName?: string;
    handedAt: string;
    approvedAt?: string;
    notes?: string;
  } | null;
  productionBatches: {
    id: string;
    reference: string;
    breadType: string;
    producedLoaves: number;
    damagedLoaves: number;
    flourConsumedBags: number;
  }[];
  sales: {
    id: string;
    reference: string;
    breadType: string;
    quantity: number;
    totalAmount: number;
    paymentType: string;
    customerName?: string;
  }[];
  breadMovements: BreadMovementRecord[];
  expenses: {
    id: string;
    reference: string;
    category: string;
    description: string;
    amount: number;
  }[];
}

export interface Employee {
  id: string;
  name: string;
  jobTitle: string;
  phone: string;
  monthlySalary: number;
  shift: string;
  attendanceDays: number;
  paidThisMonth: number;
  status?: 'نشط' | 'موقوف' | string;
  notes?: string;
}

export interface EmployeeAttendanceRecord {
  id: string;
  employeeId: string;
  date: string;
  status: 'حاضر' | 'غائب' | 'إجازة';
  notes?: string;
  recordedBy?: string;
}

export interface PayrollRecord {
  id: string;
  reference: string;
  employeeId: string;
  month: string;
  amountPaid: number;
  paidDate: string;
  paymentMethod: PaymentMethod | string;
  notes?: string;
  recordedBy: string;
  isReversal?: boolean;
}

export interface EmployeeProfileData {
  employee: Employee & { remainingSalary: number };
  attendance: Omit<EmployeeAttendanceRecord, 'employeeId'>[];
  payroll: Omit<PayrollRecord, 'employeeId'>[];
}

export interface AccountingDashboardMetrics {
  salesRevenue: number;
  cashSalesRevenue: number;
  creditSalesRevenue: number;
  customerPaymentsCollected: number;
  cashCollected: number;
  costOfGoodsConsumed: number;
  operatingExpenses: number;
  grossProfit: number;
  netEstimatedProfit: number;
  cashBalance: number;
  periodCashInflows: number;
  periodCashOutflows: number;
  periodNetCashFlow: number;
  outstandingReceivables: number;
  supplierLiabilities: number;
  inventoryValue: number;
  soldBreadLoaves: number;
  producedBreadLoaves: number;
  damagedBreadLoaves: number;
  expenseByCategory: { category: string; amount: number }[];
}

export interface AccountingDashboardResponse {
  period: { dateFrom: string; dateTo: string };
  accountingBasis: {
    basisName: string;
    profitFormula: string;
    cashRule: string;
  };
  metrics: AccountingDashboardMetrics;
  dailySeries: { label: string; date: string; sales: number; expenses: number }[];
  monthlySeries: { label: string; sales: number; expenses: number }[];
}

export interface FinancialReportColumn {
  key: string;
  label: string;
  format?: 'currency' | 'number' | 'text';
}

export interface FinancialReportResponse {
  reportType: string;
  reportTitle: string;
  generatedAt: string;
  accountingBasis: {
    revenueDefinition: string;
    cashCollectedDefinition: string;
    profitDefinition: string;
  };
  columns: FinancialReportColumn[];
  rows: Record<string, string | number>[];
  allRowsForExport: Record<string, string | number>[];
  summary: Record<string, string | number>;
  pagination: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}

export interface SystemNotification {
  id: string;
  ruleCode: string;
  severity: 'تنبيه حرج' | 'تحذير' | 'إشعار تشغيلي';
  title: string;
  message: string;
  timestamp: string;
  isRead: boolean;
  targetNav?: OwnerNavKey;
}

export interface AuditLogEntry {
  id: string;
  reference: string;
  userId: string;
  userName: string;
  role: UserRole;
  operationType: string;
  affectedRecord: string;
  previousValue?: string;
  newValue: string;
  timestamp: string;
}

export interface OfflineQueuedAction {
  id: string;
  clientTxId: string;
  actionType: 'إنتاج' | 'بيع' | 'مصروف';
  summary: string;
  createdAt: string;
  syncStatus: 'في الانتظار' | 'تمت المزامنة' | 'تعارض يتطلب مراجعة';
}

export interface BakerySettings {
  bakeryName: string;
  city: string;
  address: string;
  phone: string;
  currencySymbol: string;
  allowNegativeInventory: boolean;
  standardLoafPrice: number;
}
