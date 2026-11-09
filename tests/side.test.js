import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Missions, Steps } from '../src/game/missions.js';
import { STORY, STORY_PLACES, HOME, CHARACTERS } from '../src/game/story.js';
import { SIDE, SIDE_PLACES, SIDE_CHARACTERS, sideUnlockText } from '../src/game/side.js';
import { tailTick, routeProgress, pathLengths, pointAlong, settle, installSideSteps, gunnerFire, tail, escort, defend } from '../src/game/side-steps.js';
import { WEAPONS, NO_FIRE } from '../src/game/weapon-data.js';
import { world } from './helpers.js';

const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

/** A driver that slides its vehicle along the path (or at a target) at maxSpeed. */
class FakeDriver {
  constructor(g, v, { maxSpeed = 20 } = {}) { this.v = v; this.maxSpeed = maxSpeed; this.path = null; this.i = 1; }
  setPath(p) { this.path = p; this.i = 1; }
  get done() { return !this.path || this.i >= this.path.length / 2 - 1; }
  control(dt, target = null) {
    const v = this.v;
    let tx, tz;
    if (target) { tx = target.x; tz = target.z; } else {
      if (!this.path) return {};
      while (this.i < this.path.length / 2 - 1 && Math.hypot(this.path[this.i * 2] - v.x, this.path[this.i * 2 + 1] - v.z) < 2) this.i++;
      tx = this.path[this.i * 2]; tz = this.path[this.i * 2 + 1];
    }
    const d = Math.hypot(tx - v.x, tz - v.z), s = Math.min(d, this.maxSpeed * dt);
    if (d > 1e-6) { v.x += (tx - v.x) / d * s; v.z += (tz - v.z) / d * s; }
    return {};
  }
}

function fakeGame(realNet = true) {
  const meters = [];
  const net = realNet ? world().net : { route: () => null, nearest: () => null, raised: [] };
  let id = 1;
  const g = {
    time: 0, controls: new Map(), cutscene: false, quality: { tier: 'high' }, meters,
    hud: { big() {}, objective() {}, setTimer() {}, subtitle() {}, clearSubtitle() {}, help() {}, route: null, meter: (v, l) => meters.push([v, l]) },
    player: { pos: { x: 0, z: 0 }, x: 0, z: 0, vehicle: null, speed: 0, heading: 0 },
    net,
    vehicles: {
      list: [],
      spawn(type, x, z, heading, opts) {
        const v = { id: id++, type, x, z, heading, y: 0, spec: { top: 20, H: 1.5 }, health: 1000, hd: 2, hw: 1, role: opts.role, driver: opts.driver ? { outfit: { flags: new Set() } } : null };
        this.list.push(v); return v;
      },
      remove(v) { this.list.splice(this.list.indexOf(v), 1); },
    },
    humans: { add: (outfit, x, z) => ({ outfit, x, z, yaw: 0, pose: 'idle' }), remove() {} },
    peds: { list: [], _make(h) { const p = { h, state: 'walk', hits: 0, t: 0 }; this.list.push(p); return p; }, remove(p) { this.list.splice(this.list.indexOf(p), 1); } },
    police: { level: 0, setLevel() {}, lock: false },
    camera: { cinematic: null, playShot() {}, endShot() {} }, effects: { markers: { set() {} } },
    weapons: { lastShotT: -99, given: [], give(i, a) { this.given.push([i, a]); return true; }, toSave() { return { inv: this.given.map(x => x[0]) }; } },
    addCash() {},
  };
  const done = new Set();
  g.save = { data: { stamps: [] }, done: i => done.has(i), complete: i => done.add(i), flush() {}, set(k, v) { this.data[k] = v; }, doneSet: done };
  return g;
}

class TestMissions extends Missions {
  _ctx(m) { const c = super._ctx(m); c.driver = (v, o) => new FakeDriver(this.game, v, o); return c; }
}
/** A bare step context (no mission running) for exercising one step. */
function ctxFor(g) {
  const ms = new TestMissions(g, []);
  const m = { ent: {}, vars: {}, target: null, timer: null, steps: [], time: 0, def: {} };
  m.ctx = ms._ctx(m);
  return m.ctx;
}

