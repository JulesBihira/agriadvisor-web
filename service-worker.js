const CACHE_NAME = 'agriadvisor-v1';
const STATIC_CACHE = 'agriadvisor-static-v2';
const API_CACHE = 'agriadvisor-api-v1';

// Files to cache for offline use
const STATIC_FILES = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png',
];

// API endpoints to cache
const CACHE_API_PATTERNS = [
  '/api/markets/prices/',
  '/api/weather/current/',
  '/api/planting/calendar/',
  '/api/auth/profile/',
];

// Install — cache static files
self.addEventListener('install', event => {
  console.log('[SW] Installing AgriAdvisor service worker...');
  event.waitUntil(
    caches.open(STATIC_CACHE).then(cache => {
      return cache.addAll(STATIC_FILES).catch(err => {
        console.log('[SW] Some files failed to cache:', err);
      });
    })
  );
  self.skipWaiting();
});

// Activate — clean old caches
self.addEventListener('activate', event => {
  console.log('[SW] Activating AgriAdvisor service worker...');
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => key !== STATIC_CACHE && key !== API_CACHE)
          .map(key => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

// Fetch — serve from cache when offline
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Skip non-GET requests
  if (event.request.method !== 'GET') return;

  // Skip chrome-extension and other non-http requests
  if (!url.protocol.startsWith('http')) return;

  // API requests — network first, fall back to cache
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          // Cache successful API responses
          if (response.ok) {
            const shouldCache = CACHE_API_PATTERNS.some(pattern =>
              url.pathname.includes(pattern)
            );
            if (shouldCache) {
              const clone = response.clone();
              caches.open(API_CACHE).then(cache => {
                cache.put(event.request, clone);
              });
            }
          }
          return response;
        })
        .catch(() => {
          // Offline — serve from cache
          return caches.match(event.request).then(cached => {
            if (cached) return cached;
            // Return offline JSON for API calls
            return new Response(
              JSON.stringify({ detail: 'Offline — showing cached data', offline: true }),
              { headers: { 'Content-Type': 'application/json' } }
            );
          });
        })
    );
    return;
  }

  // App page - network first (so updates reach phones), cached copy if the
  // network is slower than 4 seconds or offline.
  if (event.request.mode === 'navigate' || url.pathname === '/' || url.pathname.endsWith('.html')) {
    const network = fetch(event.request).then(response => {
      if (response.ok) {
        const clone = response.clone();
        caches.open(STATIC_CACHE).then(cache => cache.put(event.request, clone));
      }
      return response;
    });
    event.waitUntil(network.catch(() => {}));
    event.respondWith(new Promise(resolve => {
      let done = false;
      const fromCache = () => caches.match(event.request).then(c => c || caches.match('/index.html'));
      const timer = setTimeout(() => {
        fromCache().then(c => { if (c && !done) { done = true; resolve(c); } });
      }, 4000);
      network.then(r => { if (!done) { done = true; clearTimeout(timer); resolve(r); } })
        .catch(() => {
          clearTimeout(timer);
          fromCache().then(c => { if (!done) { done = true; resolve(c || Response.error()); } });
        });
    }));
    return;
  }

  // Static files — cache first, fall back to network
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(response => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(STATIC_CACHE).then(cache => {
            cache.put(event.request, clone);
          });
        }
        return response;
      }).catch(() => {
        // Return the main app for navigation requests
        if (event.request.mode === 'navigate') {
          return caches.match('/index.html');
        }
      });
    })
  );
});

// Background sync — sync data when back online
self.addEventListener('sync', event => {
  if (event.tag === 'sync-farm-data') {
    console.log('[SW] Syncing farm data...');
  }
});

// Push notifications
self.addEventListener('push', event => {
  const data = event.data ? event.data.json() : {};
  const title = data.title || 'AgriAdvisor Alert';
  const options = {
    body: data.body || 'You have a new farming alert',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    vibrate: [200, 100, 200],
    data: { url: data.url || '/' },
    actions: [
      { action: 'view', title: 'View' },
      { action: 'dismiss', title: 'Dismiss' }
    ]
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

// Notification click
self.addEventListener('notificationclick', event => {
  event.notification.close();
  if (event.action === 'view' || !event.action) {
    event.waitUntil(
      clients.openWindow(event.notification.data.url || '/')
    );
  }
});
