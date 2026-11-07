// DORMEX Progressive Web App Service Worker
// Cache version bumped to bust any stale index.html or orphaned bundle hashes
const CACHE_NAME = 'dormex-static-v2.0.0';

// Explicit Allowlist of Static Application Shell Assets
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

// Activate: purge all stale caches immediately
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch: Network-first for navigation & index.html, strict bypass for APIs
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // 1. All API calls, authentication, or non-GET requests bypass Service Worker completely
  if (url.pathname.startsWith('/api') || event.request.method !== 'GET') {
    return;
  }

  // 2. Only same-origin requests
  if (url.origin !== self.location.origin) {
    return;
  }

  // 3. Navigation requests (HTML document) MUST ALWAYS be Network-First to avoid serving stale bundle hashes
  if (event.request.mode === 'navigate' || url.pathname === '/' || url.pathname === '/index.html') {
    event.respondWith(
      fetch(event.request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const clone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return networkResponse;
        })
        .catch(() => caches.match('/index.html'))
    );
    return;
  }

  // 4. For static assets in /assets/
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
      });
    })
  );
});
