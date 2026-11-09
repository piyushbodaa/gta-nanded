// Nakabandi: roadblocks ahead from three stars, the tyre killer from four, the drone at five.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { world } from './helpers.js';
import { Colliders } from '../src/world/colliders.js';
import { Nakabandi, pickSite, raySphere, NAKA } from '../src/game/nakabandi.js';
import { Police } from '../src/game/police.js';
import { Vehicles } from '../src/actors/vehicles.js';
import { vehicleModel } from '../src/actors/vehicle-models.js';
import { createBody, stepBody, burstTyre, repairTyres, speedOf } from '../src/actors/vehicle-physics.js';
import { inStory, inEvent, busy } from '../src/game/mission-state.js';
import * as THREE from 'three';
import { NakabandiFx } from '../src/game/nakabandi-fx.js';

let colliders = null;
const shared = () => (colliders ??= new Colliders(world().city));

function makeVehicle(type, x, z, heading, role = 'player') {
  const v = Object.assign(createBody(type, x, z, heading), { id: Math.random(), role, model: vehicleModel(type), kinematic: role !== 'player', passengers: [], driver: null });
  return v;
}

function nakaGame({ net = world().net, city = world().city, cols = shared() } = {}) {
  const g = {
    time: 0, net, city, colliders: cols, controls: new Map(), cutscene: false,
    player: { x: 0, z: 0, y: 0, vehicle: null, state: 'driving', speed: 0 },
    vehicles: {
      list: [],
      spawn(type, x, z, heading, { role = 'parked' } = {}) { const v = makeVehicle(type, x, z, heading, role); this.list.push(v); return v; },
      remove(v) { const i = this.list.indexOf(v); if (i >= 0) this.list.splice(i, 1); v.removed = true; },
      wheelWorld: Vehicles.prototype.wheelWorld,
    },
    humans: { add: (outfit, x, z) => ({ x, z, y: 0, outfit }), remove() {} },
    peds: { list: [], _make(h, x, z) { const p = { h, state: 'walk', id: this.list.length + 1 }; h.x = x; h.z = z; this.list.push(p); return p; }, remove(p) { const i = this.list.indexOf(p); if (i >= 0) this.list.splice(i, 1); } },
    save: { data: { stats: {} }, set(k, v) { this.data[k] = v; }, stat(k) { this.data.stats[k] = (this.data.stats[k] || 0) + 1; } },
    hud: { helps: [], help(h) { this.helps.push(h); }, bark() {} },
    effects: { n: 0, sparks() { this.n++; }, smoke() {} },
    onWantedChange() {}, onEvaded() {}, busted() {},
  };
  g.player.pos = g.player;
  g.police = new Police(g);
  g.nakabandi = new Nakabandi(g);
  return g;
}

/** Drivers along the middle of ground roads, and the block each would get. */
function sites(limit = 40, filter = () => true) {
  const { net } = world(), out = [];
  for (let r = 0; r < net.count && out.length < limit; r += 3) {
    if (net.raised[r] || net.length[r] < 40) continue;
    const p = net.pointAt(r, net.length[r] / 2, {});
    for (const dir of [1, -1]) {
      const vx = p.dx * dir * 15, vz = p.dz * dir * 15;
      const site = pickSite(net, p.x, p.z, vx, vz);
      if (site && filter(site)) out.push({ x: p.x, z: p.z, vx, vz, site });
    }
  }
  return out;
}

test('mission state: story, event and busy', () => {
  assert.equal(inStory({}), false);
  assert.equal(inStory({ missions: { active: { def: {} } } }), true);
  assert.equal(inEvent({ missions: { active: { def: { event: 'snatch' } } } }), true);
  assert.equal(inStory({ missions: { active: { def: { event: 'snatch' } } } }), false);
  assert.equal(busy({ jobs: { active: {} } }), true);
  assert.equal(busy({ retryCard: { open: true } }), true);
  assert.equal(busy({ missions: {}, jobs: {} }), false);
});

