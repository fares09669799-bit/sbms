# SBMS — Production Deployment Guide (`DEPLOYMENT_GUIDE.md`)

يوضح هذا الدليل متطلبات وإجراءات نشر نظام **SBMS** في بيئة الإنتاج سواءً عبر **Cloud Run + Cloud SQL PostgreSQL** أو عبر **Vercel Serverless + Neon / Supabase PostgreSQL**.

---

## 1. المتطلبات التشغيلية للإنتاج
- **بيئة التشغيل:** Node.js `22.x` بنمط Native TypeScript/ESM عبر الأمر:
  - البناء: `npm run build`
  - التشغيل: `npm start` (`NODE_ENV=production node server.ts`)
- **المنفذ:** يستمع الخادم على `0.0.0.0:3000` (`const PORT = 3000` في `server.ts`).
- **قاعدة البيانات:** PostgreSQL عبر مثيل Cloud SQL (أو مزوّد سحابي مثل Neon / Supabase عبر `DATABASE_URL` بنمط Pooler).
- **الاعتماديات وقت التشغيل:** تبقى حزم `drizzle-orm`, `pg`, `express`, `dotenv`, `jsonwebtoken`, `zod`, `decimal.js`, `firebase-admin`, `react-is` ضمن `dependencies`، بينما تبقى أدوات الترحيل والاختبار والأنواع (`drizzle-kit`, `vitest`, `@types/*`) في `devDependencies`.
- **مدير الحزم:** يُدار المشروع عبر `bun` (`bun.lock`) أو تشغيل سكربتات الفحص عبر `npm run`.

---

## 2. قائمة التحقق قبل النشر (Pre-Deployment Checklist)
1. **ضبط الأسرار ومتغيرات البيئة:**
   - التأكد من تعريف `JWT_SECRET` و`JWT_REFRESH_SECRET` بقيم عشوائية قوية ومستقلة في مدير الأسرار / بيئة Cloud Run.
   - ضبط `APP_URL` على النطاق النهائي المعتمد للتطبيق لضمان سماح سياسة CORS به.
   - التأكد من عدم وجود أي قيم افتراضية لكلمات المرور؛ يجب تغيير كلمة مرور المالك الافتراضية فوراً بعد أول تسجيل دخول من خلال صفحة الإعدادات أو نقطة النهاية `POST /api/auth/change-password`.
2. **التحقق من الاختبارات والبناء وتوافق Node 22 ESM:**
   ```bash
   npm test
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

## 5. الدليل العملي لربط قاعدة بيانات PostgreSQL (Neon أو Supabase) على Vercel

عند نشر النظام على **Vercel** (عبر `vercel.json` و`api/index.ts`)، لا تتوفر قاعدة بيانات محلية داخل الدوال السحابية، لذا يلزم إنشاء قاعدة **PostgreSQL** خارجية وربطها عبر متغيرات البيئة. اتبع الخطوات العملية التالية بالترتيب:

### الخطوة 1: إنشاء قاعدة بيانات PostgreSQL (اختر Neon أو Supabase)

#### الخيار (أ): عبر **Neon PostgreSQL** (مباشر أو من متجر Vercel)
1. **من لوحة تحكم Vercel** (الأسرع):
   - افتح مشروعك في Vercel ← انتقل إلى تبويب **Storage** ← اضغط **Create Database / Marketplace** ← اختر **Neon (Serverless Postgres)**.
   - أنشئ القاعدة واختر المنطقة الأقرب لمستخدميك، ثم اربطها بالمشروع (سيضيف Vercel متغيرات مثل `DATABASE_URL` و`POSTGRES_URL` و`DATABASE_URL_UNPOOLED` تلقائياً).
2. **أو عبر موقع Neon مباشرة** (`neon.tech`):
   - أنشئ مشروعاً جديداً (**New Project**) واختر PostgreSQL.
   - من لوحة المشروع افتح **Connect** ثم انسخ:
     - **Pooled connection string** (ينتهي اسم المضيف عادةً بـ `-pooler` ومعه `?sslmode=require`) لاستخدامه في `DATABASE_URL`.
     - **Direct connection string** (بدون `-pooler`) لاستخدامه عند تشغيل الترحيلات في `DATABASE_URL_UNPOOLED` (اختياري لكنه مفضّل).

#### الخيار (ب): عبر **Supabase** (`supabase.com`)
1. سجّل الدخول إلى **Supabase** واضغط **New Project**، واختر اسماً للمشروع وكلمة مرور قوية لقاعدة البيانات واحفظها في مكان آمن.
2. بعد جاهزية المشروع، اضغط على زر **Connect** في أعلى اللوحة (أو افتح **Project Settings → Database → Connection String**):
   - **للتشغيل على Vercel (`DATABASE_URL`):** اختر **Transaction pooler** (المنفذ `6543` مع `?pgbouncer=true`). هذا النمط متوافق تماماً مع دوال Vercel Serverless، والنظام يفعّل له SSL وحد الاتصالات (`max: 1`) تلقائياً في `src/db/index.ts`.
   - **لإنشاء الجداول (`DATABASE_URL_UNPOOLED`):** اختر **Session pooler** أو **Direct connection** (المنفذ `5432`) لأن بعض أوامر `drizzle-kit push` تكون أكثر استقراراً خارج Transaction Pooler.
3. تأكد من استبدال `[YOUR-PASSWORD]` في الرابط بكلمة مرور قاعدة البيانات الفعلية (وإذا احتوت كلمة المرور على رموز خاصة مثل `@` أو `#` أو `/` يجب ترميزها بـ URL-Encoding).

