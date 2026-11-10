import React, { useState, useEffect } from 'react';
import { WifiOff, Wifi, RefreshCw, AlertTriangle } from 'lucide-react';

export const NetworkStatusBanner: React.FC = () => {
  const [isOnline, setIsOnline] = useState<boolean>(() => {
    return typeof navigator !== 'undefined' ? navigator.onLine : true;
  });
  const [showRestoredNotice, setShowRestoredNotice] = useState<boolean>(false);

  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      setShowRestoredNotice(true);
      const timer = setTimeout(() => {
        setShowRestoredNotice(false);
      }, 4000);
      return () => clearTimeout(timer);
    };

    const handleOffline = () => {
      setIsOnline(false);
      setShowRestoredNotice(false);
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  if (isOnline && !showRestoredNotice) {
    return null;
  }

  if (!isOnline) {
    return (
      <aside
        role="status"
        aria-live="assertive"
        className="w-full bg-[#BA1A1A] text-white px-4 py-2.5 text-xs font-semibold flex items-center justify-between gap-3 shadow-md z-40 sticky top-0"
      >
        <div className="flex items-center gap-2 min-w-0 max-w-5xl mx-auto flex-1">
          <WifiOff className="w-4 h-4 shrink-0 text-white animate-pulse" aria-hidden="true" />
          <span className="truncate">
            <strong>Network Offline:</strong> Your internet connection was interrupted. Room selections and submissions are temporarily paused until connection is restored.
          </span>
        </div>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="shrink-0 px-2.5 py-1 bg-white/20 hover:bg-white/30 text-white rounded text-[11px] font-bold transition-colors flex items-center gap-1 focus:outline-none focus:ring-1 focus:ring-white"
        >
          <RefreshCw className="w-3 h-3" aria-hidden="true" />
          <span>Check Connection</span>
        </button>
      </aside>
    );
  }

  return (
    <aside
      role="status"
      aria-live="polite"
      className="w-full bg-[#1E7B54] text-white px-4 py-2 text-xs font-semibold flex items-center justify-center gap-2 shadow-sm z-40 sticky top-0 animate-in fade-in slide-in-from-top-2 duration-200"
    >
      <Wifi className="w-4 h-4 text-[#84D5CA]" aria-hidden="true" />
      <span>
        <strong>Connection Restored:</strong> Institutional network sync re-established.
      </span>
    </aside>
  );
};
