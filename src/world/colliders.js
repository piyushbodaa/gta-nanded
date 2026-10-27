// Static collision world: every building, wall, tree trunk, pole, stall,
// bridge railing and median as an oriented box or a circle on the ground plane,
// standing from a base height y0 (0 on the ground; a flyover's railings ride on
// its deck) up h metres. Queries say at what level they are asked, so a car on a
// flyover and a car on the street beneath it never meet each other's walls.
import { SpatialGrid, clamp } from '../core/math.js';
import { PROP, PUMP_HW, PUMP_HD } from './citygen.js';
import { MEDIAN_W, SOLID_BELOW } from './roadnet.js';
import { placeColliders } from './landmarks.js';

export const SOLID = { OBB: 0, CIRCLE: 1 };

export class Colliders {
  constructor(city) {
    this.city = city;
    this.grid = new SpatialGrid(16);
    const cap = city.lots.count + city.trees.count + city.props.count + 20000;
    this.type = new Uint8Array(cap);
    this.x = new Float32Array(cap); this.z = new Float32Array(cap);
    this.hw = new Float32Array(cap); this.hd = new Float32Array(cap);
    this.c = new Float32Array(cap); this.s = new Float32Array(cap);
    this.h = new Float32Array(cap);
    this.y0 = new Float32Array(cap);
    this.n = 0;
    this._q = 0; // resolveCircle's query number
    this._build();
  }

  /** Double the arrays when full (a busy city outgrows any fixed estimate). */
  _grow() {
    const cap = this.type.length * 2;
    for (const k of ['type', 'x', 'z', 'hw', 'hd', 'c', 's', 'h', 'y0']) { const a = new this[k].constructor(cap); a.set(this[k]); this[k] = a; }
    this._mark = null;
  }

  addBox(x, z, hw, hd, rot, h, y0 = 0) {
    if (this.n >= this.type.length) this._grow();
    const i = this.n++;
    this.type[i] = SOLID.OBB; this.x[i] = x; this.z[i] = z; this.hw[i] = hw; this.hd[i] = hd;
    this.c[i] = Math.cos(rot); this.s[i] = Math.sin(rot); this.h[i] = h; this.y0[i] = y0;
    const e = Math.abs(hw * this.c[i]) + Math.abs(hd * this.s[i]), f = Math.abs(hw * this.s[i]) + Math.abs(hd * this.c[i]);
    this.grid.insertRect(i, x - e, z - f, x + e, z + f);
    return i;
  }
  addCircle(x, z, r, h, y0 = 0) {
    if (this.n >= this.type.length) this._grow();
    const i = this.n++;
    this.type[i] = SOLID.CIRCLE; this.x[i] = x; this.z[i] = z; this.hw[i] = r; this.hd[i] = r; this.c[i] = 1; this.s[i] = 0; this.h[i] = h; this.y0[i] = y0;
    this.grid.insertRect(i, x - r, z - r, x + r, z + r);
    return i;
  }

