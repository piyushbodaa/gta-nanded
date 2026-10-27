import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { world } from './helpers.js';
import { ChunkManager } from '../src/world/chunks.js';
import { Colliders } from '../src/world/colliders.js';
import { CHUNK, GROUND_CELL } from '../src/world/citygen.js';
import { WATER_Y } from '../src/world/water.js';
import { DECK_H } from '../src/world/roadnet.js';
import { Vehicles } from '../src/actors/vehicles.js';
import { createBody } from '../src/actors/vehicle-physics.js';
import { Player } from '../src/actors/player.js';

// The ground people walk and drive on is the ground that is drawn: the river valleys, the
// ghat steps down to the water, and the bridges that stand clear of it.

let solid = null;
const colliders = () => solid || (solid = new Colliders(world().city));

test('the ground mesh is the ground people stand on, river valleys included', () => {
  const { city } = world();
  const mats = { city: new THREE.MeshBasicMaterial(), signs: new THREE.MeshBasicMaterial(), pools: new THREE.MeshBasicMaterial(), wires: new THREE.LineBasicMaterial(), foliage: new THREE.MeshBasicMaterial() };
  const cm = new ChunkManager(new THREE.Scene(), city, mats, new Map());
  // Shikar Ghat's chunk (the river crosses only its corner) and one with the channel in it.
  for (const [cx, cz] of [[27, 8], [28, 0]]) {
    cm._build(`${cx},${cz}`, cx, cz);
    const geo = cm.chunks.get(`${cx},${cz}`).levels[0].meshes[0].geometry;
    const pos = geo.attributes.position.array, idx = geo.index.array, n = CHUNK / GROUND_CELL + 1;
    // The ground is built first: an n x n grid of points, two triangles a cell.
    let cut = 0;
    for (let k = 0; k < n * n; k++) {
      const x = pos[k * 3], y = pos[k * 3 + 1], z = pos[k * 3 + 2];
      assert.equal(x, cx * CHUNK + (k % n) * GROUND_CELL);
      assert.ok(Math.abs(y - city.groundHeight(x, z)) < 1e-4, `chunk ${cx},${cz} point ${k}`);
      if (y < -3) cut++;
    }
    assert.ok(cut > 20, `chunk ${cx},${cz}: the river valley is cut (${cut} points below -3 m)`);
    // Anywhere inside a ground triangle, groundHeight is the height of the triangle drawn there.
    let s = 7, checked = 0;
    const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    for (let t = 0; t < 2 * (n - 1) * (n - 1); t += 37) {
      const [a, b, c] = [idx[t * 3], idx[t * 3 + 1], idx[t * 3 + 2]].map(i => [pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]]);
      let u = rnd(), v = rnd();
      if (u + v > 1) { u = 1 - u; v = 1 - v; }
      const x = a[0] + (b[0] - a[0]) * u + (c[0] - a[0]) * v, z = a[2] + (b[2] - a[2]) * u + (c[2] - a[2]) * v;
      const y = a[1] + (b[1] - a[1]) * u + (c[1] - a[1]) * v;
      assert.ok(Math.abs(y - city.groundHeight(x, z)) < 1e-3, `chunk ${cx},${cz} at ${x.toFixed(1)}, ${z.toFixed(1)}: drawn ${y.toFixed(3)}, walked ${city.groundHeight(x, z).toFixed(3)}`);
      checked++;
    }
    assert.ok(checked > 50);
  }
});

