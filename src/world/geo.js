// Growable typed-array mesh builder for the city material's vertex format.
// Flat shading derives normals per pixel, so meshes carry no normal attribute
// and vertex-coloured shapes can share vertices across faces.
import * as THREE from 'three';

export class Geo {
  constructor(cap = 8192) {
    this.pos = new Float32Array(cap * 3);
    this.uv = new Float32Array(cap * 2);
    this.tint = new Uint8Array(cap * 4);
    this.tile = new Uint8Array(cap * 4);
    this.idx = new Uint32Array(cap * 2);
    this.n = 0; // vertices
    this.ni = 0; // indices
    this.cap = cap;
    this.icap = cap * 2;
    this.t = [255, 255, 255, 0];
    this.k = [0, 0, 1, 0];
  }
  setTint(rgb, seed = 0) {
    this.t[0] = (rgb >> 16) & 255; this.t[1] = (rgb >> 8) & 255; this.t[2] = rgb & 255; this.t[3] = seed & 255;
    return this;
  }
  /** mode 0 = plain colour (tile ignored). */
  setTile(col, row, variants = 1, mode = 1) {
    this.k[0] = col; this.k[1] = row; this.k[2] = variants; this.k[3] = mode;
    return this;
  }
  color(rgb, seed = 0) { this.setTint(rgb, seed); this.k[0] = 0; this.k[1] = 0; this.k[2] = 1; this.k[3] = 0; return this; }
  /** Plain colour as polished metal (gilded domes, brass finials). */
  gilt(rgb) { this.setTint(rgb, 0); this.k[0] = 1; this.k[1] = 0; this.k[2] = 1; this.k[3] = 0; return this; }
  _grow() {
    const cap = this.cap * 2;
    const g = (a, n) => { const b = new a.constructor(cap * n); b.set(a); return b; };
    this.pos = g(this.pos, 3); this.uv = g(this.uv, 2); this.tint = g(this.tint, 4); this.tile = g(this.tile, 4);
    this.cap = cap;
  }
  v(x, y, z, u = 0, w = 0) {
    if (this.n === this.cap) this._grow();
    const i = this.n++;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.uv[i * 2] = u; this.uv[i * 2 + 1] = w;
    const t = this.t, k = this.k;
    this.tint[i * 4] = t[0]; this.tint[i * 4 + 1] = t[1]; this.tint[i * 4 + 2] = t[2]; this.tint[i * 4 + 3] = t[3];
    this.tile[i * 4] = k[0]; this.tile[i * 4 + 1] = k[1]; this.tile[i * 4 + 2] = k[2]; this.tile[i * 4 + 3] = k[3];
    return i;
  }
  tri(a, b, c) {
    if (this.ni + 3 > this.icap) { const b2 = new Uint32Array(this.icap * 2); b2.set(this.idx); this.idx = b2; this.icap *= 2; }
    this.idx[this.ni++] = a; this.idx[this.ni++] = b; this.idx[this.ni++] = c;
  }
  quad(a, b, c, d) { this.tri(a, b, c); this.tri(a, c, d); }

