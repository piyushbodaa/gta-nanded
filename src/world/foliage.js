// Trees with leaves. Crowns are clusters of alpha-tested leaf cards painted on
// canvas at load: neem, banyan, gulmohar in flower, coconut fronds, babool,
// bougainvillea, banana. Card normals point out of the crown so it shades like
// a soft ball, leaves glow when the sun is behind them, and everything sways in
// the wind. All foliage in a chunk is one draw call.
import * as THREE from 'three';
import { rng } from '../core/math.js';

const T = 256, COLS = 4, ROWS = 2;
export const LEAF = { NEEM: 0, BROAD: 1, GULMOHAR: 2, PALM: 3, BABOOL: 4, BOUGAIN: 5, BANANA: 6, BUSH: 7 };

// ------------------------------------------------------------------ painting
function leafShape(ctx, x, y, len, wid, ang, color, rib = 0.16) {
  ctx.save();
  ctx.translate(x, y); ctx.rotate(ang);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.quadraticCurveTo(len * 0.42, -wid, len, 0);
  ctx.quadraticCurveTo(len * 0.42, wid, 0, 0);
  ctx.fill();
  if (rib > 0 && len > 9) {
    ctx.strokeStyle = `rgba(235,245,190,${rib})`; ctx.lineWidth = Math.max(0.5, wid * 0.12);
    ctx.beginPath(); ctx.moveTo(len * 0.04, 0); ctx.lineTo(len * 0.9, 0); ctx.stroke();
  }
  ctx.restore();
}

/** A point in the tile, denser toward the middle so cards never show a square edge. */
function spot(r, rad = 104) {
  const a = r() * Math.PI * 2, d = Math.sqrt(r()) * rad;
  return [128 + Math.cos(a) * d, 128 + Math.sin(a) * d * 0.92];
}

function shade(hex, k) {
  const n = parseInt(hex.slice(1), 16);
  const c = v => Math.max(0, Math.min(255, Math.round(v * k)));
  return `rgb(${c((n >> 16) & 255)},${c((n >> 8) & 255)},${c(n & 255)})`;
}

/** Compound leaf: a stem with paired leaflets (neem, gulmohar, babool). */
function pinnate(ctx, r, x, y, ang, len, pairs, leafLen, leafWid, colors, stem) {
  ctx.strokeStyle = stem; ctx.lineWidth = 1.2;
  ctx.beginPath(); ctx.moveTo(x, y);
  const ex = x + Math.cos(ang) * len, ey = y + Math.sin(ang) * len;
  ctx.lineTo(ex, ey); ctx.stroke();
  const base = r.pick(colors);
  for (let i = 0; i < pairs; i++) {
    const t = 0.12 + (i / pairs) * 0.88;
    const px = x + (ex - x) * t, py = y + (ey - y) * t;
    const l = leafLen * (1 - t * 0.35) * r.range(0.85, 1.1);
    for (const side of [1, -1]) {
      const a = ang + side * r.range(0.8, 1.15);
      leafShape(ctx, px, py, l, leafWid * r.range(0.85, 1.1), a, shade(base, r.range(0.82, 1.18)), 0.12);
    }
  }
  leafShape(ctx, ex, ey, leafLen * 0.8, leafWid, ang, shade(base, r.range(0.9, 1.1)), 0.1);
}