test('six side jobs, fresh ids, requirements that exist, contacts with their own letters, real guns as rewards', () => {
  assert.equal(SIDE.length, 6);
  const story = new Set(STORY.map(m => m.id)), all = new Set([...story, ...SIDE.map(m => m.id)]);
  for (const m of SIDE) {
    assert.match(m.id, /^s\d$/);
    assert.ok(!story.has(m.id));
    assert.ok(m.side);
    for (const r of m.requires) assert.ok(all.has(r), `${m.id} requires ${r}`);
    assert.ok(CHARACTERS[m.giver]?.initial, `${m.id}: ${m.giver} has a radar letter`);
    if (m.weapon) { assert.ok(WEAPONS[m.weapon.id], m.weapon.id); assert.equal(typeof m.onPass, 'function'); }
    const kinds = m.steps({}).map(s => s.kind);
    assert.ok(kinds.some(k => k === 'tail' || k === 'escort' || k === 'defend'), `${m.id}: ${kinds}`);
  }
  const story0 = new Set(STORY.map(m => CHARACTERS[m.giver]?.initial));
  const givers = [...new Set(SIDE.map(m => m.giver))];
  const initials = givers.map(k => SIDE_CHARACTERS[k].initial);
  assert.equal(new Set(initials).size, initials.length);
  for (const i of initials) assert.ok(!story0.has(i), `${i} is not a story contact's letter`);
  assert.match(sideUnlockText(SIDE[0]), /Dhondu Jadhav<\/b> \(D\)/);
  assert.equal(installSideSteps(Steps).tail, tail);
});

test('every side line is spoken by a known character and is short enough to read', () => {
  let n = 0;
  for (const m of SIDE) for (const s of m.steps({})) {
    const lines = [...(s.lines || []), ...(s.route || []).flatMap(p => p.lines || []), ...(s.opts?.ambush || []).flatMap(w => w.lines || []), ...(s.opts?.waves || []).flatMap(w => w.lines || [])];
    for (const [who, text] of lines) { assert.ok(CHARACTERS[who], `${m.id}: ${who}`); assert.ok(text.length < 200); n++; }
  }
  assert.ok(n > 30, `${n} lines`);
});

test('side places are on roads, starts clear of story starts and home, and well away from places of worship', () => {
  const { net, data } = world();
  for (const [name, p] of Object.entries(SIDE_PLACES)) {
    const r = net.nearest(p.x, p.z, 60, {}, rd => !net.raised[rd]);
    assert.ok(r && Math.hypot(r.x - p.x, r.z - p.z) < 25, `${name} by a road`);
    for (const [id, rad] of Object.entries(NO_FIRE)) {
      const h = data.places.find(q => q.id === id);
      if (h) assert.ok(dist(p, h) >= rad + 60, `${name} is ${dist(p, h).toFixed(0)} m from ${id}`);
    }
  }
  const n = net.nearest(HOME.x, HOME.z, 30, {}), spawn = { x: HOME.x + n.dz * 4, z: HOME.z - n.dx * 4 };
  const starts = [...STORY.map(m => m.start), spawn, STORY_PLACES.zenda];
  for (const m of SIDE) {
    for (const s of starts) assert.ok(dist(m.start, s) >= 6, `${m.id} starts ${dist(m.start, s).toFixed(1)} m from a story start`);
    for (const o of SIDE) if (o !== m) assert.ok(dist(m.start, o.start) >= 6, `${m.id} and ${o.id} start apart`);
    for (const [id, rad] of Object.entries(NO_FIRE)) {
      const h = data.places.find(q => q.id === id);
      if (h) assert.ok(dist(m.start, h) >= rad + 60, `${m.id} start near ${id}`);
    }
  }
});

test('suspicion: crowding fills it, a shot fills it at once, a safe distance lets it fall, too far loses them', () => {
  let s = { sus: 0 };
  for (let k = 0; k < 200 && !s.result; k++) tailTick(s, { d: 6 }, 0.1);
  assert.equal(s.result, 'spotted');
  s = { sus: 0.6 };
  for (let k = 0; k < 50; k++) tailTick(s, { d: 40 }, 0.1);
  assert.ok(s.sus < 0.6 && !s.result);
  assert.equal(tailTick({ sus: 0 }, { d: 40, shot: true }, 0.1).result, 'spotted');
  s = { sus: 0 };
  for (let k = 0; k < 80; k++) tailTick(s, { d: 120 }, 0.1);
  assert.equal(s.result, 'lost');
});

