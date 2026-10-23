import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { track } from '../src/core/analytics.js';
import { Missions } from '../src/game/missions.js';

// public/analytics.js is a classic script in the page: run it against a stub window, as a browser
// would, on a URL carrying things that must never be sent.
const source = readFileSync(new URL('../public/analytics.js', import.meta.url), 'utf8');
function page(hostname = 'gta.nanded.fun') {
  const listeners = {}, scripts = [];
  const window = { addEventListener: (name, fn) => { listeners[name] = fn; } };
  const context = { window, location: { hostname, href: `https://${hostname}/?room=PRIVATE&name=SECRET#token` },
    document: { createElement: () => ({}), head: { appendChild: s => scripts.push(s) } } };
  const load = () => vm.runInNewContext(source, context);
  load();
  return {
    load, scripts,
    sent: () => Array.from(window.dataLayer || [], args => Array.from(args)), // into this realm's arrays
    announce: detail => listeners['nanded:analytics']?.({ detail }),
  };
}

test('analytics load on gta.nanded.fun only, and only once', () => {
  const p = page();
  p.load(); // the script included twice
  assert.equal(p.scripts.length, 1);
  assert.equal(p.sent().filter(c => c[1] === 'page_view').length, 1);
  for (const host of ['localhost', 'nanded-street-stories-git-analytics-piyushbodaa.vercel.app']) {
    const other = page(host);
    assert.equal(other.scripts.length, 0, host);
    assert.equal(other.sent().length, 0, host);
  }
});

test('only allowlisted events and modes are sent, never the URL, players or places', () => {
  const p = page();
  p.announce({ name: 'game_start', mode: 'free', player: 'SECRET', room: 'PRIVATE', coordinates: [1, 2] });
  p.announce({ name: 'game_start', mode: 'SECRET' });
  p.announce({ name: 'mission_complete' });
  p.announce({ name: 'chat', mode: 'free' });
  const events = p.sent().filter(c => c[0] === 'event');
  assert.deepEqual(events.map(c => [c[1], c[2].game_mode]),
    [['page_view', undefined], ['game_start', 'free'], ['game_start', undefined], ['mission_complete', undefined]]);
  for (const c of events) assert.equal(c[2].page_location, 'https://gta.nanded.fun/');
  assert.doesNotMatch(JSON.stringify(p.sent()), /SECRET|PRIVATE|token|room|coordinates/);
});

test('advertising features stay off', () => {
  const sent = page().sent();
  const config = sent.find(c => c[0] === 'config')[2], consent = sent.find(c => c[0] === 'consent')[2];
  assert.equal(config.send_page_view, false);
  assert.equal(config.allow_google_signals, false);
  assert.equal(config.allow_ad_personalization_signals, false);
  for (const k of ['ad_storage', 'ad_user_data', 'ad_personalization']) assert.equal(consent[k], 'denied', k);
});

test('the game announces starts and passed missions, and stays silent outside a browser', () => {
  assert.doesNotThrow(() => track('game_start', { mode: 'new' })); // Node has no window to tell
  const seen = [];
  globalThis.dispatchEvent = e => { seen.push([e.type, e.detail]); return true; };
  try {
    track('game_start', { mode: 'free' });
    const g = { hud: { big() {}, objective() {}, setTimer() {}, clearSubtitle() {}, route: null }, save: { complete() {}, flush() {} },
      addCash() {}, controls: new Map(), police: { lock: false }, camera: { cinematic: null } };
    const missions = new Missions(g, []);
    missions.active = { def: { id: 'm1', reward: 500 }, ent: {}, steps: [], i: 0 };
    missions.pass();
  } finally { delete globalThis.dispatchEvent; }
  assert.deepEqual(seen, [['nanded:analytics', { name: 'game_start', mode: 'free' }], ['nanded:analytics', { name: 'mission_complete' }]]);
});
