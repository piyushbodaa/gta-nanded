import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { world } from './helpers.js';
import { Colliders, SOLID, obbSat, medianRuns } from '../src/world/colliders.js';
import { SOLID_BELOW, MEDIAN_W } from '../src/world/roadnet.js';
import { ChunkManager } from '../src/world/chunks.js';
import { CHUNK } from '../src/world/citygen.js';
import { pointSegDist2 } from '../src/core/math.js';
import { VEHICLE_TYPES } from '../src/actors/vehicle-types.js';
import { STORY_PLACES } from '../src/game/story.js';

// Medians, railings and ramps are solid where they are drawn, and nowhere else.

let cached = null;
const colliders = () => cached || (cached = new Colliders(world().city));

/**
 * How far (x, z) is inside the carriageway of a road other than r, where any deck it has is
 * below `below` (0: a road that never leaves the ground) (negative: outside them all).
 */
function onStreet(r, x, z, below = 2) {
  const { net } = world(), t = [0];
  let most = -Infinity;
  // (The grid holds the centre lines: a 12 m road's reaches 7 m out from one.)
  net.grid.query(x - 7, z - 7, x + 7, z + 7, i => {
    const o = net.ptRoad[i], ax = net.px[i], az = net.pz[i], dx = net.px[i + 1] - ax, dz = net.pz[i + 1] - az;
    const d = Math.sqrt(pointSegDist2(x, z, ax, az, ax + dx, az + dz, t)), s = net.cum[i] + (net.cum[i + 1] - net.cum[i]) * t[0];
    if (o === r || (net.raised[o] && net.deckAt(o, s) >= below)) return;
    most = Math.max(most, net.edgeAt(o, s, (x - ax - dx * t[0]) * dz - (z - az - dz * t[0]) * dx >= 0 ? 1 : -1) - d);
  });
  return most;
}

test('a median\'s colliders follow it round the bends, with no kerb in the lane and no gap through it', () => {
  const { net } = world();
  const col = colliders(), near = {};
  const wide = r => net.width[r] >= 11.5 && !net.bridge[r] && !net.oneway[r];
  let pieces = 0;
  for (let i = 0; i < col.n; i++) {
    if (col.type[i] !== SOLID.OBB || Math.abs(col.hw[i] - 0.35) > 1e-4 || Math.abs(col.h[i] - 0.35) > 1e-4) continue;
    // A centre median's piece is centred on its road's line; both its ends must be too.
    const n = net.nearest(col.x[i], col.z[i], 1, near, wide);
    if (!n || n.dist > 0.05) continue;
    for (const end of [1, -1]) {
      const x = col.x[i] + col.s[i] * col.hd[i] * end, z = col.z[i] + col.c[i] * col.hd[i] * end;
      const m = net.nearest(x, z, 5, near, wide);
      assert.ok(m && m.dist < 0.05, `median piece ${i} ends ${m ? m.dist.toFixed(2) : '5+'} m off the median at (${x.toFixed(0)}, ${z.toFixed(0)})`);
    }
    pieces++;
  }
  assert.ok(pieces > 800, `${pieces} median pieces`);
});

test('a flyover ramp\'s solid end is closed to the street under the deck, and open to the deck\'s own traffic', () => {
  const { net } = world();
  const col = colliders(), p = {}, out = {};
  let ramps = 0, lanes = 0;
  for (let r = 0; r < net.count; r++) {
    if (!net.raised[r]) continue;
    for (let s = 1; s < net.length[r] - 1; s += 0.5) {
      const a = net.deckAt(r, s - 0.5), b = net.deckAt(r, s);
      if ((a >= SOLID_BELOW) === (b >= SOLID_BELOW)) continue;
      // From 10 m out under the deck to 10 m into the embankment, a car-sized box down the
      // middle of the carriageway and in each lane: at street level something stops it; on
      // the deck, down the middle, nothing does. (A divided road's carriageway runs from its
      // median to its kerb.) Where another street runs on under the ramp's end, it is left
      // open to that street's traffic (see below).
      const dir = a >= SOLID_BELOW ? 1 : -1, eL = net.edgeAt(r, s, 1), eR = net.edgeAt(r, s, -1);
      for (const f of [0, 0.25, -0.25]) {
        const off = (eL - eR) / 2 + (eL + eR) * f;
        net.pointAt(r, s, p);
        const street = onStreet(r, p.x + p.dz * off, p.z - p.dx * off) > -1.5;
        let stopped = street;
        for (let u = -10; u <= 10; u += 0.3) {
          const su = s + u * dir;
          net.pointAt(r, su, p);
          const x = p.x + p.dz * off, z = p.z - p.dx * off, heading = Math.atan2(p.dx, p.dz);
          if (col.boxContact(x, z, 0.85, 2.2, heading, out, 0)) stopped = true;
          if (f === 0 && su > net.trimStart(r) + 2.2 && su < net.length[r] - net.trimEnd(r) - 2.2) {
            assert.equal(col.boxContact(x, z, 0.85, 2.2, heading, out, net.deckAt(r, su)), null, `road ${r}: deck traffic stopped ${u.toFixed(1)} m from its ramp's solid end`);
          }
        }
        assert.ok(stopped, `road ${r} at ${s}: the street under the deck runs on into the ramp (lane ${f})`);
        if (!street) lanes++;
      }
      ramps++;
    }
  }
  assert.ok(ramps >= 30, `${ramps} ramps`);
  assert.ok(lanes >= 50, `${lanes} lanes under a deck that end at the ramp`);
});

