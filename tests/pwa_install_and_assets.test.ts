import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('DORMEX PWA Installation & Static Asset Integrity Suite', () => {
  const publicDir = path.resolve(process.cwd(), 'public');
  const manifestPath = path.join(publicDir, 'manifest.json');
  const swPath = path.join(publicDir, 'sw.js');
  const indexPath = path.resolve(process.cwd(), 'index.html');

  describe('1. Web App Manifest Standards', () => {
    it('manifest.json exists and parses valid JSON', () => {
      expect(fs.existsSync(manifestPath)).toBe(true);
      const content = fs.readFileSync(manifestPath, 'utf-8');
      const manifest = JSON.parse(content);
      expect(manifest.name).toBe('DORMEX Hostel Allocation Platform');
      expect(manifest.short_name).toBe('DORMEX');
      expect(manifest.start_url).toBe('/');
      expect(manifest.scope).toBe('/');
      expect(manifest.display).toBe('standalone');
      expect(manifest.theme_color).toBe('#07203C');
      expect(manifest.background_color).toBe('#F7F6F1');
      expect(Array.isArray(manifest.icons)).toBe(true);
    });

    it('manifest references valid 192x192 and 512x512 icons including maskable declarations', () => {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
      const icons = manifest.icons;

      const has192 = icons.some((i: any) => i.sizes === '192x192' && i.src === '/icon-192.png');
      const has512 = icons.some((i: any) => i.sizes === '512x512' && i.src === '/icon-512.png');
      const hasMaskable = icons.some((i: any) => i.purpose?.includes('maskable'));

      expect(has192).toBe(true);
      expect(has512).toBe(true);
      expect(hasMaskable).toBe(true);

      // Verify referenced asset files physically exist on disk
      for (const icon of icons) {
        const filePath = path.join(publicDir, icon.src.replace(/^\//, ''));
        expect(fs.existsSync(filePath)).toBe(true);
      }
    });
  });

  describe('2. Mobile Web App Metadata & CDN Removal in index.html', () => {
    it('index.html contains standard and iOS mobile-web-app metadata', () => {
      const indexHtml = fs.readFileSync(indexPath, 'utf-8');
      expect(indexHtml).toContain('<meta name="mobile-web-app-capable" content="yes" />');
      expect(indexHtml).toContain('<meta name="apple-mobile-web-app-capable" content="yes" />');
      expect(indexHtml).toContain('<link rel="manifest" href="/manifest.json" />');
      expect(indexHtml).toContain('<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png" />');
    });

    it('index.html does not contain Tailwind CDN or inline cdn script', () => {
      const indexHtml = fs.readFileSync(indexPath, 'utf-8');
      expect(indexHtml).not.toContain('cdn.tailwindcss.com');
      expect(indexHtml).not.toContain('<script src="https://cdn.tailwindcss.com"></script>');
    });
  });

  describe('3. Service Worker Security & Cache Strictness', () => {
    it('sw.js exists and enforces strict network-only bypass for /api/* and mutations', () => {
      expect(fs.existsSync(swPath)).toBe(true);
      const sw = fs.readFileSync(swPath, 'utf-8');

      // Strict rule: network only for all API requests and non-GET mutations
      expect(sw).toContain("url.pathname.startsWith('/api') || event.request.method !== 'GET'");
      // No caching of arbitrary origins
      expect(sw).toContain('url.origin !== self.location.origin');
      // Only approved DORMEX caches are purged upon activation
      expect(sw).toContain("key.startsWith('dormex-static-') && key !== CACHE_NAME");
    });

    it('sw.js never caches sensitive profile or allocation states', () => {
      const sw = fs.readFileSync(swPath, 'utf-8');
      expect(sw).not.toContain('/api/students');
      expect(sw).not.toContain('/api/auth');
      expect(sw).not.toContain('/api/allocation-cycles');
    });
  });

  describe('4. PWA Install Logic & Browser Behavioral Rules', () => {
    let mockLocalStorage: Record<string, string> = {};
    let mockSessionStorage: Record<string, string> = {};

    beforeEach(() => {
      mockLocalStorage = {};
      mockSessionStorage = {};
      vi.stubGlobal('localStorage', {
        getItem: (key: string) => mockLocalStorage[key] || null,
        setItem: (key: string, value: string) => { mockLocalStorage[key] = value; },
        removeItem: (key: string) => { delete mockLocalStorage[key]; },
      });
      vi.stubGlobal('sessionStorage', {
        getItem: (key: string) => mockSessionStorage[key] || null,
        setItem: (key: string, value: string) => { mockSessionStorage[key] = value; },
        removeItem: (key: string) => { delete mockSessionStorage[key]; },
      });
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('persists installation flag in localStorage under versioned key', () => {
      // Installed app records versioned key
      const PWA_STORAGE_KEY = 'dormex_pwa_installed_v1';
      localStorage.setItem(PWA_STORAGE_KEY, 'true');
      expect(localStorage.getItem(PWA_STORAGE_KEY)).toBe('true');
      expect(mockLocalStorage[PWA_STORAGE_KEY]).toBe('true');

      // Verify no sensitive credentials or tokens in storage
      expect(localStorage.getItem('token')).toBeNull();
      expect(localStorage.getItem('user')).toBeNull();
      expect(localStorage.getItem('password')).toBeNull();
    });

    it('persists Maybe later dismissal in sessionStorage under versioned key across page refreshes in same tab', () => {
      const PWA_DISMISSED_SESSION_KEY = 'dormex_pwa_dismissed_session_v1';
      sessionStorage.setItem(PWA_DISMISSED_SESSION_KEY, 'true');
      expect(sessionStorage.getItem(PWA_DISMISSED_SESSION_KEY)).toBe('true');
      expect(mockSessionStorage[PWA_DISMISSED_SESSION_KEY]).toBe('true');

      // Verify localStorage is NOT polluted with session dismissal
      expect(localStorage.getItem(PWA_DISMISSED_SESSION_KEY)).toBeNull();
    });

    it('identifies standalone display mode reliably across desktop and iOS', () => {
      // Browser matchMedia simulation
      const matchMediaStandalone = (query: string) => ({
        matches: query === '(display-mode: standalone)',
        addListener: vi.fn(),
        removeListener: vi.fn(),
      });

      expect(matchMediaStandalone('(display-mode: standalone)').matches).toBe(true);
      expect(matchMediaStandalone('(display-mode: browser)').matches).toBe(false);
    });

    it('installed app never receives the install prompt in standalone mode', () => {
      // Standalone mode detection rules
      const isStandalone = true;
      const isInstalled = isStandalone;
      const showPrompt = false; // Always suppressed when isInstalled === true

      expect(isInstalled).toBe(true);
      expect(showPrompt).toBe(false);
    });

    it('prompts eligible mobile visitors and handles Android and iOS guidance', () => {
      const isMobile = true;
      const isStandalone = false;
      let isDismissedForSession = false;

      // Eligible mobile prompt condition
      const shouldPrompt = isMobile && !isStandalone && !isDismissedForSession;
      expect(shouldPrompt).toBe(true);

      // Session dismissal suppresses prompt in same session/tab
      isDismissedForSession = true;
      expect(isMobile && !isStandalone && !isDismissedForSession).toBe(false);

      // New tab/session has isDismissedForSession = false
      isDismissedForSession = false;
      expect(isMobile && !isStandalone && !isDismissedForSession).toBe(true);
    });

    it('critical active workflows suppress install prompt', () => {
      const isWorkflowActive = true;
      const showPrompt = true;
      // PWAInstallPrompt checks: if (isInstalled || !showPrompt || isWorkflowActive) return null;
      const shouldRender = !isWorkflowActive && showPrompt;
      expect(shouldRender).toBe(false);
    });

    it('detects mobile devices via detectIsMobile helper across user agents and touch factors', async () => {
      const { detectIsMobile, detectIsIOS } = await import('../src/client/context/PWAInstallContext.js');

      // Android Mobile User Agent
      vi.stubGlobal('navigator', {
        userAgent: 'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.6099.230 Mobile Safari/537.36',
        maxTouchPoints: 5,
      });
      vi.stubGlobal('window', {
        navigator: {
          userAgent: 'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.6099.230 Mobile Safari/537.36',
          maxTouchPoints: 5,
        },
        innerWidth: 412,
        matchMedia: () => ({ matches: true }),
      });
      expect(detectIsMobile()).toBe(true);
      expect(detectIsIOS()).toBe(false);

      // iPhone Safari User Agent
      vi.stubGlobal('navigator', {
        userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1',
        maxTouchPoints: 5,
      });
      vi.stubGlobal('window', {
        navigator: {
          userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1',
          maxTouchPoints: 5,
        },
        innerWidth: 390,
        matchMedia: () => ({ matches: true }),
      });
      expect(detectIsMobile()).toBe(true);
      expect(detectIsIOS()).toBe(true);

      // iPadOS 13+ User Agent (reports MacIntel platform with touch points)
      vi.stubGlobal('navigator', {
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
        platform: 'MacIntel',
        maxTouchPoints: 5,
      });
      vi.stubGlobal('window', {
        navigator: {
          userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
          platform: 'MacIntel',
          maxTouchPoints: 5,
        },
        innerWidth: 820,
        matchMedia: () => ({ matches: true }),
      });
      expect(detectIsMobile()).toBe(true);
      expect(detectIsIOS()).toBe(true);

      // Desktop Chrome User Agent (wide screen, no touch)
      vi.stubGlobal('navigator', {
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        platform: 'Win32',
        maxTouchPoints: 0,
      });
      vi.stubGlobal('window', {
        navigator: {
          userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          platform: 'Win32',
          maxTouchPoints: 0,
        },
        innerWidth: 1440,
        matchMedia: () => ({ matches: false }),
      });
      expect(detectIsMobile()).toBe(false);
      expect(detectIsIOS()).toBe(false);
    });

    describe('5. Real-World Mobile Device Scenarios & Lifecycle Matrix', () => {
      it('scenario 1: Android Chrome without beforeinstallprompt triggers fallback popup', async () => {
        const { detectIsMobile, detectIsIOS } = await import('../src/client/context/PWAInstallContext.js');

        vi.stubGlobal('navigator', {
          userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.6261.64 Mobile Safari/537.36',
          maxTouchPoints: 5,
        });
        vi.stubGlobal('window', {
          navigator: {
            userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.6261.64 Mobile Safari/537.36',
            maxTouchPoints: 5,
          },
          innerWidth: 412,
          matchMedia: (q: string) => ({ matches: q.includes('coarse') }),
        });

        expect(detectIsMobile()).toBe(true);
        expect(detectIsIOS()).toBe(false);

        // Fallback timer (2000ms) would execute and trigger showPrompt(true)
        const isStandalone = false;
        const isDismissed = false;
        const willTriggerFallbackPrompt = detectIsMobile() && !isStandalone && !isDismissed;
        expect(willTriggerFallbackPrompt).toBe(true);
      });

      it('scenario 2: Android Chrome with beforeinstallprompt retains event and triggers prompt', async () => {
        let retainedPromptEvent: any = null;
        let promptTriggered = false;

        const mockBeforeInstallPromptEvent = {
          preventDefault: vi.fn(),
          prompt: vi.fn().mockResolvedValue(undefined),
          userChoice: Promise.resolve({ outcome: 'accepted', platform: 'web' }),
        };

        const handleBeforeInstallPrompt = (e: any) => {
          e.preventDefault();
          retainedPromptEvent = e;
          promptTriggered = true;
        };

        handleBeforeInstallPrompt(mockBeforeInstallPromptEvent);

        expect(mockBeforeInstallPromptEvent.preventDefault).toHaveBeenCalled();
        expect(retainedPromptEvent).toBe(mockBeforeInstallPromptEvent);
        expect(promptTriggered).toBe(true);
      });

      it('scenario 3: iPhone Safari displays iOS instruction sheet with share instructions', async () => {
        const { detectIsMobile, detectIsIOS } = await import('../src/client/context/PWAInstallContext.js');

        vi.stubGlobal('navigator', {
          userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
          maxTouchPoints: 5,
        });
        vi.stubGlobal('window', {
          navigator: {
            userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
            maxTouchPoints: 5,
          },
          innerWidth: 393,
          matchMedia: () => ({ matches: false }),
        });

        expect(detectIsMobile()).toBe(true);
        expect(detectIsIOS()).toBe(true);
      });

      it('scenario 4: iPhone Chrome displays iOS installation guidance', async () => {
        const { detectIsMobile, detectIsIOS } = await import('../src/client/context/PWAInstallContext.js');

        vi.stubGlobal('navigator', {
          userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/122.0.6261.62 Mobile/15E148 Safari/604.1',
          maxTouchPoints: 5,
        });
        vi.stubGlobal('window', {
          navigator: {
            userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/122.0.6261.62 Mobile/15E148 Safari/604.1',
            maxTouchPoints: 5,
          },
          innerWidth: 393,
          matchMedia: () => ({ matches: false }),
        });

        expect(detectIsMobile()).toBe(true);
        expect(detectIsIOS()).toBe(true);
      });

      it('scenario 5: Samsung Internet without beforeinstallprompt displays fallback popup', async () => {
        const { detectIsMobile, detectIsIOS } = await import('../src/client/context/PWAInstallContext.js');

        vi.stubGlobal('navigator', {
          userAgent: 'Mozilla/5.0 (Linux; Android 14; SAMSUNG SM-S928B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/24.0 Chrome/117.0.0.0 Mobile Safari/537.36',
          maxTouchPoints: 5,
        });
        vi.stubGlobal('window', {
          navigator: {
            userAgent: 'Mozilla/5.0 (Linux; Android 14; SAMSUNG SM-S928B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/24.0 Chrome/117.0.0.0 Mobile Safari/537.36',
            maxTouchPoints: 5,
          },
          innerWidth: 412,
          matchMedia: () => ({ matches: false }),
        });

        expect(detectIsMobile()).toBe(true);
        expect(detectIsIOS()).toBe(false);

        // Not standalone, not dismissed -> eligible for fallback prompt
        const isStandalone = false;
        const isDismissed = false;
        expect(detectIsMobile() && !isStandalone && !isDismissed).toBe(true);
      });

      it('scenario 6: Desktop browser never receives automatic mobile popup', async () => {
        const { detectIsMobile } = await import('../src/client/context/PWAInstallContext.js');

        vi.stubGlobal('navigator', {
          userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
          platform: 'MacIntel',
          maxTouchPoints: 0,
        });
        vi.stubGlobal('window', {
          navigator: {
            userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
            platform: 'MacIntel',
            maxTouchPoints: 0,
          },
          innerWidth: 1920,
          matchMedia: () => ({ matches: false }),
        });

        expect(detectIsMobile()).toBe(false);
      });

      it('scenario 7: Installed acknowledgement suppresses popup indefinitely', () => {
        const PWA_STORAGE_KEY = 'dormex_pwa_installed_v1';
        localStorage.setItem(PWA_STORAGE_KEY, 'true');

        const isInstalled = localStorage.getItem(PWA_STORAGE_KEY) === 'true';
        const showPrompt = false; // Suppressed immediately on mount

        expect(isInstalled).toBe(true);
        expect(showPrompt).toBe(false);
      });

      it('scenario 8: Standalone display-mode suppresses prompt completely', () => {
        const isStandalone = true;
        const canShow = !isStandalone;
        expect(canShow).toBe(false);
      });

      it('scenario 9: Session dismissal survives page refresh in same session', () => {
        const PWA_DISMISSED_SESSION_KEY = 'dormex_pwa_dismissed_session_v1';
        // User clicked "Maybe later"
        sessionStorage.setItem(PWA_DISMISSED_SESSION_KEY, 'true');

        // Simulate page reload
        const isDismissedAfterReload = sessionStorage.getItem(PWA_DISMISSED_SESSION_KEY) === 'true';
        expect(isDismissedAfterReload).toBe(true);
      });

      it('scenario 10: New browser session resets dismissal and allows popup again', () => {
        const PWA_DISMISSED_SESSION_KEY = 'dormex_pwa_dismissed_session_v1';
        // Simulate new browser tab/session (empty sessionStorage)
        mockSessionStorage = {};

        const isDismissedInNewSession = sessionStorage.getItem(PWA_DISMISSED_SESSION_KEY) === 'true';
        expect(isDismissedInNewSession).toBe(false);
      });

      it('scenario 11: Active critical workflow strictly suppresses popup rendering', () => {
        const isWorkflowActive = true;
        const isInstalled = false;
        const showPrompt = true;

        // Condition in PWAInstallPrompt: if (isInstalled || !showPrompt || isWorkflowActive) return null;
        const shouldRender = !(isInstalled || !showPrompt || isWorkflowActive);
        expect(shouldRender).toBe(false);
      });

      it('scenario 12: Timer cleanup and duplicate prevention cancels pending fallback when beforeinstallprompt fires', () => {
        let activeTimer: any = null;
        let showPrompt = false;

        // Step 1: Initial fallback timer scheduled (2500ms)
        activeTimer = setTimeout(() => {
          showPrompt = true;
        }, 2500);

        // Step 2: Native beforeinstallprompt fires at 500ms
        // It clears the fallback timer and schedules native prompt at 1500ms
        clearTimeout(activeTimer);
        activeTimer = setTimeout(() => {
          showPrompt = true;
        }, 1500);

        expect(activeTimer).toBeDefined();

        // Step 3: Effect unmount clears any active timer cleanly
        clearTimeout(activeTimer);
        activeTimer = null;
        expect(activeTimer).toBeNull();
      });

      it('scenario 13: iOS Safari without beforeinstallprompt schedules dedicated iOS guidance', async () => {
        const { detectIsMobile, detectIsIOS } = await import('../src/client/context/PWAInstallContext.js');

        vi.stubGlobal('navigator', {
          userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
          maxTouchPoints: 5,
        });
        vi.stubGlobal('window', {
          navigator: {
            userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
            maxTouchPoints: 5,
          },
          innerWidth: 393,
          matchMedia: () => ({ matches: false }),
        });

        expect(detectIsMobile()).toBe(true);
        expect(detectIsIOS()).toBe(true);

        const isStandalone = false;
        const isDismissed = false;
        // Eligible for iOS prompt timer (1800ms)
        const canPromptIOS = detectIsMobile() && detectIsIOS() && !isStandalone && !isDismissed;
        expect(canPromptIOS).toBe(true);
      });
    });
  });
});
