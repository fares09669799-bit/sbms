import React, { Suspense, useEffect, useState } from 'react';
import { SbmsProvider, useSbms } from './context/SbmsContext';
import { LoginPage } from './pages/LoginPage';
import { Sidebar } from './components/layout/Sidebar';
import { TopBar } from './components/layout/TopBar';
import { AgentNavKey, OwnerNavKey } from './types/sbms';
import { Button } from './components/ui/Button';
import { RouteErrorBoundary } from './components/ui/RouteErrorBoundary';
import { lazyWithRetry } from './lib/lazyWithRetry';

const OwnerDashboard = lazyWithRetry(() =>
  import('./pages/owner/OwnerDashboard').then((m) => ({ default: m.OwnerDashboard }))
);
const SuppliersPage = lazyWithRetry(() =>
  import('./pages/owner/SuppliersPage').then((m) => ({ default: m.SuppliersPage }))
);
const SupplierProfilePage = lazyWithRetry(() =>
  import('./pages/owner/SupplierProfilePage').then((m) => ({ default: m.SupplierProfilePage }))
);
const InventoryPage = lazyWithRetry(() =>
  import('./pages/owner/InventoryPage').then((m) => ({ default: m.InventoryPage }))
);
const ProductionPage = lazyWithRetry(() =>
  import('./pages/owner/ProductionPage').then((m) => ({ default: m.ProductionPage }))
);
const SalesPage = lazyWithRetry(() =>
  import('./pages/owner/SalesPage').then((m) => ({ default: m.SalesPage }))
);
const ReportsPage = lazyWithRetry(() =>
  import('./pages/owner/ReportsPage').then((m) => ({ default: m.ReportsPage }))
);
const AgentsShiftsPage = lazyWithRetry(() =>
  import('./pages/owner/OperationsSubPages').then((m) => ({ default: m.AgentsShiftsPage }))
);
const AuditNotificationsPage = lazyWithRetry(() =>
  import('./pages/owner/OperationsSubPages').then((m) => ({ default: m.AuditNotificationsPage }))
);
const CashExpensesPage = lazyWithRetry(() =>
  import('./pages/owner/OperationsSubPages').then((m) => ({ default: m.CashExpensesPage }))
);
const CustomersPage = lazyWithRetry(() =>
  import('./pages/owner/OperationsSubPages').then((m) => ({ default: m.CustomersPage }))
);
const EmployeesPage = lazyWithRetry(() =>
  import('./pages/owner/OperationsSubPages').then((m) => ({ default: m.EmployeesPage }))
);
const SettingsPage = lazyWithRetry(() =>
  import('./pages/owner/OperationsSubPages').then((m) => ({ default: m.SettingsPage }))
);
const AgentWorkspace = lazyWithRetry(() =>
  import('./pages/agent/AgentWorkspace').then((m) => ({ default: m.AgentWorkspace }))
);

const OWNER_TITLES: Record<OwnerNavKey, string> = {
  dashboard: 'لوحة التحكم الرئيسية للمالك',
  suppliers: 'إدارة الموردين والمشتريات',
  'supplier-profile': 'الملف المالي للمورد',
  inventory: 'إدارة المخزون والمستودع',
  production: 'مراقبة الإنتاج والوصفات',
  sales: 'إدارة المبيعات ومطابقة الخبز',
  'agents-shifts': 'إدارة الوكلاء والورديات',
  'cash-expenses': 'الخزينة والمصروفات التشغيلية',
  customers: 'العملاء والمديونيات',
  employees: 'الموظفون والرواتب',
  reports: 'مركز التقارير المالية',
  'audit-notifications': 'التنبيهات وسجل التدقيق',
  settings: 'إعدادات المخبز',
};

const AGENT_TITLES: Record<AgentNavKey, string> = {
  'agent-dashboard': 'لوحة الوكيل اليومية',
  'agent-production': 'تسجيل الإنتاج واستهلاك المواد',
  'agent-sales': 'مبيعات الخبز والمرتجعات',
  'agent-expenses': 'المصروفات اليومية للوردية',
  'agent-shift': 'فتح وإغلاق الوردية والتسليم',
  'agent-history': 'سجل النشاط الشخصي',
};

const AGENT_TAB_PERM: Partial<Record<AgentNavKey, string>> = {
  'agent-production': 'PRODUCTION_LOG',
  'agent-sales': 'SALES_LOG',
  'agent-expenses': 'EXPENSES_LOG',
  'agent-shift': 'SHIFT_MANAGE',
};