test('a ramp\'s end is shut across the ramp, but not across a street that runs on under it', () => {
  const { net } = world();
  const col = colliders(), p = {}, q = {};
  // Every ramp end: the 4 m piece (as colliders.js lays them) where the deck comes down past
  // SOLID_BELOW, looked across at the middle of its lower half, inside the side walls.
  let ends = 0, streets = 0, open = 0, shut = 0;
  for (let r = 0; r < net.count; r++) {
    if (!net.raised[r]) continue;
    const s0 = net.trimStart(r), s1 = net.length[r] - net.trimEnd(r);
    for (let i = net.ptStart[r]; i < net.ptStart[r + 1] - 1; i++) {
      const sa = Math.max(net.cum[i], s0), sb = Math.min(net.cum[i + 1], s1), n = Math.ceil((sb - sa) / 4);
      for (let k = 0; sb - sa >= 0.05 && k < n; k++) {
        const s = sa + ((sb - sa) * k) / n, e = sa + ((sb - sa) * (k + 1)) / n, sm = (s + e) / 2, dA = net.deckAt(r, s), dB = net.deckAt(r, e);
        if (Math.min(dA, dB) >= SOLID_BELOW || Math.max(dA, dB) < SOLID_BELOW) continue;
        ends++;
        net.pointAt(r, sm, p);
        net.pointAt(r, dA > dB ? (sm + e) / 2 : (s + sm) / 2, q);
        let under = false;
        for (let lx = -net.edgeAt(r, sm, -1) + 0.6; lx <= net.edgeAt(r, sm, 1) - 0.6; lx += 0.5) {
          const x = q.x + p.dz * lx, z = q.z - p.dx * lx, on = onStreet(r, x, z);
          // On a street's carriageway it is open to its traffic, as it drives on; elsewhere it is shut.
          if (on > 1) { under = true; open++; assert.ok(!col.blocked(x, z, 0.05, 0), `ramp ${r} at (${x.toFixed(1)}, ${z.toFixed(1)}): shut across the street under it`); }
          if (on < -1) { shut++; assert.ok(col.blocked(x, z, 0.05, 0), `ramp ${r} at (${x.toFixed(1)}, ${z.toFixed(1)}): open into the embankment`); }
        }
        if (under) streets++;
      }
    }
  }
  assert.ok(ends >= 40, `${ends} ramp ends`);
  assert.ok(streets >= 20 && open > 100 && shut > 100, `${streets} ramp ends with a street under them; ${open} spots open, ${shut} shut`);
});

// A car (a hatchback): its half width and half length.
const HATCH = { hw: VEHICLE_TYPES.hatch.W / 2, hd: VEHICLE_TYPES.hatch.L / 2 };
// A deck this little above the street is driven straight onto (as net.surfaceAt steps).
const STEP = 0.6;

