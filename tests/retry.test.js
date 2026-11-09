import { test } from 'node:test';
import assert from 'node:assert/strict';
import { world } from './helpers.js';
import { Missions, Steps, topUpInventory } from '../src/game/missions.js';
import { STORY } from '../src/game/story.js';
import { Jobs } from '../src/game/jobs.js';
import { RetryCard } from '../src/ui/retry.js';
import { AMMO } from '../src/game/weapon-data.js';
import { VEHICLE_TYPES } from '../src/actors/vehicle-types.js';

/** A game on the real roads, with plain-object vehicles, people, police, sky and save. */
function fakeGame() {
  const { net, city } = world();
  const hud = { big() {}, objective() {}, setTimer() {}, subtitle() {}, clearSubtitle() {}, help() {}, toast() {}, bark() {}, route: null, blipList: [] };
  let ids = 1;
  const vehicles = {
    list: [],
    spawn(type, x, z, heading, o = {}) {
      const L = VEHICLE_TYPES[type]?.L ?? 4;
      const v = { id: ids++, type, x, z, y: 0, heading, vx: 0, vz: 0, w: 0, role: o.role, color: o.color, hd: L / 2, health: 1000, passengers: [],
        spec: { top: 30, colors: [0xffffff] }, driver: o.driver ? { outfit: { flags: new Set() } } : null };
      this.list.push(v);
      return v;
    },
    remove(v) { const i = this.list.indexOf(v); if (i >= 0) this.list.splice(i, 1); v.removed = true; },
    addPassenger(v, outfit) { v.passengers.push(outfit); },
  };
  const peds = {
    list: [],
    _make(h, x, z) { const p = { h, x, z, state: 'walk' }; this.list.push(p); return p; },
    remove(p) { const i = this.list.indexOf(p); if (i >= 0) this.list.splice(i, 1); },
    _resnap() {},
  };
  const player = {
    x: 0, z: 0, heading: 0, vehicle: null, state: 'foot', health: 40, maxHealth: 100, human: { yaw: 0 },
    get pos() { return this.vehicle || this; },
    teleport(x, z, h) { if (this.vehicle) this.vehicle = null; this.x = x; this.z = z; this.heading = h; this.state = 'foot'; },
    enterVehicle(v) { this.vehicle = v; v.role = 'player'; this.state = 'driving'; },
    leaveVehicle() { this.vehicle = null; this.state = 'foot'; },
  };
  const g = {
    time: 0, hud, controls: new Map(), cutscene: false, respawning: false, net, city, colliders: { blocked: () => false },
    input: { mode: 'touch', pressed: () => false }, player, vehicles, peds,
    humans: { add: (outfit, x, z) => ({ x, z, outfit, yaw: 0 }), remove() {} },
    police: { level: 0, setLevels: [], lock: false, setLevel(l) { this.setLevels.push([l, g.missions?.replaying]); this.level = l; }, clear() { this.level = 0; } },
    save: { data: {}, set(k, v) { this.data[k] = v; }, flush() {}, stat(k) { this.stats[k] = (this.stats[k] || 0) + 1; }, stats: {}, done: () => false, complete() {}, cash: 1000, dirty() {} },
    sky: { hours: 17, weather: 'clear', setWeather(w) { this.weather = w; }, update() {} },
    camera: { cinematic: null, playShot() {}, endShot() {}, reset() {} }, effects: { markers: { set() {} } },
    addCash() {}, onWantedChange() {},
  };
  return g;
}

/** Missions on the fake game, with a driver that does nothing (no AI needed to replay). */
function missionsFor(g, defs = STORY) {
  const ms = new Missions(g, defs);
  const ctx = ms._ctx.bind(ms);
  ms._ctx = m => { const c = ctx(m); c.driver = () => ({ setPath() {}, control: () => ({}), done: false }); return c; };
  g.missions = ms;
  return ms;
}

