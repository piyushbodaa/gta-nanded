// Every person in the city is drawn by one set of instanced body parts with a
// procedural skeleton: ~14 draw calls for all pedestrians, drivers, riders,
// police and the player, whatever their number.
import * as THREE from 'three';
import { rng, clamp } from '../core/math.js';

// ------------------------------------------------------------------ part geometry
// Sculpted, smooth-shaded body parts built from lofted rings: a chest wider than
// the waist, sloping shoulders, calves, hands and shoes. Limbs hang from their
// joint at y = 0; the skeleton below poses them.
function merge(...geos) {
  const pos = [], nrm = [];
  for (const g of geos) {
    const ng = g.index ? g.toNonIndexed() : g;
    pos.push(...ng.attributes.position.array);
    if (!ng.attributes.normal) ng.computeVertexNormals();
    nrm.push(...ng.attributes.normal.array);
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  return out;
}
function ellipsoid(rx, ry, rz, cy = 0, cz = 0, w = 10, h = 7) {
  const g = new THREE.SphereGeometry(1, w, h);
  g.scale(rx, ry, rz); g.translate(0, cy, cz);
  return g;
}
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/**
 * Loft through elliptical rings [y, half-width, front depth, back depth, z shift],
 * bottom to top, with smooth normals and optional end caps.
 */
function loft(rings, seg = 18, capBottom = true, capTop = true) {
  const pos = [], idx = [];
  for (const [y, rx, rf, rb, oz = 0] of rings) {
    for (let i = 0; i < seg; i++) {
      const a = (i / seg) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
      pos.push(c * rx, y, oz + s * (s > 0 ? rf : rb));
    }
  }
  const R = rings.length;
  for (let k = 0; k < R - 1; k++) {
    for (let i = 0; i < seg; i++) {
      const j = (i + 1) % seg, a = k * seg + i, b = k * seg + j, c = (k + 1) * seg + j, d = (k + 1) * seg + i;
      idx.push(a, d, c, a, c, b);
    }
  }
  if (capBottom) { const ci = pos.length / 3; pos.push(0, rings[0][0], rings[0][4] || 0); for (let i = 0; i < seg; i++) idx.push(ci, i, (i + 1) % seg); }
  if (capTop) {
    const ci = pos.length / 3, top = rings[R - 1], base = (R - 1) * seg;
    pos.push(0, top[0], top[4] || 0);
    for (let i = 0; i < seg; i++) idx.push(ci, base + (i + 1) % seg, base + i);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** A limb hanging from its joint: radius profile [[t, r], ...] over `len`, rounded at both ends. */
function limb(len, profile, flat = 0.92, seg = 9) {
  const r0 = profile[0][1], r1 = profile[profile.length - 1][1], rings = [];
  const ring = (y, r) => rings.push([y, Math.max(0.002, r), Math.max(0.002, r * flat), Math.max(0.002, r * flat)]);
  // Rounded end, the profile from the far end back up to the joint, then the joint ball.
  for (let k = 0; k <= 2; k++) { const a = (k / 2) * Math.PI / 2; ring(-len - Math.cos(a) * r1 * 0.9, Math.sin(a) * r1); }
  for (let k = profile.length - 2; k >= 1; k--) ring(-profile[k][0] * len, profile[k][1]);
  for (let k = 0; k <= 2; k++) { const a = Math.PI / 2 - (k / 2) * Math.PI / 2; ring(Math.cos(a) * r0 * 0.85, Math.sin(a) * r0); }
  return loft(rings, seg, false, false);
}

function torso() {
  // From the shirt hem over the belt, up through waist, chest and shoulders, to the collar.
  return loft([
    [-0.08, 0.168, 0.112, 0.106], [0.02, 0.157, 0.103, 0.098], [0.14, 0.161, 0.108, 0.1, 0.004],
    [0.26, 0.175, 0.121, 0.104, 0.01], [0.36, 0.187, 0.125, 0.106, 0.008], [0.43, 0.197, 0.112, 0.106],
    [0.48, 0.172, 0.092, 0.096, -0.005], [0.52, 0.104, 0.072, 0.076, -0.008], [0.545, 0.06, 0.057, 0.057, -0.005],
    [0.565, 0.056, 0.053, 0.053, -0.005],
  ], 14);
}
function hips() {
  return loft([
    [-0.16, 0.06, 0.05, 0.06], [-0.12, 0.15, 0.095, 0.108], [-0.03, 0.171, 0.104, 0.114],
    [0.05, 0.163, 0.1, 0.1], [0.09, 0.158, 0.098, 0.098],
  ], 14);
}
function head() {
  // A skull with a narrower jaw and a forward chin, then neck, nose and ears.
  const g = new THREE.SphereGeometry(1, 16, 12);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    let X = x * 0.093, Y = y * 0.12, Z = z * 0.104;
    const low = smooth(-0.1, -0.95, y);
    X *= 1 - 0.32 * low; // jaw narrows to the chin
    Z += z > 0 ? 0.014 * low * z : 0; // chin and jaw come forward
    Z *= z < 0 && y > -0.4 ? 1.05 : 1; // fuller back of the head
    if (z > 0.55 && y > -0.3 && y < 0.55) Z -= 0.006 * (z - 0.55); // flatter face
    p.setXYZ(i, X, Y, Z);
  }
  g.translate(0, 0.175, 0.004);
  g.computeVertexNormals();
  const neck = new THREE.CylinderGeometry(0.046, 0.052, 0.13, 8, 1, true).translate(0, 0.05, -0.006);
  const nose = ellipsoid(0.016, 0.03, 0.02, 0.163, 0.1, 8, 6);
  const ears = [ellipsoid(0.013, 0.027, 0.008, 0.17, -0.006, 8, 5).translate(0.092, 0, 0), ellipsoid(0.013, 0.027, 0.008, 0.17, -0.006, 8, 5).translate(-0.092, 0, 0)];
  return merge(neck, g, nose, ...ears);
}
function face() {
  // Eyes, brows and lips: the smallest details that make a crowd feel alive.
  const eye = x => ellipsoid(0.0145, 0.008, 0.006, 0.19, 0.096, 8, 5).translate(x, 0, 0);
  const brow = x => new THREE.BoxGeometry(0.038, 0.008, 0.01).rotateZ(x > 0 ? -0.12 : 0.12).translate(x, 0.21, 0.098);
  return merge(eye(0.034), eye(-0.034), brow(0.035), brow(-0.035), ellipsoid(0.021, 0.0045, 0.006, 0.128, 0.096, 8, 4));
}
/** Hair as a shell over the skull, tucked inside the head below a hairline that rises to the forehead. */
function hairShell(front = 0.34, back = -0.55, puff = 1.075) {
  const g = new THREE.SphereGeometry(1, 16, 12);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const line = back + (front - back) * smooth(-0.35, 0.75, z);
    const k = y > line ? puff + (y > 0.2 ? 0.02 : 0) : 0.9;
    p.setXYZ(i, x * 0.093 * k, y * 0.12 * k, z * 0.104 * k);
  }
  g.translate(0, 0.177, 0.002);
  g.computeVertexNormals();
  return merge(g);
}
function turban() {
  const g = ellipsoid(0.128, 0.09, 0.134, 0.248, -0.01, 16, 10);
  const wrap = ellipsoid(0.122, 0.05, 0.128, 0.215, -0.006, 16, 6);
  const peak = ellipsoid(0.07, 0.07, 0.045, 0.268, 0.07, 10, 6);
  return merge(g, wrap, peak);
}
function skirt(len = 0.86, r0 = 0.18, r1 = 0.27) {
  // Gathered folds: the hem ripples.
  const g = new THREE.CylinderGeometry(r0, r1, len, 18, 2, true);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const a = Math.atan2(z, x), t = (len / 2 - y) / len;
    const f = 1 + Math.sin(a * 9) * 0.035 * t;
    p.setXYZ(i, x * f, y, z * f);
  }
  g.translate(0, -len / 2 + 0.04, 0);
  g.computeVertexNormals();
  const t = merge(g); t.scale(1, 1, 0.8);
  return t;
}
function hand() {
  // Forearm with the hand at the wrist: palm, curled fingers and a thumb.
  const arm = limb(0.25, [[0, 0.043], [0.22, 0.046], [0.65, 0.039], [1, 0.031]], 0.88);
  const palm = ellipsoid(0.037, 0.05, 0.019, -0.295, 0.004, 10, 7);
  const fingers = ellipsoid(0.034, 0.042, 0.016, -0.355, 0.012, 10, 7);
  const thumb = ellipsoid(0.012, 0.03, 0.012, -0.285, 0.026, 7, 5);
  return merge(arm, palm, fingers, thumb);
}
function shoe() {
  const g = new THREE.SphereGeometry(1, 10, 7);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const Y = Math.max(y, -0.55);
    p.setXYZ(i, x * (z > 0 ? 0.05 : 0.044), Y * 0.045 - 0.032 + (z > 0.7 ? 0.004 : 0), z * 0.128 + 0.05);
  }
  g.computeVertexNormals();
  return merge(g);
}
function pack() {
  return merge(loft([[0.08, 0.13, 0.05, 0.06], [0.2, 0.145, 0.06, 0.07], [0.38, 0.14, 0.055, 0.065], [0.44, 0.1, 0.045, 0.05]], 14).translate(0, 0, -0.17));
}

