// The street network: mapped roads as polylines between junctions, with the
// lookups everything else needs — nearest road, lane positions, and routes.
import { SpatialGrid, MinHeap, pointSegDist2, clamp } from '../core/math.js';

export const ROAD_TYPES = ['trunk', 'primary', 'secondary', 'tertiary', 'unclassified', 'residential'];
// Route cost per unit length: drivers prefer the big roads, as they do.
const TYPE_COST = [1, 1, 1.02, 1.06, 1.18, 1.3];
// Going the wrong way down a one-way road costs this much more: only when there is no other way.
const WRONG_WAY = 12;
// The kerbed strip between the two carriageways of a divided road.
export const MEDIAN_W = 1.2;
// Flyovers: the deck surface over whatever they cross, the ramps' gradient, and how
// far a ramp may run on along an approach road before the bridge.
export const DECK_H = 6.4;
const RAMP = 0.08, APPROACH = 110;
// Below this deck height a ramp is a solid embankment, walled down to the ground; above it,
// a deck on piers that traffic passes under.
export const SOLID_BELOW = 4;

export class RoadNet {
  constructor(world) {
    const J = world.junctions, R = world.roads;
    this.names = world.names;
    const nj = J.length, nr = R.length;
    this.jx = new Float32Array(nj);
    this.jz = new Float32Array(nj);
    this.jRoads = new Array(nj);
    this.jRadius = new Float32Array(nj);
    for (let i = 0; i < nj; i++) {
      const j = J[i];
      this.jx[i] = j[0]; this.jz[i] = j[1];
      this.jRoads[i] = j.slice(2);
    }
    this.ra = new Int32Array(nr);
    this.rb = new Int32Array(nr);
    this.width = new Float32Array(nr);
    this.type = new Uint8Array(nr);
    this.nameId = new Int32Array(nr);
    this.bridge = new Uint8Array(nr);
    this.ptStart = new Int32Array(nr + 1);
    let total = 0;
    for (let i = 0; i < nr; i++) total += (R[i].length - 6) / 2;
    this.px = new Float32Array(total);
    this.pz = new Float32Array(total);
    this.cum = new Float32Array(total); // distance along the road at each point
    this.length = new Float32Array(nr);
    let k = 0;
    for (let i = 0; i < nr; i++) {
      const r = R[i];
      this.ra[i] = r[0]; this.rb[i] = r[1]; this.width[i] = r[2]; this.type[i] = r[3];
      this.nameId[i] = r[4]; this.bridge[i] = r[5];
      this.ptStart[i] = k;
      let acc = 0;
      for (let p = 6; p < r.length; p += 2) {
        this.px[k] = r[p]; this.pz[k] = r[p + 1];
        if (p > 6) acc += Math.hypot(this.px[k] - this.px[k - 1], this.pz[k] - this.pz[k - 1]);
        this.cum[k] = acc;
        k++;
      }
      this.length[i] = acc;
    }
    this.ptStart[nr] = k;
    this.count = nr;
    this.junctionCount = nj;

    // A junction's radius is how far roads stop short of its centre so the
    // crossing can be paved as one piece and traffic can turn through it.
    for (let j = 0; j < nj; j++) {
      const list = this.jRoads[j];
      if (list.length < 3) { this.jRadius[j] = 0; continue; }
      let w = 0;
      for (const r of list) w = Math.max(w, this.width[r]);
      this.jRadius[j] = w * 0.5 + 1.2;
    }
    // One-way roads (each carriageway of a dual carriageway, roundabouts, one-way
    // streets): 1 when traffic may only go from junction a to b, -1 only from b to a.
    this.oneway = new Int8Array(nr);
    for (const r of world.oneway?.forward || []) this.oneway[r] = 1;
    for (const r of world.oneway?.backward || []) this.oneway[r] = -1;

    this.grid = new SpatialGrid(24);
    for (let r = 0; r < nr; r++) {
      const hw = this.width[r] / 2 + 1;
      for (let i = this.ptStart[r]; i < this.ptStart[r + 1] - 1; i++) {
        const ax = this.px[i], az = this.pz[i], bx = this.px[i + 1], bz = this.pz[i + 1];
        this.grid.insertRect(i, Math.min(ax, bx) - hw, Math.min(az, bz) - hw, Math.max(ax, bx) + hw, Math.max(az, bz) + hw);
      }
    }
    // Map a global point index back to its road.
    this.ptRoad = new Int32Array(total);
    for (let r = 0; r < nr; r++) for (let i = this.ptStart[r]; i < this.ptStart[r + 1]; i++) this.ptRoad[i] = r;
    this._t = [0];
    this._pairCarriageways();
    this._raiseFlyovers(world);

    // Lanes: one each way on most streets, two each way on the widest; a one-way
    // carriageway runs two lanes the same way once it is wide enough.
    this.lanes = new Uint8Array(nr);
    for (let i = 0; i < nr; i++) {
      if (!this.oneway[i]) { this.lanes[i] = this.width[i] >= 11 ? 2 : 1; continue; }
      this.lanes[i] = this.width[i] / 2 + this.innerAt(i, this.length[i] / 2) >= 6.4 ? 2 : 1;
    }
  }

