// Small, allocation-free math helpers shared by the simulation and the renderer.
//
// World convention: +x is east, +z is south, y is up. A heading θ faces
// forward = (sin θ, cos θ) on the ground plane, the same direction a Three.js
// object with rotation.y = θ points its local +z axis. Right = (-cos θ, sin θ).

export const TAU = Math.PI * 2;
export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const invLerp = (a, b, v) => clamp((v - a) / (b - a), 0, 1);
export const smoothstep = (a, b, v) => { const t = invLerp(a, b, v); return t * t * (3 - 2 * t); };
/** Frame-rate independent exponential approach: rate is "per second". */
export const damp = (a, b, rate, dt) => b + (a - b) * Math.exp(-rate * dt);
export const wrapAngle = a => { a = (a + Math.PI) % TAU; if (a < 0) a += TAU; return a - Math.PI; };
export const angleDiff = (from, to) => wrapAngle(to - from);
export const dampAngle = (a, b, rate, dt) => a + angleDiff(a, b) * (1 - Math.exp(-rate * dt));
export const dist2 = (ax, az, bx, bz) => (ax - bx) * (ax - bx) + (az - bz) * (az - bz);
export const dist = (ax, az, bx, bz) => Math.sqrt(dist2(ax, az, bx, bz));
export const headingTo = (fromX, fromZ, toX, toZ) => Math.atan2(toX - fromX, toZ - fromZ);
export const sign = v => (v < 0 ? -1 : 1);

/** Deterministic 32-bit integer hash (lowbias32). */
export function hash32(n) {
  n = (n ^ (n >>> 16)) >>> 0;
  n = Math.imul(n, 0x7feb352d) >>> 0;
  n = (n ^ (n >>> 15)) >>> 0;
  n = Math.imul(n, 0x846ca68b) >>> 0;
  return (n ^ (n >>> 16)) >>> 0;
}
export const hash2 = (a, b) => hash32((Math.imul(a | 0, 73856093) ^ Math.imul(b | 0, 19349663)) >>> 0);
export const hashFloat = n => hash32(n) / 4294967296;

/** Seeded PRNG (mulberry32). Returns a function producing floats in [0, 1). */
export function rng(seed) {
  let s = seed >>> 0;
  const next = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  next.range = (a, b) => a + next() * (b - a);
  next.int = (a, b) => a + Math.floor(next() * (b - a + 1));
  next.pick = list => list[Math.floor(next() * list.length)];
  next.chance = p => next() < p;
  return next;
}

/** Distance from point (px,pz) to segment (ax,az)-(bx,bz); also writes the closest t into out[0]. */
export function pointSegDist2(px, pz, ax, az, bx, bz, out) {
  const dx = bx - ax, dz = bz - az;
  const len2 = dx * dx + dz * dz;
  let t = len2 > 1e-9 ? ((px - ax) * dx + (pz - az) * dz) / len2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  if (out) out[0] = t;
  const cx = ax + dx * t - px, cz = az + dz * t - pz;
  return cx * cx + cz * cz;
}

/**
 * Oriented boxes on the ground plane: { x, z, hw, hd, rot } where hw/hd are half
 * extents along the box's local x (width) and z (depth), and rot is its heading.
 * Local x axis in world = (cos rot, -sin rot); local z = (sin rot, cos rot).
 */
export function pointInObb(px, pz, b, margin = 0) {
  const c = Math.cos(b.rot), s = Math.sin(b.rot);
  const dx = px - b.x, dz = pz - b.z;
  const lx = dx * c - dz * s, lz = dx * s + dz * c;
  return Math.abs(lx) <= b.hw + margin && Math.abs(lz) <= b.hd + margin;
}

/** Squared distance from a point to an oriented box (0 inside). */
export function pointObbDist2(px, pz, x, z, hw, hd, rot) {
  const c = Math.cos(rot), s = Math.sin(rot);
  const dx = px - x, dz = pz - z;
  const lx = dx * c - dz * s, lz = dx * s + dz * c;
  const ex = Math.max(Math.abs(lx) - hw, 0), ez = Math.max(Math.abs(lz) - hd, 0);
  return ex * ex + ez * ez;
}

const _axes = new Float64Array(8);
/**
 * Separating-axis test between two oriented rectangles. Returns null when they
 * do not overlap, otherwise writes the minimum translation that pushes A out of
 * B into out = { nx, nz, depth } (normal points from B to A).
 */
export function obbOverlap(ax, az, ahw, ahd, arot, bx, bz, bhw, bhd, brot, out) {
  const ac = Math.cos(arot), as = Math.sin(arot), bc = Math.cos(brot), bs = Math.sin(brot);
  _axes[0] = ac; _axes[1] = -as; _axes[2] = as; _axes[3] = ac;
  _axes[4] = bc; _axes[5] = -bs; _axes[6] = bs; _axes[7] = bc;
  const tx = ax - bx, tz = az - bz;
  let best = Infinity, bnx = 0, bnz = 0;
  for (let i = 0; i < 8; i += 2) {
    const nx = _axes[i], nz = _axes[i + 1];
    const ra = ahw * Math.abs(ac * nx - as * nz) + ahd * Math.abs(as * nx + ac * nz);
    const rb = bhw * Math.abs(bc * nx - bs * nz) + bhd * Math.abs(bs * nx + bc * nz);
    const d = tx * nx + tz * nz;
    const overlap = ra + rb - Math.abs(d);
    if (overlap <= 0) return null;
    if (overlap < best) { best = overlap; const sg = d < 0 ? -1 : 1; bnx = nx * sg; bnz = nz * sg; }
  }
  if (out) { out.nx = bnx; out.nz = bnz; out.depth = best; }
  return out || true;
}

