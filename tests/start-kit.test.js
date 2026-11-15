// The start kit: every gun loaded, and a car of your own parked at the kerb beside you,
// kept off the tow truck and marked on the radar while you're out of it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { giveStartKit, spawnStarterCar, starterSpot, starterBlip, STARTER_CAR } from '../src/game/start-kit.js';
import { Weapons } from '../src/game/weapons.js';
import { AMMO, ORDER } from '../src/game/weapon-data.js';
import { VEHICLE_TYPES } from '../src/actors/vehicle-types.js';
import { Parked } from '../src/actors/traffic.js';
import { dist } from '../src/core/math.js';
import { world } from './helpers.js';
import { Colliders } from '../src/world/colliders.js';
import { startSpot } from '../src/game/start-spot.js';

/** One straight two-way road 10 m wide along z through x = 0 (z -500 to 500), and a player on its centre line. */
function kerbGame({ blocked = () => false, heading = 0, trim = 0 } = {}) {
  const g = {
    net: {
      raised: [0], bridge: [0], width: [10], oneway: [0], length: [1000],
      kerbSide: () => 0,
      trimStart: () => trim, trimEnd: () => 0,
      pointAt: (road, s, out = {}) => Object.assign(out, { x: 0, z: s - 500, dx: 0, dz: 1, seg: 0 }),
      nearest: (x, z, maxDist, out = {}, filter) => (Math.abs(x) > maxDist || (filter && !filter(0)) ? null : Object.assign(out, { road: 0, s: z + 500, x: 0, z, dx: 0, dz: 1, seg: 0 })),
    },
    colliders: { blocked },
    player: { x: 0, z: 0, heading, vehicle: null },
    vehicles: {
      list: [],
      spawn(type, x, z, heading, opts) {
        const v = { type, x, z, heading, role: opts.role, driver: opts.driver ? {} : null, color: opts.color, hd: VEHICLE_TYPES[type].L / 2, kinematic: opts.role !== 'player' };
        this.list.push(v); return v;
      },
      remove(v) { this.list.splice(this.list.indexOf(v), 1); v.removed = true; },
    },
  };
  g.player.pos = g.player;
  return g;
}

test('the start kit is every weapon, every magazine full, every calibre at its max', () => {
  const w = new Weapons({ save: { data: {} } });
  assert.deepEqual(w.owned, ['fist', 'p92'], 'the save default: fists and the starter pistol');
  giveStartKit(w);
  assert.equal(w.owned.length, ORDER.length);
  for (const id of ORDER) assert.ok(w.has(id), id);
  assert.equal(w.ammo.frag, AMMO.frag.max, 'grenades');
  assert.equal(w.ammoOf('awm').reserve, AMMO['300mag'].max);
  assert.equal(w.mags.akm, 30);
  assert.equal(w.current, 'fist', 'nothing drawn: the guns stay holstered');
  giveStartKit(null); // no weapons yet: nothing to do, no throw
});

test('the starter car parks at the kerb behind the player, driverless and kept', () => {
  const g = kerbGame();
  const v = spawnStarterCar(g);
  assert.ok(v);
  assert.equal(v.type, STARTER_CAR);
  assert.ok(Math.abs(Math.abs(v.x) - 3.8) < 1e-9, 'at the kerb: half the road less 1.2 m');
  assert.ok(v.z < 0, 'behind the player first');
  assert.ok(dist(v.x, v.z, 0, 0) < 15, 'beside them, not down the street');
  assert.equal(v.role, 'parked');
  assert.equal(v.driver, null);
  assert.equal(v.kinematic, true);
  assert.equal(v.keep, true);
  assert.equal(g.starterCar, v);
  // Facing the way traffic goes on its side of the road: left of a->b (+x here) runs a->b (+z).
  assert.ok(Math.abs(v.heading) < 1e-9);
});

test('no starter car when the player is already in one', () => {
  const g = kerbGame();
  g.player.vehicle = {};
  assert.equal(spawnStarterCar(g), null);
  assert.equal(g.vehicles.list.length, 0);
});

