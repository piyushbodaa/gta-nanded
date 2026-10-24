// Procedural vehicle models. Each type yields four geometries: `paint` (tinted
// per vehicle), `glass` (dark, mirror-smooth windows), `fixed` (vertex-coloured
// trim, tyres, canopy) and `lights` (lamps, brightened at night and when
// braking), plus wheel and seat data. Car bodies are lofted through rounded
// cross-sections and smooth-shaded, so paint and glass catch the sky.
import * as THREE from 'three';
import { toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const GLASS = 0x26343c, BLACK = 0x1a1a1a, GREY = 0x55595b, CHROME = 0xb8bec2, PLATE_W = 0xf4f4f0, PLATE_Y = 0xf2c230;
const HEAD = 0xfff3c4, TAIL = 0xd81b1b, AMBER = 0xff9a1f;

const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

class VB {
  constructor() { this.parts = { paint: { pos: [], col: [] }, glass: { pos: [], col: [] }, fixed: { pos: [], col: [] }, lights: { pos: [], col: [] } }; }
  _tri(part, a, b, c, color) {
    if (part === 'fixed' && color === GLASS) part = 'glass';
    const P = this.parts[part];
    P.pos.push(...a, ...b, ...c);
    const r = ((color >> 16) & 255) / 255, g = ((color >> 8) & 255) / 255, bl = (color & 255) / 255;
    for (let i = 0; i < 3; i++) P.col.push(r, g, bl);
  }
  quad(part, a, b, c, d, color) { this._tri(part, a, b, c, color); this._tri(part, a, c, d, color); }
  box(part, cx, cy, cz, w, h, d, color) {
    const x0 = cx - w / 2, x1 = cx + w / 2, y0 = cy - h / 2, y1 = cy + h / 2, z0 = cz - d / 2, z1 = cz + d / 2;
    const v = [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]];
    const q = (a, b, c, e) => this.quad(part, v[a], v[b], v[c], v[e], color);
    q(4, 7, 6, 5); q(0, 1, 2, 3); q(1, 0, 4, 5); q(3, 2, 6, 7); q(0, 3, 7, 4); q(2, 1, 5, 6);
  }
  /** Side profile [[z, y], ...] (counter-clockwise seen from +x) extruded from x0 to x1. */
  extrude(part, profile, x0, x1, color) {
    const shape = new THREE.Shape(profile.map(([z, y]) => new THREE.Vector2(z, y)));
    const geo = new THREE.ExtrudeGeometry(shape, { depth: x1 - x0, bevelEnabled: false, curveSegments: 4 });
    const g = geo.index ? geo.toNonIndexed() : geo;
    const p = g.attributes.position.array;
    // Shape space (sx, sy, sz in [0, depth]) -> vehicle space (x1 - sz, sy, sx): a proper rotation.
    for (let i = 0; i < p.length; i += 9) {
      const tri = [];
      for (let k = 0; k < 3; k++) tri.push([x1 - p[i + k * 3 + 2], p[i + k * 3 + 1], p[i + k * 3]]);
      this._tri(part, tri[0], tri[1], tri[2], color);
    }
  }
  cyl(part, cx, cy, cz, r, len, axis, sides, color) {
    const g = new THREE.CylinderGeometry(r, r, len, sides);
    if (axis === 'x') g.rotateZ(Math.PI / 2); else if (axis === 'z') g.rotateX(Math.PI / 2);
    g.translate(cx, cy, cz);
    const p = (g.index ? g.toNonIndexed() : g).attributes.position.array;
    for (let i = 0; i < p.length; i += 9) this._tri(part, [p[i], p[i + 1], p[i + 2]], [p[i + 3], p[i + 4], p[i + 5]], [p[i + 6], p[i + 7], p[i + 8]], color);
  }
  /** Glass panel on a side (x = const), polygon in (z, y), facing +x or -x. */
  sidePanel(part, x, poly, color, facing) {
    const pts = poly.map(([z, y]) => [x, y, z]);
    for (let i = 1; i < pts.length - 1; i++) {
      if (facing > 0) this._tri(part, pts[0], pts[i + 1], pts[i], color); else this._tri(part, pts[0], pts[i], pts[i + 1], color);
    }
  }
  /**
   * Shell lofted through cross-sections along z: stations = [{ z, pts: [[x, y], ...] }]
   * with equal point counts. partOf(nx, ny, nz, seg) picks each quad's part.
   */
  loft(stations, partOf, color = 0, closed = true, caps = true, inward = false) {
    const n = stations[0].pts.length, segs = closed ? n : n - 1;
    const cen = stations.map(st => st.pts.reduce((a, p) => [a[0] + p[0] / n, a[1] + p[1] / n], [0, 0]));
    const P = (st, i) => [st.pts[i][0], st.pts[i][1], st.z];
    for (let k = 0; k < stations.length - 1; k++) {
      const A = stations[k], B = stations[k + 1];
      for (let i = 0; i < segs; i++) {
        const j = (i + 1) % n;
        const a = P(A, i), b = P(A, j), c = P(B, j), d = P(B, i);
        // Face normal of (a, d, c); flip the winding if it points into the shell.
        const ux = d[0] - a[0], uy = d[1] - a[1], uz = d[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
        let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
        const mx = (a[0] + b[0] + c[0] + d[0]) / 4 - cen[k][0], my = (a[1] + b[1] + c[1] + d[1]) / 4 - cen[k][1];
        const out = (nx * mx + ny * my >= 0) !== inward;
        if (!out) { nx = -nx; ny = -ny; nz = -nz; }
        const l = Math.hypot(nx, ny, nz) || 1;
        const part = partOf(nx / l, ny / l, nz / l, i);
        if (out) this.quad(part, a, d, c, b, color); else this.quad(part, a, b, c, d, color);
      }
    }
    if (!caps) return;
    for (const [st, c, sign] of [[stations[0], cen[0], -1], [stations[stations.length - 1], cen[cen.length - 1], 1]]) {
      const m = [c[0], c[1], st.z];
      for (let i = 0; i < segs; i++) {
        const a = P(st, i), b = P(st, (i + 1) % n);
        const cz = (a[0] - m[0]) * (b[1] - m[1]) - (a[1] - m[1]) * (b[0] - m[0]);
        if ((cz >= 0) === (sign > 0)) this._tri(partOf(0, 0, sign, -1), m, a, b, color); else this._tri(partOf(0, 0, sign, -1), m, b, a, color);
      }
    }
  }
  /** Square bar along a 3D segment (pillars, rails, handlebars). */
  bar(part, a, b, r, color) {
    const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2], len = Math.hypot(dx, dy, dz) || 1;
    let ux = -dz, uy = 0, uz = dx, ul = Math.hypot(ux, uy, uz);
    if (ul < 1e-6) { ux = 1; uy = 0; uz = 0; ul = 1; }
    ux /= ul; uy /= ul; uz /= ul;
    const vx = (dy * uz - dz * uy) / len, vy = (dz * ux - dx * uz) / len, vz = (dx * uy - dy * ux) / len;
    const ring = p => [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([s, t]) => [p[0] + (ux * s + vx * t) * r, p[1] + (uy * s + vy * t) * r, p[2] + (uz * s + vz * t) * r]);
    const A = ring(a), B = ring(b);
    for (let i = 0; i < 4; i++) { const j = (i + 1) % 4; this.quad(part, A[i], A[j], B[j], B[i], color); }
  }
  /** Dark wheel-well on a body side: a half-disc at x, centred on the hub. */
  arch(x, z, y, r, facing) {
    const n = 10, pts = [];
    for (let i = 0; i <= n; i++) { const a = (i / n) * Math.PI; pts.push([x, y + Math.sin(a) * r, z + Math.cos(a) * r]); }
    const c = [x, y, z];
    for (let i = 0; i < n; i++) { if (facing > 0) this._tri('fixed', c, pts[i + 1], pts[i], 0x0b0b0b); else this._tri('fixed', c, pts[i], pts[i + 1], 0x0b0b0b); }
  }
  build() {
    const out = {};
    for (const [k, P] of Object.entries(this.parts)) {
      let g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(P.pos, 3));
      g.setAttribute('color', new THREE.Float32BufferAttribute(P.col, 3));
      // Smooth across gentle bends (bonnet into windscreen), keep the hard edges hard.
      if (P.pos.length) g = toCreasedNormals(g, k === 'paint' || k === 'glass' ? 0.75 : 0.5);
      g.computeBoundingSphere();
      out[k] = g;
    }
    return out;
  }
}

