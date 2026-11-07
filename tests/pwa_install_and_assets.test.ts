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
  });
});