/** Circle vs oriented box: returns push-out normal/depth for the circle, or null. */
export function circleObb(px, pz, r, x, z, hw, hd, rot, out) {
  const c = Math.cos(rot), s = Math.sin(rot);
  const dx = px - x, dz = pz - z;
  const lx = dx * c - dz * s, lz = dx * s + dz * c;
  const cx = clamp(lx, -hw, hw), cz = clamp(lz, -hd, hd);
  let ex = lx - cx, ez = lz - cz;
  let d2 = ex * ex + ez * ez;
  if (d2 >= r * r) return null;
  let depth, nlx, nlz;
  if (d2 > 1e-10) {
    const d = Math.sqrt(d2);
    nlx = ex / d; nlz = ez / d; depth = r - d;
  } else {
    // Centre inside the box: push out along the shallowest face.
    const px2 = hw - Math.abs(lx), pz2 = hd - Math.abs(lz);
    if (px2 < pz2) { nlx = lx < 0 ? -1 : 1; nlz = 0; depth = px2 + r; }
    else { nlx = 0; nlz = lz < 0 ? -1 : 1; depth = pz2 + r; }
  }
  // Back to world: local x axis = (c, -s), local z axis = (s, c).
  out.nx = nlx * c + nlz * s;
  out.nz = -nlx * s + nlz * c;
  out.depth = depth;
  return out;
}

/** Segment (ax,az)->(bx,bz) vs oriented box: entry fraction t in [0,1] or -1. */
export function segmentObb(ax, az, bx, bz, x, z, hw, hd, rot) {
  const c = Math.cos(rot), s = Math.sin(rot);
  const ox = ax - x, oz = az - z;
  const lax = ox * c - oz * s, laz = ox * s + oz * c;
  const ex = bx - ax, ez = bz - az;
  const ldx = ex * c - ez * s, ldz = ex * s + ez * c;
  let t0 = 0, t1 = 1;
  const slab = (p, d, h) => {
    if (Math.abs(d) < 1e-9) return Math.abs(p) <= h;
    let ta = (-h - p) / d, tb = (h - p) / d;
    if (ta > tb) { const tmp = ta; ta = tb; tb = tmp; }
    if (ta > t0) t0 = ta;
    if (tb < t1) t1 = tb;
    return t0 <= t1;
  };
  if (!slab(lax, ldx, hw) || !slab(laz, ldz, hd)) return -1;
  return t0;
}

/** Uniform hash grid over the ground plane storing integer ids. */
export class SpatialGrid {
  constructor(cell = 16) {
    this.cell = cell;
    this.map = new Map();
  }
  key(cx, cz) { return (cx + 32768) * 65536 + (cz + 32768); }
  insertPoint(id, x, z) {
    const k = this.key(Math.floor(x / this.cell), Math.floor(z / this.cell));
    let list = this.map.get(k);
    if (!list) this.map.set(k, (list = []));
    list.push(id);
  }
  insertRect(id, minX, minZ, maxX, maxZ) {
    const c = this.cell;
    const x0 = Math.floor(minX / c), x1 = Math.floor(maxX / c), z0 = Math.floor(minZ / c), z1 = Math.floor(maxZ / c);
    for (let cx = x0; cx <= x1; cx++) {
      for (let cz = z0; cz <= z1; cz++) {
        const k = this.key(cx, cz);
        let list = this.map.get(k);
        if (!list) this.map.set(k, (list = []));
        list.push(id);
      }
    }
  }
  /** Calls fn(id) for ids in cells touching the rect; ids may repeat across cells. */
  query(minX, minZ, maxX, maxZ, fn) {
    const c = this.cell;
    const x0 = Math.floor(minX / c), x1 = Math.floor(maxX / c), z0 = Math.floor(minZ / c), z1 = Math.floor(maxZ / c);
    for (let cx = x0; cx <= x1; cx++) {
      for (let cz = z0; cz <= z1; cz++) {
        const list = this.map.get(this.key(cx, cz));
        if (!list) continue;
        for (let i = 0; i < list.length; i++) if (fn(list[i]) === true) return true;
      }
    }
    return false;
  }
  clear() { this.map.clear(); }
}

/** Binary min-heap keyed by float priority, storing integers. */
export class MinHeap {
  constructor(capacity = 1024) {
    this.keys = new Float64Array(capacity);
    this.vals = new Int32Array(capacity);
    this.size = 0;
  }
  push(val, key) {
    if (this.size === this.keys.length) {
      const k = new Float64Array(this.size * 2); k.set(this.keys); this.keys = k;
      const v = new Int32Array(this.size * 2); v.set(this.vals); this.vals = v;
    }
    let i = this.size++;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.keys[p] <= key) break;
      this.keys[i] = this.keys[p]; this.vals[i] = this.vals[p]; i = p;
    }
    this.keys[i] = key; this.vals[i] = val;
  }
  pop() {
    const top = this.vals[0];
    const key = this.keys[--this.size], val = this.vals[this.size];
    let i = 0;
    for (;;) {
      let c = i * 2 + 1;
      if (c >= this.size) break;
      if (c + 1 < this.size && this.keys[c + 1] < this.keys[c]) c++;
      if (this.keys[c] >= key) break;
      this.keys[i] = this.keys[c]; this.vals[i] = this.vals[c]; i = c;
    }
    this.keys[i] = key; this.vals[i] = val;
    return top;
  }
}
