# SBMS — Database Schema Documentation (`DATABASE_SCHEMA.md`)

**نظام قاعدة البيانات:** PostgreSQL (Cloud SQL Developer Edition — `europe-west1`)
**طبقة الوصول والوصف (ORM):** Drizzle ORM (`drizzle-orm/pg-core` + `pg`) مع `drizzle-kit` لإدارة المخطط والترحيلات.
**ملاحظة معمارية:** تم استخدام Drizzle ORM مع أنواع عشرية دقيقة `NUMERIC(14,2)` للمبالغ المالية و`NUMERIC(14,3)` للكميات المخزنية، ومفاتيح أجنبية وفهارس تغطي الموردين والمشتريات والمخزون والإنتاج والمبيعات وحركات الخبز والورديات والمحاسبة والخزينة والعملاء والموظفين ومنع تكرار المعاملات (`client_tx_id`).

---

## قائمة الجداول (31 جدولاً علائقياً)

### 1. الهوية والصلاحيات والجلسات
| الجدول | الغرض | المفاتيح والقيود الرئيسية |
|---|---|---|
| `roles` | تعريف الأدوار (`OWNER`, `AGENT`) | `id` PK, `code` UNIQUE |
| `permissions` | جدول الصلاحيات التفصيلية لكل وحدة | `id` PK, `code` UNIQUE, `role_code` INDEX |
| `users` | حسابات المالك والوكلاء | `id` PK, `uid` UNIQUE, `username` UNIQUE, `email`, `avatar_url`, `permissions` (`JSONB`), `role_id` FK -> `roles.id`, `is_active` |
| `user_sessions` | إدارة رموز التحديث وتدويرها وإلغاء الجلسات | `id` PK, `user_id` FK -> `users.id` (CASCADE), `token_hash` UNIQUE, `revoked`, `expires_at` |

### 2. الموردون والمشتريات (موسّع في المرحلة 3)
| الجدول | الغرض | المفاتيح والقيود الرئيسية |
|---|---|---|
| `suppliers` | السجل المالي والمحاسبي للموردين | `id` PK, `code` UNIQUE, `total_purchases`, `total_payments`, `adjustments` (`NUMERIC(14,2)`), `status` INDEX |
| `supplier_products` | الأصناف المرتبطة بكل مورد وآخر سعر توريد | `id` PK, `supplier_id` FK -> `suppliers.id` (CASCADE) |
| `purchase_invoices` | فواتير المشتريات وحالاتها التشغيلية والمالية | `id` PK, `invoice_number` UNIQUE, `reference` UNIQUE, `client_tx_id` INDEX, `supplier_id` FK, `workflow_status` (`مسودة`/`مرحّلة`/`ملغاة`) INDEX |
| `purchase_invoice_items` | بنود الأصناف المتعددة داخل كل فاتورة شراء | `id` PK, `invoice_id` FK -> `purchase_invoices.id` (CASCADE), `inventory_item_id` FK, `batch_code`, `expiry_date` |
| `supplier_payments` | الدفعات المالية والقيود العكسية (`is_reversal`) | `id` PK, `reference` UNIQUE, `client_tx_id` INDEX, `supplier_id` FK, `invoice_id` FK |

### 3. المستودع والمخزون (موسّع في المرحلة 3)
| الجدول | الغرض | المفاتيح والقيود الرئيسية |
|---|---|---|
| `inventory_items` | أصناف المواد الخام والتغليف والأرصدة الحالية | `id` PK, `sku` UNIQUE, `available_quantity` (`NUMERIC(14,3)`), `average_cost` (`NUMERIC(14,2)`), `primary_supplier_id` FK |
| `inventory_batches` | دفعات التشغيلات وتواريخ الصلاحية لخصم `FEFO/FIFO` | `id` PK, `inventory_item_id` FK -> `inventory_items.id` (CASCADE), `quantity_remaining`, `unit_cost`, `expiry_date` |
| `stock_movements` | السجل الدائم لحركات الصرف والاستلام والجرد والمرتجعات | `id` PK, `reference` UNIQUE, `client_tx_id` INDEX, `inventory_item_id` FK, `batch_code`, `expiry_date`, `related_supplier_id` FK |

