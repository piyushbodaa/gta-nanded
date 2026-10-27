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

// One person, made the way the game makes them, and their frames run one by one.
function person(g, peds, x, z, state = 'walk') {
  const h = g.humans.add(peds.randomOutfit(x), x, z);
  const p = peds._make(h, x, z, null);
  p.state = state;
  return p;
}
const run = (peds, p, seconds, dt = 1 / 30, each) => { for (let t = 0; t < seconds; t += dt) { peds.game.time += dt; peds._update(p, dt); each?.(p); } };
// The footpath under (x, z), if any.
const pavement = (x, z) => { const { city, net } = world(); const n = net.nearest(x, z, 14, {}, r => !net.raised[r]); return n ? city.pavementAt(n.seg, n.dist) : 0; };

test('people stand on the footpath whatever they are doing, and the fallen land on it', () => {
  const { g, peds, restore } = crowd(159.8, 375.2, 7); // Station Road
  let idle = 0, sunk = 0, knocked = 0, buried = 0;
  try {
    for (let f = 0; f < 300; f++) {
      g.time += 1 / 30;
      peds.update(1 / 30);
      if (f === 60) {
        // Knock a few walkers off their feet where they stand on the paving.
        for (const p of peds.list) if (p.state === 'walk' && pavement(p.h.x, p.h.z) === WALK_Y && knocked < 4) { peds.knock(p, 0, 0, 3, 'explosion'); p.watch = true; knocked++; }
      }
      if (f < 30) continue;
      for (const p of peds.list) {
        if (p.state === 'walk' || pavement(p.h.x, p.h.z) !== WALK_Y) continue;
        if (p.watch && p.state === 'down' && p.t < 2) { if (p.h.y < WALK_Y - 0.01) buried++; continue; }
        if (p.state === 'down') continue;
        idle++;
        if (p.h.y < WALK_Y - 0.01) sunk++;
      }
    }
  } finally { restore(); }
  assert.ok(knocked > 0 && idle > 100, `${knocked} knocked down, ${idle} person-frames standing about on the footpath`);
  assert.equal(buried, 0, 'the knocked down lie on the paving, not in it');
  assert.ok(sunk <= idle * 0.02, `${sunk} of ${idle} person-frames sunk into the footpath`);
});

test('pulled off a vehicle on a flyover, a person lands on its deck and gets about up there', () => {
  const { net } = world();
  const r = 41, s = net.length[r] / 2, deck = net.deckAt(r, s), pt = net.pointAt(r, s, {});
  assert.ok(deck > 5, `deck ${deck}`);
  const { g, peds, restore } = crowd(pt.x, pt.z, 3);
  g.player.x = pt.x + 60; g.player.z = pt.z; // far enough for them to run off, then calm down
  try {
    // A rider's seat, by the kerb of the deck: at its height, leaning with the bike.
    const h = g.humans.add(peds.randomOutfit(1), pt.x + pt.dz * 1.5, pt.z - pt.dx * 1.5);
    h.y = deck; h.roll = -0.35;
    peds.adoptEjected(h, null, g.player);
    const q = peds.list.at(-1);
    assert.equal(q.h.roll, 0, 'upright, not leaning with the bike');
    let fell = 0, onDeck = 0, frames = 0;
    run(peds, q, 40, 1 / 30, a => {
      frames++;
      // Over the deck (or down its ramp): on it, not below it.
      const top = net.surfaceAt(a.h.x, a.h.z, deck);
      if (top > 1.5) { onDeck++; if (a.h.y < top - 0.3) fell++; }
    });
    assert.ok(onDeck > frames * 0.5, `${onDeck} of ${frames} frames over the deck`);
    assert.equal(fell, 0, `${fell} frames under the deck`);
    assert.ok(q.state === 'walk' && net.raised[q.road], `walking the flyover they are on (${q.state}, road ${q.road})`);
  } finally { restore(); }
});

test('walkers set back on a street at ground level never get a flyover or bridge overhead', () => {
  const { net } = world();
  const { g, peds, restore } = crowd(0, 0, 5);
  let checked = 0;
  try {
    for (let r = 0; r < net.count; r++) {
      if (!net.raised[r] || net.deckAt(r, net.length[r] / 2) < 3) continue;
      const pt = net.pointAt(r, net.length[r] / 2, {});
      const p = person(g, peds, pt.x, pt.z);
      peds._resnap(p);
      checked++;
      assert.ok(p.road != null && !net.raised[p.road] && !net.bridge[p.road], `under road ${r}: given road ${p.road}`);
    }
  } finally { restore(); }
  assert.ok(checked > 10, `${checked} flyovers`);
});

test('someone who ran off across open ground walks back to a street', () => {
  const { net } = world();
  const street = r => !net.raised[r] && !net.bridge[r];
  const { g, peds, restore } = crowd(-215.2, 632.3, 9);
  try {
    const p = person(g, peds, -215.2, 632.3);
    assert.equal(net.nearest(p.h.x, p.h.z, 30, {}, street), null, 'more than 30 m from any street');
    p.speed = 1.3; p.h.pose = 'run'; p.h.speed = 5.6;
    run(peds, p, 1);
    assert.ok(p.road != null && p.h.pose === 'walk', `on their way (${p.road}, ${p.h.pose})`);
    run(peds, p, 40);
    const n = net.nearest(p.h.x, p.h.z, 60, {}, street);
    assert.ok(n && n.dist < net.width[n.road] / 2 + 3, `back at a street (${n?.dist.toFixed(1)} m from its middle)`);
  } finally { restore(); }
});

