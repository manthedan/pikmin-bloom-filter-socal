// App-shell service worker: the map is a field tool, so keep the shell and already-visited
// decor chunks usable offline. Basemap tiles are cross-origin and intentionally not cached.
const SHELL_CACHE = 'shell-v1';
const DATA_CACHE = 'data-v1';
const SHELL_URLS = [
  './',
  './index.html',
  './app.js',
  './styles.css',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './vendor/leaflet/leaflet.js',
  './vendor/leaflet/leaflet.css',
  // Precache the data metadata too: on a first visit the page isn't SW-controlled yet,
  // so without these an offline reopen gets a shell that cannot initialize decor data.
  './data/manifest.json',
  './data/cell-tiles-index.json',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(SHELL_CACHE).then(cache => cache.addAll(SHELL_URLS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== SHELL_CACHE && k !== DATA_CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Cell tiles and vendor files are versioned/immutable: cache-first.
// Everything else same-origin (shell, manifest.json, tile index): network-first with cache fallback.
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;

  const immutable = url.pathname.includes('/data/cell-tiles/') || url.pathname.includes('/vendor/');
  event.respondWith(immutable ? cacheFirst(event.request) : networkFirst(event.request));
});

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) {
    // Await the write: respondWith's lifetime ends when the response resolves, and the
    // worker may be terminated before an un-awaited put commits. But never let a
    // storage/quota failure break an otherwise-successful online fetch.
    try {
      const cache = await caches.open(DATA_CACHE);
      // Evict superseded ?v= variants of this same file: dataset rebuilds change the
      // version query, and without cleanup every generation accumulates (~46MB each).
      const variants = await cache.keys(request, { ignoreSearch: true });
      await Promise.all(variants.filter(v => v.url !== request.url).map(v => cache.delete(v)));
      await cache.put(request, response.clone());
    } catch (err) {
      // Serve the network response regardless.
    }
  }
  return response;
}

async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      try {
        const cache = await caches.open(SHELL_CACHE);
        await cache.put(request, response.clone());
      } catch (err) {
        // Storage failure must not break an online response.
      }
    }
    return response;
  } catch (err) {
    const cached = await caches.match(request);
    if (cached) return cached;
    // Any offline navigation (e.g. /index.html or a future route) falls back to the shell.
    if (request.mode === 'navigate') {
      const shell = await caches.match('./');
      if (shell) return shell;
    }
    throw err;
  }
}