const PARTS = [
  { key: 'head', geo: head, color: 'skin', mat: 'skin' },
  { key: 'face', geo: face, color: 'brow', mat: 'skin' },
  { key: 'hair', geo: () => hairShell(), color: 'hair', mat: 'hair' },
  { key: 'long', geo: () => merge(ellipsoid(0.088, 0.15, 0.045, 0.1, -0.088, 12, 8)), color: 'hair', mat: 'hair', flag: 'long' },
  { key: 'bun', geo: () => merge(ellipsoid(0.056, 0.052, 0.048, 0.16, -0.12)), color: 'hair', mat: 'hair', flag: 'bun' },
  { key: 'turban', geo: turban, color: 'extra', flag: 'turban' },
  { key: 'cap', geo: () => merge(ellipsoid(0.072, 0.05, 0.122, 0.272, -0.01, 12, 6)), color: 'cap', flag: 'cap' },
  { key: 'beard', geo: () => merge(ellipsoid(0.084, 0.072, 0.07, 0.11, 0.045, 12, 7)), color: 'hair', mat: 'hair', flag: 'beard' },
  { key: 'moustache', geo: () => merge(ellipsoid(0.031, 0.008, 0.012, 0.141, 0.1, 10, 5)), color: 'hair', mat: 'hair', flag: 'moustache' },
  { key: 'torso', geo: torso, color: 'shirt' },
  { key: 'hips', geo: hips, color: 'pants' },
  { key: 'skirt', geo: () => skirt(0.86, 0.18, 0.28), color: 'extra', flag: 'skirt' },
  { key: 'kurta', geo: () => skirt(0.44, 0.19, 0.235), color: 'shirt', flag: 'kurta' },
  { key: 'pack', geo: pack, color: 'extra', flag: 'pack' },
  { key: 'upperArm', geo: () => limb(0.29, [[0, 0.058], [0.3, 0.054], [0.65, 0.048], [1, 0.043]], 0.94), color: 'sleeve', count: 2 },
  { key: 'lowerArm', geo: hand, color: 'skin', mat: 'skin', count: 2 },
  { key: 'thigh', geo: () => limb(0.43, [[0, 0.086], [0.3, 0.079], [0.72, 0.063], [1, 0.055]], 0.95), color: 'pants', count: 2 },
  { key: 'shin', geo: () => limb(0.42, [[0, 0.054], [0.25, 0.059], [0.7, 0.045], [1, 0.039]], 0.95), color: 'legs', count: 2 },
  { key: 'foot', geo: shoe, color: 'shoes', count: 2 },
];

