// Coming back after an app switch: the resume snapshot, the GPU-loss card's states, the wake lock.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { snapshotResume, shouldResume, applyResume, resumeContext, resumeLabel, RESUME_MAX_AGE, LIVE_KEY } from '../src/game/resume.js';
import { Lifecycle } from '../src/core/lifecycle.js';
import { Save } from '../src/game/save.js';

// ---------------------------------------------------------------- fakes
class Target {
  constructor() { this.l = {}; }
  addEventListener(t, f) { (this.l[t] ||= []).push(f); }
  removeEventListener(t, f) { this.l[t] = (this.l[t] || []).filter(x => x !== f); }
  fire(t, e = {}) { for (const f of this.l[t] || []) f(e); }
}

function fakeGame(over = {}) {
  const calls = [];
  const canvas = new Target();
  let lost = false;
  const g = {
    calls, canvas,
    started: true, paused: false, respawning: false, cutscene: null, time: 42, freeRoam: false,
    _pauseDrawn: true,
    renderer: { domElement: canvas, shadowMap: { needsUpdate: false }, getContext: () => ({ isContextLost: () => lost }) },
    setLost(v) { lost = v; },
    shadowAt: { x: 0, set(x) { this.x = x; } },
    sky: { hours: 14.25, weather: 'clear', env: { t: 0, hours: 14 }, setWeather(w) { this.weather = w; } },
    post: { disposed: 0, _dispose() { this.disposed++; } },
    city: { district: () => ({ name: 'Zenda Chowk' }), groundHeight: () => 0 },
    police: { level: 2, setLevel(n) { this.level = n; } },
    missions: { active: null },
    weapons: { current: 'p92', wheelOpen: false, toSave: () => ({ weapons: ['p92'], equipped: 'p92' }), closeWheel() { this.wheelOpen = false; calls.push('closeWheel'); }, equip(id) { this.current = id; return true; } },
    save: { data: { settings: { awake: true }, resume: null }, set(k, v) { this.data[k] = v; }, setResume(r) { if (r) this.data.resume = r; }, flush() { calls.push('flush'); return true; } },
    pause: { open: false, tab: 'map', openMenu() { this.open = true; g.paused = true; calls.push('pause'); }, close() { this.open = false; g.paused = false; calls.push('close'); } },
    renderWorld() { calls.push('render'); },
    warmShaders(going, done) { calls.push('warm'); done?.(); },
    player: {
      x: 100.123, z: -50.5, y: 0, heading: 1.2, health: 80, maxHealth: 100, state: 'foot', vehicle: null, groundY: 0,
      teleport(x, z, h) { this.x = x; this.z = z; this.heading = h; this.vehicle = null; this.state = 'foot'; },
      enterVehicle(v) { this.vehicle = v; this.state = 'driving'; },
    },
    vehicles: { spawned: [], spawn(type, x, z, heading, o) { const v = { type, x, z, heading, color: o.color, role: o.role, health: 1000 }; this.spawned.push(v); return v; } },
    ...over,
  };
  return g;
}

function fakeEnv() {
  const doc = new Target(); doc.hidden = false;
  const win = new Target(); win.reloaded = 0; win.location = { reload: () => win.reloaded++ };
  const store = new Map();
  const shown = [];
  const ui = { show: m => shown.push(m), hide: () => shown.push('hide') };
  let t = 100000;
  const clock = { now: () => t, add: ms => (t += ms) };
  return { doc, win, store: { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) }, map: store, shown, ui, clock };
}

const make = (g, env, nav = {}) => new Lifecycle(g, { doc: env.doc, win: env.win, nav, store: env.store, ui: env.ui, now: env.clock.now });

// ---------------------------------------------------------------- resume.js
test('a snapshot on foot keeps the spot, the time of day and the gun in hand', () => {
  const g = fakeGame();
  const r = snapshotResume(g);
  assert.equal(r.v, 1);
  assert.equal(r.x, 100.12); assert.equal(r.z, -50.5);
  assert.equal(r.hours, 14.25);
  assert.equal(r.wanted, 2);
  assert.equal(r.equipped, 'p92');
  assert.equal(r.vehicle, null);
  assert.equal(r.place, 'Zenda Chowk');
  assert.ok(JSON.stringify(r).length < 400, 'small enough for every autosave');
});