  _build() {
    const { city } = this;
    const L = city.lots;
    for (let i = 0; i < L.count; i++) {
      // A building on the river valley's slope stands on its plinth, down to the ground.
      const base = city.footing(i);
      this.addBox(L.x[i], L.z[i], L.hw[i], L.hd[i], L.rot[i], L.h[i] + 1 - base, base);
      const c = Math.cos(L.rot[i]), s = Math.sin(L.rot[i]);
      const front = (lz, d) => [L.x[i] + (lz - d / 2) * s, L.z[i] + (lz - d / 2) * c];
      // The raised platform along a shop front (too high to drive or walk through).
      const ota = city.shopPlatform(i);
      if (ota > 0) { const [x, z] = front(-L.hd[i], ota); this.addBox(x, z, L.hw[i] - 0.05, ota / 2, L.rot[i], 0.35); }
      // Compound wall in front of a house, and its gate (drawn shut, so it is solid too).
      if (city.compoundWall(i)) {
        const f = -L.hd[i] - 1.6 + 0.1, half = (L.hw[i] - 0.8) / 2;
        for (const side of [-1, 1]) {
          const lx = side * (0.8 + half);
          this.addBox(L.x[i] + lx * c + f * s, L.z[i] - lx * s + f * c, half, 0.12, L.rot[i], 1.25);
        }
        const fg = -L.hd[i] - 1.6; // the gate hangs on the wall's outer face
        this.addBox(L.x[i] + fg * s, L.z[i] + fg * c, 0.8, 0.06, L.rot[i], 1.2);
      }
    }
    for (const p of city.places) for (const b of placeColliders(p)) b.r ? this.addCircle(b.x, b.z, b.r, b.h) : this.addBox(b.x, b.z, b.hw, b.hd, b.rot, b.h);
    // Petrol pumps: canopy columns, dispenser islands, the kiosk and the price board.
    for (const pump of city.pumps || []) {
      const { x, z, rot, k } = pump, c = Math.cos(rot), s = Math.sin(rot), at = (lx, lz) => [x + lx * c + lz * s, z - lx * s + lz * c];
      const cw = 8.5 * k, cd = 4.6 * k;
      for (const [lx, lz] of [[-cw + 1.2, -cd + 1.2], [cw - 1.2, -cd + 1.2], [-cw + 1.2, cd - 1.2], [cw - 1.2, cd - 1.2]]) { const [px, pz] = at(lx, lz - 1.5); this.addCircle(px, pz, 0.25, 5); }
      for (const lx of [-3.6 * k, 3.6 * k]) { const [px, pz] = at(lx, -1.5); this.addBox(px, pz, 0.6, 2.2, rot, 1.9); }
      { const [px, pz] = at(PUMP_HW * k - 5 * k, PUMP_HD * k - 2.4); this.addBox(px, pz, 3.6 * k, 2.2, rot, 3.5); }
      { const [px, pz] = at(-PUMP_HW * k + 1.2, -PUMP_HD * k + 0.2); this.addBox(px, pz, 0.95, 0.4, rot, 6.4); }
    }
    const T = city.trees;
    for (let i = 0; i < T.count; i++) {
      // A tree down the riverbank stands from the ground there, as tall as ever above the street.
      const base = Math.min(0, city.groundHeight(T.x[i], T.z[i]));
      this.addCircle(T.x[i], T.z[i], T.kind[i] === 2 ? 0.75 : T.kind[i] === 5 ? 0.6 : 0.32, (T.kind[i] === 5 ? 1.2 : 2.5) - base, base);
    }
    const P = city.props;
    for (let i = 0; i < P.count; i++) {
      const k = P.kind[i], x = P.x[i], z = P.z[i], rot = P.rot[i];
      if (k === PROP.LAMP || k === PROP.POLE) this.addCircle(x, z, 0.18, 8, P.y[i]);
      else if (k === PROP.MEDIAN_LAMP) this.addCircle(x, z, 0.3, 8, P.y[i]);
      else if (k === PROP.STALL) this.addBox(x, z, 1.05, 0.85, rot, 2.2);
      else if (k === PROP.CART) this.addBox(x, z, 0.95, 0.6, rot, 1.2);
      else if (k === PROP.SHRINE) this.addBox(x, z, 0.75, 0.75, rot, 2.5);
      else if (k === PROP.VENDOR) this.addBox(x, z, 1.0, 0.75, rot, 1.2);
      else if (k === PROP.HOARDING) { const c = Math.cos(rot), s = Math.sin(rot); this.addCircle(x + c * 2.2, z - s * 2.2, 0.15, 8); this.addCircle(x - c * 2.2, z + s * 2.2, 0.15, 8); }
    }
    // Bridge railings and wide-road medians. They go piece by piece along each straight stretch
    // of the polyline, which chunks.js draws them along (a flyover in the same 4 m pieces): one
    // piece laid across a bend would leave the drawn median, an invisible kerb in the lane on
    // one side of it and a gap through the median on the other.
    const net = city.net, p = {}, q = {};
    for (let r = 0; r < net.count; r++) {
      const w = net.width[r], lift = net.raised[r];
      // A carriageway of a divided road has its half of the median on its right (ms: +1 left of a->b, -1 right).
      const ms = net.oneway[r] ? -net.oneway[r] : 0;
      const bridge = net.bridge[r], median = w >= 11.5 && !bridge && !ms;
      if (!bridge && !lift && !median && !ms) continue;
      const s0 = net.trimStart(r), s1 = net.length[r] - net.trimEnd(r), step = lift ? 4 : 8;
      for (let i = net.ptStart[r]; i < net.ptStart[r + 1] - 1; i++) {
        const sa = Math.max(net.cum[i], s0), sb = Math.min(net.cum[i + 1], s1);
        if (sb - sa < 0.05) continue;
        const n = Math.ceil((sb - sa) / step);
        for (let k = 0; k < n; k++) {
          const s = sa + ((sb - sa) * k) / n, e = sa + ((sb - sa) * (k + 1)) / n, sm = (s + e) / 2;
          net.pointAt(r, sm, p);
          const rot = Math.atan2(p.dx, p.dz);
          const half = (e - s) / 2;
          const inner = ms ? net.innerAt(r, sm) : w / 2, divided = inner < w / 2 - 0.05;
          const dA = lift ? net.deckAt(r, s) : 0, dB = lift ? net.deckAt(r, e) : 0, lo = Math.min(dA, dB), hi = Math.max(dA, dB);
          if (bridge || hi > 0.05) {
            // Railings ride on a deck you can pass under; a low ramp is walled down to the ground.
            const y0 = lo >= SOLID_BELOW ? lo - 0.3 : 0, top = hi + 1.0;
            for (const side of [1, -1]) {
              const mid = side === ms && divided, off = mid ? inner - 0.15 : w / 2 + 0.2;
              this.addBox(p.x + p.dz * off * side, p.z - p.dx * off * side, mid ? 0.15 : 0.2, half + 0.3, rot, top - y0, y0);
            }
            if (lo < SOLID_BELOW && hi >= SOLID_BELOW) {
              // Here the deck comes down onto its solid embankment, and chunks.js slopes the
              // underside from the deck to the ground across this piece. Close its lower half,
              // where the slope comes down below a car's roof, across the carriageway: else a car
              // or someone on foot under the deck goes on into the ramp. It stays below the deck,
              // so the deck's own traffic passes over it. Out to the embankment's sides: 0.35 m
              // past the kerb edge, and on the edge on a divided road's median side.
              net.pointAt(r, dA > dB ? (sm + e) / 2 : (s + sm) / 2, q);
              const out = side => (side === ms && divided ? 0 : 0.35);
              const eL = net.edgeAt(r, sm, 1) + out(1), eR = net.edgeAt(r, sm, -1) + out(-1), off = (eL - eR) / 2;
              this.addBox(q.x + p.dz * off, q.z - p.dx * off, (eL + eR) / 2, half / 2, rot, Math.max(0.5, lo - 1.1));
            }
          } else if (divided) {
            const off = inner + MEDIAN_W / 4;
            this.addBox(p.x + p.dz * off * ms, p.z - p.dx * off * ms, MEDIAN_W / 4, half, rot, 0.35);
          } else if (median) this.addBox(p.x, p.z, 0.35, half, rot, 0.35);
        }
      }
      if (lift) for (const pier of net.deckPiers(r)) this.addCircle(pier.x, pier.z, 0.6, pier.d - 1.1);
      // A river bridge's piers, span by span as chunks.js draws them: in the way down on the bank.
      else if (bridge) {
        for (let i = net.ptStart[r]; i < net.ptStart[r + 1] - 1; i++) {
          const sa = Math.max(net.cum[i], s0), sb = Math.min(net.cum[i + 1], s1);
          if (sb - sa < 0.05) continue;
          const a = net.pointAt(r, sa, {}), b = net.pointAt(r, sb, {});
          const hw = Math.max(net.edgeAt(r, sa, 1), net.edgeAt(r, sa, -1), net.edgeAt(r, sb, 1), net.edgeAt(r, sb, -1));
          city.riverPiers(a.x, a.z, b.x, b.z, hw, (x, z, y0, y1, hx, hz, rot) => this.addBox(x, z, hx, hz, rot, y1 - y0, y0));
        }
      }
    }
  }