### 4. الإنتاج والوصفات (موسّع في المرحلة 4)
| الجدول | الغرض | المفاتيح والقيود الرئيسية |
|---|---|---|
| `production_recipes` | الوصفات المعيارية لكل نوع خبز | `id` PK, `bread_type` UNIQUE, `other_ingredients` (`JSONB`), `is_active`, `notes` |
| `production_records` | سجلات دفعات الإنتاج الفعلية والتالف | `id` PK, `reference` UNIQUE, `client_tx_id` UNIQUE, `shift_id` FK -> `shifts.id`, `agent_id` FK, `recipe_id` FK, `other_ingredients_summary` |
| `production_ingredients` | تفاصيل الكميات المستهلكة فعلياً لكل دفعة إنتاج | `id` PK, `production_record_id` FK -> `production_records.id` (CASCADE), `inventory_item_id` FK |

### 5. المبيعات وحركات الخبز والعملاء والخزينة (موسّع في المرحلتين 4 و5)
| الجدول | الغرض | المفاتيح والقيود الرئيسية |
|---|---|---|
| `customers` | حسابات عملاء البيع الآجل وحدود الائتمان والتسويات | `id` PK, `total_credit_sales`, `total_payments`, `adjustments`, `outstanding_balance`, `status`, `notes` |
| `customer_payments` | دفعات تحصيل المديونيات وعكسها (`is_reversal`) | `id` PK, `reference` UNIQUE, `client_tx_id` INDEX, `customer_id` FK -> `customers.id`, INDEX(`date`) `idx_cust_pay_date` |
| `customer_adjustments` | تسويات أرصدة العملاء المدينة (`جديد في المرحلة 5`) | `id` PK, `reference` UNIQUE, `customer_id` FK -> `customers.id` (CASCADE), `amount`, INDEX(`date`) `idx_cust_adj_date` |
| `sales` | فواتير المبيعات النقدية والآجلة | `id` PK, `reference` UNIQUE, `client_tx_id` UNIQUE, `shift_id` FK -> `shifts.id`, `agent_id` FK, INDEX(`customer_id`) `idx_sales_customer`, INDEX(`date`, `payment_type`) |
| `sale_items` | بنود أصناف الخبز المباعة داخل الفاتورة | `id` PK, `sale_id` FK -> `sales.id` (CASCADE) |
| `bread_movements` | معاملات الخبز المستقلة (`مرتجع` / `تالف` / `تعديل معتمد`) | `id` PK, `reference` UNIQUE, `client_tx_id` INDEX, `shift_id` FK -> `shifts.id`, `agent_id` FK -> `users.id`, INDEX(`date`, `type`) |
| `expenses` | المصروفات التشغيلية وعكسها (`payment_method`, `attachment_data`, `is_reversal`) | `id` PK, `reference` UNIQUE, `client_tx_id` INDEX, `responsible_user_id` FK, `shift_id` FK, INDEX(`category`, `status`) `idx_expenses_cat_status` |
| `cash_transactions` | دفتر الخزينة للتدفقات النقدية الداخلة والخارجة والقيود العكسية | `id` PK, `reference` UNIQUE, `client_tx_id` INDEX, `category`, `direction` (`IN`/`OUT`), INDEX(`direction`, `category`) `idx_cash_dir_cat`, `is_reversal`, `reversed_tx_id` |