test('off the streets the surface is the ground; streets and river bridges stay level over the valley', () => {
  const { net, city } = world();
  // Down the bank at Nagina Ghat, toward the water.
  const rd = city.riverDistance(215, 723);
  for (const d of [10, 5, 2, 0, -1]) {
    const x = 215 - rd.nx * (rd.d - d), z = 723 - rd.nz * (rd.d - d);
    if (net.roadClearance(x, z, 12) < 1) continue;
    assert.equal(net.surfaceAt(x, z, city.groundHeight(x, z)), city.groundHeight(x, z), `${d} m from the bank`);
  }
  assert.ok(city.groundHeight(215 - rd.nx * (rd.d + 1), 723 - rd.nz * (rd.d + 1)) < WATER_Y, 'a metre into the river is under water');
  // Every river bridge's deck is at street level all the way across, kerb to kerb.
  const p = {};
  let over = 0;
  for (let r = 0; r < net.count; r++) {
    if (!net.bridge[r] || net.raised[r]) continue;
    for (let s = 0; s <= net.length[r]; s += 3) {
      net.pointAt(r, s, p);
      for (const off of [0, net.width[r] / 2 - 0.5, 0.5 - net.width[r] / 2]) {
        const x = p.x + p.dz * off, z = p.z - p.dx * off;
        if (city.riverDistance(x, z).d > -1.5) continue;
        over++;
        assert.equal(net.surfaceAt(x, z, 0), 0, `bridge ${r} at ${s.toFixed(0)} m`);
      }
    }
  }
  assert.ok(over > 1000, `${over} deck points over the water`);
  // Walking the riverbank under a bridge passes beneath its deck.
  net.pointAt(2094, net.length[2094] / 2, p);
  const x = p.x, z = p.z, below = city.groundHeight(x, z);
  assert.ok(below < -3.5 && net.surfaceAt(x, z, below) === below, 'beneath the deck, the riverbed');
});

/** A physics host around the real Vehicles.step, with no rendering. */
function host() {
  const { city } = world();
  return Object.assign(Object.create(Vehicles.prototype), { list: [], city, colliders: colliders(), _contact: {}, time: 0 });
}

test('cars cross the Godavari bridges without sinking, and sink in the river beside them', () => {
  const { net, city } = world();
  const H = host(), p = {}, dt = 1 / 60, none = new Map();
  for (const road of [2094, 15945, 11]) {
    const v = createBody('truck', 0, 0, 0);
    v.role = 'player';
    H.list = [v];
    let wet = 0, sunk = 0, off = 0;
    // Held to the kerb lane at 12 m/s, as slow as a loaded tipper.
    for (let s = 0; s < net.length[road]; s += 12 * dt) {
      net.lanePoint(road, net.oneway[road] || 1, s, net.laneOffset(road, 0), p);
      v.x = p.x; v.z = p.z; v.heading = p.heading; v.vx = p.dx * 12; v.vz = p.dz * 12; v.w = 0;
      H.step(dt, none);
      sunk = Math.max(sunk, v.sinking || 0);
      if (city.riverDistance(v.x, v.z).d < -1.5) { wet += dt; off = Math.max(off, Math.abs(v.y)); }
    }
    assert.ok(wet > 5, `road ${road}: ${wet.toFixed(1)} s over the water`);
    assert.equal(sunk, 0, `road ${road}: no sinking`);
    assert.equal(off, 0, `road ${road}: level with the deck over the water`);
  }
  // Off the side of the Govardhan bridge, in the channel: down to the riverbed, and sinking.
  net.pointAt(2094, net.length[2094] / 2, p);
  const v = createBody('hatch', p.x + p.dz * 30, p.z - p.dx * 30, 0);
  v.role = 'player';
  H.list = [v];
  for (let k = 0; k < 60; k++) H.step(dt, none);
  assert.ok(v.y < WATER_Y && v.sinking > 0.9, `in the river: y ${v.y.toFixed(2)}, sinking ${v.sinking.toFixed(2)}`);
});

/** The real Player in a minimal game, walked by a stick held toward `aim(player)`. */
function walker(x, z, y = world().net.surfaceAt(x, z, 0)) {
  const { net, city } = world();
  const g = {
    net, city, colliders: colliders(), camera: { facing: 0 }, energy: 0, time: 0,
    humans: { add: () => ({ t: 0 }) }, pushOutOfVehicles() {},
    vehicles: { doorWorld: Vehicles.prototype.doorWorld },
  };
  const P = new Player(g, x, z, 0);
  P.groundY = P.y = y;
  const input = { mode: 'keyboard', state: { moveX: 0, moveY: 0, sprint: false }, pressed: () => false };
  return {
    P,
    walk(seconds, aim) {
      for (let t = 0; t < seconds; t += 1 / 60) {
        const to = aim(P);
        input.state.moveY = to ? 1 : 0;
        if (to) g.camera.facing = Math.atan2(to.x - P.x, to.z - P.z);
        P.update(1 / 60, input);
      }
    },
  };
}