test("a street through a low ramp's side wall drives on through it, and the deck keeps its parapet", () => {
  const { net } = world();
  const col = colliders(), p = {}, q = {}, sat = {};
  /** Is (x, z) in a wall lying along (dx, dz), 0.4 m thick or less, that stands in the way at `level`? */
  const wallAt = (x, z, level, dx, dz) => col.near(x - 1, z - 1, x + 1, z + 1, i => {
    if (col.type[i] !== SOLID.OBB || col.hw[i] > 0.201 || Math.abs(dx * col.s[i] + dz * col.c[i]) < 0.99 || !col._atLevel(i, level)) return false;
    const ex = x - col.x[i], ez = z - col.z[i];
    return Math.abs(ex * col.c[i] - ez * col.s[i]) <= col.hw[i] + 0.01 && Math.abs(ex * col.s[i] + ez * col.c[i]) <= col.hd[i] + 0.01;
  });
  // Every low ramp piece (as colliders.js lays them, 4 m long: its deck off the street, and below
  // SOLID_BELOW at its low end), looked along the middle of each of its side walls.
  const n = { open: 0, shut: 0, rail: 0 }, streets = new Set();
  for (let r = 0; r < net.count; r++) {
    if (!net.raised[r]) continue;
    const w = net.width[r], ms = net.oneway[r] ? -net.oneway[r] : 0, s0 = net.trimStart(r), s1 = net.length[r] - net.trimEnd(r);
    for (let i = net.ptStart[r]; i < net.ptStart[r + 1] - 1; i++) {
      const sa = Math.max(net.cum[i], s0), sb = Math.min(net.cum[i + 1], s1), m = Math.ceil((sb - sa) / 4);
      for (let k = 0; sb - sa >= 0.05 && k < m; k++) {
        const s = sa + ((sb - sa) * k) / m, e = sa + ((sb - sa) * (k + 1)) / m, sm = (s + e) / 2;
        const lo = Math.min(net.deckAt(r, s), net.deckAt(r, e)), hi = Math.max(net.deckAt(r, s), net.deckAt(r, e));
        if (hi <= 0.05 || lo >= SOLID_BELOW) continue;
        net.pointAt(r, sm, p);
        const inner = ms ? net.innerAt(r, sm) : w / 2;
        for (const side of [1, -1]) {
          const off = (side === ms && inner < w / 2 - 0.05 ? inner - 0.15 : w / 2 + 0.2) * side;
          for (let lz = -(e - s) / 2; lz <= (e - s) / 2; lz += 0.5) {
            const x = p.x + p.dz * off + p.dx * lz, z = p.z - p.dx * off + p.dz * lz, on = onStreet(r, x, z, 0), at = `ramp ${r} at (${x.toFixed(1)}, ${z.toFixed(1)})`;
            // Across a street that never leaves the ground and runs through it, open to the
            // street's traffic; elsewhere walled to the ground.
            if (on > 0.6) { n.open++; assert.ok(!wallAt(x, z, 0, p.dx, p.dz), `${at}: its wall stands across the street through it`); }
            if (on < -0.6) { n.shut++; assert.ok(wallAt(x, z, 0, p.dx, p.dz), `${at}: open into the embankment`); }
            // Up on the deck its traffic is kept on it all the same, unless the deck is a step off the street.
            if (lo >= STEP) { n.rail++; assert.ok(wallAt(x, z, net.deckAt(r, sm + lz), p.dx, p.dz), `${at}: nothing keeps the deck's traffic on it`); }
          }
          const x = p.x + p.dz * off, z = p.z - p.dx * off;
          net.grid.query(x - 8, z - 8, x + 8, z + 8, j => { const o = net.ptRoad[j]; if (!net.raised[o] && !net.bridge[o]) streets.add(o); });
        }
      }
    }
  }
  assert.ok(n.open > 300 && n.shut > 3000 && n.rail > 3000, JSON.stringify(n));
  // A car in each lane of every street that passes a low ramp, wherever the street runs straight
  // under the whole car, meets none of the ramp's walls (traffic drives those lanes). A ramp's wall
  // stands along it, on its kerb edge or just in from its median edge.
  const rampWall = i => {
    if (col.type[i] !== SOLID.OBB || col.hw[i] > 0.201 || !col._atLevel(i, 0)) return false;
    const r = net.nearest(col.x[i], col.z[i], 12, q, o => net.raised[o]);
    if (!r || Math.abs(r.dx * col.s[i] + r.dz * col.c[i]) < 0.99) return false;
    const lateral = Math.abs((col.x[i] - r.x) * r.dz - (col.z[i] - r.z) * r.dx), ms = net.oneway[r.road] ? -net.oneway[r.road] : 0;
    return Math.abs(lateral - net.width[r.road] / 2 - 0.2) < 0.05 || (ms !== 0 && Math.abs(lateral - net.innerAt(r.road, r.s) + 0.15) < 0.05);
  };
  let lanes = 0, into = 0, worst = 0, where = '';
  for (const r of streets) {
    const len = net.length[r], ow = net.oneway[r];
    for (const dir of ow ? [ow] : [1, -1]) for (let lane = 0; lane < (ow ? 2 : net.lanes[r]); lane++) {
      const from = dir > 0 ? net.trimStart(r) : net.trimEnd(r), to = len - (dir > 0 ? net.trimEnd(r) : net.trimStart(r));
      let deepest = 0;
      for (let u = from; u <= to; u += 0.5) {
        const s = dir > 0 ? u : len - u, seg = net.pointAt(r, s, p).seg;
        if (net.cum[seg] > s - HATCH.hd || net.cum[seg + 1] < s + HATCH.hd) continue;
        net.lanePoint(r, dir, u, net.laneOffset(r, lane, s), p);
        const ca = Math.cos(p.heading), sa = Math.sin(p.heading), R = HATCH.hd + HATCH.hw;
        col.near(p.x - R, p.z - R, p.x + R, p.z + R, i => {
          const res = obbSat(p.x, p.z, HATCH.hw, HATCH.hd, ca, sa, col.x[i], col.z[i], col.hw[i], col.hd[i], col.c[i], col.s[i], sat);
          if (!res || res.depth <= Math.max(deepest, 0.02) || !rampWall(i)) return;
          deepest = res.depth;
          if (deepest > worst) { worst = deepest; where = `road ${r} lane ${lane} at (${p.x.toFixed(1)}, ${p.z.toFixed(1)})`; }
        });
      }
      lanes++;
      if (deepest > 0.05) into++;
    }
  }
  assert.ok(streets.size > 100 && lanes > 250, `${lanes} lanes of ${streets.size} streets`);
  assert.equal(into, 0, `${into} of them run into a ramp's wall, the worst ${worst.toFixed(2)} m on ${where}`);
});