### 6. الورديات والموظفون والحوكمة (موسّع في المراحل 4 و5 و6)
| الجدول | الغرض | المفاتيح والقيود الرئيسية |
|---|---|---|
| `shifts` | الورديات اليومية ومطابقة الخبز والنقدية | `id` PK, `agent_id` FK -> `users.id`, `authorized_adjustments`, `opened_at`, `closed_at`, INDEX(`status`, `date`), INDEX(`agent_id`, `status`) `idx_shifts_agent_status` |
| `shift_handovers` | السجل الدائم لتسليم واستلام العهد واعتماد المالك | `id` PK, `shift_id` FK -> `shifts.id` (CASCADE), `from_agent_id` FK, `expected_cash`, `handed_cash`, `cash_difference`, `expected_bread`, `handed_bread`, `bread_difference`, `received_by_user_id` FK, `approved_by_user_id` FK |
| `employees` | سجل العاملين والأجور الأساسية والحالة | `id` PK, `status`, `notes`, `monthly_salary`, `paid_this_month` |
| `employee_attendance` | سجل الحضور والانصراف اليومي للموظفين | `id` PK, `employee_id` FK -> `employees.id` (CASCADE), `date`, `status`, `notes`, `recorded_by` |
| `payroll` | مسيرات الرواتب الشهرية والقيود العكسية (`is_reversal`) | `id` PK, `reference` UNIQUE, `client_tx_id` INDEX, `employee_id` FK -> `employees.id` (CASCADE), `payment_method`, `reversed_payroll_id` |
| `audit_logs` | سجل التدقيق المالي غير القابل للحذف أو التعديل | `id` PK, `reference` UNIQUE, `user_id` FK, INDEX(`entity_type`, `timestamp`) |
| `notifications` | تنبيهات القواعد الحسابية (نقص مخزون، فوارق وردية) | `id` PK, `rule_code`, `is_read` |
| `bakery_settings` | الإعدادات العامة والسياسات المحاسبية للمخبز | `id` PK, `allow_negative_inventory`, `standard_loaf_price` |

> **فهارس الأداء المضافة في المرحلة 6 (مطبقة في PostgreSQL):** `idx_sales_customer`, `idx_cust_pay_date`, `idx_cust_adj_date`, `idx_shifts_agent_status`, `idx_expenses_cat_status`, `idx_cash_dir_cat` لتسريع استعلامات كشوف العملاء، مطابقة الورديات، وتدفقات الخزينة والتقارير.

---

## المعادلات المحاسبية المنفذة على مستوى قاعدة البيانات والخادم
1. **رصيد المورد المتبقي:** `total_purchases - total_payments + adjustments`
2. **رصيد العميل المستحق:** `total_credit_sales - total_payments + adjustments`
3. **حالة فاتورة الشراء:** حالة تشغيلية (`مسودة` | `مرحّلة` | `ملغاة`) وحالة سداد (`مدفوعة بالكامل` | `مدفوعة جزئياً` | `آجلة`).
4. **متوسط التكلفة المرجح للمخزون:** `(prevQty * prevAvgCost + purchaseLineTotal) / (prevQty + purchasedQty)`
5. **صرف التشغيلات (`FEFO/FIFO`):** استهلاك الرصيد المتبقي في `inventory_batches` بدءاً من أقرب تاريخ صلاحية (`expiry_date ASC`).
6. **الخبز المتاح بالوردية:** `opening_bread + produced_bread + returned_bread`
7. **رصيد الإغلاق المتوقع للخبز:** `available_bread - sold_bread - damaged_bread - authorized_adjustments`
8. **النقدية المتوقعة للوردية:** `opening_cash + cash_sales_amount - total_expenses`
9. **إجمالي الإيرادات (Modified Accrual):** `cash_sales_revenue + credit_sales_revenue` (الإيداعات النقدية المباشرة لا تدخل في الإيراد).
10. **النقدية المحصلة فعلياً:** `cash_sales_revenue + customer_payments_collected`
11. **صافي الربح التقديري:** `Sales Revenue - COGS (Consumed Ingredients × Weighted Avg Cost) - Operating Expenses`
12. **الرصيد الفعلي للخزينة:** `SUM(IN cash_transactions) - SUM(OUT cash_transactions)`
