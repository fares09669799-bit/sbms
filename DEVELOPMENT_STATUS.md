# SBMS — Smart Bakery Management System
# حالة التطوير الحالية (DEVELOPMENT_STATUS.md)

**آخر تحديث:** المرحلة 7 — التقوية الأمنية، الدقة المحاسبية بـ `decimal.js`، اختبارات `Vitest`، إعادة الهيكلة المعيارية، وتحديث التوثيق (Production Hardening & Modularization Completed)
**الحالة العامة:** نظام ERP تشغيلي ومحاسبي متكامل بواجهة React 19 + خادم Express (`Node.js 22 Native ESM` و`Vercel Serverless`) + قاعدة بيانات PostgreSQL (Drizzle ORM، 31 جدولاً علائقياً) مع حسابات مالية بدقة `decimal.js`، واختبارات وحدة عبر `Vitest`، وبنية مسارات وصفحات مقسمة معيارياً، وخالٍ تماماً من أي ميزات ذكاء اصطناعي.

## ما تم إنجازه في المرحلة الأولى (Phase 1 — Preserved)
- نظام التصميم العربي `RTL` بالألوان المؤسسية (`#142D35`, `#176B55`, `#D8AD65`) وخط `IBM Plex Sans Arabic` + `IBM Plex Mono`.
- بوابة المالك وبوابة الوكيل المقيدة، صفحة تسجيل الدخول، ومركز التقارير المالية والتصدير والطباعة.

## ما تم إنجازه في المرحلة الثانية (Phase 2 — Database & Backend Engineering)
- قاعدة البيانات العلائقية (PostgreSQL + Drizzle ORM) بفهارسها ومفاتيحها الأجنبية.
- المصادقة الآمنة (`scrypt` + `HS256` JWT + Refresh Token Rotation مخزنة بالبصمة `SHA-256` + Firebase Auth) والتحقق الصارم من الصلاحيات (`OWNER` vs `AGENT`).
- سجل التدقيق الدائم (`audit_logs`) وربط كافة العمليات بالخادم.

## ما تم إنجازه في المرحلة الثالثة (Phase 3 — Suppliers, Purchases & Inventory)
- إدارة الموردين الكاملة مع البحث والفلترة والتنقل بالصفحات وكشف الحساب التفصيلي القابل للطباعة.
- فواتير المشتريات متعددة الأصناف (`مسودة` / `مرحّلة` / `ملغاة`) مع التحديث الذري للمخزون والتشغيلات ومتوسط التكلفة المرجح والتزامات الموردين.
- مدفوعات الموردين الجزئية والكلية، القيود العكسية، وإيصالات السداد القابلة للطباعة.
- إدارة وضبط المخزون مع صرف `FEFO/FIFO` وتنبيهات الحد الأدنى وقرب انتهاء الصلاحية.

## ما تم إنجازه في المرحلة الرابعة (Phase 4 — Production, Sales, Agents & Shifts)
- وصفات الإنتاج القياسية، تسجيل الإنتاج وخصم المستودع الذري، المبيعات النقدية والآجلة، وفصل حركات المرتجعات والتالف والتسويات (`bread_movements`).
- إدارة الوكلاء والصلاحيات، الورديات، تسليم العهد (`shift_handovers`)، والتقرير الختامي للوردية.

## ما تم إنجازه في المرحلة الخامسة (Phase 5 — Accounting, Cash Management & Financial Reporting)
1. **إدارة المصروفات التشغيلية (`Expense Management`)**
   - دعم جميع الفئات الثماني المعتمدة (`كهرباء`, `مياه`, `ترحيل ومواصلات`, `وقود وغاز`, `صيانة`, `إيجار`, `رواتب وأجور`, `مصروفات تشغيلية أخرى`)، مع تاريخ المصروف، الوصف، المسؤول، وسيلة الدفع (`نقداً` | `تحويل بنكي (بنكك)` | `شيك`)، وإرفاق المستند المؤيد ومعاينته.
   - قيد فوري في `cash_transactions` + آلية العكس المحاسبي (`POST /api/accounting/expenses/:id/reverse`) دون حذف القيد الأصلي.