  /**
   * A dual carriageway is mapped as two one-way roads only a few metres apart (the
   * map is at half scale, the road widths are not), so drawn at full width their
   * surfaces would overlap. Each carriageway keeps its kerb (left) edge and stops at
   * a median halfway to the other one. inner[k] is the distance from the centre line
   * to that median-side edge at polyline point k (half the width where there is no
   * other carriageway alongside), and paired[r] marks the roads that have one.
   */
  _pairCarriageways() {
    const n = this.px.length, t = this._t;
    this.inner = new Float32Array(n);
    this.paired = new Uint8Array(this.count);
    const found = new Uint8Array(n);
    for (let r = 0; r < this.count; r++) {
      const hw = this.width[r] / 2, a = this.ptStart[r], b = this.ptStart[r + 1], ow = this.oneway[r];
      this.inner.fill(hw, a, b);
      if (!ow) continue;
      let hits = 0;
      for (let k = a; k < b; k++) {
        const k0 = Math.max(a, k - 1), k1 = Math.min(b - 1, k + 1);
        let fx = (this.px[k1] - this.px[k0]) * ow, fz = (this.pz[k1] - this.pz[k0]) * ow;
        const l = Math.hypot(fx, fz) || 1; fx /= l; fz /= l;
        // The nearest stretch of another one-way road, running the other way on our right.
        const x = this.px[k], z = this.pz[k], R = hw + 5;
        let best = R;
        this.grid.query(x - R, z - R, x + R, z + R, i => {
          const o = this.ptRoad[i], ow2 = this.oneway[o];
          if (o === r || !ow2 || i + 1 >= this.ptStart[o + 1]) return;
          const gx = (this.px[i + 1] - this.px[i]) * ow2, gz = (this.pz[i + 1] - this.pz[i]) * ow2;
          const gl = Math.hypot(gx, gz);
          if (gl < 1e-6 || (gx * fx + gz * fz) / gl > -0.85) return;
          const d = Math.sqrt(pointSegDist2(x, z, this.px[i], this.pz[i], this.px[i + 1], this.pz[i + 1], t));
          if (d >= best) return;
          const cx = this.px[i] + (this.px[i + 1] - this.px[i]) * t[0], cz = this.pz[i] + (this.pz[i + 1] - this.pz[i]) * t[0];
          if ((cx - x) * -fz + (cz - z) * fx > 0) best = d;
        });
        if (best >= R) continue;
        // On a bridge the two decks meet; on the ground a median strip runs between them.
        const edge = this.bridge[r] ? best / 2 : best / 2 - MEDIAN_W / 2;
        if (edge < hw) { this.inner[k] = Math.max(1, edge); found[k] = 1; hits++; }
      }
      if (!hits) continue;
      this.paired[r] = hits * 2 >= b - a ? 1 : 0;
      // A point missed between two that found the other carriageway takes their average.
      for (let k = a + 1; k < b - 1; k++) {
        if (!found[k] && found[k - 1] && found[k + 1]) this.inner[k] = (this.inner[k - 1] + this.inner[k + 1]) / 2;
      }
    }
  }

