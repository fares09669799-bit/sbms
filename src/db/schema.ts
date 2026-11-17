import { relations } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

// 1. Roles
export const roles = pgTable('roles', {
  id: serial('id').primaryKey(),
  code: text('code').notNull().unique(), // 'OWNER' | 'AGENT'
  name: text('name').notNull(),
  description: text('description'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// 2. Permissions
export const permissions = pgTable('permissions', {
  id: serial('id').primaryKey(),
  code: text('code').notNull().unique(),
  name: text('name').notNull(),
  module: text('module').notNull(),
  roleCode: text('role_code').notNull(), // 'OWNER' | 'AGENT'
});

// 3. Users (supports both username/password JWT auth and Firebase Auth uid)
export const users = pgTable(
  'users',
  {
    id: serial('id').primaryKey(),
    uid: text('uid').notNull().unique(),
    username: text('username').notNull().unique(),
    email: text('email'),
    passwordHash: text('password_hash'),
    fullName: text('full_name').notNull(),
    phone: text('phone').notNull().default(''),
    roleId: integer('role_id').references(() => roles.id),
    roleCode: text('role_code').notNull().default('AGENT'), // 'OWNER' | 'AGENT'
    branchName: text('branch_name').notNull().default('مخبز النيل الأبيض الآلي — بحري'),
    assignedShift: text('assigned_shift'),
    avatarUrl: text('avatar_url'),
    permissions: jsonb('permissions')
      .$type<string[]>()
      .notNull()
      .default(['PRODUCTION_LOG', 'SALES_LOG', 'EXPENSES_LOG', 'SHIFT_MANAGE']),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    index('idx_users_role_code').on(table.roleCode),
    index('idx_users_active').on(table.isActive),
  ]
);

// Refresh Token Sessions
export const userSessions = pgTable(
  'user_sessions',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    tokenHash: text('token_hash').notNull().unique(),
    expiresAt: timestamp('expires_at').notNull(),
    revoked: boolean('revoked').notNull().default(false),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [index('idx_sessions_user').on(table.userId)]
);

// 4. Suppliers
export const suppliers = pgTable(
  'suppliers',
  {
    id: serial('id').primaryKey(),
    code: text('code').notNull().unique(),
    name: text('name').notNull(),
    phone: text('phone').notNull(),
    address: text('address').notNull().default(''),
    categories: jsonb('categories').$type<string[]>().notNull().default([]),
    totalPurchases: numeric('total_purchases', { precision: 14, scale: 2 }).notNull().default('0.00'),
    totalPayments: numeric('total_payments', { precision: 14, scale: 2 }).notNull().default('0.00'),
    adjustments: numeric('adjustments', { precision: 14, scale: 2 }).notNull().default('0.00'),
    status: text('status').notNull().default('نشط'), // 'نشط' | 'موقوف'
    lastTransactionDate: text('last_transaction_date').notNull().default(''),
    notes: text('notes'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [index('idx_suppliers_status').on(table.status)]
);

// 5. SupplierProducts
export const supplierProducts = pgTable(
  'supplier_products',
  {
    id: serial('id').primaryKey(),
    supplierId: integer('supplier_id')
      .references(() => suppliers.id, { onDelete: 'cascade' })
      .notNull(),
    productName: text('product_name').notNull(),
    unit: text('unit').notNull(),
    lastUnitPrice: numeric('last_unit_price', { precision: 14, scale: 2 }).notNull().default('0.00'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [index('idx_sup_products_supplier').on(table.supplierId)]
);

// 9. InventoryItems (defined before PurchaseInvoiceItems so FK works cleanly)
export const inventoryItems = pgTable(
  'inventory_items',
  {
    id: serial('id').primaryKey(),
    sku: text('sku').notNull().unique(),
    name: text('name').notNull(),
    category: text('category').notNull(),
    unit: text('unit').notNull(),
    availableQuantity: numeric('available_quantity', { precision: 14, scale: 3 })
      .notNull()
      .default('0.000'),
    averageCost: numeric('average_cost', { precision: 14, scale: 2 }).notNull().default('0.00'),
    minimumStock: numeric('minimum_stock', { precision: 14, scale: 3 }).notNull().default('0.000'),
    primarySupplierId: integer('primary_supplier_id').references(() => suppliers.id),
    primarySupplierName: text('primary_supplier_name').notNull().default(''),
    batchCode: text('batch_code').notNull().default(''),
    expiryDate: text('expiry_date'),
    lastUpdated: text('last_updated').notNull().default(''),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [index('idx_inventory_category').on(table.category)]
);

// 6. PurchaseInvoices
export const purchaseInvoices = pgTable(
  'purchase_invoices',
  {
    id: serial('id').primaryKey(),
    invoiceNumber: text('invoice_number').notNull().unique(),
    reference: text('reference').notNull().unique(),
    clientTxId: text('client_tx_id'),
    supplierId: integer('supplier_id')
      .references(() => suppliers.id)
      .notNull(),
    date: text('date').notNull(),
    totalAmount: numeric('total_amount', { precision: 14, scale: 2 }).notNull(),
    initialPayment: numeric('initial_payment', { precision: 14, scale: 2 }).notNull().default('0.00'),
    initialPaymentMethod: text('initial_payment_method').notNull().default('نقداً'),
    paidAmount: numeric('paid_amount', { precision: 14, scale: 2 }).notNull().default('0.00'),
    remainingBalance: numeric('remaining_balance', { precision: 14, scale: 2 }).notNull(),
    status: text('status').notNull(), // 'مدفوعة بالكامل' | 'مدفوعة جزئياً' | 'آجلة' | 'مسودة' | 'ملغاة'
    workflowStatus: text('workflow_status').notNull().default('مرحّلة'), // 'مسودة' | 'مرحّلة' | 'ملغاة'
    notes: text('notes'),
    postedAt: timestamp('posted_at'),
    cancelledAt: timestamp('cancelled_at'),
    cancelledReason: text('cancelled_reason'),
    createdByUserId: integer('created_by_user_id').references(() => users.id),
    createdBy: text('created_by').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('idx_purchase_inv_supplier').on(table.supplierId),
    index('idx_purchase_inv_date').on(table.date),
    index('idx_purchase_inv_workflow').on(table.workflowStatus),
    index('idx_purchase_inv_client_tx').on(table.clientTxId),
  ]
);

// 7. PurchaseInvoiceItems
export const purchaseInvoiceItems = pgTable(
  'purchase_invoice_items',
  {
    id: serial('id').primaryKey(),
    invoiceId: integer('invoice_id')
      .references(() => purchaseInvoices.id, { onDelete: 'cascade' })
      .notNull(),
    inventoryItemId: integer('inventory_item_id')
      .references(() => inventoryItems.id)
      .notNull(),
    itemName: text('item_name').notNull(),
    quantity: numeric('quantity', { precision: 14, scale: 3 }).notNull(),
    unit: text('unit').notNull(),
    unitPrice: numeric('unit_price', { precision: 14, scale: 2 }).notNull(),
    total: numeric('total', { precision: 14, scale: 2 }).notNull(),
    batchCode: text('batch_code'),
    expiryDate: text('expiry_date'),
  },
  (table) => [index('idx_inv_items_invoice').on(table.invoiceId)]
);

// 8. SupplierPayments
export const supplierPayments = pgTable(
  'supplier_payments',
  {
    id: serial('id').primaryKey(),
    reference: text('reference').notNull().unique(),
    clientTxId: text('client_tx_id'),
    supplierId: integer('supplier_id')
      .references(() => suppliers.id)
      .notNull(),
    invoiceId: integer('invoice_id').references(() => purchaseInvoices.id),
    date: text('date').notNull(),
    amount: numeric('amount', { precision: 14, scale: 2 }).notNull(),
    method: text('method').notNull(),
    notes: text('notes'),
    recordedByUserId: integer('recorded_by_user_id').references(() => users.id),
    recordedBy: text('recorded_by').notNull(),
    isReversal: boolean('is_reversal').notNull().default(false),
    reversedPaymentId: integer('reversed_payment_id'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('idx_sup_payments_supplier').on(table.supplierId),
    index('idx_sup_payments_invoice').on(table.invoiceId),
    index('idx_sup_payments_client_tx').on(table.clientTxId),
  ]
);

// 10. InventoryBatches
export const inventoryBatches = pgTable(
  'inventory_batches',
  {
    id: serial('id').primaryKey(),
    inventoryItemId: integer('inventory_item_id')
      .references(() => inventoryItems.id, { onDelete: 'cascade' })
      .notNull(),
    batchCode: text('batch_code').notNull(),
    quantityRemaining: numeric('quantity_remaining', { precision: 14, scale: 3 }).notNull(),
    unitCost: numeric('unit_cost', { precision: 14, scale: 2 }).notNull(),
    expiryDate: text('expiry_date'),
    receivedDate: text('received_date').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [index('idx_batches_item').on(table.inventoryItemId)]
);

// 11. StockMovements
export const stockMovements = pgTable(
  'stock_movements',
  {
    id: serial('id').primaryKey(),
    reference: text('reference').notNull().unique(),
    clientTxId: text('client_tx_id'),
    inventoryItemId: integer('inventory_item_id')
      .references(() => inventoryItems.id)
      .notNull(),
    itemName: text('item_name').notNull(),
    type: text('type').notNull(),
    quantityDelta: numeric('quantity_delta', { precision: 14, scale: 3 }).notNull(),
    unit: text('unit').notNull(),
    balanceAfter: numeric('balance_after', { precision: 14, scale: 3 }).notNull(),
    batchCode: text('batch_code'),
    expiryDate: text('expiry_date'),
    relatedSupplierId: integer('related_supplier_id').references(() => suppliers.id),
    date: text('date').notNull(),
    performedByUserId: integer('performed_by_user_id').references(() => users.id),
    performedBy: text('performed_by').notNull(),
    notes: text('notes'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('idx_stock_mov_item').on(table.inventoryItemId),
    index('idx_stock_mov_date').on(table.date),
    index('idx_stock_mov_client_tx').on(table.clientTxId),
  ]
);

// 12. ProductionRecipes
export const productionRecipes = pgTable('production_recipes', {
  id: serial('id').primaryKey(),
  breadType: text('bread_type').notNull().unique(),
  expectedYieldLoaves: integer('expected_yield_loaves').notNull(),
  unitSellingPrice: numeric('unit_selling_price', { precision: 14, scale: 2 }).notNull(),
  flourBags: numeric('flour_bags', { precision: 10, scale: 2 }).notNull(),
  oilLiters: numeric('oil_liters', { precision: 10, scale: 2 }).notNull(),
  yeastGrams: numeric('yeast_grams', { precision: 10, scale: 2 }).notNull(),
  saltGrams: numeric('salt_grams', { precision: 10, scale: 2 }).notNull(),
  sugarGrams: numeric('sugar_grams', { precision: 10, scale: 2 }).notNull(),
  otherIngredients: jsonb('other_ingredients')
    .$type<{ inventoryItemId: number; name: string; quantity: number; unit: string }[]>()
    .notNull()
    .default([]),
  isActive: boolean('is_active').notNull().default(true),
  notes: text('notes'),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// 13. ProductionRecords
export const productionRecords = pgTable(
  'production_records',
  {
    id: serial('id').primaryKey(),
    reference: text('reference').notNull().unique(),
    clientTxId: text('client_tx_id').unique(),
    date: text('date').notNull(),
    shiftId: integer('shift_id'),
    shiftName: text('shift_name').notNull(),
    agentId: integer('agent_id').references(() => users.id),
    agentName: text('agent_name').notNull(),
    recipeId: integer('recipe_id').references(() => productionRecipes.id),
    breadType: text('bread_type').notNull(),
    flourConsumedBags: numeric('flour_consumed_bags', { precision: 10, scale: 2 }).notNull(),
    oilConsumedLiters: numeric('oil_consumed_liters', { precision: 10, scale: 2 }).notNull(),
    yeastConsumedGrams: numeric('yeast_consumed_grams', { precision: 10, scale: 2 }).notNull(),
    saltConsumedGrams: numeric('salt_consumed_grams', { precision: 10, scale: 2 }).notNull(),
    sugarConsumedGrams: numeric('sugar_consumed_grams', { precision: 10, scale: 2 }).notNull(),
    otherIngredientsSummary: text('other_ingredients_summary'),
    producedLoaves: integer('produced_loaves').notNull(),
    damagedLoaves: integer('damaged_loaves').notNull().default(0),
    notes: text('notes'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('idx_prod_date').on(table.date),
    index('idx_prod_agent').on(table.agentId),
    index('idx_prod_shift').on(table.shiftId),
  ]
);

// 14. ProductionIngredients
export const productionIngredients = pgTable(
  'production_ingredients',
  {
    id: serial('id').primaryKey(),
    productionRecordId: integer('production_record_id')
      .references(() => productionRecords.id, { onDelete: 'cascade' })
      .notNull(),
    inventoryItemId: integer('inventory_item_id')
      .references(() => inventoryItems.id)
      .notNull(),
    quantityUsed: numeric('quantity_used', { precision: 14, scale: 3 }).notNull(),
    unit: text('unit').notNull(),
  },
  (table) => [index('idx_prod_ing_record').on(table.productionRecordId)]
);

// 18. Customers (defined before Sales & CustomerPayments)
export const customers = pgTable('customers', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  phone: text('phone').notNull(),
  address: text('address').notNull().default(''),
  creditLimit: numeric('credit_limit', { precision: 14, scale: 2 }).notNull().default('0.00'),
  totalCreditSales: numeric('total_credit_sales', { precision: 14, scale: 2 })
    .notNull()
    .default('0.00'),
  totalPayments: numeric('total_payments', { precision: 14, scale: 2 }).notNull().default('0.00'),
  adjustments: numeric('adjustments', { precision: 14, scale: 2 }).notNull().default('0.00'),
  outstandingBalance: numeric('outstanding_balance', { precision: 14, scale: 2 })
    .notNull()
    .default('0.00'),
  status: text('status').notNull().default('نشط'), // 'نشط' | 'موقوف'
  notes: text('notes'),
  lastActivityDate: text('last_activity_date').notNull().default(''),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// 15. Sales
export const sales = pgTable(
  'sales',
  {
    id: serial('id').primaryKey(),
    reference: text('reference').notNull().unique(),
    clientTxId: text('client_tx_id').unique(),
    date: text('date').notNull(),
    shiftId: integer('shift_id'),
    shiftName: text('shift_name').notNull(),
    agentId: integer('agent_id').references(() => users.id),
    agentName: text('agent_name').notNull(),
    breadType: text('bread_type').notNull(),
    quantity: integer('quantity').notNull(),
    returnedQuantity: integer('returned_quantity').notNull().default(0),
    unitPrice: numeric('unit_price', { precision: 14, scale: 2 }).notNull(),
    totalAmount: numeric('total_amount', { precision: 14, scale: 2 }).notNull(),
    paymentType: text('payment_type').notNull(), // 'نقدي' | 'آجل'
    customerId: integer('customer_id').references(() => customers.id),
    customerName: text('customer_name'),
    notes: text('notes'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('idx_sales_date').on(table.date),
    index('idx_sales_agent').on(table.agentId),
    index('idx_sales_shift').on(table.shiftId),
    index('idx_sales_customer').on(table.customerId),
  ]
);

// 16. SaleItems
export const saleItems = pgTable(
  'sale_items',
  {
    id: serial('id').primaryKey(),
    saleId: integer('sale_id')
      .references(() => sales.id, { onDelete: 'cascade' })
      .notNull(),
    breadType: text('bread_type').notNull(),
    quantity: integer('quantity').notNull(),
    unitPrice: numeric('unit_price', { precision: 14, scale: 2 }).notNull(),
    lineTotal: numeric('line_total', { precision: 14, scale: 2 }).notNull(),
  },
  (table) => [index('idx_sale_items_sale').on(table.saleId)]
);

// 19. CustomerPayments
export const customerPayments = pgTable(
  'customer_payments',
  {
    id: serial('id').primaryKey(),
    reference: text('reference').notNull().unique(),
    clientTxId: text('client_tx_id'),
    customerId: integer('customer_id')
      .references(() => customers.id)
      .notNull(),
    amount: numeric('amount', { precision: 14, scale: 2 }).notNull(),
    date: text('date').notNull(),
    method: text('method').notNull().default('نقداً'), // 'نقداً' | 'تحويل بنكي (بنكك)' | 'شيك'
    notes: text('notes'),
    recordedByUserId: integer('recorded_by_user_id').references(() => users.id),
    recordedBy: text('recorded_by').notNull(),
    isReversal: boolean('is_reversal').notNull().default(false),
    reversedPaymentId: integer('reversed_payment_id'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('idx_cust_pay_customer').on(table.customerId),
    index('idx_cust_pay_client_tx').on(table.clientTxId),
    index('idx_cust_pay_date').on(table.date),
  ]
);

// 19b. CustomerAdjustments
export const customerAdjustments = pgTable(
  'customer_adjustments',
  {
    id: serial('id').primaryKey(),
    reference: text('reference').notNull().unique(),
    customerId: integer('customer_id')
      .references(() => customers.id, { onDelete: 'cascade' })
      .notNull(),
    amount: numeric('amount', { precision: 14, scale: 2 }).notNull(),
    date: text('date').notNull(),
    reason: text('reason').notNull(),
    recordedByUserId: integer('recorded_by_user_id').references(() => users.id),
    recordedBy: text('recorded_by').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('idx_cust_adj_customer').on(table.customerId),
    index('idx_cust_adj_date').on(table.date),
  ]
);

// 20. Shifts
export const shifts = pgTable(
  'shifts',
  {
    id: serial('id').primaryKey(),
    shiftName: text('shift_name').notNull(),
    date: text('date').notNull(),
    agentId: integer('agent_id').references(() => users.id),
    agentName: text('agent_name').notNull(),
    status: text('status').notNull().default('مفتوحة'),
    openingCash: numeric('opening_cash', { precision: 14, scale: 2 }).notNull().default('0.00'),
    openingBread: integer('opening_bread').notNull().default(0),
    producedBread: integer('produced_bread').notNull().default(0),
    returnedBread: integer('returned_bread').notNull().default(0),
    soldBread: integer('sold_bread').notNull().default(0),
    damagedBread: integer('damaged_bread').notNull().default(0),
    authorizedAdjustments: integer('authorized_adjustments').notNull().default(0),
    cashSalesAmount: numeric('cash_sales_amount', { precision: 14, scale: 2 })
      .notNull()
      .default('0.00'),
    creditSalesAmount: numeric('credit_sales_amount', { precision: 14, scale: 2 })
      .notNull()
      .default('0.00'),
    totalExpenses: numeric('total_expenses', { precision: 14, scale: 2 }).notNull().default('0.00'),
    expectedCash: numeric('expected_cash', { precision: 14, scale: 2 }).notNull().default('0.00'),
    actualCash: numeric('actual_cash', { precision: 14, scale: 2 }),
    cashDifference: numeric('cash_difference', { precision: 14, scale: 2 }),
    closingBread: integer('closing_bread'),
    handoverNotes: text('handover_notes'),
    openedAt: timestamp('opened_at').defaultNow(),
    closedAt: timestamp('closed_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('idx_shifts_status').on(table.status),
    index('idx_shifts_date').on(table.date),
    index('idx_shifts_agent_status').on(table.agentId, table.status),
  ]
);

// 21. ShiftHandovers
export const shiftHandovers = pgTable(
  'shift_handovers',
  {
    id: serial('id').primaryKey(),
    shiftId: integer('shift_id')
      .references(() => shifts.id, { onDelete: 'cascade' })
      .notNull(),
    fromAgentId: integer('from_agent_id').references(() => users.id),
    expectedCash: numeric('expected_cash', { precision: 14, scale: 2 }).notNull().default('0.00'),
    handedCash: numeric('handed_cash', { precision: 14, scale: 2 }).notNull(),
    cashDifference: numeric('cash_difference', { precision: 14, scale: 2 }).notNull().default('0.00'),
    expectedBread: integer('expected_bread').notNull().default(0),
    handedBread: integer('handed_bread').notNull(),
    breadDifference: integer('bread_difference').notNull().default(0),
    receivedByUserId: integer('received_by_user_id').references(() => users.id),
    receivedByName: text('received_by_name').notNull().default('إدارة المخبز'),
    notes: text('notes'),
    approvedByOwner: boolean('approved_by_owner').notNull().default(false),
    approvedByUserId: integer('approved_by_user_id').references(() => users.id),
    approvedByName: text('approved_by_name'),
    handedAt: timestamp('handed_at').defaultNow().notNull(),
    approvedAt: timestamp('approved_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [index('idx_handovers_shift').on(table.shiftId)]
);

// 21b. BreadMovements (separate Returns, Damaged Bread & Authorized Adjustments ledger)
export const breadMovements = pgTable(
  'bread_movements',
  {
    id: serial('id').primaryKey(),
    reference: text('reference').notNull().unique(),
    clientTxId: text('client_tx_id'),
    date: text('date').notNull(),
    shiftId: integer('shift_id').references(() => shifts.id),
    shiftName: text('shift_name').notNull(),
    agentId: integer('agent_id').references(() => users.id),
    agentName: text('agent_name').notNull(),
    breadType: text('bread_type').notNull(),
    type: text('type').notNull(), // 'مرتجع' | 'تالف' | 'تعديل معتمد'
    quantity: integer('quantity').notNull(),
    reason: text('reason').notNull().default(''),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('idx_bread_mov_date').on(table.date),
    index('idx_bread_mov_shift').on(table.shiftId),
    index('idx_bread_mov_client_tx').on(table.clientTxId),
  ]
);

// 17. Expenses
export const expenses = pgTable(
  'expenses',
  {
    id: serial('id').primaryKey(),
    reference: text('reference').notNull().unique(),
    clientTxId: text('client_tx_id'),
    date: text('date').notNull(),
    category: text('category').notNull(),
    amount: numeric('amount', { precision: 14, scale: 2 }).notNull(),
    description: text('description').notNull(),
    paymentMethod: text('payment_method').notNull().default('نقداً'),
    responsibleUserId: integer('responsible_user_id').references(() => users.id),
    responsibleUser: text('responsible_user').notNull(),
    shiftId: integer('shift_id').references(() => shifts.id),
    attachmentName: text('attachment_name'),
    attachmentData: text('attachment_data'),
    status: text('status').notNull().default('مرحّل'), // 'مرحّل' | 'معكوس'
    isReversal: boolean('is_reversal').notNull().default(false),
    reversedExpenseId: integer('reversed_expense_id'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('idx_expenses_date').on(table.date),
    index('idx_expenses_client_tx').on(table.clientTxId),
    index('idx_expenses_cat_status').on(table.category, table.status),
  ]
);

// 22. CashTransactions
export const cashTransactions = pgTable(
  'cash_transactions',
  {
    id: serial('id').primaryKey(),
    reference: text('reference').notNull().unique(),
    clientTxId: text('client_tx_id'),
    type: text('type').notNull(), // 'إيداع مبيعات' | 'سحب سداد مورد' | 'مصروف تشغيلي' | 'تحصيل عميل' | 'إيداع نقدي' | 'سحب نقدي' | 'صرف رواتب' | 'تسوية عهدة وردية' | 'قيد عكسي'
    category: text('category').notNull().default('تشغيلي'),
    direction: text('direction').notNull(), // 'IN' | 'OUT'
    amount: numeric('amount', { precision: 14, scale: 2 }).notNull(),
    date: text('date').notNull(),
    paymentMethod: text('payment_method').notNull().default('نقداً'),
    relatedEntity: text('related_entity').notNull(),
    notes: text('notes'),
    shiftId: integer('shift_id').references(() => shifts.id),
    recordedByUserId: integer('recorded_by_user_id').references(() => users.id),
    recordedBy: text('recorded_by').notNull(),
    isReversal: boolean('is_reversal').notNull().default(false),
    reversedTxId: integer('reversed_tx_id'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('idx_cash_tx_date').on(table.date),
    index('idx_cash_tx_client_tx').on(table.clientTxId),
    index('idx_cash_dir_cat').on(table.direction, table.category),
  ]
);

// 23. Employees
export const employees = pgTable('employees', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  jobTitle: text('job_title').notNull(),
  phone: text('phone').notNull(),
  monthlySalary: numeric('monthly_salary', { precision: 14, scale: 2 }).notNull(),
  shift: text('shift').notNull(),
  attendanceDays: integer('attendance_days').notNull().default(0),
  paidThisMonth: numeric('paid_this_month', { precision: 14, scale: 2 }).notNull().default('0.00'),
  status: text('status').notNull().default('نشط'), // 'نشط' | 'موقوف'
  notes: text('notes'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// 24. EmployeeAttendance
export const employeeAttendance = pgTable(
  'employee_attendance',
  {
    id: serial('id').primaryKey(),
    employeeId: integer('employee_id')
      .references(() => employees.id, { onDelete: 'cascade' })
      .notNull(),
    date: text('date').notNull(),
    status: text('status').notNull(), // 'حاضر' | 'غائب' | 'إجازة'
    notes: text('notes'),
    recordedBy: text('recorded_by'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [uniqueIndex('uq_emp_att_date').on(table.employeeId, table.date)]
);

// 25. Payroll
export const payroll = pgTable(
  'payroll',
  {
    id: serial('id').primaryKey(),
    reference: text('reference').notNull().unique(),
    clientTxId: text('client_tx_id'),
    employeeId: integer('employee_id')
      .references(() => employees.id)
      .notNull(),
    month: text('month').notNull(),
    amountPaid: numeric('amount_paid', { precision: 14, scale: 2 }).notNull(),
    paidDate: text('paid_date').notNull(),
    paymentMethod: text('payment_method').notNull().default('نقداً'),
    notes: text('notes'),
    recordedByUserId: integer('recorded_by_user_id').references(() => users.id),
    recordedBy: text('recorded_by').notNull().default('مالك المخبز'),
    isReversal: boolean('is_reversal').notNull().default(false),
    reversedPayrollId: integer('reversed_payroll_id'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('idx_payroll_emp').on(table.employeeId),
    index('idx_payroll_client_tx').on(table.clientTxId),
  ]
);

// 26. AuditLogs (immutable financial & operational audit trail)
export const auditLogs = pgTable(
  'audit_logs',
  {
    id: serial('id').primaryKey(),
    reference: text('reference').notNull().unique(),
    userId: integer('user_id').references(() => users.id),
    userName: text('user_name').notNull(),
    role: text('role').notNull(),
    operationType: text('operation_type').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id').notNull(),
    affectedRecord: text('affected_record').notNull(),
    previousValue: text('previous_value'),
    newValue: text('new_value').notNull(),
    timestamp: text('timestamp').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('idx_audit_entity').on(table.entityType, table.entityId),
    index('idx_audit_user').on(table.userId),
  ]
);

// 27. Notifications
export const notifications = pgTable(
  'notifications',
  {
    id: serial('id').primaryKey(),
    ruleCode: text('rule_code').notNull(),
    severity: text('severity').notNull(),
    title: text('title').notNull(),
    message: text('message').notNull(),
    timestamp: text('timestamp').notNull(),
    isRead: boolean('is_read').notNull().default(false),
    targetNav: text('target_nav'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [index('idx_notif_read').on(table.isRead)]
);

// 28. BakerySettings
export const bakerySettings = pgTable('bakery_settings', {
  id: serial('id').primaryKey(),
  bakeryName: text('bakery_name').notNull(),
  city: text('city').notNull(),
  address: text('address').notNull(),
  phone: text('phone').notNull(),
  currencySymbol: text('currency_symbol').notNull().default('ج.س'),
  allowNegativeInventory: boolean('allow_negative_inventory').notNull().default(false),
  standardLoafPrice: numeric('standard_loaf_price', { precision: 14, scale: 2 })
    .notNull()
    .default('250.00'),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// Drizzle Relations
export const suppliersRelations = relations(suppliers, ({ many }) => ({
  invoices: many(purchaseInvoices),
  payments: many(supplierPayments),
  products: many(supplierProducts),
}));

export const purchaseInvoicesRelations = relations(purchaseInvoices, ({ one, many }) => ({
  supplier: one(suppliers, {
    fields: [purchaseInvoices.supplierId],
    references: [suppliers.id],
  }),
  items: many(purchaseInvoiceItems),
}));

export const purchaseInvoiceItemsRelations = relations(purchaseInvoiceItems, ({ one }) => ({
  invoice: one(purchaseInvoices, {
    fields: [purchaseInvoiceItems.invoiceId],
    references: [purchaseInvoices.id],
  }),
  inventoryItem: one(inventoryItems, {
    fields: [purchaseInvoiceItems.inventoryItemId],
    references: [inventoryItems.id],
  }),
}));

export const supplierPaymentsRelations = relations(supplierPayments, ({ one }) => ({
  supplier: one(suppliers, {
    fields: [supplierPayments.supplierId],
    references: [suppliers.id],
  }),
  invoice: one(purchaseInvoices, {
    fields: [supplierPayments.invoiceId],
    references: [purchaseInvoices.id],
  }),
}));
