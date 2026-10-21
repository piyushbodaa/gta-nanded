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
  event.waitUntil((async () => {
    const stale = (await caches.keys()).filter(key => key !== VERSION);
    await Promise.all(stale.map(key => caches.delete(key)));
    await self.clients.claim();
    // The first edition's worker served its cached page first, so a returning
    // player still sees the old game: reload those pages once into this one.
    if (stale.some(key => key.startsWith('nanded-v'))) {
      const pages = await self.clients.matchAll({ type: 'window' });
      await Promise.all(pages.map(page => page.navigate(page.url).catch(() => null)));
    }
  })());
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