  /**
   * A bridge on dry land that crosses a street or the railway is a flyover: it rises
   * on ramps (RAMP gradient) from the ground to DECK_H over what it crosses, the ramps
   * running on along straight approach roads where the mapped bridge is too short to
   * climb. deckAt(road, s) is the deck height (0 on the ground), raised[r] marks roads
   * that leave the ground, and jDeck[j] is the height of a junction. A bridge that still
   * cannot clear what it crosses is levelled into an ordinary street, so it never walls
   * off the road beneath it.
   */
  _raiseFlyovers(world) {
    const nr = this.count, nj = this.junctionCount;
    this.raised = new Uint8Array(nr);
    this.jDeck = new Float32Array(nj);
    this.crossings = [];
    const rivers = world.rivers || [], rails = (this._rails = world.rails || []), p = {};
    const near = (line, x, z, r) => {
      for (let i = 0; i + 3 < line.length; i += 2) if (pointSegDist2(x, z, line[i], line[i + 1], line[i + 2], line[i + 3]) < r * r) return true;
      return false;
    };
    const dry = new Uint8Array(nr);
    for (let r = 0; r < nr; r++) {
      if (!this.bridge[r]) continue;
      this.pointAt(r, this.length[r] / 2, p);
      if (!rivers.some(rv => near(rv.p, p.x, p.z, rv.w / 2 + 8))) dry[r] = 1;
    }
    // Where each dry bridge crosses another street (that it doesn't meet) or the railway.
    const cross = (ax, az, bx, bz, cx, cz, dx, dz) => {
      const d1 = (bx - ax) * (cz - az) - (bz - az) * (cx - ax), d2 = (bx - ax) * (dz - az) - (bz - az) * (dx - ax);
      const d3 = (dx - cx) * (az - cz) - (dz - cz) * (ax - cx), d4 = (dx - cx) * (bz - cz) - (dz - cz) * (bx - cx);
      return (d1 > 0) !== (d2 > 0) && (d3 > 0) !== (d4 > 0) ? d3 / (d3 - d4) : -1;
    };
    const found = [];
    for (let r = 0; r < nr; r++) {
      if (!dry[r]) continue;
      for (let i = this.ptStart[r]; i < this.ptStart[r + 1] - 1; i++) {
        const ax = this.px[i], az = this.pz[i], bx = this.px[i + 1], bz = this.pz[i + 1], seg = Math.hypot(bx - ax, bz - az);
        const add = (u, half) => found.push({ road: r, s: this.cum[i] + u * seg, half });
        this.segmentsIn(Math.min(ax, bx) - 1, Math.min(az, bz) - 1, Math.max(ax, bx) + 1, Math.max(az, bz) + 1, (k, o) => {
          if (o === r || dry[o] || this.ra[o] === this.ra[r] || this.ra[o] === this.rb[r] || this.rb[o] === this.ra[r] || this.rb[o] === this.rb[r]) return;
          const u = cross(ax, az, bx, bz, this.px[k], this.pz[k], this.px[k + 1], this.pz[k + 1]);
          if (u >= 0) add(u, this.width[o] / 2 + 3);
        });
        for (const line of rails) for (let q = 0; q + 3 < line.length; q += 2) {
          const u = cross(ax, az, bx, bz, line[q], line[q + 1], line[q + 2], line[q + 3]);
          if (u >= 0) add(u, 6);
        }
      }
    }
    if (!found.length) return;
    // The structures that lift: dry bridges joined to a crossing bridge, plus straight approaches.
    const lift = new Uint8Array(nr), queue = [];
    for (const c of found) if (!lift[c.road]) { lift[c.road] = 1; queue.push(c.road); }
    while (queue.length) {
      const r = queue.pop();
      for (const j of [this.ra[r], this.rb[r]]) for (const o of this.jRoads[j]) if (dry[o] && !lift[o]) { lift[o] = 1; queue.push(o); }
    }
    for (let r = 0; r < nr; r++) {
      if (!lift[r] || !dry[r]) continue;
      for (const j0 of [this.ra[r], this.rb[r]]) {
        // Through a plain bend (two roads), the ramp may carry on along the approach.
        let j = j0, from = r, run = 0;
        while (this.jRoads[j].length === 2 && run < APPROACH) {
          const o = this.jRoads[j][0] === from ? this.jRoads[j][1] : this.jRoads[j][0];
          if (o === from || lift[o] || this.bridge[o]) break;
          lift[o] = 1; run += this.length[o];
          from = o; j = this.otherEnd(o, j);
        }
      }
    }
    // Distances along the lifting roads: to the ground (any junction with a road that stays
    // down) and to the nearest crossing (beyond the flat top over it).
    const dijkstra = seed => {
      const d = new Float64Array(nj).fill(Infinity), heap = new MinHeap(64);
      seed((j, v) => { if (v < d[j]) { d[j] = v; heap.push(j, v); } });
      while (heap.size) {
        const v = heap.keys[0], j = heap.pop();
        if (v > d[j]) continue;
        for (const r of this.jRoads[j]) {
          if (!lift[r]) continue;
          const o = this.otherEnd(r, j), w = v + this.length[r];
          if (w < d[o]) { d[o] = w; heap.push(o, w); }
        }
      }
      return d;
    };
    const ground = dijkstra(push => { for (let j = 0; j < nj; j++) if (this.jRoads[j].some(r => !lift[r])) push(j, 0); });
    const toCross = dijkstra(push => { for (const c of found) { push(this.ra[c.road], Math.max(0, c.s - c.half)); push(this.rb[c.road], Math.max(0, this.length[c.road] - c.s - c.half)); } });
    const onRoad = new Map();
    for (const c of found) { if (!onRoad.has(c.road)) onRoad.set(c.road, []); onRoad.get(c.road).push(c); }
    this._lift = { ground, toCross, onRoad };
    for (let r = 0; r < nr; r++) if (lift[r]) this.raised[r] = 1;
    const heightAt = (r, s) => this.deckAt(r, s);
    // A structure (lifting roads joined end to end) stands only if its deck clears at least one
    // crossing. One that clears none was never a flyover (a culvert, or a level crossing mapped
    // as a bridge): it is levelled into a plain street, so it never walls off the road beneath.
    const comp = new Int32Array(nr).fill(-1);
    const stands = [];
    for (let r0 = 0; r0 < nr; r0++) {
      if (!lift[r0] || comp[r0] >= 0) continue;
      const id = stands.length, stack = [r0];
      stands.push(false);
      comp[r0] = id;
      while (stack.length) {
        const r = stack.pop();
        for (const j of [this.ra[r], this.rb[r]]) for (const o of this.jRoads[j]) if (lift[o] && comp[o] < 0) { comp[o] = id; stack.push(o); }
      }
    }
    for (const c of found) if (heightAt(c.road, c.s) >= 4.5) stands[comp[c.road]] = true;
    for (let r = 0; r < nr; r++) {
      if (!lift[r] || stands[comp[r]]) continue;
      this.raised[r] = 0;
      if (dry[r] && onRoad.has(r)) this.bridge[r] = 0;
    }
    for (let j = 0; j < nj; j++) for (const r of this.jRoads[j]) {
      if (this.raised[r]) this.jDeck[j] = Math.max(this.jDeck[j], this.deckAt(r, this.ra[r] === j ? 0 : this.length[r]));
    }
    this.crossings = found.filter(c => this.raised[c.road]).map(c => ({ ...c, h: this.deckAt(c.road, c.s) }));
  }