test('from three stars a roadblock goes up on the road ahead, never behind or on a flyover', () => {
  const { net } = world(), found = sites(30);
  assert.ok(found.length >= 10, `only ${found.length} sites`);
  for (const { x, z, vx, vz, site } of found) {
    assert.ok((site.x - x) * vx + (site.z - z) * vz > 0, 'the block is ahead');
    assert.equal(net.raised[site.road], 0);
    assert.ok(net.width[site.road] >= 4.5);
    assert.ok(Math.hypot(site.x - x, site.z - z) < NAKA.max + 60);
  }
  // The game puts one up for a fast driver at 3 stars, not at 2.
  const g = nakaGame(), { x, z, vx, vz } = found[0];
  const car = makeVehicle('hatch', x, z, Math.atan2(vx, vz));
  car.vx = vx; car.vz = vz;
  Object.assign(g.player, { x, z, vehicle: car });
  g.police.level = 2;
  g.nakabandi.update(1.1);
  assert.equal(g.nakabandi.blocks.length, 0);
  g.police.level = 3;
  g.nakabandi.update(1.1);
  const b = g.nakabandi.blocks[0];
  assert.ok(b, 'a block at three stars');
  assert.ok(b.jeeps.length >= 1 && b.jeeps.every(v => v.role === 'roadblock' && v.kinematic && v.sirenOn));
  assert.equal(b.cops.length, 2);
  assert.ok(b.cops.every(p => p.cop && p.keep && p.armed && p.state === 'scripted'));
  assert.ok(b.bars.length > 0);
  assert.equal(b.strip, null, 'no strip below four stars');
  assert.ok(g.nakabandi.blocksRoad(b.road));
  assert.equal(g.nakabandi.blips()[0].label, '🚧');
  assert.ok(g.hud.helps[0].includes('Nakabandi'));
  // Not during a mission.
  g.nakabandi.clear();
  g.missions = { active: { def: {} } };
  g.nakabandi.update(1.1);
  assert.equal(g.nakabandi.blocks.length, 0);
});

test('no roadblock within 60 m of a holy place', () => {
  const { net } = world(), { x, z, vx, vz, site } = sites(1)[0];
  assert.equal(pickSite(net, x, z, vx, vz, { zones: [{ x: site.x + 50, z: site.z, r2: 10 * 10 }] }), null);
  assert.ok(pickSite(net, x, z, vx, vz, { zones: [{ x: site.x + 200, z: site.z, r2: 10 * 10 }] }));
});

test('a divided road is blocked on both carriageways', () => {
  const { net } = world(), [s] = sites(400, site => site.twin).slice(0, 1);
  assert.ok(s, 'some divided road gets a block');
  assert.notEqual(s.site.twin.road, s.site.road);
  assert.ok(net.oneway[s.site.twin.road]);
  const g = nakaGame();
  g.police.level = 3;
  const b = g.nakabandi._build(s.site, 3);
  const onTwin = b.bars.filter(bar => net.nearest(bar.x, bar.z, 6).road === s.site.twin.road);
  assert.ok(onTwin.length > 0, 'barricades across the other carriageway');
  assert.ok(g.nakabandi.blocksRoad(s.site.twin.road));
  g.nakabandi.clear();
});

test('barricades are solid to a car and gone once freed, and every collider stays indexed', () => {
  const g = nakaGame({ cols: new Colliders(world().city) }), C = g.colliders, n0 = C.n;
  const { site } = sites(1)[0];
  const b = g.nakabandi._build(site, 3);
  const bar = b.bars[0];
  assert.ok(C.blocked(bar.x, bar.z, 0.3), 'solid');
  assert.ok(C.raycastSolid(bar.x - 3 * b.uz, 0.8, bar.z + 3 * b.ux, bar.x + 3 * b.uz, 0.8, bar.z - 3 * b.ux) <= 1);
  const slots = b.bars.map(x => x.slot);
  g.nakabandi.clear();
  assert.ok(!C.blocked(bar.x, bar.z, 0.3), 'gone');
  for (const list of C.grid.map.values()) for (const i of list) assert.ok(!slots.includes(i), 'a freed slot left in the grid');
  // The next block reuses the slots instead of growing the colliders.
  const n1 = C.n;
  g.nakabandi._build(site, 3);
  assert.equal(C.n, n1);
  const indexed = new Set();
  for (const list of C.grid.map.values()) for (const i of list) indexed.add(i);
  for (let i = 0; i < C.n; i++) assert.equal(indexed.has(i), C.h[i] > 0 || i < n0, `collider ${i}`);
  g.nakabandi.clear();
});

