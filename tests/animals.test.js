import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { world, place } from './helpers.js';
import { Colliders } from '../src/world/colliders.js';
import { Animals } from '../src/actors/animals.js';
import { createBody } from '../src/actors/vehicle-physics.js';
import { WALK_Y } from '../src/world/citygen.js';
import { WATER_Y } from '../src/world/water.js';

// The cows and dogs of the real city, with a stand-in for the rest of the game.
function herd(x, z, settings = {}) {
  const { city, net } = world();
  const colliders = herd.colliders || (herd.colliders = new Colliders(city));
  const sfx = [];
  const g = {
    scene: new THREE.Scene(), net, city, colliders, sfx,
    quality: { settings: { peds: 60, dynamicShadows: false, ...settings } },
    player: { x, z, state: 'foot', vehicle: null, get pos() { return this; } },
    vehicles: { list: [] }, camera3: { position: { x, z } },
    audio: { sfx: n => sfx.push(n), moo() {}, bark() {} }, camera: { addShake() {} }, hud: { bark() {} },
  };
  return { g, animals: new Animals(g) };
}
const sittingCow = (x, z) => ({ cow: true, x, z, y: 0, heading: 0, speed: 0, state: 'sit', t: 1e3, color: 0xffffff, scale: 1, phase: 0, id: 1, bark: 0 });

test('a car driven into a cow stops at it; one brushing past is nudged aside, not along', () => {
  const { g, animals } = herd(0, 0);
  // Head on at 43 km/h, just touching: the car stops (and bounces a little), and it hurts.
  const v = createBody('sedan', 0, 0, 0);
  v.role = 'player'; v.kinematic = false;
  v.z = -(v.hd + 1.0 - 0.1); v.vz = 12;
  g.vehicles.list.push(v);
  const cow = sittingCow(0, 0), z0 = v.z;
  animals._step(cow, 1 / 60);
  assert.ok(v.vz <= 0 && Math.abs(v.z - (z0 - 0.1)) < 1e-6, `stopped at the cow (vz ${v.vz.toFixed(2)}, pushed ${(z0 - v.z).toFixed(2)} m)`);
  assert.ok(v.health < 1000 && g.sfx.includes('crash'), 'a crash');
  // Backing away from it: nothing happens.
  v.z = z0; v.vz = -6; v.health = 1000; g.sfx.length = 0;
  animals._step(cow, 1 / 60);
  assert.ok(v.vz === -6 && v.health === 1000 && !g.sfx.length, `reversing away (vz ${v.vz}, health ${v.health})`);
  // Driving past with the cow just inside its flank: eased aside, never thrown along its length.
  v.x = -(v.hw + 0.4); v.z = 0.3; v.vx = 0; v.vz = 8;
  animals._step(cow, 1 / 60);
  assert.ok(Math.abs(v.z - 0.3) < 1e-9 && Math.abs(v.x + v.hw + 0.55) < 1e-6 && v.vz === 8, `flank (${v.x.toFixed(2)}, ${v.z.toFixed(2)}, vz ${v.vz})`);
  // Traffic (driven by its own code, which waits for cows) isn't pushed: the cow steps round it.
  v.kinematic = true; v.role = 'traffic'; v.x = -(v.hw + 0.4); v.z = 0.3;
  animals._step(cow, 1 / 60);
  assert.ok(v.x === -(v.hw + 0.4) && v.z === 0.3, 'traffic stays where it is');
  assert.ok(Math.abs(cow.x - 0.15) < 1e-6 && cow.z === 0, `the cow moved over (${cow.x.toFixed(2)}, ${cow.z})`);
});

test('cows and dogs set off along the street, one way or the other', () => {
  const { net } = world();
  const { animals } = herd(0, 0);
  for (const [x, z] of [[0, 0], [517.7, 600.5], [159.8, 375.2], [-54.5, -849], [1289, -947]]) for (let k = 0; k < 30; k++) animals._spawn({ x, z });
  assert.ok(animals.list.length > 40, `${animals.list.length} animals`);
  // Along a stretch of the street they stand by (a street that bends or doubles back has others).
  for (const a of animals.list) {
    let along = false;
    net.segmentsIn(a.x - 5, a.z - 5, a.x + 5, a.z + 5, (i, r) => {
      if (r !== a.road || net.ptRoad[i + 1] !== r) return;
      const dx = net.px[i + 1] - net.px[i], dz = net.pz[i + 1] - net.pz[i], l = Math.hypot(dx, dz);
      if (Math.abs(Math.sin(a.heading) * dz - Math.cos(a.heading) * dx) / l < 0.05) along = true;
    });
    assert.ok(along, `road ${a.road}: heading ${a.heading.toFixed(2)} across it`);
  }
});

test('animals stand on footpaths and riverbanks, and stop at the water', () => {
  const { city, net, data } = world();
  // On Station Road's footpaths, up on the paving.
  const { animals } = herd(159.8, 375.2);
  for (let k = 0; k < 60; k++) animals._spawn({ x: 159.8, z: 375.2 });
  let onPath = 0;
  for (const a of animals.list) {
    const n = net.nearest(a.x, a.z, 14, {}, r => !net.raised[r]);
    if (city.pavementAt(n.seg, n.dist) !== WALK_Y) continue;
    onPath++;
    assert.equal(a.y, WALK_Y);
  }
  assert.ok(onPath > 3, `${onPath} on footpaths`);
  // Walked down a ghat toward the Godavari: on the slope, and no further than the water's edge.
  const ghat = place(data, 'govardhan-ghat'), r = {};
  const d0 = city.riverDistance(ghat.x, ghat.z, r).d;
  const down = Math.atan2(d0 - city.riverDistance(ghat.x + 1, ghat.z, r).d, d0 - city.riverDistance(ghat.x, ghat.z + 1, r).d);
  const river = herd(ghat.x + 300, ghat.z).animals;
  for (let k = 0; k < 6; k++) {
    const a = { ...sittingCow(ghat.x + k, ghat.z - k), cow: k % 2 === 0, state: 'walk', heading: down + (k - 3) * 0.15 };
    assert.ok(river._settle(a));
    let lowest = 0;
    for (let f = 0; f < 60 * 30; f++) {
      river._step(a, 1 / 30);
      lowest = Math.min(lowest, a.y);
      assert.ok(city.groundHeight(a.x, a.z) > WATER_Y, `in the river at (${a.x.toFixed(1)}, ${a.z.toFixed(1)})`);
    }
    assert.ok(lowest < -2, `down the bank (lowest ${lowest.toFixed(2)})`);
  }
});

test('animals cast shadows only where the shadow map follows them, and send only what is in use', () => {
  for (const dynamicShadows of [false, true]) {
    const { g, animals } = herd(517.7, 600.5, { dynamicShadows });
    for (let f = 0; f < 40; f++) animals.update(1 / 30);
    assert.ok(animals.list.length > 3, `${animals.list.length} animals`);
    for (const k in animals.parts) assert.equal(animals.parts[k].castShadow, dynamicShadows, `${k} casts: ${animals.parts[k].castShadow}`);
    const legs = animals.parts.leg;
    assert.ok(legs.count > 0);
    assert.deepEqual(legs.instanceMatrix.updateRanges, [{ start: 0, count: legs.count * 16 }]);
    assert.deepEqual(legs.instanceColor.updateRanges, [{ start: 0, count: legs.count * 3 }]);
    void g;
  }
});