  /**
   * Deck height s metres along a road (0 for anything on the ground): as high as the ramps
   * from the ground allow, and no higher than it needs to be to clear the nearest crossing.
   */
  deckAt(road, s) {
    if (!this.raised[road]) return 0;
    const { ground, toCross, onRoad } = this._lift, len = this.length[road], a = this.ra[road], b = this.rb[road];
    let dc = Math.min(toCross[a] + s, toCross[b] + len - s);
    const here = onRoad.get(road);
    if (here) {
      // Between two crossings the deck stays up rather than dipping in between.
      let lo = Infinity, hi = -Infinity;
      for (const c of here) { lo = Math.min(lo, c.s - c.half); hi = Math.max(hi, c.s + c.half); }
      dc = Math.min(dc, s < lo ? lo - s : s > hi ? s - hi : 0);
    }
    const dg = Math.min(ground[a] + s, ground[b] + len - s);
    return Math.max(0, Math.min(DECK_H, RAMP * dg, DECK_H - RAMP * dc));
  }

  /**
   * Piers under a raised deck, every 16 m where it is high enough to stand on piers, except
   * where one would land on another street or the railway: [{ s, x, z, d, rot }].
   */
  deckPiers(road) {
    const cache = this._piers || (this._piers = new Map());
    if (cache.has(road)) return cache.get(road);
    const out = [], p = {}, t = this._t;
    for (let s = this.trimStart(road) + 8; s < this.length[road] - this.trimEnd(road) - 4; s += 16) {
      const d = this.deckAt(road, s);
      if (d < SOLID_BELOW) continue;
      this.pointAt(road, s, p);
      const x = p.x, z = p.z;
      const onStreet = this.grid.query(x - 2, z - 2, x + 2, z + 2, i => {
        const r = this.ptRoad[i];
        if (r === road || this.raised[r]) return false;
        const hw = this.width[r] / 2 + 1;
        return pointSegDist2(x, z, this.px[i], this.pz[i], this.px[i + 1], this.pz[i + 1], t) < hw * hw;
      });
      if (onStreet || this._rails.some(line => { for (let i = 0; i + 3 < line.length; i += 2) if (pointSegDist2(x, z, line[i], line[i + 1], line[i + 2], line[i + 3]) < 25) return true; return false; })) continue;
      out.push({ s, x, z, d, rot: Math.atan2(p.dx, p.dz) });
    }
    cache.set(road, out);
    return out;
  }