const PAINT = [
  // NEEM: drooping compound leaves with sickle-shaped leaflets.
  (ctx, r) => {
    const greens = ['#3f6b2a', '#4c7a31', '#5a8a38', '#355f24', '#6a9a40'];
    for (let k = 0; k < 52; k++) {
      const [x, y] = spot(r, 100);
      pinnate(ctx, r, x, y, r() * Math.PI * 2, r.range(42, 64), r.int(7, 10), r.range(14, 19), r.range(2.8, 3.8), greens, '#5a5a30');
    }
  },
  // BROAD: banyan, peepal and mango: big glossy oval leaves.
  (ctx, r) => {
    const greens = ['#2f5320', '#3b6428', '#456f2e', '#527d36', '#2a4a1c'];
    for (let k = 0; k < 95; k++) {
      const [x, y] = spot(r, 100);
      const c = r.pick(greens);
      leafShape(ctx, x, y, r.range(26, 40), r.range(10, 15), r() * Math.PI * 2, shade(c, 0.75 + (k / 95) * 0.45), 0.22);
    }
  },
  // GULMOHAR: feathery fern-like leaves and clusters of flame-red flowers.
  (ctx, r) => {
    const greens = ['#5d8a33', '#6a9a3c', '#77a845', '#4f7a2c'];
    for (let k = 0; k < 50; k++) {
      const [x, y] = spot(r, 100);
      pinnate(ctx, r, x, y, r() * Math.PI * 2, r.range(40, 60), r.int(10, 14), r.range(8, 11), r.range(2, 2.7), greens, '#56622c');
    }
    const reds = ['#e2401c', '#f05a22', '#d8361a', '#ff6a26', '#c92e16'];
    for (let k = 0; k < 16; k++) {
      const [x, y] = spot(r, 90);
      for (let p = 0; p < 7; p++) {
        const a = r() * Math.PI * 2, d = r.range(0, 10);
        ctx.fillStyle = r.pick(reds);
        ctx.beginPath(); ctx.ellipse(x + Math.cos(a) * d, y + Math.sin(a) * d, r.range(4, 6.5), r.range(3, 5), a, 0, Math.PI * 2); ctx.fill();
      }
      ctx.fillStyle = '#f7c948'; ctx.beginPath(); ctx.arc(x, y, 1.8, 0, Math.PI * 2); ctx.fill();
    }
  },
  // PALM: one coconut frond, rib up the middle of the tile, leaflets to the tip.
  (ctx, r) => {
    ctx.strokeStyle = '#8a8a4a'; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(128, 254); ctx.quadraticCurveTo(122, 128, 128, 4); ctx.stroke();
    const greens = ['#4d7a2c', '#5b8a33', '#3f6a25', '#6c9a3a'];
    for (let y = 246; y > 10; y -= 5) {
      const t = 1 - y / 256;
      const len = (1 - Math.abs(t - 0.4) * 1.2) * r.range(78, 98);
      if (len < 12) continue;
      for (const side of [1, -1]) {
        const a = -Math.PI / 2 + side * r.range(0.6, 0.85);
        const tipDry = r() < 0.12;
        leafShape(ctx, 127 + side * 2, y, len, r.range(4, 5.5), a, tipDry ? '#a49a4a' : shade(r.pick(greens), r.range(0.85, 1.15)), 0.15);
      }
    }
  },
  // BABOOL: sparse tiny leaflets, thin dark twigs, yellow puff-ball flowers.
  (ctx, r) => {
    ctx.strokeStyle = '#4a3b2a'; ctx.lineWidth = 1.5;
    for (let k = 0; k < 10; k++) {
      const [x, y] = spot(r, 90);
      const a = r() * Math.PI * 2;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(a) * 40, y + Math.sin(a) * 40); ctx.stroke();
    }
    const greens = ['#7a8a3c', '#6a7a34', '#8a9a48', '#5f6f2e'];
    for (let k = 0; k < 40; k++) {
      const [x, y] = spot(r, 100);
      pinnate(ctx, r, x, y, r() * Math.PI * 2, r.range(18, 28), r.int(5, 8), r.range(5, 7), r.range(1.4, 2), greens, '#5d5a34');
    }
    for (let k = 0; k < 14; k++) { const [x, y] = spot(r, 92); ctx.fillStyle = '#f2c62a'; ctx.beginPath(); ctx.arc(x, y, r.range(2.5, 3.8), 0, Math.PI * 2); ctx.fill(); }
  },
  // BOUGAIN: bougainvillea over every compound wall: small leaves, magenta bracts.
  (ctx, r) => {
    const greens = ['#3f6b2a', '#4a7a30', '#355f24'];
    for (let k = 0; k < 110; k++) { const [x, y] = spot(r, 104); leafShape(ctx, x, y, r.range(10, 15), r.range(5, 7), r() * Math.PI * 2, r.pick(greens), 0.1); }
    const pinks = ['#d81b7a', '#e3358f', '#c2186b', '#f06292', '#b0125e'];
    for (let k = 0; k < 75; k++) {
      const [x, y] = spot(r, 100);
      const c = r.pick(pinks);
      for (let p = 0; p < 3; p++) leafShape(ctx, x, y, r.range(7, 10), r.range(4, 6), (p / 3) * Math.PI * 2 + r(), c, 0);
    }
  },
  // BANANA: one huge leaf with a pale midrib and wind tears.
  (ctx, r) => {
    ctx.fillStyle = '#5f9233';
    ctx.beginPath(); ctx.moveTo(128, 252);
    ctx.bezierCurveTo(40, 190, 50, 60, 128, 4); ctx.bezierCurveTo(206, 60, 216, 190, 128, 252); ctx.fill();
    ctx.strokeStyle = 'rgba(40,70,20,0.35)'; ctx.lineWidth = 1;
    for (let y = 20; y < 246; y += 7) { ctx.beginPath(); ctx.moveTo(128, y); ctx.lineTo(60, y - 16); ctx.moveTo(128, y); ctx.lineTo(196, y - 16); ctx.stroke(); }
    ctx.globalCompositeOperation = 'destination-out';
    for (let k = 0; k < 7; k++) { const y = r.range(40, 220), side = r.chance(0.5) ? 1 : -1; ctx.fillRect(side > 0 ? 134 : 40, y, 82, 2.5); }
    ctx.globalCompositeOperation = 'source-over';
    ctx.strokeStyle = '#c9d68a'; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(128, 252); ctx.lineTo(128, 8); ctx.stroke();
    ctx.fillStyle = 'rgba(150,120,50,0.6)'; ctx.beginPath(); ctx.ellipse(70, 150, 10, 30, 0.3, 0, Math.PI * 2); ctx.fill();
  },
  // BUSH: dense rounded leaves for hedges and yard shrubs.
  (ctx, r) => {
    const greens = ['#3a6626', '#467530', '#528338', '#2f5520', '#5e9040'];
    for (let k = 0; k < 150; k++) { const [x, y] = spot(r, 104); leafShape(ctx, x, y, r.range(12, 18), r.range(6, 9), r() * Math.PI * 2, shade(r.pick(greens), 0.75 + (k / 150) * 0.45), 0.12); }
  },
];

