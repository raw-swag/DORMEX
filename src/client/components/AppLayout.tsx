import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext.js';
import { 
  Building2, 
  Map, 
  Users, 
  Clock, 
  AlertCircle, 
  LogOut,
  ChevronRight,
  Menu,
  X,
  UserCheck,
  UserPlus,
  Utensils,
  Download
} from 'lucide-react';
import { DormexLogo } from './DormexLogo.js';
import { NotificationCenter } from './NotificationCenter.js';
import { MobileBottomNav } from './MobileBottomNav.js';
import { ThemeToggle } from './ThemeToggle.js';
import { getNavigationForRole } from '../config/navigation.js';
import { usePWAInstall } from '../context/PWAInstallContext.js';

interface LayoutProps {
  currentTab: string;
  setCurrentTab: (tab: string) => void;
  children: React.ReactNode;
}

export const AppLayout: React.FC<LayoutProps> = ({ currentTab, setCurrentTab, children }) => {
  const { session, logout } = useAuth();
  const { isInstalled, openInstallPrompt } = usePWAInstall();
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);

  if (!session) return null;

  const { primaryTabs, moreTabs } = getNavigationForRole(session.role);
  const allTabs = [...primaryTabs, ...moreTabs];

  // Derive current screen title for compact mobile header
  const activeTabMeta = allTabs.find((t) => t.id === currentTab);
  const currentTitle = activeTabMeta ? activeTabMeta.label : 'Allocation Platform';

  return (
    <div className="min-h-screen flex flex-col md:flex-row bg-[#F7F6F1] dark:bg-[#080F1C] font-sans antialiased text-[#263345] dark:text-[#F1F5F9] transition-colors duration-150">
      {/* 
        COMPACT MOBILE HEADER (Sticky, 56px, Safe-Area Padded)
        Visible only on < md (768px). Eliminates clutter, provides institution branding + quick notifications.
      */}
      <header className="md:hidden sticky top-0 z-30 bg-[#07203C] dark:bg-[#0D1929] text-white border-b border-[#203653] dark:border-[#293B52] px-3 sm:px-4 py-2.5 flex items-center justify-between gap-2 shadow-sm pt-[calc(0.625rem+env(safe-area-inset-top,0px))]">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <DormexLogo theme="white" size="custom" className="h-6 w-auto shrink-0 max-w-[90px] xs:max-w-none" />
          <div className="flex flex-col min-w-0">
            <span className="text-[10px] text-[#84D5CA] dark:text-[#63D6C6] font-bold uppercase tracking-wider truncate leading-tight">
              SIT · {session.role.replace('_', ' ')}
            </span>
            <span className="text-xs font-bold text-white truncate leading-tight">
              {currentTitle}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <ThemeToggle />
          <NotificationCenter onNavigateTab={setCurrentTab} />
          <button
            type="button"
            onClick={() => setMobileDrawerOpen(true)}
            className="min-h-[44px] min-w-[44px] p-2 text-slate-300 hover:text-white rounded-lg flex items-center justify-center"
            aria-label="Open menu drawer"
          >
            <Menu className="w-5 h-5" />
          </button>
        </div>
      </header>

      {/* 
        EXPANDABLE MOBILE SIDE DRAWER (When hamburger is clicked on mobile)
      */}
      {mobileDrawerOpen && (
        <div 
          className="fixed inset-0 z-50 md:hidden bg-black/60 backdrop-blur-xs flex animate-fadeIn"
          role="dialog"
          aria-modal="true"
          aria-label="Mobile Navigation Menu"
        >
          <div 
            className="fixed inset-0 -z-10" 
            onClick={() => setMobileDrawerOpen(false)}
            aria-hidden="true"
          />

          <div className="w-[280px] max-w-[80vw] bg-[#07203C] text-white h-full flex flex-col justify-between shadow-2xl p-4 overflow-y-auto">
            <div className="space-y-4">
              <div className="flex items-center justify-between border-b border-[#203653] pb-3">
                <DormexLogo theme="white" size="sm" />
                <button
                  type="button"
                  onClick={() => setMobileDrawerOpen(false)}
                  className="min-h-[44px] min-w-[44px] p-2 text-slate-400 hover:text-white flex items-center justify-center rounded-lg"
                  aria-label="Close menu drawer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Navigation Items in Drawer */}
              <div className="space-y-1">
                <span className="text-[10px] font-bold uppercase tracking-wider text-[#84D5CA] px-2 block mb-1">
                  Portal Navigation
                </span>
                {allTabs.map((tab) => {
                  const Icon = tab.icon;
                  const isActive = currentTab === tab.id;
                  return (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => {
                        setCurrentTab(tab.id);
                        setMobileDrawerOpen(false);
                      }}
                      className={`w-full min-h-[44px] flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-semibold transition-all ${
                        isActive
                          ? 'bg-[#2C8279] text-white shadow-xs font-bold'
                          : 'text-slate-300 hover:text-white hover:bg-[#112947]'
                      }`}
                    >
                      <Icon className="w-4 h-4 shrink-0" />
                      <span className="truncate">{tab.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="pt-4 border-t border-[#203653] space-y-3">
              <div className="flex items-center gap-2.5 px-2">
                <div className="w-8 h-8 rounded-full bg-[#112947] border border-[#203653] flex items-center justify-center font-bold text-xs text-white shrink-0">
                  {session.fullName.substring(0, 2).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-bold text-white truncate">{session.fullName}</div>
                  <div className="text-[10px] text-[#84D5CA] font-mono truncate">{session.collegeId || session.role}</div>
                </div>
              </div>

              <button
                type="button"
                onClick={() => logout()}
                className="w-full min-h-[44px] flex items-center justify-center gap-2 px-3 py-2 text-xs font-bold text-red-300 hover:text-red-200 bg-red-950/30 hover:bg-red-950/50 rounded-xl transition-colors border border-red-900/40"
              >
                <LogOut className="w-4 h-4" />
                <span>Sign Out</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 
        DESKTOP INSTITUTIONAL SIDEBAR (hidden on mobile, sticky on desktop >= md)
      */}
      <aside className="hidden md:flex flex-col w-64 bg-[#07203C] text-white border-r border-[#203653] shrink-0 sticky top-0 h-screen z-20">
        <div className="p-4 border-b border-[#203653] flex items-center justify-between">
          <DormexLogo theme="white" size="md" />
        </div>

        <div className="flex-1 overflow-y-auto p-3 space-y-1">
          <div className="px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-[#84D5CA]">
            Navigation
          </div>
          {allTabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = currentTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setCurrentTab(tab.id)}
                className={`w-full min-h-[40px] flex items-center gap-3 px-3 py-2 rounded-xl text-xs font-semibold transition-all ${
                  isActive
                    ? 'bg-[#2C8279] text-white shadow-xs font-bold'
                    : 'text-slate-300 hover:text-white hover:bg-[#112947]'
                }`}
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span className="truncate">{tab.label}</span>
              </button>
            );
          })}
        </div>

        {/* PWA Install Button */}
        {!isInstalled && (
          <div className="px-3 pb-2 pt-1 border-t border-[#203653]/40">
            <button
              type="button"
              onClick={() => openInstallPrompt()}
              className="w-full min-h-[40px] flex items-center justify-between px-3 py-2 rounded-lg text-xs font-bold text-[#84D5CA] bg-[#112947] hover:bg-[#1a385f] hover:text-white transition-all border border-[#203653]"
            >
              <div className="flex items-center space-x-2.5">
                <Download className="w-4 h-4 text-[#84D5CA]" />
                <span>Install DORMEX App</span>
              </div>
              <span className="text-[10px] uppercase font-mono px-1.5 py-0.5 rounded bg-[#07203C] text-[#84D5CA] border border-[#203653]">PWA</span>
            </button>
          </div>
        )}

        {/* User Card & Sign Out */}
        <div className="p-4 border-t border-[#203653]/60 bg-[#07203C] flex items-center justify-between">
          <div className="flex items-center space-x-3 min-w-0">
            <div className="w-8 h-8 rounded-full bg-[#112947] border border-[#203653] flex items-center justify-center font-bold text-xs text-white shrink-0">
              {session.fullName.substring(0, 2).toUpperCase()}
            </div>
            <div className="min-w-0 pr-1" title={session.fullName}>
              <div className="text-xs font-semibold text-white truncate max-w-[130px]">{session.fullName}</div>
              <div className="text-[10px] text-[#84d5ca] font-medium uppercase tracking-wider truncate">{session.role}</div>
            </div>
          </div>

          <button
            type="button"
            onClick={() => logout()}
            title="Sign Out"
            className="min-h-[44px] min-w-[44px] p-2 text-slate-300 hover:text-white hover:bg-[#203653] rounded-lg transition-colors ml-2 shrink-0 flex items-center justify-center"
            aria-label="Sign out"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </aside>

      {/* Main View Area */}
      <div className="flex-1 flex flex-col min-w-0 min-h-screen">
        <header className="hidden md:flex h-16 bg-white dark:bg-[#0D1929] border-b border-[#E2E6E8] dark:border-[#293B52] px-6 items-center justify-between gap-4 sticky top-0 z-30 shadow-xs">
          <div className="flex items-center gap-2 text-xs min-w-0">
            <span className="text-[#627084] dark:text-[#91A4BA] font-medium">Campus Hostels</span>
            <ChevronRight className="w-3.5 h-3.5 text-[#627084] dark:text-[#91A4BA] opacity-60" />
            <span className="text-[#627084] dark:text-[#91A4BA] font-medium">BVB Block</span>
            <ChevronRight className="w-3.5 h-3.5 text-[#627084] dark:text-[#91A4BA] opacity-60" />
            <span className="text-[#203653] dark:text-[#F1F5F9] font-bold truncate">{currentTitle}</span>
            <span className="hidden lg:inline-flex items-center ml-2 px-2 py-0.5 rounded-full bg-[#F7F6F1] dark:bg-[#111F32] border border-[#E2E6E8] dark:border-[#293B52] text-[10px] text-[#627084] dark:text-[#91A4BA] font-semibold">
              AY 2024–25
            </span>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#E7F2ED] dark:bg-[#0E2F2B] text-[#1E7B54] dark:text-[#63D6C6] border border-[#A8D5C2] dark:border-[#1E5C50] text-xs font-semibold">
              <span className="w-2 h-2 rounded-full bg-[#1E7B54] dark:bg-[#63D6C6] animate-pulse" />
              <span>Pilot Cycle: Floor 2</span>
            </div>

            <NotificationCenter onNavigateTab={setCurrentTab} />
            <ThemeToggle />

            <div className="h-6 w-px bg-[#E2E6E8] dark:border-[#293B52]" />

            <div className="flex items-center gap-2 pl-1">
              <div className="text-right">
                <div className="text-xs font-bold text-[#203653] leading-tight truncate max-w-[140px]">{session.fullName}</div>
                <div className="text-[10px] text-[#627084] font-mono leading-tight">{session.collegeId || session.role}</div>
              </div>
              <div className="w-8 h-8 rounded-full bg-[#203653] text-white flex items-center justify-center font-bold text-xs shrink-0 shadow-xs">
                {session.fullName.substring(0, 1)}
              </div>
            </div>
          </div>
        </header>

        <main className="flex-1 p-3 sm:p-5 md:p-8 max-w-7xl w-full mx-auto pb-32 md:pb-8">
          {children}
        </main>
      </div>

      <MobileBottomNav role={session.role} currentTab={currentTab} onSelectTab={setCurrentTab} />
    </div>
  );
};
