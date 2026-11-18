import { Router } from 'express';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../../db/index.ts';
import {
  bakerySettings,
  cashTransactions,
  inventoryBatches,
  inventoryItems,
  purchaseInvoiceItems,
  purchaseInvoices,
  stockMovements,
  supplierPayments,
  supplierProducts,
  suppliers,
} from '../../db/schema.ts';
import { type AuthRequest, requireAuth, requireRole } from '../../middleware/auth.ts';
import { generateReference, recordAuditLog } from '../audit.ts';
import { calculateWeightedAverageCost } from '../accounting/formulas.ts';

const router = Router();

// All supplier endpoints require authenticated OWNER
router.use(requireAuth, requireRole('OWNER'));

const PAYMENT_METHODS = ['نقداً', 'تحويل بنكي (بنكك)', 'شيك'] as const;

function mapSupplier(s: typeof suppliers.$inferSelect) {
  return {
    id: String(s.id),
    code: s.code,
    name: s.name,
    phone: s.phone,
    address: s.address,
    categories: s.categories || [],
    totalPurchases: Number(s.totalPurchases),
    totalPayments: Number(s.totalPayments),
    adjustments: Number(s.adjustments),
    outstandingBalance: Number(
      (Number(s.totalPurchases) - Number(s.totalPayments) + Number(s.adjustments)).toFixed(2)
    ),
    status: s.status as 'نشط' | 'موقوف',
    lastTransactionDate: s.lastTransactionDate,
    notes: s.notes ?? undefined,
  };
}

function mapInvoice(
  inv: typeof purchaseInvoices.$inferSelect,
  supplierName: string,
  items: (typeof purchaseInvoiceItems.$inferSelect)[]
) {
  return {
    id: String(inv.id),
    invoiceNumber: inv.invoiceNumber,
    reference: inv.reference,
    supplierId: String(inv.supplierId),
    supplierName,
    date: inv.date,
    items: items.map((it) => ({
      inventoryItemId: String(it.inventoryItemId),
      itemName: it.itemName,
      quantity: Number(it.quantity),
      unit: it.unit,
      unitPrice: Number(it.unitPrice),
      total: Number(it.total),
      batchCode: it.batchCode ?? undefined,
      expiryDate: it.expiryDate ?? undefined,
    })),
    totalAmount: Number(inv.totalAmount),
    initialPayment: Number(inv.initialPayment),
    initialPaymentMethod: inv.initialPaymentMethod as (typeof PAYMENT_METHODS)[number],
    paidAmount: Number(inv.paidAmount),
    remainingBalance: Number(inv.remainingBalance),
    status: inv.status,
    workflowStatus: inv.workflowStatus as 'مسودة' | 'مرحّلة' | 'ملغاة',
    notes: inv.notes ?? undefined,
    cancelledReason: inv.cancelledReason ?? undefined,
    createdBy: inv.createdBy,
  };
}

// Helper to execute posting logic inside a DB transaction
async function postInvoiceItemsAndFinancials(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  params: {
    invoice: typeof purchaseInvoices.$inferSelect;
    supplier: typeof suppliers.$inferSelect;
    items: (typeof purchaseInvoiceItems.$inferSelect)[];
    user: NonNullable<AuthRequest['authUser']>;
  }
) {
  const { invoice, supplier, items, user } = params;
  const totalAmount = Number(invoice.totalAmount);
  const initialPayment = Number(invoice.initialPayment);
  const remainingBalance = Number((totalAmount - initialPayment).toFixed(2));
  const paymentStatus =
    remainingBalance === 0
      ? 'مدفوعة بالكامل'
      : initialPayment > 0
      ? 'مدفوعة جزئياً'
      : 'آجلة';

  const inventorySnapshots: string[] = [];

  for (const line of items) {
    const [item] = await tx
      .select()
      .from(inventoryItems)
      .where(eq(inventoryItems.id, line.inventoryItemId))
      .limit(1);

    if (!item) {
      throw new Error('ITEM_NOT_FOUND');
    }

    const lineQty = Number(line.quantity);
    const lineUnitPrice = Number(line.unitPrice);
    const lineTotal = Number(line.total);

    const prevQty = Number(item.availableQuantity);
    const prevCost = Number(item.averageCost);
    const { nextQuantity: nextQty, nextAverageCost: nextAvgCost } = calculateWeightedAverageCost({
      previousQty: prevQty,
      previousAverageCost: prevCost,
      addedQty: lineQty,
      lineTotal,
      fallbackUnitPrice: lineUnitPrice,
    });

    const effectiveBatchCode =
      line.batchCode?.trim() || `BCH-${invoice.invoiceNumber}-${item.id}`;

    await tx
      .update(inventoryItems)
      .set({
        availableQuantity: nextQty.toFixed(3),
        averageCost: nextAvgCost.toFixed(2),
        batchCode: effectiveBatchCode,
        ...(line.expiryDate ? { expiryDate: line.expiryDate } : {}),
        lastUpdated: invoice.date,
      })
      .where(eq(inventoryItems.id, item.id));

    await tx.insert(inventoryBatches).values({
      inventoryItemId: item.id,
      batchCode: effectiveBatchCode,
      quantityRemaining: lineQty.toFixed(3),
      unitCost: lineUnitPrice.toFixed(2),
      expiryDate: line.expiryDate ?? null,
      receivedDate: invoice.date,
    });

    await tx.insert(stockMovements).values({
      reference: generateReference('STK'),
      inventoryItemId: item.id,
      itemName: item.name,
      type: 'استلام مشتريات',
      quantityDelta: lineQty.toFixed(3),
      unit: item.unit,
      balanceAfter: nextQty.toFixed(3),
      batchCode: effectiveBatchCode,
      expiryDate: line.expiryDate ?? null,
      relatedSupplierId: supplier.id,
      date: invoice.date,
      performedByUserId: user.id,
      performedBy: user.fullName,
      notes: `فاتورة ${invoice.invoiceNumber} — ${supplier.name}`,
    });

    // Upsert/record supplier product price reference
    const [existingSupProd] = await tx
      .select()
      .from(supplierProducts)
      .where(
        and(
          eq(supplierProducts.supplierId, supplier.id),
          eq(supplierProducts.productName, item.name)
        )
      )
      .limit(1);

    if (existingSupProd) {
      await tx
        .update(supplierProducts)
        .set({ lastUnitPrice: lineUnitPrice.toFixed(2), unit: item.unit })
        .where(eq(supplierProducts.id, existingSupProd.id));
    } else {
      await tx.insert(supplierProducts).values({
        supplierId: supplier.id,
        productName: item.name,
        unit: item.unit,
        lastUnitPrice: lineUnitPrice.toFixed(2),
      });
    }

    inventorySnapshots.push(`${item.name}: +${lineQty} ${item.unit}`);
  }

  // Update invoice workflow & payment status
  const [postedInvoice] = await tx
    .update(purchaseInvoices)
    .set({
      workflowStatus: 'مرحّلة',
      status: paymentStatus,
      paidAmount: initialPayment.toFixed(2),
      remainingBalance: remainingBalance.toFixed(2),
      postedAt: new Date(),
    })
    .where(eq(purchaseInvoices.id, invoice.id))
    .returning();

  // Update supplier liabilities
  const nextSupPurchases = Number((Number(supplier.totalPurchases) + totalAmount).toFixed(2));
  const nextSupPayments = Number((Number(supplier.totalPayments) + initialPayment).toFixed(2));

  await tx
    .update(suppliers)
    .set({
      totalPurchases: nextSupPurchases.toFixed(2),
      totalPayments: nextSupPayments.toFixed(2),
      lastTransactionDate: invoice.date,
    })
    .where(eq(suppliers.id, supplier.id));

  if (initialPayment > 0) {
    const payRef = generateReference('PAY');
    await tx.insert(supplierPayments).values({
      reference: payRef,
      supplierId: supplier.id,
      invoiceId: invoice.id,
      date: invoice.date,
      amount: initialPayment.toFixed(2),
      method: invoice.initialPaymentMethod || 'نقداً',
      notes: `دفعة أولى للفاتورة ${invoice.invoiceNumber}`,
      recordedByUserId: user.id,
      recordedBy: user.fullName,
    });

    await tx.insert(cashTransactions).values({
      reference: generateReference('CSH'),
      type: 'سحب سداد مورد',
      category: 'سداد مورد',
      direction: 'OUT',
      amount: initialPayment.toFixed(2),
      date: invoice.date,
      paymentMethod: invoice.initialPaymentMethod || 'نقداً',
      relatedEntity: `${supplier.name} (${invoice.invoiceNumber})`,
      recordedByUserId: user.id,
      recordedBy: user.fullName,
    });
  }

  await recordAuditLog(tx, {
    userId: user.id,
    userName: user.fullName,
    role: user.role,
    operationType: 'ترحيل واعتماد فاتورة مشتريات',
    entityType: 'purchase_invoices',
    entityId: String(invoice.id),
    affectedRecord: `${invoice.invoiceNumber} (${supplier.name})`,
    previousValue: invoice.workflowStatus === 'مسودة' ? 'مسودة' : 'فاتورة جديدة',
    newValue: `مرحّلة · مرجع ${invoice.reference} · إجمالي ${totalAmount} ج.س · ${inventorySnapshots.join('، ')}`,
  });

  return postedInvoice;
}

