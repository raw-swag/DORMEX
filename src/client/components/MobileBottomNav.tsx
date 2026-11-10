import React, { useState } from 'react';
import { MoreHorizontal, X, ChevronRight } from 'lucide-react';
import { Role } from '../context/AuthContext.js';
import { getNavigationForRole, NavItemConfig } from '../config/navigation.js';

interface MobileBottomNavProps {
  role: Role;
  currentTab: string;
  onSelectTab: (tabId: string) => void;
}

export const MobileBottomNav: React.FC<MobileBottomNavProps> = ({
  role,
  currentTab,
  onSelectTab,
}) => {
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const { primaryTabs, moreTabs } = getNavigationForRole(role);

  const hasMore = moreTabs.length > 0;
  const isMoreActive = moreTabs.some((t) => t.id === currentTab);

  return (
    <>
      {/* "More" Drawer Modal for Mobile */}
      {showMoreMenu && hasMore && (
        <div
          className="md:hidden fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex flex-col justify-end animate-fadeIn"
          onClick={() => setShowMoreMenu(false)}
        >
          <div
            className="bg-white dark:bg-[#111F32] rounded-t-3xl border-t border-[#DFE3E5] dark:border-[#293B52] p-4 sm:p-5 shadow-2xl max-h-[80vh] overflow-y-auto space-y-3 pb-[calc(1.5rem+env(safe-area-inset-bottom,0px))]"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Sheet Handle */}
            <div className="w-10 h-1 bg-[#D5DCDF] dark:bg-[#293B52] rounded-full mx-auto -mt-1 mb-2 shrink-0" />
            <div className="flex items-center justify-between pb-2 border-b border-[#DFE3E5] dark:border-[#293B52]">
              <div className="flex flex-col">
                <span className="text-xs font-bold uppercase tracking-wider text-[#07203C] dark:text-[#F1F5F9]">
                  Additional Workspaces
                </span>
                <span className="text-[11px] text-[#627084] dark:text-[#91A4BA]">Institutional Tools &amp; Registry</span>
              </div>
              <button
                type="button"
                onClick={() => setShowMoreMenu(false)}
                className="p-2 min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg text-[#627084] dark:text-[#91A4BA] hover:text-[#07203C] dark:hover:text-[#F1F5F9] hover:bg-[#F0F4F6] dark:hover:bg-[#17283D]"
                aria-label="Close menu"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="grid grid-cols-1 gap-2 pt-1">
              {moreTabs.map((tab) => {
                const Icon = tab.icon;
                const isSelected = currentTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => {
                      onSelectTab(tab.id);
                      setShowMoreMenu(false);
                    }}
                    className={`w-full min-h-[48px] px-4 py-3 rounded-xl text-left flex items-center justify-between transition-colors ${
                      isSelected
                        ? 'bg-[#2C8279] dark:bg-[#016A62] text-white font-bold shadow-xs'
                        : 'bg-[#F7F6F1] dark:bg-[#0A1626] text-[#203653] dark:text-[#F1F5F9] hover:bg-[#EAEEF0] dark:hover:bg-[#17283D] font-medium'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <Icon className={`w-5 h-5 ${isSelected ? 'text-white' : 'text-[#2C8279] dark:text-[#63D6C6]'}`} />
                      <span className="text-xs">{tab.label}</span>
                    </div>
                    <ChevronRight className={`w-4 h-4 ${isSelected ? 'text-white' : 'text-[#627084] dark:text-[#91A4BA]'}`} />
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Floating Bottom Nav Container */}
      <nav
        aria-label="Mobile Bottom Navigation"
        className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-[#07203C] dark:bg-[#0D1929] border-t border-[#17283B] dark:border-[#293B52] px-2 pt-1 pb-[calc(0.35rem+env(safe-area-inset-bottom,0px))] shadow-2xl"
      >
        <div className="flex items-center justify-around gap-1 max-w-lg mx-auto">
          {primaryTabs.map((tab) => {
            const Icon = tab.icon;
            const isSelected = currentTab === tab.id;

            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => {
                  onSelectTab(tab.id);
                  setShowMoreMenu(false);
                }}
                className={`flex-1 min-h-[48px] py-1.5 px-1 rounded-xl flex flex-col items-center justify-center transition-all relative ${
                  isSelected
                    ? 'text-white'
                    : 'text-slate-300 hover:text-white'
                }`}
              >
                <div
                  className={`p-1 rounded-lg transition-colors flex items-center justify-center ${
                    isSelected ? 'bg-[#2C8279] text-white shadow-xs' : 'text-slate-300'
                  }`}
                >
                  <Icon className="w-4 h-4 shrink-0" />
                </div>
                <span
                  className={`text-[10px] mt-0.5 truncate max-w-[70px] ${
                    isSelected ? 'font-bold text-white' : 'font-medium text-slate-300'
                  }`}
                >
                  {tab.shortLabel}
                </span>
                {isSelected && (
                  <span className="absolute bottom-0 w-6 h-0.5 rounded-full bg-[#84D5CA] dark:bg-[#63D6C6]" />
                )}
              </button>
            );
          })}

          {hasMore && (
            <button
              type="button"
              onClick={() => setShowMoreMenu((prev) => !prev)}
              aria-expanded={showMoreMenu}
              className={`flex-1 min-h-[48px] py-1.5 px-1 rounded-xl flex flex-col items-center justify-center transition-all relative ${
                isMoreActive || showMoreMenu
                  ? 'text-white'
                  : 'text-slate-300 hover:text-white'
              }`}
            >
              <div
                className={`p-1 rounded-lg transition-colors flex items-center justify-center ${
                  isMoreActive || showMoreMenu ? 'bg-[#2C8279] text-white shadow-xs' : 'text-slate-300'
                }`}
              >
                <MoreHorizontal className="w-4 h-4 shrink-0" />
              </div>
              <span
                className={`text-[10px] mt-0.5 truncate max-w-[70px] ${
                  isMoreActive || showMoreMenu ? 'font-bold text-white' : 'font-medium text-slate-300'
                }`}
              >
                More
              </span>
              {isMoreActive && (
                <span className="absolute bottom-0 w-6 h-0.5 rounded-full bg-[#84D5CA] dark:bg-[#63D6C6]" />
              )}
            </button>
          )}
        </div>
      </nav>
    </>
  );
};