/**
 * Paint the foliage atlas into an RGBA DataTexture. Transparent texels take the
 * average leaf colour (no dark fringes), and each mip level boosts its alpha so
 * distant crowns keep the coverage of near ones instead of thinning to twigs.
 */
export function createFoliageTexture(scale = 1) {
  const W = COLS * T * scale, H = ROWS * T * scale;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.scale(scale, scale);
  PAINT.forEach((paint, i) => {
    ctx.save();
    ctx.translate((i % COLS) * T, Math.floor(i / COLS) * T);
    ctx.beginPath(); ctx.rect(0, 0, T, T); ctx.clip();
    paint(ctx, rng(9001 + i * 7));
    ctx.restore();
  });
  const base = ctx.getImageData(0, 0, W, H).data;
  // Fill transparent texels with each tile's mean leaf colour.
  const tw = T * scale;
  for (let ty = 0; ty < ROWS; ty++) {
    for (let tx = 0; tx < COLS; tx++) {
      let r = 0, g = 0, b = 0, n = 0;
      for (let y = ty * tw; y < (ty + 1) * tw; y++) for (let x = tx * tw; x < (tx + 1) * tw; x++) {
        const k = (y * W + x) * 4;
        if (base[k + 3] > 128) { r += base[k]; g += base[k + 1]; b += base[k + 2]; n++; }
      }
      if (!n) continue;
      r /= n; g /= n; b /= n;
      for (let y = ty * tw; y < (ty + 1) * tw; y++) for (let x = tx * tw; x < (tx + 1) * tw; x++) {
        const k = (y * W + x) * 4, a = base[k + 3] / 255;
        // Canvas colours are premultiplied on read-back edges: blend toward the mean.
        base[k] = base[k] * a + r * (1 - a); base[k + 1] = base[k + 1] * a + g * (1 - a); base[k + 2] = base[k + 2] * a + b * (1 - a);
      }
    }
  }
  const levels = [{ data: new Uint8Array(base.buffer.slice(0)), width: W, height: H }];
  const coverage = d => { let c = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 127) c++; return c / (d.length / 4); };
  const target = coverage(levels[0].data);
  let w = W, h = H, src = levels[0].data;
  while (w > 1 || h > 1) {
    const nw = Math.max(1, w >> 1), nh = Math.max(1, h >> 1);
    const dst = new Uint8Array(nw * nh * 4);
    for (let y = 0; y < nh; y++) for (let x = 0; x < nw; x++) {
      for (let c = 0; c < 4; c++) {
        const x0 = Math.min(w - 1, x * 2), x1 = Math.min(w - 1, x * 2 + 1), y0 = Math.min(h - 1, y * 2), y1 = Math.min(h - 1, y * 2 + 1);
        dst[(y * nw + x) * 4 + c] = (src[(y0 * w + x0) * 4 + c] + src[(y0 * w + x1) * 4 + c] + src[(y1 * w + x0) * 4 + c] + src[(y1 * w + x1) * 4 + c]) >> 2;
      }
    }
    // Scale alpha until this level covers as much as the full-size one.
    let lo = 1, hi = 4;
    const test = k => { let c = 0; for (let i = 3; i < dst.length; i += 4) if (Math.min(255, dst[i] * k) > 127) c++; return c / (dst.length / 4); };
    if (nw >= 4) for (let i = 0; i < 10; i++) { const mid = (lo + hi) / 2; if (test(mid) < target) lo = mid; else hi = mid; }
    const out = new Uint8Array(dst);
    for (let i = 3; i < out.length; i += 4) out[i] = Math.min(255, Math.round(dst[i] * hi));
    levels.push({ data: out, width: nw, height: nh });
    src = dst; w = nw; h = nh;
  }
  const tex = new THREE.DataTexture(levels[0].data, W, H, THREE.RGBAFormat);
  tex.mipmaps = levels;
  tex.generateMipmaps = false;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.flipY = false;
  tex.needsUpdate = true;
  return tex;
}

