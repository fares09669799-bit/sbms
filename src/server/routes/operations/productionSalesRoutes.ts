import { Router } from 'express';
import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../../../db/index.ts';
import {
  bakerySettings,
  breadMovements,
  cashTransactions,
  customers,
  expenses,
  inventoryItems,
  productionIngredients,
  productionRecipes,
  productionRecords,
  saleItems,
  sales,
  shifts,
} from '../../../db/schema.ts';
import { type AuthRequest, requirePermission } from '../../../middleware/auth.ts';
import { generateReference, recordAuditLog } from '../../audit.ts';
import { isValidSafeDataUri } from '../../security.ts';
import {
  ALLOWED_ATTACHMENT_MIMES,
  computeBreadBalance,
  deductInventoryFefo,
  mapBreadMovement,
  resolveOperationalShift,
} from '../../services/operationsService.ts';

const router = Router();

// ==========================================
// 2. PRODUCTION REGISTRATION (OWNER or permitted AGENT)
// ==========================================
const productionSchema = z.object({
  date: z.string().trim().min(8).optional(),
  shiftId: z.coerce.number().int().positive().optional(),
  shiftName: z.string().trim().min(2),
  recipeId: z.coerce.number().int().positive(),
  flourBags: z.coerce.number().min(0),
  oilLiters: z.coerce.number().min(0),
  yeastGrams: z.coerce.number().min(0),
  saltGrams: z.coerce.number().min(0).default(0),
  sugarGrams: z.coerce.number().min(0).default(0),
  otherIngredients: z
    .array(
      z.object({
        inventoryItemId: z.coerce.number().int().positive(),
        quantity: z.coerce.number().positive(),
      })
    )
    .optional(),
  producedLoaves: z.coerce.number().int().positive('الكمية المنتجة يجب أن تكون أكبر من صفر'),
  damagedLoaves: z.coerce.number().int().min(0).default(0),
  notes: z.string().optional(),
  clientTxId: z.string().optional(),
});