  /** Vertical wall from A to B (ground plane), facing the right of A->B. */
  wall(ax, az, bx, bz, y0, y1, u0, u1, v0, v1) {
    const a = this.v(ax, y0, az, u0, v0), b = this.v(bx, y0, bz, u1, v0);
    const c = this.v(bx, y1, bz, u1, v1), d = this.v(ax, y1, az, u0, v1);
    this.quad(a, b, c, d);
  }
  /** Horizontal quad facing up. Corners in box order p0(-,-) p1(+,-) p2(+,+) p3(-,+). */
  flat(x0, z0, x1, z1, x2, z2, x3, z3, y, uvScale = 0, ox = 0, oz = 0) {
    const s = uvScale;
    const a = this.v(x0, y, z0, s ? (x0 - ox) / s : 0, s ? (z0 - oz) / s : 0);
    const b = this.v(x3, y, z3, s ? (x3 - ox) / s : 0, s ? (z3 - oz) / s : 1);
    const c = this.v(x2, y, z2, s ? (x2 - ox) / s : 1, s ? (z2 - oz) / s : 1);
    const d = this.v(x1, y, z1, s ? (x1 - ox) / s : 1, s ? (z1 - oz) / s : 0);
    this.quad(a, b, c, d);
  }
  /**
   * Oriented box (local x = width, local z = depth, y up), vertex-coloured or with
   * world-scaled UVs (uvScale units per tile). The bottom face only on request
   * (slabs and canopies seen from below).
   */
  box(cx, y0, cz, hw, h, hd, rot, uvScale = 0, top = true, bottom = false) {
    const c = Math.cos(rot), s = Math.sin(rot);
    const X = (lx, lz) => cx + lx * c + lz * s, Z = (lx, lz) => cz - lx * s + lz * c;
    const p = [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]];
    const y1 = y0 + h;
    const order = [[1, 0], [0, 3], [3, 2], [2, 1]];
    for (const [i, j] of order) {
      const len = i === 1 || i === 3 ? hw * 2 : hd * 2;
      const u1 = uvScale ? len / uvScale : 1, v1 = uvScale ? h / uvScale : 1;
      this.wall(X(p[i][0], p[i][1]), Z(p[i][0], p[i][1]), X(p[j][0], p[j][1]), Z(p[j][0], p[j][1]), y0, y1, 0, u1, 0, v1);
    }
    if (top) this.flat(X(-hw, -hd), Z(-hw, -hd), X(hw, -hd), Z(hw, -hd), X(hw, hd), Z(hw, hd), X(-hw, hd), Z(-hw, hd), y1, uvScale, cx, cz);
    if (bottom) {
      const s2 = uvScale || 1;
      const a = this.v(X(-hw, -hd), y0, Z(-hw, -hd), 0, 0), b = this.v(X(hw, -hd), y0, Z(hw, -hd), (2 * hw) / s2, 0);
      const c2 = this.v(X(hw, hd), y0, Z(hw, hd), (2 * hw) / s2, (2 * hd) / s2), d = this.v(X(-hw, hd), y0, Z(-hw, hd), 0, (2 * hd) / s2);
      this.quad(a, b, c2, d);
    }
  }
  /** Shared-vertex box for plain coloured props (8 verts). */
  cbox(cx, y0, cz, hw, h, hd, rot = 0) {
    const c = Math.cos(rot), s = Math.sin(rot);
    const base = this.n;
    for (const y of [y0, y0 + h]) {
      for (const [lx, lz] of [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]]) this.v(cx + lx * c + lz * s, y, cz - lx * s + lz * c);
    }
    const q = (a, b, c2, d) => this.quad(base + a, base + b, base + c2, base + d);
    q(1, 0, 4, 5); q(0, 3, 7, 4); q(3, 2, 6, 7); q(2, 1, 5, 6); q(4, 7, 6, 5);
  }
  /** Prism along an arbitrary 3D segment with a square cross-section (beams, arms, wires). */
  beam(x0, y0, z0, x1, y1, z1, r) {
    const dx = x1 - x0, dy = y1 - y0, dz = z1 - z0;
    const len = Math.hypot(dx, dy, dz) || 1;
    // Two perpendicular axes.
    let ax = -dz, ay = 0, az = dx;
    let al = Math.hypot(ax, ay, az);
    if (al < 1e-6) { ax = 1; ay = 0; az = 0; al = 1; }
    ax /= al; ay /= al; az /= al;
    const bx = (dy * az - dz * ay) / len, by = (dz * ax - dx * az) / len, bz = (dx * ay - dy * ax) / len;
    const base = this.n;
    for (const [px, py, pz] of [[x0, y0, z0], [x1, y1, z1]]) {
      for (const [u, w] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) this.v(px + (ax * u + bx * w) * r, py + (ay * u + by * w) * r, pz + (az * u + bz * w) * r);
    }
    for (let i = 0; i < 4; i++) { const j = (i + 1) % 4; this.quad(base + i, base + j, base + 4 + j, base + 4 + i); }
  }
  cyl(cx, y0, cz, r0, h, sides = 6, r1 = r0, top = true) {
    const base = this.n;
    for (let i = 0; i < sides; i++) {
      const a = (i / sides) * Math.PI * 2;
      this.v(cx + Math.cos(a) * r0, y0, cz + Math.sin(a) * r0);
      this.v(cx + Math.cos(a) * r1, y0 + h, cz + Math.sin(a) * r1);
    }
    for (let i = 0; i < sides; i++) {
      const j = (i + 1) % sides;
      this.quad(base + i * 2, base + i * 2 + 1, base + j * 2 + 1, base + j * 2);
    }
    if (top && r1 > 0) for (let i = 1; i < sides - 1; i++) this.tri(base + 1, base + (i + 1) * 2 + 1, base + i * 2 + 1);
  }
  cone(cx, y0, cz, r, h, sides = 6) {
    const base = this.n;
    for (let i = 0; i < sides; i++) { const a = (i / sides) * Math.PI * 2; this.v(cx + Math.cos(a) * r, y0, cz + Math.sin(a) * r); }
    const tip = this.v(cx, y0 + h, cz);
    for (let i = 0; i < sides; i++) this.tri(base + i, tip, base + ((i + 1) % sides));
  }
  /** Low-poly blob (jittered icosahedron) for tree canopies, bushes and domes of hay. */
  blob(cx, cy, cz, rx, ry, rz, seed = 0) {
    const base = this.n;
    for (let i = 0; i < ICO_V.length; i += 3) {
      const j = 1 + 0.18 * (((Math.imul(seed + i * 7919, 2654435761) >>> 0) / 4294967296) - 0.5) * 2;
      this.v(cx + ICO_V[i] * rx * j, cy + ICO_V[i + 1] * ry * j, cz + ICO_V[i + 2] * rz * j);
    }
    for (let i = 0; i < ICO_F.length; i += 3) this.tri(base + ICO_F[i], base + ICO_F[i + 1], base + ICO_F[i + 2]);
  }
  /**
   * Surface of revolution around the y axis: profile = [[r, y], ...] bottom to top.
   * `smooth` stores true normals (octahedral, in the uv slot plain colours leave
   * free) so domes shade round instead of faceted.
   */
  lathe(cx, y0, cz, profile, sides = 12, smooth = false) {
    const base = this.n;
    if (smooth) this.k[1] = 1;
    profile.forEach(([r, y], k) => {
      const [r0, yA] = profile[Math.max(0, k - 1)], [r1, yB] = profile[Math.min(profile.length - 1, k + 1)];
      let nr = yB - yA, ny = -(r1 - r0);
      const nl = Math.hypot(nr, ny) || 1; nr /= nl; ny /= nl;
      for (let i = 0; i < sides; i++) {
        const a = (i / sides) * Math.PI * 2;
        const [u, w] = smooth ? octEncode(Math.cos(a) * nr, ny, Math.sin(a) * nr) : [0, 0];
        this.v(cx + Math.cos(a) * r, y0 + y, cz + Math.sin(a) * r, u, w);
      }
    });
    if (smooth) this.k[1] = 0;
    for (let k = 0; k < profile.length - 1; k++) {
      for (let i = 0; i < sides; i++) {
        const j = (i + 1) % sides;
        const a = base + k * sides + i, b = base + k * sides + j, c = base + (k + 1) * sides + j, d = base + (k + 1) * sides + i;
        this.quad(a, d, c, b);
      }
    }
  }
  get empty() { return this.ni === 0; }
  /** Start over, keeping the grown buffers (builders are reused chunk after chunk). */
  reset() { this.n = 0; this.ni = 0; return this; }

  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos.slice(0, this.n * 3), 3));
    g.setAttribute('uv', new THREE.BufferAttribute(this.uv.slice(0, this.n * 2), 2));
    g.setAttribute('tint', new THREE.BufferAttribute(this.tint.slice(0, this.n * 4), 4, true));
    g.setAttribute('tile', new THREE.BufferAttribute(this.tile.slice(0, this.n * 4), 4, false));
    g.setIndex(new THREE.BufferAttribute(this.n > 65535 ? this.idx.slice(0, this.ni) : Uint16Array.from(this.idx.subarray(0, this.ni)), 1));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