test('a snapshot in a vehicle keeps its type, colour and health, and where the vehicle is', () => {
  const g = fakeGame();
  const v = { type: 'auto', color: 0x2e7d32, health: 640, x: 10, z: 20, y: 0, heading: 0.5 };
  Object.assign(g.player, { state: 'driving', vehicle: v });
  const r = snapshotResume(g);
  assert.deepEqual(r.vehicle, { type: 'auto', color: 0x2e7d32, health: 640, owned: 0 });
  assert.equal(r.x, 10); assert.equal(r.heading, 0.5);
  assert.equal(resumeLabel(r), 'Zenda Chowk · in your auto');
});

test('no snapshot in a cutscene, while WASTED, dead, or with the retry card up', () => {
  assert.equal(snapshotResume(fakeGame({ cutscene: { id: 'x' } })), null);
  assert.equal(snapshotResume(fakeGame({ respawning: true })), null);
  assert.equal(snapshotResume(fakeGame({ retryCard: { open: true } })), null);
  const g = fakeGame(); g.player.state = 'dead';
  assert.equal(snapshotResume(g), null);
  assert.equal(snapshotResume(fakeGame({ started: false })), null);
});

test('resume is offered only when fresh, and only in a tab that was playing or was thrown away', () => {
  const r = snapshotResume(fakeGame());
  const now = r.at + 60000;
  assert.equal(shouldResume(r, { now, live: true }), true);
  assert.equal(shouldResume(r, { now, discarded: true }), true);
  assert.equal(shouldResume(r, { now }), false, 'a new tab gets the usual CONTINUE');
  assert.equal(shouldResume(r, { now: r.at + RESUME_MAX_AGE + 1, live: true }), false, 'stale');
  assert.equal(shouldResume(null, { now, live: true }), false);
  assert.equal(shouldResume({ v: 1, at: now, x: NaN, z: 0 }, { now, live: true }), false);
});

test('resumeContext reads the live flag and a discarded tab, and survives blocked storage', () => {
  assert.deepEqual(resumeContext({ store: { getItem: k => (k === LIVE_KEY ? 'reload' : null) }, doc: {}, now: 5 }), { now: 5, live: true, discarded: false });
  assert.deepEqual(resumeContext({ store: { getItem: () => { throw new Error('blocked'); } }, doc: { wasDiscarded: true }, now: 5 }), { now: 5, live: false, discarded: true });
});

test('applying a resume puts the player back in the same kind of vehicle, wanted cleared, mission mentioned', () => {
  const src = fakeGame();
  Object.assign(src.player, { state: 'driving', vehicle: { type: 'bike', color: 7, health: 100, x: 33, z: 44, heading: 2 } });
  src.missions.active = { def: { id: 'c3', title: 'Sand Mafia' } };
  const r = snapshotResume(src);
  const g = fakeGame(); const toasts = [];
  g.hud = { toast: t => toasts.push(t) };
  g.sky.hours = 9;
  const v = applyResume(g, r);
  assert.equal(g.player.x, 33); assert.equal(g.player.z, 44);
  assert.equal(v.type, 'bike'); assert.equal(v.color, 7); assert.equal(v.role, 'player');
  assert.equal(g.player.vehicle, v);
  assert.equal(v.health, 260, 'never back into a burning car');
  assert.equal(g.sky.hours, 14.25);
  assert.equal(g.police.level, 0);
  assert.match(toasts[0], /Sand Mafia/);
  applyResume(g, r, { keepWanted: true });
  assert.equal(g.police.level, 2);
});

test('an owned car is moved to the spot, not copied', () => {
  const src = fakeGame();
  Object.assign(src.player, { state: 'driving', vehicle: { type: 'sedan', color: 1, health: 900, owned: 4, x: 5, z: 6, heading: 0 } });
  const r = snapshotResume(src);
  const g = fakeGame();
  const mine = { type: 'sedan', x: 900, z: 900, health: 900 };
  g.garage = { vehicleById: id => (id === 4 ? mine : null) };
  const v = applyResume(g, r);
  assert.equal(v, mine);
  assert.equal(mine.x, 5);
  assert.equal(g.vehicles.spawned.length, 0);
});

test('on foot the gun that was in hand comes back up', () => {
  const r = snapshotResume(fakeGame());
  const g = fakeGame(); g.weapons.current = 'fist';
  assert.equal(applyResume(g, r), null);
  assert.equal(g.weapons.current, 'p92');
});

