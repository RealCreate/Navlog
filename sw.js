// Offline support: app shell is precached; chart tiles are cached as they are viewed
// (or saved in bulk with "Save chart for offline").
const VERSION = 'navlog-shell-v1';
const TILES = 'navlog-tiles-v1';
const SHELL = [
  './', 'index.html', 'styles.css', 'manifest.webmanifest',
  'js/app.js', 'js/data.js', 'js/nav.js', 'js/pdf.js', 'js/sun.js',
  'vendor/leaflet/leaflet.js', 'vendor/leaflet/leaflet.css', 'vendor/pdf-lib/pdf-lib.min.js',
  'assets/navlog-template.pdf', 'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION && k !== TILES).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  if (url.origin === location.origin && url.pathname.includes('/tiles/') && !url.pathname.endsWith('meta.json')) {
    // Chart tiles: cache first
    e.respondWith(caches.open(TILES).then(async (c) => {
      const hit = await c.match(e.request, { ignoreSearch: true });
      if (hit) return hit;
      const res = await fetch(e.request);
      if (res.ok) c.put(e.request, res.clone());
      return res;
    }));
    return;
  }
  if (url.origin === location.origin) {
    // App files: network first so updates arrive, cache as fallback for offline
    e.respondWith(fetch(e.request).then((res) => {
      if (res.ok) caches.open(VERSION).then((c) => c.put(e.request, res.clone()));
      return res;
    }).catch(() => caches.match(e.request, { ignoreSearch: true }).then((r) => r || caches.match('index.html'))));
  }
});
