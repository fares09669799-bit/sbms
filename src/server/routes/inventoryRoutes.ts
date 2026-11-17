import { Router } from 'express';
import { asc, desc, eq, gt, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../../db/index.ts';
import {
  bakerySettings,
  inventoryBatches,
  inventoryItems,
  notifications,
  stockMovements,
  suppliers,
} from '../../db/schema.ts';
import { type AuthRequest, requireAuth, requireRole } from '../../middleware/auth.ts';
import { generateReference, recordAuditLog } from '../audit.ts';

const router = Router();

router.use(requireAuth, requireRole('OWNER'));

const ALLOWED_UNITS = ['جوال', 'كجم', 'جرام', 'لتر', 'قطعة'] as const;
const MOVEMENT_TYPES = [
  'استلام مشتريات',
  'استهلاك إنتاج',
  'تعديل جرد',
  'تحويل داخلي',
  'مرتجع لمورد',
  'مرتجع مخزني',
] as const;

function mapItem(i: typeof inventoryItems.$inferSelect) {
  return {
    id: String(i.id),
    sku: i.sku,
    name: i.name,
    category: i.category,
    unit: i.unit,
    availableQuantity: Number(i.availableQuantity),
    averageCost: Number(i.averageCost),
    minimumStock: Number(i.minimumStock),
    primarySupplierId: i.primarySupplierId ? String(i.primarySupplierId) : '',
    primarySupplierName: i.primarySupplierName,
    batchCode: i.batchCode,
    expiryDate: i.expiryDate ?? undefined,
    lastUpdated: i.lastUpdated,
  };
}

function mapBatch(
  b: typeof inventoryBatches.$inferSelect,
  itemMap?: Map<number, typeof inventoryItems.$inferSelect>
) {
  const item = itemMap?.get(b.inventoryItemId);
  return {
    id: String(b.id),
    inventoryItemId: String(b.inventoryItemId),
    itemName: item?.name ?? '',
    unit: item?.unit ?? '',
    batchCode: b.batchCode,
    quantityRemaining: Number(b.quantityRemaining),
    unitCost: Number(b.unitCost),
    expiryDate: b.expiryDate ?? undefined,
    receivedDate: b.receivedDate,
  };
}

function mapMovement(m: typeof stockMovements.$inferSelect) {
  return {
    id: String(m.id),
    reference: m.reference,
    inventoryItemId: String(m.inventoryItemId),
    itemName: m.itemName,
    type: m.type,
    quantityDelta: Number(m.quantityDelta),
    unit: m.unit,
    balanceAfter: Number(m.balanceAfter),
    batchCode: m.batchCode ?? undefined,
    expiryDate: m.expiryDate ?? undefined,
    relatedSupplierId: m.relatedSupplierId ? String(m.relatedSupplierId) : undefined,
    date: m.date,
    performedBy: m.performedBy,
    notes: m.notes ?? undefined,
  };
}

router.get('/', async (_req, res) => {
  try {
    const [items, movements, batches] = await Promise.all([
      db.select().from(inventoryItems).orderBy(inventoryItems.id),
      db.select().from(stockMovements).orderBy(desc(stockMovements.id)).limit(200),
      db
        .select()
        .from(inventoryBatches)
        .where(gt(inventoryBatches.quantityRemaining, '0'))
        .orderBy(asc(inventoryBatches.expiryDate), asc(inventoryBatches.id)),
    ]);

    const itemMap = new Map(items.map((it) => [it.id, it]));
    const mappedItems = items.map(mapItem);
    const mappedBatches = batches.map((b) => mapBatch(b, itemMap));

    const totalValuation = mappedItems.reduce(
      (acc, i) => acc + i.availableQuantity * i.averageCost,
      0
    );

    const todayDate = new Date();
    const soonThreshold = new Date(todayDate.getTime() + 45 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);

    const expiringSoonBatches = mappedBatches.filter(
      (b) => b.expiryDate && b.expiryDate <= soonThreshold
    );

    return res.json({
      items: mappedItems,
      batches: mappedBatches,
      expiringSoonBatches,
      totalValuation: Number(totalValuation.toFixed(2)),
      lowStockItems: mappedItems.filter((i) => i.availableQuantity <= i.minimumStock),
      movements: movements.map(mapMovement),
    });
  } catch (error) {
    console.error('Get inventory error:', error);
    return res.status(500).json({ error: 'تعذر تحميل بيانات المخزون.' });
  }
});

router.get('/items/:id', async (req, res) => {
  try {
    const itemId = Number(req.params.id);
    if (!Number.isInteger(itemId)) {
      return res.status(400).json({ error: 'معرف الصنف غير صالح.' });
    }

    const [item] = await db
      .select()
      .from(inventoryItems)
      .where(eq(inventoryItems.id, itemId))
      .limit(1);
    if (!item) {
      return res.status(404).json({ error: 'الصنف غير موجود.' });
    }

    const [batches, movements] = await Promise.all([
      db
        .select()
        .from(inventoryBatches)
        .where(eq(inventoryBatches.inventoryItemId, itemId))
        .orderBy(desc(inventoryBatches.id)),
      db
        .select()
        .from(stockMovements)
        .where(eq(stockMovements.inventoryItemId, itemId))
        .orderBy(desc(stockMovements.id)),
    ]);

    const itemMap = new Map([[item.id, item]]);
    return res.json({
      item: mapItem(item),
      batches: batches.map((b) => mapBatch(b, itemMap)),
      movements: movements.map(mapMovement),
    });
  } catch (error) {
    console.error('Get inventory item detail error:', error);
    return res.status(500).json({ error: 'تعذر تحميل تفاصيل الصنف.' });
  }
});

const createItemSchema = z.object({
  sku: z.string().trim().min(2, 'كود الصنف (SKU) مطلوب'),
  name: z.string().trim().min(2, 'اسم الصنف مطلوب'),
  category: z.string().trim().min(2, 'التصنيف مطلوب'),
  unit: z.enum(ALLOWED_UNITS),
  minimumStock: z.coerce.number().min(0).default(0),
  averageCost: z.coerce.number().min(0).default(0),
  primarySupplierId: z.coerce.number().int().positive().optional(),
  batchCode: z.string().trim().optional(),
  expiryDate: z.string().trim().optional(),
});

router.post('/items', async (req: AuthRequest, res) => {
  try {
    const parsed = createItemSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message || 'بيانات الصنف غير مكتملة.' });
    }

    const created = await db.transaction(async (tx) => {
      const [dupSku] = await tx
        .select()
        .from(inventoryItems)
        .where(eq(inventoryItems.sku, parsed.data.sku))
        .limit(1);
      if (dupSku) {
        throw new Error('DUPLICATE_SKU');
      }

      let supName = '';
      if (parsed.data.primarySupplierId) {
        const [sup] = await tx
          .select()
          .from(suppliers)
          .where(eq(suppliers.id, parsed.data.primarySupplierId))
          .limit(1);
        supName = sup?.name || '';
      }

      const today = new Date().toISOString().slice(0, 10);
      const [item] = await tx
        .insert(inventoryItems)
        .values({
          sku: parsed.data.sku,
          name: parsed.data.name,
          category: parsed.data.category,
          unit: parsed.data.unit,
          availableQuantity: '0.000',
          averageCost: parsed.data.averageCost.toFixed(2),
          minimumStock: parsed.data.minimumStock.toFixed(3),
          primarySupplierId: parsed.data.primarySupplierId ?? null,
          primarySupplierName: supName,
          batchCode: parsed.data.batchCode?.trim() || `BCH-${Date.now().toString().slice(-5)}`,
          expiryDate: parsed.data.expiryDate?.trim() || null,
          lastUpdated: today,
        })
        .returning();

      await recordAuditLog(tx, {
        userId: req.authUser!.id,
        userName: req.authUser!.fullName,
        role: req.authUser!.role,
        operationType: 'إضافة صنف مخزني جديد',
        entityType: 'inventory_items',
        entityId: String(item.id),
        affectedRecord: item.name,
        newValue: `SKU: ${item.sku} · الوحدة: ${item.unit} · الحد الأدنى: ${parsed.data.minimumStock}`,
      });

      return item;
    });

    return res.status(201).json({ id: String(created.id), item: mapItem(created) });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : '';
    if (msg === 'DUPLICATE_SKU') {
      return res.status(409).json({ error: 'كود الصنف (SKU) مسجل مسبقاً.' });
    }
    console.error('Create inventory item error:', error);
    return res.status(500).json({ error: 'تعذر إضافة الصنف للمستودع.' });
  }
});

