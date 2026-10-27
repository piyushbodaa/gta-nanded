import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// public/sw.js is a classic worker script: run it in a stub service worker scope with an in-memory
// Cache Storage and a fake gta.nanded.fun, and play visits through it the way a phone would.
const source = readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8');
const ORIGIN = 'https://gta.nanded.fun';
const page = release => `<meta property="og:image" content="${ORIGIN}/media/key-art.webp" />
<script type="module" crossorigin src="/assets/index-${release}.js"></script>
<link rel="modulepreload" crossorigin href="/assets/three-A.js"><link rel="stylesheet" crossorigin href="/assets/index-${release}.css">
<img src="/media/chase.webp" alt="" />`;
const site = release => ({
  '/': { body: page(release) }, '/manifest.webmanifest': { body: '{}' }, '/icon.svg': { body: '<svg/>' },
  [`/assets/index-${release}.js`]: { body: `js ${release}` }, [`/assets/index-${release}.css`]: { body: `css ${release}` },
  '/assets/three-A.js': { body: 'three' }, '/data/world.json': { body: '{"roads":[]}' }, '/analytics.js': { body: '//' },
  '/media/chase.webp': { body: 'art 1', etag: '"1"' }, '/media/key-art.webp': { body: 'share image' },
});

function phone(files, { oldCaches = {} } = {}) {
  const href = r => new URL(typeof r === 'string' ? r : r.url, ORIGIN).href;
  const net = { files, online: true, puts: [], sent: [] }; // sent: what the server answered, file by file
  const stores = new Map(Object.entries(oldCaches).map(([name, urls]) => [name, new Map(urls.map(u => [href(u), new Response('old')]))]));
  const cache = name => {
    if (!stores.has(name)) stores.set(name, new Map());
    const m = stores.get(name);
    const c = {
      match: async r => m.get(href(r))?.clone(),
      put: async (r, res) => { net.puts.push(new URL(href(r)).pathname); m.set(href(r), res); },
      add: async r => { const res = await fetch(r); if (!res.ok) throw new TypeError('Bad response'); await c.put(r, res); },
      addAll: async list => { for (const r of list) await c.add(r); },
      keys: async () => [...m.keys()].map(url => ({ url })),
      delete: async r => m.delete(href(r)),
    };
    return c;
  };
  const caches = {
    open: async name => cache(name),
    keys: async () => [...stores.keys()],
    delete: async name => stores.delete(name),
    match: async r => { for (const m of stores.values()) if (m.has(href(r))) return m.get(href(r)).clone(); },
  };
  // Like Vercel: the query does not change the file served, and a request naming the file's ETag gets a 304.
  // There is no HTTP cache here, as on a phone that has dropped it: a plain request downloads the file.
  async function fetch(r) {
    if (!net.online) throw new TypeError('Failed to fetch');
    const path = new URL(href(r)).pathname, file = net.files[path];
    const status = !file ? 404 : file.etag && r.headers?.get('if-none-match') === file.etag ? 304 : 200;
    net.sent.push(`${status} ${path}`);
    if (status === 404) return new Response('Not found', { status });
    return new Response(status === 304 ? null : file.body, { status, headers: file.etag ? { etag: file.etag } : {} });
  }
  const on = {};
  const self = { addEventListener: (name, fn) => { on[name] = fn; }, location: new URL('/sw.js', ORIGIN),
    skipWaiting: async () => {}, clients: { claim: async () => {}, matchAll: async () => [] } };
  vm.runInNewContext(source, { self, caches, fetch, Request, Response, URL });
  const settle = async waits => { for (let i = 0; i < waits.length; i++) await waits[i]; }; // waits can grow while settling
  return {
    net, caches,
    paths: () => [...stores.values()].flatMap(m => [...m.keys()].map(u => u.slice(ORIGIN.length))).sort(),
    async lifecycle(name) { const waits = []; on[name]({ waitUntil: p => waits.push(p) }); await settle(waits); },
    // One request from the page; resolves to what the page gets (a network error rejects).
    async get(path, { mode = 'cors', headers = {} } = {}) {
      const waits = []; let answer = null;
      const request = { url: ORIGIN + path, method: 'GET', mode, headers: new Headers(headers) };
      on.fetch({ request, respondWith: p => { answer = p; }, waitUntil: p => waits.push(p) });
      try { return await (answer || fetch(request)); } finally { await settle(waits); }
    },
    async install() { await this.lifecycle('install'); await this.lifecycle('activate'); },
  };
}

