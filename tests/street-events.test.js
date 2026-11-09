// Street events: the director's gates and timing, offers, rewards, and places on the real map.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  StreetEvents, EVENTS, pick, rideReward, examReward, beatScore, blockedWhy, quietHours,
  kerbSpot, hospitalFor, classFor, OFFER_LOSE_DIST,
} from '../src/game/street-events.js';
import { world } from './helpers.js';
import { dist, rng } from '../src/core/math.js';

const seeded = (s = 1) => rng(s);

/** A fake game whose missions object speaks the C4 draft/adopt/discard API. */
function fakeGame({ hours = 12, freeRoam = true, place = true } = {}) {
  const log = { drafted: [], adopted: [], discarded: [], toasts: [], subs: [], complete: [] };
  const g = {
    time: 0, freeRoam, cutscene: false, respawning: false,
    sky: { hours, weather: 'clear' },
    player: { pos: { x: 0, z: 0 }, vehicle: { x: 0, z: 0 }, health: 50, heal(a) { this.health += a; } },
    police: { level: 0, pending: [] },
    jobs: { active: null },
    hud: { toast: t => log.toasts.push(t), subtitle: (w, t) => log.subs.push(t), help() {} },
    save: {
      data: { events: { done: { snatch: 0, injured: 0, exam: 0, baraat: 0, pickpocket: 0 }, izzat: 0 }, stats: { events: 0 }, story: [] },
      done(id) { return this.data.story.includes(id); },
      complete(id) { log.complete.push(id); },
      stat(k, d = 1) { this.data.stats[k] = (this.data.stats[k] || 0) + d; },
      set(k, v) { this.data[k] = v; }, dirty() {},
    },
    cash: 0,
    addCash(d) { this.cash += d; },
    missions: {
      active: null,
      draft(def) { const m = { def, vars: {}, ent: {} }; m.ctx = { vars: m.vars, ent: m.ent }; log.drafted.push(m); return m; },
      adopt(m) { this.active = m; log.adopted.push(m); },
      discard(m) { log.discarded.push(m); },
    },
  };
  g.log = log;
  // Every kind places at a fixed spot 80 m east and sets up nothing (the real ones need a map).
  if (place) for (const k of Object.keys(EVENTS)) {
    const E = EVENTS[k];
    E._real ??= { place: E.place, setup: E.setup, needs: E.needs, engaged: E.engaged };
    E.place = () => ({ x: 80, z: 0, heading: 0 });
    E.setup = () => {};
    E.needs = () => k !== 'pickpocket';
    E.engaged = gg => dist(gg.player.pos.x, gg.player.pos.z, 80, 0) < 20;
  }
  return g;
}
const restore = () => { for (const E of Object.values(EVENTS)) if (E._real) { Object.assign(E, E._real); delete E._real; } };
const run = (ev, g, secs, step = 0.5) => { for (let t = 0; t < secs; t += step) { g.time += step; ev.update(step); } };

test('no event while busy, wanted, at night, before c1 in story mode, or near the garage', () => {
  const g = fakeGame();
  assert.equal(blockedWhy(g), null);
  for (const [k, set, undo] of [
    ['busy', () => { g.missions.active = {}; }, () => { g.missions.active = null; }],
    ['busy', () => { g.jobs.active = {}; }, () => { g.jobs.active = null; }],
    ['busy', () => { g.cutscene = true; }, () => { g.cutscene = false; }],
    ['busy', () => { g.respawning = true; }, () => { g.respawning = false; }],
    ['police', () => { g.police.level = 1; }, () => { g.police.level = 0; }],
    ['police', () => { g.police.pending.push(1); }, () => { g.police.pending.length = 0; }],
    ['night', () => { g.sky.hours = 2; }, () => { g.sky.hours = 12; }],
    ['story', () => { g.freeRoam = false; }, () => { g.freeRoam = true; }],
    ['garage', () => { g.player.pos = { x: -299.8, z: -1113.2 }; }, () => { g.player.pos = { x: 0, z: 0 }; }],
  ]) { set(); assert.equal(blockedWhy(g), k); undo(); }
  g.freeRoam = false; g.save.data.story.push('c1');
  assert.equal(blockedWhy(g), null, 'story mode after c1');
  assert.ok(quietHours(23.5) && quietHours(5) && !quietHours(5.6) && !quietHours(22.9));
  restore();
});

test('a blocked director never drafts an event', () => {
  const g = fakeGame();
  g.police.level = 2;
  const ev = new StreetEvents(g, { random: seeded(3) });
  run(ev, g, 900);
  assert.equal(g.log.drafted.length, 0);
  restore();
});