// GET /api/suppliers (supports search, status, category, page, limit)
router.get('/', async (req, res) => {
  try {
    const search = String(req.query.search || '').trim();
    const status = String(req.query.status || 'ALL').trim();
    const category = String(req.query.category || 'ALL').trim();
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 100));

    const rows = await db.select().from(suppliers).orderBy(desc(suppliers.id));
    let mapped = rows.map(mapSupplier);

    if (search) {
      const q = search.toLowerCase();
      mapped = mapped.filter(
        (s) =>
          s.name.toLowerCase().includes(q) ||
          s.code.toLowerCase().includes(q) ||
          s.phone.toLowerCase().includes(q) ||
          s.address.toLowerCase().includes(q)
      );
    }
    if (status && status !== 'ALL') {
      mapped = mapped.filter((s) => s.status === status);
    }
    if (category && category !== 'ALL') {
      mapped = mapped.filter((s) => s.categories.some((c) => c.includes(category)));
    }

    const total = mapped.length;
    const totalPages = Math.max(1, Math.ceil(total / limit));
    const offset = (page - 1) * limit;
    const paged = mapped.slice(offset, offset + limit);

    return res.json({
      suppliers: paged,
      pagination: { total, page, limit, totalPages },
    });
  } catch (error) {
    console.error('Get suppliers error:', error);
    return res.status(500).json({ error: 'تعذر تحميل بيانات الموردين.' });
  }
});

// GET /api/suppliers/invoices (MUST stay above /:id)
router.get('/invoices', async (req, res) => {
  try {
    const search = String(req.query.search || '').trim().toLowerCase();
    const supplierIdParam = req.query.supplierId ? Number(req.query.supplierId) : null;
    const workflowStatus = String(req.query.workflowStatus || 'ALL').trim();
    const paymentStatus = String(req.query.paymentStatus || 'ALL').trim();
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));

    const [supRows, invRows, itemRows] = await Promise.all([
      db.select().from(suppliers),
      db.select().from(purchaseInvoices).orderBy(desc(purchaseInvoices.id)),
      db.select().from(purchaseInvoiceItems),
    ]);

    const supMap = new Map(supRows.map((s) => [s.id, s.name]));
    const itemsByInv = new Map<number, (typeof purchaseInvoiceItems.$inferSelect)[]>();
    for (const it of itemRows) {
      const arr = itemsByInv.get(it.invoiceId) || [];
      arr.push(it);
      itemsByInv.set(it.invoiceId, arr);
    }

    let mapped = invRows.map((inv) =>
      mapInvoice(inv, supMap.get(inv.supplierId) || '', itemsByInv.get(inv.id) || [])
    );

    if (supplierIdParam && Number.isInteger(supplierIdParam)) {
      mapped = mapped.filter((i) => Number(i.supplierId) === supplierIdParam);
    }
    if (workflowStatus && workflowStatus !== 'ALL') {
      mapped = mapped.filter((i) => i.workflowStatus === workflowStatus);
    }
    if (paymentStatus && paymentStatus !== 'ALL') {
      mapped = mapped.filter((i) => i.status === paymentStatus);
    }
    if (search) {
      mapped = mapped.filter(
        (i) =>
          i.invoiceNumber.toLowerCase().includes(search) ||
          i.supplierName.toLowerCase().includes(search) ||
          i.items.some((it) => it.itemName.toLowerCase().includes(search))
      );
    }

    const total = mapped.length;
    const totalPages = Math.max(1, Math.ceil(total / limit));
    const offset = (page - 1) * limit;

    return res.json({
      invoices: mapped.slice(offset, offset + limit),
      pagination: { total, page, limit, totalPages },
    });
  } catch (error) {
    console.error('Get purchase invoices error:', error);
    return res.status(500).json({ error: 'تعذر تحميل فواتير المشتريات.' });
  }
});