2. **إدارة الخزينة والتدفقات النقدية (`Cash Management`)**
   - متابعة كافة التدفقات الداخلة (`IN`) والخارجة (`OUT`)، الإيداعات النقدية المباشرة (`إيداع نقدي`) والمسحوبات (`سحب نقدي`) مع عكس القيود (`POST /api/accounting/cash/transactions/:id/reverse`).
   - ربط سداد الموردين وتحصيلات العملاء وفروقات تسوية عهد الورديات عند اعتماد المالك (`shift_handovers`) بالخزينة الحية.
   - الحفاظ على القاعدة المحاسبية الصارمة: الإيداعات التمويلية المباشرة لا تُحتسب إيراداً في قائمة الدخل ولا تؤثر على صافي الربح.
3. **إدارة العملاء وكشوف الحساب (`Customer Management`)**
   - إنشاء وتعديل العملاء الآجلين، تسجيل الدفعات (`POST /api/customers/:id/payments`) بوسيلة الدفع، تسجيل التسويات (`POST /api/accounting/customers/:id/adjustments`)، وعكس الدفعات (`POST /api/accounting/customers/payments/:paymentId/reverse`).
   - تطبيق معادلة الرصيد بدقة: `Customer Balance = Credit Sales - Payments + Adjustments`.
   - كشف حساب تفصيلي للعميل (`GET /api/accounting/customers/:id`) برصيد تراكمي وشعار المخبز قابل للطباعة.
4. **إدارة الموظفين والحضور والرواتب (`Employee Management`)**
   - إضافة وتعديل الموظفين، تسجيل الحضور اليومي (`حاضر` | `غائب` | `إجازة`)، وصرف الرواتب (`payroll`).
   - صرف الراتب ينشئ ذرياً مصروفاً تحت بند `'رواتب وأجور'` وقيد خروج نقدي في الخزينة، وعكسه يعكس القيدين المرتبطين تلقائياً.
5. **المحرك المحاسبي ولوحة المالك ومركز التقارير (13 تقريراً)**
   - اعتماد **أساس الاستحقاق التشغيلي مع فصل التدفق النقدي (`Modified Accrual`)**:
     - `Sales Revenue` = المبيعات النقدية + المبيعات الآجلة.
     - `Cash Collected` = المبيعات النقدية + تحصيلات مديونيات العملاء.
     - `COGS` = الكميات المستهلكة فعلياً في الإنتاج × متوسط التكلفة المرجح.
     - `Net Estimated Profit` = `Sales Revenue - COGS - Operating Expenses`.
   - ربط لوحة المالك (`GET /api/accounting/dashboard`) ومركز التقارير (`GET /api/accounting/reports`) بقاعدة البيانات مباشرة مع 13 تقريراً متكاملاً:
     `pnl`, `cash-flow`, `daily-sales`, `weekly-sales`, `monthly-sales`, `annual-sales`, `production`, `inventory`, `supplier-balances`, `customer-debts`, `expenses`, `agent-performance`, `shift-reconciliation`.
   - دعم التصدير الحقيقي لملفات Excel (`.xlsx` RTL مع الملخصات) وPDF والطباعة الرسمية بشعار المخبز والتاريخ ووقت الإصدار.
6. **توافق النشر في الإنتاج (`Cloud Run Node.js 22 Native ESM`)**
   - معالجة استيراد إعدادات JSON في `firebase-admin.ts` عبر `fs.readFileSync` وتحويل كافة استيرادات الأنواع في الخادم إلى `import type` للعمل بسلاسة تحت `node server.ts`.

## ما تم إنجازه في المرحلة السادسة (Phase 6 — Final QA, Security, Performance & Deployment Prep)
1. **التدقيق الأمني وتقوية الخادم:**
   - إضافة ترويسات الأمان HTTP (`nosniff`, `Referrer-Policy`, `Permissions-Policy`, `COOP`, `HSTS`)، تعطيل `X-Powered-By`، وفرض سياسة `CORS` صارمة.
   - إضافة محدد الطلبات على `/api/auth/refresh` مع تنظيف تلقائي لذاكرة محدد الطلبات، وحظر مرفقات/صور `SVG/HTML/script` في `/api/expenses` و`/api/agents`.
2. **ضمان النزاهة المحاسبية تحت التزامن (Concurrency & ACID):**
   - تطبيق `pg_advisory_xact_lock` على جميع عمليات الفواتير، الموردين، المخزون، الإنتاج، المبيعات، العملاء، الورديات، الرواتب، والقيود العكسية؛ والتحقق العملي من عدم حدوث فقدان تحديثات أو خصم جزئي عند فشل المعاملات.