---

### الخطوة 2: إضافة `DATABASE_URL` ومتغيرات البيئة في Vercel

> **ملاحظة مهمة حول `DATABASE_URL` على Vercel:** يجب أن يكون `DATABASE_URL` رابط **Pooler** (مثل رابط Neon `-pooler` أو رابط Supabase Transaction Pooler على المنفذ `6543` مع `?pgbouncer=true`) لتجنب استنزاف اتصالات قاعدة البيانات في دوال Serverless. كما أن التحقق من شهادة SSL (`rejectUnauthorized: true`) هو الوضع الافتراضي في الإنتاج، ويمكن ضبط شهادة مخصصة عبر `DB_SSL_CA` أو تعديل السلوك عبر `DB_SSL_REJECT_UNAUTHORIZED=false` عند الحاجة الاستثنائية فقط.

1. افتح مشروعك في **Vercel** ← انتقل إلى **Settings → Environment Variables**.
2. أضف المتغيرات التالية (اختر بيئة **Production**، ويمكنك تحديد **Preview** أيضاً إذا أردت اختبار النسخ التجريبية):
   - **`DATABASE_URL`**: الصق رابط اتصال **Pooler** (Neon `-pooler` أو Supabase Transaction Pooler على المنفذ `6543`).
   - **`DATABASE_URL_UNPOOLED`** *(مستحسن)*: الصق رابط الاتصال المباشر أو Session Pooler (`5432`) لتستخدمه أداة `drizzle-kit` تلقائياً عند الترحيل.
   - **`JWT_SECRET`**: سلسلة عشوائية قوية (32 حرفاً فأكثر؛ يرفض الخادم الإقلاع في الإنتاج إذا كانت مفقودة أو أقل من 32 حرفاً أو مطابقة للقيمة النموذجية).
   - **`JWT_REFRESH_SECRET`**: سلسلة عشوائية قوية ومختلفة تماماً عن `JWT_SECRET` (32 حرفاً فأكثر).
   - **`FIREBASE_PROJECT_ID`** *(اختياري عند تفعيل تسجيل الدخول عبر Firebase Auth)*: معرّف مشروع Firebase ليستخدمه المحوّل السحابي في التحقق من رموز هوية Firebase عند الطلب (يُحمّل كسولاً في `src/lib/firebase-admin.ts`، ولا يُنصح بوضع بيانات اعتماد خدمة خاصة غير لازمة إذا كان تسجيل الدخول يعتمد على JWT فقط).
   - **`APP_URL`** *(اختياري عند استخدام نطاق مخصص)*: رابط موقعك الإنتاجي مثل `https://your-bakery.vercel.app`.