  /** fn(i) for colliders near the rect. Indices may repeat. */
  near(minX, minZ, maxX, maxZ, fn) { return this.grid.query(minX, minZ, maxX, maxZ, fn); }

  /** Does collider i stand in the way of something at height `level` (about 2 m tall)? */
  _atLevel(i, level) { return this.y0[i] < level + 2 && this.y0[i] + this.h[i] > level + 0.3; }

  /**
   * Push a circle out of everything it overlaps. Mutates pos {x, z}; returns the
   * accumulated push normal (out.nx/out.nz) and whether anything was hit.
   */
  resolveCircle(pos, r, out, maxH = Infinity, level = 0) {
    let hit = false;
    out.nx = 0; out.nz = 0;
    // Walks the grid cells itself, marking each collider with this query's number so one that
    // spans several cells is resolved once: no closure or set per call, as every walker,
    // vehicle and the player call this each frame.
    const mark = this._mark || (this._mark = new Uint32Array(this.type.length));
    let q = (this._q + 1) >>> 0;
    if (q === 0) { mark.fill(0); q = 1; }
    this._q = q;
    const G = this.grid, C = G.cell;
    const x0 = Math.floor((pos.x - r) / C), x1 = Math.floor((pos.x + r) / C), z0 = Math.floor((pos.z - r) / C), z1 = Math.floor((pos.z + r) / C);
    for (let gx = x0; gx <= x1; gx++) {
      for (let gz = z0; gz <= z1; gz++) {
        const list = G.map.get(G.key(gx, gz));
        if (!list) continue;
        for (let k = 0; k < list.length; k++) {
          const i = list[k];
          if (mark[i] === q) continue;
          mark[i] = q;
          if (this.h[i] < 0.3 || this.h[i] > maxH + 100 || !this._atLevel(i, level)) continue;
          if (this.type[i] === SOLID.CIRCLE) {
            const dx = pos.x - this.x[i], dz = pos.z - this.z[i];
            const rr = r + this.hw[i], d2 = dx * dx + dz * dz;
            if (d2 >= rr * rr) continue;
            const d = Math.sqrt(d2) || 1e-4;
            const push = rr - d;
            pos.x += (dx / d) * push; pos.z += (dz / d) * push;
            out.nx += dx / d; out.nz += dz / d; hit = true;
            continue;
          }
          const c = this.c[i], s = this.s[i];
          const dx = pos.x - this.x[i], dz = pos.z - this.z[i];
          const lx = dx * c - dz * s, lz = dx * s + dz * c;
          const hw = this.hw[i], hd = this.hd[i];
          const cx = clamp(lx, -hw, hw), cz = clamp(lz, -hd, hd);
          const ex = lx - cx, ez = lz - cz;
          const d2 = ex * ex + ez * ez;
          if (d2 >= r * r) continue;
          let nlx, nlz, depth;
          if (d2 > 1e-10) { const d = Math.sqrt(d2); nlx = ex / d; nlz = ez / d; depth = r - d; }
          else {
            const px = hw - Math.abs(lx), pz = hd - Math.abs(lz);
            if (px < pz) { nlx = lx < 0 ? -1 : 1; nlz = 0; depth = px + r; } else { nlx = 0; nlz = lz < 0 ? -1 : 1; depth = pz + r; }
          }
          const nx = nlx * c + nlz * s, nz = -nlx * s + nlz * c;
          pos.x += nx * depth; pos.z += nz * depth;
          out.nx += nx; out.nz += nz; hit = true;
        }
      }
    }
    if (hit) { const l = Math.hypot(out.nx, out.nz) || 1; out.nx /= l; out.nz /= l; }
    return hit;
  }