test('on foot: across a bridge, down the ghat to the water, and out of the river', () => {
  const { net, city } = world();
  // The length of the Govardhan bridge, on its kerb lane.
  const p = {}, road = 2094, len = net.length[road], off = net.laneOffset(road, 0);
  net.lanePoint(road, 1, 5, off, p);
  const bridge = walker(p.x, p.z);
  let along = 5;
  bridge.walk(150, P => {
    for (; along < len - 5; along += 1) { net.lanePoint(road, 1, along, off, p); if (Math.hypot(p.x - P.x, p.z - P.z) > 3) break; }
    return along < len - 5 ? { x: p.x, z: p.z } : null;
  });
  assert.ok(along >= len - 5, `walked ${along.toFixed(0)} of ${len.toFixed(0)} m across the bridge`);
  // Knocked down mid-river, on the deck: down on the deck, not on the riverbed beneath it.
  net.lanePoint(road, 1, len / 2, off, p);
  const fallen = walker(p.x, p.z);
  fallen.P.knockDown(2, 0);
  let lowest = 0;
  fallen.walk(2.5, P => { lowest = Math.min(lowest, P.y, P.human.y ?? 0); return null; });
  assert.equal(lowest, 0, 'stays on the deck');
  assert.equal(fallen.P.state, 'foot');
  // Down Nagina Ghat into the water: the feet follow the steps, and stop a metre in.
  const ghat = walker(215, 723), rd = city.riverDistance(215, 723);
  const water = { x: 215 - rd.nx * (rd.d + 20), z: 723 - rd.nz * (rd.d + 20) };
  ghat.walk(30, () => water);
  const at = city.riverDistance(ghat.P.x, ghat.P.z).d;
  assert.ok(at < -0.9 && at > -1.1, `stopped wading ${(-at).toFixed(2)} m in`);
  assert.ok(Math.abs(ghat.P.y - city.groundHeight(ghat.P.x, ghat.P.z)) < 0.01 && ghat.P.y < WATER_Y, `standing on the bank at ${ghat.P.y.toFixed(2)}`);
  // Out of a sinking car four metres into the river: walking to the bank gets out, and so does standing still.
  for (const toBank of [true, false]) {
    const w = walker(215 - rd.nx * (rd.d + 4), 723 - rd.nz * (rd.d + 4));
    w.walk(4, () => (toBank ? { x: 215, z: 723 } : null));
    const d = city.riverDistance(w.P.x, w.P.z).d;
    assert.ok(d > -1.05, `${toBank ? 'walking' : 'standing'}: ${(-d).toFixed(2)} m in after 4 s`);
  }
});

test('down on the riverbank, trees, buildings on their plinths and bridge piers stand in the way', () => {
  const { city } = world();
  const C = colliders(), T = city.trees, L = city.lots;
  // Walked into along the bank at the ground's own level, a trunk down the slope stops the walker.
  let trees = 0;
  for (let i = 0; i < T.count && trees < 12; i++) {
    if (city.groundHeight(T.x[i], T.z[i]) > -2) continue;
    const rd = city.riverDistance(T.x[i], T.z[i]), ax = -rd.nz, az = rd.nx;
    const from = { x: T.x[i] - ax * 4, z: T.z[i] - az * 4 }, to = { x: T.x[i] + ax * 4, z: T.z[i] + az * 4 };
    if (C.blocked(from.x, from.z, 0.34, city.groundHeight(from.x, from.z))) continue;
    const w = walker(from.x, from.z, city.groundHeight(from.x, from.z));
    let closest = Infinity;
    w.walk(4, P => { closest = Math.min(closest, Math.hypot(P.x - T.x[i], P.z - T.z[i])); return to; });
    assert.ok(closest > 0.6, `tree ${i}: walked within ${closest.toFixed(2)} m of the trunk`);
    trees++;
  }
  assert.ok(trees >= 10, `${trees} riverbank trees walked into`);
  // A building on the slope stands from its plinth's foot: its lowest corner is a wall to someone beside it.
  let lots = 0;
  for (let i = 0; i < L.count; i++) {
    const base = city.footing(i);
    if (base > -0.5) continue;
    const c = Math.cos(L.rot[i]), s = Math.sin(L.rot[i]);
    let low = { y: Infinity };
    for (const [u, v] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      const lx = u * (L.hw[i] + 0.2), lz = v * (L.hd[i] + 0.2), x = L.x[i] + lx * c + lz * s, z = L.z[i] - lx * s + lz * c;
      const y = city.groundHeight(x, z);
      if (y < low.y) low = { x, z, y };
    }
    assert.ok(base <= low.y + 0.5 && C.blocked(low.x, low.z, 0.34, low.y), `lot ${i} on its plinth at ${base.toFixed(2)}, the ground beside it at ${low.y.toFixed(2)}`);
    lots++;
  }
  assert.ok(lots >= 20, `${lots} buildings on plinths`);
  // Piers under the river bridges: in the way on the riverbed, out of the way on the deck above.
  let piers = 0;
  for (let i = 0; i < C.n; i++) {
    if (Math.abs(C.y0[i] + C.h[i] + 1.1) > 1e-4 || C.y0[i] > -2) continue; // a pier's top is the deck's underside
    const bed = city.groundHeight(C.x[i], C.z[i]);
    if (bed > -1.5) continue; // high up the bank the deck all but meets the ground: no room to walk under

    assert.ok(C.y0[i] < bed && C.blocked(C.x[i], C.z[i], 0.34, bed), `pier at ${C.x[i].toFixed(0)}, ${C.z[i].toFixed(0)} stands on the bed`);
    assert.ok(!C.blocked(C.x[i], C.z[i], 0.34, 0), 'and the deck runs over it');
    piers++;
  }
  assert.ok(piers > 50, `${piers} river bridge piers`);
});