// ------------------------------------------------------------------ material
export function createFoliageMaterial(map, { uTime, uSunDir, uSunColor }) {
  const mat = new THREE.MeshStandardMaterial({
    map, vertexColors: true, alphaTest: 0.5, alphaToCoverage: true, side: THREE.DoubleSide, roughness: 0.72, metalness: 0,
  });
  mat.onBeforeCompile = shader => {
    shader.uniforms.uTime = uTime;
    shader.uniforms.uSunDirW = uSunDir;
    shader.uniforms.uSunTint = uSunColor;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        attribute float wind;
        uniform float uTime;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        // Leaves sway in the breeze, each tree a little out of step with the next.
        float ph = uTime * 1.7 + position.x * 0.37 + position.z * 0.29;
        transformed.x += (sin(ph) * 0.05 + sin(ph * 2.7 + position.y) * 0.02) * wind;
        transformed.z += (cos(ph * 0.83) * 0.045) * wind;
        transformed.y += sin(ph * 1.9) * 0.02 * wind;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform vec3 uSunDirW, uSunTint;`)
      // Crown normals point outward on both faces of a card.
      .replace('#include <normal_fragment_begin>', `
        float faceDirection = gl_FrontFacing ? 1.0 : - 1.0;
        vec3 normal = normalize(vNormal);
        vec3 nonPerturbedNormal = normal;`)
      // Light through the leaves when the sun is behind them.
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        {
          vec3 L = normalize((viewMatrix * vec4(uSunDirW, 0.0)).xyz);
          float back = pow(saturate(dot(-normalize(vViewPosition), L)), 5.0) * smoothstep(-0.05, 0.15, uSunDirW.y);
          totalEmissiveRadiance += diffuseColor.rgb * uSunTint * back * 0.9;
        }`);
  };
  mat.customProgramCacheKey = () => 'foliage-v1';
  return mat;
}