test('no C4 API: nothing starts', () => {
  const g = fakeGame();
  delete g.missions.draft;
  const ev = new StreetEvents(g, { random: seeded(3) });
  run(ev, g, 900);
  assert.equal(ev.offer, null);
  assert.equal(ev.force('snatch'), false);
  restore();
});

test('360 s of eligible free roam gives exactly one offer, with a blip and a bark', () => {
  const g = fakeGame();
  const ev = new StreetEvents(g, { random: seeded(5) });
  assert.equal(ev.blips().length, 0);
  run(ev, g, 140);
  assert.equal(g.log.drafted.length, 0, 'nothing in the first 150 s');
  let t = 140;
  while (!ev.offer && t < 250) { g.time += 0.5; ev.update(0.5); t += 0.5; }
  assert.ok(ev.offer, 'first offer by 240 s');
  const b = ev.blips();
  assert.equal(b.length, 1);
  assert.deepEqual([b[0].x, b[0].z, b[0].label], [80, 0, '!']);
  assert.ok(ev.blips() === b, 'blip array is reused');
  assert.equal(g.log.subs.length, 1);
  assert.equal(g.save.data.seenEventHelp, true);
  run(ev, g, 360 - t);
  assert.equal(g.log.drafted.length, 1, 'exactly one in 360 s (ignored: the next waits 3-6 min)');
  restore();
});

test('engaging adopts the event; the next kind is never the same as the last', () => {
  const g = fakeGame();
  const ev = new StreetEvents(g, { random: seeded(9) });
  const kinds = [];
  for (let i = 0; i < 6; i++) {
    ev.t = 0; g.missions.active = null; g.player.pos = { x: 0, z: 0 };
    ev.update(0.1);
    assert.ok(ev.offer, `offer ${i}`);
    kinds.push(ev.offer.kind);
    g.player.pos = { x: 75, z: 0 };
    ev.update(0.1);
    assert.equal(ev.offer, null);
    assert.equal(g.missions.active?.def.event, kinds[i]);
    assert.ok(ev.t >= 180 && ev.t <= 360, 'gap 3-6 min');
  }
  for (let i = 1; i < kinds.length; i++) assert.notEqual(kinds[i], kinds[i - 1]);
  restore();
});

test('an offer goes quietly at 300 m or after 90 s, and its cast is discarded', () => {
  const g = fakeGame();
  const ev = new StreetEvents(g, { random: seeded(2) });
  assert.ok(ev.force('injured'));
  g.player.pos = { x: -(OFFER_LOSE_DIST + 10), z: 0 };
  ev.update(0.1);
  assert.equal(ev.offer, null);
  assert.equal(g.log.discarded.length, 1);
  g.player.pos = { x: 0, z: 0 };
  assert.ok(ev.force('exam'));
  run(ev, g, 91);
  assert.equal(g.log.discarded.length, 2);
  // A mission or job starting discards it too.
  assert.ok(ev.force('snatch'));
  g.jobs.active = {};
  ev.update(0.1);
  assert.equal(g.log.discarded.length, 3);
  restore();
});

test('pick respects hours, rain, weights and the last kind', () => {
  const all = Object.keys(EVENTS);
  assert.equal(pick(all, 8, 'clear', 0.5), 'injured', '8:00: injured or exam, weighted');
  for (let r = 0; r < 1; r += 0.05) {
    const k = pick(all, 22, 'clear', r);
    assert.ok(['injured', 'baraat'].includes(k), `22:00 ${k}`);
    assert.equal(pick(all, 22, 'rain', r), 'injured', 'no baraat in rain');
    assert.notEqual(pick(all, 12, 'clear', r), 'pickpocket', 'weight 0');
    assert.notEqual(pick(all, 12, 'clear', r, ['snatch']), 'snatch');
  }
  assert.equal(pick(all, 5, 'clear', 0.3), null);
  assert.equal(pick(['baraat'], 18, 'rain', 0.3), null);
});

test('pass pays, counts the event and Izzat, and never completes a story id', () => {
  const g = fakeGame();
  const ev = new StreetEvents(g, { random: () => 0.5 });
  ev.passed({ event: 'snatch' }, { vars: {} });
  assert.equal(g.cash, 450);
  assert.equal(g.save.data.events.done.snatch, 1);
  assert.equal(g.save.data.events.izzat, 2);
  assert.equal(g.save.data.stats.events, 1);
  assert.deepEqual(g.log.complete, []);
  assert.match(g.log.toasts.at(-1), /₹450/);
  ev.passed({ event: 'snatch' }, { vars: { shot: true } });
  assert.equal(g.cash, 450 + 225);
  assert.equal(g.save.data.events.izzat, 2, 'shooting him earns no Izzat');
  assert.match(g.log.toasts.at(-1), /encounter nahi/);
  ev.passed({ event: 'baraat' }, { vars: { reward: { cash: 100, heal: 40, line: 'Mithai' } } });
  assert.equal(g.player.health, 90);
  ev.failed({ event: 'exam' }, 'The exam hall doors closed.');
  assert.equal(g.log.toasts.at(-1), 'The exam hall doors closed.');
  restore();
});