test('one visit online is enough to play offline, and the old edition\'s cache goes', async () => {
  const p = phone(site('B'), { oldCaches: { 'gta-nanded-v2-2026-10-21': ['/assets/index-OLD.js', '/assets/index-OLDER.js'] } });
  await p.install();
  assert.deepEqual(await p.caches.keys(), ['gta-nanded-v3-2026-10-27']);
  p.net.online = false;
  assert.equal(await (await p.get('/', { mode: 'navigate' })).text(), page('B'));
  for (const file of ['/assets/index-B.js', '/assets/index-B.css', '/assets/three-A.js', '/data/world.json', '/media/chase.webp']) {
    assert.equal((await p.get(file)).status, 200, file);
  }
  // The share image is named only by full address in og:image; the page never loads it.
  assert.ok(!p.paths().includes('/media/key-art.webp'));
});

test('a world that fails to download does not stop the install, and offline it is a network error, not the page', async () => {
  const files = site('B');
  delete files['/data/world.json'];
  const p = phone(files);
  await p.install();
  p.net.online = false;
  assert.equal((await p.get('/data/world.json')).type, 'error'); // was the HTML page, parsed as JSON
  assert.equal((await p.get('/analytics.js')).type, 'error');
  assert.equal(await (await p.get('/?perf', { mode: 'navigate' })).text(), page('B')); // a page still opens the game
});

test('a new release drops the old release\'s build files and keeps one copy of the page', async () => {
  const p = phone(site('B'));
  await p.install();
  for (const file of ['/assets/index-B.js', '/assets/three-A.js', '/assets/index-B.css', '/media/chase.webp']) await p.get(file);
  assert.ok(p.paths().includes('/assets/index-B.js'));
  Object.assign(p.net.files, site('C')); // deploy: a new index script and stylesheet
  await p.get('/?fbclid=abc', { mode: 'navigate' });
  for (const file of ['/assets/index-C.js', '/assets/three-A.js', '/assets/index-C.css']) await p.get(file);
  assert.deepEqual(p.paths(), ['/', '/assets/index-C.css', '/assets/index-C.js', '/assets/three-A.js',
    '/data/world.json', '/icon.svg', '/manifest.webmanifest', '/media/chase.webp']);
  // The same page again prunes nothing still in use.
  await p.get('/', { mode: 'navigate' });
  assert.equal(p.paths().length, 8);
});

test('replaced media reach the next visit, and unchanged media cost a 304, not a download', async () => {
  const p = phone(site('B'));
  await p.install();
  const puts = p.net.puts.length;
  p.net.sent.length = 0;
  assert.equal(await (await p.get('/media/chase.webp')).text(), 'art 1');
  assert.deepEqual(p.net.sent, ['304 /media/chase.webp'], 'the background check downloaded an unchanged file');
  assert.equal(p.net.puts.length, puts, 'a 304 rewrote the cached copy');
  p.net.files['/media/chase.webp'] = { body: 'art 2', etag: '"2"' }; // same name, new art
  assert.equal(await (await p.get('/media/chase.webp')).text(), 'art 1'); // shown at once from the cache
  assert.equal(await (await p.get('/media/chase.webp')).text(), 'art 2'); // and new on the next visit
  p.net.online = false;
  assert.equal(await (await p.get('/media/chase.webp')).text(), 'art 2');
  // Audio seeking (range requests) is never answered from the cache.
  p.net.online = true;
  p.net.files['/media/theme.m4a'] = { body: 'audio' };
  await p.get('/media/theme.m4a', { headers: { range: 'bytes=0-1' } });
  assert.ok(!p.paths().includes('/media/theme.m4a'));
});