test('every checkpoint of every story mission can be retried to, and puts the player where it says', () => {
  let total = 0;
  for (const def of STORY) {
    const steps = def.steps(fakeGame());
    const ks = steps.map((s, i) => s.kind === 'checkpoint' ? i : -1).filter(i => i >= 0);
    assert.ok(ks.length >= 1, `${def.id} has a checkpoint`);
    for (const [n, k] of ks.entries()) {
      const g = fakeGame(), ms = missionsFor(g);
      const errors = [];
      const err = console.error;
      console.error = (...a) => errors.push(a);
      try {
        ms.retryOffer = { id: def.id, cp: { k, n: n + 1, total: ks.length, label: steps[k].label, hours: 9.5, weather: 'rain', inv: null } };
        ms.retry();
        for (let t = 0; t < 3; t++) ms.update(0.1);
      } finally { console.error = err; }
      const where = `${def.id} checkpoint ${n + 1} (${steps[k].label})`;
      assert.deepEqual(errors, [], `${where}: no script error`);
      const m = ms.active;
      assert.ok(m && m.def === def, `${where}: running`);
      assert.ok(m.i > k, `${where}: on past the checkpoint (at ${m.i})`);
      assert.equal(m.cp.k, k, `${where}: a second failure retries from here too`);
      const o = steps[k].opts;
      if (o.vehicle) assert.equal(g.player.vehicle, m.ent[o.vehicle], `${where}: seated in ${o.vehicle}`);
      const at = typeof o.at === 'function' ? o.at(m.ctx) : o.at, me = g.player.pos;
      if (at) assert.ok(Math.hypot(me.x - at.x, me.z - at.z) < 60, `${where}: put back near the checkpoint (${Math.hypot(me.x - at.x, me.z - at.z).toFixed(0)} m)`);
      for (const name of Object.keys(o.park || {})) assert.ok(m.ent[name], `${where}: ${name} parked`);
      for (const name of o.hunters || []) assert.ok(m.ent[name]?.hunt, `${where}: ${name} hunting`);
      assert.ok(g.police.setLevels.every(([, replaying]) => !replaying), `${where}: no WANTED from steps already played`);
      assert.equal(g.respawning, false);
      assert.equal(g.sky.hours, 9.5);
      assert.equal(g.sky.weather, 'rain');
      assert.equal(g.player.health, 100);
      total++;
    }
  }
  assert.ok(total >= 20, `${total} checkpoints`);
});

test('retrying again and again leaks nobody and no car: one Shera, one of each car', () => {
  const g = fakeGame(), ms = missionsFor(g);
  const def = STORY.find(d => d.id === 'c8');
  const k = def.steps(g).findLastIndex(s => s.kind === 'checkpoint');
  const counts = [];
  for (let r = 0; r < 5; r++) {
    ms.retryOffer = { id: 'c8', cp: { k, n: 2, total: 2, label: 'x' } };
    ms.retry();
    ms.update(0.1);
    counts.push([g.vehicles.list.length, g.peds.list.length]);
    ms.fail('Shera got away.');
  }
  assert.ok(counts.every(c => c[0] === counts[0][0] && c[1] === counts[0][1]), JSON.stringify(counts));
  assert.equal(g.vehicles.list.filter(v => v.type === 'bike').length, 1, 'one Shera bike');
});

test('a live checkpoint is remembered; a fail offers it, a script error offers the start', () => {
  const g = fakeGame(), ms = missionsFor(g, []);
  let helped = 0;
  g.hud.help = () => helped++;
  const def = { id: 'x', giver: 'PAKYA', start: { x: 0, z: 0 }, steps: () => [
    Steps.call(c => c.spawnPed('goon', 'goon', 3, 0)),
    Steps.checkpoint('the chowk'),
    Steps.call(c => c.g.police.setLevel(2), { replay: false }),
    Steps.wait(9),
  ] };
  ms.defs.push(def); ms._byId = null;
  g.sky.hours = 6; g.sky.weather = 'fog';
  ms.start('x');
  for (let t = 0; t < 4; t++) ms.update(0.1);
  assert.equal(ms.active.cp.k, 1);
  assert.equal(ms.active.cp.hours, 6);
  assert.equal(g.save.data.seenRetryHelp, true);
  assert.equal(helped, 1, 'the help line, once');
  assert.equal(g.police.level, 2);
  g.sky.hours = 23; g.sky.weather = 'clear'; g.player.health = 5;
  ms.fail('Gone.');
  assert.equal(ms.retryOffer.cp.k, 1);
  assert.equal(ms.retryOffer.reason, 'Gone.');
  // RETRY: police off, hours back, the first goon gone and one fresh one, the live-only call skipped.
  g.police.setLevels.length = 0;
  ms.retry();
  assert.equal(g.peds.list.length, 1, 'no second goon');
  assert.equal(g.sky.hours, 6); assert.equal(g.sky.weather, 'fog');
  assert.equal(g.respawning, false); assert.equal(g.cutscene, false);
  assert.equal(g.save.stats.retries, 1);
  assert.equal(ms.active.i, 2, 'live again from the step after the checkpoint');
  assert.deepEqual(g.police.setLevels, [[2, false]], 'the live call runs once, live; its replay is skipped');
  // A script error: offered from the start.
  ms.active.steps[ms.active.i + 1] = { update() { throw new Error('boom'); } };
  const err = console.error; console.error = () => {};
  try { for (let t = 0; t < 3; t++) ms.update(0.1); } finally { console.error = err; }
  assert.equal(ms.active, null);
  assert.equal(ms.retryOffer.cp.k, -1);
});

