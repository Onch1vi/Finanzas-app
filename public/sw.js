// Service Worker for Finanzas App
// Strategy:
// - Same-origin app shell (index.html, manifest): network-first, fallback to cache.
//   That way users get fresh code when online, and a working app when offline.
// - CDN libs (React, Babel, Supabase): cache-first (immutable URLs).
// - Supabase API calls: network-only — auth/data must always be fresh.

const CACHE_VERSION = 'v15';
const APP_CACHE = `finanzas-app-${CACHE_VERSION}`;
const CDN_CACHE = `finanzas-cdn-${CACHE_VERSION}`;

const APP_SHELL = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(APP_CACHE)
      .then((cache) => cache.addAll(APP_SHELL).catch(() => {/* ignore single-file misses */}))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k !== APP_CACHE && k !== CDN_CACHE)
          .map((k) => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Always go to network for Supabase auth/API (no caching of private data)
  if (url.hostname.endsWith('supabase.co')) return;

  // CDN libs: cache-first
  if (url.hostname === 'unpkg.com' || url.hostname === 'cdn.jsdelivr.net' || url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(
      caches.open(CDN_CACHE).then(async (cache) => {
        const cached = await cache.match(req);
        if (cached) return cached;
        try {
          const res = await fetch(req);
          if (res && res.status === 200) cache.put(req, res.clone());
          return res;
        } catch (err) {
          // Last resort: try cache match without query params
          const fallback = await caches.match(req);
          if (fallback) return fallback;
          throw err;
        }
      })
    );
    return;
  }

  // Same-origin: network-first, fallback to cache
  if (url.origin === self.location.origin) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res && res.status === 200) {
            const clone = res.clone();
            caches.open(APP_CACHE).then((c) => c.put(req, clone));
          }
          return res;
        })
        .catch(() => caches.match(req).then((cached) => cached || caches.match('/index.html')))
    );
  }
});

// Allow the page to ask the SW to skip waiting on update
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

// === NOTIFICATION HANDLING ===
// When the user taps a notification, focus an existing tab or open a new one.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    const allClients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of allClients) {
      if (client.url.startsWith(self.location.origin)) {
        await client.focus();
        return;
      }
    }
    await self.clients.openWindow('/');
  })());
});

// === PERIODIC BACKGROUND SYNC ===
// Chrome (Android & desktop) wakes the SW once a day. We re-check pending
// payments stored in localStorage-mirrored IndexedDB cache... but we don't have
// one. Instead we just message any open client to refresh; if no client is open
// we silently skip (true server-push would require backend infrastructure).
self.addEventListener('periodicsync', (event) => {
  if (event.tag === 'check-payments') {
    event.waitUntil((async () => {
      const clientsList = await self.clients.matchAll({ type: 'window' });
      clientsList.forEach((c) => c.postMessage({ type: 'CHECK_PAYMENTS' }));
    })());
  }
});

// === PUSH HANDLER (placeholder) ===
// If we ever add a backend push service, it would land here.
self.addEventListener('push', (event) => {
  if (!event.data) return;
  let payload = {};
  try { payload = event.data.json(); } catch (e) { payload = { title: 'Finanzas', body: event.data.text() }; }
  event.waitUntil(
    self.registration.showNotification(payload.title || 'Finanzas', {
      body: payload.body || '',
      tag: payload.tag,
      data: payload.data || {},
      badge: '/icon-badge.png',
    })
  );
});
