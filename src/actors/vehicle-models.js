// Procedural vehicle models. Each type yields three geometries: `paint` (tinted
// per vehicle), `fixed` (vertex-coloured trim, glass, tyres, canopy) and
// `lights` (lamps, brightened at night and when braking), plus wheel and seat data.
import * as THREE from 'three';

const GLASS = 0x26343c, BLACK = 0x1a1a1a, GREY = 0x55595b, CHROME = 0xb8bec2, PLATE_W = 0xf4f4f0, PLATE_Y = 0xf2c230;
const HEAD = 0xfff3c4, TAIL = 0xd81b1b, AMBER = 0xff9a1f;

class VB {
  constructor() { this.parts = { paint: { pos: [], col: [] }, fixed: { pos: [], col: [] }, lights: { pos: [], col: [] } }; }
  _tri(part, a, b, c, color) {
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
  build() {
    const out = {};
    for (const [k, P] of Object.entries(this.parts)) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(P.pos, 3));
      g.setAttribute('color', new THREE.Float32BufferAttribute(P.col, 3));
      g.computeVertexNormals();
      g.computeBoundingSphere();
      out[k] = g;
    }
    return out;
  }
}

/** Car-like body: lower profile in paint, greenhouse with inset glass and paint pillars. */
function carBody(b, { lower, house, hw, houseHw, glassInset = 0.06 }) {
  b.extrude('paint', lower, -hw, hw, 0);
  b.extrude('paint', house, -houseHw, houseHw, 0);
  // Side windows: inset copy of the greenhouse profile, just proud of the paint.
  const cz = house.reduce((s, p) => s + p[0], 0) / house.length, cy = house.reduce((s, p) => s + p[1], 0) / house.length;
  const inset = house.map(([z, y]) => [z + (cz - z) * glassInset * 2.2, y + (cy - y) * glassInset * 2.4]);
  b.sidePanel('fixed', houseHw + 0.004, inset, GLASS, 1);
  b.sidePanel('fixed', -houseHw - 0.004, inset, GLASS, -1);
  // Windshield and rear glass on the sloped faces of the house.
  const [f0, f1] = [house[0], house[1]]; // windshield edge: base -> top (front)
  const [r0, r1] = [house[house.length - 1], house[house.length - 2]]; // rear: base -> top
  const glassQuad = (p0, p1, sgn) => {
    const dz = p1[0] - p0[0], dy = p1[1] - p0[1], len = Math.hypot(dz, dy);
    const nz = (dy / len) * sgn * 0.01, ny = (-dz / len) * sgn * 0.01;
    const s = 0.1, e = 0.9, w = houseHw - 0.07;
    const za = p0[0] + dz * s + nz, ya = p0[1] + dy * s + ny, zb = p0[0] + dz * e + nz, yb = p0[1] + dy * e + ny;
    const A = [w, ya, za], B = [-w, ya, za], C = [-w, yb, zb], D = [w, yb, zb];
    if (sgn > 0) b.quad('fixed', A, D, C, B, GLASS); else b.quad('fixed', A, B, C, D, GLASS);
  };
  glassQuad(f0, f1, 1);
  glassQuad(r0, r1, -1);
}

function lampsAndPlates(b, { front, rear, y, hw, commercial = false, lampW = 0.3 }) {
  for (const s of [1, -1]) {
    b.box('lights', s * (hw - lampW / 2 - 0.06), y, front, lampW, 0.13, 0.05, HEAD);
    b.box('lights', s * (hw - 0.14), y + 0.02, rear, 0.22, 0.14, 0.05, TAIL);
    b.box('lights', s * (hw - 0.05), y - 0.02, front - 0.05, 0.06, 0.06, 0.06, AMBER);
  }
  b.box('fixed', 0, y - 0.22, front + 0.02, 0.5, 0.12, 0.02, commercial ? PLATE_Y : PLATE_W);
  b.box('fixed', 0, y - 0.18, rear - 0.02, 0.5, 0.12, 0.02, commercial ? PLATE_Y : PLATE_Y);
}