// ------------------------------------------------------------------ geometry
export class FoliageGeo {
  constructor(cap = 4096) {
    this.cap = cap; this.n = 0; this.ni = 0;
    this.pos = new Float32Array(cap * 3); this.nrm = new Float32Array(cap * 3); this.uv = new Float32Array(cap * 2);
    this.col = new Uint8Array(cap * 3); this.wind = new Uint8Array(cap); this.idx = new Uint32Array(cap * 1.5);
  }
  _grow() {
    const g = (a, k) => { const b = new a.constructor(this.cap * 2 * k); b.set(a); return b; };
    this.pos = g(this.pos, 3); this.nrm = g(this.nrm, 3); this.uv = g(this.uv, 2); this.col = g(this.col, 3); this.wind = g(this.wind, 1);
    this.cap *= 2;
  }
  _v(x, y, z, nx, ny, nz, u, v, r, g, b, w) {
    if (this.n + 1 > this.cap) this._grow();
    const i = this.n++;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    const l = Math.hypot(nx, ny, nz) || 1;
    this.nrm[i * 3] = nx / l; this.nrm[i * 3 + 1] = ny / l; this.nrm[i * 3 + 2] = nz / l;
    this.uv[i * 2] = u; this.uv[i * 2 + 1] = v;
    this.col[i * 3] = r; this.col[i * 3 + 1] = g; this.col[i * 3 + 2] = b;
    this.wind[i] = w;
    return i;
  }
  _quad(a, b, c, d) {
    if (this.ni + 6 > this.idx.length) { const ib = new Uint32Array(this.idx.length * 2); ib.set(this.idx); this.idx = ib; }
    this.idx.set([a, b, c, a, c, d], this.ni); this.ni += 6;
  }
  get empty() { return this.ni === 0; }

  /**
   * A crown of `count` leaf cards in an ellipsoid (centre o, radii r). `up` tilts
   * cards toward horizontal (umbrella crowns); `tint` is an 0xRRGGBB leaf tint.
   */
  crown(ox, oy, oz, rx, ry, rz, count, size, tile, tint, seed, up = 0.3) {
    const R = rng(seed);
    const u0 = (tile % COLS) / COLS, v0 = Math.floor(tile / COLS) / ROWS, du = 1 / COLS, dv = 1 / ROWS;
    const tr = (tint >> 16) & 255, tg = (tint >> 8) & 255, tb = tint & 255;
    for (let k = 0; k < count; k++) {
      // Card centre: mostly near the surface of the crown.
      let dx, dy, dz, d2;
      do { dx = R() * 2 - 1; dy = R() * 2 - 1; dz = R() * 2 - 1; d2 = dx * dx + dy * dy + dz * dz; } while (d2 > 1 || d2 < 0.05);
      const push = Math.pow(R(), 0.35) / Math.sqrt(d2);
      const cx = ox + dx * push * rx * 0.82, cy = oy + dy * push * ry * 0.82, cz = oz + dz * push * rz * 0.82;
      // Card plane: facing mostly outward, tilted up for umbrella crowns.
      let nx = dx + (R() - 0.5) * 1.4, ny = dy + up + (R() - 0.5) * 1.4, nz = dz + (R() - 0.5) * 1.4;
      const nl = Math.hypot(nx, ny, nz) || 1; nx /= nl; ny /= nl; nz /= nl;
      // Two tangents.
      let ax = -nz, ay = 0, az = nx;
      if (Math.abs(ny) > 0.95) { ax = 1; ay = 0; az = 0; }
      let al = Math.hypot(ax, ay, az); ax /= al; ay /= al; az /= al;
      let bx = ny * az - nz * ay, by = nz * ax - nx * az, bz = nx * ay - ny * ax;
      const rot = R() * Math.PI * 2, cr = Math.cos(rot), sr = Math.sin(rot);
      const a2x = ax * cr + bx * sr, a2y = ay * cr + by * sr, a2z = az * cr + bz * sr;
      const b2x = bx * cr - ax * sr, b2y = by * cr - ay * sr, b2z = bz * cr - az * sr;
      const s = size * R.range(0.75, 1.2) * 0.5;
      const corners = [[-1, -1, 0, 1], [1, -1, 1, 1], [1, 1, 1, 0], [-1, 1, 0, 0]];
      const ids = corners.map(([p, q, u, v]) => {
        const x = cx + (a2x * p + b2x * q) * s, y = cy + (a2y * p + b2y * q) * s, z = cz + (a2z * p + b2z * q) * s;
        // Ellipsoid normal, lifted a little so crowns are brighter on top.
        const ex = (x - ox) / (rx * rx), ey = (y - oy) / (ry * ry) + 0.35 / ry, ez = (z - oz) / (rz * rz);
        // Self-shadowing: darker low in the crown and deep inside it.
        const h = Math.min(1, Math.max(0, (y - (oy - ry)) / (2 * ry)));
        const depth = Math.min(1, Math.hypot((x - ox) / rx, (y - oy) / ry, (z - oz) / rz));
        const ao = (0.5 + 0.5 * h) * (0.7 + 0.3 * depth);
        return this._v(x, y, z, ex, ey, ez, u0 + u * du, v0 + v * dv, tr * ao, tg * ao, tb * ao, 255);
      });
      this._quad(ids[0], ids[1], ids[2], ids[3]);
    }
  }