3. بعد حفظ المتغيرات، انتقل إلى تبويب **Deployments** واضغط **Redeploy** على أحدث نشر (لأن متغيرات البيئة لا تسري على الدوال المبنية مسبقاً إلا بعد إعادة النشر).

> **تنبيه أمني وتشغيلي:**
> - في بيئة الإنتاج (`NODE_ENV=production` أو `VERCEL=1`) يرفض الخادم تشغيل المصادقة بمفاتيح افتراضية أو ضعيفة، لذا يجب تعريف `JWT_SECRET` و`JWT_REFRESH_SECRET` بطول لا يقل عن 32 حرفاً وبقيم مستقلة.
> - **لا تضع أبداً** أي رابط اتصال فعلي أو كلمة مرور أو مفتاح سري داخل الكود أو المستودع أو ملف `.env.example`.

---

### الخطوة 3: تهيئة الجداول عبر `npm run db:push`

بما أن جدول النظام الكامل معرّف في `src/db/schema.ts` ومرتبط بإعدادات `src/db/drizzle.config.ts`، يجب دفع المخطط (Push) لإنشاء الجداول الـ 29 في قاعدة البيانات الجديدة:

1. على جهازك المحلي داخل مجلد المشروع، تأكد من تثبيت الاعتماديات:
   ```bash
   npm install
   ```
2. اجلب متغيرات البيئة إلى ملف `.env.local` (مشمول في `.gitignore` ولا يُرفع إلى Git) باستخدام Vercel CLI:
   ```bash
   npx vercel env pull .env.local
   ```
   *(أو مرّر الرابط مؤقتاً في الطرفية دون حفظه في المستودع: `export DATABASE_URL="postgresql://..."`).*
3. شغّل أمر إنشاء الجداول:
   ```bash
   npm run db:push
   ```
   - سينفّذ هذا الأمر: `drizzle-kit push --config=src/db/drizzle.config.ts` ويقرأ `.env.local` أو `.env` تلقائياً ويفعّل SSL للاتصالات البعيدة.
   - في حال طلب تأكيد التغييرات، وافق على تطبيق المخطط لإنشاء الجداول الـ 29.
4. *(اختياري / موصى به لأول تشغيل)* نفّذ أمر تهيئة البيانات الافتراضية وحسابات البدء:
   ```bash
   npm run db:seed
   ```
   - سيعمل السكربت (`tsx src/db/seed.ts`) بأمان وبشكل غير مكرر (Idempotent) لإنشاء الإعدادات والحسابات الأولية إذا كانت قاعدة البيانات فارغة.
5. *(موصى به أمنياً)* بعد الانتهاء يمكنك حذف `.env.local` من جهازك إذا لم تعد بحاجة إليه محلياً.

---

### الخطوة 4: الاختبار والتحقق بعد النشر

1. افتح نقطة الفحص التشخيصية في المتصفح:
   ```text
   https://<your-vercel-domain>/api/health
   ```
2. تأكد من عودة الحالة `200 OK` مع القيم التالية:
   ```json
   {
     "ok": true,
     "service": "sbms-api",
     "dbConfigured": true,
     "dbSource": "DATABASE_URL",
     "dbReachable": true,
     "tablesReady": true
   }
   ```
   - إذا كانت `dbConfigured: false` فهذا يعني أن المتغير لم يُضف أو لم يُنفّذ **Redeploy**.
   - إذا كانت `dbReachable: false` فراجع كلمة المرور أو صيغة الرابط أو إعدادات SSL/Firewall في المزود.
   - إذا كانت `tablesReady: false` فهذا يعني أن الجداول لم تُنشأ بعد؛ أعد تشغيل `npm run db:push`.
3. افتح واجهة التطبيق وسجّل الدخول عبر صفحة الدخول (نقطة `POST /api/auth/login`)، ثم غيّر كلمات المرور الافتراضية فوراً من صفحة الإعدادات.

