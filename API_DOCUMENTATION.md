# SBMS — REST API Documentation (`API_DOCUMENTATION.md`)

**المسار الأساسي:** `/api`
**تنسيق البيانات:** `application/json`
**المصادقة:** `Authorization: Bearer <accessToken>` (`HS256`، صلاحية 15 دقيقة، مع تدوير `refreshToken` لمدة 7 أيام)
**فحص الصحة:** `GET /api/health` -> `{ ok: true, service: "sbms-api", timestamp }`

---

## 1. المصادقة وإدارة الجلسات (`/api/auth`)

| المسار | الصلاحية | الوصف | المدخلات الأساسية |
|---|---|---|---|
| `POST /api/auth/login` | عام (مقيد بمحدد الطلبات) | تسجيل الدخول باسم المستخدم وكلمة المرور مع إرجاع `avatarUrl` و`permissions` | `{ username, password }` |
| `POST /api/auth/firebase-sync` | عام (Firebase ID Token) | التحقق من رمز Firebase وتفعيل/ربط الحساب في PostgreSQL | `{ idToken }` |
| `POST /api/auth/refresh` | عام (مقيد بمحدد الطلبات) | تدوير أحادي الاستخدام لـ `refreshToken` وإصدار `accessToken` و `refreshToken` جديدين (مع كشف إعادة الاستخدام) | `{ refreshToken }` |
| `POST /api/auth/logout` | عام / جلسة | إلغاء `refreshToken` في جدول `user_sessions` | `{ refreshToken }` |
| `GET /api/auth/me` | مصادق (`requireAuth`) | استرجاع بيانات الحساب الحالي الموثقة شاملاً `avatarUrl` و`permissions` | — |
| `POST /api/auth/change-password` | مصادق (`requireAuth`) | تغيير كلمة مرور المستخدم بعد التحقق من الحالية | `{ currentPassword, newPassword }` |

---

## 2. تهيئة بيئة العمل (`/api/workspace/bootstrap`)

- `GET /api/workspace/bootstrap` (**`requireAuth`**):
  - يعيد بيانات لوحة التحكم المفلترة على مستوى الخادم حسب الدور:
    - **`OWNER`**: الموردون، الفواتير، الدفعات، المخزون، `rawMaterials`، التشغيلات، الحركات، الوصفات، الإنتاج، المبيعات، `breadMovements`، المصروفات، `cashTransactions`، العملاء، `customerPayments`، `customerAdjustments`، الوكلاء مع مؤشرات أدائهم المحسوبة من DB، الورديات، `handovers`، الموظفون، `employeeAttendance`، `payrollRecords`، التنبيهات، سجل التدقيق، الإعدادات.
    - **`AGENT`**: بيانات الورديات الخاصة بالوكيل، تسليمات العهد الخاصة به (`handovers`)، الإنتاج والمبيعات وحركات الخبز (`breadMovements`) والمصروفات الخاصة به فقط، الوصفات و`rawMaterials`، وقائمة العملاء للاختيار في البيع الآجل (مع عزل كافة بيانات الموردين، الخزينة، الأرصدة المالية، المخزون، الموظفين، وسجل التدقيق).

---

## 3. الموردون والمشتريات والدفعات (`/api/suppliers`) — **`OWNER` فقط (`requireRole('OWNER')`)**

| المسار | الوصف | السلوك الذري والضوابط |
|---|---|---|
| `GET /api/suppliers` | قائمة الموردين مع دعم `?search=&status=&category=&page=&limit=` | يعيد `{ suppliers, pagination }` مع الرصيد المستحق المحسوب |
| `GET /api/suppliers/invoices` | قائمة فواتير المشتريات مع دعم `?search=&supplierId=&workflowStatus=&paymentStatus=&page=&limit=` | يعيد `{ invoices, pagination }` |
| `GET /api/suppliers/:id` | الملف المالي الكامل للمورد | يعيد `{ supplier, invoices, payments, products, statement }` |
| `POST /api/suppliers` | إنشاء مورد جديد | التحقق من المدخلات + توليد كود متسلسل + `audit_logs` |
| `PATCH /api/suppliers/:id` | تعديل بيانات مورد أو إيقافه/تفعيله | تحديث البيانات + `audit_logs` |
| `POST /api/suppliers/invoices` | إنشاء فاتورة مشتريات متعددة الأصناف (`مسودة` أو `مرحّلة`) | منع التكرار (`409`) + تحديث المخزون والتشغيلات والمورد والخزينة ذرياً |
| `POST /api/suppliers/invoices/:invoiceId/post` | ترحيل فاتورة مسودة إلى مرحّلة | تنفيذ كامل الأثر المخزني والمالي ذرياً |
| `POST /api/suppliers/invoices/:invoiceId/cancel` | إلغاء فاتورة مسودة أو مرحّلة | عكس الأثر المخزني والمالي ذرياً مع منع الكسر السالب |
| `POST /api/suppliers/:id/payments` | تسجيل دفعة لمورد | منع التكرار + إيصال سداد رسمي |
| `POST /api/suppliers/payments/:paymentId/reverse` | قيد عكسي لدفعة مورد | تحديث المورد والفاتورة والخزينة + `audit_logs` |

