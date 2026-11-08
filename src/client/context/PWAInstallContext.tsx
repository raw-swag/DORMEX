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

export function detectIsIOS(): boolean {
  if (typeof window === 'undefined') return false;
  const ua = window.navigator.userAgent || '';
  const isStandardIOS = /iPad|iPhone|iPod/i.test(ua) && !(window as any).MSStream;
  // iPadOS 13+ reports as Macintosh in user agent but has touch points
  const isIPadOS = window.navigator.platform === 'MacIntel' && (window.navigator.maxTouchPoints || 0) > 1;
  return isStandardIOS || isIPadOS;
}

export function detectIsMobile(): boolean {
  if (typeof window === 'undefined') return false;

  // 1. Client hints API if available
  const navAny = window.navigator as any;
  if (navAny?.userAgentData?.mobile !== undefined) {
    if (navAny.userAgentData.mobile === true) {
      return true;
    }
  }

  const ua = window.navigator.userAgent || '';

  // 2. Standard mobile device user agents
  const isMobileUA = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile|Silk|Kindle/i.test(ua);
  if (isMobileUA) return true;

  // 3. iPadOS 13+ (MacIntel with touch points)
  if (window.navigator.platform === 'MacIntel' && (window.navigator.maxTouchPoints || 0) > 1) {
    return true;
  }

  // 4. Coarse pointer (touchscreen devices) with reasonable mobile/tablet screen dimension
  const hasTouch = 'ontouchstart' in window || (window.navigator.maxTouchPoints && window.navigator.maxTouchPoints > 0);
  const isCoarsePointer = typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
  if ((hasTouch || isCoarsePointer) && window.innerWidth <= 844) {
    return true;
  }

  // 5. Responsive emulation viewport fallback (Chrome DevTools / Firefox responsive design mode)
  if (window.innerWidth <= 640) {
    return true;
  }

  return false;
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
    const isIOSDevice = detectIsIOS();
    const isMobileDevice = detectIsMobile();

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

    // If user already dismissed in this session, don't schedule popups
    if (isDismissedForSession) {
      return;
    }

    let promptTimer: NodeJS.Timeout | null = null;

    // 3. Listen for native beforeinstallprompt (Chromium / Android)
    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      const promptEvent = e as BeforeInstallPromptEvent;
      setDeferredPrompt(promptEvent);

      // Trigger branded bottom sheet smoothly after short initial settling delay (1500ms)
      // Clearing any pending fallback timer avoids duplicate scheduled prompts
      if (promptTimer) {
        clearTimeout(promptTimer);
        promptTimer = null;
      }
      promptTimer = setTimeout(() => {
        setShowPrompt(true);
      }, 1500);
    };

    // 4. Listen for appinstalled
    const handleAppInstalled = () => {
      setIsInstalled(true);
      try {
        localStorage.setItem(PWA_STORAGE_KEY, 'true');
      } catch {}
      setDeferredPrompt(null);
      setShowPrompt(false);
      if (promptTimer) {
        clearTimeout(promptTimer);
        promptTimer = null;
      }
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleAppInstalled);

    // 5. iOS Safari auto-guide:
    // iOS Safari never fires beforeinstallprompt; schedule dedicated guidance after 1800ms
    if (isIOSDevice) {
      if (promptTimer) clearTimeout(promptTimer);
      promptTimer = setTimeout(() => {
        setShowPrompt(true);
      }, 1800);
    } else {
      // 6. Generic mobile fallback:
      // On Android / mobile browsers where beforeinstallprompt does not fire
      // (e.g. Samsung Internet without ambient badge, Firefox Mobile, Opera Mobile),
      // schedule fallback guidance after 2500ms so native prompt has priority.
      if (promptTimer) clearTimeout(promptTimer);
      promptTimer = setTimeout(() => {
        setShowPrompt(true);
      }, 2500);
    }

    return () => {
      if (promptTimer) {
        clearTimeout(promptTimer);
        promptTimer = null;
      }
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
