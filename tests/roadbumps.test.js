import { test } from 'node:test';
import assert from 'node:assert/strict';
import { world } from './helpers.js';
import { BUMP_H, BUMP_LEN, humpAt } from '../src/world/roadbumps.js';
import { Vehicles } from '../src/actors/vehicles.js';
import { createBody } from '../src/actors/vehicle-physics.js';

test('speed breakers stand on ordinary streets, never on a flyover, a bridge or a level crossing', () => {
  const { net, city } = world();
  const B = city.bumps;
  assert.ok(B.bumps.length > 600, `${B.bumps.length} speed breakers`);
  for (const b of B.bumps) {
    assert.ok(!net.raised[b.road] && !net.bridge[b.road], `breaker on road ${b.road} is on the ground`);
    assert.ok(b.s >= net.trimStart(b.road) + 6 && b.s <= net.length[b.road] - net.trimEnd(b.road) - 6, 'clear of the junction pads');
    assert.ok(city.railDistance(b.x, b.z) >= 9, 'clear of the railway');
  }
  // Breakers on one road keep apart, and lanes find the next one ahead in either direction.
  for (const [road, list] of B.byRoad) {
    for (let i = 1; i < list.length; i++) assert.ok(list[i] - list[i - 1] >= 35, `road ${road}`);
    const len = net.length[road], s = list[0] - 10;
    assert.ok(Math.abs(B.ahead(road, 1, s, 30) - 10) < 1e-6);
    assert.ok(Math.abs(B.ahead(road, -1, len - list[0] - 10, 30) - 10) < 1e-6);
    assert.equal(B.ahead(road, 1, list[list.length - 1] + 5, 30), Infinity, 'none behind');
  }
});

test('schools, colleges and hospitals have speed breakers by their gates', () => {
  const { city } = world();
  const gates = city.places.filter(p => ['school', 'college', 'hospital'].includes(p.category));
  let near = 0;
  for (const p of gates) if (city.bumps.bumps.some(b => Math.hypot(b.x - p.ax, b.z - p.az) < 40)) near++;
  assert.ok(near / gates.length > 0.6, `${near} of ${gates.length} gates`);
});

test('a speed breaker is a smooth hump across the whole carriageway', () => {
  const { city } = world();
  const B = city.bumps, b = B.bumps[0];
  assert.equal(humpAt(0), BUMP_H);
  assert.equal(humpAt(BUMP_LEN / 2), 0);
  assert.ok(Math.abs(humpAt(0.4) - humpAt(-0.4)) < 1e-12, 'symmetric');
  const at = (u, v) => B.heightAt(b.x + b.dx * u + b.dz * v, b.z + b.dz * u - b.dx * v);
  assert.ok(Math.abs(at(0, 0) - BUMP_H) < 1e-9, 'full height on the crest');
  assert.ok(Math.abs(at(0, b.left - 0.1) - BUMP_H) < 1e-9 && Math.abs(at(0, -b.right + 0.1) - BUMP_H) < 1e-9, 'kerb to kerb');
  assert.equal(at(BUMP_LEN, 0), 0, 'flat road beyond it');
  assert.equal(at(0, b.left + 1), 0, 'nothing beside the road');
});

test('potholes lie in the carriageway, off the speed breakers', () => {
  const { net, city } = world();
  const B = city.bumps, p = {};
  assert.ok(B.holes.length > 1000, `${B.holes.length} potholes`);
  for (const h of B.holes) {
    const n = net.nearest(h.x, h.z, 12, p, r => r === h.road);
    assert.ok(n && n.dist + h.r < net.width[h.road] / 2 + 0.05, 'inside the road');
    assert.equal(B.heightAt(h.x, h.z, 3), 0, 'not on a breaker');
    assert.equal(B.holeAt(h.x, h.z), h);
  }
});

/** Roll a car straight across the first breaker at `kmh`; report how it rode. */
function rideOver(kmh) {
  const { city } = world();
  const b = city.bumps.bumps.find(o => o.left > 2 && o.right > 2);
  const events = [];
  const host = { city, onBump: (v, speed, hole) => events.push({ speed, hole }) };
  const heading = Math.atan2(b.dx, b.dz), v = createBody('hatch', b.x - b.dx * 15, b.z - b.dz * 15, heading);
  const speed = kmh / 3.6, h = 1 / 120;
  v.vx = Math.sin(heading) * speed; v.vz = Math.cos(heading) * speed;
  let lift = 0, air = 0;
  for (let t = 0; t < 30 / speed; t += h) {
    v.x += v.vx * h; v.z += v.vz * h;
    Vehicles.prototype._ride.call(host, v, h);
    lift = Math.max(lift, v.hop - v.base);
    if (v.air) air += h;
  }
  return { lift, air, events, settled: v.hop };
}

test('a speed breaker taken slowly rolls the car over it; taken fast, the car flies and lands with a thud', () => {
  const slow = rideOver(10);
  assert.ok(slow.lift < 0.01, `slow lift ${slow.lift}`);
  assert.equal(slow.events.length, 0);
  const fast = rideOver(70);
  assert.ok(fast.lift > 0.1 && fast.air > 0.2, `fast: ${fast.lift.toFixed(2)} m up, ${fast.air.toFixed(2)} s in the air`);
  assert.ok(fast.events.some(e => !e.hole && e.speed > 1.6), 'a landing thud');
  assert.equal(fast.settled, 0, 'back on the road after');
});

test('a wheel dropping into a pothole jolts the car', () => {
  const { city } = world();
  const hole = city.bumps.holes.find(h => h.r > 0.6);
  const events = [], host = { city, onBump: (v, speed, isHole) => events.push(isHole) };
  // A scooter (one track) aimed straight through it at 40 km/h.
  const v = createBody('scooter', hole.x, hole.z - 10, 0);
  v.vz = 40 / 3.6;
  for (let t = 0; t < 1.5; t += 1 / 120) { v.z += v.vz / 120; Vehicles.prototype._ride.call(host, v, 1 / 120); }
  assert.deepEqual(events, [true]);
});