/** Octahedral encoding of a unit normal into two numbers (decoded in citymat.js). */
export function octEncode(x, y, z) {
  const l = Math.abs(x) + Math.abs(y) + Math.abs(z) || 1;
  let u = x / l, v = z / l;
  if (y < 0) { const ou = u; u = (1 - Math.abs(v)) * (ou >= 0 ? 1 : -1); v = (1 - Math.abs(ou)) * (v >= 0 ? 1 : -1); }
  return [u, v];
}

// Unit icosahedron.
const t = (1 + Math.sqrt(5)) / 2;
const raw = [-1, t, 0, 1, t, 0, -1, -t, 0, 1, -t, 0, 0, -1, t, 0, 1, t, 0, -1, -t, 0, 1, -t, t, 0, -1, t, 0, 1, -t, 0, -1, -t, 0, 1];
const nrm = Math.hypot(1, t);
export const ICO_V = raw.map(v => v / nrm);
// Faces wound counter-clockwise seen from outside.
export const ICO_F = [0, 11, 5, 0, 5, 1, 0, 1, 7, 0, 7, 10, 0, 10, 11, 1, 5, 9, 5, 11, 4, 11, 10, 2, 10, 7, 6, 7, 1, 8, 3, 9, 4, 3, 4, 2, 3, 2, 6, 3, 6, 8, 3, 8, 9, 4, 9, 5, 2, 4, 11, 6, 2, 10, 8, 6, 7, 9, 8, 1];
