import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import { App } from './App.js';

// Register PWA Service Worker in production or supporting browsers
if ('serviceWorker' in navigator && process.env.NODE_ENV === 'production') {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js')
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