  /** Highest deck over (x, z), 0 when no flyover passes overhead (keeps lamps and stalls out from under it). */
  deckOver(x, z) {
    let best = 0;
    const t = this._t;
    this.grid.query(x - 1, z - 1, x + 1, z + 1, i => {
      const r = this.ptRoad[i];
      if (!this.raised[r]) return;
      const hw = this.width[r] / 2 + 1;
      if (pointSegDist2(x, z, this.px[i], this.pz[i], this.px[i + 1], this.pz[i + 1], t) > hw * hw) return;
      best = Math.max(best, this.deckAt(r, this.cum[i] + (this.cum[i + 1] - this.cum[i]) * t[0]));
    });
    return best;
  }

  /**
   * The surface height under (x, z) for something now at height y: a flyover deck it is
   * on (or driving up onto from the ramp's foot), else the ground (0). Decks far above
   * or below y are passed under or over.
   */
  surfaceAt(x, z, y = 0) {
    let best = 0, bestErr = Math.abs(y), t = this._t;
    this.grid.query(x - 1, z - 1, x + 1, z + 1, i => {
      const r = this.ptRoad[i];
      if (!this.raised[r]) return;
      const d2 = pointSegDist2(x, z, this.px[i], this.pz[i], this.px[i + 1], this.pz[i + 1], t);
      const hw = this.width[r] / 2 + 0.4;
      if (d2 > hw * hw) return;
      const h = this.deckAt(r, this.cum[i] + (this.cum[i + 1] - this.cum[i]) * t[0]);
      const err = Math.abs(h - y);
      if (err < 2.6 && err < bestErr) { best = h; bestErr = err; }
    });
    return best;
  }

  name(road) { return this.names[this.nameId[road]] || ''; }
  trimStart(road) { return Math.min(this.jRadius[this.ra[road]], this.length[road] * 0.45); }
  trimEnd(road) { return Math.min(this.jRadius[this.rb[road]], this.length[road] * 0.45); }

  /** May traffic travel along the road in direction dir (+1 from a to b, -1 from b to a)? */
  canTravel(road, dir) { return !this.oneway[road] || this.oneway[road] === dir; }

  /**
   * Which side of the road (+1 left of a->b, -1 right) has the kerb people use, or 0
   * when both do: a carriageway of a divided road has the median on its other side.
   */
  kerbSide(road) { return this.paired[road] ? this.oneway[road] : 0; }

  /** Distance from the centre line to the road's edge on `side` (+1 left of a->b, -1 right), s metres along. */
  edgeAt(road, s, side) {
    return this.oneway[road] && side === -this.oneway[road] ? this.innerAt(road, s) : this.width[road] / 2;
  }

  /** Distance from the centre line to the median-side edge, s metres along the road. */
  innerAt(road, s) {
    if (!this.paired[road] && !this.oneway[road]) return this.width[road] / 2;
    const p = this.pointAt(road, s, this._in || (this._in = {}));
    const lo = p.seg, hi = Math.min(lo + 1, this.ptStart[road + 1] - 1);
    const span = this.cum[hi] - this.cum[lo];
    const f = span > 1e-6 ? clamp((s - this.cum[lo]) / span, 0, 1) : 0;
    return this.inner[lo] + (this.inner[hi] - this.inner[lo]) * f;
  }

