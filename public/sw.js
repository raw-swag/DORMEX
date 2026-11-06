// DORMEX Progressive Web App Service Worker
// STRICT SECURITY COMPLIANCE (Section 8):
// - Caches ONLY an explicit allowlist of versioned, non-sensitive static assets.
// - NEVER caches API requests (/api/*).
// - NEVER caches user profiles, allocation state, sessions, credentials, tokens, complaints, or occupancy.
// - Never confirms seats or replays allocations offline.

const CACHE_NAME = 'dormex-static-v1.0.1';

// Explicit Allowlist of Static & Versioned Application Assets
const STATIC_ALLOWLIST = [
  '/',
  '/index.html',
  '/manifest.json',
  '/favicon.ico',
  '/favicon-32x32.png',
  '/favicon-16x16.png',
  '/favicon.png',
  '/apple-touch-icon.png',
  '/icon-192.png',
  '/icon-512.png',
  '/assets/index-DwXmj5D1.js',
  '/assets/floor-plans/bvb-floor-2.svg',
  '/assets/brand-logo-primary.png',
  '/assets/brand-logo-primary-transparent.png',
  '/assets/brand-logo-monochrome.png',
  '/assets/brand-logo-monochrome-transparent.png',
  '/assets/brand-logo-stacked.png',
  '/assets/brand-logo-stacked-transparent.png',
  '/assets/brand-logo-white.png',
  '/assets/brand-logo-white-transparent.png',
  '/assets/brand-symbol-icon.png',
  '/assets/brand-symbol-icon-transparent.png',
];

const ALLOWED_SET = new Set(STATIC_ALLOWLIST);

// Install: pre-cache verified explicit allowlist
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ALLOWLIST);
    }).then(() => self.skipWaiting())
  );
});

// Activate: purge stale cache generations
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key.startsWith('dormex-static-') && key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch: strict network-only for all dynamic and API endpoints
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // 1. Mandatory Security Rule: All API calls and mutations are STRICTLY network-only
  if (url.pathname.startsWith('/api') || event.request.method !== 'GET') {
    return; // Pass directly to standard network fetch without touching cache
  }

  // 2. Only same-origin requests are eligible for caching
  if (url.origin !== self.location.origin) {
    return;
  }

  // 3. Only serve or cache assets that exist in the explicit allowlist
  if (!ALLOWED_SET.has(url.pathname)) {
    // Navigational fallback for client routing
    if (event.request.mode === 'navigate') {
      event.respondWith(
        fetch(event.request).catch(() => caches.match('/index.html'))
      );
    }
    return;
  }

  // 4. Explicit Allowlisted static asset caching (Cache first, falling back to network)
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }
      return fetch(event.request).then((networkResponse) => {
        if (!networkResponse || networkResponse.status !== 200 || networkResponse.type !== 'basic') {
          return networkResponse;
        }

        const responseToCache = networkResponse.clone();
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(event.request, responseToCache);
        });

        return networkResponse;
      }).catch(() => {
        if (event.request.mode === 'navigate') {
          return caches.match('/index.html');
        }
      });
    })
  );
});