test('route helpers: lengths, progress and points along a path', () => {
  const path = [0, 0, 0, 100, 100, 100], lens = pathLengths(path);
  assert.deepEqual(lens, [0, 100, 200]);
  assert.equal(routeProgress(lens, path, 1, 0, 50), 0.25);
  assert.equal(routeProgress(lens, path, 2, 50, 100), 0.75);
  const p = pointAlong(lens, path, 150);
  assert.deepEqual([p.x, p.z], [50, 100]);
});

test('a tail fails when you fall too far back, and passes when they arrive with you at a distance', () => {
  for (const far of [true, false]) {
    const g = fakeGame(false), c = ctxFor(g);
    c.spawnVehicle('t', 'scooter', 0, 0, 0, { driver: true });
    const st = tail('t', [{ x: 0, z: 300 }], 'Follow.');
    st.enter(c);
    let r = null;
    for (let k = 0; k < 2000 && !r; k++) {
      const v = c.ent.t;
      g.player.pos.x = v.x; g.player.pos.z = far ? -200 : v.z - 40;
      r = st.update(c, 0.1);
    }
    st.exit(c);
    if (far) assert.match(r, /^fail:You lost them/); else assert.equal(r, 'done');
    assert.deepEqual(g.meters.at(-1), [null, undefined], 'the meter is hidden at the end');
  }
  // A shot fired close by: spotted.
  const g = fakeGame(false), c = ctxFor(g);
  c.spawnVehicle('t', 'scooter', 0, 0, 0, { driver: true });
  const st = tail('t', [{ x: 0, z: 300 }], 'Follow.');
  st.enter(c);
  g.player.pos.z = -40; g.time = 5; g.weapons.lastShotT = 6;
  assert.match(st.update(c, 0.1), /^fail:They spotted you/);
});

test('an escort fails when the convoy is wrecked, sends ambush waves at their points, and ends at the destination', () => {
  const g = fakeGame(false), c = ctxFor(g);
  c.spawnVehicle('cv', 'tempo', 0, 0, 0, { driver: true, label: 'papad tempo' });
  const st = escort('cv', [{ x: 0, z: 400 }], 'Escort.', { ambush: [{ at: 0.25, bikes: 2 }, { at: 0.6, bikes: 3, gunner: 'p92' }] });
  st.enter(c);
  const waveAt = [];
  let r = null, seen = 0;
  for (let k = 0; k < 4000 && !r; k++) {
    g.player.pos.x = c.ent.cv.x + 10; g.player.pos.z = c.ent.cv.z;
    r = st.update(c, 0.1);
    const n = Object.values(c.ent).filter(e => e?.ambush).length;
    if (n !== seen) { waveAt.push(Math.round(c.ent.cv.z)); seen = n; }
  }
  assert.equal(r, 'done');
  assert.equal(waveAt.length, 2);
  assert.ok(Math.abs(waveAt[0] - 100) < 5 && Math.abs(waveAt[1] - 240) < 5, `waves at ${waveAt}`);
  assert.equal(Object.values(c.ent).filter(e => e?.huntTarget === c.ent.cv).length, 4, 'four at most at once');
  st.exit(c);
  assert.ok(!Object.values(c.ent).some(e => e?.ambush), 'the ambushers let go at the end');
  // Wrecked.
  const g2 = fakeGame(false), c2 = ctxFor(g2);
  c2.spawnVehicle('cv', 'tempo', 0, 0, 0, { driver: true, label: 'papad tempo' });
  const st2 = escort('cv', [{ x: 0, z: 400 }], 'Escort.');
  st2.enter(c2);
  c2.ent.cv.wrecked = true;
  assert.equal(st2.update(c2, 0.1), 'fail:The papad tempo was wrecked.');
  // A convoy waits for you, and leaving it behind fails.
  const g3 = fakeGame(false), c3 = ctxFor(g3);
  c3.spawnVehicle('cv', 'tempo', 0, 0, 0, { driver: true });
  const st3 = escort('cv', [{ x: 0, z: 400 }], 'Escort.');
  st3.enter(c3);
  g3.player.pos.x = 500;
  let r3 = null, k3 = 0;
  for (; k3 < 400 && !r3; k3++) r3 = st3.update(c3, 0.1);
  assert.equal(c3.ent.cv.z, 0, 'it waited');
  assert.match(r3, /^fail:You left/);
});