// A truck (the c4 sand tipper): its half width and half length.
const TRUCK = { hw: VEHICLE_TYPES.truck.W / 2, hd: VEHICLE_TYPES.truck.L / 2 };
/** The kerbs down the medians: 0.35 m high and at most 0.7 m across. */
const isMedian = (c, i) => c.type[i] === SOLID.OBB && c.y0[i] === 0 && Math.abs(c.h[i] - 0.35) < 1e-3 && c.hw[i] < 0.36;

test("the c4 tipper follows its GPS line from Mama's ghat road onto the Govardhan bridge without touching a kerb", () => {
  const { net } = world();
  const col = colliders(), out = {}, P = STORY_PLACES;
  const route = net.route(P.ghatRoad.x, P.ghatRoad.z, P.bridgeN.x, P.bridgeN.z);
  // Along the drawn GPS line (the road's middle), and along the lane line drivers keep to.
  for (const [line, pts] of [['GPS line', route.points], ['lane', net.lanePath(route.points)]]) {
    let steps = 0;
    for (let i = 0; i + 3 < pts.length; i += 2) {
      const ax = pts[i], az = pts[i + 1], bx = pts[i + 2], bz = pts[i + 3], len = Math.hypot(bx - ax, bz - az), rot = Math.atan2(bx - ax, bz - az);
      for (let s = 0; s <= len; s += 0.5, steps++) {
        const x = ax + ((bx - ax) * s) / len, z = az + ((bz - az) * s) / len, hit = col.boxContact(x, z, TRUCK.hw, TRUCK.hd, rot, out, 0);
        assert.ok(!hit || hit.depth < 0.02, `${line}: the tipper is ${hit?.depth.toFixed(2)} m into something at (${x.toFixed(1)}, ${z.toFixed(1)})`);
      }
    }
    assert.ok(steps > 500, `${line}: ${steps} places along ${route.length.toFixed(0)} m`);
  }
});