3. **تحسين الأداء والواجهات على الجوال:**
   - إضافة 6 فهارس قاعدة بيانات جديدة وتطبيقها على Cloud SQL.
   - تقسيم حزمة الواجهة (`React.lazy` + `Suspense` + Vite `manualChunks`) لتقليص الحزمة الأولية إلى `88.49 kB` (`24.33 kB` gzip)، وإصلاح عرض الفلاتر والقوائم المنبثقة على شاشات `360px`.
4. **الاختبار النهائي والتوثيق:**
   - اجتياز 24 اختباراً عملياً حياً شمل الأمان، التزامن، الصلاحيات، وسير العمل الكامل (16 خطوة) وتنظيف قاعدة البيانات إلى وضعها المرجعي النظيف، وإكمال جميع ملفات التوثيق العشرة.

## ما تم إنجازه في حزمة التقوية وإعادة الهيكلة (Production Hardening, Financial Precision & Modularization)
1. **تنظيف الاعتماديات وضبط البناء:**
   - إضافة `react-is@^19` كاعتماد مباشر متوافق مع React 19، وإزالة الحزم غير المستخدمة (`@google/genai`, `motion`)، ونقل أدوات التطوير (`drizzle-kit`, `@types/jsonwebtoken`, `@types/pg`) إلى `devDependencies` مع الحفاظ على `bun.lock` وحيداً.
2. **الأمان والاستقرار على Vercel Serverless:**
   - تشديد التحقق من `JWT_SECRET` و`JWT_REFRESH_SECRET` في الإنتاج (`NODE_ENV=production` أو `VERCEL=1`) برفض التشغيل عند غيابهما أو عدم اختلافهما أو قصرهما عن 32 حرفاً، وتفعيل التحقق الصارم من شهادات PostgreSQL SSL افتراضياً (`rejectUnauthorized: true`) مع دعم `DB_SSL_CA` و`DB_SSL_REJECT_UNAUTHORIZED`.
3. **الدقة المالية واختبارات الوحدة (`decimal.js` + `Vitest`):**
   - استخراج دوال الحساب المحاسبي والتقريب الصرفي في وحدة نقية (`src/server/accounting/formulas.ts`) وتغطيتها بـ 12 اختبار وحدة عبر `Vitest` (`src/server/accounting/formulas.test.ts`، عبر `npm test`).
   - ترقية العمليات الحسابية المالية في الخادم (`formulas.ts`, `financialSnapshotService.ts`) والواجهة (`accountingCalculations.ts`) إلى `decimal.js` بنمط التقريب المحاسبي `ROUND_HALF_UP` دون تغيير صيغ الاستجابات أو المعادلات المعتمدة.
4. **إعادة الهيكلة المعيارية للملفات الكبيرة (Modularization):**
   - **مسارات العمليات:** تقسيم `src/server/routes/operationsRoutes.ts` إلى `src/server/services/operationsService.ts` و5 وحدات مسارات متخصصة تحت `src/server/routes/operations/` مع إبقاء الموزّع الرئيسي وحماية `requireAuth`.
   - **مسارات المحاسبة:** تقسيم `src/server/routes/accountingRoutes.ts` إلى `src/server/services/financialSnapshotService.ts` و4 وحدات مسارات متخصصة تحت `src/server/routes/accounting/` تحت حماية `requireAuth` و`requireRole('OWNER')`.
   - **صفحات المحاسبة في الواجهة:** تقسيم `src/pages/owner/AccountingPages.tsx` إلى `accountingConstants.ts` و3 صفحات مستقلة (`CashExpensesPage.tsx`, `CustomersPage.tsx`, `EmployeesPage.tsx`) مع إبقاء `AccountingPages.tsx` كملف تصدير مرجعي (`barrel`).
5. **تحديث الوثائق (مع إبقاء التعديلات الهيكلية المتقدمة قيد الخطة):**
   - تحديث `DEPLOYMENT_GUIDE.md` و`README.md` و`DEVELOPMENT_STATUS.md` و`ROADMAP.md` لتغطية متغيرات Vercel (`DATABASE_URL`, `JWT_SECRET`, `JWT_REFRESH_SECRET`, `FIREBASE_PROJECT_ID`)، مع ترك محدّد الطلبات الموزّع ونقل مرفقات المصروفات للتخزين الخارجي كخطط مقترحة بانتظار الموافقة قبل تنفيذ أي ترحيل على قاعدة البيانات أو خدمة مدفوعة.
