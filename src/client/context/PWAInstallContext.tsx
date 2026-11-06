import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';

export interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{
    outcome: 'accepted' | 'dismissed';
    platform: string;
  }>;
  prompt(): Promise<void>;
}

interface PWAInstallContextType {
  canInstall: boolean;
  isInstallable: boolean;
  isInstalled: boolean;
  isIOS: boolean;
  isMobile: boolean;
  showPrompt: boolean;
  openInstallPrompt: () => void;
  closePrompt: () => void;
  dismissPrompt: () => void;
  triggerNativeInstall: () => Promise<boolean>;
}

const PWAInstallContext = createContext<PWAInstallContextType | undefined>(undefined);

const DISMISSAL_STORAGE_KEY = 'dormex_pwa_dismissed_until';
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

export const PWAInstallProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState(false);
  const [showPrompt, setShowPrompt] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [isIOS, setIsIOS] = useState(false);

  useEffect(() => {
    // 1. Device and browser capability detection
    const userAgent = window.navigator.userAgent || '';
    const isIOSDevice = /iPad|iPhone|iPod/.test(userAgent) && !(window as any).MSStream;
    const isMobileDevice = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(userAgent) ||
      (window.innerWidth <= 844 && 'ontouchstart' in window);

    setIsIOS(isIOSDevice);
    setIsMobile(isMobileDevice);

    // 2. Check if already running in standalone mode (installed)
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as any).standalone === true ||
      document.referrer.includes('android-app://');

    if (isStandalone) {
      setIsInstalled(true);
      return;
    }

    // 3. Listen for native beforeinstallprompt (Chromium / Android)
    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      const promptEvent = e as BeforeInstallPromptEvent;
      setDeferredPrompt(promptEvent);

      // Check user dismissal cooldown
      const dismissedUntil = localStorage.getItem(DISMISSAL_STORAGE_KEY);
      const isDismissed = dismissedUntil && Date.now() < parseInt(dismissedUntil, 10);

      // Only present mobile prompt if on mobile device, not standalone, and not dismissed
      if (isMobileDevice && !isDismissed) {
        // Wait 3 seconds so user can see interface before prompting
        const timer = setTimeout(() => {
          setShowPrompt(true);
        }, 3000);
        return () => clearTimeout(timer);
      }
    };

    // 4. Listen for appinstalled
    const handleAppInstalled = () => {
      setIsInstalled(true);
      setDeferredPrompt(null);
      setShowPrompt(false);
      localStorage.removeItem(DISMISSAL_STORAGE_KEY);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleAppInstalled);

    // 5. iOS Safari auto-guide if mobile, not standalone, not dismissed
    if (isIOSDevice && !isStandalone) {
      const dismissedUntil = localStorage.getItem(DISMISSAL_STORAGE_KEY);
      const isDismissed = dismissedUntil && Date.now() < parseInt(dismissedUntil, 10);
      if (!isDismissed) {
        const timer = setTimeout(() => {
          setShowPrompt(true);
        }, 3500);
        return () => clearTimeout(timer);
      }
    }

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  const openInstallPrompt = useCallback(() => {
    setShowPrompt(true);
  }, []);

  const closePrompt = useCallback(() => {
    setShowPrompt(false);
  }, []);

  const dismissPrompt = useCallback(() => {
    setShowPrompt(false);
    // Configurable 7-day cooldown persisted cleanly without any sensitive data
    localStorage.setItem(DISMISSAL_STORAGE_KEY, (Date.now() + SEVEN_DAYS_MS).toString());
  }, []);

  const triggerNativeInstall = useCallback(async (): Promise<boolean> => {
    if (!deferredPrompt) {
      return false;
    }

    try {
      await deferredPrompt.prompt();
      const choiceResult = await deferredPrompt.userChoice;
      if (choiceResult.outcome === 'accepted') {
        setIsInstalled(true);
        setShowPrompt(false);
        setDeferredPrompt(null);
        return true;
      } else {
        dismissPrompt();
        return false;
      }
    } catch {
      setShowPrompt(false);
      return false;
    }
  }, [deferredPrompt, dismissPrompt]);

  const value = {
    canInstall: Boolean(deferredPrompt) || isIOS,
    isInstallable: Boolean(deferredPrompt),
    isInstalled,
    isIOS,
    isMobile,
    showPrompt,
    openInstallPrompt,
    closePrompt,
    dismissPrompt,
    triggerNativeInstall,
  };

  return (
    <PWAInstallContext.Provider value={value}>
      {children}
    </PWAInstallContext.Provider>
  );
};

export const usePWAInstall = () => {
  const context = useContext(PWAInstallContext);
  if (!context) {
    throw new Error('usePWAInstall must be used within a PWAInstallProvider');
  }
  return context;
};