test('out of a fight the fists come down, and out of a chat the head turns back', () => {
  const { g, peds, restore } = crowd(517.7, 600.5, 4);
  try {
    // Mid-punch when the player jumps into a car.
    const p = person(g, peds, g.player.x + 0.9, g.player.z, 'fight');
    p.t = 8; p.cool = 0;
    run(peds, p, 0.1);
    assert.ok(p.h.punch > 0, 'swinging');
    g.player.state = 'driving';
    run(peds, p, 0.1);
    assert.ok(p.state !== 'fight' && p.h.punch === 0 && !(p.punchT > 0), `${p.state}, punch ${p.h.punch}`);
    // Looking at the player while they stand close, then off on their way.
    g.player.state = 'foot';
    const q = person(g, peds, g.player.x + 1.5, g.player.z + 1, 'idle');
    q.t = 0.5; q.h.yaw = 0;
    run(peds, q, 0.2);
    assert.ok(Math.abs(q.h.lookYaw) > 0.3, `looking (${q.h.lookYaw})`);
    run(peds, q, 0.5);
    assert.ok(q.state !== 'idle' && q.h.lookYaw === 0, `${q.state}, look ${q.h.lookYaw}`);
  } finally { restore(); }
});

test('foot cops chase however far the player runs, and when they drive off', () => {
  const { g, peds, restore } = crowd(517.7, 600.5, 6);
  try {
    for (const driving of [false, true]) {
      g.player.state = driving ? 'driving' : 'foot';
      const p = person(g, peds, g.player.x + 30, g.player.z, 'fight');
      p.cop = true; p.keep = true; p.t = 30;
      const d0 = Math.hypot(p.h.x - g.player.x, p.h.z - g.player.z);
      run(peds, p, 2);
      const d1 = Math.hypot(p.h.x - g.player.x, p.h.z - g.player.z);
      assert.ok(p.state === 'fight' && d0 - d1 > 4, `${driving ? 'driving' : 'on foot'}: ${p.state}, ${d0.toFixed(1)} -> ${d1.toFixed(1)} m`);
    }
  } finally { restore(); }
});

test('a car throws people off to its side, along the car\'s side', () => {
  const { net } = world();
  const n = net.nearest(517.7, 600.5, 60, {});
  const { g, peds, restore } = crowd(n.x, n.z, 8);
  try {
    // Heading east (+x); its left side is -z. Someone just left of its nose.
    const v = { x: n.x, z: n.z, y: 0, heading: Math.PI / 2, vx: 10, vz: 0, hw: 0.86, hd: 2.1, role: 'traffic' };
    g.vehicles.list.push(v);
    const p = person(g, peds, n.x + 1.5, n.z - 0.6);
    run(peds, p, 1 / 30);
    assert.equal(p.state, 'down');
    assert.ok(p.vz < -0.5 && Math.abs(p.vx - 9) < 0.3, `thrown (${p.vx.toFixed(2)}, ${p.vz.toFixed(2)})`);
  } finally { restore(); }
});

test('a fare waving at the kerb holds their ground, and goes back to waving at their spot after a scare', () => {
  const { net } = world();
  const n = net.nearest(159.8, 375.2, 60, {});
  const { g, peds, restore } = crowd(n.x, n.z, 2);
  try {
    const off = net.width[n.road] / 2 + 0.6, x = n.x + n.dz * off, z = n.z - n.dx * off;
    const p = person(g, peds, x, z, 'hail');
    p.keep = true;
    // The player's auto comes in along the kerb at speed.
    const v = { x: x - n.dx * 8 - n.dz * 1.2, z: z - n.dz * 8 + n.dx * 1.2, y: 0, heading: Math.atan2(n.dx, n.dz), vx: n.dx * 10, vz: n.dz * 10, hw: 0.66, hd: 1.4, role: 'player' };
    g.vehicles.list.push(v);
    run(peds, p, 0.1);
    assert.equal(p.state, 'hail', 'no dive');
    g.vehicles.list.length = 0;
    // Knocked flying, they pick themselves up, get away, and come back.
    g.player.x = x + 50; g.player.z = z;
    peds.knock(p, 6, 0, 2, 'vehicle');
    let left = 0;
    run(peds, p, 60, 1 / 30, q => { left = Math.max(left, Math.hypot(q.h.x - x, q.h.z - z)); });
    assert.ok(left > 2, `moved off (${left.toFixed(1)} m)`);
    assert.equal(p.state, 'hail');
    assert.ok(Math.hypot(p.h.x - x, p.h.z - z) < 0.6, `back at the spot (${Math.hypot(p.h.x - x, p.h.z - z).toFixed(2)} m)`);
  } finally { restore(); }
});

test('people thrown at a compound wall on a phone\'s long frames stop at it', () => {
  const { g, peds, restore } = crowd(0, 0, 11);
  const C = g.colliders, probe = { x: 0, z: 0 }, o = {};
  let thrown = 0, through = 0;
  try {
    for (let i = 0; i < C.type.length && thrown < 60; i += 7) {
      if (Math.abs(C.hd[i] - 0.12) > 1e-4 || Math.abs(C.h[i] - 1.25) > 1e-4) continue; // a compound wall
      const c = C.c[i], s = C.s[i], x = C.x[i] - s * 1.2, z = C.z[i] - c * 1.2;
      probe.x = x; probe.z = z;
      if (C.resolveCircle(probe, 0.35, o)) continue;
      const p = person(g, peds, x, z);
      g.player.x = x + 40; g.player.z = z;
      peds.knock(p, s * 16, c * 16, 2, 'vehicle');
      run(peds, p, 1);
      thrown++;
      if ((p.h.x - C.x[i]) * s + (p.h.z - C.z[i]) * c > 0) through++;
      peds.remove(p);
    }
  } finally { restore(); }
  assert.ok(thrown >= 30, `${thrown} throws`);
  assert.equal(through, 0, `${through} of ${thrown} went through the wall`);
});