/** Height of a closed side profile [[z, y], ...] where it crosses z: the top (max) or bottom (min). */
function profileAt(profile, z, top = true) {
  let best = top ? -Infinity : Infinity;
  for (let i = 0; i < profile.length; i++) {
    const [z0, y0] = profile[i], [z1, y1] = profile[(i + 1) % profile.length];
    if (z0 === z1 || (z - z0) * (z - z1) > 0) continue;
    const y = y0 + ((y1 - y0) * (z - z0)) / (z1 - z0);
    best = top ? Math.max(best, y) : Math.min(best, y);
  }
  return best;
}

/** Rounded-rectangle cross-section, counter-clockwise; `tumble` pulls the top corners in. */
function roundRect(w, yb, yt, rTop, rBot, tumble = 0.96, steps = 3) {
  const h = Math.max(0.01, yt - yb);
  rTop = Math.min(rTop, h * 0.45, w * 0.45); rBot = Math.min(rBot, h * 0.3);
  const pts = [], arc = (cx, cy, r, a0, a1) => { for (let i = 0; i <= steps; i++) { const a = a0 + ((a1 - a0) * i) / steps; pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]); } };
  const wt = w * tumble;
  arc(w - rBot, yb + rBot, rBot, -Math.PI / 2, 0);
  arc(wt - rTop, yt - rTop, rTop, 0, Math.PI / 2);
  arc(-(wt - rTop), yt - rTop, rTop, Math.PI / 2, Math.PI);
  arc(-(w - rBot), yb + rBot, rBot, Math.PI, Math.PI * 1.5);
  return pts;
}

