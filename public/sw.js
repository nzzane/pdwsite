const CACHE_NAME = 'pdw-v10';
const STATIC_ASSETS = [
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

// Install - only cache icons and manifest (not HTML/CSS/JS so they always load fresh)
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

// Activate - clean old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch - network first for everything; only fall back to cache for offline support
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Don't handle API requests, WebSocket, or chrome-extension URLs
  if (url.pathname.startsWith('/api/') || url.pathname === '/ws' || url.protocol === 'chrome-extension:') {
    return;
  }

  // Only handle same-origin requests
  if (url.origin !== self.location.origin) {
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        // Only cache icons/manifest for offline use - not HTML/CSS/JS
        if (response.ok && STATIC_ASSETS.some(a => url.pathname === a)) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() =>
        // Fall back to cache on network failure
        caches.match(event.request).then((cached) => {
          if (cached) return cached;
          // For navigation requests, try to serve cached index.html (if available)
          if (event.request.mode === 'navigate') {
            return caches.match('/index.html');
          }
          return new Response('Offline', { status: 503, statusText: 'Service Unavailable' });
        })
      )
  );
});

// Push notification handler
self.addEventListener('push', (event) => {
  if (!event.data) return;

  try {
    const payload = event.data.json();
    const options = {
      body: payload.body || 'New pager message',
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      vibrate: [200, 100, 200],
      data: payload.data || {},
      tag: payload.data?.messageId ? `msg-${payload.data.messageId}` : undefined,
      renotify: true,
      actions: [
        { action: 'open', title: 'Open' },
        { action: 'dismiss', title: 'Dismiss' },
      ],
    };
    event.waitUntil(self.registration.showNotification(payload.title || 'PDW Monitor', options));
  } catch {
    event.waitUntil(
      self.registration.showNotification('PDW Monitor', {
        body: event.data.text(),
        icon: '/icons/icon-192.png',
      })
    );
  }
});

// Notification click handler
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  if (event.action === 'dismiss') return;

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      // Focus existing window if available
      for (const client of clients) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          return client.focus();
        }
      }
      // Otherwise open new window
      return self.clients.openWindow('/');
    })
  );
});
