import React, { useState } from 'react';
import { Eye, EyeOff, Lock, User, ShieldCheck, ArrowLeft } from 'lucide-react';
import { useSbms } from '../context/SbmsContext';
import { Button } from '../components/ui/Button';

const HERO_IMAGE = '/src/assets/images/login_bakery_hero_1794753871526.jpg';
const BRAND_EMBLEM = '/src/assets/images/bakery_brand_emblem_1794753872653.jpg';

export const LoginPage: React.FC = () => {
  const { login, loginWithGoogle, settings } = useSbms();
  const [username, setUsername] = useState('owner');
  const [password, setPassword] = useState('123456');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!username.trim()) {
      setError('يرجى إدخال اسم المستخدم.');
      return;
    }
    if (password.length < 4) {
      setError('يرجى إدخال كلمة المرور (4 أحرف على الأقل).');
      return;
    }

    setLoading(true);
    const res = await login(username, password, rememberMe);
    setLoading(false);
    if (!res.ok) {
      setError(res.error || 'تعذر تسجيل الدخول.');
    }
  };

  const handleGoogleSignIn = async () => {
    setError('');
    setLoading(true);
    const res = await loginWithGoogle();
    setLoading(false);
    if (!res.ok) {
      setError(res.error || 'تعذر تسجيل الدخول عبر Google.');
    }
  };

  const quickFillAccount = (role: 'OWNER' | 'AGENT') => {
    setError('');
    if (role === 'OWNER') {
      setUsername('owner');
      setPassword('123456');
    } else {
      setUsername('agent_ahmed');
      setPassword('123456');
    }
  };

  return (
    <div className="min-h-screen bg-[#F5F7F6] grid grid-cols-1 lg:grid-cols-12">
      {/* Right Column (RTL first): Login Form */}
      <div className="lg:col-span-5 flex flex-col justify-between bg-white px-6 py-8 sm:px-12 lg:px-14 border-l border-[#E2E7E5]">
        {/* Brand Identity Header */}
        <div className="flex items-center gap-3.5">
          <div className="w-11 h-11 rounded-xl overflow-hidden border border-[#E2E7E5] bg-[#142D35] shrink-0">
            <img
              src={BRAND_EMBLEM}
              alt="SBMS Logo"
              referrerPolicy="no-referrer"
              className="w-full h-full object-cover"
            />
          </div>
          <div>
            <div className="text-base font-bold text-[#142D35]">SBMS</div>
            <div className="text-xs text-[#5A6B6E]">نظام إدارة المخابز الذكي · {settings.bakeryName}</div>
          </div>
        </div>

        {/* Form Container */}
        <div className="w-full max-w-md mx-auto my-10">
          <div className="mb-8">
            <h1 className="text-2xl font-bold text-[#142D35] leading-snug">
              تسجيل الدخول إلى النظام المالي والتشغيلي
            </h1>
            <p className="text-sm text-[#5A6B6E] mt-2 leading-relaxed">
              أدخل بيانات الحساب المعتمدة. يتم التحقق من الصلاحيات عبر الخادم وتوجيهك حسب الدور الوظيفي.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5" noValidate>
            <div>
              <label htmlFor="sbms-username" className="block text-xs font-semibold text-[#142D35] mb-1.5">
                اسم المستخدم
              </label>
              <div className="relative">
                <User className="w-4 h-4 text-[#5A6B6E] absolute right-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  id="sbms-username"
                  type="text"
                  autoComplete="username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="مثال: owner أو agent_ahmed"
                  className="h-11 w-full rounded-lg border border-[#E2E7E5] bg-white pr-10 pl-3 text-sm text-[#142D35] focus:outline-none focus:border-[#176B55] focus:ring-2 focus:ring-[#176B55]/15"
                />
              </div>
            </div>

            <div>
              <label htmlFor="sbms-password" className="block text-xs font-semibold text-[#142D35] mb-1.5">
                كلمة المرور
              </label>
              <div className="relative">
                <Lock className="w-4 h-4 text-[#5A6B6E] absolute right-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  id="sbms-password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••"
                  className="h-11 w-full rounded-lg border border-[#E2E7E5] bg-white pr-10 pl-10 text-sm text-[#142D35] focus:outline-none focus:border-[#176B55] focus:ring-2 focus:ring-[#176B55]/15"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((s) => !s)}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-[#5A6B6E] hover:text-[#142D35] p-1 cursor-pointer"
                  aria-label={showPassword ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور'}
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <div className="flex items-center justify-between text-xs">
              <label className="inline-flex items-center gap-2 text-[#142D35] cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(e) => setRememberMe(e.target.checked)}
                  className="w-4 h-4 rounded border-[#E2E7E5] accent-[#176B55]"
                />
                <span>تذكر جلستي على هذا الجهاز</span>
              </label>
              <span className="text-[#5A6B6E]">العملة: الجنيه السوداني (SDG)</span>
            </div>

            {error && (
              <div
                role="alert"
                className="p-3 rounded-lg border border-[#B91C1C]/30 bg-[#FEF2F2] text-xs font-medium text-[#B91C1C]"
              >
                {error}
              </div>
            )}

            <Button type="submit" size="lg" className="w-full" disabled={loading}>
              <span>{loading ? 'جاري التحقق من قاعدة البيانات...' : 'دخول آمن إلى النظام'}</span>
              {!loading && <ArrowLeft className="w-4 h-4" />}
            </Button>

            <Button
              type="button"
              variant="outline"
              size="lg"
              className="w-full"
              disabled={loading}
              onClick={handleGoogleSignIn}
            >
              <span>تسجيل الدخول عبر Google (Firebase Auth)</span>
            </Button>
          </form>

          {/* Seeded Accounts Quick Fill */}
          <div className="mt-8 pt-6 border-t border-[#E2E7E5]">
            <div className="flex items-center gap-2 text-xs font-semibold text-[#142D35] mb-3">
              <ShieldCheck className="w-4 h-4 text-[#176B55]" />
              <span>الحسابات الافتراضية المهيأة في قاعدة البيانات</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <button
                type="button"
                onClick={() => quickFillAccount('OWNER')}
                className={`p-3 rounded-lg border text-right transition-colors cursor-pointer ${
                  username === 'owner'
                    ? 'border-[#176B55] bg-[#176B55]/5'
                    : 'border-[#E2E7E5] hover:bg-[#F5F7F6]'
                }`}
              >
                <div className="text-xs font-bold text-[#142D35]">حساب المالك (OWNER)</div>
                <div className="text-[11px] text-[#5A6B6E] mt-0.5 font-mono">owner / 123456</div>
              </button>
              <button
                type="button"
                onClick={() => quickFillAccount('AGENT')}
                className={`p-3 rounded-lg border text-right transition-colors cursor-pointer ${
                  username === 'agent_ahmed'
                    ? 'border-[#176B55] bg-[#176B55]/5'
                    : 'border-[#E2E7E5] hover:bg-[#F5F7F6]'
                }`}
              >
                <div className="text-xs font-bold text-[#142D35]">حساب الوكيل (AGENT)</div>
                <div className="text-[11px] text-[#5A6B6E] mt-0.5 font-mono">agent_ahmed / 123456</div>
              </button>
            </div>
          </div>
        </div>

        <div className="text-xs text-[#5A6B6E] flex items-center justify-between pt-4 border-t border-[#E2E7E5]">
          <span>SBMS — Smart Bakery Management System</span>
          <span>PostgreSQL + RBAC</span>
        </div>
      </div>

      {/* Left Column: Editorial Bakery Showcase */}
      <div className="lg:col-span-7 relative hidden lg:block bg-[#142D35] overflow-hidden">
        <img
          src={HERO_IMAGE}
          alt="مخبز سوداني حديث لإنتاج الخبز"
          referrerPolicy="no-referrer"
          className="absolute inset-0 w-full h-full object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-[#142D35]/95 via-[#142D35]/55 to-[#142D35]/30" />
        <div className="relative z-10 h-full flex flex-col justify-end p-12 text-white max-w-2xl">
          <div className="text-xs font-medium text-[#D8AD65] mb-3">
            منظومة محاسبة وتشغيل المخابز السودانية
          </div>
          <h2 className="text-3xl font-bold leading-snug text-balance">
            دقة محاسبية كاملة من جوال الدقيق حتى مطابقة نقدية الوردية
          </h2>
          <p className="text-sm text-white/80 mt-3 leading-relaxed">
            إدارة متكاملة للموردين، الفواتير والدفعات الجزئية، حركة المخزون بالدفعات، وصفات الإنتاج، مبيعات الوكلاء، وتقارير الأرباح والخسائر بمعادلات محاسبية شفافة.
          </p>
          <div className="grid grid-cols-3 gap-6 mt-8 pt-6 border-t border-white/15">
            <div>
              <div className="text-lg font-bold font-mono tabular-nums text-[#D8AD65]">100%</div>
              <div className="text-xs text-white/75 mt-1">فصل الصلاحيات والرقابة</div>
            </div>
            <div>
              <div className="text-lg font-bold font-mono tabular-nums text-[#D8AD65]">SDG</div>
              <div className="text-xs text-white/75 mt-1">معاملات مالية دقيقة</div>
            </div>
            <div>
              <div className="text-lg font-bold font-mono tabular-nums text-[#D8AD65]">ACID</div>
              <div className="text-xs text-white/75 mt-1">ترابط ذري بقاعدة البيانات</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
