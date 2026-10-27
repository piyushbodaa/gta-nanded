import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { world } from './helpers.js';
import { PROP, CHUNK, WALK_Y, FOOTPATH_W, BENCH } from '../src/world/citygen.js';
import { Colliders } from '../src/world/colliders.js';
import { ChunkManager } from '../src/world/chunks.js';
import { obbOverlap, pointSegDist2 } from '../src/core/math.js';

// What stands along the streets faces them, and stays out of their lanes.

test('tea stalls, shrines and hoardings face the street; lamps on bridges reach over the deck', () => {
  const { city, net } = world();
  const P = city.props, near = {}, seen = {};
  for (let i = 0; i < P.count; i++) {
    const k = P.kind[i], deck = k === PROP.LAMP && (net.bridge[P.road[i]] || net.raised[P.road[i]]);
    if (k !== PROP.STALL && k !== PROP.SHRINE && k !== PROP.HOARDING && !deck) continue;
    // buildProp draws their fronts (a lamp's arm and light) on local -z. Measured to the nearest
    // point of their road, which on a bend is not quite square to where they were set out.
    const n = net.nearest(P.x[i], P.z[i], 30, near, r => r === P.road[i]);
    const tx = n.x - P.x[i], tz = n.z - P.z[i], l = Math.hypot(tx, tz) || 1;
    const facing = -(tx * Math.sin(P.rot[i]) + tz * Math.cos(P.rot[i])) / l;
    assert.ok(facing > 0.25, `prop ${i} (kind ${k}) turned ${Math.round(Math.acos(Math.max(-1, Math.min(1, facing))) * 57.3)}° from its road`);
    seen[k] = (seen[k] || 0) + 1;
  }
  for (const k of [PROP.STALL, PROP.SHRINE, PROP.HOARDING, PROP.LAMP]) assert.ok(seen[k] > 20, `${seen[k]} props of kind ${k}`);
});

test('no street lamp or electric pole stands in the lane of a road beside its own', () => {
  const { city, net } = world();
  const P = city.props, t = [0];
  // How far (x, z) is outside the carriageway of every road but `own` whose surface there is
  // within 2 m of height y (a lamp collider stands from y; a deck above or below passes it by).
  // Measured to the edge on its side: a divided road's carriageway stops at its median.
  const offOthers = (x, z, y, own) => {
    let best = Infinity, who = -1;
    net.grid.query(x - 2, z - 2, x + 2, z + 2, k => {
      const o = net.ptRoad[k];
      if (o === own) return;
      const ax = net.px[k], az = net.pz[k], dx = net.px[k + 1] - ax, dz = net.pz[k + 1] - az;
      const d = Math.sqrt(pointSegDist2(x, z, ax, az, ax + dx, az + dz, t));
      const s = net.cum[k] + (net.cum[k + 1] - net.cum[k]) * t[0];
      if (Math.abs(net.deckAt(o, s) - y) >= 2) return;
      const side = (x - ax - dx * t[0]) * dz - (z - az - dz * t[0]) * dx >= 0 ? 1 : -1;
      const c = d - net.edgeAt(o, s, side);
      if (c < best) { best = c; who = o; }
    });
    return [best, who];
  };
  const n = { side: 0, deck: 0, median: 0 };
  for (let i = 0; i < P.count; i++) {
    const k = P.kind[i], road = P.road[i], what = `prop ${i} (kind ${k}, road ${road})`;
    if (k === PROP.MEDIAN_LAMP) {
      // Down a median: its 0.3 m post reaches into no other road's lane.
      const [c, o] = offOthers(P.x[i], P.z[i], P.y[i], road);
      assert.ok(c >= 0.3 - 1e-6, `${what} ${c.toFixed(2)} m from road ${o}'s lane`);
      n.median++;
    } else if (k === PROP.LAMP && (net.bridge[road] || net.raised[road])) {
      // A bridge's or flyover's lamps stand on its parapet, inside their own road's edge, but
      // clear of every other road at their height (a street beside a bridge's end, or along a
      // flyover's ramp or its stretch back down at street level).
      const [c, o] = offOthers(P.x[i], P.z[i], P.y[i], road);
      assert.ok(c >= 0.4 - 1e-6, `${what} at ${P.y[i].toFixed(1)} m stands ${c.toFixed(2)} m from road ${o}'s lane`);
      n.deck++;
    } else if (k === PROP.LAMP || k === PROP.POLE) {
      // The rest stand beside the street, clear of every carriageway.
      const clear = net.roadClearance(P.x[i], P.z[i], 10);
      assert.ok(clear >= 0.4 - 1e-6, `${what} ${clear.toFixed(2)} m from a road edge`);
      n.side++;
    }
  }
  assert.ok(n.side > 10000 && n.deck > 300 && n.median > 400, JSON.stringify(n));
});