// GET /api/suppliers/:id — Supplier Profile, History, Products & Account Statement
router.get('/:id', async (req, res) => {
  try {
    const supplierId = Number(req.params.id);
    if (!Number.isInteger(supplierId)) {
      return res.status(400).json({ error: 'معرف المورد غير صالح.' });
    }

    const [sup] = await db.select().from(suppliers).where(eq(suppliers.id, supplierId)).limit(1);
    if (!sup) {
      return res.status(404).json({ error: 'المورد غير موجود.' });
    }

    const invRows = await db
      .select()
      .from(purchaseInvoices)
      .where(eq(purchaseInvoices.supplierId, supplierId))
      .orderBy(desc(purchaseInvoices.id));

    const invIds = invRows.map((i) => i.id);
    const itemRows =
      invIds.length > 0
        ? await db
            .select()
            .from(purchaseInvoiceItems)
            .where(inArray(purchaseInvoiceItems.invoiceId, invIds))
        : [];

    const payRows = await db
      .select()
      .from(supplierPayments)
      .where(eq(supplierPayments.supplierId, supplierId))
      .orderBy(desc(supplierPayments.id));

    const prodRows = await db
      .select()
      .from(supplierProducts)
      .where(eq(supplierProducts.supplierId, supplierId));

    const invNumById = new Map(invRows.map((i) => [i.id, i.invoiceNumber]));
    const mappedInvoices = invRows.map((inv) =>
      mapInvoice(
        inv,
        sup.name,
        itemRows.filter((it) => it.invoiceId === inv.id)
      )
    );

    const mappedPayments = payRows.map((p) => ({
      id: String(p.id),
      reference: p.reference,
      supplierId: String(p.supplierId),
      invoiceId: p.invoiceId ? String(p.invoiceId) : undefined,
      invoiceNumber: p.invoiceId ? invNumById.get(p.invoiceId) : undefined,
      date: p.date,
      amount: Number(p.amount),
      method: p.method,
      notes: p.notes ?? undefined,
      recordedBy: p.recordedBy,
      isReversal: p.isReversal,
    }));

    // Build chronological statement with running balance (posted invoices + payments)
    const ledgerEntries = [
      ...mappedInvoices
        .filter((inv) => inv.workflowStatus === 'مرحّلة')
        .map((inv) => ({
          id: `inv-${inv.id}`,
          date: inv.date,
          type: 'فاتورة مشتريات',
          reference: inv.invoiceNumber,
          description: inv.items.map((it) => `${it.itemName} (${it.quantity} ${it.unit})`).join('، '),
          debit: inv.totalAmount,
          credit: 0,
        })),
      ...mappedPayments.map((pay) => ({
        id: `pay-${pay.id}`,
        date: pay.date,
        type: pay.isReversal ? 'قيد عكسي لدفعة' : 'دفعة سداد',
        reference: pay.reference,
        description: `${pay.method}${pay.invoiceNumber ? ` · فاتورة ${pay.invoiceNumber}` : ''}${
          pay.notes ? ` · ${pay.notes}` : ''
        }`,
        debit: pay.amount < 0 ? Math.abs(pay.amount) : 0,
        credit: pay.amount > 0 ? pay.amount : 0,
      })),
    ].sort((a, b) => (a.date > b.date ? 1 : a.date < b.date ? -1 : a.id.localeCompare(b.id)));

    let runningBalance = Number(sup.adjustments);
    const statement = ledgerEntries.map((entry) => {
      runningBalance = Number((runningBalance + entry.debit - entry.credit).toFixed(2));
      return { ...entry, runningBalance };
    });

    return res.json({
      supplier: mapSupplier(sup),
      invoices: mappedInvoices,
      payments: mappedPayments,
      products: prodRows.map((pr) => ({
        id: String(pr.id),
        productName: pr.productName,
        unit: pr.unit,
        lastUnitPrice: Number(pr.lastUnitPrice),
      })),
      statement,
    });
  } catch (error) {
    console.error('Get supplier profile error:', error);
    return res.status(500).json({ error: 'تعذر تحميل الملف المالي للمورد.' });
  }
});

const createSupplierSchema = z.object({
  name: z.string().trim().min(2, 'اسم المورد مطلوب (حرفان على الأقل)'),
  phone: z.string().trim().min(6, 'رقم الهاتف مطلوب'),
  address: z.string().trim().default('الخرطوم'),
  categories: z.array(z.string().trim().min(1)).default(['دقيق قمح']),
  status: z.enum(['نشط', 'موقوف']).default('نشط'),
  notes: z.string().optional(),
});

router.post('/', async (req: AuthRequest, res) => {
  try {
    const parsed = createSupplierSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message || 'بيانات المورد غير صالحة' });
    }

    const result = await db.transaction(async (tx) => {
      const existingRows = await tx
        .select({ id: suppliers.id })
        .from(suppliers)
        .orderBy(desc(suppliers.id))
        .limit(1);
      const nextNum = (existingRows[0]?.id ?? 0) + 1;
      const code = `SUP-${String(nextNum).padStart(3, '0')}`;
      const today = new Date().toISOString().slice(0, 10);

      const [created] = await tx
        .insert(suppliers)
        .values({
          code,
          name: parsed.data.name,
          phone: parsed.data.phone,
          address: parsed.data.address,
          categories: parsed.data.categories.length > 0 ? parsed.data.categories : ['مواد خام'],
          status: parsed.data.status,
          lastTransactionDate: today,
          notes: parsed.data.notes ?? null,
        })
        .returning();

      await recordAuditLog(tx, {
        userId: req.authUser!.id,
        userName: req.authUser!.fullName,
        role: req.authUser!.role,
        operationType: 'إضافة مورد جديد',
        entityType: 'suppliers',
        entityId: String(created.id),
        affectedRecord: created.name,
        newValue: `الكود: ${created.code} · الهاتف: ${created.phone}`,
      });

      return mapSupplier(created);
    });

    return res.status(201).json({ supplier: result });
  } catch (error) {
    console.error('Create supplier error:', error);
    return res.status(500).json({ error: 'تعذر حفظ المورد في قاعدة البيانات.' });
  }
});