test("at every junction a median keeps out of the other roads' lanes", () => {
  const { net } = world();
  const col = colliders(), q = {}, sat = {};
  // One of road r's own medians: down its centre line, or along the median side of its carriageway.
  const own = (r, i) => {
    const n = net.nearest(col.x[i], col.z[i], 12, {}, o => o === r);
    if (!n || Math.abs(n.dx * col.s[i] + n.dz * col.c[i]) < 0.995) return false;
    const lateral = (col.x[i] - n.x) * n.dz - (col.z[i] - n.z) * n.dx, ms = net.oneway[r] ? -net.oneway[r] : 0;
    return Math.abs(lateral - (ms ? ms * (net.innerAt(r, n.s) + MEDIAN_W / 4) : 0)) < 0.25;
  };
  // A truck in each lane over the last 15 m into every junction of three or more roads and the
  // first 15 m out of it, wherever the road runs straight under the whole truck.
  let ways = 0, into = 0, worst = 0, where = '';
  for (let r = 0; r < net.count; r++) {
    if (net.raised[r] || net.bridge[r]) continue;
    const len = net.length[r], ow = net.oneway[r];
    for (const dir of ow ? [ow] : [1, -1]) for (let lane = 0; lane < (ow ? net.lanes[r] : 1); lane++) {
      const from = dir > 0 ? net.trimStart(r) : net.trimEnd(r), to = len - (dir > 0 ? net.trimEnd(r) : net.trimStart(r));
      for (const [j, a, b] of [[dir > 0 ? net.ra[r] : net.rb[r], from, Math.min(to, from + 15)], [dir > 0 ? net.rb[r] : net.ra[r], Math.max(from, to - 15), to]]) {
        if (net.jRoads[j].length < 3 || b - a < 0.5) continue;
        ways++;
        let deepest = 0;
        for (let u = a; u <= b; u += 0.5) {
          const s = dir > 0 ? u : len - u, seg = net.pointAt(r, s, q).seg;
          if (net.cum[seg] > s - TRUCK.hd || net.cum[seg + 1] < s + TRUCK.hd) continue;
          net.lanePoint(r, dir, u, net.laneOffset(r, lane, s), q);
          const ca = Math.cos(q.heading), sa = Math.sin(q.heading), R = TRUCK.hd + TRUCK.hw;
          col.near(q.x - R, q.z - R, q.x + R, q.z + R, i => {
            if (!isMedian(col, i)) return;
            const res = obbSat(q.x, q.z, TRUCK.hw, TRUCK.hd, ca, sa, col.x[i], col.z[i], col.hw[i], col.hd[i], col.c[i], col.s[i], sat);
            if (!res || res.depth <= deepest || own(r, i)) return;
            deepest = res.depth;
            if (deepest > worst) { worst = deepest; where = `road ${r} lane ${lane} at (${q.x.toFixed(1)}, ${q.z.toFixed(1)}), junction ${j}`; }
          });
        }
        if (deepest > 0.1) into++;
      }
    }
  }
  assert.ok(ways > 40000, `${ways} ways into and out of junctions`);
  assert.equal(into, 0, `${into} of them run into another road's median, the worst ${worst.toFixed(2)} m on ${where}`);
});

