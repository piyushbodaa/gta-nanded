import { test } from 'node:test';
import assert from 'node:assert/strict';
import { world } from './helpers.js';
import { Colliders } from '../src/world/colliders.js';
import { Peds } from '../src/actors/peds.js';
import { WALK_Y } from '../src/world/citygen.js';

// A minimal game around the real city, colliders and pedestrian system.
function crowd(x, z, seed) {
  const { city, net } = world();
  const colliders = crowd.colliders || (crowd.colliders = new Colliders(city));
  const n = net.nearest(x, z, 60, {});
  const humans = [];
  const g = {
    net, city, colliders, time: 0, police: null, hud: null,
    quality: { settings: { peds: 60 } },
    humans: { add(outfit, hx, hz) { const h = { outfit, x: hx, y: 0, z: hz, yaw: 0, t: 0, pose: 'idle', speed: 0, pitch: 0, lookYaw: 0 }; humans.push(h); return h; }, remove() {} },
    vehicles: { list: [] },
    player: { x: n.x, z: n.z, state: 'foot', get pos() { return this; } },
  };
  let s = seed >>> 0;
  const random = Math.random;
  Math.random = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  const peds = new Peds(g);
  return { g, peds, restore: () => { Math.random = random; } };
}

const STREETS = [['Shyam Nagar', -54.5, -849], ['Old Mondha', 517.7, 600.5], ['Station Road', 159.8, 375.2]];

test('pedestrians never stand inside walls, posts, stalls or shop platforms', () => {
  for (const [name, x, z] of STREETS) {
    const { g, peds, restore } = crowd(x, z, 99);
    const probe = { x: 0, z: 0 }, o = {};
    let checks = 0, inside = 0, worst = 0;
    try {
      for (let f = 0; f < 900; f++) {
        g.time += 1 / 30;
        peds.update(1 / 30);
        if (f < 30) continue;
        for (const p of peds.list) {
          probe.x = p.h.x; probe.z = p.h.z;
          checks++;
          if (g.colliders.resolveCircle(probe, 0.2, o)) {
            const d = Math.hypot(probe.x - p.h.x, probe.z - p.h.z);
            if (d > 0.05) { inside++; worst = Math.max(worst, d); }
          }
        }
      }
    } finally { restore(); }
    assert.ok(checks > 5000, `${name}: ${checks} checks`);
    assert.ok(inside / checks < 0.002, `${name}: ${inside} of ${checks} person-frames inside an obstacle (worst ${worst.toFixed(2)} m)`);
  }
});

test('walkers keep walking: blocked people step round or turn back', () => {
  const [, x, z] = STREETS[1];
  const { g, peds, restore } = crowd(x, z, 7);
  const start = new Map();
  try {
    for (let f = 0; f < 1200; f++) {
      g.time += 1 / 30;
      peds.update(1 / 30);
      if (f === 300) for (const p of peds.list) start.set(p, [p.h.x, p.h.z]);
    }
  } finally { restore(); }
  let walkers = 0, frozen = 0;
  for (const p of peds.list) {
    if (!start.has(p) || p.state !== 'walk') continue;
    walkers++;
    const [sx, sz] = start.get(p);
    if (Math.hypot(p.h.x - sx, p.h.z - sz) < 2) frozen++;
  }
  assert.ok(walkers > 15, `${walkers} walkers`);
  assert.ok(frozen <= walkers * 0.05, `${frozen} of ${walkers} walkers barely moved in 30 s`);
});

test('people step round each other instead of walking through', () => {
  for (const [name, x, z] of STREETS) {
    const { g, peds, restore } = crowd(x, z, 31);
    let personFrames = 0, overlaps = 0;
    try {
      for (let f = 0; f < 1200; f++) {
        g.time += 1 / 30;
        peds.update(1 / 30);
        if (f < 30) continue;
        const L = peds.list.filter(p => p.state !== 'down' && p.state !== 'dead');
        personFrames += L.length;
        for (let i = 0; i < L.length; i++) for (let j = i + 1; j < L.length; j++) if (Math.hypot(L[i].h.x - L[j].h.x, L[i].h.z - L[j].h.z) < 0.35) overlaps++;
      }
    } finally { restore(); }
    assert.ok(overlaps / personFrames < 0.0005, `${name}: ${overlaps} overlapping pairs in ${personFrames} person-frames`);
  }
});

test('the same seed gives the same crowd', () => {
  const run = () => {
    const { g, peds, restore } = crowd(STREETS[0][1], STREETS[0][2], 1234);
    try { for (let f = 0; f < 300; f++) { g.time += 1 / 30; peds.update(1 / 30); } } finally { restore(); }
    return peds.list.map(p => `${p.h.x.toFixed(4)},${p.h.z.toFixed(4)},${p.state}`).join('|');
  };
  assert.equal(run(), run());
});

test('walkers on a street with a footpath walk on top of it, not 20 cm inside it', () => {
  const { city, net } = world();
  // The footpath band of a street that has one: on the paving, then out on the road.
  let seg = -1;
  for (let i = 0; i < net.px.length - 1 && seg < 0; i++) if (net.ptRoad[i] === net.ptRoad[i + 1] && city.footpathAt(i)) seg = i;
  const hw = net.width[net.ptRoad[seg]] / 2;
  assert.equal(city.pavementAt(seg, hw + 0.95), WALK_Y, 'the middle of the footpath');
  assert.equal(city.pavementAt(seg, hw - 1), 0, 'the road');
  // A crowd on Station Road: whoever walks the footpath is up on it.
  const { g, peds, restore } = crowd(159.8, 375.2, 7);
  let onPath = 0, sunk = 0;
  try {
    for (let f = 0; f < 300; f++) {
      g.time += 1 / 30;
      peds.update(1 / 30);
      if (f < 30) continue;
      for (const p of peds.list) {
        if (p.state !== 'walk') continue;
        const n = net.nearest(p.h.x, p.h.z, 14, {});
        if (!n || city.pavementAt(n.seg, n.dist) === 0) continue;
        onPath++;
        if (p.h.y < WALK_Y - 0.01) sunk++;
      }
    }
  } finally { restore(); }
  assert.ok(onPath > 100, `${onPath} walker-frames on footpaths`);
  assert.ok(sunk <= onPath * 0.02, `${sunk} of ${onPath} walker-frames sunk into the footpath`);
});