router.patch('/:id', async (req: AuthRequest, res) => {
  try {
    const supplierId = Number(req.params.id);
    if (!Number.isInteger(supplierId)) {
      return res.status(400).json({ error: 'معرف المورد غير صالح.' });
    }

    const updateSchema = z.object({
      name: z.string().trim().min(2).optional(),
      phone: z.string().trim().min(6).optional(),
      address: z.string().trim().optional(),
      categories: z.array(z.string().trim().min(1)).optional(),
      status: z.enum(['نشط', 'موقوف']).optional(),
      notes: z.string().optional(),
    });
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'بيانات التحديث غير صالحة.' });
    }

    const updated = await db.transaction(async (tx) => {
      const [existing] = await tx.select().from(suppliers).where(eq(suppliers.id, supplierId)).limit(1);
      if (!existing) return null;

      const [next] = await tx
        .update(suppliers)
        .set({
          ...(parsed.data.name ? { name: parsed.data.name } : {}),
          ...(parsed.data.phone ? { phone: parsed.data.phone } : {}),
          ...(parsed.data.address !== undefined ? { address: parsed.data.address } : {}),
          ...(parsed.data.categories ? { categories: parsed.data.categories } : {}),
          ...(parsed.data.status ? { status: parsed.data.status } : {}),
          ...(parsed.data.notes !== undefined ? { notes: parsed.data.notes } : {}),
        })
        .where(eq(suppliers.id, supplierId))
        .returning();

      await recordAuditLog(tx, {
        userId: req.authUser!.id,
        userName: req.authUser!.fullName,
        role: req.authUser!.role,
        operationType:
          parsed.data.status && parsed.data.status !== existing.status
            ? parsed.data.status === 'موقوف'
              ? 'إيقاف مورد'
              : 'تفعيل مورد'
            : 'تعديل بيانات مورد',
        entityType: 'suppliers',
        entityId: String(supplierId),
        affectedRecord: next.name,
        previousValue: `${existing.name} (${existing.status})`,
        newValue: `${next.name} (${next.status})`,
      });

      return mapSupplier(next);
    });

    if (!updated) return res.status(404).json({ error: 'المورد غير موجود.' });
    return res.json({ supplier: updated });
  } catch (error) {
    console.error('Update supplier error:', error);
    return res.status(500).json({ error: 'تعذر تحديث بيانات المورد.' });
  }
});

const invoiceLineSchema = z.object({
  inventoryItemId: z.coerce.number().int().positive(),
  quantity: z.coerce.number().positive('الكمية يجب أن تكون أكبر من صفر'),
  unit: z.string().trim().min(1).optional(),
  unitPrice: z.coerce.number().positive('سعر الوحدة يجب أن يكون أكبر من صفر'),
  batchCode: z.string().trim().optional(),
  expiryDate: z.string().trim().optional(),
});

const createInvoiceSchema = z
  .object({
    supplierId: z.coerce.number().int().positive(),
    invoiceNumber: z.string().trim().optional(),
    date: z.string().trim().min(8),
    workflowStatus: z.enum(['مسودة', 'مرحّلة']).default('مرحّلة'),
    items: z.array(invoiceLineSchema).min(1).optional(),
    // Backwards-compatible legacy single-item fields
    inventoryItemId: z.coerce.number().int().positive().optional(),
    quantity: z.coerce.number().positive().optional(),
    unit: z.string().trim().optional(),
    unitPrice: z.coerce.number().positive().optional(),
    batchCode: z.string().trim().optional(),
    expiryDate: z.string().trim().optional(),
    initialPayment: z.coerce.number().min(0).default(0),
    initialPaymentMethod: z.enum(PAYMENT_METHODS).default('نقداً'),
    notes: z.string().optional(),
    clientTxId: z.string().trim().optional(),
  })
  .refine(
    (data) =>
      (data.items && data.items.length > 0) ||
      (data.inventoryItemId && data.quantity && data.unitPrice),
    { message: 'يجب إضافة صنف واحد على الأقل إلى فاتورة المشتريات.' }
  );

