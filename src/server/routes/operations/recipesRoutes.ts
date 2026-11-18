import { Router } from 'express';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../../../db/index.ts';
import { productionRecipes } from '../../../db/schema.ts';
import { type AuthRequest, requireRole } from '../../../middleware/auth.ts';
import { recordAuditLog } from '../../audit.ts';

const router = Router();

const recipeOtherIngredientSchema = z.object({
  inventoryItemId: z.coerce.number().int().positive(),
  name: z.string().trim().min(1),
  quantity: z.coerce.number().positive(),
  unit: z.string().trim().min(1),
});

const recipeCreateSchema = z.object({
  breadType: z.string().trim().min(2, 'اسم نوع الخبز مطلوب'),
  expectedYieldLoaves: z.coerce.number().int().positive('الإنتاج المتوقع يجب أن يكون أكبر من صفر'),
  unitSellingPrice: z.coerce.number().positive('سعر البيع يجب أن يكون أكبر من صفر'),
  flourBags: z.coerce.number().min(0),
  oilLiters: z.coerce.number().min(0),
  yeastGrams: z.coerce.number().min(0),
  saltGrams: z.coerce.number().min(0).default(0),
  sugarGrams: z.coerce.number().min(0).default(0),
  otherIngredients: z.array(recipeOtherIngredientSchema).default([]),
  notes: z.string().optional(),
});

router.post('/recipes', requireRole('OWNER'), async (req: AuthRequest, res) => {
  try {
    const parsed = recipeCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message || 'بيانات الوصفة غير صالحة.' });
    }
    const d = parsed.data;

    const created = await db.transaction(async (tx) => {
      const [dup] = await tx
        .select()
        .from(productionRecipes)
        .where(eq(productionRecipes.breadType, d.breadType))
        .limit(1);
      if (dup) throw new Error('DUPLICATE_RECIPE');

      const [row] = await tx
        .insert(productionRecipes)
        .values({
          breadType: d.breadType,
          expectedYieldLoaves: d.expectedYieldLoaves,
          unitSellingPrice: d.unitSellingPrice.toFixed(2),
          flourBags: d.flourBags.toFixed(2),
          oilLiters: d.oilLiters.toFixed(2),
          yeastGrams: d.yeastGrams.toFixed(2),
          saltGrams: d.saltGrams.toFixed(2),
          sugarGrams: d.sugarGrams.toFixed(2),
          otherIngredients: d.otherIngredients,
          isActive: true,
          notes: d.notes ?? null,
        })
        .returning();

      await recordAuditLog(tx, {
        userId: req.authUser!.id,
        userName: req.authUser!.fullName,
        role: 'OWNER',
        operationType: 'إنشاء وصفة إنتاج جديدة',
        entityType: 'production_recipes',
        entityId: String(row.id),
        affectedRecord: row.breadType,
        newValue: `إنتاج قياسي ${row.expectedYieldLoaves} رغيف · سعر ${d.unitSellingPrice} ج.س`,
      });

      return row;
    });

    return res.status(201).json({ id: String(created.id), breadType: created.breadType });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : '';
    if (msg === 'DUPLICATE_RECIPE') {
      return res.status(409).json({ error: 'يوجد نوع خبز مسجل بهذا الاسم مسبقاً.' });
    }
    console.error('Create recipe error:', error);
    return res.status(500).json({ error: 'تعذر إنشاء الوصفة.' });
  }
});

router.put('/recipes/:id', requireRole('OWNER'), async (req: AuthRequest, res) => {
  try {
    const id = Number(req.params.id);
    const schema = z.object({
      breadType: z.string().trim().min(2).optional(),
      expectedYieldLoaves: z.coerce.number().int().positive(),
      unitSellingPrice: z.coerce.number().positive(),
      flourBags: z.coerce.number().min(0),
      oilLiters: z.coerce.number().min(0),
      yeastGrams: z.coerce.number().min(0),
      saltGrams: z.coerce.number().min(0).default(0),
      sugarGrams: z.coerce.number().min(0).default(0),
      otherIngredients: z.array(recipeOtherIngredientSchema).optional(),
      isActive: z.boolean().optional(),
      notes: z.string().optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success || !Number.isInteger(id)) {
      return res.status(400).json({ error: 'بيانات الوصفة غير صالحة.' });
    }

    const updated = await db.transaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(productionRecipes)
        .where(eq(productionRecipes.id, id))
        .limit(1);
      if (!existing) return null;

      const [next] = await tx
        .update(productionRecipes)
        .set({
          ...(parsed.data.breadType ? { breadType: parsed.data.breadType } : {}),
          expectedYieldLoaves: parsed.data.expectedYieldLoaves,
          unitSellingPrice: parsed.data.unitSellingPrice.toFixed(2),
          flourBags: parsed.data.flourBags.toFixed(2),
          oilLiters: parsed.data.oilLiters.toFixed(2),
          yeastGrams: parsed.data.yeastGrams.toFixed(2),
          saltGrams: parsed.data.saltGrams.toFixed(2),
          sugarGrams: parsed.data.sugarGrams.toFixed(2),
          ...(parsed.data.otherIngredients !== undefined
            ? { otherIngredients: parsed.data.otherIngredients }
            : {}),
          ...(parsed.data.isActive !== undefined ? { isActive: parsed.data.isActive } : {}),
          ...(parsed.data.notes !== undefined ? { notes: parsed.data.notes } : {}),
          updatedAt: new Date(),
        })
        .where(eq(productionRecipes.id, id))
        .returning();

      await recordAuditLog(tx, {
        userId: req.authUser!.id,
        userName: req.authUser!.fullName,
        role: 'OWNER',
        operationType: 'تعديل وصفة إنتاج',
        entityType: 'production_recipes',
        entityId: String(id),
        affectedRecord: next.breadType,
        previousValue: `إنتاج ${existing.expectedYieldLoaves} · سعر ${existing.unitSellingPrice}`,
        newValue: `إنتاج ${next.expectedYieldLoaves} · سعر ${next.unitSellingPrice}`,
      });

      return next;
    });

    if (!updated) return res.status(404).json({ error: 'الوصفة غير موجودة.' });
    return res.json({ ok: true });
  } catch {
    return res.status(500).json({ error: 'تعذر تحديث الوصفة.' });
  }
});

router.patch('/recipes/:id/toggle', requireRole('OWNER'), async (req: AuthRequest, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'معرف الوصفة غير صالح.' });

    const toggled = await db.transaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(productionRecipes)
        .where(eq(productionRecipes.id, id))
        .limit(1);
      if (!existing) return null;

      const nextActive = !existing.isActive;
      await tx
        .update(productionRecipes)
        .set({ isActive: nextActive, updatedAt: new Date() })
        .where(eq(productionRecipes.id, id));

      await recordAuditLog(tx, {
        userId: req.authUser!.id,
        userName: req.authUser!.fullName,
        role: 'OWNER',
        operationType: nextActive ? 'تفعيل وصفة إنتاج' : 'إيقاف وصفة إنتاج',
        entityType: 'production_recipes',
        entityId: String(id),
        affectedRecord: existing.breadType,
        previousValue: existing.isActive ? 'نشطة' : 'موقوفة',
        newValue: nextActive ? 'نشطة' : 'موقوفة',
      });

      return nextActive;
    });

    if (toggled === null) return res.status(404).json({ error: 'الوصفة غير موجودة.' });
    return res.json({ ok: true, isActive: toggled });
  } catch {
    return res.status(500).json({ error: 'تعذر تغيير حالة الوصفة.' });
  }
});

export default router;