router.patch('/items/:id', async (req: AuthRequest, res) => {
  try {
    const itemId = Number(req.params.id);
    if (!Number.isInteger(itemId)) {
      return res.status(400).json({ error: 'معرف الصنف غير صالح.' });
    }

    const updateSchema = z.object({
      name: z.string().trim().min(2).optional(),
      category: z.string().trim().min(2).optional(),
      minimumStock: z.coerce.number().min(0).optional(),
      primarySupplierId: z.coerce.number().int().positive().nullable().optional(),
      expiryDate: z.string().trim().nullable().optional(),
    });

    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'بيانات التحديث غير صالحة.' });
    }

    const updated = await db.transaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(inventoryItems)
        .where(eq(inventoryItems.id, itemId))
        .limit(1);
      if (!existing) return null;

      let supName = existing.primarySupplierName;
      let supId = existing.primarySupplierId;
      if (parsed.data.primarySupplierId !== undefined) {
        if (parsed.data.primarySupplierId === null) {
          supId = null;
          supName = '';
        } else {
          const [sup] = await tx
            .select()
            .from(suppliers)
            .where(eq(suppliers.id, parsed.data.primarySupplierId))
            .limit(1);
          supId = parsed.data.primarySupplierId;
          supName = sup?.name || '';
        }
      }

      const [next] = await tx
        .update(inventoryItems)
        .set({
          ...(parsed.data.name ? { name: parsed.data.name } : {}),
          ...(parsed.data.category ? { category: parsed.data.category } : {}),
          ...(parsed.data.minimumStock !== undefined
            ? { minimumStock: parsed.data.minimumStock.toFixed(3) }
            : {}),
          ...(parsed.data.primarySupplierId !== undefined
            ? { primarySupplierId: supId, primarySupplierName: supName }
            : {}),
          ...(parsed.data.expiryDate !== undefined
            ? { expiryDate: parsed.data.expiryDate }
            : {}),
          lastUpdated: new Date().toISOString().slice(0, 10),
        })
        .where(eq(inventoryItems.id, itemId))
        .returning();

      await recordAuditLog(tx, {
        userId: req.authUser!.id,
        userName: req.authUser!.fullName,
        role: req.authUser!.role,
        operationType: 'تعديل إعدادات صنف مخزني',
        entityType: 'inventory_items',
        entityId: String(itemId),
        affectedRecord: next.name,
        previousValue: `الحد الأدنى: ${Number(existing.minimumStock)} ${existing.unit}`,
        newValue: `الحد الأدنى: ${Number(next.minimumStock)} ${next.unit} · التصنيف: ${next.category}`,
      });

      return mapItem(next);
    });

    if (!updated) return res.status(404).json({ error: 'الصنف غير موجود.' });
    return res.json({ item: updated });
  } catch (error) {
    console.error('Update inventory item error:', error);
    return res.status(500).json({ error: 'تعذر تحديث بيانات الصنف.' });
  }
});

