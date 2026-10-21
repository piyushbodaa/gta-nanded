/* GTA Nanded offline shell.
   - Pages and world data: network first, so a new release shows up on the next
     visit; the cached copy is only a fallback for flaky connections.
   - Hashed build assets and media: cache first (their names change when they do).
   Range requests (audio seeking) always go to the network. */
const VERSION = 'gta-nanded-v2-2026-10-21';
const CORE = ['/', '/manifest.webmanifest', '/icon.svg'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(VERSION).then(cache => cache.addAll(CORE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== VERSION).map(key => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

const put = (request, response) => {
  if (response.ok && response.status === 200) {
    const copy = response.clone();
    caches.open(VERSION).then(cache => cache.put(request, copy));
  }
  return response;
};

self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET' || request.headers.has('range')) return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  const immutable = url.pathname.startsWith('/assets/') || url.pathname.startsWith('/media/');
  if (immutable) {
    event.respondWith(caches.match(request).then(hit => hit || fetch(request).then(res => put(request, res))));
    return;
  }
  event.respondWith(fetch(request).then(res => put(request, res)).catch(() => caches.match(request).then(hit => hit || caches.match('/'))));
});
