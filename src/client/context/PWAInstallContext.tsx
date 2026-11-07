import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';

export interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{
    outcome: 'accepted' | 'dismissed';
    platform: string;
  }>;
  prompt(): Promise<void>;
}

export const PWA_STORAGE_KEY = 'dormex_pwa_installed_v1';
export const PWA_DISMISSED_SESSION_KEY = 'dormex_pwa_dismissed_session_v1';

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
  acknowledgeIOSInstall: () => void;
  triggerNativeInstall: () => Promise<boolean>;
}

const PWAInstallContext = createContext<PWAInstallContextType | undefined>(undefined);

export const PWAInstallProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState<boolean>(() => {
    try {
      if (typeof window !== 'undefined') {
        const stored = localStorage.getItem(PWA_STORAGE_KEY);
        if (stored === 'true') return true;
        const isStandalone = window.matchMedia('(display-mode: standalone)').matches ||
          (window.navigator as any).standalone === true ||
          document.referrer.includes('android-app://');
        if (isStandalone) {
          localStorage.setItem(PWA_STORAGE_KEY, 'true');
          return true;
        }
      }
    } catch {
      // Storage unavailable or disabled
    }
    return false;
  });

  const [showPrompt, setShowPrompt] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [isIOS, setIsIOS] = useState(false);
  // Session-scoped dismissal: survives page refreshes and navigation in same tab via sessionStorage,
  // but resets when browser tab/session is closed.
  const [isDismissedForSession, setIsDismissedForSession] = useState<boolean>(() => {
    try {
      if (typeof window !== 'undefined') {
        return sessionStorage.getItem(PWA_DISMISSED_SESSION_KEY) === 'true';
      }
    } catch {
      // Storage unavailable or disabled
    }
    return false;
  });

  useEffect(() => {
    // 1. Device and browser capability detection
    const userAgent = window.navigator.userAgent || '';
    const isIOSDevice = /iPad|iPhone|iPod/.test(userAgent) && !(window as any).MSStream;
    // Check coarse pointer or touch support or narrow width
    const hasTouch = 'ontouchstart' in window || (navigator.maxTouchPoints && navigator.maxTouchPoints > 0);
    const isMobileDevice = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(userAgent) ||
      (window.innerWidth <= 844 && Boolean(hasTouch)) ||
      (window.innerWidth <= 640); // Also treat narrow viewport emulation (e.g. Chrome DevTools responsive mode) as mobile

    setIsIOS(isIOSDevice);
    setIsMobile(isMobileDevice);

    // 2. Standalone detection check
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as any).standalone === true ||
      document.referrer.includes('android-app://');

    if (isStandalone) {
      setIsInstalled(true);
      try {
        localStorage.setItem(PWA_STORAGE_KEY, 'true');
      } catch {}
      return;
    }

    // If persistent flag already says installed, never prompt
    try {
      if (localStorage.getItem(PWA_STORAGE_KEY) === 'true') {
        setIsInstalled(true);
        return;
      }
    } catch {}

    // Never prompt on desktop
    if (!isMobileDevice) {
      return;
    }

    // 3. Listen for native beforeinstallprompt (Chromium / Android)
    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      const promptEvent = e as BeforeInstallPromptEvent;
      setDeferredPrompt(promptEvent);

      if (!isDismissedForSession) {
        const timer = setTimeout(() => {
          if (!isDismissedForSession) {
            setShowPrompt(true);
          }
        }, 1500);
        return () => clearTimeout(timer);
      }
    };

    // 4. Listen for appinstalled
    const handleAppInstalled = () => {
      setIsInstalled(true);
      try {
        localStorage.setItem(PWA_STORAGE_KEY, 'true');
      } catch {}
      setDeferredPrompt(null);
      setShowPrompt(false);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleAppInstalled);

    // 5. iOS Safari auto-guide
    if (isIOSDevice && !isStandalone && !isDismissedForSession) {
      const timer = setTimeout(() => {
        if (!isDismissedForSession) {
          setShowPrompt(true);
        }
      }, 1800);
      return () => clearTimeout(timer);
    }

    // 6. Generic mobile fallback: on mobile device / mobile viewport when beforeinstallprompt
    // hasn't fired yet or browser doesn't support it (e.g. Firefox Mobile, responsive inspection),
    // show install banner shortly so user has clear manual guidance
    if (!isIOSDevice && !isStandalone && !isDismissedForSession) {
      const fallbackTimer = setTimeout(() => {
        if (!isDismissedForSession) {
          setShowPrompt(true);
        }
      }, 2500);
      return () => clearTimeout(fallbackTimer);
    }

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, [isDismissedForSession]);

  const openInstallPrompt = useCallback(() => {
    if (!isInstalled) {
      setShowPrompt(true);
    }
  }, [isInstalled]);

  const closePrompt = useCallback(() => {
    setShowPrompt(false);
    setIsDismissedForSession(true);
    try {
      sessionStorage.setItem(PWA_DISMISSED_SESSION_KEY, 'true');
    } catch {}
  }, []);

  const dismissPrompt = useCallback(() => {
    setShowPrompt(false);
    // Dismiss for the current browser tab session via versioned sessionStorage key
    setIsDismissedForSession(true);
    try {
      sessionStorage.setItem(PWA_DISMISSED_SESSION_KEY, 'true');
    } catch {}
  }, []);

  const acknowledgeIOSInstall = useCallback(() => {
    setIsInstalled(true);
    setShowPrompt(false);
    try {
      localStorage.setItem(PWA_STORAGE_KEY, 'true');
    } catch {}
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
        try {
          localStorage.setItem(PWA_STORAGE_KEY, 'true');
        } catch {}
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
    acknowledgeIOSInstall,
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