test('a pillion gunner fires at the convoy or the player, only close and only every second or so', () => {
  let hits = 0, hurt = 0;
  const g = { player: { pos: { x: 0, z: 0 }, vehicle: null, damage: () => hurt++ }, damageVehicle: () => hits++ };
  const a = { x: 0, z: 10, gunner: 'p92', fireT: 0 }, cv = { x: 0, z: 20 };
  assert.equal(gunnerFire(g, a, cv, 0.1, () => 0.1), 'convoy');
  assert.equal(gunnerFire(g, a, cv, 0.1, () => 0.1), null, 'not again straight away');
  a.fireT = 0;
  assert.equal(gunnerFire(g, a, cv, 0.1, () => 0.9), 'player');
  a.fireT = 0; a.z = 100;
  assert.equal(gunnerFire(g, a, cv, 0.1, () => 0.1), null, 'out of range');
  assert.deepEqual([hits, hurt], [1, 1]);
});

test('defend: waves one after another, the cart can be smashed, leaving fails, the beaten never die', () => {
  const run = (mode) => {
    const g = fakeGame(false), c = ctxFor(g);
    const st = defend({ x: 0, z: 0 }, 'Hold.', { waves: [{ n: 3 }, { n: 4 }, { n: 2, armed: 'p92', boss: { name: 'boss', hits: 4 } }] });
    st.enter(c);
    const sizes = [];
    let r = null;
    for (let k = 0; k < 3000 && !r; k++) {
      if (mode === 'leave') g.player.pos.x = 100;
      if (mode === 'idle') g.player.pos.x = 25; // near, but not stopping them
      r = st.update(c, 0.1);
      const live = g.peds.list.filter(p => !p.settled);
      if (mode === 'win' && live.length) { sizes.push(live.length); for (const p of live) p.hits = p.needHits; }
    }
    return { r, sizes, g, c };
  };
  const win = run('win');
  assert.equal(win.r, 'done');
  assert.deepEqual(win.sizes, [3, 4, 3]);
  assert.ok(win.g.peds.list.every(p => p.state !== 'dead' && p.grudge === 0 && !p.armed));
  assert.equal(win.c.ent.boss.needHits, 4);
  assert.match(run('idle').r, /^fail:They smashed the cart/);
  assert.match(run('leave').r, /^fail:You left/);
  const p = settle({ state: 'down', grudge: 3, armed: 'uzi' });
  assert.equal(p.after, 'cower');
});

test('the Fast tier caps a wave at three', () => {
  const g = fakeGame(false), c = ctxFor(g);
  g.quality.tier = 'low';
  const st = defend({ x: 0, z: 0 }, 'Hold.', { waves: [{ n: 4 }] });
  st.enter(c);
  for (let k = 0; k < 30; k++) st.update(c, 0.1);
  assert.equal(g.peds.list.length, 3);
});

test('every side job plays through to MISSION PASSED in a dry run, and the gun rewards are saved', () => {
  for (const def of SIDE) {
    const g = fakeGame(true), ms = new TestMissions(g, SIDE);
    g.missions = ms;
    for (const r of def.requires) g.save.complete(r);
    const s = def.start;
    g.player.pos.x = g.player.x = s.x; g.player.pos.z = g.player.z = s.z;
    ms.start(def.id);
    assert.ok(ms.active, `${def.id} started`);
    let k = 0;
    for (; k < 40000 && ms.active === ms.active && ms.active; k++) {
      const m = ms.active, step = m.steps[m.i];
      if (step?.kind === 'tail') { const e = m.ent[step.name], ex = e.h ? e.h.x : e.x, ez = e.h ? e.h.z : e.z; g.player.pos.x = ex + 35; g.player.pos.z = ez; }
      if (step?.kind === 'escort') { const v = m.ent[step.name]; g.player.pos.x = v.x + 15; g.player.pos.z = v.z; }
      if (step?.kind === 'defend') { g.player.pos.x = step.stall.x; g.player.pos.z = step.stall.z; for (const p of g.peds.list) if (p.needHits && !p.settled) p.hits = p.needHits; }
      g.time += 0.25;
      ms.update(0.25);
    }
    assert.ok(k > 100, `${def.id} took ${k} frames`);
    assert.ok(g.save.done(def.id), `${def.id} passed (stopped at step ${ms.active?.i}: ${ms.active?.steps[ms.active.i]?.kind})`);
    if (def.weapon) {
      assert.deepEqual(g.weapons.given.at(-1), [def.weapon.id, def.weapon.ammo]);
      assert.ok(g.save.data.inventory.inv.includes(def.weapon.id), 'saved with the pass');
    }
    assert.equal(g.police.lock, false, 'the police lock is lifted after');
  }
});