  /**
   * Deepest penetration of an oriented box (a vehicle) into the static world.
   * Writes {nx, nz, depth, px, pz} (normal pushes the vehicle out; p = contact point).
   */
  boxContact(x, z, hw, hd, rot, out, level = 0) {
    const ca = Math.cos(rot), sa = Math.sin(rot);
    const ext = Math.abs(hw * ca) + Math.abs(hd * sa) + 0.5, ezt = Math.abs(hw * sa) + Math.abs(hd * ca) + 0.5;
    let best = 0;
    const seen = this._seen2 || (this._seen2 = new Set());
    seen.clear();
    // Vehicle axes: local x = (ca, -sa), local z = (sa, ca).
    this.grid.query(x - ext, z - ezt, x + ext, z + ezt, i => {
      if (seen.has(i)) return;
      seen.add(i);
      if (this.h[i] < 0.3 || !this._atLevel(i, level)) return;
      if (this.type[i] === SOLID.CIRCLE) {
        // Circle vs vehicle box.
        const dx = this.x[i] - x, dz = this.z[i] - z;
        const lx = dx * ca - dz * sa, lz = dx * sa + dz * ca;
        const cx = clamp(lx, -hw, hw), cz = clamp(lz, -hd, hd);
        const ex = lx - cx, ez = lz - cz, d2 = ex * ex + ez * ez, r = this.hw[i];
        let nlx, nlz, depth;
        if (d2 > 1e-10) { if (d2 >= r * r) return; const d = Math.sqrt(d2); nlx = -ex / d; nlz = -ez / d; depth = r - d; }
        else { const px = hw - Math.abs(lx), pz = hd - Math.abs(lz); if (px < pz) { nlx = lx > 0 ? -1 : 1; nlz = 0; depth = px + r; } else { nlx = 0; nlz = lz > 0 ? -1 : 1; depth = pz + r; } }
        if (depth > best) {
          best = depth;
          out.nx = nlx * ca + nlz * sa; out.nz = -nlx * sa + nlz * ca; out.depth = depth;
          out.px = this.x[i] - out.nx * r; out.pz = this.z[i] - out.nz * r;
        }
        return;
      }
      const res = obbSat(x, z, hw, hd, ca, sa, this.x[i], this.z[i], this.hw[i], this.hd[i], this.c[i], this.s[i], this._sat || (this._sat = {}));
      if (res && res.depth > best) {
        best = res.depth;
        out.nx = res.nx; out.nz = res.nz; out.depth = res.depth;
        // Contact point: the vehicle corner deepest along -n.
        let bestP = -Infinity;
        for (const [u, v] of CORNERS) {
          const px = x + u * hw * ca + v * hd * sa, pz = z - u * hw * sa + v * hd * ca;
          const d = -(px * res.nx + pz * res.nz);
          if (d > bestP) { bestP = d; out.px = px; out.pz = pz; }
        }
      }
    });
    return best > 0 ? out : null;
  }

