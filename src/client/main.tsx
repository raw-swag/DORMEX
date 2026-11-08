import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import { App } from './App.js';

// Register PWA Service Worker in production or supporting browsers
// Requires a secure context (HTTPS or localhost) and explicit production mode (or test override).
const isSecure = typeof window !== 'undefined' && (window.isSecureContext || ['localhost', '127.0.0.1'].includes(location.hostname));
const isProduction =
  (typeof __DORMEX_IS_PROD__ !== 'undefined' && __DORMEX_IS_PROD__ === true) ||
  (typeof process !== 'undefined' && process.env?.NODE_ENV === 'production') ||
  (typeof window !== 'undefined' && (window as any).__DORMEX_PROD__ === true) ||
  (typeof location !== 'undefined' && !['localhost', '127.0.0.1'].includes(location.hostname));

if ('serviceWorker' in navigator && isSecure && isProduction) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js', { scope: '/' })
      .then((reg) => {
        // Handle background updates gracefully
        reg.addEventListener('updatefound', () => {
          const installing = reg.installing;
          if (installing) {
            installing.addEventListener('statechange', () => {
              if (installing.state === 'installed' && navigator.serviceWorker.controller) {
                console.debug('New DORMEX service worker installed and available on refresh.');
              }
            });
          }
        });
      })
      .catch((err) => {
        console.debug('ServiceWorker registration not active:', err);
      });
  });
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
