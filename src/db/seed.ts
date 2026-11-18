import { count } from 'drizzle-orm';
import { db } from './index.ts';
import {
  auditLogs,
  bakerySettings,
  cashTransactions,
  customers,
  employees,
  expenses,
  inventoryBatches,
  inventoryItems,
  notifications,
  permissions,
  productionIngredients,
  productionRecipes,
  productionRecords,
  purchaseInvoiceItems,
  purchaseInvoices,
  roles,
  saleItems,
  sales,
  shiftHandovers,
  shifts,
  stockMovements,
  supplierPayments,
  supplierProducts,
  suppliers,
  users,
} from './schema.ts';
import { hashPassword } from '../server/security.ts';

let seedPromise: Promise<void> | null = null;

export async function ensureSeeded(): Promise<void> {
  if (!seedPromise) {
    seedPromise = runSeed().catch((err) => {
      seedPromise = null;
      throw err;
    });
  }
  return seedPromise;
}

async function runSeed(): Promise<void> {
  const [{ value: userCount }] = await db.select({ value: count() }).from(users);
  if (Number(userCount) > 0) {
    return;
  }

  await db.transaction(async (tx) => {
    // 1. Roles
    const insertedRoles = await tx
      .insert(roles)
      .values([
        { code: 'OWNER', name: 'مالك المخبز', description: 'صلاحيات إدارية ومالية كاملة' },
        { code: 'AGENT', name: 'وكيل وردية', description: 'صلاحيات تشغيلية محدودة للوردية' },
      ])
      .onConflictDoNothing()
      .returning();

    const ownerRoleId = insertedRoles.find((r) => r.code === 'OWNER')?.id ?? 1;
    const agentRoleId = insertedRoles.find((r) => r.code === 'AGENT')?.id ?? 2;

    // 2. Permissions
    await tx
      .insert(permissions)
      .values([
        { code: 'SUPPLIER_MANAGE', name: 'إدارة الموردين والفواتير', module: 'suppliers', roleCode: 'OWNER' },
        { code: 'INVENTORY_MANAGE', name: 'إدارة المخزون والتعديلات', module: 'inventory', roleCode: 'OWNER' },
        { code: 'REPORTS_VIEW', name: 'التقارير المالية والأرباح', module: 'reports', roleCode: 'OWNER' },
        { code: 'SETTINGS_MANAGE', name: 'إعدادات النظام والوكلاء', module: 'settings', roleCode: 'OWNER' },
        { code: 'PRODUCTION_LOG', name: 'تسجيل الإنتاج والاستهلاك', module: 'production', roleCode: 'AGENT' },
        { code: 'SALES_LOG', name: 'تسجيل مبيعات الوردية', module: 'sales', roleCode: 'AGENT' },
        { code: 'EXPENSES_LOG', name: 'تسجيل المصروفات اليومية', module: 'expenses', roleCode: 'AGENT' },
        { code: 'SHIFT_MANAGE', name: 'فتح وإغلاق الوردية', module: 'shifts', roleCode: 'AGENT' },
      ])
      .onConflictDoNothing();

    // 3. Users (hashed passwords via scrypt)
    const ownerPass = hashPassword('123456');
    const agentPass = hashPassword('123456');

    const insertedUsers = await tx
      .insert(users)
      .values([
        {
          uid: 'sbms-owner-1',
          username: 'owner',
          email: 'owner@alnile-bakery.sd',
          passwordHash: ownerPass,
          fullName: 'الطيب حسن عبد الرحمن',
          phone: '+249 91 234 5678',
          roleId: ownerRoleId,
          roleCode: 'OWNER',
          branchName: 'مخبز النيل الأبيض الآلي — بحري',
          isActive: true,
        },
        {
          uid: 'sbms-agent-1',
          username: 'agent_ahmed',
          email: 'ahmed@alnile-bakery.sd',
          passwordHash: agentPass,
          fullName: 'أحمد الفاتح محمد',
          phone: '+249 91 660 1122',
          roleId: agentRoleId,
          roleCode: 'AGENT',
          branchName: 'مخبز النيل الأبيض الآلي — بحري',
          assignedShift: 'الوردية الصباحية',
          isActive: true,
        },
        {
          uid: 'sbms-agent-2',
          username: 'agent_osman',
          email: 'osman@alnile-bakery.sd',
          passwordHash: agentPass,
          fullName: 'محمد عثمان إبراهيم',
          phone: '+249 91 882 3344',
          roleId: agentRoleId,
          roleCode: 'AGENT',
          branchName: 'مخبز النيل الأبيض الآلي — بحري',
          assignedShift: 'الوردية المسائية',
          isActive: true,
        },
        {
          uid: 'sbms-agent-3',
          username: 'agent_tijani',
          email: 'tijani@alnile-bakery.sd',
          passwordHash: agentPass,
          fullName: 'عبد الله التجاني',
          phone: '+249 90 445 7710',
          roleId: agentRoleId,
          roleCode: 'AGENT',
          branchName: 'مخبز النيل الأبيض الآلي — بحري',
          assignedShift: 'الوردية الليلية',
          isActive: true,
        },
      ])
      .onConflictDoNothing()
      .returning();

    const ownerUser = insertedUsers.find((u) => u.username === 'owner');
    const agentAhmed = insertedUsers.find((u) => u.username === 'agent_ahmed');
    const agentOsman = insertedUsers.find((u) => u.username === 'agent_osman');
    const agentTijani = insertedUsers.find((u) => u.username === 'agent_tijani');

    // 4. Bakery Settings
    await tx.insert(bakerySettings).values({
      bakeryName: 'مخبز النيل الأبيض الآلي',
      city: 'الخرطوم بحري',
      address: 'المنطقة الصناعية — مربع 4، الخرطوم بحري',
      phone: '+249 91 234 5678',
      currencySymbol: 'ج.س',
      allowNegativeInventory: false,
      standardLoafPrice: '250.00',
    });

    // 5. Suppliers
    const insertedSuppliers = await tx
      .insert(suppliers)
      .values([
        {
          code: 'SUP-001',
          name: 'مطاحن سيقا للغلال',
          phone: '+249 91 210 8840',
          address: 'الباقير الصناعية، جنوب الخرطوم',
          categories: ['دقيق قمح 50 كجم', 'دقيق فينو فاخر'],
          totalPurchases: '4850000.00',
          totalPayments: '3600000.00',
          adjustments: '0.00',
          status: 'نشط',
          lastTransactionDate: '2026-11-14',
          notes: 'توريد أسبوعي منتظم — مهلة سداد 14 يوماً',
        },
        {
          code: 'SUP-002',
          name: 'شركة سين للغلال والدقيق',
          phone: '+249 91 540 2219',
          address: 'المنطقة الصناعية، أم درمان',
          categories: ['دقيق مخبوزات', 'سمولينا'],
          totalPurchases: '2700000.00',
          totalPayments: '2150000.00',
          adjustments: '-50000.00',
          status: 'نشط',
          lastTransactionDate: '2026-11-12',
          notes: 'خصم كميات 50,000 ج.س معتمد للفاتورة رقم 103',
        },
        {
          code: 'SUP-003',
          name: 'شركة زادنا للزيوت والخمائر',
          phone: '+249 92 800 3411',
          address: 'سوق ليبيا التجاري، أم درمان',
          categories: ['زيت طعام نباتي', 'خميرة فورية', 'محسنات خبز'],
          totalPurchases: '1320000.00',
          totalPayments: '980000.00',
          adjustments: '0.00',
          status: 'نشط',
          lastTransactionDate: '2026-11-13',
        },
        {
          code: 'SUP-004',
          name: 'مصنع النيل للتغليف واللدائن',
          phone: '+249 90 112 7765',
          address: 'الخرطوم بحري — المنطقة الصناعية',
          categories: ['أكياس تغليف', 'رولات نايلون'],
          totalPurchases: '460000.00',
          totalPayments: '460000.00',
          adjustments: '0.00',
          status: 'نشط',
          lastTransactionDate: '2026-11-08',
        },
      ])
      .returning();

    const sup1 = insertedSuppliers[0];
    const sup2 = insertedSuppliers[1];
    const sup3 = insertedSuppliers[2];
    const sup4 = insertedSuppliers[3];

    await tx.insert(supplierProducts).values([
      { supplierId: sup1.id, productName: 'دقيق قمح ممتاز (جوال 50 كجم)', unit: 'جوال', lastUnitPrice: '65000.00' },
      { supplierId: sup2.id, productName: 'دقيق مخبوزات (جوال 50 كجم)', unit: 'جوال', lastUnitPrice: '64285.71' },
      { supplierId: sup3.id, productName: 'زيت طعام نباتي', unit: 'لتر', lastUnitPrice: '6500.00' },
      { supplierId: sup4.id, productName: 'أكياس تغليف خبز مطبوعة', unit: 'قطعة', lastUnitPrice: '100.00' },
    ]);

    // 6. Inventory Items
    const insertedItems = await tx
      .insert(inventoryItems)
      .values([
        {
          sku: 'RM-FLR-01',
          name: 'دقيق قمح ممتاز (جوال 50 كجم)',
          category: 'دقيق',
          unit: 'جوال',
          availableQuantity: '48.000',
          averageCost: '64500.00',
          minimumStock: '25.000',
          primarySupplierId: sup1.id,
          primarySupplierName: sup1.name,
          batchCode: 'BCH-2611-A',
          expiryDate: '2027-04-30',
          lastUpdated: '2026-11-15',
        },
        {
          sku: 'RM-OIL-02',
          name: 'زيت طعام نباتي',
          category: 'زيوت ودهون',
          unit: 'لتر',
          availableQuantity: '135.000',
          averageCost: '6500.00',
          minimumStock: '60.000',
          primarySupplierId: sup3.id,
          primarySupplierName: sup3.name,
          batchCode: 'OIL-2611-C',
          expiryDate: '2027-08-15',
          lastUpdated: '2026-11-15',
        },
        {
          sku: 'RM-YST-03',
          name: 'خميرة فورية جافة',
          category: 'إضافات وخمائر',
          unit: 'جرام',
          availableQuantity: '4200.000',
          averageCost: '30.00',
          minimumStock: '6000.000',
          primarySupplierId: sup3.id,
          primarySupplierName: sup3.name,
          batchCode: 'YST-2610-M',
          expiryDate: '2027-01-20',
          lastUpdated: '2026-11-15',
        },
        {
          sku: 'RM-SLT-04',
          name: 'ملح طعام ناعم',
          category: 'إضافات وخمائر',
          unit: 'كجم',
          availableQuantity: '85.000',
          averageCost: '1200.00',
          minimumStock: '30.000',
          primarySupplierId: sup3.id,
          primarySupplierName: sup3.name,
          batchCode: 'SLT-2609-K',
          lastUpdated: '2026-11-14',
        },
        {
          sku: 'RM-SGR-05',
          name: 'سكر أبيض مكرر',
          category: 'إضافات وخمائر',
          unit: 'كجم',
          availableQuantity: '32.000',
          averageCost: '3400.00',
          minimumStock: '40.000',
          primarySupplierId: sup2.id,
          primarySupplierName: sup2.name,
          batchCode: 'SGR-2611-B',
          lastUpdated: '2026-11-14',
        },
        {
          sku: 'PK-BAG-06',
          name: 'أكياس تغليف خبز مطبوعة',
          category: 'تغليف',
          unit: 'قطعة',
          availableQuantity: '3850.000',
          averageCost: '100.00',
          minimumStock: '1500.000',
          primarySupplierId: sup4.id,
          primarySupplierName: sup4.name,
          batchCode: 'PKG-2611-N',
          lastUpdated: '2026-11-15',
        },
      ])
      .returning();

    const itemFlour = insertedItems[0];
    const itemOil = insertedItems[1];
    const itemYeast = insertedItems[2];
    const itemSalt = insertedItems[3];
    const itemSugar = insertedItems[4];
    const itemBags = insertedItems[5];

    await tx.insert(inventoryBatches).values([
      {
        inventoryItemId: itemFlour.id,
        batchCode: 'BCH-2611-A',
        quantityRemaining: '48.000',
        unitCost: '64500.00',
        expiryDate: '2027-04-30',
        receivedDate: '2026-11-14',
      },
      {
        inventoryItemId: itemOil.id,
        batchCode: 'OIL-2611-C',
        quantityRemaining: '135.000',
        unitCost: '6500.00',
        expiryDate: '2027-08-15',
        receivedDate: '2026-11-13',
      },
      {
        inventoryItemId: itemYeast.id,
        batchCode: 'YST-2610-M',
        quantityRemaining: '4200.000',
        unitCost: '30.00',
        expiryDate: '2027-01-20',
        receivedDate: '2026-11-10',
      },
      {
        inventoryItemId: itemSalt.id,
        batchCode: 'SLT-2609-K',
        quantityRemaining: '85.000',
        unitCost: '1200.00',
        receivedDate: '2026-11-05',
      },
      {
        inventoryItemId: itemSugar.id,
        batchCode: 'SGR-2611-B',
        quantityRemaining: '32.000',
        unitCost: '3400.00',
        receivedDate: '2026-11-08',
      },
      {
        inventoryItemId: itemBags.id,
        batchCode: 'PKG-2611-N',
        quantityRemaining: '3850.000',
        unitCost: '100.00',
        receivedDate: '2026-11-08',
      },
    ]);

    // 7. Purchase Invoices & Items & Payments
    const insertedInvoices = await tx
      .insert(purchaseInvoices)
      .values([
        {
          invoiceNumber: 'INV-2026-101',
          reference: 'PUR-2026-101',
          supplierId: sup1.id,
          date: '2026-11-14',
          totalAmount: '2600000.00',
          initialPayment: '1600000.00',
          paidAmount: '1600000.00',
          remainingBalance: '1000000.00',
          status: 'مدفوعة جزئياً',
          notes: 'دفعة توريد منتصف الشهر — جوالات مخزنة بالمستودع الرئيسي',
          createdByUserId: ownerUser?.id,
          createdBy: ownerUser?.fullName || 'الطيب حسن',
        },
        {
          invoiceNumber: 'INV-2026-102',
          reference: 'PUR-2026-102',
          supplierId: sup1.id,
          date: '2026-11-05',
          totalAmount: '2250000.00',
          initialPayment: '1500000.00',
          paidAmount: '2000000.00',
          remainingBalance: '250000.00',
          status: 'مدفوعة جزئياً',
          notes: 'توريد أول الشهر',
          createdByUserId: ownerUser?.id,
          createdBy: ownerUser?.fullName || 'الطيب حسن',
        },
        {
          invoiceNumber: 'INV-2026-103',
          reference: 'PUR-2026-103',
          supplierId: sup2.id,
          date: '2026-11-12',
          totalAmount: '2700000.00',
          initialPayment: '1500000.00',
          paidAmount: '2150000.00',
          remainingBalance: '550000.00',
          status: 'مدفوعة جزئياً',
          createdByUserId: ownerUser?.id,
          createdBy: ownerUser?.fullName || 'الطيب حسن',
        },
        {
          invoiceNumber: 'INV-2026-104',
          reference: 'PUR-2026-104',
          supplierId: sup3.id,
          date: '2026-11-13',
          totalAmount: '1320000.00',
          initialPayment: '980000.00',
          paidAmount: '980000.00',
          remainingBalance: '340000.00',
          status: 'مدفوعة جزئياً',
          createdByUserId: ownerUser?.id,
          createdBy: ownerUser?.fullName || 'الطيب حسن',
        },
        {
          invoiceNumber: 'INV-2026-105',
          reference: 'PUR-2026-105',
          supplierId: sup4.id,
          date: '2026-11-08',
          totalAmount: '460000.00',
          initialPayment: '460000.00',
          paidAmount: '460000.00',
          remainingBalance: '0.00',
          status: 'مدفوعة بالكامل',
          createdByUserId: ownerUser?.id,
          createdBy: ownerUser?.fullName || 'الطيب حسن',
        },
      ])
      .returning();

    await tx.insert(purchaseInvoiceItems).values([
      {
        invoiceId: insertedInvoices[0].id,
        inventoryItemId: itemFlour.id,
        itemName: itemFlour.name,
        quantity: '40.000',
        unit: 'جوال',
        unitPrice: '65000.00',
        total: '2600000.00',
      },
      {
        invoiceId: insertedInvoices[1].id,
        inventoryItemId: itemFlour.id,
        itemName: itemFlour.name,
        quantity: '35.000',
        unit: 'جوال',
        unitPrice: '64285.71',
        total: '2250000.00',
      },
      {
        invoiceId: insertedInvoices[2].id,
        inventoryItemId: itemFlour.id,
        itemName: itemFlour.name,
        quantity: '42.000',
        unit: 'جوال',
        unitPrice: '64285.71',
        total: '2700000.00',
      },
      {
        invoiceId: insertedInvoices[3].id,
        inventoryItemId: itemOil.id,
        itemName: itemOil.name,
        quantity: '120.000',
        unit: 'لتر',
        unitPrice: '6500.00',
        total: '780000.00',
      },
      {
        invoiceId: insertedInvoices[3].id,
        inventoryItemId: itemYeast.id,
        itemName: itemYeast.name,
        quantity: '18000.000',
        unit: 'جرام',
        unitPrice: '30.00',
        total: '540000.00',
      },
      {
        invoiceId: insertedInvoices[4].id,
        inventoryItemId: itemBags.id,
        itemName: itemBags.name,
        quantity: '4600.000',
        unit: 'قطعة',
        unitPrice: '100.00',
        total: '460000.00',
      },
    ]);

    await tx.insert(supplierPayments).values([
      {
        reference: 'PAY-2026-081',
        supplierId: sup1.id,
        invoiceId: insertedInvoices[1].id,
        date: '2026-11-05',
        amount: '1500000.00',
        method: 'تحويل بنكي (بنكك)',
        notes: 'دفعة أولى عند الاستلام',
        recordedByUserId: ownerUser?.id,
        recordedBy: 'الطيب حسن',
      },
      {
        reference: 'PAY-2026-082',
        supplierId: sup1.id,
        invoiceId: insertedInvoices[1].id,
        date: '2026-11-10',
        amount: '500000.00',
        method: 'نقداً',
        notes: 'دفعة تكميلية للفاتورة 102',
        recordedByUserId: ownerUser?.id,
        recordedBy: 'الطيب حسن',
      },
      {
        reference: 'PAY-2026-083',
        supplierId: sup1.id,
        invoiceId: insertedInvoices[0].id,
        date: '2026-11-14',
        amount: '1600000.00',
        method: 'تحويل بنكي (بنكك)',
        notes: 'سداد جزئي عند تفريغ الشحنة',
        recordedByUserId: ownerUser?.id,
        recordedBy: 'الطيب حسن',
      },
      {
        reference: 'PAY-2026-084',
        supplierId: sup2.id,
        invoiceId: insertedInvoices[2].id,
        date: '2026-11-12',
        amount: '1500000.00',
        method: 'تحويل بنكي (بنكك)',
        recordedByUserId: ownerUser?.id,
        recordedBy: 'الطيب حسن',
      },
      {
        reference: 'PAY-2026-085',
        supplierId: sup2.id,
        invoiceId: insertedInvoices[2].id,
        date: '2026-11-13',
        amount: '650000.00',
        method: 'نقداً',
        recordedByUserId: ownerUser?.id,
        recordedBy: 'الطيب حسن',
      },
      {
        reference: 'PAY-2026-086',
        supplierId: sup3.id,
        invoiceId: insertedInvoices[3].id,
        date: '2026-11-13',
        amount: '980000.00',
        method: 'نقداً',
        recordedByUserId: ownerUser?.id,
        recordedBy: 'الطيب حسن',
      },
      {
        reference: 'PAY-2026-087',
        supplierId: sup4.id,
        invoiceId: insertedInvoices[4].id,
        date: '2026-11-08',
        amount: '460000.00',
        method: 'تحويل بنكي (بنكك)',
        recordedByUserId: ownerUser?.id,
        recordedBy: 'الطيب حسن',
      },
    ]);

    // 8. Stock Movements
    await tx.insert(stockMovements).values([
      {
        reference: 'STK-2026-401',
        inventoryItemId: itemFlour.id,
        itemName: itemFlour.name,
        type: 'استلام مشتريات',
        quantityDelta: '40.000',
        unit: 'جوال',
        balanceAfter: '60.000',
        date: '2026-11-14',
        performedByUserId: ownerUser?.id,
        performedBy: 'الطيب حسن',
        notes: 'فاتورة رقم INV-2026-101',
      },
      {
        reference: 'STK-2026-402',
        inventoryItemId: itemFlour.id,
        itemName: itemFlour.name,
        type: 'استهلاك إنتاج',
        quantityDelta: '-12.000',
        unit: 'جوال',
        balanceAfter: '48.000',
        date: '2026-11-15',
        performedByUserId: agentAhmed?.id,
        performedBy: 'أحمد الفاتح محمد',
        notes: 'تشغيلية إنتاج الخبز الصباحية',
      },
      {
        reference: 'STK-2026-403',
        inventoryItemId: itemYeast.id,
        itemName: itemYeast.name,
        type: 'استهلاك إنتاج',
        quantityDelta: '-3200.000',
        unit: 'جرام',
        balanceAfter: '4200.000',
        date: '2026-11-15',
        performedByUserId: agentAhmed?.id,
        performedBy: 'أحمد الفاتح محمد',
      },
    ]);

    // 9. Shifts (seeded before production & sales for exact relational shiftId linkage)
    const insertedShifts = await tx
      .insert(shifts)
      .values([
        {
          shiftName: 'الوردية الصباحية',
          date: '2026-11-15',
          agentId: agentAhmed?.id,
          agentName: 'أحمد الفاتح محمد',
          status: 'مفتوحة',
          openingCash: '120000.00',
          openingBread: 240,
          producedBread: 7260,
          returnedBread: 40,
          soldBread: 6900,
          damagedBread: 60,
          cashSalesAmount: '1527500.00',
          creditSalesAmount: '397500.00',
          totalExpenses: '133000.00',
          expectedCash: '1514500.00',
        },
        {
          shiftName: 'الوردية المسائية',
          date: '2026-11-14',
          agentId: agentOsman?.id,
          agentName: 'محمد عثمان إبراهيم',
          status: 'مغلقة بانتظار المراجعة',
          openingCash: '100000.00',
          openingBread: 180,
          producedBread: 5840,
          returnedBread: 30,
          soldBread: 5750,
          damagedBread: 52,
          cashSalesAmount: '1437500.00',
          creditSalesAmount: '0.00',
          totalExpenses: '45000.00',
          expectedCash: '1492500.00',
          actualCash: '1488000.00',
          cashDifference: '-4500.00',
          closingBread: 248,
          handoverNotes: 'عجز نقدي 4,500 ج.س في فكة الصرف',
        },
        {
          shiftName: 'الوردية الليلية',
          date: '2026-11-14',
          agentId: agentTijani?.id,
          agentName: 'عبد الله التجاني',
          status: 'معتمدة',
          openingCash: '80000.00',
          openingBread: 110,
          producedBread: 1080,
          returnedBread: 0,
          soldBread: 1080,
          damagedBread: 10,
          cashSalesAmount: '540000.00',
          creditSalesAmount: '0.00',
          totalExpenses: '22000.00',
          expectedCash: '598000.00',
          actualCash: '598000.00',
          cashDifference: '0.00',
          closingBread: 100,
          handoverNotes: 'تطابق تام في النقدية',
        },
      ])
      .returning();

    if (agentTijani && ownerUser) {
      await tx.insert(shiftHandovers).values({
        shiftId: insertedShifts[2].id,
        fromAgentId: agentTijani.id,
        expectedCash: '598000.00',
        handedCash: '598000.00',
        cashDifference: '0.00',
        expectedBread: 100,
        handedBread: 100,
        breadDifference: 0,
        receivedByUserId: ownerUser.id,
        receivedByName: ownerUser.fullName,
        approvedByOwner: true,
        approvedByUserId: ownerUser.id,
        approvedByName: ownerUser.fullName,
        notes: 'تطابق تام في النقدية والخبز للوردية الليلية',
      });
    }

    // 10. Recipes & Production
    const insertedRecipes = await tx
      .insert(productionRecipes)
      .values([
        {
          breadType: 'عيش بلدي سوداني',
          expectedYieldLoaves: 650,
          unitSellingPrice: '250.00',
          flourBags: '1.00',
          oilLiters: '1.50',
          yeastGrams: '250.00',
          saltGrams: '500.00',
          sugarGrams: '200.00',
        },
        {
          breadType: 'عيش فينو (سندوتش)',
          expectedYieldLoaves: 520,
          unitSellingPrice: '350.00',
          flourBags: '1.00',
          oilLiters: '2.50',
          yeastGrams: '350.00',
          saltGrams: '450.00',
          sugarGrams: '800.00',
        },
        {
          breadType: 'رغيف فرنسي كبير',
          expectedYieldLoaves: 360,
          unitSellingPrice: '500.00',
          flourBags: '1.00',
          oilLiters: '1.80',
          yeastGrams: '300.00',
          saltGrams: '500.00',
          sugarGrams: '300.00',
        },
      ])
      .returning();

    const prodRows = await tx
      .insert(productionRecords)
      .values([
        {
          reference: 'PRD-2026-1151',
          date: '2026-11-15',
          shiftId: insertedShifts[0].id,
          shiftName: 'الوردية الصباحية',
          agentId: agentAhmed?.id,
          agentName: 'أحمد الفاتح محمد',
          recipeId: insertedRecipes[0].id,
          breadType: 'عيش بلدي سوداني',
          flourConsumedBags: '8.00',
          oilConsumedLiters: '12.00',
          yeastConsumedGrams: '2000.00',
          saltConsumedGrams: '4000.00',
          sugarConsumedGrams: '1600.00',
          producedLoaves: 5180,
          damagedLoaves: 45,
          notes: 'جودة التخمير ممتازة',
        },
        {
          reference: 'PRD-2026-1152',
          date: '2026-11-15',
          shiftId: insertedShifts[0].id,
          shiftName: 'الوردية الصباحية',
          agentId: agentAhmed?.id,
          agentName: 'أحمد الفاتح محمد',
          recipeId: insertedRecipes[1].id,
          breadType: 'عيش فينو (سندوتش)',
          flourConsumedBags: '4.00',
          oilConsumedLiters: '10.00',
          yeastConsumedGrams: '1400.00',
          saltConsumedGrams: '1800.00',
          sugarConsumedGrams: '3200.00',
          producedLoaves: 2080,
          damagedLoaves: 15,
          notes: 'دفعة المدارس والمقاصف',
        },
        {
          reference: 'PRD-2026-1143',
          date: '2026-11-14',
          shiftId: insertedShifts[1].id,
          shiftName: 'الوردية المسائية',
          agentId: agentOsman?.id,
          agentName: 'محمد عثمان إبراهيم',
          recipeId: insertedRecipes[0].id,
          breadType: 'عيش بلدي سوداني',
          flourConsumedBags: '9.00',
          oilConsumedLiters: '13.50',
          yeastConsumedGrams: '2250.00',
          saltConsumedGrams: '4500.00',
          sugarConsumedGrams: '1800.00',
          producedLoaves: 5840,
          damagedLoaves: 52,
        },
      ])
      .returning();

    await tx.insert(productionIngredients).values([
      {
        productionRecordId: prodRows[0].id,
        inventoryItemId: itemFlour.id,
        quantityUsed: '8.000',
        unit: 'جوال',
      },
      {
        productionRecordId: prodRows[1].id,
        inventoryItemId: itemFlour.id,
        quantityUsed: '4.000',
        unit: 'جوال',
      },
      {
        productionRecordId: prodRows[2].id,
        inventoryItemId: itemFlour.id,
        quantityUsed: '9.000',
        unit: 'جوال',
      },
    ]);

    // 10. Customers & Sales
    const insertedCustomers = await tx
      .insert(customers)
      .values([
        {
          name: 'سوبرماركت البركة — بحري',
          phone: '+249 91 334 9901',
          address: 'المؤسسة، الخرطوم بحري',
          creditLimit: '600000.00',
          totalCreditSales: '1450000.00',
          totalPayments: '1020000.00',
          outstandingBalance: '430000.00',
          lastActivityDate: '2026-11-15',
        },
        {
          name: 'كافتيريا جامعة الخرطوم',
          phone: '+249 92 441 7820',
          address: 'شارع الجامعة، الخرطوم',
          creditLimit: '400000.00',
          totalCreditSales: '890000.00',
          totalPayments: '685000.00',
          outstandingBalance: '205000.00',
          lastActivityDate: '2026-11-15',
        },
        {
          name: 'مطعم ومخبوزات النيلين',
          phone: '+249 91 778 5521',
          address: 'شارع النيل، أم درمان',
          creditLimit: '500000.00',
          totalCreditSales: '620000.00',
          totalPayments: '500000.00',
          outstandingBalance: '120000.00',
          lastActivityDate: '2026-11-13',
        },
      ])
      .returning();

    const insertedSales = await tx
      .insert(sales)
      .values([
        {
          reference: 'SAL-2026-901',
          date: '2026-11-15',
          shiftId: insertedShifts[0].id,
          shiftName: 'الوردية الصباحية',
          agentId: agentAhmed?.id,
          agentName: 'أحمد الفاتح محمد',
          breadType: 'عيش بلدي سوداني',
          quantity: 3800,
          returnedQuantity: 40,
          unitPrice: '250.00',
          totalAmount: '950000.00',
          paymentType: 'نقدي',
        },
        {
          reference: 'SAL-2026-902',
          date: '2026-11-15',
          shiftId: insertedShifts[0].id,
          shiftName: 'الوردية الصباحية',
          agentId: agentAhmed?.id,
          agentName: 'أحمد الفاتح محمد',
          breadType: 'عيش بلدي سوداني',
          quantity: 1100,
          returnedQuantity: 0,
          unitPrice: '250.00',
          totalAmount: '275000.00',
          paymentType: 'آجل',
          customerId: insertedCustomers[0].id,
          customerName: insertedCustomers[0].name,
        },
        {
          reference: 'SAL-2026-903',
          date: '2026-11-15',
          shiftId: insertedShifts[0].id,
          shiftName: 'الوردية الصباحية',
          agentId: agentAhmed?.id,
          agentName: 'أحمد الفاتح محمد',
          breadType: 'عيش فينو (سندوتش)',
          quantity: 1650,
          returnedQuantity: 0,
          unitPrice: '350.00',
          totalAmount: '577500.00',
          paymentType: 'نقدي',
        },
        {
          reference: 'SAL-2026-904',
          date: '2026-11-15',
          shiftId: insertedShifts[0].id,
          shiftName: 'الوردية الصباحية',
          agentId: agentAhmed?.id,
          agentName: 'أحمد الفاتح محمد',
          breadType: 'عيش فينو (سندوتش)',
          quantity: 350,
          returnedQuantity: 0,
          unitPrice: '350.00',
          totalAmount: '122500.00',
          paymentType: 'آجل',
          customerId: insertedCustomers[1].id,
          customerName: insertedCustomers[1].name,
        },
        {
          reference: 'SAL-2026-895',
          date: '2026-11-14',
          shiftId: insertedShifts[1].id,
          shiftName: 'الوردية المسائية',
          agentId: agentOsman?.id,
          agentName: 'محمد عثمان إبراهيم',
          breadType: 'عيش بلدي سوداني',
          quantity: 5750,
          returnedQuantity: 30,
          unitPrice: '250.00',
          totalAmount: '1437500.00',
          paymentType: 'نقدي',
        },
      ])
      .returning();

    await tx.insert(saleItems).values(
      insertedSales.map((s) => ({
        saleId: s.id,
        breadType: s.breadType,
        quantity: s.quantity,
        unitPrice: s.unitPrice,
        lineTotal: s.totalAmount,
      }))
    );

    // 11. Expenses & Cash Transactions (fully reconciled ledger)
    await tx.insert(expenses).values([
      {
        reference: 'EXP-2026-301',
        date: '2026-11-15',
        category: 'وقود وغاز',
        amount: '95000.00',
        description: 'تعبئة أسطوانات غاز الأفران + جازولين المولد',
        responsibleUserId: agentAhmed?.id,
        responsibleUser: 'أحمد الفاتح محمد',
        shiftId: insertedShifts[0].id,
      },
      {
        reference: 'EXP-2026-302',
        date: '2026-11-15',
        category: 'ترحيل ومواصلات',
        amount: '38000.00',
        description: 'ترحيل توصيل طلبات نقاط البيع الصباحية',
        responsibleUserId: agentAhmed?.id,
        responsibleUser: 'أحمد الفاتح محمد',
        shiftId: insertedShifts[0].id,
      },
      {
        reference: 'EXP-2026-303',
        date: '2026-11-14',
        category: 'كهرباء',
        amount: '120000.00',
        description: 'شحن عداد كهرباء المخبز الآلي (3 فاز)',
        responsibleUserId: ownerUser?.id,
        responsibleUser: 'الطيب حسن عبد الرحمن',
      },
      {
        reference: 'EXP-2026-304',
        date: '2026-11-14',
        category: 'صيانة',
        amount: '65000.00',
        description: 'صيانة سير العجانة الرئيسية',
        responsibleUserId: ownerUser?.id,
        responsibleUser: 'الطيب حسن عبد الرحمن',
      },
    ]);

    await tx.insert(cashTransactions).values([
      {
        reference: 'CSH-2026-000',
        type: 'إيداع نقدي',
        category: 'تمويل وخزينة',
        direction: 'IN',
        amount: '2500000.00',
        date: '2026-11-01',
        relatedEntity: 'خزينة المخبز — الرصيد الافتتاحي',
        recordedByUserId: ownerUser?.id,
        recordedBy: 'الطيب حسن عبد الرحمن',
      },
      {
        reference: 'CSH-2026-001',
        type: 'إيداع مبيعات',
        category: 'مبيعات',
        direction: 'IN',
        amount: '1527500.00',
        date: '2026-11-15',
        shiftId: insertedShifts[0].id,
        relatedEntity: 'مبيعات الوردية الصباحية',
        recordedByUserId: agentAhmed?.id,
        recordedBy: 'أحمد الفاتح محمد',
      },
      {
        reference: 'CSH-2026-002',
        type: 'سحب سداد مورد',
        category: 'موردين',
        direction: 'OUT',
        amount: '1600000.00',
        date: '2026-11-14',
        relatedEntity: 'مطاحن سيقا للغلال',
        recordedByUserId: ownerUser?.id,
        recordedBy: 'الطيب حسن عبد الرحمن',
      },
      {
        reference: 'CSH-2026-003',
        type: 'إيداع مبيعات',
        category: 'مبيعات',
        direction: 'IN',
        amount: '1437500.00',
        date: '2026-11-14',
        shiftId: insertedShifts[1].id,
        relatedEntity: 'مبيعات الوردية المسائية (SAL-2026-895)',
        recordedByUserId: agentOsman?.id,
        recordedBy: 'محمد عثمان إبراهيم',
      },
      {
        reference: 'CSH-2026-004',
        type: 'مصروف تشغيلي',
        category: 'مصروف تشغيلي',
        direction: 'OUT',
        amount: '95000.00',
        date: '2026-11-15',
        shiftId: insertedShifts[0].id,
        relatedEntity: 'وقود وغاز — تعبئة أسطوانات غاز الأفران + جازولين المولد',
        recordedByUserId: agentAhmed?.id,
        recordedBy: 'أحمد الفاتح محمد',
      },
      {
        reference: 'CSH-2026-005',
        type: 'مصروف تشغيلي',
        category: 'مصروف تشغيلي',
        direction: 'OUT',
        amount: '38000.00',
        date: '2026-11-15',
        shiftId: insertedShifts[0].id,
        relatedEntity: 'ترحيل ومواصلات — ترحيل توصيل طلبات نقاط البيع الصباحية',
        recordedByUserId: agentAhmed?.id,
        recordedBy: 'أحمد الفاتح محمد',
      },
      {
        reference: 'CSH-2026-006',
        type: 'مصروف تشغيلي',
        category: 'مصروف تشغيلي',
        direction: 'OUT',
        amount: '120000.00',
        date: '2026-11-14',
        relatedEntity: 'كهرباء — شحن عداد كهرباء المخبز الآلي (3 فاز)',
        recordedByUserId: ownerUser?.id,
        recordedBy: 'الطيب حسن عبد الرحمن',
      },
      {
        reference: 'CSH-2026-007',
        type: 'مصروف تشغيلي',
        category: 'مصروف تشغيلي',
        direction: 'OUT',
        amount: '65000.00',
        date: '2026-11-14',
        relatedEntity: 'صيانة — صيانة سير العجانة الرئيسية',
        recordedByUserId: ownerUser?.id,
        recordedBy: 'الطيب حسن عبد الرحمن',
      },
    ]);

    // 13. Employees
    await tx.insert(employees).values([
      {
        name: 'إبراهيم الصادق',
        jobTitle: 'كبير الخبازين (معلم فرن)',
        phone: '+249 91 223 4455',
        monthlySalary: '320000.00',
        shift: 'الوردية الصباحية',
        attendanceDays: 14,
        paidThisMonth: '150000.00',
      },
      {
        name: 'عمر البشير علي',
        jobTitle: 'فني عجانة وتخمير',
        phone: '+249 91 554 7890',
        monthlySalary: '240000.00',
        shift: 'الوردية الصباحية',
        attendanceDays: 15,
        paidThisMonth: '100000.00',
      },
      {
        name: 'ياسر محجوب',
        jobTitle: 'عامل ترحيل وتوزيع',
        phone: '+249 90 998 1123',
        monthlySalary: '190000.00',
        shift: 'الوردية المسائية',
        attendanceDays: 13,
        paidThisMonth: '90000.00',
      },
    ]);

    // 14. Notifications & Audit Logs
    await tx.insert(notifications).values([
      {
        ruleCode: 'RULE_LOW_STOCK_YEAST',
        severity: 'تنبيه حرج',
        title: 'انخفاض مخزون الخميرة الفورية دون الحد الأدنى',
        message: 'الرصيد الحالي 4,200 جرام أقل من الحد الأدنى المعتمد 6,000 جرام.',
        timestamp: '2026-11-15 08:15',
        isRead: false,
        targetNav: 'inventory',
      },
      {
        ruleCode: 'RULE_LOW_STOCK_SUGAR',
        severity: 'تحذير',
        title: 'انخفاض مخزون السكر الأبيض',
        message: 'الرصيد الحالي 32 كجم أقل من حد التنبيه (40 كجم).',
        timestamp: '2026-11-15 07:40',
        isRead: false,
        targetNav: 'inventory',
      },
      {
        ruleCode: 'RULE_SHIFT_VARIANCE',
        severity: 'تحذير',
        title: 'فارق نقدي عند إغلاق الوردية المسائية',
        message: 'عجز نقدي قدره 4,500 ج.س بانتظار اعتماد المالك.',
        timestamp: '2026-11-14 23:20',
        isRead: false,
        targetNav: 'agents-shifts',
      },
    ]);

    await tx.insert(auditLogs).values([
      {
        reference: 'TX-2026-9901',
        userId: agentAhmed?.id,
        userName: 'أحمد الفاتح محمد',
        role: 'AGENT',
        operationType: 'تسجيل دفعة إنتاج',
        entityType: 'production_records',
        entityId: String(prodRows[0].id),
        affectedRecord: 'PRD-2026-1151 (عيش بلدي سوداني)',
        previousValue: 'مخزون الدقيق: 56 جوال',
        newValue: 'إنتاج 5,180 رغيف · خصم 8 جوالات دقيق',
        timestamp: '2026-11-15 06:30',
      },
      {
        reference: 'TX-2026-9898',
        userId: ownerUser?.id,
        userName: 'الطيب حسن عبد الرحمن',
        role: 'OWNER',
        operationType: 'اعتماد فاتورة مشتريات',
        entityType: 'purchase_invoices',
        entityId: String(insertedInvoices[0].id),
        affectedRecord: 'INV-2026-101 (مطاحن سيقا)',
        previousValue: 'رصيد المورد: 250,000 ج.س',
        newValue: 'إجمالي 2,600,000 ج.س · دفعة أولى 1,600,000 ج.س',
        timestamp: '2026-11-14 14:15',
      },
    ]);
  });
}

const isDirectSeedRun =
  typeof process !== 'undefined' &&
  Array.isArray(process.argv) &&
  /[/\\]seed\.ts$/i.test(process.argv[1] || '');

if (isDirectSeedRun) {
  import('dotenv')
    .then((dotenv) => {
      const envFiles = [
        '.env.local',
        ...(process.env.NODE_ENV === 'production'
          ? ['.env.production.local', '.env.production']
          : []),
        '.env',
      ];
      for (const envPath of envFiles) {
        dotenv.config({ path: envPath, quiet: true });
      }
      return ensureSeeded();
    })
    .then(async () => {
      console.log('SBMS database seed completed.');
      const { pool } = await import('./index.ts');
      await pool.end().catch(() => {});
    })
    .catch((err) => {
      console.error('SBMS database seed failed:', err);
      process.exit(1);
    });
}