  /** First hit along a 3D segment (camera occlusion). Returns t in [0,1] or 1. */
  raycast(ax, ay, az, bx, by, bz, pad = 0.25) {
    let tmin = 1;
    const minX = Math.min(ax, bx) - pad, maxX = Math.max(ax, bx) + pad, minZ = Math.min(az, bz) - pad, maxZ = Math.max(az, bz) + pad;
    const seen = this._seen3 || (this._seen3 = new Set());
    seen.clear();
    this.grid.query(minX, minZ, maxX, maxZ, i => {
      if (seen.has(i)) return;
      seen.add(i);
      // Only walls block the view (thin compound walls included): poles, trunks and low kerbs never do.
      if (this.h[i] < 1.2 || this.type[i] === SOLID.CIRCLE) return;
      const hw = this.hw[i] + pad, hd = this.hd[i] + pad;
      const c = this.c[i], s = this.s[i];
      const ox = ax - this.x[i], oz = az - this.z[i];
      const lax = ox * c - oz * s, laz = ox * s + oz * c;
      const ex = bx - ax, ez = bz - az;
      const ldx = ex * c - ez * s, ldz = ex * s + ez * c;
      let t0 = 0, t1 = tmin;
      if (Math.abs(ldx) < 1e-9) { if (Math.abs(lax) > hw) return; }
      else { let ta = (-hw - lax) / ldx, tb = (hw - lax) / ldx; if (ta > tb) { const t = ta; ta = tb; tb = t; } t0 = Math.max(t0, ta); t1 = Math.min(t1, tb); if (t0 > t1) return; }
      if (Math.abs(ldz) < 1e-9) { if (Math.abs(laz) > hd) return; }
      else { let ta = (-hd - laz) / ldz, tb = (hd - laz) / ldz; if (ta > tb) { const t = ta; ta = tb; tb = t; } t0 = Math.max(t0, ta); t1 = Math.min(t1, tb); if (t0 > t1) return; }
      // Height check: the segment must pass between the obstacle's base and top.
      const y = ay + (by - ay) * t0, y1 = ay + (by - ay) * t1, top = this.y0[i] + this.h[i];
      if ((y > top && y1 > top) || (y < this.y0[i] && y1 < this.y0[i])) return;
      if (t0 < tmin) tmin = t0;
    });
    return tmin;
  }

  /** True when a circle at (x, z) overlaps anything solid (at height `level`). */
  blocked(x, z, r, level = 0) {
    const p = this._bp || (this._bp = { x: 0, z: 0 });
    p.x = x; p.z = z;
    return this.resolveCircle(p, r, this._bo || (this._bo = {}), Infinity, level);
  }
}

const CORNERS = [[-1, -1], [1, -1], [1, 1], [-1, 1]];

/** SAT for boxes given cos/sin; normal points from B to A. */
export function obbSat(ax, az, ahw, ahd, ac, as, bx, bz, bhw, bhd, bc, bs, out) {
  const axes = [ac, -as, as, ac, bc, -bs, bs, bc];
  const tx = ax - bx, tz = az - bz;
  let best = Infinity, bnx = 0, bnz = 0;
  for (let i = 0; i < 8; i += 2) {
    const nx = axes[i], nz = axes[i + 1];
    const ra = ahw * Math.abs(ac * nx - as * nz) + ahd * Math.abs(as * nx + ac * nz);
    const rb = bhw * Math.abs(bc * nx - bs * nz) + bhd * Math.abs(bs * nx + bc * nz);
    const d = tx * nx + tz * nz;
    const o = ra + rb - Math.abs(d);
    if (o <= 0) return null;
    if (o < best) { best = o; const sg = d < 0 ? -1 : 1; bnx = nx * sg; bnz = nz * sg; }
  }
  out.nx = bnx; out.nz = bnz; out.depth = best;
  return out;
}