router.post('/invoices', async (req: AuthRequest, res) => {
  try {
    const parsed = createInvoiceSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message || 'بيانات الفاتورة غير مكتملة' });
    }

    const d = parsed.data;
    const normalizedItems =
      d.items && d.items.length > 0
        ? d.items
        : [
            {
              inventoryItemId: d.inventoryItemId!,
              quantity: d.quantity!,
              unit: d.unit,
              unitPrice: d.unitPrice!,
              batchCode: d.batchCode,
              expiryDate: d.expiryDate,
            },
          ];

    const outcome = await db.transaction(async (tx) => {
      if (d.clientTxId) {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${d.clientTxId}))`);
        const [existingTx] = await tx
          .select()
          .from(purchaseInvoices)
          .where(eq(purchaseInvoices.clientTxId, d.clientTxId))
          .limit(1);
        if (existingTx) {
          throw new Error('DUPLICATE_TX');
        }
      }

      const [sup] = await tx.select().from(suppliers).where(eq(suppliers.id, d.supplierId)).limit(1);
      if (!sup) {
        throw new Error('NOT_FOUND');
      }
      if (sup.status === 'موقوف') {
        throw new Error('SUPPLIER_INACTIVE');
      }

      // Auto-generate unique invoice number if omitted or 'AUTO'
      let finalInvoiceNumber = d.invoiceNumber?.trim() || '';
      if (!finalInvoiceNumber || finalInvoiceNumber === 'AUTO') {
        const year = d.date.slice(0, 4) || new Date().getFullYear().toString();
        const latest = await tx
          .select({ id: purchaseInvoices.id })
          .from(purchaseInvoices)
          .orderBy(desc(purchaseInvoices.id))
          .limit(1);
        const seq = (latest[0]?.id ?? 0) + 101;
        finalInvoiceNumber = `INV-${year}-${seq}-${String(Date.now()).slice(-3)}`;
      }

      const [dup] = await tx
        .select()
        .from(purchaseInvoices)
        .where(eq(purchaseInvoices.invoiceNumber, finalInvoiceNumber))
        .limit(1);
      if (dup) {
        throw new Error('DUPLICATE_INVOICE');
      }

      // Validate all items & compute grand total
      const validatedLines: {
        dbItem: typeof inventoryItems.$inferSelect;
        quantity: number;
        unitPrice: number;
        lineTotal: number;
        batchCode?: string;
        expiryDate?: string;
      }[] = [];

      let totalAmount = 0;
      for (const line of normalizedItems) {
        const [item] = await tx
          .select()
          .from(inventoryItems)
          .where(eq(inventoryItems.id, line.inventoryItemId))
          .limit(1);
        if (!item) {
          throw new Error('NOT_FOUND');
        }
        if (line.unit && line.unit !== item.unit) {
          throw new Error(`UNIT_MISMATCH:${item.name}:${item.unit}:${line.unit}`);
        }
        const lineTotal = Number((line.quantity * line.unitPrice).toFixed(2));
        totalAmount = Number((totalAmount + lineTotal).toFixed(2));
        validatedLines.push({
          dbItem: item,
          quantity: line.quantity,
          unitPrice: line.unitPrice,
          lineTotal,
          batchCode: line.batchCode,
          expiryDate: line.expiryDate,
        });
      }

      if (d.initialPayment > totalAmount) {
        throw new Error('OVERPAYMENT');
      }

      const actualInitialPayment = Number(Math.min(Math.max(0, d.initialPayment), totalAmount).toFixed(2));
      const invRef = generateReference('PUR');

      const [createdInvoice] = await tx
        .insert(purchaseInvoices)
        .values({
          invoiceNumber: finalInvoiceNumber,
          reference: invRef,
          clientTxId: d.clientTxId ?? null,
          supplierId: sup.id,
          date: d.date,
          totalAmount: totalAmount.toFixed(2),
          initialPayment: actualInitialPayment.toFixed(2),
          initialPaymentMethod: d.initialPaymentMethod,
          paidAmount: d.workflowStatus === 'مرحّلة' ? actualInitialPayment.toFixed(2) : '0.00',
          remainingBalance:
            d.workflowStatus === 'مرحّلة'
              ? Number((totalAmount - actualInitialPayment).toFixed(2)).toFixed(2)
              : totalAmount.toFixed(2),
          status: d.workflowStatus === 'مسودة' ? 'مسودة' : 'آجلة',
          workflowStatus: d.workflowStatus,
          notes: d.notes ?? null,
          createdByUserId: req.authUser!.id,
          createdBy: req.authUser!.fullName,
        })
        .returning();

      const insertedItems = await tx
        .insert(purchaseInvoiceItems)
        .values(
          validatedLines.map((vl) => ({
            invoiceId: createdInvoice.id,
            inventoryItemId: vl.dbItem.id,
            itemName: vl.dbItem.name,
            quantity: vl.quantity.toFixed(3),
            unit: vl.dbItem.unit,
            unitPrice: vl.unitPrice.toFixed(2),
            total: vl.lineTotal.toFixed(2),
            batchCode: vl.batchCode ?? null,
            expiryDate: vl.expiryDate ?? null,
          }))
        )
        .returning();

      if (d.workflowStatus === 'مسودة') {
        await recordAuditLog(tx, {
          userId: req.authUser!.id,
          userName: req.authUser!.fullName,
          role: req.authUser!.role,
          operationType: 'حفظ مسودة فاتورة مشتريات',
          entityType: 'purchase_invoices',
          entityId: String(createdInvoice.id),
          affectedRecord: `${finalInvoiceNumber} (${sup.name})`,
          newValue: `مسودة · إجمالي ${totalAmount} ج.س · ${insertedItems.length} أصناف`,
          reference: invRef,
        });
        return createdInvoice;
      }

      return await postInvoiceItemsAndFinancials(tx, {
        invoice: createdInvoice,
        supplier: sup,
        items: insertedItems,
        user: req.authUser!,
      });
    });

    return res.status(201).json({
      invoiceId: String(outcome.id),
      invoiceNumber: outcome.invoiceNumber,
      workflowStatus: outcome.workflowStatus,
      status: outcome.status,
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : '';
    if (msg === 'DUPLICATE_INVOICE') {
      return res.status(409).json({ error: 'رقم الفاتورة مسجل مسبقاً. يمنع تكرار الفواتير.' });
    }
    if (msg === 'DUPLICATE_TX') {
      return res.status(409).json({ error: 'تم استلام هذا الطلب مسبقاً (منع تكرار الفاتورة).' });
    }
    if (msg === 'NOT_FOUND' || msg === 'ITEM_NOT_FOUND') {
      return res.status(404).json({ error: 'المورد أو أحد أصناف المخزون غير موجود.' });
    }
    if (msg === 'SUPPLIER_INACTIVE') {
      return res.status(400).json({ error: 'لا يمكن إنشاء أو ترحيل فاتورة لمورد موقوف.' });
    }
    if (msg === 'OVERPAYMENT') {
      return res.status(400).json({ error: 'الدفعة الأولى لا يمكن أن تتجاوز إجمالي الفاتورة.' });
    }
    if (msg.startsWith('UNIT_MISMATCH:')) {
      const [, itemName, expectedUnit, givenUnit] = msg.split(':');
      return res.status(400).json({
        error: `وحدة القياس (${givenUnit}) للصنف "${itemName}" لا تطابق الوحدة المعتمدة (${expectedUnit}).`,
      });
    }
    console.error('Create purchase invoice error:', error);
    return res.status(500).json({ error: 'تعذر حفظ فاتورة المشتريات. تم التراجع عن العملية بالكامل.' });
  }
});

// POST /api/suppliers/invoices/:invoiceId/post — Post a Draft invoice atomically
router.post('/invoices/:invoiceId/post', async (req: AuthRequest, res) => {
  try {
    const invoiceId = Number(req.params.invoiceId);
    if (!Number.isInteger(invoiceId)) {
      return res.status(400).json({ error: 'معرف الفاتورة غير صالح.' });
    }

    const posted = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(${100000 + invoiceId})`);
      const [inv] = await tx
        .select()
        .from(purchaseInvoices)
        .where(eq(purchaseInvoices.id, invoiceId))
        .limit(1);
      if (!inv) throw new Error('NOT_FOUND');
      if (inv.workflowStatus === 'مرحّلة') throw new Error('ALREADY_POSTED');
      if (inv.workflowStatus === 'ملغاة') throw new Error('ALREADY_CANCELLED');

      const [sup] = await tx
        .select()
        .from(suppliers)
        .where(eq(suppliers.id, inv.supplierId))
        .limit(1);
      if (!sup) throw new Error('NOT_FOUND');
      if (sup.status === 'موقوف') throw new Error('SUPPLIER_INACTIVE');

      const items = await tx
        .select()
        .from(purchaseInvoiceItems)
        .where(eq(purchaseInvoiceItems.invoiceId, inv.id));

      return await postInvoiceItemsAndFinancials(tx, {
        invoice: inv,
        supplier: sup,
        items,
        user: req.authUser!,
      });
    });

    return res.json({
      ok: true,
      invoiceId: String(posted.id),
      workflowStatus: posted.workflowStatus,
      status: posted.status,
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : '';
    if (msg === 'NOT_FOUND' || msg === 'ITEM_NOT_FOUND') {
      return res.status(404).json({ error: 'الفاتورة أو المورد غير موجود.' });
    }
    if (msg === 'ALREADY_POSTED') {
      return res.status(409).json({ error: 'هذه الفاتورة مرحّلة بالفعل.' });
    }
    if (msg === 'ALREADY_CANCELLED') {
      return res.status(400).json({ error: 'لا يمكن ترحيل فاتورة ملغاة.' });
    }
    if (msg === 'SUPPLIER_INACTIVE') {
      return res.status(400).json({ error: 'لا يمكن ترحيل فاتورة لمورد موقوف.' });
    }
    console.error('Post draft invoice error:', error);
    return res.status(500).json({ error: 'تعذر ترحيل الفاتورة.' });
  }
});

