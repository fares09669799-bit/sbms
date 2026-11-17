import React from 'react';
import {
  LayoutDashboard,
  Truck,
  Package,
  Flame,
  ShoppingBag,
  Users,
  Wallet,
  UserCheck,
  Briefcase,
  FileBarChart2,
  ShieldAlert,
  Settings,
  LogOut,
  Clock,
  Receipt,
  History,
  X,
} from 'lucide-react';
import { AgentNavKey, OwnerNavKey } from '../../types/sbms';
import { useSbms } from '../../context/SbmsContext';
import { cn } from '../../lib/utils';

const BRAND_EMBLEM = '/src/assets/images/bakery_brand_emblem_1794753872653.jpg';

interface SidebarProps {
  activeOwnerNav: OwnerNavKey;
  onSelectOwnerNav: (key: OwnerNavKey) => void;
  activeAgentNav: AgentNavKey;
  onSelectAgentNav: (key: AgentNavKey) => void;
  mobileOpen: boolean;
  onCloseMobile: () => void;
}

const OWNER_MENU: { key: OwnerNavKey; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { key: 'dashboard', label: 'لوحة التحكم الرئيسية', icon: LayoutDashboard },
  { key: 'suppliers', label: 'الموردون والمشتريات', icon: Truck },
  { key: 'inventory', label: 'المخزون والمستودع', icon: Package },
  { key: 'production', label: 'الإنتاج والوصفات', icon: Flame },
  { key: 'sales', label: 'المبيعات والأصناف', icon: ShoppingBag },
  { key: 'agents-shifts', label: 'الوكلاء والورديات', icon: UserCheck },
  { key: 'cash-expenses', label: 'الخزينة والمصروفات', icon: Wallet },
  { key: 'customers', label: 'العملاء والمديونيات', icon: Users },
  { key: 'employees', label: 'الموظفون والرواتب', icon: Briefcase },
  { key: 'reports', label: 'التقارير المالية', icon: FileBarChart2 },
  { key: 'audit-notifications', label: 'التنبيهات وسجل التدقيق', icon: ShieldAlert },
  { key: 'settings', label: 'إعدادات المخبز', icon: Settings },
];

const AGENT_MENU: {
  key: AgentNavKey;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  requiredPermission?: string;
}[] = [
  { key: 'agent-dashboard', label: 'لوحة الوكيل اليومية', icon: LayoutDashboard },
  { key: 'agent-production', label: 'تسجيل الإنتاج والمواد', icon: Flame, requiredPermission: 'PRODUCTION_LOG' },
  { key: 'agent-sales', label: 'مبيعات الخبز والمرتجعات', icon: ShoppingBag, requiredPermission: 'SALES_LOG' },
  { key: 'agent-expenses', label: 'المصروفات اليومية', icon: Receipt, requiredPermission: 'EXPENSES_LOG' },
  { key: 'agent-shift', label: 'إدارة الوردية والتسليم', icon: Clock, requiredPermission: 'SHIFT_MANAGE' },
  { key: 'agent-history', label: 'سجل النشاط الشخصي', icon: History },
];

