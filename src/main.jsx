import React from 'react';
import ReactDOM from 'react-dom/client';
import './styles.css';
import App from './App.jsx';

// Hide the initial loading screen once React has mounted
const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<App />);

// Register service worker for offline + PWA notifications.
// HTTPS-only (browsers reject SW on http except localhost).
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js', { scope: '/' })
      .then((reg) => {
        if (reg.waiting) reg.waiting.postMessage('SKIP_WAITING');
        reg.addEventListener('updatefound', () => {
          const nw = reg.installing;
          if (!nw) return;
          nw.addEventListener('statechange', () => {
            if (nw.state === 'installed' && navigator.serviceWorker.controller) {
              nw.postMessage('SKIP_WAITING');
            }
          });
        });
      })
      .catch((err) => console.warn('SW registration failed:', err));
  });
}