test('the pause menu retry drops the attempt and restarts from the checkpoint', () => {
  const g = fakeGame(), ms = missionsFor(g);
  ms.start('c2');
  assert.equal(ms.canRetry, true);
  for (let t = 0; t < 3; t++) ms.update(0.1);
  assert.ok(ms.retryActive());
  assert.ok(ms.active && ms.active.def.id === 'c2');
  assert.equal(ms.active.tries, 2);
  assert.equal(g.respawning, false);
});

test('fail shows the card unless WASTED or BUSTED is up; the card waits, then retries or quits', () => {
  const g = fakeGame(), ms = missionsFor(g);
  const offers = [];
  g.retryCard = { offer: o => { offers.push(o); g.respawning = true; } };
  ms.start('c1');
  ms.fail('x');
  assert.equal(offers.length, 1);
  assert.equal(offers[0].from, 'the start');
  offers[0].onQuit();
  assert.equal(g.respawning, false);
  assert.equal(ms.retryOffer, null);
  // During a death the card waits for rules to show it.
  ms.cooldown = 0; ms.start('c1');
  g.respawning = true;
  ms.fail('You were wasted.');
  assert.equal(offers.length, 1);
  let respawned = 0;
  assert.ok(ms.offerRetry(() => { respawned++; g.respawning = false; }));
  offers[1].onRetry();
  assert.equal(respawned, 0);
  assert.ok(ms.active);
  assert.equal(g.respawning, false);
});

test('fight and chase replays leave the beaten gone and the caught car removed', () => {
  const g = fakeGame(), ms = missionsFor(g, []);
  const m = { ent: {}, vars: {}, steps: [], time: 0 };
  m.ctx = ms._ctx(m);
  const p = g.peds._make({}, 0, 0);
  const car = g.vehicles.spawn('hatch', 0, 0, 0, {}), bike = g.vehicles.spawn('bike', 9, 0, 0, {});
  car.vital = true;
  Object.assign(m.ent, { g0: p, car, bike });
  Steps.fight(['g0', 'nobody'], 'Fight').replay(m.ctx);
  assert.equal(m.ent.g0, undefined); assert.equal(g.peds.list.length, 0);
  Steps.chase('bike', { x: 0, z: 0 }, 'Chase', { driverAs: 'man' }).replay(m.ctx);
  assert.equal(m.ent.bike, undefined); assert.ok(bike.removed);
  assert.equal(car.vital, false);
  assert.equal(m.ent.man, undefined);
});

test('ammo after a retry is topped up to the checkpoint, never taken away, and capped', () => {
  const w = { inv: new Set(['fist', 'p92']), mags: { p92: 3 }, ammo: { '9mm': 50 } };
  const cal = Object.keys(AMMO).find(k => k !== '9mm' && k !== 'frag');
  topUpInventory(w, { weapons: ['p92', 'akm'], mags: { p92: 15, akm: 999 }, ammo: { '9mm': 20, [cal]: 1e6, frag: 2 } });
  assert.equal(w.mags.p92, 15, 'the magazine back to full');
  assert.equal(w.ammo['9mm'], 50, 'loot picked up since is kept');
  assert.equal(w.ammo[cal], AMMO[cal].max);
  assert.ok(w.inv.has('grenade') && w.inv.has('akm'));
  assert.ok(w.mags.akm <= 40);
  assert.equal(w._dirty, true);
});