  /**
   * Lane centre offset to the driver's left for lane 0 (kerb side) or 1, s metres
   * along the road. A one-way road's driver always travels its legal way.
   */
  laneOffset(road, lane = 0, s = this.length[road] / 2) {
    const w = this.width[road], hw = w / 2;
    if (this.oneway[road]) {
      // The whole carriageway runs one way: the kerb lane on the left, the other by the median.
      const inner = this.innerAt(road, s), W = hw + inner;
      if (W < 6.4) return (hw - inner) / 2 + W * 0.08;
      return lane === 0 ? hw - W / 4 : -inner + W / 4;
    }
    if (this.lanes[road] === 1) return w * 0.25;
    return lane === 0 ? w * 0.375 : w * 0.125;
  }

  /** Point at distance s along the road's polyline; out = {x, z, dx, dz} (unit tangent). */
  pointAt(road, s, out) {
    const a = this.ptStart[road], b = this.ptStart[road + 1] - 1;
    s = clamp(s, 0, this.length[road]);
    // Binary search on cumulative distances.
    let lo = a, hi = b;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (this.cum[mid] <= s) lo = mid; else hi = mid;
    }
    const segLen = this.cum[hi] - this.cum[lo];
    const t = segLen > 1e-6 ? (s - this.cum[lo]) / segLen : 0;
    const dx = this.px[hi] - this.px[lo], dz = this.pz[hi] - this.pz[lo];
    const len = Math.hypot(dx, dz) || 1;
    out.x = this.px[lo] + dx * t;
    out.z = this.pz[lo] + dz * t;
    out.dx = dx / len;
    out.dz = dz / len;
    out.seg = lo;
    return out;
  }

  /**
   * Lane position: dir +1 travels from junction a to b, -1 from b to a. s is the
   * distance travelled in that direction. out also gets the travel heading.
   */
  lanePoint(road, dir, s, offset, out) {
    const len = this.length[road];
    this.pointAt(road, dir > 0 ? s : len - s, out);
    let fx = out.dx, fz = out.dz;
    if (dir < 0) { fx = -fx; fz = -fz; }
    // Keep left: left of forward (fx, fz) is (fz, -fx).
    out.x += fz * offset;
    out.z += -fx * offset;
    out.dx = fx; out.dz = fz;
    out.heading = Math.atan2(fx, fz);
    return out;
  }

  /** Nearest point on any road within maxDist. Returns null or {road, s, x, z, dist, dx, dz}. */
  nearest(x, z, maxDist = 60, out = {}, filter = null) {
    let best = maxDist * maxDist, found = -1, bestT = 0;
    const t = this._t;
    for (let radius = Math.min(24, maxDist); ; radius = Math.min(radius * 2, maxDist)) {
      this.grid.query(x - radius, z - radius, x + radius, z + radius, i => {
        if (filter && !filter(this.ptRoad[i])) return;
        const d2 = pointSegDist2(x, z, this.px[i], this.pz[i], this.px[i + 1], this.pz[i + 1], t);
        if (d2 < best) { best = d2; found = i; bestT = t[0]; }
      });
      if (found >= 0 || radius >= maxDist) break;
    }
    if (found < 0) return null;
    const road = this.ptRoad[found];
    const ax = this.px[found], az = this.pz[found], bx = this.px[found + 1], bz = this.pz[found + 1];
    const segLen = Math.hypot(bx - ax, bz - az) || 1;
    out.road = road;
    out.s = this.cum[found] + segLen * bestT;
    out.seg = found;
    out.x = ax + (bx - ax) * bestT;
    out.z = az + (bz - az) * bestT;
    out.dx = (bx - ax) / segLen;
    out.dz = (bz - az) / segLen;
    out.dist = Math.sqrt(best);
    return out;
  }

  /** True when (x, z) lies on a road surface (plus margin). */
  onRoad(x, z, margin = 0) {
    const t = this._t;
    return this.grid.query(x - 1, z - 1, x + 1, z + 1, i => {
      const r = this.ptRoad[i], hw = this.width[r] / 2 + margin;
      return pointSegDist2(x, z, this.px[i], this.pz[i], this.px[i + 1], this.pz[i + 1], t) < hw * hw;
    }) || this.nearJunction(x, z, margin);
  }

  nearJunction(x, z, margin = 0) {
    // Junction discs are covered by the road segments themselves except at
    // their paved corners; a coarse check against road ends is enough here.
    return false;
  }

  /** Clearance from (x, z) to the nearest road edge (negative when on the road). */
  roadClearance(x, z, search = 30) {
    let best = Infinity;
    const t = this._t;
    this.grid.query(x - search, z - search, x + search, z + search, i => {
      const r = this.ptRoad[i];
      const d = Math.sqrt(pointSegDist2(x, z, this.px[i], this.pz[i], this.px[i + 1], this.pz[i + 1], t)) - this.width[r] / 2;
      if (d < best) best = d;
    });
    return best;
  }

  /** Visit every road segment touching the rect: fn(pointIndex, road). */
  segmentsIn(minX, minZ, maxX, maxZ, fn) {
    const seen = this._seen || (this._seen = new Set());
    seen.clear();
    this.grid.query(minX, minZ, maxX, maxZ, i => {
      if (seen.has(i)) return;
      seen.add(i);
      fn(i, this.ptRoad[i]);
    });
  }

  otherEnd(road, junction) { return this.ra[road] === junction ? this.rb[road] : this.ra[road]; }

  /**
   * Shortest drivable route between two world points along the network (A*).
   * Returns { points: [x0, z0, x1, z1, ...], length } or null.
   */
  route(fromX, fromZ, toX, toZ, { plain = false } = {}) {
    const start = this.nearest(fromX, fromZ, 400, {});
    const goal = this.nearest(toX, toZ, 400, {});
    if (!start || !goal) return null;
    const nj = this.junctionCount;
    if (!this._g) {
      this._g = new Float64Array(nj);
      this._came = new Int32Array(nj);
      this._cameRoad = new Int32Array(nj);
      this._closed = new Uint32Array(nj);
      this._seenAt = new Uint32Array(nj);
      this._stamp = 0;
    }
    const g = this._g, came = this._came, cameRoad = this._cameRoad, closed = this._closed, seenAt = this._seenAt;
    const stamp = ++this._stamp;
    const cost = r => (plain ? 1 : TYPE_COST[this.type[r]]);
    // Wrong way down a one-way road: allowed, but only when nothing else gets there.
    const way = (r, dir) => (this.canTravel(r, dir) ? 1 : WRONG_WAY);
    const heap = new MinHeap(256);
    const tx = goal.x, tz = goal.z;
    const h = j => Math.hypot(this.jx[j] - tx, this.jz[j] - tz);
    const open = (j, gv, from, road) => {
      if (closed[j] === stamp) return;
      if (seenAt[j] === stamp && g[j] <= gv) return;
      seenAt[j] = stamp; g[j] = gv; came[j] = from; cameRoad[j] = road;
      heap.push(j, gv + h(j));
    };
    const sr = start.road, gr = goal.road;
    const sameRoadCost = sr === gr ? Math.abs(goal.s - start.s) * cost(sr) * way(sr, goal.s >= start.s ? 1 : -1) : Infinity;
    open(this.ra[sr], start.s * cost(sr) * way(sr, -1), -1, sr);
    open(this.rb[sr], (this.length[sr] - start.s) * cost(sr) * way(sr, 1), -2, sr);
    let bestCost = sameRoadCost, bestEnd = -1;
    while (heap.size) {
      const j = heap.pop();
      if (closed[j] === stamp) continue;
      closed[j] = stamp;
      if (g[j] + h(j) >= bestCost) break;
      // Reaching either end of the goal road finishes along it.
      if (this.ra[gr] === j) { const c = g[j] + goal.s * cost(gr) * way(gr, 1); if (c < bestCost) { bestCost = c; bestEnd = j; } }
      if (this.rb[gr] === j) { const c = g[j] + (this.length[gr] - goal.s) * cost(gr) * way(gr, -1); if (c < bestCost) { bestCost = c; bestEnd = j; } }
      for (const r of this.jRoads[j]) {
        const other = this.otherEnd(r, j);
        open(other, g[j] + this.length[r] * cost(r) * way(r, this.ra[r] === j ? 1 : -1), j, r);
      }
    }
    const pts = [start.x, start.z];
    if (bestEnd < 0) {
      if (sr !== gr) return null;
      this._appendAlong(pts, sr, start.s, goal.s);
      pts.push(goal.x, goal.z);
      return { points: pts, length: Math.abs(goal.s - start.s) };
    }
    // Walk back from the junction where we joined the goal road.
    const chain = [];
    for (let j = bestEnd; ; ) {
      const from = came[j];
      chain.push(j);
      if (from < 0) break;
      j = from;
    }
    chain.reverse();
    const first = chain[0];
    this._appendAlong(pts, sr, start.s, this.ra[sr] === first && came[first] === -1 ? 0 : this.length[sr]);
    for (let i = 1; i < chain.length; i++) {
      const j = chain[i], r = cameRoad[j];
      const fromEnd = chain[i - 1];
      if (this.ra[r] === fromEnd) this._appendAlong(pts, r, 0, this.length[r]);
      else this._appendAlong(pts, r, this.length[r], 0);
    }
    this._appendAlong(pts, gr, this.ra[gr] === bestEnd ? 0 : this.length[gr], goal.s);
    pts.push(goal.x, goal.z);
    let length = 0;
    for (let i = 2; i < pts.length; i += 2) length += Math.hypot(pts[i] - pts[i - 2], pts[i + 1] - pts[i - 1]);
    return { points: pts, length };
  }

  /**
   * Shift a route's points into the left-hand lane (India drives on the left), so
   * vehicles following it keep off the centre line and the medians.
   */
  lanePath(points) {
    const out = new Array(points.length);
    const n = points.length / 2, near = {};
    for (let i = 0; i < n; i++) {
      const x = points[i * 2], z = points[i * 2 + 1];
      const a = Math.max(0, i - 1), b = Math.min(n - 1, i + 1);
      let dx = points[b * 2] - points[a * 2], dz = points[b * 2 + 1] - points[a * 2 + 1];
      const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
      const r = this.nearest(x, z, 8, near);
      const w = r ? this.width[r.road] : 6;
      let off = i === 0 || i === n - 1 ? 0 : this.lanes[r ? r.road : 0] > 1 ? w * 0.3 : w * 0.25;
      if (off && r && this.oneway[r.road]) {
        // A one-way carriageway: keep to its middle, the way it runs (even when going against it).
        const mid = (w / 2 - this.innerAt(r.road, r.s)) / 2;
        off = (r.dx * dx + r.dz * dz) * this.oneway[r.road] >= 0 ? mid : -mid;
      }
      // At a sharp corner the lane line would cut across the kerb: hug the centre instead.
      if (i > 0 && i < n - 1) {
        const h1 = Math.atan2(x - points[(i - 1) * 2], z - points[(i - 1) * 2 + 1]);
        const h2 = Math.atan2(points[(i + 1) * 2] - x, points[(i + 1) * 2 + 1] - z);
        let turn = Math.abs(h2 - h1); if (turn > Math.PI) turn = 2 * Math.PI - turn;
        off *= Math.max(0.15, 1 - turn / 1.4);
      }
      // Left of travel (dx, dz) is (dz, -dx).
      out[i * 2] = x + dz * off; out[i * 2 + 1] = z - dx * off;
    }
    return out;
  }

  /** Append polyline points of a road between distances s0 and s1 (either order). */
  _appendAlong(pts, road, s0, s1) {
    const a = this.ptStart[road], b = this.ptStart[road + 1];
    const push = (x, z) => {
      const n = pts.length;
      if (n >= 2 && Math.abs(pts[n - 2] - x) < 0.05 && Math.abs(pts[n - 1] - z) < 0.05) return;
      pts.push(x, z);
    };
    const p = {};
    this.pointAt(road, s0, p); push(p.x, p.z);
    if (s1 >= s0) { for (let i = a; i < b; i++) if (this.cum[i] > s0 && this.cum[i] < s1) push(this.px[i], this.pz[i]); }
    else { for (let i = b - 1; i >= a; i--) if (this.cum[i] < s0 && this.cum[i] > s1) push(this.px[i], this.pz[i]); }
    this.pointAt(road, s1, p); push(p.x, p.z);
  }
}