export const Sidebar: React.FC<SidebarProps> = ({
  activeOwnerNav,
  onSelectOwnerNav,
  activeAgentNav,
  onSelectAgentNav,
  mobileOpen,
  onCloseMobile,
}) => {
  const { user, settings, logout } = useSbms();
  if (!user) return null;

  const isOwner = user.role === 'OWNER';
  const agentPerms = Array.isArray(user.permissions)
    ? user.permissions
    : ['PRODUCTION_LOG', 'SALES_LOG', 'EXPENSES_LOG', 'SHIFT_MANAGE'];

  const visibleAgentMenu = AGENT_MENU.filter(
    (item) => !item.requiredPermission || agentPerms.includes(item.requiredPermission)
  );

  const navContent = (
    <div className="flex flex-col h-full bg-[#142D35] text-white w-[264px] shrink-0 select-none">
      {/* Brand Header */}
      <div className="flex items-center justify-between px-5 py-5 border-b border-white/10">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 rounded-lg overflow-hidden border border-[#D8AD65]/40 shrink-0 bg-[#142D35] flex items-center justify-center">
            <img
              src={BRAND_EMBLEM}
              alt="SBMS"
              referrerPolicy="no-referrer"
              className="w-full h-full object-cover"
            />
          </div>
          <div className="min-w-0">
            <div className="text-sm font-bold tracking-wide text-white truncate">SBMS</div>
            <div className="text-[11px] text-[#D8AD65] truncate">{settings.bakeryName}</div>
          </div>
        </div>
        <button
          type="button"
          onClick={onCloseMobile}
          className="lg:hidden p-1.5 rounded-lg text-white/70 hover:text-white hover:bg-white/10 cursor-pointer"
          aria-label="إغلاق القائمة"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Navigation Links */}
      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-1" aria-label="القائمة الرئيسية">
        {isOwner
          ? OWNER_MENU.map((item) => {
              const Icon = item.icon;
              const isActive =
                activeOwnerNav === item.key ||
                (item.key === 'suppliers' && activeOwnerNav === 'supplier-profile');
              return (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => {
                    onSelectOwnerNav(item.key);
                    onCloseMobile();
                  }}
                  className={cn(
                    'w-full flex items-center gap-3 px-3.5 py-2.5 rounded-lg text-sm font-medium transition-colors cursor-pointer text-right',
                    isActive
                      ? 'bg-[#176B55] text-white'
                      : 'text-white/75 hover:bg-white/8 hover:text-white'
                  )}
                >
                  <Icon className={cn('w-4 h-4 shrink-0', isActive ? 'text-[#D8AD65]' : 'text-white/60')} />
                  <span className="truncate">{item.label}</span>
                </button>
              );
            })
          : visibleAgentMenu.map((item) => {
              const Icon = item.icon;
              const isActive = activeAgentNav === item.key;
              return (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => {
                    onSelectAgentNav(item.key);
                    onCloseMobile();
                  }}
                  className={cn(
                    'w-full flex items-center gap-3 px-3.5 py-2.5 rounded-lg text-sm font-medium transition-colors cursor-pointer text-right',
                    isActive
                      ? 'bg-[#176B55] text-white'
                      : 'text-white/75 hover:bg-white/8 hover:text-white'
                  )}
                >
                  <Icon className={cn('w-4 h-4 shrink-0', isActive ? 'text-[#D8AD65]' : 'text-white/60')} />
                  <span className="truncate">{item.label}</span>
                </button>
              );
            })}
      </nav>

      {/* Account Footer */}
      <div className="p-4 border-t border-white/10 space-y-3">
        <div className="px-2 flex items-center gap-2.5">
          {user.avatarUrl ? (
            <img
              src={user.avatarUrl}
              alt={user.fullName}
              className="w-9 h-9 rounded-full object-cover border border-[#D8AD65]/50 shrink-0"
            />
          ) : (
            <div className="w-9 h-9 rounded-full bg-white/10 border border-white/15 flex items-center justify-center text-xs font-bold text-[#D8AD65] shrink-0">
              {user.fullName.slice(0, 2)}
            </div>
          )}
          <div className="min-w-0">
            <div className="text-xs font-semibold text-white truncate">{user.fullName}</div>
            <div className="text-[11px] text-white/65 mt-0.5 flex items-center gap-1.5">
              <span>{isOwner ? 'مالك المخبز (صلاحية كاملة)' : 'وكيل وردية'}</span>
              {!isOwner && user.assignedShift && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="truncate">{user.assignedShift}</span>
                </>
              )}
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={logout}
          className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-xs font-medium bg-white/8 text-white/85 hover:bg-white/15 hover:text-white transition-colors cursor-pointer"
        >
          <LogOut className="w-3.5 h-3.5" />
          <span>تسجيل الخروج</span>
        </button>
      </div>
    </div>
  );

  return (
    <>
      {/* Desktop Static Sidebar */}
      <aside className="hidden lg:block h-screen sticky top-0 shrink-0">{navContent}</aside>

      {/* Mobile Drawer Sidebar */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div
            className="fixed inset-0 bg-[#142D35]/50"
            onClick={onCloseMobile}
            aria-hidden="true"
          />
          <div className="relative z-10 h-full">{navContent}</div>
        </div>
      )}
    </>
  );
};