test('a lost street race offers a retry: the wrecked car comes back fresh on the grid with 3 new rivals', () => {
  const g = fakeGame();
  g.DynamicDriver = class { constructor() {} setPath() {} control() { return {}; } };
  g.missions = { active: null };
  const jobs = new Jobs(g);
  const race = jobs.races[0];
  const car = g.vehicles.spawn('hatch', race.start.x, race.start.z, 0, { role: 'player', color: 0x123456 });
  g.player.enterVehicle(car);
  jobs._startRace(race);
  const firstRivals = [...jobs.active.rivals];
  assert.equal(firstRivals.length, 3);
  const offers = [];
  g.retryCard = { offer: o => { offers.push(o); g.respawning = true; } };
  car.wrecked = true;
  firstRivals[0].raceIdx = race.points.length; // a rival wins
  jobs.active.t = 1;
  jobs.update(0.1);
  assert.equal(jobs.active, null);
  assert.equal(offers.length, 1);
  assert.equal(offers[0].from, 'the grid');
  offers[0].onRetry();
  assert.equal(jobs.active?.kind, 'race');
  assert.equal(jobs.active.rivals.length, 3);
  assert.ok(firstRivals.every(r => !g.vehicles.list.includes(r)), 'the old rivals are gone');
  const v = g.player.vehicle;
  assert.ok(v && v !== car && v.type === 'hatch' && v.color === 0x123456, 'a fresh car of the same kind');
  assert.equal(g.respawning, false);
});

test("Anna's respray hands the car to the garage's repair too", () => {
  const g = fakeGame();
  g.missions = { active: null };
  const jobs = new Jobs(g);
  const v = g.vehicles.spawn('hatch', 0, 0, 0, {});
  v.health = 200; g.player.vehicle = v; g.police.level = 2; g.police.seen = false;
  let repaired = null;
  g.garage = { repair: x => { repaired = x; } };
  jobs._respray();
  assert.equal(repaired, v);
  assert.equal(v.health, 1000);
});

function fakeDoc() {
  const el = () => {
    const kids = {};
    const e = {
      hidden: false, children: [], listeners: {}, textContent: '', attrs: {},
      classList: { s: new Set(), add(c) { this.s.add(c); }, remove(...c) { for (const x of c) this.s.delete(x); }, contains(c) { return this.s.has(c); } },
      addEventListener(t, f) { (this.listeners[t] ||= []).push(f); },
      setAttribute(k, v) { this.attrs[k] = v; },
      appendChild(c) { this.children.push(c); return c; },
      set innerHTML(v) { this._html = v; },
      querySelector(sel) { return kids[sel] ||= el(); },
      click() { for (const f of this.listeners.click || []) f(); },
    };
    return e;
  };
  return { head: el(), body: el(), getElementById: () => null, createElement: el };
}

test('the retry card holds the game until a choice; it takes a tap, Enter or a gamepad button', () => {
  const g = { input: { pressed: () => false } }, doc = fakeDoc(), card = new RetryCard(g, doc);
  let retried = 0, quit = 0;
  card.offer({ from: "Savkar's office (1/2)", onRetry: () => retried++, onQuit: () => quit++ });
  assert.equal(g.respawning, true);
  assert.ok(doc.body.classList.contains('retry-choice'), 'the touch controls hide');
  assert.equal(card.root.querySelector('.retry-from').textContent, "From: Savkar's office (1/2)");
  card.update(); // not before the buttons show
  card._reveal();
  card.root.querySelector('.retry-go').click();
  assert.equal(retried, 1);
  assert.ok(!doc.body.classList.contains('retry-choice'));
  card.root.querySelector('.retry-go').click();
  assert.equal(retried, 1, 'once only');
  card.offer({ onRetry: () => retried++, onQuit: () => quit++ });
  card._reveal();
  g.input.pressed = a => a === 'pause';
  card.update();
  assert.deepEqual([retried, quit], [1, 1]);
  card.offer({ onRetry: () => retried++, onQuit: () => quit++ });
  card._reveal();
  card._onKey({ code: 'Enter', preventDefault() {} });
  assert.deepEqual([retried, quit], [2, 1]);
  card.close();
});
