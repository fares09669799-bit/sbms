# SBMS — Installation Guide (`INSTALLATION_GUIDE.md`)

يوضح هذا الدليل خطوات إعداد وتشغيل نظام **SBMS** في بيئة التطوير المحلية أو الخادم المضيف.

---

## 1. المتطلبات الأساسية (Prerequisites)
- **Node.js:** الإصدار `22.x` أو أحدث (مطلوب لتشغيل `node server.ts` بنمط ESM مباشرة في الإنتاج).
- **npm:** الإصدار `10.x` أو أحدث.
- **PostgreSQL:** الإصدار `15` أو أحدث (أو مثيل **Cloud SQL PostgreSQL** متصل عبر وكيل Cloud SQL أو الشبكة الآمنة).

---

## 2. متغيرات البيئة المطلوبة (Environment Variables)
انسخ `.env.example` إلى `.env` واضبط القيم على الخادم فقط (لا تضع أي أسرار أو مفاتيح في متغيرات `VITE_*`):

```bash
cp .env.example .env
```

| المتغير | الوصف | مثال / ملاحظة |
|---|---|---|
| `APP_URL` | عنوان الاستضافة الفعلي للتطبيق (يُسمح به في سياسة CORS) | `https://your-bakery-app.run.app` |
| `SQL_HOST` | مضيف PostgreSQL أو مسار مقبس Cloud SQL Unix Socket | `/cloudsql/PROJECT:REGION:INSTANCE` أو `127.0.0.1` |
| `SQL_DB_NAME` | اسم قاعدة البيانات | `sbms_db` |
| `SQL_USER` | مستخدم قاعدة البيانات للتطبيق | مستخدم بصلاحيات DML |
| `SQL_PASSWORD` | كلمة مرور مستخدم قاعدة البيانات | سر قوي |
| `SQL_ADMIN_USER` | مستخدم إدارة المخطط والترحيلات (Drizzle Kit) | اختياري إذا كان نفسه `SQL_USER` |
| `SQL_ADMIN_PASSWORD` | كلمة مرور مستخدم الإدارة | سر قوي |
| `JWT_SECRET` | مفتاح توقيع رموز الوصول (`accessToken`) | سلسلة عشوائية بطول >= 32 بايت |
| `JWT_REFRESH_SECRET` | مفتاح توقيع رموز التحديث (`refreshToken`) — **مستقل عن `JWT_SECRET`** | سلسلة عشوائية مختلفة بطول >= 32 بايت |

---

## 3. التثبيت وتطبيق مخطط قاعدة البيانات
1. **تثبيت الاعتماديات:**
   ```bash
   npm install
   ```
2. **مزامنة مخطط قاعدة البيانات (31 جدولاً + الفهارس):**
   ```bash
   npx drizzle-kit push --config=src/db/drizzle.config.ts
   ```
3. **تشغيل خادم التطوير (Express + Vite Middleware على المنفذ 3000):**
   ```bash
   npm run dev
   ```
   سيقوم الخادم عند بدء التشغيل ببذر البيانات المرجعية والأدوار الأساسية (`src/db/seed.ts`) تلقائياً إذا كانت قاعدة البيانات فارغة.

---

## 4. التحقق من صحة التركيب
- فحص الأنواع (`TypeScript`):
  ```bash
  npm run lint
  ```
- بناء حزمة الإنتاج:
  ```bash
  npm run build
  ```
- فحص استجابة الخادم:
  ```bash
  curl http://localhost:3000/api/health
  ```
  الاستجابة المتوقعة: `{"ok":true,"service":"sbms-api","timestamp":"..."}`.