test('a vehicle on the first spot moves the car to the next; walls everywhere mean none at all', () => {
  const g = kerbGame();
  const first = starterSpot(g, 0, 0, 0);
  g.vehicles.list.push({ x: first.x, z: first.z, hd: 2.2 });
  const v = spawnStarterCar(g);
  assert.ok(v);
  assert.ok(dist(v.x, v.z, first.x, first.z) > 4.4, 'clear of the parked car');
  assert.ok(v.z > 0, 'ahead of the player instead');
  assert.equal(spawnStarterCar(kerbGame({ blocked: () => true })), null);
});

test('never on a flyover deck or a bridge', () => {
  const g = kerbGame();
  g.net.raised[0] = 1;
  assert.equal(starterSpot(g, 0, 0, 0), null);
  g.net.raised[0] = 0; g.net.bridge[0] = 1;
  assert.equal(starterSpot(g, 0, 0, 0), null);
});

test('kept out of a junction mouth: slid along the street clear of it', () => {
  const g = kerbGame({ trim: 505 }); // the junction zone reaches z = 5 at the near end
  const at = starterSpot(g, 0, 0, 0);
  assert.ok(at.z >= 9 - 1e-9, `z ${at.z}: 4 m past the trim, like Parked`);
});

test('a 4.8 m lane takes the car too, tucked against its edge', () => {
  const g = kerbGame();
  g.net.width[0] = 4.8;
  const at = starterSpot(g, 0, 0, 0);
  assert.ok(at);
  assert.ok(Math.abs(Math.abs(at.x) - (2.4 - VEHICLE_TYPES[STARTER_CAR].W / 2 - 0.15)) < 1e-9, 'inside the lane, against its edge');
});

test('on the real map the car is parked beside the player at every start', () => {
  const { net, city } = world();
  const g = { net, colliders: new Colliders(city), vehicles: { list: [] } };
  for (const mode of ['new', 'free']) {
    const p = startSpot(net, mode), at = starterSpot(g, p.x, p.z, p.heading);
    assert.ok(at, `${mode}: a spot`);
    assert.ok(dist(at.x, at.z, p.x, p.z) < 15, `${mode}: ${dist(at.x, at.z, p.x, p.z).toFixed(1)} m away`);
    const n = net.nearest(at.x, at.z, 10, {});
    assert.ok(n.s >= net.trimStart(n.road) + 4 - 0.5 && n.s <= net.length[n.road] - net.trimEnd(n.road) - 4 + 0.5, `${mode}: out of the junction mouth`);
    assert.ok(!g.colliders.blocked(at.x, at.z, 0.9), `${mode}: not in a wall`);
  }
});

test('the radar marks the car only while the player is out of it and it is still about', () => {
  const g = kerbGame();
  const v = spawnStarterCar(g), b = { x: 0, z: 0 };
  assert.equal(starterBlip(g, b), b);
  assert.deepEqual([b.x, b.z], [v.x, v.z]);
  g.player.vehicle = v; assert.equal(starterBlip(g, b), null, 'driving it');
  g.player.vehicle = null; v.owned = 'car1'; assert.equal(starterBlip(g, b), null, 'garaged: the garage draws its ◆');
  v.owned = undefined; v.wrecked = true; assert.equal(starterBlip(g, b), null, 'wrecked');
  assert.equal(starterBlip({ player: g.player }, b), null, 'no starter car');
});

test('left abandoned far away, the starter car is never towed', () => {
  const g = kerbGame();
  const v = spawnStarterCar(g);
  v.role = 'abandoned'; // the player drove it and got out
  g.player.x = 5000; g.player.z = 5000;
  g.quality = { settings: { traffic: 0 } };
  const parked = Object.create(Parked.prototype);
  Object.assign(parked, { game: g, net: g.net, t: 0, bySeg: new Map() });
  parked.update(1);
  assert.ok(g.vehicles.list.includes(v));
  assert.ok(!v.removed);
});
