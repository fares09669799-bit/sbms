# SBMS — Production Deployment Guide (`DEPLOYMENT_GUIDE.md`)

يوضح هذا الدليل متطلبات وإجراءات نشر نظام **SBMS** في بيئة الإنتاج (Cloud Run + Cloud SQL PostgreSQL).

---

## 1. المتطلبات التشغيلية للإنتاج
- **بيئة التشغيل:** Node.js `22.x` بنمط Native TypeScript/ESM عبر الأمر:
  - البناء: `npm run build`
  - التشغيل: `npm start` (`NODE_ENV=production node server.ts`)
- **المنفذ:** يستمع الخادم على `0.0.0.0:3000` (`const PORT = 3000` في `server.ts`).
- **قاعدة البيانات:** مثيل Cloud SQL PostgreSQL (إقليم `europe-west1`) متصل عبر Unix Socket (`/app/cloudsql/...` أو متغيرات `SQL_HOST`, `SQL_DB_NAME`, `SQL_USER`, `SQL_PASSWORD`).
- **الاعتماديات وقت التشغيل:** تبقى حزم `drizzle-orm`, `pg`, `express`, `dotenv`, `jsonwebtoken`, `zod`, `firebase-admin` ضمن `dependencies` لأن `server.ts` يخدم مسارات API والملفات الثابتة من `dist/` مباشرة.

---

## 2. قائمة التحقق قبل النشر (Pre-Deployment Checklist)
1. **ضبط الأسرار ومتغيرات البيئة:**
   - التأكد من تعريف `JWT_SECRET` و`JWT_REFRESH_SECRET` بقيم عشوائية قوية ومستقلة في مدير الأسرار / بيئة Cloud Run.
   - ضبط `APP_URL` على النطاق النهائي المعتمد للتطبيق لضمان سماح سياسة CORS به.
   - التأكد من عدم وجود أي قيم افتراضية لكلمات المرور؛ يجب تغيير كلمة مرور المالك الافتراضية فوراً بعد أول تسجيل دخول من خلال صفحة الإعدادات أو نقطة النهاية `POST /api/auth/change-password`.
2. **التحقق من البناء وتوافق Node 22 ESM:**
   ```bash
   npm run lint
   npm run build
   NODE_ENV=production node --input-type=module -e "await import('./src/server/security.ts'); await import('./src/server/routes/authRoutes.ts'); await import('./src/server/routes/supplierRoutes.ts'); await import('./src/server/routes/inventoryRoutes.ts'); await import('./src/server/routes/accountingRoutes.ts'); await import('./src/server/routes/operationsRoutes.ts');"
   ```
3. **مزامنة مخطط قاعدة البيانات والفهارس:**
   - تطبيق تغييرات `src/db/schema.ts` عبر `UpdateSchema` أو `npx drizzle-kit push --config=src/db/drizzle.config.ts` قبل توجيه حركة المستخدمين.

---

## 3. ترويسات الأمان والتخزين المؤقت في الإنتاج
عند تشغيل `NODE_ENV=production`:
- يقوم `server.ts` بتعطيل `X-Powered-By` وإضافة `X-Content-Type-Options: nosniff` و`Referrer-Policy` و`Permissions-Policy` و`Strict-Transport-Security`.
- تخدم أصول Vite المجزأة داخل `dist/assets/` بترويسة تخزين مؤقت `maxAge: 7d` بينما تُضبط ملفات HTML (`index.html`) على `Cache-Control: no-cache` لضمان حصول المستخدمين على أحدث إصدار فوراً بعد كل نشر.

---

## 4. خطوات النشر والتراجع (Rollout & Rollback)
- **النشر (Deploy):**
  1. أخذ نسخة احتياطية فورية لقاعدة البيانات قبل أي تحديث للمخطط (`BACKUP_AND_RECOVERY.md`).
  2. بناء التطبيق (`npm run build`) وتطبيق تحديثات المخطط (الإضافية فقط مثل الفهارس والأعمدة غير الكاسرة).
  3. نشر المراجعة الجديدة وتشغيل `npm start`.
  4. فحص صحة الخدمة عبر `GET /api/health` ومراجعة سجلات بدء التشغيل.
- **التراجع (Rollback):**
  1. إعادة توجيه حركة المرور إلى مراجعة Cloud Run السابقة المستقرة.
  2. في حال شمل الإصدار تعديلاً في البيانات، تُستعاد قاعدة البيانات من النسخة الاحتياطية السابقة للنشر مع التحقق من عدم فقدان القيود المسجلة في فترة التبديل.

---

## 5. النشر على Vercel (متغيرات البيئة المطلوبة)
عند نشر المشروع على **Vercel** (عبر `vercel.json` و`api/index.ts`) يجب ضبط المتغيرات التالية في **Project Settings → Environment Variables**:
- `DATABASE_URL`: رابط اتصال قاعدة بيانات PostgreSQL الخارجية (مثل Neon أو Supabase أو Vercel Postgres).
- `JWT_SECRET`: مفتاح توقيع رموز الوصول (16 حرفاً على الأقل).
- `JWT_REFRESH_SECRET`: مفتاح توقيع رموز التحديث (16 حرفاً على الأقل ومختلف تماماً عن `JWT_SECRET`).

> **تنبيه أمني وتشغيلي:** في حال عدم ضبط `JWT_SECRET` (أو `JWT_REFRESH_SECRET`) في بيئة Vercel، يولّد الخادم مفتاحاً عشوائياً جديداً عند كل تشغيل لنسخة Serverless، مما يؤدي إلى انقطاع جلسات المستخدمين وفشل التحقق من الرموز بين الطلبات.

