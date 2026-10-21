// Static collision world: every building, wall, tree trunk, pole, stall,
// bridge railing and median as an oriented box or a circle on the ground plane.
import { SpatialGrid, clamp } from '../core/math.js';
import { PROP } from './citygen.js';
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
    this.n = 0;
    this._build();
  }

  addBox(x, z, hw, hd, rot, h) {
    const i = this.n++;
    this.type[i] = SOLID.OBB; this.x[i] = x; this.z[i] = z; this.hw[i] = hw; this.hd[i] = hd;
    this.c[i] = Math.cos(rot); this.s[i] = Math.sin(rot); this.h[i] = h;
    const e = Math.abs(hw * this.c[i]) + Math.abs(hd * this.s[i]), f = Math.abs(hw * this.s[i]) + Math.abs(hd * this.c[i]);
    this.grid.insertRect(i, x - e, z - f, x + e, z + f);
    return i;
  }
  addCircle(x, z, r, h) {
    const i = this.n++;
    this.type[i] = SOLID.CIRCLE; this.x[i] = x; this.z[i] = z; this.hw[i] = r; this.hd[i] = r; this.c[i] = 1; this.s[i] = 0; this.h[i] = h;
    this.grid.insertRect(i, x - r, z - r, x + r, z + r);
    return i;
  }

  _build() {
    const { city } = this;
    const L = city.lots;
    for (let i = 0; i < L.count; i++) this.addBox(L.x[i], L.z[i], L.hw[i], L.hd[i], L.rot[i], L.h[i] + 1);
    for (const p of city.places) for (const b of placeColliders(p)) this.addBox(b.x, b.z, b.hw, b.hd, b.rot, b.h);
    const T = city.trees;
    for (let i = 0; i < T.count; i++) this.addCircle(T.x[i], T.z[i], T.kind[i] === 2 ? 0.75 : 0.32, 2.5);
    const P = city.props;
    for (let i = 0; i < P.count; i++) {
      const k = P.kind[i], x = P.x[i], z = P.z[i], rot = P.rot[i];
      if (k === PROP.LAMP || k === PROP.POLE) this.addCircle(x, z, 0.18, 8);
      else if (k === PROP.MEDIAN_LAMP) this.addCircle(x, z, 0.3, 8);
      else if (k === PROP.STALL) this.addBox(x, z, 1.05, 0.85, rot, 2.2);
      else if (k === PROP.CART) this.addBox(x, z, 0.95, 0.6, rot, 1.2);
      else if (k === PROP.SHRINE) this.addBox(x, z, 0.75, 0.75, rot, 2.5);
      else if (k === PROP.HOARDING) { const c = Math.cos(rot), s = Math.sin(rot); this.addCircle(x + c * 2.2, z - s * 2.2, 0.15, 8); this.addCircle(x - c * 2.2, z + s * 2.2, 0.15, 8); }
    }
    // Bridge railings and wide-road medians, segment by segment.
    const net = city.net, p = {};
    for (let r = 0; r < net.count; r++) {
      const w = net.width[r];
      const bridge = net.bridge[r], median = w >= 11.5 && !bridge;
      if (!bridge && !median) continue;
      const s0 = net.trimStart(r), s1 = net.length[r] - net.trimEnd(r);
      for (let s = s0; s < s1 - 0.5; s += 8) {
        const e = Math.min(s + 8, s1);
        net.pointAt(r, (s + e) / 2, p);
        const rot = Math.atan2(p.dx, p.dz);
        const half = (e - s) / 2;
        if (bridge) {
          for (const side of [1, -1]) {
            const off = w / 2 + 0.2;
            this.addBox(p.x + p.dz * off * side, p.z - p.dx * off * side, 0.2, half + 0.3, rot, 1.0);
          }
        } else this.addBox(p.x, p.z, 0.35, half, rot, 0.35);
      }
    }
  }

  /** fn(i) for colliders near the rect. Indices may repeat. */
  near(minX, minZ, maxX, maxZ, fn) { return this.grid.query(minX, minZ, maxX, maxZ, fn); }

  /**
   * Push a circle out of everything it overlaps. Mutates pos {x, z}; returns the
   * accumulated push normal (out.nx/out.nz) and whether anything was hit.
   */
  resolveCircle(pos, r, out, maxH = Infinity) {
    let hit = false;
    out.nx = 0; out.nz = 0;
    const seen = this._seen || (this._seen = new Set());
    seen.clear();
    this.grid.query(pos.x - r, pos.z - r, pos.x + r, pos.z + r, i => {
      if (seen.has(i)) return;
      seen.add(i);
      if (this.h[i] < 0.3 || this.h[i] > maxH + 100) return;
      if (this.type[i] === SOLID.CIRCLE) {
        const dx = pos.x - this.x[i], dz = pos.z - this.z[i];
        const rr = r + this.hw[i], d2 = dx * dx + dz * dz;
        if (d2 >= rr * rr) return;
        const d = Math.sqrt(d2) || 1e-4;
        const push = rr - d;
        pos.x += (dx / d) * push; pos.z += (dz / d) * push;
        out.nx += dx / d; out.nz += dz / d; hit = true;
        return;
      }
      const c = this.c[i], s = this.s[i];
      const dx = pos.x - this.x[i], dz = pos.z - this.z[i];
      const lx = dx * c - dz * s, lz = dx * s + dz * c;
      const hw = this.hw[i], hd = this.hd[i];
      const cx = clamp(lx, -hw, hw), cz = clamp(lz, -hd, hd);
      let ex = lx - cx, ez = lz - cz;
      const d2 = ex * ex + ez * ez;
      if (d2 >= r * r) return;
      let nlx, nlz, depth;
      if (d2 > 1e-10) { const d = Math.sqrt(d2); nlx = ex / d; nlz = ez / d; depth = r - d; }
      else {
        const px = hw - Math.abs(lx), pz = hd - Math.abs(lz);
        if (px < pz) { nlx = lx < 0 ? -1 : 1; nlz = 0; depth = px + r; } else { nlx = 0; nlz = lz < 0 ? -1 : 1; depth = pz + r; }
      }
      const nx = nlx * c + nlz * s, nz = -nlx * s + nlz * c;
      pos.x += nx * depth; pos.z += nz * depth;
      out.nx += nx; out.nz += nz; hit = true;
    });
    if (hit) { const l = Math.hypot(out.nx, out.nz) || 1; out.nx /= l; out.nz /= l; }
    return hit;
  }

  /**
   * Deepest penetration of an oriented box (a vehicle) into the static world.
   * Writes {nx, nz, depth, px, pz} (normal pushes the vehicle out; p = contact point).
   */
  boxContact(x, z, hw, hd, rot, out) {
    const ca = Math.cos(rot), sa = Math.sin(rot);
    const ext = Math.abs(hw * ca) + Math.abs(hd * sa) + 0.5, ezt = Math.abs(hw * sa) + Math.abs(hd * ca) + 0.5;
    let best = 0;
    const seen = this._seen2 || (this._seen2 = new Set());
    seen.clear();
    // Vehicle axes: local x = (ca, -sa), local z = (sa, ca).
    this.grid.query(x - ext, z - ezt, x + ext, z + ezt, i => {
      if (seen.has(i)) return;
      seen.add(i);
      if (this.h[i] < 0.3) return;
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
      // Only real walls block the view: poles, trunks and low kerbs never do.
      if (this.h[i] < 1.2 || this.type[i] === SOLID.CIRCLE || Math.min(this.hw[i], this.hd[i]) < 0.3) return;
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
      // Height check: the segment must be below the obstacle's top where it enters.
      const y = ay + (by - ay) * t0;
      if (y > this.h[i]) {
        const y1 = ay + (by - ay) * t1;
        if (y1 > this.h[i]) return;
      }
      if (t0 < tmin) tmin = t0;
    });
    return tmin;
  }

  /** True when a circle at (x, z) overlaps anything solid. */
  blocked(x, z, r) {
    const p = this._bp || (this._bp = { x: 0, z: 0 });
    p.x = x; p.z = z;
    return this.resolveCircle(p, r, this._bo || (this._bo = {}));
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