/** Open arch over a cabin: side, rounded roof corners, side. */
function archSection(w, yb, yt, wTop, r, steps = 3) {
  const h = Math.max(0.01, yt - yb);
  r = Math.min(r, h * 0.45, wTop * 0.45);
  const pts = [[w, yb]];
  for (let i = 0; i <= steps; i++) { const a = (i / steps) * (Math.PI / 2); pts.push([wTop - r + Math.cos(a) * r, yt - r + Math.sin(a) * r]); }
  for (let i = 0; i <= steps; i++) { const a = Math.PI / 2 + (i / steps) * (Math.PI / 2); pts.push([-(wTop - r) + Math.cos(a) * r, yt - r + Math.sin(a) * r]); }
  pts.push([-w, yb]);
  return pts;
}

function stationsAlong(z0, z1, n, knots = []) {
  const zs = new Set();
  for (let i = 0; i <= n; i++) zs.add(+(z0 + ((z1 - z0) * i) / n).toFixed(4));
  for (const k of knots) if (k > z0 && k < z1) zs.add(+k.toFixed(4));
  return [...zs].sort((a, b) => a - b);
}

/**
 * Car body: a lower shell lofted along the side profile with bumpers rounded
 * off, and a cabin whose sides and sloped ends are glass under a painted roof
 * with pillars. Wheel wells are dark arches on the flanks.
 */
function carBody(b, { lower, house, hw, houseHw, wheels = [] }) {
  const zs = lower.map(p => p[0]), zmin = Math.min(...zs) + 0.015, zmax = Math.max(...zs) - 0.015;
  const zmid = (zmin + zmax) / 2, half = (zmax - zmin) / 2;
  const body = stationsAlong(zmin, zmax, 18, lower.map(p => p[0])).map(z => {
    const u = Math.abs(z - zmid) / half;
    const w = hw * (1 - 0.1 * smooth(0.7, 1, u));
    const yt = profileAt(lower, z, true), yb = profileAt(lower, z, false) + 0.05 * smooth(0.82, 1, u);
    return { z, pts: roundRect(w, yb, Math.max(yt, yb + 0.02), 0.1 + 0.08 * smooth(0.75, 1, u), 0.06, 0.965) };
  });
  b.loft(body, () => 'paint');
  // Cabin.
  const hz = house.map(p => p[0]), h0 = Math.min(...hz) + 0.01, h1 = Math.max(...hz) - 0.01;
  const cabin = stationsAlong(h0, h1, 14, hz).map(z => {
    const yb = profileAt(house, z, false), yt = Math.max(profileAt(house, z, true), yb + 0.012);
    return { z, pts: archSection(houseHw, yb - 0.01, yt, houseHw * 0.86, 0.09) };
  });
  b.loft(cabin, (nx, ny, nz) => (Math.abs(nx) > 0.72 || Math.abs(nz) > 0.35 ? 'glass' : 'paint'), 0, false, false);
  // Pillars: A (along the windscreen edge), B (black, mid-cabin), C (behind the rear door).
  const roofFront = house[1], roofRear = house[house.length - 2], baseFront = house[0], baseRear = house[house.length - 1];
  for (const sgn of [1, -1]) {
    const xb = sgn * (houseHw + 0.005), xt = sgn * (houseHw * 0.86 - 0.02);
    b.bar('paint', [xb, baseFront[1], baseFront[0] - 0.03], [xt, roofFront[1] - 0.02, roofFront[0] - 0.02], 0.035, 0);
    b.bar('paint', [xb, baseRear[1], baseRear[0] + 0.08], [xt, roofRear[1] - 0.02, roofRear[0] + 0.05], 0.05, 0);
    const zb = (roofFront[0] + roofRear[0]) / 2 - 0.15, yb = profileAt(house, zb, false), yt = profileAt(house, zb, true);
    b.bar('fixed', [sgn * (houseHw - 0.02) + sgn * 0.012, yb, zb], [sgn * (houseHw * 0.88) + sgn * 0.008, yt - 0.03, zb], 0.04, BLACK);
    // Door seams and handles.
    b.box('fixed', sgn * (hw * 0.995), (yb + profileAt(lower, zb, false)) / 2 + 0.05, zb, 0.008, yb - profileAt(lower, zb, false) - 0.12, 0.012, 0x222222);
    b.box('fixed', sgn * (hw * 0.997), yb - 0.1, zb + 0.35, 0.01, 0.03, 0.14, CHROME);
    for (const [wx, wz, r] of wheels) if (Math.sign(wx) === sgn) b.arch(sgn * (hw * (1 - 0.1 * smooth(0.7, 1, Math.abs(wz - zmid) / half)) + 0.004), wz, r, r + 0.07, sgn);
  }
}