test('roadblocks come down when the wanted level clears, and are removed once left behind', () => {
  const g = nakaGame(), { site } = sites(1)[0];
  g.police.setLevel(3);
  const b = g.nakabandi._build(site, 3), jeeps = b.jeeps.slice();
  Object.assign(g.player, { x: site.x + 20, z: site.z });
  g.police.setLevel(0);
  assert.equal(b.state, 'down');
  assert.ok(jeeps.every(v => v.role === 'police-parked' && !v.sirenOn));
  assert.ok(b.cops.every(p => p.state === 'walk' && !p.armed && !p.keep));
  assert.ok(!g.nakabandi.blocksRoad(b.road));
  g.nakabandi.update(0.1);
  assert.equal(g.nakabandi.blocks.length, 1, 'kept while the player is near');
  Object.assign(g.player, { x: site.x + 100, z: site.z });
  g.nakabandi.update(0.1);
  assert.equal(g.nakabandi.blocks.length, 0);
  // Left far behind while still up: removed, jeeps and constables too.
  g.police.level = 3;
  const b2 = g.nakabandi._build(site, 3);
  Object.assign(g.player, { x: site.x + 400, z: site.z });
  g.nakabandi.update(0.1);
  assert.equal(g.nakabandi.blocks.length, 0);
  assert.ok(b2.jeeps.length === 0 && !g.vehicles.list.some(v => v.role === 'roadblock'));
  assert.equal(g.peds.list.filter(p => p.cop && p.keep).length, 0);
  // police.clear() removes everything at once.
  g.police.level = 3;
  g.nakabandi._build(site, 3);
  g.police.clear();
  assert.equal(g.nakabandi.blocks.length, 0);
});

test('the spike strip bursts only the wheels that cross it, and police cars are spared', () => {
  const g = nakaGame(), { site } = sites(1)[0];
  g.police.level = 4;
  const b = g.nakabandi._build(site, 4), S = b.strip;
  assert.ok(S, 'a strip at four stars');
  const h = S.rot;
  // A hatch whose front axle has just rolled over the strip, its rear axle still before it.
  const back = vehicleModel('hatch').wheels[0][1] - 0.1;
  const car = makeVehicle('hatch', S.x - Math.sin(h) * back, S.z - Math.cos(h) * back, h);
  car.vx = Math.sin(h) * 15; car.vz = Math.cos(h) * 15;
  const cop = makeVehicle('police', S.x - Math.cos(h) * 2.5, S.z + Math.sin(h) * 2.5, h, 'police');
  cop.kinematic = false; cop.vx = car.vx; cop.vz = car.vz;
  g.vehicles.list.push(car, cop);
  Object.assign(g.player, { x: S.x - Math.sin(h) * 20, z: S.z - Math.cos(h) * 20 });
  g.nakabandi._strips(1 / 60);
  assert.equal(car.flat, 0b0011, `front tyres only (flat ${car.flat})`);
  assert.equal(car.flatN, 2);
  assert.ok(!cop.flat, 'police tyres spared');
  // Once the player is past it the constables pull it in.
  Object.assign(g.player, { x: S.x + Math.sin(h) * 10, z: S.z + Math.cos(h) * 10 });
  g.nakabandi._strips(1.2); g.nakabandi._strips(1.2);
  assert.equal(S.live, false);
  // Rims throw sparks.
  g.nakabandi._rimSparks(0.1);
  assert.ok(g.effects.n >= 2);
  g.nakabandi.clear();
});

test('the drone keeps the player seen in the open but not under a flyover or a tree', () => {
  let deck = 0;
  const net = Object.create(world().net);
  net.deckOver = () => deck;
  const g = nakaGame({ net, city: { trees: { x: [], z: [], scale: [] }, chunk: () => ({ trees: [] }) }, cols: { raycast: () => 1 } });
  Object.assign(g.player, { x: 0, z: 0 });
  g.police.level = 5;
  g.nakabandi._fly(0.1, 5, g.player.pos);
  const D = g.nakabandi.drone;
  assert.ok(D, 'a drone at five stars');
  for (let i = 0; i < 200; i++) g.nakabandi._fly(0.05, 5, g.player.pos);
  assert.ok(Math.hypot(D.x, D.z) < 12 && Math.abs(D.y - NAKA.drone.y) < 1, `hovering over the player (${D.x.toFixed(1)}, ${D.y.toFixed(1)}, ${D.z.toFixed(1)})`);
  assert.equal(g.nakabandi.sees(g.player.pos), true);
  deck = 6;
  assert.equal(g.nakabandi.sees(g.player.pos), false, 'under a flyover');
  deck = 0;
  g.city.trees = { x: [1], z: [1], scale: [1] };
  g.city.chunk = () => ({ trees: [0] });
  assert.equal(g.nakabandi.sees(g.player.pos), false, 'under a tree');
  // Police sight uses it.
  g.city.chunk = () => ({ trees: [] });
  g.police.losT = 0; g.police.seen = false; g.police.spawnT = 99;
  g.police.update(0.01);
  assert.equal(g.police.seen, true);
});

