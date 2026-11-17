# SBMS — Database Migrations & Seeding (`DATABASE_MIGRATIONS.md`)

## 1. تهيئة قاعدة البيانات (Cloud SQL PostgreSQL)
- **المحرك:** PostgreSQL في Cloud SQL (`europe-west1`)
- **تكوين Drizzle Kit:** `/src/db/drizzle.config.ts`
- **ملف تعريف المخطط:** `/src/db/schema.ts`
- **الاتصال الآمن:** `/src/db/index.ts` يستخدم `pg.Pool` عبر متغيرات البيئة القياسية (`SQL_HOST`, `SQL_DB_NAME`, `SQL_USER`, `SQL_PASSWORD`) مع تهيئة كسولة للاتصال.

## 2. تطبيق المخطط والترحيل (Schema Push)
تم تطبيق المخطط العلائقي بالكامل على قاعدة بيانات PostgreSQL عبر أداة التحديث المرتبطة بـ Drizzle Kit (`src/db/drizzle.config.ts` + `src/db/schema.ts`) والتحقق الفعلي من وجود كافة الجداول الـ 29 في المخطط `public` عبر استعلام `information_schema.columns`:

- `roles`, `permissions`, `users`, `user_sessions`
- `suppliers`, `supplier_products`, `purchase_invoices`, `purchase_invoice_items`, `supplier_payments`
- `inventory_items`, `inventory_batches`, `stock_movements`
- `production_recipes`, `production_records`, `production_ingredients`
- `customers`, `customer_payments`, `sales`, `sale_items`, `expenses`, `cash_transactions`
- `shifts`, `shift_handovers`, `employees`, `employee_attendance`, `payroll`
- `audit_logs`, `notifications`, `bakery_settings`

## 3. البيانات الابتدائية (Idempotent Seeding)
يوفر الملف `/src/db/seed.ts` دالة `ensureSeeded()` التي تعمل تلقائياً ضمن معاملة ذرية عند أول طلب مصادقة أو تهيئة (وتتحقق من عدد المستخدمين لمنع التكرار):
- **الحسابات الافتراضية (كلمة المرور المشفرة بـ `scrypt`: `123456`):**
  - مالك المخبز (`OWNER`): `owner`
  - وكلاء الورديات (`AGENT`): `agent_ahmed`, `agent_osman`, `agent_tijani`
- **البيانات المرجعية والتشغيلية الأولية:** إعدادات المخبز (`SDG` / `ج.س`)، 4 موردين، 6 أصناف مخزنية ودفعاتها، 5 فواتير شراء ودفعاتها، 3 وصفات إنتاج قياسية، 3 عملاء آجلين، 3 ورديات، 3 موظفين، وسجلات التدقيق والتنبيهات المبدئية.
