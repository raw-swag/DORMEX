import React from 'react';
import { usePWAInstall } from '../context/PWAInstallContext.js';
import { X, Download, Share, PlusSquare, Smartphone, Check } from 'lucide-react';

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
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/40 backdrop-blur-xs transition-opacity animate-in fade-in duration-200"
    >
      <div
        className="w-full sm:max-w-md bg-[#F7F6F1] border-t sm:border border-[#E2E6E8] rounded-t-2xl sm:rounded-2xl shadow-2xl p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom,0px))] flex flex-col gap-4 text-[#263345] transform transition-transform"
      >
        {/* Header with App Brand Icon & Close Button */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img
              src="/icon-192.png"
              alt="DORMEX"
              className="w-12 h-12 rounded-xl shadow-xs border border-[#E2E6E8] object-cover bg-[#07203C]"
            />
            <div>
              <h3 className="font-bold text-base text-[#07203C] tracking-tight">Install DORMEX</h3>
              <p className="text-xs text-[#627084] font-medium">College Hostel Allocation System</p>
            </div>
          </div>
          <button
            onClick={closePrompt}
            aria-label="Close install prompt"
            className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-[#E2E6E8] text-[#627084] hover:text-[#263345] transition-colors focus:outline-hidden focus:ring-2 focus:ring-[#2C8279]"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        {isIOS ? (
          <div className="bg-[#FAF4E6] border border-[#D4B779]/40 rounded-xl p-3.5 flex flex-col gap-2.5 text-xs text-[#263345]">
            <p className="font-semibold text-sm text-[#07203C]">Install DORMEX on your iPhone / iPad:</p>
            <ol className="flex flex-col gap-2 pl-1 font-medium text-[#263345]">
              <li className="flex items-center gap-2">
                <span className="w-5 h-5 rounded-full bg-[#203653] text-white flex items-center justify-center text-[10px] shrink-0 font-bold">1</span>
                <span>Open this website in <strong>Safari</strong>.</span>
              </li>
              <li className="flex items-center gap-2">
                <span className="w-5 h-5 rounded-full bg-[#203653] text-white flex items-center justify-center text-[10px] shrink-0 font-bold">2</span>
                <span className="flex items-center gap-1">Tap the <strong>Share</strong> button <Share className="w-3.5 h-3.5 inline text-[#2C8279]" /> in the browser bar.</span>
              </li>
              <li className="flex items-center gap-2">
                <span className="w-5 h-5 rounded-full bg-[#203653] text-white flex items-center justify-center text-[10px] shrink-0 font-bold">3</span>
                <span className="flex items-center gap-1">Scroll down and select <strong>Add to Home Screen</strong> <PlusSquare className="w-3.5 h-3.5 inline text-[#2C8279]" />.</span>
              </li>
              <li className="flex items-center gap-2">
                <span className="w-5 h-5 rounded-full bg-[#203653] text-white flex items-center justify-center text-[10px] shrink-0 font-bold">4</span>
                <span>Tap <strong>Add</strong> in the top-right corner.</span>
              </li>
            </ol>
          </div>
        ) : (
          <div className="text-sm text-[#263345]/90 leading-relaxed">
            <p>
              Add DORMEX to your home screen for faster, reliable access to your live allocation queue, room maps, and status notifications.
            </p>
          </div>
        )}

        {/* Action Controls */}
        <div className="flex flex-col sm:flex-row gap-2 pt-1">
          {isInstallable && (
            <button
              onClick={() => triggerNativeInstall()}
              className="w-full min-h-[44px] flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-[#2C8279] hover:bg-[#236B63] text-white font-semibold text-sm shadow-xs transition-colors focus:outline-hidden focus:ring-2 focus:ring-[#2C8279] focus:ring-offset-2"
            >
              <Download className="w-4 h-4" />
              <span>Install DORMEX</span>
            </button>
          )}

          {isIOS && (
            <button
              onClick={closePrompt}
              className="w-full min-h-[44px] flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-[#2C8279] hover:bg-[#236B63] text-white font-semibold text-sm shadow-xs transition-colors focus:outline-hidden focus:ring-2 focus:ring-[#2C8279] focus:ring-offset-2"
            >
              <Check className="w-4 h-4" />
              <span>Got it</span>
            </button>
          )}

          <button
            onClick={dismissPrompt}
            className="w-full min-h-[44px] flex items-center justify-center px-4 py-2.5 rounded-xl bg-[#E2E6E8]/70 hover:bg-[#E2E6E8] text-[#627084] hover:text-[#263345] font-medium text-sm transition-colors focus:outline-hidden"
          >
            Not now
          </button>
        </div>
      </div>
    </div>
  );
};