// ------------------------------------------------------------------ outfits
const SKIN = [0x8d5524, 0xa0672c, 0xb5753d, 0xc68642, 0x7a4a24, 0xc98e5a, 0x9b6a40];
const HAIR = [0x16110d, 0x1f1712, 0x2b2118, 0x16110d, 0x777777];
const SHIRTS = [0xf2f2f2, 0x6f9fd8, 0xd9534f, 0x5cb85c, 0xf0ad4e, 0x8e6bbf, 0x2c3e50, 0xe8d8b0, 0x1abc9c, 0xc0392b, 0x34495e, 0xd5d8dc];
const PANTS = [0x2c3e50, 0x1b2631, 0x5d4e37, 0x7f8c8d, 0x34495e, 0x212f3d, 0x1f3a5f];
const SARIS = [0xc0392b, 0xe67e22, 0x8e44ad, 0x16a085, 0xd35400, 0xe84393, 0xf1c40f, 0x2980b9, 0x27ae60, 0xb03a2e];
const TURBANS = [0x1f3a93, 0xff8c1a, 0xf2f2f2, 0x111111, 0x7d1d3f, 0x2e86c1, 0xf1c40f];

/**
 * Outfit by kind: 'man', 'woman', 'sikh', 'student', 'elder', 'farmer', 'police', 'goon', 'player', 'friend'.
 */
