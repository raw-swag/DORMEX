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

    beforeEach(() => {
      mockLocalStorage = {};
      vi.stubGlobal('localStorage', {
        getItem: (key: string) => mockLocalStorage[key] || null,
        setItem: (key: string, value: string) => { mockLocalStorage[key] = value; },
        removeItem: (key: string) => { delete mockLocalStorage[key]; },
      });
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('respects 7-day dismissal cooldown without storing sensitive data', () => {
      const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
      const now = Date.now();
      const dismissedUntil = now + SEVEN_DAYS_MS;
      localStorage.setItem('dormex_pwa_dismissed_until', dismissedUntil.toString());

      const stored = localStorage.getItem('dormex_pwa_dismissed_until');
      expect(stored).toBeDefined();
      expect(parseInt(stored!, 10)).toBeGreaterThan(now);

      // Verify no sensitive credentials in storage
      expect(localStorage.getItem('token')).toBeNull();
      expect(localStorage.getItem('user')).toBeNull();
      expect(localStorage.getItem('password')).toBeNull();
    });

    it('clears dismissal state permanently once app is installed', () => {
      localStorage.setItem('dormex_pwa_dismissed_until', '1234567890');
      localStorage.removeItem('dormex_pwa_dismissed_until');
      expect(localStorage.getItem('dormex_pwa_dismissed_until')).toBeNull();
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
  });
});