// POST /api/suppliers/invoices/:invoiceId/cancel — Cancel Draft or Posted invoice atomically
router.post('/invoices/:invoiceId/cancel', async (req: AuthRequest, res) => {
  try {
    const invoiceId = Number(req.params.invoiceId);
    const reason = String(req.body?.reason || 'إلغاء فاتورة مشتريات بقرار إداري').trim();
    if (!Number.isInteger(invoiceId) || reason.length < 3) {
      return res.status(400).json({ error: 'يرجى تحديد معرف الفاتورة وسبب الإلغاء.' });
    }

    await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(${100000 + invoiceId})`);
      const [inv] = await tx
        .select()
        .from(purchaseInvoices)
        .where(eq(purchaseInvoices.id, invoiceId))
        .limit(1);
      if (!inv) throw new Error('NOT_FOUND');
      if (inv.workflowStatus === 'ملغاة') throw new Error('ALREADY_CANCELLED');

      const [sup] = await tx
        .select()
        .from(suppliers)
        .where(eq(suppliers.id, inv.supplierId))
        .limit(1);
      if (!sup) throw new Error('NOT_FOUND');

      if (inv.workflowStatus === 'مرحّلة') {
        // Check linked payments excluding reversals
        const linkedPayments = await tx
          .select()
          .from(supplierPayments)
          .where(eq(supplierPayments.invoiceId, inv.id));

        const netPaidOnInvoice = linkedPayments.reduce((acc, p) => acc + Number(p.amount), 0);
        if (netPaidOnInvoice > Number(inv.initialPayment) + 0.01) {
          throw new Error('HAS_SUBSEQUENT_PAYMENTS');
        }

        const [settingsRow] = await tx.select().from(bakerySettings).limit(1);
        const allowNeg = settingsRow?.allowNegativeInventory ?? false;

        const items = await tx
          .select()
          .from(purchaseInvoiceItems)
          .where(eq(purchaseInvoiceItems.invoiceId, inv.id));

        const today = new Date().toISOString().slice(0, 10);

        for (const line of items) {
          const [item] = await tx
            .select()
            .from(inventoryItems)
            .where(eq(inventoryItems.id, line.inventoryItemId))
            .limit(1);
          if (!item) throw new Error('NOT_FOUND');

          const lineQty = Number(line.quantity);
          const prevQty = Number(item.availableQuantity);
          const nextQty = Number((prevQty - lineQty).toFixed(3));
          if (nextQty < 0 && !allowNeg) {
            throw new Error(`NEGATIVE_STOCK:${item.name}:${prevQty}:${item.unit}`);
          }

          await tx
            .update(inventoryItems)
            .set({ availableQuantity: nextQty.toFixed(3), lastUpdated: today })
            .where(eq(inventoryItems.id, item.id));

          // Deduct cancelled quantity from matching batch first, then FEFO
          const invoiceBatchCode =
            line.batchCode?.trim() || `BCH-${inv.invoiceNumber}-${item.id}`;
          const itemBatches = await tx
            .select()
            .from(inventoryBatches)
            .where(eq(inventoryBatches.inventoryItemId, item.id))
            .orderBy(asc(inventoryBatches.expiryDate), asc(inventoryBatches.id));

          itemBatches.sort((a, b) => {
            if (a.batchCode === invoiceBatchCode && b.batchCode !== invoiceBatchCode) return -1;
            if (b.batchCode === invoiceBatchCode && a.batchCode !== invoiceBatchCode) return 1;
            return 0;
          });

          let toDeduct = lineQty;
          for (const batch of itemBatches) {
            if (toDeduct <= 0) break;
            const rem = Number(batch.quantityRemaining);
            if (rem <= 0) continue;
            const used = Math.min(rem, toDeduct);
            await tx
              .update(inventoryBatches)
              .set({ quantityRemaining: Number((rem - used).toFixed(3)).toFixed(3) })
              .where(eq(inventoryBatches.id, batch.id));
            toDeduct = Number((toDeduct - used).toFixed(3));
          }

          await tx.insert(stockMovements).values({
            reference: generateReference('STK'),
            inventoryItemId: item.id,
            itemName: item.name,
            type: 'إلغاء فاتورة شراء',
            quantityDelta: (-lineQty).toFixed(3),
            unit: item.unit,
            balanceAfter: nextQty.toFixed(3),
            batchCode: invoiceBatchCode,
            relatedSupplierId: sup.id,
            date: today,
            performedByUserId: req.authUser!.id,
            performedBy: req.authUser!.fullName,
            notes: `إلغاء فاتورة ${inv.invoiceNumber}: ${reason}`,
          });
        }

        // Reverse supplier purchases & initial payment if applicable
        const nextTotalPurchases = Number(
          Math.max(0, Number(sup.totalPurchases) - Number(inv.totalAmount)).toFixed(2)
        );
        let nextTotalPayments = Number(sup.totalPayments);

        if (netPaidOnInvoice > 0) {
          const revRef = `REV-CAN-${inv.invoiceNumber}`;
          await tx.insert(supplierPayments).values({
            reference: revRef,
            supplierId: sup.id,
            invoiceId: inv.id,
            date: today,
            amount: (-netPaidOnInvoice).toFixed(2),
            method: inv.initialPaymentMethod || 'نقداً',
            notes: `استرداد/عكس دفعة لإلغاء الفاتورة ${inv.invoiceNumber}`,
            recordedByUserId: req.authUser!.id,
            recordedBy: req.authUser!.fullName,
            isReversal: true,
          });
          await tx.insert(cashTransactions).values({
            reference: generateReference('CSH'),
            type: 'استرداد إلغاء فاتورة مورد',
            category: 'قيد عكسي',
            direction: 'IN',
            amount: netPaidOnInvoice.toFixed(2),
            date: today,
            paymentMethod: inv.initialPaymentMethod || 'نقداً',
            relatedEntity: `${sup.name} (${inv.invoiceNumber})`,
            recordedByUserId: req.authUser!.id,
            recordedBy: req.authUser!.fullName,
            isReversal: true,
          });
          nextTotalPayments = Number(Math.max(0, nextTotalPayments - netPaidOnInvoice).toFixed(2));
        }

        await tx
          .update(suppliers)
          .set({
            totalPurchases: nextTotalPurchases.toFixed(2),
            totalPayments: nextTotalPayments.toFixed(2),
          })
          .where(eq(suppliers.id, sup.id));
      }

      await tx
        .update(purchaseInvoices)
        .set({
          workflowStatus: 'ملغاة',
          status: 'ملغاة',
          cancelledAt: new Date(),
          cancelledReason: reason,
        })
        .where(eq(purchaseInvoices.id, inv.id));

      await recordAuditLog(tx, {
        userId: req.authUser!.id,
        userName: req.authUser!.fullName,
        role: req.authUser!.role,
        operationType: 'إلغاء فاتورة مشتريات',
        entityType: 'purchase_invoices',
        entityId: String(inv.id),
        affectedRecord: `${inv.invoiceNumber} (${sup.name})`,
        previousValue: inv.workflowStatus,
        newValue: `ملغاة · مرجع ${inv.reference} · السبب: ${reason}`,
      });
    });

    return res.json({ ok: true });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : '';
    if (msg === 'NOT_FOUND') {
      return res.status(404).json({ error: 'الفاتورة غير موجودة.' });
    }
    if (msg === 'ALREADY_CANCELLED') {
      return res.status(409).json({ error: 'الفاتورة ملغاة بالفعل.' });
    }
    if (msg === 'HAS_SUBSEQUENT_PAYMENTS') {
      return res.status(400).json({
        error: 'توجد دفعات لاحقة مرتبطة بهذه الفاتورة؛ يرجى عمل قيد عكسي للدفعات قبل إلغاء الفاتورة.',
      });
    }
    if (msg.startsWith('NEGATIVE_STOCK:')) {
      const [, name, avail, unit] = msg.split(':');
      return res.status(400).json({
        error: `لا يمكن إلغاء الفاتورة لأن الكمية المتاحة من (${name}) هي ${avail} ${unit} وقد تم استهلاك جزء منها.`,
      });
    }
    console.error('Cancel invoice error:', error);
    return res.status(500).json({ error: 'تعذر إلغاء الفاتورة.' });
  }
});

const paymentSchema = z.object({
  invoiceId: z.coerce.number().int().positive().optional(),
  date: z.string().trim().min(8),
  amount: z.coerce.number().positive('مبلغ الدفعة يجب أن يكون أكبر من صفر'),
  method: z.enum(PAYMENT_METHODS),
  notes: z.string().optional(),
  clientTxId: z.string().trim().optional(),
});

router.post('/:id/payments', async (req: AuthRequest, res) => {
  try {
    const supplierId = Number(req.params.id);
    if (!Number.isInteger(supplierId)) {
      return res.status(400).json({ error: 'معرف المورد غير صالح.' });
    }

    const parsed = paymentSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message || 'بيانات الدفعة غير صالحة' });
    }

    const result = await db.transaction(async (tx) => {
      if (parsed.data.clientTxId) {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${parsed.data.clientTxId}))`);
        const [dupPay] = await tx
          .select()
          .from(supplierPayments)
          .where(eq(supplierPayments.clientTxId, parsed.data.clientTxId))
          .limit(1);
        if (dupPay) {
          throw new Error('DUPLICATE_TX');
        }
      }

      await tx.execute(sql`SELECT pg_advisory_xact_lock(${200000 + supplierId})`);
      if (parsed.data.invoiceId) {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(${100000 + parsed.data.invoiceId})`);
      }

      const [sup] = await tx.select().from(suppliers).where(eq(suppliers.id, supplierId)).limit(1);
      if (!sup) throw new Error('SUPPLIER_NOT_FOUND');

      let linkedInvoiceNumber: string | undefined;
      if (parsed.data.invoiceId) {
        const [inv] = await tx
          .select()
          .from(purchaseInvoices)
          .where(eq(purchaseInvoices.id, parsed.data.invoiceId))
          .limit(1);

        if (!inv || inv.supplierId !== sup.id) {
          throw new Error('INVOICE_NOT_FOUND');
        }
        if (inv.workflowStatus !== 'مرحّلة') {
          throw new Error('INVOICE_NOT_POSTED');
        }
        const invRem = Number(inv.remainingBalance);
        if (parsed.data.amount > invRem + 0.01) {
          throw new Error(`OVERPAY_INVOICE:${invRem}`);
        }
        linkedInvoiceNumber = inv.invoiceNumber;

        const nextPaid = Number((Number(inv.paidAmount) + parsed.data.amount).toFixed(2));
        const nextRem = Math.max(0, Number((Number(inv.totalAmount) - nextPaid).toFixed(2)));
        await tx
          .update(purchaseInvoices)
          .set({
            paidAmount: nextPaid.toFixed(2),
            remainingBalance: nextRem.toFixed(2),
            status: nextRem === 0 ? 'مدفوعة بالكامل' : nextPaid > 0 ? 'مدفوعة جزئياً' : 'آجلة',
          })
          .where(eq(purchaseInvoices.id, inv.id));
      }

      const payRef = generateReference('PAY');
      const [createdPay] = await tx
        .insert(supplierPayments)
        .values({
          reference: payRef,
          clientTxId: parsed.data.clientTxId ?? null,
          supplierId: sup.id,
          invoiceId: parsed.data.invoiceId ?? null,
          date: parsed.data.date,
          amount: parsed.data.amount.toFixed(2),
          method: parsed.data.method,
          notes: parsed.data.notes ?? null,
          recordedByUserId: req.authUser!.id,
          recordedBy: req.authUser!.fullName,
        })
        .returning();

      const prevTotalPay = Number(sup.totalPayments);
      const nextTotalPay = Number((prevTotalPay + parsed.data.amount).toFixed(2));

      await tx
        .update(suppliers)
        .set({
          totalPayments: nextTotalPay.toFixed(2),
          lastTransactionDate: parsed.data.date,
        })
        .where(eq(suppliers.id, sup.id));

      await tx.insert(cashTransactions).values({
        reference: generateReference('CSH'),
        type: 'سحب سداد مورد',
        category: 'سداد مورد',
        direction: 'OUT',
        amount: parsed.data.amount.toFixed(2),
        date: parsed.data.date,
        paymentMethod: parsed.data.method,
        relatedEntity: sup.name,
        notes: parsed.data.notes ?? null,
        recordedByUserId: req.authUser!.id,
        recordedBy: req.authUser!.fullName,
      });

      await recordAuditLog(tx, {
        userId: req.authUser!.id,
        userName: req.authUser!.fullName,
        role: req.authUser!.role,
        operationType: 'تسجيل دفعة لمورد',
        entityType: 'supplier_payments',
        entityId: String(createdPay.id),
        affectedRecord: sup.name,
        previousValue: `إجمالي المدفوعات السابق: ${prevTotalPay.toFixed(2)}`,
        newValue: `دفعة ${parsed.data.amount.toFixed(2)} ج.س (${parsed.data.method})`,
        reference: payRef,
      });

      const updatedBalance = Number(
        (Number(sup.totalPurchases) - nextTotalPay + Number(sup.adjustments)).toFixed(2)
      );

      return {
        paymentId: String(createdPay.id),
        reference: createdPay.reference,
        receipt: {
          reference: createdPay.reference,
          supplierName: sup.name,
          supplierCode: sup.code,
          invoiceNumber: linkedInvoiceNumber,
          date: createdPay.date,
          amount: Number(createdPay.amount),
          method: createdPay.method,
          notes: createdPay.notes ?? undefined,
          recordedBy: createdPay.recordedBy,
          remainingSupplierBalance: updatedBalance,
        },
      };
    });

    return res.status(201).json(result);
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : '';
    if (msg === 'DUPLICATE_TX') {
      return res.status(409).json({ error: 'تم تسجيل هذه الدفعة مسبقاً (منع التكرار).' });
    }
    if (msg === 'SUPPLIER_NOT_FOUND') {
      return res.status(404).json({ error: 'المورد غير موجود.' });
    }
    if (msg === 'INVOICE_NOT_FOUND') {
      return res.status(404).json({ error: 'الفاتورة المحددة غير موجودة لهذا المورد.' });
    }
    if (msg === 'INVOICE_NOT_POSTED') {
      return res.status(400).json({ error: 'لا يمكن سداد فاتورة غير مرحّلة (مسودة أو ملغاة).' });
    }
    if (msg.startsWith('OVERPAY_INVOICE:')) {
      const rem = msg.split(':')[1];
      return res.status(400).json({
        error: `مبلغ الدفعة يتجاوز المتبقي على الفاتورة المحددة (${rem} ج.س).`,
      });
    }
    console.error('Supplier payment error:', error);
    return res.status(500).json({ error: 'تعذر تسجيل الدفعة.' });
  }
});

router.post('/payments/:paymentId/reverse', async (req: AuthRequest, res) => {
  try {
    const paymentId = Number(req.params.paymentId);
    const reason = String(req.body?.reason || 'تصحيح إداري معتمد').trim();
    if (!Number.isInteger(paymentId)) {
      return res.status(400).json({ error: 'معرف الدفعة غير صالح.' });
    }

    await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(${300000 + paymentId})`);
      const [orig] = await tx
        .select()
        .from(supplierPayments)
        .where(eq(supplierPayments.id, paymentId))
        .limit(1);

      if (!orig || orig.isReversal) {
        throw new Error('CANNOT_REVERSE');
      }

      const [sup] = await tx
        .select()
        .from(suppliers)
        .where(eq(suppliers.id, orig.supplierId))
        .limit(1);
      if (!sup) throw new Error('CANNOT_REVERSE');

      const revRef = `REV-${orig.reference}`;
      const [existingRev] = await tx
        .select()
        .from(supplierPayments)
        .where(eq(supplierPayments.reference, revRef))
        .limit(1);
      if (existingRev) throw new Error('ALREADY_REVERSED');

      const origAmt = Number(orig.amount);
      const today = new Date().toISOString().slice(0, 10);

      await tx.insert(supplierPayments).values({
        reference: revRef,
        supplierId: orig.supplierId,
        invoiceId: orig.invoiceId,
        date: today,
        amount: (-origAmt).toFixed(2),
        method: orig.method,
        notes: `قيد عكسي: ${reason}`,
        recordedByUserId: req.authUser!.id,
        recordedBy: req.authUser!.fullName,
        isReversal: true,
        reversedPaymentId: orig.id,
      });

      const nextPayTotal = Number((Number(sup.totalPayments) - origAmt).toFixed(2));
      await tx
        .update(suppliers)
        .set({ totalPayments: nextPayTotal.toFixed(2) })
        .where(eq(suppliers.id, sup.id));

      // Also restore linked invoice balance if applicable
      if (orig.invoiceId) {
        const [inv] = await tx
          .select()
          .from(purchaseInvoices)
          .where(eq(purchaseInvoices.id, orig.invoiceId))
          .limit(1);
        if (inv && inv.workflowStatus === 'مرحّلة') {
          const nextInvPaid = Math.max(0, Number((Number(inv.paidAmount) - origAmt).toFixed(2)));
          const nextInvRem = Number((Number(inv.totalAmount) - nextInvPaid).toFixed(2));
          await tx
            .update(purchaseInvoices)
            .set({
              paidAmount: nextInvPaid.toFixed(2),
              remainingBalance: nextInvRem.toFixed(2),
              status:
                nextInvRem === 0 ? 'مدفوعة بالكامل' : nextInvPaid > 0 ? 'مدفوعة جزئياً' : 'آجلة',
            })
            .where(eq(purchaseInvoices.id, inv.id));
        }
      }

      await tx.insert(cashTransactions).values({
        reference: generateReference('CSH'),
        type: 'قيد عكسي سداد مورد',
        category: 'قيد عكسي',
        direction: 'IN',
        amount: origAmt.toFixed(2),
        date: today,
        paymentMethod: orig.method,
        relatedEntity: `${sup.name} (${orig.reference})`,
        notes: reason,
        recordedByUserId: req.authUser!.id,
        recordedBy: req.authUser!.fullName,
        isReversal: true,
      });

      await recordAuditLog(tx, {
        userId: req.authUser!.id,
        userName: req.authUser!.fullName,
        role: req.authUser!.role,
        operationType: 'قيد عكسي لدفعة مورد',
        entityType: 'supplier_payments',
        entityId: String(orig.id),
        affectedRecord: orig.reference,
        previousValue: `مبلغ الدفعة: ${origAmt}`,
        newValue: `تم إنشاء قيد عكسي بمبلغ -${origAmt} · السبب: ${reason}`,
        reference: revRef,
      });
    });

    return res.json({ ok: true });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : '';
    if (msg === 'ALREADY_REVERSED') {
      return res.status(409).json({ error: 'تم عكس هذه الدفعة مسبقاً.' });
    }
    if (msg === 'CANNOT_REVERSE') {
      return res.status(400).json({ error: 'لا يمكن عكس هذا القيد.' });
    }
    console.error('Reverse payment error:', error);
    return res.status(500).json({ error: 'تعذر تنفيذ القيد العكسي.' });
  }
});

// Keep asc unused warning clean if not needed
void asc;

export default router;