export function makeOutfit(kind, seed) {
  const r = rng(seed);
  const o = {
    skin: r.pick(SKIN), hair: r.pick(HAIR), shirt: r.pick(SHIRTS), pants: r.pick(PANTS), shoes: r.pick([0x2b1d14, 0x3b2a1e, 0x111111, 0x6b4a2b]),
    extra: 0, cap: 0xf2f2f2, flags: new Set(), scale: r.range(0.88, 0.98), kind, brow: 0x1a120c,
  };
  o.sleeve = o.shirt; o.legs = o.pants;
  // A Marathwada moustache is the rule, not the exception.
  if ((kind === 'man' || kind === 'elder' || kind === 'farmer' || kind === 'police' || kind === 'goon') && r.chance(0.6)) o.flags.add('moustache');
  switch (kind) {
    case 'woman':
      o.flags.add('skirt'); o.flags.add(r.chance(0.6) ? 'bun' : 'long'); o.extra = r.pick(SARIS); o.shirt = r.chance(0.6) ? o.extra : r.pick(SARIS); o.sleeve = o.shirt;
      o.pants = o.extra; o.legs = o.skin; o.scale *= 0.94; o.hair = 0x16110d;
      if (r.chance(0.35)) { o.flags.delete('skirt'); o.flags.add('kurta'); o.pants = r.pick([0xf2f2f2, 0x2c3e50, o.extra]); o.legs = o.pants; }
      break;
    case 'sikh':
      o.flags.add('turban'); o.flags.add('beard'); o.extra = r.pick(TURBANS); o.hair = 0x16110d;
      if (r.chance(0.6)) { o.flags.add('kurta'); o.shirt = r.pick([0xf2f2f2, 0xe8d8b0, 0x2c3e50, 0x7fb3d5]); o.sleeve = o.shirt; o.pants = 0xf2f2f2; o.legs = o.pants; }
      break;
    case 'student':
      o.flags.add('pack'); o.extra = r.pick([0x1f3a93, 0x111111, 0xc0392b, 0x16a085, 0x7d3c98]); o.pants = r.pick([0x1f3a5f, 0x2c3e50, 0x7f8c8d]); o.legs = o.pants;
      if (r.chance(0.45)) { o.flags.add('kurta'); o.flags.add('bun'); o.shirt = r.pick(SARIS); o.sleeve = o.shirt; o.pants = r.pick([0xf2f2f2, 0x2c3e50]); o.legs = o.pants; o.scale *= 0.95; }
      break;
    case 'elder':
      o.flags.add('kurta'); o.flags.add('cap'); o.shirt = 0xf4f1e8; o.sleeve = o.shirt; o.pants = 0xf4f1e8; o.legs = o.pants; o.hair = 0x9a9a9a; o.cap = 0xfafafa;
      break;
    case 'farmer':
      o.flags.add('turban'); o.extra = r.pick([0xf4f1e8, 0xff8c1a, 0xe74c3c]); o.shirt = r.pick([0xf4f1e8, 0xe8d8b0]); o.sleeve = o.shirt; o.pants = 0xf4f1e8; o.legs = o.skin;
      break;
    case 'police':
      o.shirt = 0xb39b6b; o.sleeve = o.shirt; o.pants = 0xa48d5f; o.legs = o.pants; o.flags.add('cap'); o.cap = 0x1f2a44; o.shoes = 0x111111;
      break;
    case 'goon':
      o.shirt = r.pick([0x111111, 0xffffff, 0x8e1b1b]); o.sleeve = o.shirt; o.pants = r.pick([0x111111, 0x1b2631]); o.legs = o.pants;
      break;
    case 'player':
      o.skin = 0xa0672c; o.hair = 0x16110d; o.shirt = 0xe8652e; o.sleeve = 0xe8652e; o.pants = 0x1f3a5f; o.legs = o.pants; o.shoes = 0xf2f2f2; o.scale = 0.96;
      o.flags.delete('moustache'); o.flags.add('stubble');
      break;
    default:
      if (r.chance(0.25)) { o.flags.add('kurta'); o.pants = r.pick([0xf2f2f2, o.pants]); o.legs = o.pants; }
      if (r.chance(0.12)) { o.flags.add('cap'); o.cap = 0xfafafa; }
  }
  if (o.sleeve === o.shirt && r.chance(0.35) && kind !== 'police' && kind !== 'elder') o.sleeve = o.skin; // short sleeves
  return o;
}

