import { test } from 'node:test';
import assert from 'node:assert/strict';
import { world } from './helpers.js';
import { Colliders, SOLID, obbSat } from '../src/world/colliders.js';
import { SOLID_BELOW, MEDIAN_W } from '../src/world/roadnet.js';
import { pointSegDist2 } from '../src/core/math.js';
import { VEHICLE_TYPES } from '../src/actors/vehicle-types.js';
import { STORY_PLACES } from '../src/game/story.js';

// Medians, railings and ramps are solid where they are drawn, and nowhere else.

let cached = null;
const colliders = () => cached || (cached = new Colliders(world().city));

/** How far (x, z) is inside the carriageway of a road at street level other than r (negative: outside them all). */
function onStreet(r, x, z) {
  const { net } = world(), t = [0];
  let most = -Infinity;
  net.grid.query(x - 1, z - 1, x + 1, z + 1, i => {
    const o = net.ptRoad[i], ax = net.px[i], az = net.pz[i], dx = net.px[i + 1] - ax, dz = net.pz[i + 1] - az;
    const d = Math.sqrt(pointSegDist2(x, z, ax, az, ax + dx, az + dz, t)), s = net.cum[i] + (net.cum[i + 1] - net.cum[i]) * t[0];
    if (o === r || net.deckAt(o, s) >= 2) return;
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