---

## 4. المخزون والمستودع (`/api/inventory`) — **`OWNER` فقط (`requireRole('OWNER')`)**

| المسار | الوصف | السلوك والضوابط |
|---|---|---|
| `GET /api/inventory` | استرجاع الأصناف والتشغيلات والتنبيهات وآخر 200 حركة | — |
| `GET /api/inventory/items/:id` | تفاصيل صنف محدد مع تشغيلاته وسجل حركاته | — |
| `POST /api/inventory/items` | تعريف صنف جديد | التحقق من تفرد `sku` (`409`) وصحة الوحدة (`400`) |
| `PATCH /api/inventory/items/:id` | تحديث بيانات الصنف | توثيق في `audit_logs` |
| `POST /api/inventory/movements` | تسجيل حركة مخزنية | منع التكرار عبر `clientTxId` (`409`)، التحقق من الوحدة، منع السحب السالب، وصرف `FEFO/FIFO` |

---

## 5. الوصفات والإنتاج والمبيعات وحركات الخبز والوكلاء والورديات (`/api/*`)

| المسار | الصلاحية | الوصف والضوابط |
|---|---|---|
| `POST /api/recipes` | `OWNER` فقط | إنشاء وصفة إنتاج جديدة مع المكونات القياسية و`otherIngredients` |
| `PUT /api/recipes/:id` | `OWNER` فقط | تعديل المقادير المعيارية وسعر البيع و`otherIngredients` لوصفة إنتاج |
| `PATCH /api/recipes/:id/toggle` | `OWNER` فقط | تفعيل أو إيقاف وصفة إنتاج |
| `POST /api/production` | `OWNER` أو `AGENT` (`PRODUCTION_LOG`) | تسجيل دفعة إنتاج بالتاريخ والوردية والمكونات الإضافية، منع التكرار (`409`)، وخصم `FEFO` ذرياً |
| `POST /api/sales` | `OWNER` أو `AGENT` (`SALES_LOG`) | تسجيل بيع نقدي أو آجل مع فحص كفاية الخبز المتاح بالوردية (`400`) ومنع التكرار (`409`) |
| `POST /api/bread-movements` | حسب النوع | معاملات مستقلة للمرتجعات (`مرتجع`)، التالف (`تالف`)، والتسويات المعتمدة (`تعديل معتمد` للمالك فقط `403`) |
| `POST /api/expenses` | `OWNER` أو `AGENT` (`EXPENSES_LOG`) | تسجيل مصروف بالبيان ووسيلة الدفع والمرفق (فحص MIME وحظر `SVG/HTML`)، منع التكرار (`409`)، قيد `OUT` في `cash_transactions`، وخصم من `expectedCash` للوردية المفتوحة |
| `POST /api/shifts/open` | `OWNER` أو `AGENT` (`SHIFT_MANAGE`) | فتح وردية جديدة بالتاريخ والنوع والعهدة الافتتاحية مع قفل تزامن وحظر فتح أكثر من وردية للوكيل (`409`) |
| `POST /api/shifts/:id/close` | `OWNER` أو `AGENT` مالك الوردية (`SHIFT_MANAGE`) | إغلاق الوردية بقفل تزامن، إنشاء `shift_handovers` وتنبيه الفوارق، وإرجاع ملخص التقرير |
| `GET /api/shifts/:id/report` | `OWNER` أو `AGENT` مالك الوردية | التقرير الختامي الشامل للوردية |
| `POST /api/shifts/:id/approve` | `OWNER` فقط | اعتماد إغلاق الوردية وتأكيد استلام العهدة النقدية وتسوية فرق العهدة في الخزينة |
| `POST /api/handovers/:id/confirm` | `OWNER` فقط | تأكيد استلام عهدة نقدية محددة وتسجيل أثر الفارق في الخزينة ذرياً |
| `POST /api/customers/:id/payments` | `OWNER` فقط | تحصيل دفعة من عميل آجل (`method`, `date`, `notes`, `clientTxId`) مع قفل ذري وتحديث الرصيد والخزينة |
| `POST /api/agents` | `OWNER` فقط | إنشاء حساب وكيل جديد مع الصورة الشخصية (JPG/PNG/WEBP فقط) والصلاحيات وكلمة المرور المشفرة |
| `PATCH /api/agents/:id` | `OWNER` فقط | تعديل بيانات الوكيل، الصورة (JPG/PNG/WEBP فقط)، الوردية، الصلاحيات، كلمة المرور، وحالة التفعيل |
| `PATCH /api/agents/:id/toggle` | `OWNER` فقط | تفعيل أو إيقاف حساب وكيل |
| `POST /api/notifications/read-all` | `OWNER` فقط | تعليم جميع التنبيهات كمقروءة |
| `PATCH /api/settings` | `OWNER` فقط | تحديث إعدادات المخبز والسياسة المخزنية |