function lampsAndPlates(b, { front, rear, y, hw, commercial = false, lampW = 0.3 }) {
  for (const s of [1, -1]) {
    b.box('lights', s * (hw - lampW / 2 - 0.06), y, front, lampW, 0.13, 0.05, HEAD);
    b.box('lights', s * (hw - 0.14), y + 0.02, rear, 0.22, 0.14, 0.05, TAIL);
    b.box('lights', s * (hw - 0.05), y - 0.02, front - 0.05, 0.06, 0.06, 0.06, AMBER);
  }
  // Indian plates: white front and back on private vehicles, yellow on commercial ones.
  b.box('fixed', 0, y - 0.22, front + 0.02, 0.5, 0.12, 0.02, commercial ? PLATE_Y : PLATE_W);
  b.box('fixed', 0, y - 0.18, rear - 0.02, 0.5, 0.12, 0.02, commercial ? PLATE_Y : PLATE_W);
}

// Each builder returns { geos, wheels: [[x, z, r, front, width]], seat: {x, y, z, pose}, siren? }
const BUILDERS = {
  hatch() {
    const b = new VB();
    const wheels = wheels4(1.215, -1.215, 0.77, 0.3);
    carBody(b, {
      lower: [[-1.9, 0.28], [1.88, 0.28], [1.93, 0.58], [1.78, 0.83], [0.92, 0.98], [-1.78, 0.98], [-1.93, 0.74]],
      house: [[0.92, 0.98], [0.12, 1.47], [-1.22, 1.47], [-1.8, 0.98]], hw: 0.85, houseHw: 0.77, wheels,
    });
    b.box('fixed', 0, 0.42, 1.9, 1.62, 0.24, 0.12, GREY); b.box('fixed', 0, 0.42, -1.9, 1.62, 0.24, 0.12, GREY);
    b.box('fixed', 0, 0.7, 1.9, 0.9, 0.16, 0.05, BLACK);
    for (const s of [1, -1]) b.box('paint', s * 0.9, 1.0, 0.75, 0.12, 0.08, 0.14, 0);
    lampsAndPlates(b, { front: 1.92, rear: -1.92, y: 0.72, hw: 0.82 });
    return { b, wheels, seat: { x: -0.36, y: 0.5, z: -0.2, pose: 'sit' } };
  },
  sedan() {
    const b = new VB();
    const wheels = wheels4(1.28, -1.27, 0.78, 0.31);
    carBody(b, {
      lower: [[-2.12, 0.3], [2.1, 0.3], [2.14, 0.6], [1.96, 0.82], [1.02, 0.95], [-1.55, 0.97], [-2.08, 0.92], [-2.14, 0.62]],
      house: [[1.02, 0.95], [0.22, 1.43], [-0.98, 1.43], [-1.58, 0.97]], hw: 0.86, houseHw: 0.78, wheels,
    });
    b.box('fixed', 0, 0.44, 2.11, 1.64, 0.22, 0.1, GREY); b.box('fixed', 0, 0.44, -2.11, 1.64, 0.22, 0.1, GREY);
    b.box('fixed', 0, 0.7, 2.13, 0.9, 0.16, 0.04, CHROME);
    for (const s of [1, -1]) b.box('paint', s * 0.92, 0.98, 0.85, 0.12, 0.08, 0.14, 0);
    lampsAndPlates(b, { front: 2.14, rear: -2.14, y: 0.74, hw: 0.83 });
    return { b, wheels, seat: { x: -0.37, y: 0.5, z: -0.15, pose: 'sit' } };
  },
  suv() {
    const b = new VB();
    const wheels = wheels4(1.34, -1.34, 0.83, 0.36, 0.24);
    carBody(b, {
      lower: [[-2.2, 0.4], [2.2, 0.4], [2.24, 0.78], [2.16, 1.08], [1.28, 1.17], [-2.2, 1.17]],
      house: [[1.28, 1.17], [0.72, 1.86], [-2.12, 1.86], [-2.2, 1.17]], hw: 0.92, houseHw: 0.86, wheels,
    });
    b.box('fixed', 0, 0.55, 2.22, 1.76, 0.3, 0.12, BLACK); b.box('fixed', 0, 0.55, -2.22, 1.76, 0.3, 0.12, BLACK);
    b.box('fixed', 0, 0.95, 2.22, 1.1, 0.24, 0.04, CHROME);
    for (const s of [1, -1]) { b.box('fixed', s * 0.62, 1.92, -0.6, 0.06, 0.06, 2.6, CHROME); b.box('fixed', s * 0.95, 0.5, 0, 0.08, 0.1, 2.4, BLACK); }
    b.cyl('fixed', 0, 1.0, -2.32, 0.34, 0.22, 'z', 10, BLACK);
    lampsAndPlates(b, { front: 2.25, rear: -2.23, y: 0.92, hw: 0.88 });
    return { b, wheels, seat: { x: -0.4, y: 0.72, z: 0.05, pose: 'sit' } };
  },
  police() {
    const b = new VB();
    const wheels = wheels4(1.34, -1.34, 0.79, 0.35, 0.22);
    carBody(b, {
      lower: [[-2.06, 0.4], [2.06, 0.4], [2.1, 0.78], [2.02, 1.08], [1.2, 1.17], [-2.06, 1.17]],
      house: [[1.2, 1.17], [0.68, 1.88], [-2.0, 1.88], [-2.06, 1.17]], hw: 0.88, houseHw: 0.82, wheels,
    });
    // Blue band with a red pinstripe down each side.
    for (const s of [1, -1]) {
      b.box('fixed', s * 0.885, 0.88, 0, 0.012, 0.16, 4.0, 0x1f3a93);
      b.box('fixed', s * 0.886, 0.78, 0, 0.012, 0.04, 4.0, 0xc62828);
    }
    b.box('fixed', 0, 0.55, 2.08, 1.7, 0.3, 0.12, BLACK); b.box('fixed', 0, 0.55, -2.08, 1.7, 0.3, 0.12, BLACK);
    b.box('fixed', 0, 0.98, 2.1, 1.0, 0.22, 0.04, BLACK);
    // Light bar: red to the left, blue to the right.
    b.box('fixed', 0, 1.93, 0.1, 1.2, 0.08, 0.3, BLACK);
    b.box('lights', 0.32, 2.03, 0.1, 0.5, 0.14, 0.26, 0xff2020);
    b.box('lights', -0.32, 2.03, 0.1, 0.5, 0.14, 0.26, 0x2050ff);
    lampsAndPlates(b, { front: 2.11, rear: -2.09, y: 0.92, hw: 0.84 });
    return { b, wheels, seat: { x: -0.4, y: 0.72, z: 0.0, pose: 'sit' }, siren: true };
  },
  auto() {
    const b = new VB();
    // Body: the rear tub flows into the narrow front cowl that carries the headlamp.
    // Keys: [z, half width, bottom, top, top corner radius].
    const keys = [[-1.28, 0.6, 0.36, 0.8, 0.12], [-1.12, 0.645, 0.3, 0.84, 0.1], [0.18, 0.645, 0.3, 0.84, 0.1], [0.45, 0.52, 0.32, 0.95, 0.12],
      [0.72, 0.42, 0.34, 1.06, 0.12], [1.02, 0.37, 0.38, 0.98, 0.14], [1.3, 0.26, 0.46, 0.74, 0.1]];
    const at = z => {
      let i = 0; while (i < keys.length - 2 && z > keys[i + 1][0]) i++;
      const a = keys[i], c = keys[i + 1], t = Math.min(1, Math.max(0, (z - a[0]) / (c[0] - a[0])));
      return a.map((v, k) => v + (c[k] - v) * t);
    };
    b.loft(stationsAlong(-1.28, 1.3, 16, keys.map(k => k[0])).map(z => { const [, w, yb, yt, r] = at(z); return { z, pts: roundRect(w, yb, yt, r, 0.06, 0.97) }; }), () => 'paint');
    for (const sgn of [1, -1]) b.arch(sgn * 0.649, -0.8, 0.23, 0.3, sgn);
    // Canopy: yellow roof over black fabric, open at the sides.
    const roof = stationsAlong(-1.34, 0.74, 10).map(z => ({ z, pts: archSection(0.68, 1.44, 1.79 - 0.08 * smooth(0.3, 0.74, z), 0.62, 0.26) }));
    b.loft(roof, () => 'fixed', 0xf2c230, false, true);
    b.loft(roof.map(st => ({ z: st.z, pts: st.pts.map(([x, y]) => [x * 0.985, y - 0.02]) })), () => 'fixed', 0x1d1d1d, false, false, true);
    for (const sgn of [1, -1]) b.box('fixed', sgn * 0.675, 1.47, -0.3, 0.025, 0.08, 2.08, 0x1d1d1d);
    // Back panel with a small plastic window; grab poles at the corners.
    b.box('fixed', 0, 1.2, -1.31, 1.3, 0.78, 0.04, 0x1d1d1d);
    b.box('fixed', 0, 1.36, -1.335, 0.56, 0.2, 0.012, GLASS);
    for (const sgn of [1, -1]) { b.bar('fixed', [sgn * 0.64, 0.84, 0.6], [sgn * 0.64, 1.45, 0.7], 0.022, BLACK); b.bar('fixed', [sgn * 0.64, 0.84, -1.28], [sgn * 0.64, 1.45, -1.3], 0.022, BLACK); }
    // Windscreen in a black frame, wiper, handlebar and mirrors.
    b.box('fixed', 0, 1.29, 0.7, 1.06, 0.46, 0.03, GLASS);
    b.box('fixed', 0, 1.52, 0.7, 1.12, 0.05, 0.05, BLACK); b.box('fixed', 0, 1.06, 0.7, 1.1, 0.05, 0.05, BLACK);
    b.bar('fixed', [0.05, 1.08, 0.72], [-0.2, 1.42, 0.725], 0.008, BLACK);
    b.bar('fixed', [-0.36, 1.12, 0.46], [0.36, 1.12, 0.46], 0.02, BLACK);
    for (const sgn of [1, -1]) { b.bar('fixed', [sgn * 0.3, 1.12, 0.48], [sgn * 0.42, 1.36, 0.52], 0.01, BLACK); b.box('fixed', sgn * 0.44, 1.4, 0.52, 0.12, 0.08, 0.02, CHROME); }
    // Seats: the passengers' bench and backrest, the driver's saddle.
    b.box('fixed', 0, 0.86, -0.75, 1.2, 0.16, 0.6, 0x2b211d);
    b.box('fixed', 0, 1.16, -1.16, 1.2, 0.5, 0.12, 0x2b211d);
    b.box('fixed', 0, 0.88, 0.16, 0.42, 0.12, 0.42, 0x2b211d);
    // Lamps, indicators, number plate.
    b.box('lights', 0, 0.86, 1.25, 0.2, 0.17, 0.08, HEAD);
    for (const sgn of [1, -1]) { b.box('lights', sgn * 0.28, 0.98, 1.06, 0.07, 0.05, 0.05, AMBER); b.box('lights', sgn * 0.55, 0.62, -1.3, 0.14, 0.12, 0.04, TAIL); }
    b.box('fixed', 0, 0.5, -1.31, 0.48, 0.13, 0.02, PLATE_Y);
    return { b, wheels: [[0.6, -0.8, 0.23, false, 0.16], [-0.6, -0.8, 0.23, false, 0.16], [0, 1.15, 0.23, true, 0.14]], seat: { x: 0, y: 0.82, z: 0.18, pose: 'sit' }, passengers: [[0.3, 0.88, -0.75], [-0.3, 0.88, -0.75]] };
  },
  bike() {
    const b = new VB();
    b.box('paint', 0, 0.86, 0.22, 0.3, 0.2, 0.46, 0);
    b.box('paint', 0, 0.72, -0.15, 0.22, 0.2, 0.4, 0);
    b.box('fixed', 0, 0.9, -0.3, 0.26, 0.08, 0.62, BLACK);
    b.box('fixed', 0, 0.5, 0.08, 0.26, 0.3, 0.42, GREY);
    b.box('fixed', -0.16, 0.42, -0.4, 0.08, 0.08, 0.6, CHROME);
    b.box('paint', 0, 0.68, -0.72, 0.16, 0.06, 0.32, 0);
    b.box('paint', 0, 0.66, 0.66, 0.14, 0.05, 0.3, 0);
    for (const s of [1, -1]) {
      const g = new THREE.CylinderGeometry(0.025, 0.025, 0.7, 5);
      g.rotateX(0.35); g.translate(s * 0.07, 0.68, 0.56);
      const p = (g.index ? g.toNonIndexed() : g).attributes.position.array;
      for (let i = 0; i < p.length; i += 9) b._tri('fixed', [p[i], p[i + 1], p[i + 2]], [p[i + 3], p[i + 4], p[i + 5]], [p[i + 6], p[i + 7], p[i + 8]], CHROME);
    }
    b.box('fixed', 0, 1.02, 0.44, 0.72, 0.04, 0.04, BLACK);
    b.box('lights', 0, 0.92, 0.6, 0.16, 0.14, 0.08, HEAD);
    b.box('lights', 0, 0.78, -0.88, 0.1, 0.06, 0.05, TAIL);
    return { b, wheels: [[0, 0.64, 0.31, true, 0.1], [0, -0.63, 0.31, false, 0.11]], seat: { x: 0, y: 0.8, z: -0.28, pose: 'ride' }, passengers: [[0, 0.86, -0.62]] };
  },
  scooter() {
    const b = new VB();
    b.extrude('paint', [[0.42, 0.25], [0.62, 0.3], [0.68, 1.0], [0.52, 1.06], [0.4, 0.4]], -0.2, 0.2, 0);
    b.box('fixed', 0, 0.32, 0.0, 0.3, 0.06, 0.5, GREY);
    b.extrude('paint', [[-0.82, 0.28], [-0.2, 0.28], [-0.12, 0.7], [-0.9, 0.78]], -0.2, 0.2, 0);
    b.box('fixed', 0, 0.82, -0.48, 0.28, 0.08, 0.6, BLACK);
    b.box('fixed', 0, 1.06, 0.5, 0.66, 0.05, 0.05, BLACK);
    b.box('lights', 0, 0.98, 0.6, 0.14, 0.1, 0.06, HEAD);
    b.box('lights', 0, 0.7, -0.92, 0.12, 0.06, 0.04, TAIL);
    return { b, wheels: [[0, 0.62, 0.24, true, 0.1], [0, -0.62, 0.24, false, 0.11]], seat: { x: 0, y: 0.72, z: -0.26, pose: 'ride' }, passengers: [[0, 0.78, -0.62]] };
  },
  bus() {
    const b = new VB();
    b.box('paint', 0, 1.7, 0, 2.5, 2.5, 10.6, 0);
    b.box('fixed', 0, 3.0, 0, 2.42, 0.12, 10.4, 0xece6d6);
    for (const s of [1, -1]) {
      b.box('fixed', s * 1.252, 1.48, 0, 0.012, 0.12, 10.5, 0xf2c230);
      b.box('fixed', s * 1.253, 2.12, -0.2, 0.012, 0.66, 9.2, GLASS);
      for (let z = -4.6; z < 4.6; z += 1.15) b.box('paint', s * 1.256, 2.12, z, 0.014, 0.66, 0.1, 0);
      b.box('fixed', s * 1.252, 0.62, 0, 0.012, 0.2, 10.5, 0x2a2a2a);
    }
    b.box('fixed', 0, 2.05, 5.31, 2.3, 1.0, 0.02, GLASS);
    b.box('lights', 0, 2.75, 5.31, 1.6, 0.26, 0.03, 0xffb347);
    b.box('fixed', 0, 0.62, 5.32, 2.4, 0.3, 0.06, GREY);
    b.box('fixed', 0, 2.2, -5.31, 2.1, 0.7, 0.02, GLASS);
    for (const s of [1, -1]) {
      b.box('lights', s * 1.0, 1.0, 5.32, 0.3, 0.16, 0.04, HEAD);
      b.box('lights', s * 1.05, 1.05, -5.32, 0.2, 0.3, 0.04, TAIL);
    }
    b.box('fixed', 0, 0.85, -5.33, 0.5, 0.13, 0.02, PLATE_Y);
    return { b, wheels: wheels4(3.4, -2.4, 1.08, 0.5, 0.32), seat: { x: -0.75, y: 1.0, z: 4.4, pose: 'sit' } };
  },
  truck() {
    const b = new VB();
    b.extrude('paint', [[2.3, 0.6], [3.78, 0.6], [3.82, 1.6], [3.55, 2.85], [2.3, 2.95]], -1.15, 1.15, 0);
    b.box('fixed', 0, 2.2, 3.72, 1.9, 0.75, 0.03, GLASS);
    for (const s of [1, -1]) b.box('fixed', s * 1.16, 2.1, 2.95, 0.02, 0.6, 0.9, GLASS);
    // Decorated cargo body: painted panels in every colour, a tarpaulin over the load.
    const panel = [0xd32f2f, 0xfbc02d, 0x1976d2, 0x388e3c, 0xf57c00, 0x7b1fa2];
    b.box('fixed', 0, 1.0, -0.85, 2.36, 0.25, 6.0, 0x5d4037);
    for (const s of [1, -1]) for (let k = 0; k < 6; k++) b.box('fixed', s * 1.19, 1.75, -3.35 + k * 1.0, 0.03, 1.25, 0.95, panel[(k + (s > 0 ? 0 : 3)) % 6]);
    b.box('fixed', 0, 1.75, -3.86, 2.36, 1.25, 0.04, 0xfbc02d);
    b.box('fixed', 0, 2.55, -0.85, 2.3, 0.4, 5.9, 0x2e7d6b);
    b.box('fixed', 0, 0.7, 3.84, 2.3, 0.28, 0.08, GREY);
    for (const s of [1, -1]) { b.box('lights', s * 0.92, 0.95, 3.84, 0.28, 0.18, 0.04, HEAD); b.box('lights', s * 1.0, 1.0, -3.88, 0.2, 0.18, 0.04, TAIL); }
    b.box('fixed', 0, 0.75, -3.9, 0.5, 0.13, 0.02, PLATE_Y);
    return { b, wheels: [...wheels4(2.95, -1.6, 1.0, 0.48, 0.28), [1.0, -2.65, 0.48, false, 0.28], [-1.0, -2.65, 0.48, false, 0.28]], seat: { x: -0.55, y: 1.25, z: 3.0, pose: 'sit' } };
  },
  tractor() {
    const b = new VB();
    b.extrude('paint', [[0.3, 0.6], [1.62, 0.62], [1.68, 1.25], [0.3, 1.3]], -0.38, 0.38, 0);
    b.box('fixed', 0, 0.9, 1.66, 0.6, 0.4, 0.04, BLACK);
    b.box('fixed', 0, 0.75, -0.3, 0.7, 0.5, 1.2, GREY);
    for (const s of [1, -1]) b.extrude('paint', [[-1.3, 1.1], [-0.1, 1.1], [-0.25, 1.45], [-1.15, 1.45]], s > 0 ? 0.52 : -0.98, s > 0 ? 0.98 : -0.52, 0);
    b.box('fixed', 0, 1.15, -0.65, 0.5, 0.1, 0.45, BLACK);
    b.cyl('fixed', 0.25, 1.55, 1.2, 0.05, 0.9, 'y', 6, BLACK);
    b.box('fixed', 0, 1.45, 0.25, 0.42, 0.04, 0.04, BLACK);
    for (const s of [1, -1]) b.box('lights', s * 0.25, 1.15, 1.66, 0.14, 0.14, 0.05, HEAD);
    return { b, wheels: [[0.78, -0.7, 0.7, false, 0.36], [-0.78, -0.7, 0.7, false, 0.36], [0.62, 1.3, 0.42, true, 0.22], [-0.62, 1.3, 0.42, true, 0.22]], seat: { x: 0, y: 1.3, z: -0.65, pose: 'sit' } };
  },
  tempo() {
    const b = new VB();
    b.extrude('paint', [[0.85, 0.45], [1.85, 0.45], [1.9, 1.05], [1.65, 1.9], [0.85, 1.92]], -0.77, 0.77, 0);
    b.box('fixed', 0, 1.5, 1.79, 1.35, 0.6, 0.03, GLASS);
    for (const s of [1, -1]) b.box('fixed', s * 0.776, 1.5, 1.28, 0.02, 0.5, 0.6, GLASS);
    b.box('fixed', 0, 0.75, -0.55, 1.52, 0.12, 2.75, 0x8d9497);
    for (const s of [1, -1]) b.box('fixed', s * 0.75, 1.0, -0.55, 0.04, 0.4, 2.75, 0x9aa3a6);
    b.box('fixed', 0, 1.0, -1.92, 1.52, 0.4, 0.04, 0x9aa3a6);
    b.box('fixed', 0, 1.2, -0.7, 1.3, 0.5, 2.2, 0xc9a26b);
    b.box('fixed', 0, 0.55, 1.88, 1.5, 0.2, 0.06, GREY);
    for (const s of [1, -1]) { b.box('lights', s * 0.58, 0.95, 1.9, 0.24, 0.16, 0.04, HEAD); b.box('lights', s * 0.62, 0.85, -1.94, 0.14, 0.14, 0.04, TAIL); }
    return { b, wheels: wheels4(1.25, -1.0, 0.66, 0.3), seat: { x: -0.32, y: 0.85, z: 1.25, pose: 'sit' } };
  },
  ambulance() {
    const b = new VB();
    b.extrude('paint', [[-2.35, 0.4], [2.3, 0.4], [2.35, 0.95], [1.5, 1.25], [1.15, 2.2], [-2.35, 2.25]], -0.91, 0.91, 0);
    b.box('fixed', 0, 1.6, 1.38, 1.6, 0.62, 0.3, GLASS);
    for (const s of [1, -1]) {
      b.box('fixed', s * 0.915, 1.55, 0.7, 0.012, 0.5, 0.7, GLASS);
      b.box('fixed', s * 0.916, 1.0, -0.4, 0.012, 0.18, 3.6, 0xc62828);
      b.box('fixed', s * 0.917, 1.65, -0.9, 0.012, 0.5, 0.18, 0xc62828);
      b.box('fixed', s * 0.917, 1.65, -0.9, 0.012, 0.18, 0.5, 0xc62828);
    }
    b.box('lights', 0.3, 2.32, 0.9, 0.45, 0.12, 0.24, 0xff2020);
    b.box('lights', -0.3, 2.32, 0.9, 0.45, 0.12, 0.24, 0x2050ff);
    b.box('fixed', 0, 0.55, 2.33, 1.7, 0.25, 0.08, GREY);
    for (const s of [1, -1]) { b.box('lights', s * 0.7, 0.9, 2.34, 0.28, 0.14, 0.04, HEAD); b.box('lights', s * 0.8, 1.2, -2.37, 0.18, 0.3, 0.04, TAIL); }
    return { b, wheels: wheels4(1.55, -1.35, 0.78, 0.33), seat: { x: -0.4, y: 0.75, z: 0.75, pose: 'sit' }, siren: true };
  },
};

function wheels4(front, rear, x, r, width = 0.2) {
  return [[x, front, r, true, width], [-x, front, r, true, width], [x, rear, r, false, width], [-x, rear, r, false, width]];
}

const cache = new Map();
export function vehicleModel(type) {
  if (!cache.has(type)) {
    const res = BUILDERS[type]();
    cache.set(type, { geos: res.b.build(), wheels: res.wheels, seat: res.seat, passengers: res.passengers || [], siren: Boolean(res.siren) });
  }
  return cache.get(type);
}