// ------------------------------------------------------------------ renderer
/**
 * Whether something at (x, y, z), give or take `margin` metres, falls inside the sun's shadow
 * map (Sky.shadowBox: its centre and the sun camera's axes). With no box, everything does.
 */
export function inShadowBox(b, x, y, z, margin) {
  if (!b) return true;
  const rx = x - b.cx, rz = z - b.cz, lim = b.half + margin;
  return Math.abs(rx * b.xx + rz * b.xz) <= lim && Math.abs(rx * b.yx + y * b.yy + rz * b.yz) <= lim;
}
const _m = new THREE.Matrix4(), _root = new THREE.Matrix4(), _hip = new THREE.Matrix4(), _torso = new THREE.Matrix4();
const _a = new THREE.Matrix4(), _b = new THREE.Matrix4(), _e = new THREE.Euler(), _c = new THREE.Color();
const _q = new THREE.Quaternion(), _v = new THREE.Vector3(), _s = new THREE.Vector3(1, 1, 1);

function local(out, x, y, z, rx = 0, ry = 0, rz = 0) {
  _e.set(rx, ry, rz, 'XYZ');
  out.makeRotationFromEuler(_e);
  out.elements[12] = x; out.elements[13] = y; out.elements[14] = z;
  return out;
}

export class Humans {
  constructor(scene, capacity = 200) {
    this.capacity = capacity;
    this.list = [];
    this.meshes = {};
    const mats = {
      cloth: new THREE.MeshStandardMaterial({ roughness: 0.86, metalness: 0 }),
      skin: new THREE.MeshStandardMaterial({ roughness: 0.55, metalness: 0 }),
      hair: new THREE.MeshStandardMaterial({ roughness: 0.42, metalness: 0 }),
    };
    for (const p of PARTS) {
      const n = capacity * (p.count || 1);
      const mesh = new THREE.InstancedMesh(p.geo(), mats[p.mat || 'cloth'], n);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.setColorAt(0, _c.set(0xffffff));
      mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
      mesh.count = 0;
      mesh.castShadow = true;
      mesh.frustumCulled = false;
      mesh.name = `human-${p.key}`;
      scene.add(mesh);
      const entry = (this.meshes[p.key] = { mesh, part: p, n: 0, nShadow: 0 });
      mesh.onBeforeShadow = () => { mesh.count = entry.nShadow; };
      mesh.onAfterShadow = () => { mesh.count = entry.n; };
    }
    this.drawDistance = 140;
  }