// Each builder returns { geos, wheels: [[x, z, r, front, width]], seat: {x, y, z, pose}, siren? }
const BUILDERS = {
  hatch() {
    const b = new VB();
    carBody(b, {
      lower: [[-1.9, 0.28], [1.88, 0.28], [1.93, 0.58], [1.78, 0.83], [0.92, 0.98], [-1.78, 0.98], [-1.93, 0.74]],
      house: [[0.92, 0.98], [0.12, 1.47], [-1.22, 1.47], [-1.8, 0.98]], hw: 0.85, houseHw: 0.77,
    });
    b.box('fixed', 0, 0.42, 1.9, 1.62, 0.24, 0.12, GREY); b.box('fixed', 0, 0.42, -1.9, 1.62, 0.24, 0.12, GREY);
    b.box('fixed', 0, 0.7, 1.9, 0.9, 0.16, 0.05, BLACK);
    for (const s of [1, -1]) b.box('paint', s * 0.9, 1.0, 0.75, 0.12, 0.08, 0.14, 0);
    lampsAndPlates(b, { front: 1.92, rear: -1.92, y: 0.72, hw: 0.82 });
    return { b, wheels: wheels4(1.215, -1.215, 0.72, 0.3), seat: { x: -0.36, y: 0.5, z: -0.2, pose: 'sit' } };
  },
  sedan() {
    const b = new VB();
    carBody(b, {
      lower: [[-2.12, 0.3], [2.1, 0.3], [2.14, 0.6], [1.96, 0.82], [1.02, 0.95], [-1.55, 0.97], [-2.08, 0.92], [-2.14, 0.62]],
      house: [[1.02, 0.95], [0.22, 1.43], [-0.98, 1.43], [-1.58, 0.97]], hw: 0.86, houseHw: 0.78,
    });
    b.box('fixed', 0, 0.44, 2.11, 1.64, 0.22, 0.1, GREY); b.box('fixed', 0, 0.44, -2.11, 1.64, 0.22, 0.1, GREY);
    b.box('fixed', 0, 0.7, 2.13, 0.9, 0.16, 0.04, CHROME);
    for (const s of [1, -1]) b.box('paint', s * 0.92, 0.98, 0.85, 0.12, 0.08, 0.14, 0);
    lampsAndPlates(b, { front: 2.14, rear: -2.14, y: 0.74, hw: 0.83 });
    return { b, wheels: wheels4(1.28, -1.27, 0.74, 0.31), seat: { x: -0.37, y: 0.5, z: -0.15, pose: 'sit' } };
  },
  suv() {
    const b = new VB();
    carBody(b, {
      lower: [[-2.2, 0.4], [2.2, 0.4], [2.24, 0.78], [2.16, 1.08], [1.28, 1.17], [-2.2, 1.17]],
      house: [[1.28, 1.17], [0.72, 1.86], [-2.12, 1.86], [-2.2, 1.17]], hw: 0.92, houseHw: 0.86, glassInset: 0.05,
    });
    b.box('fixed', 0, 0.55, 2.22, 1.76, 0.3, 0.12, BLACK); b.box('fixed', 0, 0.55, -2.22, 1.76, 0.3, 0.12, BLACK);
    b.box('fixed', 0, 0.95, 2.22, 1.1, 0.24, 0.04, CHROME);
    for (const s of [1, -1]) { b.box('fixed', s * 0.62, 1.92, -0.6, 0.06, 0.06, 2.6, CHROME); b.box('fixed', s * 0.95, 0.5, 0, 0.08, 0.1, 2.4, BLACK); }
    b.cyl('fixed', 0, 1.0, -2.32, 0.34, 0.22, 'z', 10, BLACK);
    lampsAndPlates(b, { front: 2.25, rear: -2.23, y: 0.92, hw: 0.88 });
    return { b, wheels: wheels4(1.34, -1.34, 0.8, 0.36), seat: { x: -0.4, y: 0.72, z: 0.05, pose: 'sit' } };
  },
  police() {
    const b = new VB();
    carBody(b, {
      lower: [[-2.06, 0.4], [2.06, 0.4], [2.1, 0.78], [2.02, 1.08], [1.2, 1.17], [-2.06, 1.17]],
      house: [[1.2, 1.17], [0.68, 1.88], [-2.0, 1.88], [-2.06, 1.17]], hw: 0.88, houseHw: 0.82, glassInset: 0.05,
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
    return { b, wheels: wheels4(1.34, -1.34, 0.76, 0.35), seat: { x: -0.4, y: 0.72, z: 0.0, pose: 'sit' }, siren: true };
  },
  auto() {
    const b = new VB();
    // Rear tub and seat box (paint), narrow front cowl (paint).
    b.extrude('paint', [[-1.28, 0.3], [0.35, 0.3], [0.35, 0.78], [-1.28, 0.78]], -0.64, 0.64, 0);
    b.extrude('paint', [[0.3, 0.3], [1.22, 0.36], [1.32, 0.66], [1.08, 1.02], [0.62, 1.06], [0.42, 0.78]], -0.4, 0.4, 0);
    // Yellow canopy shell, open at the sides.
    b.extrude('fixed', [[0.74, 1.5], [0.4, 1.76], [-1.1, 1.78], [-1.33, 1.52], [-1.33, 1.46], [-1.1, 1.71], [0.4, 1.7], [0.68, 1.46]], -0.67, 0.67, 0xf2c230);
    b.box('fixed', 0, 1.12, -1.31, 1.3, 0.7, 0.04, 0x1d1d1d);
    for (const s of [1, -1]) { b.box('fixed', s * 0.64, 1.12, 0.62, 0.04, 0.82, 0.04, BLACK); b.box('fixed', s * 0.64, 1.12, -1.3, 0.04, 0.8, 0.04, BLACK); }
    b.box('fixed', 0, 1.28, 0.66, 1.05, 0.48, 0.03, GLASS);
    b.box('fixed', 0, 0.86, -0.75, 1.2, 0.18, 0.6, 0x3b2f2a);
    b.box('fixed', 0, 1.18, -1.15, 1.2, 0.5, 0.12, 0x3b2f2a);
    b.box('fixed', 0, 1.08, 0.48, 0.6, 0.05, 0.05, CHROME);
    b.box('lights', 0, 0.88, 1.29, 0.2, 0.18, 0.06, HEAD);
    for (const s of [1, -1]) b.box('lights', s * 0.55, 0.62, -1.3, 0.14, 0.12, 0.04, TAIL);
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
    return { b, wheels: [[0, 0.62, 0.24, true, 0.1], [0, -0.62, 0.24, false, 0.11]], seat: { x: 0, y: 0.72, z: -0.38, pose: 'ride' }, passengers: [[0, 0.78, -0.68]] };
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