const AppShell: React.FC = () => {
  const { user, isBootstrapping, dataError, refreshWorkspace } = useSbms();
  const [ownerNav, setOwnerNav] = useState<OwnerNavKey>('dashboard');
  const [selectedSupplierId, setSelectedSupplierId] = useState<string>('1');
  const [agentNav, setAgentNav] = useState<AgentNavKey>('agent-dashboard');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  useEffect(() => {
    if (user && user.role === 'AGENT') {
      const reqPerm = AGENT_TAB_PERM[agentNav];
      const perms = Array.isArray(user.permissions)
        ? user.permissions
        : ['PRODUCTION_LOG', 'SALES_LOG', 'EXPENSES_LOG', 'SHIFT_MANAGE'];
      if (reqPerm && !perms.includes(reqPerm)) {
        setAgentNav('agent-dashboard');
      }
    }
  }, [user, agentNav]);

  if (isBootstrapping) {
    return (
      <div className="min-h-screen bg-[#F5F7F6] flex items-center justify-center p-6">
        <div className="bg-white border border-[#E2E7E5] rounded-xl px-8 py-6 text-center space-y-2">
          <div className="text-sm font-bold text-[#142D35]">SBMS — نظام إدارة المخابز الذكي</div>
          <div className="text-xs text-[#5A6B6E]">جاري استعادة الجلسة والتحقق من الصلاحيات...</div>
        </div>
      </div>
    );
  }

  if (!user) {
    return <LoginPage />;
  }

  const isOwner = user.role === 'OWNER';

  const openSupplierProfile = (supplierId: string) => {
    setSelectedSupplierId(supplierId);
    setOwnerNav('supplier-profile');
  };

  const pageTitle = isOwner ? OWNER_TITLES[ownerNav] : AGENT_TITLES[agentNav];
  const breadcrumbParent = isOwner ? 'بوابة المالك' : 'بوابة الوكيل';

  return (
    <div className="min-h-screen flex bg-[#F5F7F6] text-[#142D35] overflow-x-hidden">
      <Sidebar
        activeOwnerNav={ownerNav}
        onSelectOwnerNav={setOwnerNav}
        activeAgentNav={agentNav}
        onSelectAgentNav={setAgentNav}
        mobileOpen={mobileMenuOpen}
        onCloseMobile={() => setMobileMenuOpen(false)}
      />

      <div className="flex-1 flex flex-col min-w-0">
        <TopBar
          pageTitle={pageTitle}
          breadcrumbParent={breadcrumbParent}
          onOpenMobileMenu={() => setMobileMenuOpen(true)}
          onNavigateOwner={setOwnerNav}
        />

        {dataError && (
          <div className="bg-[#FEF2F2] border-b border-[#B91C1C]/30 px-4 lg:px-8 py-2.5 flex items-center justify-between gap-4 no-print">
            <span className="text-xs font-medium text-[#B91C1C]">{dataError}</span>
            <Button size="sm" variant="outline" onClick={() => refreshWorkspace()}>
              إعادة المحاولة
            </Button>
          </div>
        )}

        <main className="flex-1 p-4 lg:p-8 max-w-[1440px] w-full mx-auto">
          <RouteErrorBoundary resetKey={isOwner ? `owner:${ownerNav}` : `agent:${agentNav}`}>
            <Suspense
              fallback={
                <div className="bg-white border border-[#E2E7E5] rounded-xl p-8 text-center text-xs text-[#5A6B6E]">
                  جاري تحميل الصفحة...
                </div>
              }
            >
              {isOwner ? (
                <>
                  {ownerNav === 'dashboard' && <OwnerDashboard onNavigate={setOwnerNav} />}
                  {ownerNav === 'suppliers' && <SuppliersPage onOpenProfile={openSupplierProfile} />}
                  {ownerNav === 'supplier-profile' && (
                    <SupplierProfilePage
                      supplierId={selectedSupplierId}
                      onBack={() => setOwnerNav('suppliers')}
                    />
                  )}
                  {ownerNav === 'inventory' && <InventoryPage />}
                  {ownerNav === 'production' && <ProductionPage />}
                  {ownerNav === 'sales' && <SalesPage />}
                  {ownerNav === 'agents-shifts' && <AgentsShiftsPage />}
                  {ownerNav === 'cash-expenses' && <CashExpensesPage />}
                  {ownerNav === 'customers' && <CustomersPage />}
                  {ownerNav === 'employees' && <EmployeesPage />}
                  {ownerNav === 'reports' && <ReportsPage />}
                  {ownerNav === 'audit-notifications' && <AuditNotificationsPage />}
                  {ownerNav === 'settings' && <SettingsPage />}
                </>
              ) : (
                <AgentWorkspace activeTab={agentNav} onNavigate={setAgentNav} />
              )}
            </Suspense>
          </RouteErrorBoundary>
        </main>
      </div>
    </div>
  );
};

export default function App() {
  return (
    <SbmsProvider>
      <AppShell />
    </SbmsProvider>
  );
}
