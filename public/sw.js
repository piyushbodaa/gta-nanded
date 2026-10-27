/* GTA Nanded offline shell.
   - Pages and world data: network first, so a new release shows up on the next
     visit; the cached copy is only a fallback for flaky connections.
   - Hashed build assets: cache first (their names change when they do). The page
     names its release's files, so each fresh page drops the older releases' files
     instead of letting them pile up on the phone.
   - Media keep their names when they are replaced: shown from the cache at once,
     and checked in the background so the next visit has the new file.
   Installing caches the page, its build files and the world, so one visit online is
   enough to play offline. Range requests (audio seeking) always go to the network.
   VERSION only needs a bump to clear everything at once; releases do not need one. */
const VERSION = 'gta-nanded-v3-2026-10-27';
const CORE = ['/', '/manifest.webmanifest', '/icon.svg'];
const WORLD = '/data/world.json';

// The build files a page loads: its script, module preloads and stylesheet.
const releaseFiles = html => [...new Set(html.match(/\/assets\/[\w.-]+/g) || [])];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(VERSION);
    await cache.addAll(CORE);
    // These mostly come from the HTTP cache the page has just filled. A miss is not fatal:
    // the file is cached when the page next asks for it.
    const page = await cache.match('/');
    const files = [...(page ? releaseFiles(await page.text()) : []), WORLD];
    await Promise.all(files.map(file => cache.add(file).catch(() => {})));
    await self.skipWaiting();
  })());
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

// Keeps a copy of a good response; settles to true once it is stored.
const store = (key, response) => {
  if (!response.ok || response.status !== 200) return Promise.resolve(false);
  const copy = response.clone();
  return caches.open(VERSION).then(cache => cache.put(key, copy)).then(() => true, () => false);
};

// Drops cached build files that the current page no longer names: older releases'.
async function prune() {
  const cache = await caches.open(VERSION);
  const page = await cache.match('/');
  const keep = new Set(page ? releaseFiles(await page.text()) : []);
  if (!keep.size) return; // not the game's page: leave the cache alone
  for (const request of await cache.keys()) {
    const path = new URL(request.url).pathname;
    if (path.startsWith('/assets/') && !keep.has(path)) await cache.delete(request);
  }
}

self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET' || request.headers.has('range')) return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(caches.match(request).then(hit => hit || fetch(request).then(res => {
      event.waitUntil(store(request, res));
      return res;
    })));
    return;
  }
  if (url.pathname.startsWith('/media/')) {
    event.respondWith(caches.match(request).then(hit => {
      // A revalidation, so usually a 304; the copy is rewritten only when the file changed.
      const fresh = fetch(request).then(res => {
        const same = hit && res.headers.get('etag') && res.headers.get('etag') === hit.headers.get('etag');
        if (!same) event.waitUntil(store(request, res));
        return res;
      });
      if (!hit) return fresh;
      event.waitUntil(fresh.catch(() => null));
      return hit;
    }));
    return;
  }
  // A page is kept under its path alone, so '?perf' or a share link's tags add no extra copies.
  // Offline, only a page falls back to the game's page: data or a script that was never cached
  // gets a plain network error, not HTML in its place.
  const navigate = request.mode === 'navigate';
  const key = navigate ? url.pathname : request;
  event.respondWith(fetch(request).then(res => {
    const stored = store(key, res);
    event.waitUntil(navigate && url.pathname === '/' ? stored.then(ok => ok && prune()).catch(() => {}) : stored);
    return res;
  }).catch(() => caches.match(key).then(hit => hit || (navigate ? caches.match('/') : Response.error()))));
});