test('a shot drone falls and the next one comes later', () => {
  const g = nakaGame({ cols: { raycast: () => 1 } });
  g.police.level = 5;
  g.nakabandi._fly(0.1, 5, g.player.pos);
  const D = g.nakabandi.drone;
  const t = g.nakabandi.droneHit(D.x - 10, D.y, D.z, 1, 0, 0, 50);
  assert.ok(Math.abs(t - (10 - NAKA.drone.r)) < 1e-6);
  assert.equal(g.nakabandi.droneHit(D.x - 10, D.y + 2, D.z, 1, 0, 0, 50), -1);
  assert.equal(g.nakabandi.hitDrone(30), false);
  assert.equal(g.nakabandi.hitDrone(30), true);
  assert.equal(D.state, 'fall');
  assert.equal(g.nakabandi.droneHit(D.x - 10, D.y, D.z, 1, 0, 0, 50), -1, 'a falling drone is not a target');
  for (let i = 0; i < 200 && g.nakabandi.drone; i++) g.nakabandi._fly(0.05, 5, g.player.pos);
  assert.equal(g.nakabandi.drone, null, 'down');
  g.nakabandi._fly(10, 5, g.player.pos);
  assert.equal(g.nakabandi.drone, null, 'not straight away');
  g.nakabandi.droneT = 0;
  g.nakabandi._fly(0.1, 5, g.player.pos);
  assert.ok(g.nakabandi.drone, 'another one 75 s on');
  assert.equal(raySphere(0, 0, 0, 0, 0, 1, 5, 0, 0, 10, 1), -1, 'out of reach');
});

test('a burst tyre lowers top speed, pulls toward the flat side and costs grip', () => {
  const drive = (setup, steps = 900) => {
    const v = makeVehicle('hatch', 0, 0, 0);
    v.model = vehicleModel('hatch');
    setup(v);
    for (let i = 0; i < steps; i++) stepBody(v, { throttle: 1, brake: 0, steer: 0 }, 1 / 60);
    return v;
  };
  const ok = drive(() => {}), flat = drive(v => burstTyre(v, 0));
  assert.ok(speedOf(flat) < speedOf(ok) - 1, `slower (${speedOf(flat).toFixed(1)} vs ${speedOf(ok).toFixed(1)})`);
  assert.ok(flat.x > 0.5, `pulls left, toward the flat front-left (x ${flat.x.toFixed(2)})`);
  assert.equal(Math.abs(ok.x) < 1e-6, true);
  const v = makeVehicle('hatch', 0, 0, 0);
  assert.equal(burstTyre(v, 0), true);
  assert.equal(burstTyre(v, 0), false, 'already flat');
  assert.equal(burstTyre(v, 9), false, 'no such wheel');
  v.mods = { bpTyres: true };
  assert.equal(burstTyre(v, 1), false, 'bulletproof');
  v.mods = null; burstTyre(v, 3);
  assert.deepEqual([v.flatN, v.flatF, v.flatR, v.flatPull], [2, 0.5, 0.5, 0]);
  repairTyres(v);
  assert.deepEqual([v.flat, v.flatN, v.flatF, v.flatR, v.flatPull], [0, 0, 0, 0, 0]);
});

test('with no flat tyres a car drives exactly as before', () => {
  const run = setup => {
    const v = makeVehicle('sedan', 3, 4, 0.3);
    setup(v);
    const out = [];
    for (let i = 0; i < 400; i++) { stepBody(v, { throttle: i < 200 ? 1 : 0, brake: i >= 300 ? 1 : 0, steer: Math.sin(i / 30), handbrake: i > 250 && i < 270 }, 1 / 60); out.push(v.x, v.z, v.heading, v.vx, v.vz, v.w, v.steer, v.rpm); }
    return out;
  };
  const plain = run(() => {});
  assert.deepEqual(run(v => repairTyres(v)), plain);
  assert.deepEqual(run(v => { burstTyre(v, 2); repairTyres(v); }), plain);
});

test('the meshes are in the scene for the menu to compile, then drawn only while in use', () => {
  const g = { scene: new THREE.Scene(), started: false };
  const fx = new NakabandiFx(g);
  assert.ok(fx.bars.visible && fx.bars.count === 0 && g.scene.children.length === 3);
  g.started = true;
  g.nakabandi = { blocks: [{ bars: [{ x: 1, z: 2, rot: 0.3 }], strip: { x: 0, z: 0, rot: 0, hw: 4, live: true } }], drone: { x: 0, y: 22, z: 0, vx: 1, vz: 2, state: 'fly' } };
  fx.update(0.016);
  assert.deepEqual([fx.bars.count, fx.strips.count, fx.drone.count], [1, 1, 1]);
  g.nakabandi = { blocks: [], drone: null };
  fx.update(0.016);
  assert.ok(!fx.bars.visible && !fx.strips.visible && !fx.drone.visible);
});