test('jolts lower a passenger\'s comfort; DANCE shows only on foot beside the baraat', () => {
  const g = fakeGame();
  const ev = new StreetEvents(g);
  g.missions.active = { def: { event: 'injured' }, vars: { comfort: 100, rider: {} } };
  ev.jolt(1, 'bump'); ev.jolt(7, 'crash');
  assert.equal(g.missions.active.vars.comfort, 77);
  const member = { state: 'scripted', h: { x: 2, z: 0 } };
  g.missions.active = { def: { event: 'baraat' }, vars: { members: [member] } };
  assert.equal(ev.contextAction(), null, 'in a vehicle');
  g.player.vehicle = null;
  const a = ev.contextAction();
  assert.equal(a.label, 'DANCE');
  assert.ok(a.label.length <= 18);
  g.time = 10; a.run(); g.time = 10.5; a.run();
  assert.equal(g.missions.active.vars.danceT0, 10);
  assert.equal(g.missions.active.vars.taps.length, 2);
  g.player.pos = { x: 10, z: 0 };
  assert.equal(ev.contextAction(), null, 'too far');
  restore();
});

test('rideReward, examReward and beatScore', () => {
  assert.deepEqual(rideReward({ route: 1000, comfort: 80 }), { cash: 450, izzat: 1, gentle: true });
  assert.deepEqual(rideReward({ route: 1000, comfort: 50 }), { cash: 300, izzat: 0, gentle: false });
  assert.equal(examReward({ left: 0, limit: 60 }).cash, 120);
  assert.equal(examReward({ left: 60, limit: 60 }).cash, 300);
  assert.equal(examReward({ left: 30, limit: 60 }).cash, 210);
  const perfect = Array.from({ length: 16 }, (_, k) => 5 + k * 0.5);
  assert.equal(beatScore(perfect, 5), 16);
  assert.equal(beatScore(perfect.map(t => t + 0.1), 5), 16);
  assert.equal(beatScore(perfect.map(t => t + 0.2), 5), 0);
  assert.equal(beatScore([5, 5.01, 5.02], 5), 1, 'one per beat');
  assert.equal(beatScore([4, 13.5], 5), 0, 'outside the 16 beats');
});

test('on the real map: spots are on the ground, outside holy places, routable destinations', () => {
  const { net, city } = world();
  const zones = [{ x: 0, z: 0, r2: 0 }];
  const g = { net, city, player: { pos: { x: 76, z: 270 } }, weapons: { zones } };
  const r = seeded(11);
  let found = 0, lanes = 0;
  for (let i = 0; i < 60; i++) {
    const at = kerbSpot(g, r);
    if (at) {
      found++;
      assert.ok(!net.raised[at.road], 'never a raised road');
      assert.ok(!net.bridge[at.road]);
      assert.equal(at.y, 0);
      const d = dist(at.x, at.z, 76, 270);
      assert.ok(d > 35 && d < 190, `distance ${d}`);
    }
    const b = EVENTS.baraat.place(g, r);
    if (b) { lanes++; assert.ok(!net.oneway[b.road] && net.length[b.road] >= 120); }
  }
  assert.ok(found > 10, `found ${found}`);
  assert.ok(lanes > 0, 'some baraat roads');
  // A holy-place zone covering everything blocks every spot.
  g.weapons.zones = [{ x: 76, z: 270, r2: 1e6 }];
  for (let i = 0; i < 20; i++) assert.equal(kerbSpot(g, r), null);
  // Hospitals and classes have routes.
  const near = hospitalFor(g, 100, 300);
  assert.equal(near.name, 'Civil Hospital');
  assert.ok(net.route(100, 300, near.x, near.z));
  const far = hospitalFor(g, -1000, 2600);
  assert.notEqual(far.name, 'Civil Hospital', 'far north uses the nearer hospital');
  assert.ok(!/veterinary/i.test(far.name));
  assert.ok(net.route(-1000, 2600, far.x, far.z));
  let classes = 0;
  for (const p of city.places.filter(q => q.category === 'junction').slice(0, 8)) {
    const c = classFor(g, p.ax ?? p.x, p.az ?? p.z, r);
    if (!c) continue;
    classes++;
    const d = dist(c.x, c.z, p.ax ?? p.x, p.az ?? p.z);
    assert.ok(d >= 400 && d <= 1400);
    assert.ok(net.route(p.ax ?? p.x, p.az ?? p.z, c.x, c.z), 'class has a route');
  }
  assert.ok(classes > 0);
});