test('a median is drawn just where it is solid: no kerb is drawn through a lane that drives through it', () => {
  const { net, city } = world();
  const col = colliders(), all = medianRuns(net), p = {};
  // Solid along its runs, and nowhere else: the kerb boxes add up to the runs.
  let runs = 0, boxes = 0;
  for (const lay of all) for (let k = 0; lay && k < lay.length; k += 2) runs += lay[k + 1] - lay[k];
  for (let i = 0; i < col.n; i++) if (isMedian(col, i)) boxes += 2 * col.hd[i];
  assert.ok(runs > 60000 && Math.abs(runs - boxes) < 1, `${boxes.toFixed(0)} m of median kerb is solid, along ${runs.toFixed(0)} m of runs`);
  /** Is (x, z) on a median's kerb box, or within `pad` of one? */
  const solid = (x, z, pad) => col.near(x - 1, z - 1, x + 1, z + 1, i => {
    if (!isMedian(col, i)) return false;
    const ex = x - col.x[i], ez = z - col.z[i];
    return Math.abs(ex * col.c[i] - ez * col.s[i]) <= col.hw[i] + pad && Math.abs(ex * col.s[i] + ez * col.c[i]) <= col.hd[i] + pad;
  });
  // Drawn along them too, and nowhere else, in the close-up chunks round the c4 tipper's first
  // junction (where road 2096's median half stood a metre into 12125's lane), where road 5657 runs
  // half over another, and where two divided roads' carriageways are mapped over each other.
  const mats = { city: new THREE.MeshBasicMaterial(), signs: new THREE.MeshBasicMaterial(), pools: new THREE.MeshBasicMaterial(), wires: new THREE.LineBasicMaterial(), foliage: new THREE.MeshBasicMaterial() };
  const cm = new ChunkManager(new THREE.Scene(), city, mats, new Map());
  let drawn = 0, along = 0;
  for (const [x, z] of [[-156.8, 951.5], [1796, -2394], [-3236, 4930], [1583, -1685]]) {
    const cx = Math.floor(x / CHUNK), cz = Math.floor(z / CHUNK), key = `${cx},${cz}`;
    cm._build(key, cx, cz);
    // The planted tops of the medians drawn there (0.32 m up, in their green).
    const tops = [];
    for (const mesh of cm.chunks.get(key).meshes) {
      const tint = mesh.geometry.attributes.tint?.array, pos = mesh.geometry.attributes.position.array, idx = mesh.geometry.index?.array;
      if (!tint || !idx) continue;
      const top = v => tint[v * 4] === 0x8c && tint[v * 4 + 1] === 0x9a && tint[v * 4 + 2] === 0x5a && Math.abs(pos[v * 3 + 1] - 0.32) < 1e-3;
      for (let k = 0; k < idx.length; k += 3) {
        const [a, b, c] = [idx[k], idx[k + 1], idx[k + 2]];
        if (top(a) && top(b) && top(c)) tops.push([pos[a * 3], pos[a * 3 + 2], pos[b * 3], pos[b * 3 + 2], pos[c * 3], pos[c * 3 + 2]]);
      }
    }
    // All over each drawn top, every half metre or so, is a kerb: its top runs 5 cm past the kerb,
    // and where the median narrows its straight boxes follow the slanting edge within 10 cm. (Not
    // within 1.5 m of a bend, where the mitred top fills the wedge between two straight boxes.)
    const near = {}, divided = o => !!all[o];
    const atBend = (x, z) => {
      const n = net.nearest(x, z, 8, near, divided);
      if (!n) return false;
      const i = net.pointAt(n.road, n.s, p).seg, a = net.ptStart[n.road], b = net.ptStart[n.road + 1] - 1;
      return (i > a && n.s - net.cum[i] < 1.5) || (i + 1 < b && net.cum[i + 1] - n.s < 1.5);
    };
    for (const [ax, az, bx, bz, qx, qz] of tops) {
      const m = Math.ceil(Math.max(Math.hypot(bx - ax, bz - az), Math.hypot(qx - ax, qz - az)) / 0.5), gx = (ax + bx + qx) / 3, gz = (az + bz + qz) / 3;
      for (let u = 0; u <= m; u++) for (let v = 0; u + v <= m; v++) {
        // (pulled in a little towards its middle, off its edges)
        const x = gx + (ax + ((bx - ax) * u) / m + ((qx - ax) * v) / m - gx) * 0.95, z = gz + (az + ((bz - az) * u) / m + ((qz - az) * v) / m - gz) * 0.95;
        if (atBend(x, z)) continue;
        drawn++;
        assert.ok(solid(x, z, 0.15), `a median is drawn at (${x.toFixed(2)}, ${z.toFixed(2)}) with no kerb there`);
      }
    }
    // Down the middle of every run of the road segments built there, it is drawn (not too near
    // either end of a segment, where on the inside of a bend the next segment's mitre takes over).
    const inTop = (x, z) => tops.some(([ax, az, bx, bz, qx, qz]) => {
      const d1 = (bx - ax) * (z - az) - (bz - az) * (x - ax), d2 = (qx - bx) * (z - bz) - (qz - bz) * (x - bx), d3 = (ax - qx) * (z - qz) - (az - qz) * (x - qx);
      return (d1 >= -1e-6 && d2 >= -1e-6 && d3 >= -1e-6) || (d1 <= 1e-6 && d2 <= 1e-6 && d3 <= 1e-6);
    });
    for (const i of city.chunk(cx, cz).segs) {
      const r = net.ptRoad[i], lay = all[r], ms = net.oneway[r] ? -net.oneway[r] : 0;
      const s0 = Math.max(net.cum[i], net.trimStart(r)), s1 = Math.min(net.cum[i + 1], net.length[r] - net.trimEnd(r));
      for (let k = 0; lay && k < lay.length; k += 2) {
        for (let s = Math.max(lay[k] + 0.1, net.cum[i] + 2, s0 + 0.1); s < Math.min(lay[k + 1] - 0.1, net.cum[i + 1] - 2, s1 - 0.1); s += 0.5) {
          net.pointAt(r, s, p);
          const off = ms ? ms * (net.innerAt(r, s) + MEDIAN_W / 4) : 0, x = p.x + p.dz * off, z = p.z - p.dx * off;
          along++;
          assert.ok(inTop(x, z) && solid(x, z, 0), `road ${r}'s median is solid at (${x.toFixed(2)}, ${z.toFixed(2)}) but not drawn there`);
        }
      }
    }
  }
  assert.ok(drawn > 1000 && along > 300, `${drawn} spots drawn, ${along} along the runs`);
});
