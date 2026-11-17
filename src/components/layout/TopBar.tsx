import React, { useState } from 'react';
import { Bell, Menu, Wifi, WifiOff } from 'lucide-react';
import { useSbms } from '../../context/SbmsContext';
import { OwnerNavKey } from '../../types/sbms';

interface TopBarProps {
  pageTitle: string;
  breadcrumbParent?: string;
  onOpenMobileMenu: () => void;
  onNavigateOwner?: (nav: OwnerNavKey) => void;
}

export const TopBar: React.FC<TopBarProps> = ({
  pageTitle,
  breadcrumbParent,
  onOpenMobileMenu,
  onNavigateOwner,
}) => {
  const { user, notifications, markAllNotificationsRead, isOfflineMode, setIsOfflineMode, offlineQueue } =
    useSbms();
  const [notifOpen, setNotifOpen] = useState(false);

  const unreadCount = notifications.filter((n) => !n.isRead).length;
  const pendingOffline = offlineQueue.filter((q) => q.syncStatus === 'في الانتظار').length;

  return (
    <header className="sticky top-0 z-30 bg-white border-b border-[#E2E7E5] px-4 lg:px-8 h-16 flex items-center justify-between gap-4 no-print">
      {/* Zone 1: Mobile Menu + Breadcrumb Title */}
      <div className="flex items-center gap-3 min-w-0">
        <button
          type="button"
          onClick={onOpenMobileMenu}
          className="lg:hidden h-10 w-10 rounded-lg border border-[#E2E7E5] flex items-center justify-center text-[#142D35] hover:bg-[#F5F7F6] cursor-pointer shrink-0"
          aria-label="فتح القائمة"
        >
          <Menu className="w-5 h-5" />
        </button>

        <div className="flex items-center gap-2 text-sm min-w-0">
          {breadcrumbParent && (
            <>
              <span className="text-[#5A6B6E] hidden sm:inline whitespace-nowrap">{breadcrumbParent}</span>
              <span className="text-[#5A6B6E] hidden sm:inline" aria-hidden="true">
                /
              </span>
            </>
          )}
          <h1 className="text-base font-semibold text-[#142D35] truncate">{pageTitle}</h1>
        </div>
      </div>

      {/* Zone 2: Operational Context Controls */}
      <div className="flex items-center gap-3 shrink-0">
        {user?.role === 'AGENT' && (
          <button
            type="button"
            onClick={() => setIsOfflineMode(!isOfflineMode)}
            className={`h-9 px-3 rounded-lg border text-xs font-medium flex items-center gap-2 transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
              isOfflineMode
                ? 'bg-[#F7EFE0] border-[#D8AD65] text-[#142D35]'
                : 'bg-white border-[#E2E7E5] text-[#176B55] hover:bg-[#F5F7F6]'
            }`}
            title="تبديل محاكاة العمل دون اتصال لاختبار الطابور المحلي"
          >
            {isOfflineMode ? <WifiOff className="w-3.5 h-3.5" /> : <Wifi className="w-3.5 h-3.5" />}
            <span>
              {isOfflineMode
                ? `وضع عدم الاتصال (${pendingOffline} معلق)`
                : 'متصل بالخادم'}
            </span>
          </button>
        )}

        {user?.role === 'OWNER' && (
          <div className="relative">
            <button
              type="button"
              onClick={() => setNotifOpen((o) => !o)}
              className="h-9 px-3 rounded-lg border border-[#E2E7E5] bg-white hover:bg-[#F5F7F6] text-xs font-medium text-[#142D35] flex items-center gap-2 cursor-pointer whitespace-nowrap shrink-0"
              aria-label="التنبيهات التشغيلية"
            >
              <Bell className="w-4 h-4 text-[#5A6B6E]" />
              <span>التنبيهات</span>
              {unreadCount > 0 && (
                <span className="font-mono tabular-nums text-[#B91C1C] font-semibold">
                  ({unreadCount})
                </span>
              )}
            </button>

            {notifOpen && (
              <div className="absolute left-0 mt-2 w-[calc(100vw-2rem)] max-w-80 sm:w-96 sm:max-w-none bg-white border border-[#E2E7E5] rounded-xl z-40 overflow-hidden shadow-lg">
                <div className="flex items-center justify-between px-4 py-3 border-b border-[#E2E7E5]">
                  <span className="text-xs font-semibold text-[#142D35]">
                    تنبيهات القواعد التشغيلية ({unreadCount} غير مقروء)
                  </span>
                  <button
                    type="button"
                    onClick={markAllNotificationsRead}
                    className="text-xs text-[#176B55] hover:underline cursor-pointer"
                  >
                    تحديد الكل كمقروء
                  </button>
                </div>
                <div className="max-h-80 overflow-y-auto divide-y divide-[#E2E7E5]">
                  {notifications.map((n) => (
                    <button
                      key={n.id}
                      type="button"
                      onClick={() => {
                        setNotifOpen(false);
                        if (n.targetNav && onNavigateOwner) {
                          onNavigateOwner(n.targetNav);
                        }
                      }}
                      className="w-full text-right px-4 py-3 hover:bg-[#F5F7F6] transition-colors block cursor-pointer"
                    >
                      <div className="flex items-center justify-between gap-2 text-[11px] text-[#5A6B6E]">
                        <span
                          className={
                            n.severity === 'تنبيه حرج'
                              ? 'text-[#B91C1C] font-semibold'
                              : n.severity === 'تحذير'
                              ? 'text-[#9A6714] font-semibold'
                              : 'text-[#176B55] font-semibold'
                          }
                        >
                          {n.severity}
                        </span>
                        <span className="font-mono tabular-nums">{n.timestamp}</span>
                      </div>
                      <div className="text-xs font-semibold text-[#142D35] mt-1">{n.title}</div>
                      <p className="text-xs text-[#5A6B6E] mt-0.5 line-clamp-2">{n.message}</p>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </header>
  );
};
