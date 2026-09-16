/* ============================================================================
   Ragdoll Masters – PWA service worker
   ----------------------------------------------------------------------------
   - install: az app shellt precache-eli (offline játék)
   - navigate: először network, offline-ban a cache-ből adja a játékot
   - /api/scores: mindig network (a Function friss adatot ad); offline-ban a
     fetch elbukik és a játék saját localStorage-es fallbackje veszi át
   - többi same-origin GET: cache-first, háttérben frissítve
   ========================================================================== */
const VERSION = 'v1';
const STATIC_CACHE = `rm-static-${VERSION}`;
const RUNTIME_CACHE = `rm-runtime-${VERSION}`;

const PRECACHE_URLS = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/icon-192.png',
  '/icon-512.png',
  '/apple-touch-icon.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(STATIC_CACHE)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((k) => k.startsWith('rm-') && k !== STATIC_CACHE && k !== RUNTIME_CACHE)
          .map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return; // POST /api/scores stb. érintetlen marad
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // cross-origin: áthagyás

  /* API: mindig hálózatról, cache nélkül. Offline-ban a fetch elbukik és a
     játék a localStorage-es ranglistára esik vissza (lásd index.html). */
  if (url.pathname.startsWith('/api/')) return;

  /* Navigáció: network-first, offline-ban app shell a cache-ből. */
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(RUNTIME_CACHE).then((c) => c.put('/index.html', copy)).catch(() => {});
          return res;
        })
        .catch(() =>
          caches.match(req).then((hit) => hit || caches.match('/index.html'))
        )
    );
    return;
  }

  /* Egyéb statikus erőforrások: cache-first, háttérben frissítve. */
  e.respondWith(
    caches.open(RUNTIME_CACHE).then(async (cache) => {
      const hit = await cache.match(req);
      if (hit) {
        fetch(req).then((res) => { if (res && res.ok) cache.put(req, res.clone()); }).catch(() => {});
        return hit;
      }
      try {
        const res = await fetch(req);
        if (res && res.ok) cache.put(req, res.clone());
        return res;
      } catch (err) {
        return new Response('', { status: 504, statusText: 'Offline' });
      }
    })
  );
});