router.post('/production', requirePermission('PRODUCTION_LOG'), async (req: AuthRequest, res) => {
  try {
    const parsed = productionSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message || 'بيانات الإنتاج غير مكتملة.' });
    }
    const d = parsed.data;
    const opDate = d.date || new Date().toISOString().slice(0, 10);

    const record = await db.transaction(async (tx) => {
      if (d.clientTxId) {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${d.clientTxId}))`);
        const [dup] = await tx
          .select()
          .from(productionRecords)
          .where(eq(productionRecords.clientTxId, d.clientTxId))
          .limit(1);
        if (dup) throw new Error('DUPLICATE_TX');
      }

      const [recipe] = await tx
        .select()
        .from(productionRecipes)
        .where(eq(productionRecipes.id, d.recipeId))
        .limit(1);
      if (!recipe) throw new Error('RECIPE_NOT_FOUND');
      if (!recipe.isActive) throw new Error('RECIPE_INACTIVE');

      const activeShift = await resolveOperationalShift(tx, req.authUser!, d.shiftId);

      // Serialize multi-ingredient inventory checks & deductions to prevent concurrent negative stock races
      await tx.execute(sql`SELECT pg_advisory_xact_lock(499999)`);

      const [settingsRow] = await tx.select().from(bakerySettings).limit(1);
      const allowNeg = settingsRow?.allowNegativeInventory ?? false;

      const allInv = await tx.select().from(inventoryItems);
      const invById = new Map(allInv.map((i) => [i.id, i]));
      const flourItem = allInv.find((i) => i.sku === 'RM-FLR-01');
      const oilItem = allInv.find((i) => i.sku === 'RM-OIL-02');
      const yeastItem = allInv.find((i) => i.sku === 'RM-YST-03');
      const saltItem = allInv.find((i) => i.sku === 'RM-SLT-04');
      const sugarItem = allInv.find((i) => i.sku === 'RM-SGR-05');

      const deductions: { item: typeof inventoryItems.$inferSelect | undefined; qty: number }[] = [
        { item: flourItem, qty: d.flourBags },
        { item: oilItem, qty: d.oilLiters },
        { item: yeastItem, qty: d.yeastGrams },
        { item: saltItem, qty: d.saltGrams / 1000 },
        { item: sugarItem, qty: d.sugarGrams / 1000 },
      ];

      const otherSummaryParts: string[] = [];
      if (d.otherIngredients && d.otherIngredients.length > 0) {
        for (const extra of d.otherIngredients) {
          const item = invById.get(extra.inventoryItemId);
          if (!item) throw new Error('INGREDIENT_NOT_FOUND');
          deductions.push({ item, qty: extra.quantity });
          otherSummaryParts.push(`${item.name}: ${extra.quantity} ${item.unit}`);
        }
      }

      // Check cumulative available stock before deducting
      const requiredByItem = new Map<number, { item: typeof inventoryItems.$inferSelect; totalQty: number }>();
      for (const entry of deductions) {
        if (entry.item && entry.qty > 0) {
          const prev = requiredByItem.get(entry.item.id);
          requiredByItem.set(entry.item.id, {
            item: entry.item,
            totalQty: Number(((prev?.totalQty ?? 0) + entry.qty).toFixed(3)),
          });
        }
      }

      for (const { item, totalQty } of requiredByItem.values()) {
        const avail = Number(item.availableQuantity);
        if (!allowNeg && avail < totalQty) {
          throw new Error(`LOW_STOCK:${item.name}:${avail}:${item.unit}`);
        }
      }

      const ref = generateReference('PRD');
      const effectiveShiftName = activeShift?.shiftName || d.shiftName;

      const [created] = await tx
        .insert(productionRecords)
        .values({
          reference: ref,
          clientTxId: d.clientTxId ?? null,
          date: opDate,
          shiftId: activeShift?.id ?? null,
          shiftName: effectiveShiftName,
          agentId: req.authUser!.id,
          agentName: req.authUser!.fullName,
          recipeId: recipe.id,
          breadType: recipe.breadType,
          flourConsumedBags: d.flourBags.toFixed(2),
          oilConsumedLiters: d.oilLiters.toFixed(2),
          yeastConsumedGrams: d.yeastGrams.toFixed(2),
          saltConsumedGrams: d.saltGrams.toFixed(2),
          sugarConsumedGrams: d.sugarGrams.toFixed(2),
          otherIngredientsSummary: otherSummaryParts.length > 0 ? otherSummaryParts.join('، ') : null,
          producedLoaves: d.producedLoaves,
          damagedLoaves: d.damagedLoaves,
          notes: d.notes ?? null,
        })
        .returning();

      for (const { item, totalQty } of requiredByItem.values()) {
        await deductInventoryFefo(tx, {
          item,
          qty: totalQty,
          date: opDate,
          userId: req.authUser!.id,
          userName: req.authUser!.fullName,
          notes: `دفعة إنتاج ${ref} (${recipe.breadType})`,
          allowNegative: allowNeg,
        });

        await tx.insert(productionIngredients).values({
          productionRecordId: created.id,
          inventoryItemId: item.id,
          quantityUsed: totalQty.toFixed(3),
          unit: item.unit,
        });
      }

      if (activeShift) {
        await tx
          .update(shifts)
          .set({
            producedBread: activeShift.producedBread + d.producedLoaves,
            damagedBread: activeShift.damagedBread + d.damagedLoaves,
          })
          .where(eq(shifts.id, activeShift.id));
      }

      await recordAuditLog(tx, {
        userId: req.authUser!.id,
        userName: req.authUser!.fullName,
        role: req.authUser!.role,
        operationType: 'تسجيل دفعة إنتاج',
        entityType: 'production_records',
        entityId: String(created.id),
        affectedRecord: `${ref} (${recipe.breadType})`,
        newValue: `إنتاج ${d.producedLoaves} رغيف · تالف ${d.damagedLoaves} · خصم ${d.flourBags} جوال دقيق`,
        reference: ref,
      });

      return created;
    });

    return res.status(201).json({ id: String(record.id), reference: record.reference });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : '';
    if (msg === 'DUPLICATE_TX') {
      return res.status(409).json({ error: 'تم تسجيل هذه العملية مسبقاً (منع التكرار).' });
    }
    if (msg === 'RECIPE_NOT_FOUND') {
      return res.status(404).json({ error: 'الوصفة المحددة غير موجودة.' });
    }
    if (msg === 'RECIPE_INACTIVE') {
      return res.status(400).json({ error: 'هذه الوصفة موقوفة حالياً ولا يمكن استخدامها لإنتاج جديد.' });
    }
    if (msg === 'INGREDIENT_NOT_FOUND') {
      return res.status(404).json({ error: 'أحد الأصناف الإضافية المحددة غير موجود بالمستودع.' });
    }
    if (msg === 'AGENT_NO_OPEN_SHIFT') {
      return res.status(400).json({ error: 'يجب فتح وردية عمل أولاً قبل تسجيل الإنتاج.' });
    }
    if (msg === 'SHIFT_FORBIDDEN') {
      return res.status(403).json({ error: 'لا يمكنك التسجيل على وردية وكيل آخر.' });
    }
    if (msg === 'SHIFT_NOT_OPEN' || msg === 'SHIFT_NOT_FOUND') {
      return res.status(400).json({ error: 'الوردية المحددة غير مفتوحة أو غير موجودة.' });
    }
    if (msg.startsWith('LOW_STOCK:')) {
      const [, name, avail, unit] = msg.split(':');
      return res.status(400).json({
        error: `رصيد (${name}) المتاح (${avail} ${unit}) لا يكفي لهذه العملية.`,
      });
    }
    console.error('Production error:', error);
    return res.status(500).json({ error: 'تعذر تسجيل الإنتاج.' });
  }
});

// ==========================================
// 3. SALES & SEPARATE BREAD MOVEMENTS
// ==========================================
const saleSchema = z.object({
  date: z.string().trim().min(8).optional(),
  shiftId: z.coerce.number().int().positive().optional(),
  shiftName: z.string().trim().min(2),
  breadType: z.string().trim().min(2),
  quantity: z.coerce.number().int().positive('الكمية المباعة يجب أن تكون أكبر من صفر'),
  returnedQuantity: z.coerce.number().int().min(0).default(0),
  unitPrice: z.coerce.number().positive('سعر البيع يجب أن يكون أكبر من صفر'),
  paymentType: z.enum(['نقدي', 'آجل']),
  customerId: z.coerce.number().int().positive().optional(),
  notes: z.string().optional(),
  clientTxId: z.string().optional(),
});

router.post('/sales', requirePermission('SALES_LOG'), async (req: AuthRequest, res) => {
  try {
    const parsed = saleSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message || 'بيانات البيع غير مكتملة.' });
    }
    const d = parsed.data;
    if (d.paymentType === 'آجل' && !d.customerId) {
      return res.status(400).json({ error: 'يرجى تحديد العميل في حالة البيع الآجل.' });
    }
    const opDate = d.date || new Date().toISOString().slice(0, 10);

    const createdSale = await db.transaction(async (tx) => {
      if (d.clientTxId) {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${d.clientTxId}))`);
        const [dup] = await tx
          .select()
          .from(sales)
          .where(eq(sales.clientTxId, d.clientTxId))
          .limit(1);
        if (dup) throw new Error('DUPLICATE_TX');
      }

      const activeShift = await resolveOperationalShift(tx, req.authUser!, d.shiftId);

      // Check available bread balance inside active shift (prevent selling unavailable bread)
      if (activeShift) {
        const { expectedClosing } = computeBreadBalance(activeShift);
        const effectiveAvail = expectedClosing + d.returnedQuantity;
        if (d.quantity > effectiveAvail) {
          throw new Error(`INSUFFICIENT_BREAD:${effectiveAvail}:${d.quantity}`);
        }
      }

      const totalAmount = Number((d.quantity * d.unitPrice).toFixed(2));
      let customerName: string | null = null;
      if (d.paymentType === 'آجل' && d.customerId) {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(${700000 + d.customerId})`);
        const [cust] = await tx
          .select()
          .from(customers)
          .where(eq(customers.id, d.customerId))
          .limit(1);
        if (!cust) throw new Error('CUSTOMER_NOT_FOUND');
        customerName = cust.name;

        await tx
          .update(customers)
          .set({
            totalCreditSales: (Number(cust.totalCreditSales) + totalAmount).toFixed(2),
            outstandingBalance: (Number(cust.outstandingBalance) + totalAmount).toFixed(2),
            lastActivityDate: opDate,
          })
          .where(eq(customers.id, cust.id));
      }

      const ref = generateReference('SAL');
      const effectiveShiftName = activeShift?.shiftName || d.shiftName;

      const [saleRow] = await tx
        .insert(sales)
        .values({
          reference: ref,
          clientTxId: d.clientTxId ?? null,
          date: opDate,
          shiftId: activeShift?.id ?? null,
          shiftName: effectiveShiftName,
          agentId: req.authUser!.id,
          agentName: req.authUser!.fullName,
          breadType: d.breadType,
          quantity: d.quantity,
          returnedQuantity: d.returnedQuantity,
          unitPrice: d.unitPrice.toFixed(2),
          totalAmount: totalAmount.toFixed(2),
          paymentType: d.paymentType,
          customerId: d.customerId ?? null,
          customerName,
          notes: d.notes ?? null,
        })
        .returning();

      await tx.insert(saleItems).values({
        saleId: saleRow.id,
        breadType: d.breadType,
        quantity: d.quantity,
        unitPrice: d.unitPrice.toFixed(2),
        lineTotal: totalAmount.toFixed(2),
      });

      if (d.paymentType === 'نقدي') {
        await tx.insert(cashTransactions).values({
          reference: generateReference('CSH'),
          type: 'إيداع مبيعات',
          category: 'مبيعات',
          direction: 'IN',
          amount: totalAmount.toFixed(2),
          date: opDate,
          paymentMethod: 'نقداً',
          relatedEntity: `${d.breadType} (${ref})`,
          shiftId: activeShift?.id ?? null,
          recordedByUserId: req.authUser!.id,
          recordedBy: req.authUser!.fullName,
        });
      }

      if (activeShift) {
        const nextCashSales =
          d.paymentType === 'نقدي'
            ? Number(activeShift.cashSalesAmount) + totalAmount
            : Number(activeShift.cashSalesAmount);
        const nextCreditSales =
          d.paymentType === 'آجل'
            ? Number(activeShift.creditSalesAmount) + totalAmount
            : Number(activeShift.creditSalesAmount);
        const nextExpected =
          d.paymentType === 'نقدي'
            ? Number(activeShift.expectedCash) + totalAmount
            : Number(activeShift.expectedCash);

        await tx
          .update(shifts)
          .set({
            soldBread: activeShift.soldBread + d.quantity,
            returnedBread: activeShift.returnedBread + d.returnedQuantity,
            cashSalesAmount: nextCashSales.toFixed(2),
            creditSalesAmount: nextCreditSales.toFixed(2),
            expectedCash: nextExpected.toFixed(2),
          })
          .where(eq(shifts.id, activeShift.id));
      }

      await recordAuditLog(tx, {
        userId: req.authUser!.id,
        userName: req.authUser!.fullName,
        role: req.authUser!.role,
        operationType: 'تسجيل عملية بيع',
        entityType: 'sales',
        entityId: String(saleRow.id),
        affectedRecord: ref,
        newValue: `${d.quantity} رغيف (${d.breadType}) · ${totalAmount} ج.س (${d.paymentType})`,
        reference: ref,
      });

      return saleRow;
    });

    return res.status(201).json({
      id: String(createdSale.id),
      reference: createdSale.reference,
      totalAmount: Number(createdSale.totalAmount),
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : '';
    if (msg === 'DUPLICATE_TX') {
      return res.status(409).json({ error: 'عملية البيع مسجلة مسبقاً.' });
    }
    if (msg === 'CUSTOMER_NOT_FOUND') {
      return res.status(404).json({ error: 'العميل غير موجود.' });
    }
    if (msg === 'AGENT_NO_OPEN_SHIFT') {
      return res.status(400).json({ error: 'يجب فتح وردية عمل أولاً قبل تسجيل المبيعات.' });
    }
    if (msg === 'SHIFT_FORBIDDEN') {
      return res.status(403).json({ error: 'لا يمكنك التسجيل على وردية وكيل آخر.' });
    }
    if (msg === 'SHIFT_NOT_OPEN' || msg === 'SHIFT_NOT_FOUND') {
      return res.status(400).json({ error: 'الوردية المحددة غير مفتوحة أو غير موجودة.' });
    }
    if (msg.startsWith('INSUFFICIENT_BREAD:')) {
      const [, avail, reqQty] = msg.split(':');
      return res.status(400).json({
        error: `الخبز المتاح في الوردية (${avail} رغيف) أقل من الكمية المطلوب بيعها (${reqQty} رغيف).`,
      });
    }
    console.error('Sales error:', error);
    return res.status(500).json({ error: 'تعذر تسجيل عملية البيع.' });
  }
});

// Separate Bread Returns, Damaged Bread, and Authorized Adjustments
const breadMovementSchema = z.object({
  date: z.string().trim().min(8).optional(),
  shiftId: z.coerce.number().int().positive().optional(),
  shiftName: z.string().trim().min(2).optional(),
  breadType: z.string().trim().min(2),
  type: z.enum(['مرتجع', 'تالف', 'تعديل معتمد']),
  quantity: z.coerce.number().int().positive('الكمية يجب أن تكون أكبر من صفر'),
  reason: z.string().trim().min(2, 'يرجى كتابة السبب أو الملاحظة'),
  clientTxId: z.string().optional(),
});

router.post('/bread-movements', async (req: AuthRequest, res) => {
  try {
    const parsed = breadMovementSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: parsed.error.issues[0]?.message || 'بيانات حركة الخبز غير مكتملة.',
      });
    }
    const d = parsed.data;
    const user = req.authUser!;

    // RBAC / Permission enforcement per movement type
    if (d.type === 'تعديل معتمد' && user.role !== 'OWNER') {
      return res.status(403).json({ error: 'التعديلات المعتمدة على رصيد الخبز مخصصة للمالك فقط.' });
    }
    if (user.role === 'AGENT') {
      if (d.type === 'مرتجع' && !user.permissions.includes('SALES_LOG')) {
        return res.status(403).json({ error: 'ليست لديك صلاحية تسجيل مرتجعات الخبز.' });
      }
      if (
        d.type === 'تالف' &&
        !user.permissions.includes('SALES_LOG') &&
        !user.permissions.includes('PRODUCTION_LOG')
      ) {
        return res.status(403).json({ error: 'ليست لديك صلاحية تسجيل الخبز التالف.' });
      }
    }

    const opDate = d.date || new Date().toISOString().slice(0, 10);

    const created = await db.transaction(async (tx) => {
      if (d.clientTxId) {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${d.clientTxId}))`);
        const [dup] = await tx
          .select()
          .from(breadMovements)
          .where(eq(breadMovements.clientTxId, d.clientTxId))
          .limit(1);
        if (dup) throw new Error('DUPLICATE_TX');
      }

      const activeShift = await resolveOperationalShift(tx, user, d.shiftId);

      if (activeShift && (d.type === 'تالف' || d.type === 'تعديل معتمد')) {
        const { expectedClosing } = computeBreadBalance(activeShift);
        if (d.quantity > expectedClosing) {
          throw new Error(`INSUFFICIENT_BREAD:${expectedClosing}:${d.quantity}`);
        }
      }

      const ref = generateReference('BRD');
      const effectiveShiftName = activeShift?.shiftName || d.shiftName || 'الوردية الصباحية';

      const [row] = await tx
        .insert(breadMovements)
        .values({
          reference: ref,
          clientTxId: d.clientTxId ?? null,
          date: opDate,
          shiftId: activeShift?.id ?? null,
          shiftName: effectiveShiftName,
          agentId: user.id,
          agentName: user.fullName,
          breadType: d.breadType,
          type: d.type,
          quantity: d.quantity,
          reason: d.reason,
        })
        .returning();

      if (activeShift) {
        await tx
          .update(shifts)
          .set({
            ...(d.type === 'مرتجع'
              ? { returnedBread: activeShift.returnedBread + d.quantity }
              : d.type === 'تالف'
              ? { damagedBread: activeShift.damagedBread + d.quantity }
              : {
                  authorizedAdjustments:
                    (activeShift.authorizedAdjustments ?? 0) + d.quantity,
                }),
          })
          .where(eq(shifts.id, activeShift.id));
      }

      await recordAuditLog(tx, {
        userId: user.id,
        userName: user.fullName,
        role: user.role,
        operationType: `تسجيل ${d.type} خبز`,
        entityType: 'bread_movements',
        entityId: String(row.id),
        affectedRecord: `${ref} (${d.breadType})`,
        newValue: `${d.type}: ${d.quantity} رغيف · السبب: ${d.reason}`,
        reference: ref,
      });

      return row;
    });

    return res.status(201).json({
      id: String(created.id),
      reference: created.reference,
      movement: mapBreadMovement(created),
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : '';
    if (msg === 'DUPLICATE_TX') {
      return res.status(409).json({ error: 'تم تسجيل حركة الخبز هذه مسبقاً.' });
    }
    if (msg === 'AGENT_NO_OPEN_SHIFT') {
      return res.status(400).json({ error: 'يجب فتح وردية عمل أولاً قبل تسجيل المرتجعات أو التالف.' });
    }
    if (msg === 'SHIFT_FORBIDDEN') {
      return res.status(403).json({ error: 'لا يمكنك التسجيل على وردية وكيل آخر.' });
    }
    if (msg === 'SHIFT_NOT_OPEN' || msg === 'SHIFT_NOT_FOUND') {
      return res.status(400).json({ error: 'الوردية المحددة غير مفتوحة أو غير موجودة.' });
    }
    if (msg.startsWith('INSUFFICIENT_BREAD:')) {
      const [, avail, reqQty] = msg.split(':');
      return res.status(400).json({
        error: `الرصيد المتاح (${avail} رغيف) لا يكفي لتسجيل هذه الكمية (${reqQty} رغيف).`,
      });
    }
    console.error('Bread movement error:', error);
    return res.status(500).json({ error: 'تعذر تسجيل حركة الخبز.' });
  }
});