---

## 6. المحاسبة والخزينة والعملاء والموظفون والتقارير (`/api/accounting`) — **`OWNER` فقط (`requireRole('OWNER')`)**

| المسار | الوصف | السلوك والضوابط |
|---|---|---|
| `POST /api/accounting/expenses/:id/reverse` | عكس مصروف تشغيلي | إنشاء مصروف عكسي بالسالب + قيد `IN` بالخزينة + تحديث الوردية المفتوحة إن وجدت + `audit_logs` |
| `GET /api/accounting/cash` | سجل الخزينة والتدفقات النقدية | يعيد ملخص الرصيد الحي (`liveCashBalance`)، التدفقات المفلترة مع الصفحات، وسجل تسليمات عهد الورديات |
| `POST /api/accounting/cash/transactions` | تسجيل إيداع نقدي أو سحب نقدي مباشر | دعم `إيداع نقدي` (`IN`, `تمويل وخزينة`) و`سحب نقدي` (`OUT`, `تمويل وخزينة`) مع منع التكرار (`clientTxId`) |
| `POST /api/accounting/cash/transactions/:id/reverse` | قيد عكسي لحركة خزينة | إنشاء حركة معاكسة وحفظ التوازن دون حذف |
| `POST /api/accounting/customers` | إضافة عميل آجل جديد | تعيين سقف الائتمان والحالة وتوثيق التدقيق |
| `PATCH /api/accounting/customers/:id` | تعديل بيانات عميل أو إيقافه/تفعيله | تحديث البيانات وسقف الائتمان |
| `GET /api/accounting/customers/:id` | كشف حساب العميل التفصيلي | يعيد المبيعات الآجلة، الدفعات، التسويات، وجدول كشف الحساب التراكمي (`statement`) |
| `POST /api/accounting/customers/:id/adjustments` | تسجيل تسوية على حساب عميل | إدراج في `customer_adjustments` وإعادة احتساب `Credit Sales - Payments + Adjustments` |
| `POST /api/accounting/customers/payments/:paymentId/reverse` | عكس دفعة تحصيل عميل | إدراج دفعة عكسية + قيد `OUT` بالخزينة + تحديث رصيد العميل |
| `POST /api/accounting/employees` | إضافة موظف جديد | حفظ الوظيفة والراتب الشهري والوردية |
| `PATCH /api/accounting/employees/:id` | تعديل بيانات أو راتب أو حالة موظف | تحديث البيانات مع `audit_logs` |
| `GET /api/accounting/employees/:id` | ملف الموظف وسجل الحضور والرواتب | يعيد الحضور، مسير الرواتب، والراتب المتبقي (`remainingSalary`) |
| `POST /api/accounting/employees/:id/attendance` | تسجيل/تحديث الحضور اليومي للموظف | إدراج أو تحديث سجل اليوم (`حاضر` \| `غائب` \| `إجازة`) بدون تكرار |
| `POST /api/accounting/employees/:id/payroll` | صرف راتب أو سلفة لموظف | تحديث `paidThisMonth` + إنشاء مصروف `'رواتب وأجور'` + قيد `OUT` بالخزينة ذرياً |
| `POST /api/accounting/employees/payroll/:payrollId/reverse` | عكس قيد صرف راتب | عكس الراتب والمصروف المرتبط (`EXP-...`) وقيد الخزينة ذرياً |
| `GET /api/accounting/dashboard` | المؤشرات المحاسبية الحية للوحة المالك | يدعم `?dateFrom=&dateTo=` ويعيد الإيرادات، النقد المحصل، COGS، المصروفات، صافي الربح، الخزينة، الذمم، الموردين، المخزون، والسلاسل البيانية |
| `GET /api/accounting/reports` | مركز التقارير الـ 13 من قاعدة البيانات | يدعم `?type=&dateFrom=&dateTo=&agentId=&supplierId=&breadType=&search=&page=&limit=` لجميع التقارير الـ 13 مع `allRowsForExport` والملخص وأساس القياس المحاسبي |