  add(outfit, x = 0, z = 0) {
    const h = {
      outfit, x, y: 0, z, yaw: 0, pose: 'idle', phase: Math.random() * 6.28, speed: 0, t: 0,
      pitch: 0, roll: 0, visible: true, punch: 0, wave: 0, lookYaw: 0, seatY: 0, armsUp: 0,
    };
    this.list.push(h);
    return h;
  }
  remove(h) { const i = this.list.indexOf(h); if (i >= 0) this.list.splice(i, 1); }

  /** Advance walk phases and write every visible body part's instance. */
  update(dt, cam, shadowBox) {
    for (const k in this.meshes) this.meshes[k].n = 0;
    const maxD2 = this.drawDistance * this.drawDistance;
    let drawn = 0;
    // People inside the sun's shadow map are written first; the shadow pass then draws only
    // that leading run of each part's instances instead of everyone in view.
    for (let pass = 0; pass < 2; pass++) {
      for (const h of this.list) {
        if (!h.visible) continue;
        const dx = h.x - cam.x, dz = h.z - cam.z, d2 = dx * dx + dz * dz;
        if (d2 > maxD2 || (pass === 0) !== inShadowBox(shadowBox, h.x, h.y, h.z, 2.5)) continue;
        if (drawn >= this.capacity) break;
        drawn++;
        // Stride ~1.35 m per cycle walking, longer running.
        const stride = h.speed > 3.2 ? 2.4 : 1.35;
        h.phase += (h.speed / stride) * Math.PI * 2 * dt;
        this._pose(h, d2 > 3600);
      }
      if (pass === 0) for (const k in this.meshes) this.meshes[k].nShadow = this.meshes[k].n;
    }
    for (const k in this.meshes) {
      const m = this.meshes[k];
      m.mesh.count = m.n;
      m.mesh.instanceMatrix.needsUpdate = true;
      if (m.mesh.instanceColor) m.mesh.instanceColor.needsUpdate = true;
    }
  }

  _emit(key, matrix, colorHex) {
    const m = this.meshes[key];
    if (m.n >= m.mesh.instanceMatrix.count) return;
    m.mesh.setMatrixAt(m.n, matrix);
    m.mesh.setColorAt(m.n, _c.setHex(colorHex));
    m.n++;
  }