test('out of a car against a bridge railing, or knocked toward a flyover\'s, you stay up on the deck', () => {
  const { net, city } = world();
  const p = {};
  // A hatchback on the wrong side of the two-way bridge on road 11, its driver's door against the
  // railing: the driver steps (or bails) out of the other door, onto the deck.
  let exits = 0;
  for (let s = 10; s < net.length[11] - 10; s += 7) {
    net.pointAt(11, s, p);
    if (city.riverDistance(p.x, p.z).d > -3) continue;
    for (const speed of [0, 10]) {
      const v = createBody('hatch', 0, 0, 0), off = net.edgeAt(11, s, -1) - v.hw - 0.05;
      Object.assign(v, { x: p.x - p.dz * off, z: p.z + p.dx * off, heading: Math.atan2(p.dx, p.dz), vx: p.dx * speed, vz: p.dz * speed });
      v.model = { seat: { x: -0.36, y: 0.5, z: -0.2 } };
      const w = walker(v.x, v.z, 0);
      w.P.vehicle = v; w.P.state = 'driving';
      w.P.leaveVehicle();
      let lowest = w.P.y;
      w.walk(3, P => { lowest = Math.min(lowest, P.y); return null; });
      assert.equal(lowest, 0, `${speed ? 'bailed' : 'stepped'} out ${s.toFixed(0)} m along: on the deck`);
      exits++;
    }
  }
  assert.ok(exits >= 20, `${exits} exits over the water`);
  // Knocked sideways at 8 m/s a metre in from a full-height deck's kerb: the railing holds.
  let decks = 0;
  for (let r = 0; r < net.count && decks < 40; r++) {
    if (!net.raised[r]) continue;
    for (let s = 0; s < net.length[r]; s += 24) {
      const d = net.deckAt(r, s);
      if (d < DECK_H - 0.05) continue;
      net.pointAt(r, s, p);
      for (const side of [1, -1]) {
        const off = side * (net.edgeAt(r, s, side) - 1), x = p.x + p.dz * off, z = p.z - p.dx * off;
        if (Math.abs(net.surfaceAt(x, z, d) - d) > 0.05) continue;
        const w = walker(x, z, d);
        w.P.knockDown(p.dz * side * 8, -p.dx * side * 8, 1.6);
        let lowest = d;
        w.walk(2, P => { lowest = Math.min(lowest, P.y); return null; });
        assert.ok(lowest > d - 0.5, `road ${r} at ${s} m: knocked off the deck to ${lowest.toFixed(2)}`);
        decks++;
      }
    }
  }
  assert.ok(decks >= 30, `${decks} knockdowns on a deck`);
});
