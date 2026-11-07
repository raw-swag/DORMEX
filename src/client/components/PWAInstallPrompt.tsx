import React from 'react';
import { usePWAInstall } from '../context/PWAInstallContext.js';
import { X, Download, Share, PlusSquare, Smartphone, Check, Zap, ShieldCheck } from 'lucide-react';
import { DormexLogo } from './DormexLogo.js';

interface PWAInstallPromptProps {
  // Pass true if active critical workflow (e.g. agreement modal, confirmation modal) is visible
  isWorkflowActive?: boolean;
}

export const PWAInstallPrompt: React.FC<PWAInstallPromptProps> = ({ isWorkflowActive = false }) => {
  const {
    showPrompt,
    isInstalled,
    isIOS,
    isInstallable,
    closePrompt,
    dismissPrompt,
    acknowledgeIOSInstall,
    triggerNativeInstall,
  } = usePWAInstall();

  // Requirements:
  // 1. Do not show if already installed
  // 2. Do not show if prompt is not triggered
  // 3. Do not interrupt login submission, agreement acceptance, or active seat confirmation
  if (isInstalled || !showPrompt || isWorkflowActive) {
    return null;
  }

  return (
    <div
      role="dialog"
      aria-label="Install DORMEX Application"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-[#07203C]/60 backdrop-blur-xs transition-opacity animate-in fade-in duration-200"
    >
      <div
        className="w-full sm:max-w-md bg-white border-t sm:border border-[#E2E6E8] rounded-t-3xl sm:rounded-2xl shadow-2xl p-5 sm:p-6 pb-[calc(1.25rem+env(safe-area-inset-bottom,0px))] flex flex-col gap-4 text-[#203653] transform transition-transform"
      >
        {/* Drag handle pill for mobile sheet look */}
        <div className="w-10 h-1 bg-[#D5DCDF] rounded-full mx-auto sm:hidden -mt-1 mb-1" />

        {/* Header with App Brand Icon & Close Button */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-[#07203C] p-2 flex items-center justify-center shadow-md border border-[#203653]/40 shrink-0">
              <DormexLogo theme="symbol" size="custom" className="w-8 h-8 object-contain" />
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <h3 className="font-bold text-base text-[#07203C] tracking-tight">Install DORMEX</h3>
                <span className="px-1.5 py-0.5 rounded text-[9px] font-extrabold uppercase bg-[#E7F2ED] text-[#1E7B54] border border-[#A8D5C2]">PWA</span>
              </div>
              <p className="text-xs text-[#627084] font-medium mt-0.5">
                Your hostel, allocation updates and campus services — one tap away.
              </p>
            </div>
          </div>
          <button
            onClick={closePrompt}
            aria-label="Close install prompt"
            className="w-9 h-9 flex items-center justify-center rounded-full hover:bg-[#F0F4F6] text-[#627084] hover:text-[#07203C] transition-colors focus:outline-hidden focus:ring-2 focus:ring-[#2C8279]"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Key Institutional Benefits List */}
        <div className="grid grid-cols-1 gap-2.5 bg-[#F7F6F1] border border-[#E2E6E8] rounded-xl p-3 text-xs text-[#203653]">
          <div className="flex items-center gap-2.5">
            <div className="w-6 h-6 rounded-full bg-[#E7F2ED] text-[#2C8279] flex items-center justify-center shrink-0 shadow-xs">
              <Zap className="w-3.5 h-3.5" />
            </div>
            <span className="font-medium text-[#203653]">Quick access from your home screen.</span>
          </div>
          <div className="flex items-center gap-2.5">
            <div className="w-6 h-6 rounded-full bg-[#EBF3FC] text-[#1D63B8] flex items-center justify-center shrink-0 shadow-xs">
              <Smartphone className="w-3.5 h-3.5" />
            </div>
            <span className="font-medium text-[#203653]">App-like full-screen experience.</span>
          </div>
          <div className="flex items-center gap-2.5">
            <div className="w-6 h-6 rounded-full bg-[#FAF4E6] text-[#9C7A2E] flex items-center justify-center shrink-0 shadow-xs">
              <ShieldCheck className="w-3.5 h-3.5" />
            </div>
            <span className="font-medium text-[#203653]">Easier access to hostel services and updates.</span>
          </div>
        </div>

        {/* Platform-Specific Step Guide */}
        {isIOS ? (
          <div className="bg-[#FAF4E6] border border-[#D4B779]/60 rounded-xl p-3.5 flex flex-col gap-2 text-xs text-[#263345]">
            <p className="font-bold text-xs text-[#07203C]">Add DORMEX to iPhone Home Screen:</p>
            <ol className="flex flex-col gap-2 pl-0.5 font-medium text-[#263345]">
              <li className="flex items-center gap-2">
                <span className="w-5 h-5 rounded-full bg-[#07203C] text-white flex items-center justify-center text-[10px] shrink-0 font-bold">1</span>
                <span className="flex items-center gap-1">Tap the Safari <strong>Share</strong> button <Share className="w-3.5 h-3.5 inline text-[#2C8279]" /> in the browser bar.</span>
              </li>
              <li className="flex items-center gap-2">
                <span className="w-5 h-5 rounded-full bg-[#07203C] text-white flex items-center justify-center text-[10px] shrink-0 font-bold">2</span>
                <span className="flex items-center gap-1">Select <strong>Add to Home Screen</strong> <PlusSquare className="w-3.5 h-3.5 inline text-[#2C8279]" />.</span>
              </li>
              <li className="flex items-center gap-2">
                <span className="w-5 h-5 rounded-full bg-[#07203C] text-white flex items-center justify-center text-[10px] shrink-0 font-bold">3</span>
                <span>Enable <strong>Open as Web App</strong> if shown by Safari.</span>
              </li>
              <li className="flex items-center gap-2">
                <span className="w-5 h-5 rounded-full bg-[#07203C] text-white flex items-center justify-center text-[10px] shrink-0 font-bold">4</span>
                <span>Tap <strong>Add</strong> in the top-right corner to finish.</span>
              </li>
            </ol>
          </div>
        ) : !isInstallable ? (
          <div className="bg-[#F0F4F6] border border-[#D5DCDF] rounded-xl p-3 text-xs text-[#263345]">
            <p className="font-bold text-[#07203C] mb-1">Install from Browser Menu:</p>
            <p className="text-[#627084]">Tap your mobile browser menu (<strong>⋮</strong> or Share icon) and select <strong>Install App</strong> or <strong>Add to Home screen</strong>.</p>
          </div>
        ) : null}

        {/* Action Controls */}
        <div className="flex flex-col gap-2 pt-1">
          {isInstallable ? (
            <button
              onClick={() => triggerNativeInstall()}
              className="w-full min-h-[48px] flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-[#2C8279] hover:bg-[#20635C] active:scale-[0.99] text-white font-bold text-sm shadow-sm transition-all focus:outline-hidden focus:ring-2 focus:ring-[#2C8279]"
            >
              <Download className="w-4 h-4" />
              <span>Install DORMEX</span>
            </button>
          ) : isIOS ? (
            <button
              onClick={acknowledgeIOSInstall}
              className="w-full min-h-[48px] flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-[#2C8279] hover:bg-[#20635C] active:scale-[0.99] text-white font-bold text-sm shadow-sm transition-all focus:outline-hidden focus:ring-2 focus:ring-[#2C8279]"
            >
              <Check className="w-4 h-4" />
              <span>I've added DORMEX</span>
            </button>
          ) : (
            <button
              onClick={closePrompt}
              className="w-full min-h-[48px] flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-[#2C8279] hover:bg-[#20635C] active:scale-[0.99] text-white font-bold text-sm shadow-sm transition-all focus:outline-hidden focus:ring-2 focus:ring-[#2C8279]"
            >
              <Check className="w-4 h-4" />
              <span>Got it</span>
            </button>
          )}

          <button
            onClick={dismissPrompt}
            className="w-full min-h-[48px] flex items-center justify-center px-4 py-3 rounded-xl bg-[#F0F4F6] hover:bg-[#E2E6E8] active:scale-[0.99] text-[#627084] hover:text-[#203653] font-semibold text-sm transition-all focus:outline-hidden"
          >
            Maybe later
          </button>
        </div>
      </div>
    </div>
  );
};