  /** A drooping strip (coconut frond, banana leaf) from (x, y, z) along heading a. */
  frond(x, y, z, a, len, wid, droop, tile, tint, segs = 4, lift = 0.35) {
    const u0 = (tile % COLS) / COLS, v0 = Math.floor(tile / COLS) / ROWS, du = 1 / COLS, dv = 1 / ROWS;
    const tr = (tint >> 16) & 255, tg = (tint >> 8) & 255, tb = tint & 255;
    const fx = Math.cos(a), fz = Math.sin(a), sx = -fz, sz = fx;
    let prev = null;
    for (let i = 0; i <= segs; i++) {
      const t = i / segs;
      const px = x + fx * len * t, pz = z + fz * len * t;
      const py = y + len * (lift * t - droop * t * t);
      const w = wid * (0.5 + Math.sin(Math.min(1, t * 1.15) * Math.PI) * 0.5) * 0.5;
      const ny = 1, ao = 0.7 + 0.3 * t;
      const l = this._v(px + sx * w, py, pz + sz * w, sx * 0.2, ny, sz * 0.2, u0, v0 + (1 - t) * dv, tr * ao, tg * ao, tb * ao, Math.round(255 * t));
      const r = this._v(px - sx * w, py, pz - sz * w, -sx * 0.2, ny, -sz * 0.2, u0 + du, v0 + (1 - t) * dv, tr * ao, tg * ao, tb * ao, Math.round(255 * t));
      if (prev) this._quad(prev[0], prev[1], r, l);
      prev = [l, r];
    }
  }

  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos.slice(0, this.n * 3), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(this.nrm.slice(0, this.n * 3), 3));
    g.setAttribute('uv', new THREE.BufferAttribute(this.uv.slice(0, this.n * 2), 2));
    g.setAttribute('color', new THREE.BufferAttribute(this.col.slice(0, this.n * 3), 3, true));
    g.setAttribute('wind', new THREE.BufferAttribute(this.wind.slice(0, this.n), 1, true));
    g.setIndex(new THREE.BufferAttribute(this.n > 65535 ? this.idx.slice(0, this.ni) : Uint16Array.from(this.idx.subarray(0, this.ni)), 1));
    g.computeBoundingSphere();
    return g;
  }
}