test('a tea stall\'s bench stands past the footpath and its walkers, and is as solid as it looks', () => {
  const { city, net } = world();
  const P = city.props, C = new Colliders(city);
  let stalls = 0, benches = 0;
  for (let i = 0; i < P.count; i++) {
    if (P.kind[i] !== PROP.STALL) continue;
    stalls++;
    const side = city.stallBench(i);
    if (!side) continue;
    benches++;
    const c = Math.cos(P.rot[i]), s = Math.sin(P.rot[i]), at = (lx, lz) => [P.x[i] + lx * c + lz * s, P.z[i] - lx * s + lz * c];
    // Every corner of the seat is past a footpath (1.9 m) of every street, so beyond the walkers' line
    // (0.95 m out, or a sidestep round the stall toward the road) and out of every carriageway.
    for (const [a, b] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const [x, z] = at(side * BENCH.x + a * BENCH.hw, BENCH.z + b * BENCH.hd), clear = net.roadClearance(x, z, 10);
      assert.ok(clear >= FOOTPATH_W - 0.05 - 1e-6, `stall ${i}'s bench ${clear.toFixed(2)} m from a road edge`);
    }
    // Drawn on the ground there (no footpath under it), and solid to someone on foot.
    assert.ok(C.blocked(...at(side * BENCH.x, BENCH.z), 0.05), `stall ${i}'s bench has no collider`);
  }
  assert.ok(stalls > 200 && benches > stalls * 0.9, `${benches} benches at ${stalls} stalls`);
});

test('a compound wall runs into no other building, and no street tree stands in a wall or a shop platform', () => {
  const { city } = world();
  const L = city.lots, T = city.trees, ov = {};
  let walls = 0, otas = 0;
  for (let i = 0; i < L.count; i++) {
    const wall = city.compoundWall(i), ota = city.shopPlatform(i);
    if (!wall && !ota) continue;
    const c = Math.cos(L.rot[i]), s = Math.sin(L.rot[i]);
    // The wall's line 1.6 m in front of the house (chunks.js, colliders.js) and the platform along the shop front.
    const strips = [];
    if (wall) strips.push([-L.hd[i] - 1.5, L.hw[i], 0.12, 'wall']);
    if (ota) strips.push([-L.hd[i] - ota / 2, L.hw[i] - 0.05, ota / 2, 'platform']);
    for (const [lz, hw, hd, what] of strips) {
      const x = L.x[i] + lz * s, z = L.z[i] + lz * c, ext = hw + 12;
      city.lotGrid.query(x - ext, z - ext, x + ext, z + ext, id => {
        if (what === 'wall' && id >= 0 && id !== i) assert.ok(!obbOverlap(x, z, hw, hd, L.rot[i], L.x[id], L.z[id], L.hw[id], L.hd[id], L.rot[id], ov), `lot ${i}'s wall runs into lot ${id}`);
        if (id > -100000 || id <= -200000) return;
        const k = -100000 - id - 1, r = T.kind[k] === 2 ? 0.75 : T.kind[k] === 5 ? 0.6 : 0.32, dx = T.x[k] - x, dz = T.z[k] - z;
        assert.ok(Math.abs(dx * c - dz * s) >= hw + r || Math.abs(dx * s + dz * c) >= hd + r, `tree ${k} stands in lot ${i}'s ${what}`);
      });
    }
    if (wall) walls++; if (ota) otas++;
  }
  assert.ok(walls > 1000 && otas > 5000, `${walls} walls, ${otas} platforms`);
});

test('night light pools lie over the footpaths, shop platforms and medians, so the light reaches past the kerb', () => {
  const { city } = world();
  const mats = { city: new THREE.MeshBasicMaterial(), signs: new THREE.MeshBasicMaterial(), pools: new THREE.MeshBasicMaterial(), wires: new THREE.LineBasicMaterial(), foliage: new THREE.MeshBasicMaterial() };
  const cm = new ChunkManager(new THREE.Scene(), city, mats, new Map());
  // The busy shops by (561, 286): footpaths, shop platforms, lamps and shop light.
  const cx = Math.floor(561 / CHUNK), cz = Math.floor(286 / CHUNK), key = `${cx},${cz}`;
  cm._build(key, cx, cz);
  const pools = cm.chunks.get(key).levels.find(l => l?.pools).pools.geometry.attributes.position.array;
  let low = Infinity;
  for (let i = 1; i < pools.length; i += 3) low = Math.min(low, pools[i]);
  // The highest of them, a median's planted top, is 0.32 m.
  assert.ok(low > Math.max(WALK_Y, 0.3, 0.32) + 0.05, `a pool lies ${low.toFixed(2)} m up`);
  assert.ok(pools.length > 3 * 4 * 20, `${pools.length / 12} pool quads`);
});