// ---------------------------------------------------------------- save.js
test('an old save loads with an empty resume slot and the screen kept on', () => {
  const store = new Map();
  globalThis.localStorage = { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
  store.set('gta-nanded-save-v2', JSON.stringify({ version: 2, cash: 999, settings: { sfx: 0.3 } }));
  const s = new Save();
  assert.equal(s.cash, 999);
  assert.equal(s.data.resume, null);
  assert.equal(s.data.settings.awake, true);
  assert.equal(s.data.settings.sfx, 0.3);
  s.setResume(null);
  assert.equal(s.data.resume, null, 'a null snapshot keeps the slot as it was');
  s.setResume({ v: 1, at: 1, x: 1, z: 2 }); s.flush();
  assert.equal(new Save().data.resume.x, 1);
  s.reset();
  assert.equal(new Save().data.resume, null, 'NEW STORY clears it');
});

// ---------------------------------------------------------------- lifecycle.js
test('going to the background saves the spot, closes the wheel, pauses and flushes', () => {
  const g = fakeGame(); const env = fakeEnv();
  g.weapons.wheelOpen = true;
  make(g, env);
  env.doc.hidden = true; env.doc.fire('visibilitychange');
  assert.ok(g.calls.includes('closeWheel'));
  assert.ok(g.calls.includes('pause'));
  assert.ok(g.calls.includes('flush'));
  assert.equal(g.save.data.resume.x, 100.12);
  assert.deepEqual(g.save.data.inventory, { weapons: ['p92'], equipped: 'p92' });
});

test('WASTED is not covered by the pause menu when the page hides', () => {
  const g = fakeGame({ respawning: true }); const env = fakeEnv();
  make(g, env);
  env.win.fire('pagehide');
  assert.ok(!g.calls.includes('pause'));
  assert.ok(g.calls.includes('flush'));
});

test('a lost context: card up, paused; restored: stale pictures marked, warm-up, then TAP TO CONTINUE', () => {
  const g = fakeGame(); const env = fakeEnv();
  const lc = make(g, env);
  let prevented = 0;
  g.canvas.fire('webglcontextlost', { preventDefault: () => prevented++ });
  assert.equal(prevented, 1);
  assert.equal(lc.state, 'lost'); assert.ok(lc.blocking);
  assert.equal(g.paused, true);
  assert.deepEqual(env.shown, ['lost']);
  g.canvas.fire('webglcontextrestored');
  assert.equal(lc.state, 'warming');
  assert.equal(g._pauseDrawn, false);
  assert.equal(g.renderer.shadowMap.needsUpdate, true);
  assert.equal(g.shadowAt.x, 1e9);
  assert.equal(g.sky.env.t, Infinity);
  assert.equal(g.post.disposed, 1);
  assert.equal(g.player.teleportAt, 42);
  for (let i = 0; i < 8 && lc.state === 'warming'; i++) { env.clock.add(16); lc.update(); }
  assert.equal(lc.state, 'ready');
  assert.equal(g.calls.filter(c => c === 'render').length, 3);
  assert.ok(g.calls.includes('warm'));
  assert.equal(env.shown.at(-1), 'ready');
  lc.tap();
  assert.equal(lc.state, 'ok');
  assert.equal(g.pause.open, false);
  assert.equal(env.shown.at(-1), 'hide');
});

test('the warm-up waits while the page is hidden', () => {
  const g = fakeGame(); const env = fakeEnv();
  const lc = make(g, env);
  lc.lost(); lc.restored();
  env.doc.hidden = true;
  for (let i = 0; i < 10; i++) { env.clock.add(5000); lc.update(); }
  assert.equal(lc.state, 'warming');
  assert.ok(!g.calls.includes('render'));
});

test('two losses in a minute, or 6 s on screen with no restore, offer the reload', () => {
  {
    const g = fakeGame(); const env = fakeEnv();
    const lc = make(g, env);
    lc.lost(); lc.restored(); lc.tap();
    env.clock.add(20000);
    lc.lost();
    assert.equal(lc.state, 'reload');
    assert.equal(env.shown.at(-1), 'reload');
  }
  {
    const g = fakeGame(); const env = fakeEnv();
    const lc = make(g, env);
    lc.lost();
    env.clock.add(5000); lc.update();
    assert.equal(lc.state, 'lost');
    env.clock.add(1500); lc.update();
    assert.equal(lc.state, 'reload');
    lc.tap();
    assert.equal(env.win.reloaded, 1);
    assert.equal(env.map.get(LIVE_KEY), 'reload');
  }
});

test('lost while hidden: the 6 s only count once the page is back on screen', () => {
  const g = fakeGame(); const env = fakeEnv();
  const lc = make(g, env);
  env.doc.hidden = true; env.doc.fire('visibilitychange');
  lc.lost();
  env.clock.add(60000); lc.update();
  assert.equal(lc.state, 'lost');
  env.doc.hidden = false; env.doc.fire('visibilitychange');
  env.clock.add(6500); lc.update();
  assert.equal(lc.state, 'reload');
});

test('a restore that throws offers the reload', () => {
  const g = fakeGame({ restoreGpu() { throw new Error('no'); } }); const env = fakeEnv();
  const lc = make(g, env);
  lc.lost(); lc.restored();
  assert.equal(lc.state, 'reload');
});

test('back from the back/forward cache with a lost context shows the card', () => {
  const g = fakeGame(); const env = fakeEnv();
  const lc = make(g, env);
  g.setLost(true);
  env.win.fire('pageshow', { persisted: true });
  assert.equal(lc.state, 'lost');
  g.setLost(false);
  const g2 = fakeGame(); const env2 = fakeEnv();
  const lc2 = make(g2, env2);
  env2.win.fire('pageshow', { persisted: true });
  assert.equal(lc2.state, 'ok');
  assert.equal(g2._pauseDrawn, false, 'the menu background is drawn again');
});

test('playing marks the tab live and keeps the resume slot fresh', () => {
  const g = fakeGame(); const env = fakeEnv();
  const lc = make(g, env);
  lc.update();
  assert.equal(env.map.get(LIVE_KEY), '1');
  assert.ok(g.save.data.resume);
});

// ---------------------------------------------------------------- wake lock
function fakeWakeLock({ refuse = 0 } = {}) {
  const wl = { asked: 0, released: 0, locks: [] };
  wl.request = () => {
    wl.asked++;
    if (refuse-- > 0) return Promise.reject(new Error('NotAllowedError'));
    const lock = new Target();
    lock.release = () => { wl.released++; lock.fire('release'); return Promise.resolve(); };
    wl.locks.push(lock);
    return Promise.resolve(lock);
  };
  return wl;
}
const tick = () => new Promise(r => setImmediate(r));

test('the wake lock is asked for once while playing and let go on pause', async () => {
  const g = fakeGame(); const env = fakeEnv(); const wl = fakeWakeLock();
  const lc = make(g, env, { wakeLock: wl });
  lc.update(); lc.update();
  await tick();
  lc.update();
  assert.equal(wl.asked, 1);
  assert.ok(lc.lock);
  g.paused = true; lc.update();
  assert.equal(wl.released, 1);
  assert.equal(lc.lock, null);
});

test('the browser dropping the lock on hide: asked for again when play resumes', async () => {
  const g = fakeGame(); const env = fakeEnv(); const wl = fakeWakeLock();
  const lc = make(g, env, { wakeLock: wl });
  lc.update(); await tick();
  wl.locks[0].fire('release'); // the browser let it go
  assert.equal(lc.lock, null);
  lc.update(); await tick();
  assert.equal(wl.asked, 2);
  assert.ok(lc.lock);
});

test('a refused wake lock is tried again only after 5 s', async () => {
  const g = fakeGame(); const env = fakeEnv(); const wl = fakeWakeLock({ refuse: 1 });
  const lc = make(g, env, { wakeLock: wl });
  lc.update(); await tick();
  env.clock.add(1000); lc.update(); await tick();
  assert.equal(wl.asked, 1);
  env.clock.add(4500); lc.update(); await tick();
  assert.equal(wl.asked, 2);
  assert.ok(lc.lock);
});

test('no Wake Lock API, a throwing one, or the setting off: nothing breaks, nothing is asked', async () => {
  const g = fakeGame(); const env = fakeEnv();
  const lc = make(g, env, {});
  lc.update();
  const lc2 = make(fakeGame(), fakeEnv(), { wakeLock: { request() { throw new Error('iOS standalone'); } } });
  lc2.update();
  const wl = fakeWakeLock();
  const off = fakeGame(); off.save.data.settings.awake = false;
  make(off, fakeEnv(), { wakeLock: wl }).update();
  await tick();
  assert.equal(wl.asked, 0);
  assert.equal(lc.lock, null); assert.equal(lc2.lock, null);
});

test('no wake lock while the GPU card is up', async () => {
  const g = fakeGame(); const env = fakeEnv(); const wl = fakeWakeLock();
  const lc = make(g, env, { wakeLock: wl });
  lc.lost();
  g.paused = false; // even if something unpaused underneath
  lc.update(); await tick();
  assert.equal(wl.asked, 0);
});