const movementSchema = z.object({
  inventoryItemId: z.coerce.number().int().positive(),
  type: z.enum(MOVEMENT_TYPES),
  quantityDelta: z.coerce.number().refine((v) => v !== 0, 'الكمية لا يمكن أن تكون صفراً'),
  unit: z.string().trim().optional(),
  batchCode: z.string().trim().optional(),
  expiryDate: z.string().trim().optional(),
  supplierId: z.coerce.number().int().positive().optional(),
  adjustSupplierBalance: z.boolean().optional(),
  notes: z.string().optional(),
  clientTxId: z.string().trim().optional(),
});

router.post('/movements', async (req: AuthRequest, res) => {
  try {
    const parsed = movementSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message || 'بيانات الحركة غير صالحة' });
    }

    const d = parsed.data;

    // Normalize directional delta for consumption/returns if positive value was accidentally sent
    let signedDelta = d.quantityDelta;
    if (d.type === 'استهلاك إنتاج' || d.type === 'تحويل داخلي' || d.type === 'مرتجع لمورد') {
      signedDelta = -Math.abs(d.quantityDelta);
    } else if (d.type === 'استلام مشتريات' || d.type === 'مرتجع مخزني') {
      signedDelta = Math.abs(d.quantityDelta);
    }

    const result = await db.transaction(async (tx) => {
      if (d.clientTxId) {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${d.clientTxId}))`);
        const [dupMov] = await tx
          .select()
          .from(stockMovements)
          .where(eq(stockMovements.clientTxId, d.clientTxId))
          .limit(1);
        if (dupMov) {
          throw new Error('DUPLICATE_TX');
        }
      }

      await tx.execute(sql`SELECT pg_advisory_xact_lock(${400000 + d.inventoryItemId})`);

      const [item] = await tx
        .select()
        .from(inventoryItems)
        .where(eq(inventoryItems.id, d.inventoryItemId))
        .limit(1);

      if (!item) throw new Error('ITEM_NOT_FOUND');

      // Validate unit of measurement strictly
      if (d.unit && d.unit !== item.unit) {
        throw new Error(`UNIT_MISMATCH:${item.name}:${item.unit}:${d.unit}`);
      }

      const [settingsRow] = await tx.select().from(bakerySettings).limit(1);
      const allowNegative = settingsRow?.allowNegativeInventory ?? false;

      const prevQty = Number(item.availableQuantity);
      const nextQty = Number((prevQty + signedDelta).toFixed(3));

      if (nextQty < 0 && !allowNegative) {
        throw new Error(`NEGATIVE_STOCK:${item.name}:${prevQty}:${item.unit}`);
      }

      const today = new Date().toISOString().slice(0, 10);
      const effectiveBatchCode =
        d.batchCode?.trim() ||
        (signedDelta > 0 ? `BCH-${Date.now().toString().slice(-6)}` : item.batchCode);

      await tx
        .update(inventoryItems)
        .set({
          availableQuantity: nextQty.toFixed(3),
          ...(signedDelta > 0 && d.batchCode ? { batchCode: effectiveBatchCode } : {}),
          ...(signedDelta > 0 && d.expiryDate ? { expiryDate: d.expiryDate } : {}),
          lastUpdated: today,
        })
        .where(eq(inventoryItems.id, item.id));

      if (signedDelta > 0) {
        await tx.insert(inventoryBatches).values({
          inventoryItemId: item.id,
          batchCode: effectiveBatchCode,
          quantityRemaining: signedDelta.toFixed(3),
          unitCost: item.averageCost,
          expiryDate: d.expiryDate?.trim() || null,
          receivedDate: today,
        });
      } else {
        // Deduct from batches FEFO (earliest expiry first, then oldest)
        let toDeduct = Math.abs(signedDelta);
        const activeBatches = await tx
          .select()
          .from(inventoryBatches)
          .where(eq(inventoryBatches.inventoryItemId, item.id))
          .orderBy(asc(inventoryBatches.expiryDate), asc(inventoryBatches.id));

        for (const batch of activeBatches) {
          if (toDeduct <= 0) break;
          const rem = Number(batch.quantityRemaining);
          if (rem <= 0) continue;
          const used = Math.min(rem, toDeduct);
          const nextBatchRem = Number((rem - used).toFixed(3));
          await tx
            .update(inventoryBatches)
            .set({ quantityRemaining: nextBatchRem.toFixed(3) })
            .where(eq(inventoryBatches.id, batch.id));
          toDeduct = Number((toDeduct - used).toFixed(3));
        }
      }

      // If stock return to supplier and supplierId is specified, record supplier adjustment credit
      let returnNote = d.notes ?? '';
      if (d.type === 'مرتجع لمورد' && d.supplierId) {
        const [sup] = await tx
          .select()
          .from(suppliers)
          .where(eq(suppliers.id, d.supplierId))
          .limit(1);
        if (!sup) throw new Error('SUPPLIER_NOT_FOUND');

        if (d.adjustSupplierBalance !== false) {
          const returnValue = Number((Math.abs(signedDelta) * Number(item.averageCost)).toFixed(2));
          const nextAdjustments = Number((Number(sup.adjustments) - returnValue).toFixed(2));
          await tx
            .update(suppliers)
            .set({
              adjustments: nextAdjustments.toFixed(2),
              lastTransactionDate: today,
            })
            .where(eq(suppliers.id, sup.id));
          returnNote = `${returnNote ? `${returnNote} · ` : ''}مرتجع للمورد ${sup.name} (تسوية -${returnValue} ج.س)`;
        }
      }

      const movRef = generateReference('STK');
      await tx.insert(stockMovements).values({
        reference: movRef,
        clientTxId: d.clientTxId ?? null,
        inventoryItemId: item.id,
        itemName: item.name,
        type: d.type,
        quantityDelta: signedDelta.toFixed(3),
        unit: item.unit,
        balanceAfter: nextQty.toFixed(3),
        batchCode: signedDelta > 0 ? effectiveBatchCode : null,
        expiryDate: d.expiryDate?.trim() || null,
        relatedSupplierId: d.supplierId ?? null,
        date: today,
        performedByUserId: req.authUser!.id,
        performedBy: req.authUser!.fullName,
        notes: returnNote || null,
      });

      if (nextQty <= Number(item.minimumStock)) {
        await tx.insert(notifications).values({
          ruleCode: `RULE_LOW_STOCK_${item.sku}`,
          severity: 'تنبيه حرج',
          title: `انخفاض مخزون ${item.name} دون الحد الأدنى`,
          message: `الرصيد الحالي (${nextQty} ${item.unit}) وصل للحد الأدنى المعتمد (${Number(item.minimumStock)} ${item.unit}).`,
          timestamp: new Date().toISOString().slice(0, 16).replace('T', ' '),
          isRead: false,
          targetNav: 'inventory',
        });
      }

      await recordAuditLog(tx, {
        userId: req.authUser!.id,
        userName: req.authUser!.fullName,
        role: req.authUser!.role,
        operationType: d.type,
        entityType: 'inventory_items',
        entityId: String(item.id),
        affectedRecord: item.name,
        previousValue: `${prevQty} ${item.unit}`,
        newValue: `${nextQty} ${item.unit} (${signedDelta > 0 ? '+' : ''}${signedDelta})`,
        reference: movRef,
      });

      return { reference: movRef, balanceAfter: nextQty };
    });

    return res.status(201).json(result);
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : '';
    if (msg === 'DUPLICATE_TX') {
      return res.status(409).json({ error: 'تم تسجيل هذه الحركة المخزنية مسبقاً (منع التكرار).' });
    }
    if (msg === 'ITEM_NOT_FOUND') {
      return res.status(404).json({ error: 'الصنف غير موجود.' });
    }
    if (msg === 'SUPPLIER_NOT_FOUND') {
      return res.status(404).json({ error: 'المورد المحدد للمرتجع غير موجود.' });
    }
    if (msg.startsWith('UNIT_MISMATCH:')) {
      const [, name, expectedUnit, givenUnit] = msg.split(':');
      return res.status(400).json({
        error: `وحدة القياس (${givenUnit}) للصنف "${name}" لا تطابق الوحدة المعتمدة (${expectedUnit}).`,
      });
    }
    if (msg.startsWith('NEGATIVE_STOCK:')) {
      const [, name, avail, unit] = msg.split(':');
      return res.status(400).json({
        error: `لا يمكن السحب بالسالب؛ الرصيد المتاح من (${name}) هو ${avail} ${unit} فقط.`,
      });
    }
    console.error('Stock movement error:', error);
    return res.status(500).json({ error: 'تعذر تنفيذ الحركة المخزنية.' });
  }
});

export default router;
