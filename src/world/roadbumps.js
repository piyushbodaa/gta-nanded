// Speed breakers and potholes on the mapped streets: where they are (deterministic, like the
// rest of the city), the shape a speed breaker gives the road, and the potholes under a wheel.
import { SpatialGrid, rng, hash2 } from '../core/math.js';

// A speed breaker: a rounded hump across the carriageway, this long along it and this high.
export const BUMP_LEN = 2.2, BUMP_H = 0.11;
// Places that get a pair of speed breakers either side of their gate.
const GATES = new Set(['school', 'college', 'coaching', 'hospital']);

/** The rise of a speed breaker `u` metres from its crest, along the road. */
export const humpAt = u => (Math.abs(u) >= BUMP_LEN / 2 ? 0 : BUMP_H * 0.5 * (1 + Math.cos((Math.PI * u) / (BUMP_LEN / 2))));

export class RoadBumps {
  constructor(net) {
    this.net = net;
    this.bumps = []; // { road, s, x, z, dx, dz, left, right }: crest point, direction, edges
    this.holes = []; // { road, x, z, r, rot, seed }
    this.byRoad = new Map(); // road -> crest positions along it, ascending
    this.bumpGrid = new SpatialGrid(32);
    this.holeGrid = new SpatialGrid(16);
  }

  /**
   * Lay them out. Speed breakers stand before the chowks on smaller streets, now and then along
   * long stretches, and either side of school, college, coaching and hospital gates. Potholes
   * pit the minor streets, most of all where the town is old or rural (`wear(x, z)`, 0..1).
   * `railDistance` keeps both off level crossings. Neither lies under a flyover: heightAt and
   * holeAt go by plan position alone, so traffic on the deck above would ride over them too.
   */
  place(places, wear, railDistance) {
    const net = this.net, p = {};
    const clear = road => !net.raised[road] && !net.bridge[road];
    const open = (x, z) => net.deckOver(x, z) === 0;
    const add = (road, s) => {
      const len = net.length[road], t0 = net.trimStart(road) + 6, t1 = len - net.trimEnd(road) - 6;
      if (s < t0 || s > t1) return;
      const list = this.byRoad.get(road) || [];
      if (list.some(o => Math.abs(o - s) < 35)) return;
      net.pointAt(road, s, p);
      if (railDistance(p.x, p.z) < 9) return;
      const b = { road, s, x: p.x, z: p.z, dx: p.dx, dz: p.dz, left: net.edgeAt(road, s, 1), right: net.edgeAt(road, s, -1) };
      if (![0, b.left, -b.right].every(v => open(b.x + b.dz * v, b.z - b.dx * v))) return;
      const i = this.bumps.push(b) - 1, m = Math.max(b.left, b.right) + BUMP_LEN;
      this.bumpGrid.insertRect(i, b.x - m, b.z - m, b.x + m, b.z + m);
      list.push(s); list.sort((a2, b2) => a2 - b2);
      this.byRoad.set(road, list);
    };
    for (let road = 0; road < net.count; road++) {
      if (!clear(road) || net.type[road] < 2) continue;
      const len = net.length[road], t0 = net.trimStart(road), t1 = len - net.trimEnd(road);
      if (t1 - t0 < 40) continue;
      const r = rng(hash2(road, 4242)), chance = net.type[road] <= 3 ? 0.3 : 0.18;
      if (net.jRoads[net.ra[road]].length >= 3 && r() < chance) add(road, t0 + 9);
      if (net.jRoads[net.rb[road]].length >= 3 && r() < chance) add(road, t1 - 9);
      for (let s = t0 + 140; s < t1 - 140; s += 220) { const at = s + r.range(-30, 30); if (r() < 0.35) add(road, at); }
    }
    for (const place of places) {
      if (!GATES.has(place.category)) continue;
      const q = net.nearest(place.ax, place.az, 30, {}, clear);
      if (q) { add(q.road, q.s - 22); add(q.road, q.s + 22); }
    }
    // Potholes: a few in every hundred metres of the worn streets, in the wheel tracks.
    for (let road = 0; road < net.count; road++) {
      if (!clear(road)) continue;
      const len = net.length[road], t0 = net.trimStart(road) + 4, t1 = len - net.trimEnd(road) - 4;
      if (t1 - t0 < 16) continue;
      net.pointAt(road, len / 2, p);
      const type = net.type[road], per100 = (type >= 4 ? 0.9 : type >= 2 ? 0.55 : 0.3) * wear(p.x, p.z);
      const r = rng(hash2(road, 777));
      const n = Math.floor(((t1 - t0) / 100) * per100 + r());
      for (let k = 0; k < n; k++) {
        const s = r.range(t0, t1), rad = r.range(0.32, 0.72), rot = r() * Math.PI * 2, seed = hash2(road, k);
        const left = net.edgeAt(road, s, 1) - rad - 0.4, right = net.edgeAt(road, s, -1) - rad - 0.4;
        const side = r.range(-right, left);
        if (left + right < 0.5) continue;
        net.pointAt(road, s, p);
        const x = p.x + p.dz * side, z = p.z - p.dx * side;
        if (railDistance(x, z) < 6 || this.heightAt(x, z, 3) > 0 || !open(x, z)) continue;
        // Apart from each other (overlapping ones would flicker).
        if (this.holeGrid.query(x - 2, z - 2, x + 2, z + 2, j => Math.hypot(this.holes[j].x - x, this.holes[j].z - z) < this.holes[j].r + rad + 0.3)) continue;
        this.holeGrid.insertPoint(this.holes.push({ road, x, z, r: rad, rot, seed }) - 1, x, z);
      }
    }
    return this;
  }

  /** How far a speed breaker lifts the road at (x, z): 0 off them. `pad` widens the hump. */
  heightAt(x, z, pad = 0) {
    let h = 0;
    this.bumpGrid.query(x, z, x, z, i => {
      const b = this.bumps[i], rx = x - b.x, rz = z - b.z;
      const u = rx * b.dx + rz * b.dz, v = rx * b.dz - rz * b.dx; // along, and across (+left)
      if (v > b.left + 0.2 || v < -b.right - 0.2) return;
      h = Math.max(h, pad ? (Math.abs(u) < BUMP_LEN / 2 + pad ? BUMP_H : 0) : humpAt(u));
    });
    return h;
  }

  /** The pothole under (x, z), if any. */
  holeAt(x, z) {
    let hit = null;
    this.holeGrid.query(x - 1, z - 1, x + 1, z + 1, i => {
      const h = this.holes[i];
      if ((x - h.x) ** 2 + (z - h.z) ** 2 < h.r * h.r) { hit = h; return true; }
    });
    return hit;
  }

  /**
   * Metres from `s` along a lane (direction dir, s from where the lane starts) to the next speed
   * breaker's crest, counting one already under the vehicle; Infinity if none within `range`.
   */
  ahead(road, dir, s, range) {
    const list = this.byRoad.get(road);
    if (!list) return Infinity;
    const len = this.net.length[road], at = dir > 0 ? s : len - s;
    let best = Infinity;
    for (const c of list) {
      const d = dir > 0 ? c - at : at - c;
      if (d > -BUMP_LEN / 2 && d < range && d < best) best = d;
    }
    return best;
  }
}
