import React, { useState } from 'react';
import { useAuth, DEV_USERS } from '../context/AuthContext.js';
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
  Utensils
} from 'lucide-react';
import { DormexLogo } from './DormexLogo.js';
import { NotificationCenter } from './NotificationCenter.js';
import { MobileBottomNav } from './MobileBottomNav.js';
import { getNavigationForRole } from '../config/navigation.js';

interface LayoutProps {
  currentTab: string;
  setCurrentTab: (tab: string) => void;
  children: React.ReactNode;
}

export const AppLayout: React.FC<LayoutProps> = ({ currentTab, setCurrentTab, children }) => {
  const { session, logout, isDevMode, switchUser } = useAuth();
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);

  if (!session) return null;

  const { primaryTabs, moreTabs } = getNavigationForRole(session.role);
  const allTabs = [...primaryTabs, ...moreTabs];

  // Derive current screen title for compact mobile header
  const activeTabMeta = allTabs.find((t) => t.id === currentTab);
  const currentTitle = activeTabMeta ? activeTabMeta.label : 'Allocation Platform';

  return (
    <div className="min-h-screen flex flex-col md:flex-row bg-[#F7F6F1] font-sans antialiased text-[#263345]">
      {/* 
        COMPACT MOBILE HEADER (Sticky, 56px, Safe-Area Padded)
        Visible only on < md (768px). Eliminates clutter, provides institution branding + quick notifications.
      */}
      <header className="md:hidden sticky top-0 z-30 bg-[#07203C] text-white border-b border-[#203653] px-3.5 py-2.5 flex items-center justify-between gap-2 shadow-xs pt-[calc(0.625rem+env(safe-area-inset-top,0px))]">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <DormexLogo theme="white" size="custom" className="h-6 w-auto shrink-0" />
          <div className="flex flex-col min-w-0">
            <span className="text-[10px] text-[#84D5CA] font-bold uppercase tracking-wider truncate leading-tight">
              SIT Tumakuru · {session.role.replace('_', ' ')}
            </span>
            <span className="text-xs font-bold text-white truncate leading-tight">
              {currentTitle}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <NotificationCenter onNavigateTab={setCurrentTab} />

          {/* Quick Drawer trigger for Persona switch / Logout on mobile */}
          <button
            type="button"
            onClick={() => setMobileDrawerOpen(!mobileDrawerOpen)}
            className="min-h-[44px] min-w-[44px] p-2 rounded-lg text-slate-300 hover:text-white hover:bg-[#203653] flex items-center justify-center transition-colors"
            aria-label="Toggle user menu and switcher"
          >
            {mobileDrawerOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>
      </header>

      {/* 
        DESKTOP SIDEBAR NAVIGATION (250px, dark navy with strong readable contrast)
        On Mobile (< md), this becomes an accessible sliding slide-over drawer toggled from top-right.
      */}
      {mobileDrawerOpen && (
        <div 
          className="md:hidden fixed inset-0 z-40 bg-black/60 backdrop-blur-xs animate-fadeIn"
          onClick={() => setMobileDrawerOpen(false)}
        />
      )}

      <aside className={`
        fixed inset-y-0 left-0 z-50 w-72 bg-[#07203C] text-white flex flex-col justify-between shrink-0 border-r border-[#17283B] transition-transform duration-200 ease-in-out
        md:translate-x-0 md:static md:w-[250px]
        ${mobileDrawerOpen ? 'translate-x-0' : '-translate-x-full'}
      `}>
        <div className="flex flex-col">
          {/* Logo & Platform Context */}
          <div className="px-5 py-4 border-b border-[#203653]/60 bg-[#07203C] flex items-center justify-between">
            <div>
              <DormexLogo theme="white" size="md" className="h-8 w-auto" />
              <div className="mt-2.5 flex items-center gap-2 text-[11px] text-slate-300">
                <span className="font-medium text-slate-200 tracking-tight">SIT Tumakuru · ResAdmin</span>
                <span className="font-semibold bg-[#2C8279]/30 text-[#84d5ca] px-1.5 py-0.5 rounded text-[9px] uppercase tracking-wider">
                  BVB Pilot
                </span>
              </div>
            </div>

            {/* Mobile close button */}
            <button
              type="button"
              onClick={() => setMobileDrawerOpen(false)}
              className="md:hidden min-h-[44px] min-w-[44px] p-2 rounded-lg text-slate-300 hover:text-white hover:bg-[#203653] flex items-center justify-center"
              aria-label="Close sidebar"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Dev Role Switcher Bar (Isolated to dev mode only) */}
          {isDevMode && (
            <div className="p-3 bg-[#112947] border-b border-[#203653]">
              <label className="text-[10px] font-bold text-[#D4B779] uppercase tracking-wider block mb-1">
                Active Persona (Dev Test)
              </label>
              <select
                value={
                  Object.keys(DEV_USERS).find((k) => DEV_USERS[k].userId === session.userId) || 'demo1'
                }
                onChange={(e) => {
                  switchUser(e.target.value);
                  setMobileDrawerOpen(false);
                }}
                className="w-full min-h-[44px] text-xs bg-[#07203C] border border-[#203653] rounded-lg px-2.5 py-1.5 text-white focus:outline-none focus:ring-1 focus:ring-[#2C8279]"
              >
                <optgroup label="BVB Pilot Demo Students (30 Seeded)">
                  <option value="demo1">Aarav Sharma (DEMO-001, Rank #1)</option>
                  <option value="demo2">Diya Patel (DEMO-002, Rank #2)</option>
                  <option value="demo3">Rohan Verma (DEMO-003, Rank #3)</option>
                  <option value="demo10">Arjun Menon (DEMO-010, Rank #10)</option>
                  <option value="demo29">Prisha Pandey (DEMO-029, Fee Pending)</option>
                  <option value="demo30">Nikhil Saxena (DEMO-030, Unpaid)</option>
                </optgroup>
                <optgroup label="Staff Administration">
                  <option value="hostelOffice">Hostel Office Staff</option>
                  <option value="superAdmin">System Administrator (Super Admin)</option>
                  <option value="chiefWarden">Dr. Sharma (Chief Warden)</option>
                  <option value="wardenBvb">Prof. Rao (Warden - BVB Block)</option>
                </optgroup>
              </select>
            </div>
          )}

          {/* Nav Item Links */}
          <nav className="p-3 space-y-1">
            {allTabs.map((tab) => {
              const Icon = tab.icon;
              const isSelected = currentTab === tab.id;

              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => {
                    setCurrentTab(tab.id);
                    setMobileDrawerOpen(false);
                  }}
                  className={`w-full min-h-[44px] flex items-center justify-between px-3.5 py-2.5 rounded-lg text-xs font-semibold transition-all ${
                    isSelected
                      ? 'bg-[#2C8279] text-white shadow-sm'
                      : 'text-slate-200 hover:bg-[#112947] hover:text-white'
                  }`}
                >
                  <div className="flex items-center space-x-3">
                    <Icon className={`w-4 h-4 ${isSelected ? 'text-white' : 'text-[#84d5ca]'}`} />
                    <span className="tracking-normal">{tab.label}</span>
                  </div>
                  <ChevronRight className="w-3.5 h-3.5 opacity-50" />
                </button>
              );
            })}
          </nav>
        </div>

        {/* User Card & Sign Out at Bottom of Sidebar */}
        <div className="p-4 border-t border-[#203653]/60 bg-[#07203C] flex items-center justify-between">
          <div className="flex items-center space-x-3 min-w-0">
            <div className="w-8 h-8 rounded-full bg-[#112947] border border-[#203653] flex items-center justify-center font-bold text-xs text-white shrink-0">
              {session.fullName.substring(0, 2).toUpperCase()}
            </div>
            <div className="min-w-0">
              <div className="text-xs font-semibold text-white truncate">{session.fullName}</div>
              <div className="text-[10px] text-[#84d5ca] font-medium uppercase tracking-wider truncate">{session.role}</div>
            </div>
          </div>

          <button
            type="button"
            onClick={logout}
            title="Sign Out"
            className="min-h-[44px] min-w-[44px] p-2 text-slate-300 hover:text-white hover:bg-[#203653] rounded-lg transition-colors ml-2 shrink-0 flex items-center justify-center"
            aria-label="Sign out"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </aside>

      {/* Main View Area with Clean Header */}
      <div className="flex-1 flex flex-col min-w-0 min-h-screen">
        {/* Spacious Desktop Navigation Header (64px) - hidden on mobile in favor of compact mobile header */}
        <header className="hidden md:flex h-16 bg-white border-b border-[#E2E6E8] px-6 items-center justify-between gap-4 sticky top-0 z-30 shadow-xs">
          {/* Breadcrumb Path */}
          <div className="flex items-center gap-2 text-xs min-w-0">
            <span className="text-[#627084] font-medium">Campus Hostels</span>
            <ChevronRight className="w-3.5 h-3.5 text-[#627084] opacity-60" />
            <span className="text-[#627084] font-medium">BVB Block</span>
            <ChevronRight className="w-3.5 h-3.5 text-[#627084] opacity-60" />
            <span className="text-[#203653] font-bold truncate">{currentTitle}</span>
            <span className="hidden lg:inline-flex items-center ml-2 px-2 py-0.5 rounded-full bg-[#F7F6F1] border border-[#E2E6E8] text-[10px] text-[#627084] font-semibold">
              AY 2024–25
            </span>
          </div>

          {/* Right Area: Status & Compact User Pill */}
          <div className="flex items-center gap-3 shrink-0">
            <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#E7F2ED] text-[#1E7B54] border border-[#A8D5C2] text-xs font-semibold">
              <span className="w-2 h-2 rounded-full bg-[#1E7B54] animate-pulse" />
              <span>Pilot Cycle: Floor 2</span>
            </div>

            <NotificationCenter onNavigateTab={setCurrentTab} />

            <div className="h-6 w-px bg-[#E2E6E8]" />

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

        {/* Content Body: safe-area padding at bottom on mobile so bottom bar does not clip content */}
        <main className="flex-1 p-3 sm:p-5 md:p-8 max-w-7xl w-full mx-auto pb-32 md:pb-8">
          {children}
        </main>
      </div>

      {/* Role-Aware Mobile Bottom Navigation Bar (Screens < md / 768px) */}
      <MobileBottomNav
        role={session.role}
        currentTab={currentTab}
        onSelectTab={setCurrentTab}
      />
    </div>
  );
};