// ==========================================
// 4. EXPENSES (OWNER or permitted AGENT)
// ==========================================
router.post('/expenses', requirePermission('EXPENSES_LOG'), async (req: AuthRequest, res) => {
  try {
    const schema = z.object({
      date: z.string().trim().min(8).optional(),
      category: z.string().trim().min(2),
      amount: z.coerce.number().positive('مبلغ المصروف يجب أن يكون أكبر من صفر'),
      description: z.string().trim().min(2, 'بيان المصروف مطلوب'),
      paymentMethod: z.enum(['نقداً', 'تحويل بنكي (بنكك)', 'شيك']).default('نقداً'),
      shiftId: z.coerce.number().int().positive().optional(),
      attachmentName: z.string().optional(),
      attachmentData: z.string().max(400_000, 'حجم المرفق يتجاوز الحد المسموح (400 كيلوبايت)').optional(),
      clientTxId: z.string().optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message || 'بيانات المصروف غير صالحة.' });
    }
    const d = parsed.data;
    if (d.attachmentData && !isValidSafeDataUri(d.attachmentData, ALLOWED_ATTACHMENT_MIMES)) {
      return res.status(400).json({
        error: 'صيغة المرفق غير مدعومة أو غير آمنة. يُسمح فقط بملفات الصور (JPG/PNG/WEBP) أو PDF أو TXT.',
      });
    }
    const opDate = d.date || new Date().toISOString().slice(0, 10);

    const exp = await db.transaction(async (tx) => {
      if (d.clientTxId) {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${d.clientTxId}))`);
        const [dup] = await tx
          .select()
          .from(expenses)
          .where(eq(expenses.clientTxId, d.clientTxId))
          .limit(1);
        if (dup) throw new Error('DUPLICATE_TX');
      }

      let activeShift: typeof shifts.$inferSelect | null = null;
      if (req.authUser!.role === 'AGENT' || d.shiftId) {
        activeShift = await resolveOperationalShift(tx, req.authUser!, d.shiftId);
      }

      const ref = generateReference('EXP');
      const [created] = await tx
        .insert(expenses)
        .values({
          reference: ref,
          clientTxId: d.clientTxId ?? null,
          date: opDate,
          category: d.category,
          amount: d.amount.toFixed(2),
          description: d.description,
          paymentMethod: d.paymentMethod,
          responsibleUserId: req.authUser!.id,
          responsibleUser: req.authUser!.fullName,
          shiftId: activeShift?.id ?? null,
          attachmentName: d.attachmentName ?? null,
          attachmentData: d.attachmentData ?? null,
          status: 'مرحّل',
        })
        .returning();

      await tx.insert(cashTransactions).values({
        reference: generateReference('CSH'),
        type: 'مصروف تشغيلي',
        category: 'مصروف تشغيلي',
        direction: 'OUT',
        amount: d.amount.toFixed(2),
        date: opDate,
        paymentMethod: d.paymentMethod,
        relatedEntity: `${d.category} — ${d.description}`,
        shiftId: activeShift?.id ?? null,
        recordedByUserId: req.authUser!.id,
        recordedBy: req.authUser!.fullName,
      });

      if (activeShift) {
        await tx
          .update(shifts)
          .set({
            totalExpenses: (Number(activeShift.totalExpenses) + d.amount).toFixed(2),
            expectedCash: (Number(activeShift.expectedCash) - d.amount).toFixed(2),
          })
          .where(eq(shifts.id, activeShift.id));
      }

      await recordAuditLog(tx, {
        userId: req.authUser!.id,
        userName: req.authUser!.fullName,
        role: req.authUser!.role,
        operationType: 'تسجيل مصروف تشغيلي',
        entityType: 'expenses',
        entityId: String(created.id),
        affectedRecord: ref,
        newValue: `${d.category}: ${d.amount} ج.س`,
        reference: ref,
      });

      return created;
    });

    return res.status(201).json({ id: String(exp.id), reference: exp.reference });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : '';
    if (msg === 'DUPLICATE_TX') {
      return res.status(409).json({ error: 'تم تسجيل هذا المصروف مسبقاً.' });
    }
    if (msg === 'AGENT_NO_OPEN_SHIFT') {
      return res.status(400).json({ error: 'يجب فتح وردية عمل أولاً قبل تسجيل مصروفات الوردية.' });
    }
    if (msg === 'SHIFT_FORBIDDEN') {
      return res.status(403).json({ error: 'لا يمكنك تسجيل مصروف على وردية وكيل آخر.' });
    }
    if (msg === 'SHIFT_NOT_OPEN' || msg === 'SHIFT_NOT_FOUND') {
      return res.status(400).json({ error: 'الوردية المحددة غير مفتوحة أو غير موجودة.' });
    }
    console.error('Expense error:', error);
    return res.status(500).json({ error: 'تعذر حفظ المصروف.' });
  }
});

export default router;
