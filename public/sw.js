// Service Worker for MyGym PWA (100% offline support)
//
// CACHE_NAME is stamped with a content hash of the build by
// scripts/version-sw.mjs (run as part of `npm run build`). The browser only
// reinstalls a service worker when the bytes of sw.js change, so the versioned
// name is what makes updates — and old-cache eviction — actually happen.
// __BUILD_VERSION__ is a placeholder that never survives a real build.
const CACHE_NAME = 'mygym-pwa-__BUILD_VERSION__';

// All paths are derived from the worker's own script URL so the worker works
// at a site root (Vercel) and under a subpath without changes.
const BASE_PATH = self.location.pathname.replace(/sw\.js$/, '');
const APP_HTML = `${BASE_PATH}index.html`;

const STATIC_ASSETS = [
  BASE_PATH,
  APP_HTML,
  `${BASE_PATH}manifest.webmanifest`,
  `${BASE_PATH}icons/icon-192.svg`,
  `${BASE_PATH}icons/icon-512.svg`
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS);
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  // Ignore non-GET requests or chrome-extension URLs or Vite internal dev URLs
  if (
    event.request.method !== 'GET' ||
    !event.request.url.startsWith('http') ||
    event.request.url.includes('/@vite/') ||
    event.request.url.includes('/@react-refresh') ||
    event.request.url.includes('/@id/') ||
    event.request.url.includes('?t=')
  ) {
    return;
  }

  // Navigation requests: network-first, and write the fresh HTML back to the
  // cache so the offline fallback tracks the deployed version instead of
  // staying pinned to whatever was cached at first install.
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const responseToCache = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(APP_HTML, responseToCache);
            });
          }
          return networkResponse;
        })
        .catch(() => caches.match(APP_HTML))
    );
    return;
  }

  // Cache-first with network fallback and dynamic caching for static assets
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        fetch(event.request)
          .then((networkResponse) => {
            if (networkResponse && networkResponse.status === 200) {
              caches.open(CACHE_NAME).then((cache) => cache.put(event.request, networkResponse));
            }
          })
          .catch(() => {
            // offline, ignore
          });
        return cachedResponse;
      }

      return fetch(event.request)
        .then((networkResponse) => {
          if (!networkResponse || networkResponse.status !== 200 || networkResponse.type === 'opaque') {
            return networkResponse;
          }
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });
          return networkResponse;
        })
        .catch(() => {
          if (event.request.destination === 'image') {
            return caches.match(`${BASE_PATH}icons/icon-192.svg`);
          }
          return new Response('Offline', { status: 503, statusText: 'Offline' });
        });
    })
  );
});