  _pose(h, far) {
    const o = h.outfit, f = o.flags, sc = o.scale;
    // Joint angles for the current pose.
    let hipL = 0, hipR = 0, kneeL = 0.04, kneeR = 0.04, shL = 0.05, shR = 0.05, abL = 0.13, abR = -0.13, elL = -0.3, elR = -0.3;
    let lean = 0, bob = 0, pelvisY = 0.93, twist = 0, headYaw = h.lookYaw || 0;
    const ph = h.phase, sp = h.speed;
    switch (h.pose) {
      case 'walk': case 'run': {
        const run = sp > 3.2;
        const amp = run ? 0.82 : clamp(sp / 1.5, 0.2, 1) * (f.has('skirt') ? 0.32 : 0.48);
        const s1 = Math.sin(ph), c1 = Math.cos(ph);
        hipL = -s1 * amp; hipR = s1 * amp;
        kneeL = Math.max(0, c1) * (run ? 1.5 : 0.75) + 0.05; kneeR = Math.max(0, -c1) * (run ? 1.5 : 0.75) + 0.05;
        shL = s1 * (run ? 0.9 : 0.42); shR = -s1 * (run ? 0.9 : 0.42);
        elL = run ? -1.3 : -0.25; elR = elL;
        bob = Math.abs(c1) * (run ? 0.07 : 0.03);
        lean = run ? 0.2 : 0.03;
        break;
      }
      case 'sit': // car driver / passenger
        hipL = hipR = -1.45; kneeL = kneeR = 1.35; shL = shR = -0.95; elL = elR = -0.55; pelvisY = h.seatY || 0.55; abL = 0.05; abR = -0.05;
        break;
      case 'ride': // motorbike / scooter
        hipL = hipR = -1.15; kneeL = kneeR = 1.2; shL = shR = -1.05; elL = elR = -0.25; lean = 0.22; pelvisY = h.seatY || 0.82; abL = 0.15; abR = -0.15;
        break;
      case 'lie':
        hipL = 0.05; hipR = -0.05; abL = 1.1; abR = -1.1; elL = elR = -0.2; pelvisY = 0.15;
        break;
      case 'cower':
        hipL = hipR = -1.2; kneeL = kneeR = 2.1; shL = shR = -2.4; elL = elR = -2.0; lean = 0.5; pelvisY = 0.5;
        break;
      case 'wave': {
        const w = Math.sin(h.t * 9) * 0.25;
        shR = -2.7; abR = -0.25 + w; elR = -0.35;
        break;
      }
      case 'phone':
        shR = -0.4; abR = -0.2; elR = -2.3;
        break;
      default: { // idle: breathing, weight on one leg
        const br = Math.sin(h.t * 1.7 + ph) * 0.02;
        shL = 0.05 + br; shR = 0.05 - br; bob = br * 0.3;
        hipL = 0.05; kneeL = 0.12; hipR = -0.03;
      }
    }
    if (h.punch > 0) {
      // Jab: right arm drives forward, torso twists into it.
      const p = Math.sin(clamp(h.punch, 0, 1) * Math.PI);
      shR = -1.55 * p + shR * (1 - p); elR = -0.1 * p + elR * (1 - p); abR = -0.05; twist = -0.35 * p;
    }
    if (h.armsUp > 0) { shL = shR = -2.9 * h.armsUp; elL = elR = -0.2; }

    // Root: ground position, heading, and any fall pitch/roll.
    _e.set(h.pitch || 0, h.yaw, h.roll || 0, 'YXZ');
    _q.setFromEuler(_e);
    _v.set(h.x, h.y + (pelvisY + bob) * sc, h.z);
    _s.set(sc, sc, sc);
    _root.compose(_v, _q, _s);
    // Hips.
    _hip.copy(_root);
    this._emit('hips', _hip, o.pants);
    if (f.has('skirt')) this._emit('skirt', _hip, o.extra);
    if (f.has('kurta')) this._emit('kurta', _hip, o.shirt);
    // Torso.
    _torso.multiplyMatrices(_hip, local(_a, 0, 0.06, 0, lean, twist, 0));
    this._emit('torso', _torso, o.shirt);
    if (f.has('pack')) this._emit('pack', _torso, o.extra);
    _m.multiplyMatrices(_torso, local(_a, 0, 0.53, 0, -lean * 0.5, headYaw, 0));
    this._emit('head', _m, o.skin);
    this._emit('face', _m, o.brow);
    if (f.has('turban')) this._emit('turban', _m, o.extra);
    else { this._emit('hair', _m, o.hair); if (f.has('bun')) this._emit('bun', _m, o.hair); if (f.has('long')) this._emit('long', _m, o.hair); }
    if (f.has('beard')) this._emit('beard', _m, o.hair);
    if (f.has('moustache') && !f.has('beard')) this._emit('moustache', _m, o.hair);
    if (f.has('cap')) this._emit('cap', _m, o.cap);
    if (far) return; // limbs are a few pixels at range: skip them
    // Arms.
    for (const [sx, sh, ab, el] of [[0.235, shL, abL, elL], [-0.235, shR, abR, elR]]) {
      _a.multiplyMatrices(_torso, local(_b, sx, 0.47, 0, sh, 0, ab));
      this._emit('upperArm', _a, o.sleeve);
      _m.multiplyMatrices(_a, local(_b, 0, -0.29, 0, el, 0, 0));
      this._emit('lowerArm', _m, o.skin);
    }
    // Legs.
    for (const [sx, hip, knee] of [[0.095, hipL, kneeL], [-0.095, hipR, kneeR]]) {
      _a.multiplyMatrices(_hip, local(_b, sx, -0.04, 0, hip, 0, 0));
      this._emit('thigh', _a, o.pants);
      _m.multiplyMatrices(_a, local(_b, 0, -0.43, 0, knee, 0, 0));
      this._emit('shin', _m, o.legs);
      _a.multiplyMatrices(_m, local(_b, 0, -0.42, 0, -knee * 0.5 - hip * 0.3, 0, 0));
      this._emit('foot', _a, o.shoes);
    }
  }
}
