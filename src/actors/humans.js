// Every person in the city is drawn by one instanced mesh with a procedural skeleton:
// one draw call for all pedestrians, drivers, riders, police and the player, whatever
// their number. The processor poses the bones; the graphics chip bends the body to them.
import * as THREE from 'three';
import { rng, clamp } from '../core/math.js';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { radialTexture } from '../world/citymat.js';
import { sendFirst } from '../core/buffers.js';
import { animate, C, BODY } from './anim.js';

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

// The skeleton's bones; every part hangs from one (the limbs from one each side). A sari or kurta
// hangs from its own, which follows the thighs.
const BONES = ['hips', 'torso', 'head', 'upperArmL', 'lowerArmL', 'upperArmR', 'lowerArmR', 'thighL', 'shinL', 'footL', 'thighR', 'shinR', 'footR', 'skirt'];
// Parts only some people have, and the limbs (skipped at range): bits of each person's mask.
const SHOW = { hair: 1, long: 2, bun: 4, turban: 8, cap: 16, beard: 32, moustache: 64, skirt: 128, kurta: 256, pack: 512, limbs: 1024 };
const PARTS = [
  { key: 'head', geo: head, color: 'skin', mat: 'skin', bones: ['head'] },
  { key: 'face', geo: face, color: 'brow', mat: 'skin', bones: ['head'] },
  { key: 'hair', geo: () => hairShell(), color: 'hair', mat: 'hair', bones: ['head'], show: SHOW.hair },
  { key: 'long', geo: () => merge(ellipsoid(0.088, 0.15, 0.045, 0.1, -0.088, 12, 8)), color: 'hair', mat: 'hair', bones: ['head'], show: SHOW.long },
  { key: 'bun', geo: () => merge(ellipsoid(0.056, 0.052, 0.048, 0.16, -0.12)), color: 'hair', mat: 'hair', bones: ['head'], show: SHOW.bun },
  { key: 'turban', geo: turban, color: 'extra', bones: ['head'], show: SHOW.turban },
  { key: 'cap', geo: () => merge(ellipsoid(0.072, 0.05, 0.122, 0.272, -0.01, 12, 6)), color: 'cap', bones: ['head'], show: SHOW.cap },
  { key: 'beard', geo: () => merge(ellipsoid(0.084, 0.072, 0.07, 0.11, 0.045, 12, 7)), color: 'hair', mat: 'hair', bones: ['head'], show: SHOW.beard },
  { key: 'moustache', geo: () => merge(ellipsoid(0.031, 0.008, 0.012, 0.141, 0.1, 10, 5)), color: 'hair', mat: 'hair', bones: ['head'], show: SHOW.moustache },
  { key: 'torso', geo: torso, color: 'shirt', bones: ['torso'] },
  { key: 'hips', geo: hips, color: 'pants', bones: ['hips'] },
  { key: 'skirt', geo: () => skirt(0.86, 0.18, 0.28), color: 'extra', bones: ['skirt'], show: SHOW.skirt },
  { key: 'kurta', geo: () => skirt(0.44, 0.19, 0.235), color: 'shirt', bones: ['skirt'], show: SHOW.kurta },
  { key: 'pack', geo: pack, color: 'extra', bones: ['torso'], show: SHOW.pack },
  { key: 'upperArm', geo: () => limb(0.29, [[0, 0.058], [0.3, 0.054], [0.65, 0.048], [1, 0.043]], 0.94), color: 'sleeve', bones: ['upperArmL', 'upperArmR'], show: SHOW.limbs },
  { key: 'lowerArm', geo: hand, color: 'skin', mat: 'skin', bones: ['lowerArmL', 'lowerArmR'], show: SHOW.limbs },
  { key: 'thigh', geo: () => limb(0.43, [[0, 0.086], [0.3, 0.079], [0.72, 0.063], [1, 0.055]], 0.95), color: 'pants', bones: ['thighL', 'thighR'], show: SHOW.limbs },
  { key: 'shin', geo: () => limb(0.42, [[0, 0.054], [0.25, 0.059], [0.7, 0.045], [1, 0.039]], 0.95), color: 'legs', bones: ['shinL', 'shinR'], show: SHOW.limbs },
  { key: 'foot', geo: shoe, color: 'shoes', bones: ['footL', 'footR'], show: SHOW.limbs },
];
const EXTRAS = ['cap', 'skirt', 'kurta', 'pack'];
// Each person's colours, in the order the shader reads them, and how glossy each material is.
const SLOTS = ['skin', 'brow', 'hair', 'extra', 'cap', 'shirt', 'pants', 'sleeve', 'legs', 'shoes'];
const ROUGH = { cloth: 0.86, skin: 0.55, hair: 0.42 };

/**
 * Every part of the body in one mesh. Each vertex knows its bone, its colour slot, the mask
 * bit that shows it (0: always) and its roughness; welded back to indexed triangles.
 */
function crowdGeometry() {
  const pos = [], nrm = [], tag = [];
  for (const p of PARTS) {
    const g0 = p.geo(), g = g0.index ? g0.toNonIndexed() : g0;
    const P = g.attributes.position.array, N = g.attributes.normal.array;
    for (const bone of p.bones) {
      for (let i = 0; i < P.length; i++) { pos.push(P[i]); nrm.push(N[i]); }
      for (let i = 0; i < P.length / 3; i++) tag.push(BONES.indexOf(bone), SLOTS.indexOf(p.color), p.show || 0, ROUGH[p.mat || 'cloth']);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  geo.setAttribute('crowdPart', new THREE.Float32BufferAttribute(tag, 4));
  return mergeVertices(geo);
}

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
/** A shadow box nothing falls inside: for a shadow map that doesn't refresh with moving actors. */
export const NO_SHADOW_BOX = { half: -Infinity, cx: 0, cz: 0, xx: 1, xz: 0, yx: 0, yy: 1, yz: 0 };

/**
 * Whether something at (x, y, z), give or take `margin` metres, falls inside the sun's shadow
 * map (Sky.shadowBox: its centre and the sun camera's axes). With no box, everything does.
 */
export function inShadowBox(b, x, y, z, margin) {
  if (!b) return true;
  const rx = x - b.cx, rz = z - b.cz, lim = b.half + margin;
  return Math.abs(rx * b.xx + rz * b.xz) <= lim && Math.abs(rx * b.yx + y * b.yy + rz * b.yz) <= lim;
}
const _m = new THREE.Matrix4(), _e = new THREE.Euler();
const _q = new THREE.Quaternion(), _v = new THREE.Vector3(), _s = new THREE.Vector3(1, 1, 1);

// Bones are 3x4 affine matrices, row-major, as the crowd texture stores them:
// [r00 r01 r02 tx | r10 r11 r12 ty | r20 r21 r22 tz].
const _root = new Float32Array(12), _l = new Float32Array(12);
/** A rotation from Euler angles in three.js's YXZ order (yaw, then pitch, then roll). */
function rotYXZ(m, x, y, z) {
  const a = Math.cos(x), b = Math.sin(x), c = Math.cos(y), d = Math.sin(y), e = Math.cos(z), f = Math.sin(z);
  const ce = c * e, cf = c * f, de = d * e, df = d * f;
  m[0] = ce + df * b; m[1] = de * b - cf; m[2] = a * d;
  m[4] = a * f; m[5] = a * e; m[6] = -b;
  m[8] = cf * b - de; m[9] = df + ce * b; m[10] = a * c;
  return m;
}
/** A rotation from Euler angles in XZY order (limbs: a twist about the limb, then abduction, then flexion). */
function rotXZY(m, x, y, z) {
  const a = Math.cos(x), b = Math.sin(x), c = Math.cos(y), d = Math.sin(y), e = Math.cos(z), f = Math.sin(z);
  const ac = a * c, ad = a * d, bc = b * c, bd = b * d;
  m[0] = c * e; m[1] = -f; m[2] = d * e;
  m[4] = ac * f + bd; m[5] = a * e; m[6] = ad * f - bc;
  m[8] = bc * f - ad; m[9] = b * e; m[10] = bd * f + ac;
  return m;
}
/** A hinge (knee, elbow, ankle). */
function rotX(m, x) {
  const c = Math.cos(x), s = Math.sin(x);
  m[0] = 1; m[1] = 0; m[2] = 0; m[4] = 0; m[5] = c; m[6] = -s; m[8] = 0; m[9] = s; m[10] = c;
  return m;
}
/** d at o = the parent bone (p at po) carrying rotation l at (x, y, z) in its frame. */
function bone(d, o, p, po, l, x, y, z) {
  const a0 = p[po], a1 = p[po + 1], a2 = p[po + 2], a3 = p[po + 3], a4 = p[po + 4], a5 = p[po + 5];
  const a6 = p[po + 6], a7 = p[po + 7], a8 = p[po + 8], a9 = p[po + 9], a10 = p[po + 10], a11 = p[po + 11];
  const b0 = l[0], b1 = l[1], b2 = l[2], b4 = l[4], b5 = l[5], b6 = l[6], b8 = l[8], b9 = l[9], b10 = l[10];
  d[o] = a0 * b0 + a1 * b4 + a2 * b8; d[o + 1] = a0 * b1 + a1 * b5 + a2 * b9; d[o + 2] = a0 * b2 + a1 * b6 + a2 * b10; d[o + 3] = a0 * x + a1 * y + a2 * z + a3;
  d[o + 4] = a4 * b0 + a5 * b4 + a6 * b8; d[o + 5] = a4 * b1 + a5 * b5 + a6 * b9; d[o + 6] = a4 * b2 + a5 * b6 + a6 * b10; d[o + 7] = a4 * x + a5 * y + a6 * z + a7;
  d[o + 8] = a8 * b0 + a9 * b4 + a10 * b8; d[o + 9] = a8 * b1 + a9 * b5 + a10 * b9; d[o + 10] = a8 * b2 + a9 * b6 + a10 * b10; d[o + 11] = a8 * x + a9 * y + a10 * z + a11;
}

// Each person's row in the crowd's data texture: three texels (a 3x4 matrix) per bone, then
// four of colours, each carrying the person's mask in its last channel.
const BLOCK = BONES.length * 3 + 4;
const B = Object.fromEntries(BONES.map((k, i) => [k, i]));

// The crowd shader: pose each vertex by its bone, colour it from its slot, and fold away
// the parts a person doesn't have (their triangles collapse to a point and never draw).
const CROWD_PARS = /* glsl */`
uniform highp sampler2D crowdData;
attribute vec4 crowdPart;
varying vec3 vCrowdColor;
varying float vCrowdRough;
`;
const CROWD_FETCH = /* glsl */`
ivec2 crowdAt = ivec2(0, gl_InstanceID);
int crowdBone = int(crowdPart.x) * 3, crowdSlot = int(crowdPart.y), crowdShow = int(crowdPart.z);
vec4 crowdR0 = texelFetch(crowdData, crowdAt + ivec2(crowdBone, 0), 0);
vec4 crowdR1 = texelFetch(crowdData, crowdAt + ivec2(crowdBone + 1, 0), 0);
vec4 crowdR2 = texelFetch(crowdData, crowdAt + ivec2(crowdBone + 2, 0), 0);
vec4 crowdC = texelFetch(crowdData, crowdAt + ivec2(${BONES.length * 3} + crowdSlot / 3, 0), 0);
float crowdOn = crowdShow == 0 || (int(crowdC.w) & crowdShow) != 0 ? 1.0 : 0.0;
`;
const CROWD_POSITION = /* glsl */`
transformed = crowdOn * vec3(dot(crowdR0, vec4(transformed, 1.0)), dot(crowdR1, vec4(transformed, 1.0)), dot(crowdR2, vec4(transformed, 1.0)));
`;
const CROWD_NORMAL = /* glsl */`
objectNormal = vec3(dot(crowdR0.xyz, objectNormal), dot(crowdR1.xyz, objectNormal), dot(crowdR2.xyz, objectNormal));
float crowdHex = floor((crowdSlot % 3 == 0 ? crowdC.x : crowdSlot % 3 == 1 ? crowdC.y : crowdC.z) + 0.5);
vec3 crowdRgb = vec3(floor(crowdHex / 65536.0), mod(floor(crowdHex / 256.0), 256.0), mod(crowdHex, 256.0)) / 255.0;
vCrowdColor = mix(crowdRgb * 0.0773993808, pow(crowdRgb * 0.9478672986 + 0.0521327014, vec3(2.4)), step(0.04045, crowdRgb));
vCrowdRough = crowdPart.w;
`;

export class Humans {
  constructor(scene, capacity = 200) {
    this.capacity = capacity;
    this.list = [];
    // Everyone is one instanced mesh: one draw call for the whole crowd. The processor poses
    // each skeleton and writes the bones into a float texture, a row per person; only the
    // rows in use are sent (see _send).
    this.data = new Float32Array(BLOCK * capacity * 4);
    this.tex = new THREE.DataTexture(this.data, BLOCK, capacity, THREE.RGBAFormat, THREE.FloatType);
    this.tex.minFilter = this.tex.magFilter = THREE.NearestFilter;
    this.tex.generateMipmaps = false;
    this.tex.needsUpdate = true;
    const uniform = { value: this.tex };
    const mat = new THREE.MeshStandardMaterial({ metalness: 0 });
    mat.onBeforeCompile = sh => {
      sh.uniforms.crowdData = uniform;
      sh.vertexShader = CROWD_PARS + sh.vertexShader
        .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\n' + CROWD_FETCH + CROWD_NORMAL)
        .replace('#include <begin_vertex>', '#include <begin_vertex>\n' + CROWD_POSITION);
      sh.fragmentShader = 'varying vec3 vCrowdColor;\nvarying float vCrowdRough;\n' + sh.fragmentShader
        .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb *= vCrowdColor;')
        .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = vCrowdRough;');
    };
    mat.customProgramCacheKey = () => 'crowd';
    // The sun's shadow map draws the same poses.
    const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
    depth.onBeforeCompile = sh => {
      sh.uniforms.crowdData = uniform;
      sh.vertexShader = CROWD_PARS + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n' + CROWD_FETCH + CROWD_POSITION);
    };
    depth.customProgramCacheKey = () => 'crowd-depth';
    const body = crowdGeometry(), geo = new THREE.InstancedBufferGeometry();
    geo.setIndex(body.index);
    for (const k in body.attributes) geo.setAttribute(k, body.attributes[k]);
    geo.instanceCount = 0;
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.customDepthMaterial = depth;
    this.mesh.castShadow = true;
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    this.mesh.name = 'human-crowd';
    this.n = 0; this.nShadow = 0;
    // The shadow pass draws only the leading run of people inside the sun's shadow map.
    // Whichever pass comes first sends this frame's rows.
    this.mesh.onBeforeShadow = r => { this._send(r); geo.instanceCount = this.nShadow; };
    this.mesh.onAfterShadow = () => { geo.instanceCount = this.n; };
    this.mesh.onBeforeRender = r => this._send(r);
    scene.add(this.mesh);
    // A soft patch of shade under everyone on their feet, for settings whose shadow map doesn't
    // follow moving people (without it they float). One draw call for the whole crowd.
    const plane = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    this.blobs = new THREE.InstancedMesh(plane, new THREE.MeshBasicMaterial({ map: radialTexture(64), color: 0x000000, transparent: true, opacity: 0.55, depthWrite: false }), capacity);
    this.blobs.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.blobs.count = 0; this.blobs.frustumCulled = false; this.blobs.renderOrder = 1;
    this.blobs.material.polygonOffset = true; this.blobs.material.polygonOffsetFactor = -1; this.blobs.material.polygonOffsetUnits = -2;
    this.blobs.name = 'human-shade';
    scene.add(this.blobs);
    this.blobsOn = true;
    this.drawDistance = 140;
  }

  add(outfit, x = 0, z = 0) {
    const h = {
      outfit, x, y: 0, z, yaw: 0, pose: 'idle', speed: 0, t: 0,
      pitch: 0, roll: 0, visible: true, punch: 0, lookYaw: 0, seatY: 0, armsUp: 0, air: false, vy: 0, guard: 0,
    };
    this.list.push(h);
    return h;
  }
  remove(h) { const i = this.list.indexOf(h); if (i >= 0) this.list.splice(i, 1); }

  /** Move everyone in view on (anim.js) and write their bones and colours. */
  update(dt, cam, shadowBox) {
    const maxD2 = this.drawDistance * this.drawDistance, blobD2 = 60 * 60;
    let n = 0, blobs = 0;
    // People inside the sun's shadow map are written first; the shadow pass then draws only
    // that leading run instead of everyone in view.
    for (let pass = 0; pass < 2; pass++) {
      for (const h of this.list) {
        if (!h.visible) continue;
        const dx = h.x - cam.x, dz = h.z - cam.z, d2 = dx * dx + dz * dz;
        if (d2 > maxD2 || (pass === 0) !== inShadowBox(shadowBox, h.x, h.y, h.z, 2.5)) continue;
        if (n >= this.capacity) break;
        // Close up the whole body moves; a street away hands stay off handlebars; far off only the body shows.
        this._at = n * BLOCK * 4;
        animate(h, dt, d2 > 3600 ? 2 : d2 > 900 ? 1 : 0);
        this._pose(h, d2 > 3600);
        n++;
        // Seated riders and drivers are covered by their vehicle's shade.
        if (this.blobsOn && d2 < blobD2 && h.pose !== 'sit' && h.pose !== 'ride') {
          const lying = h.pose === 'lie', s = h.outfit.scale || 1, A = h.anim, mid = A.out[C.RZ] * 0.5 * s;
          _e.set(0, h.yaw, 0); _q.setFromEuler(_e);
          // Under the body, which lies off its feet's spot; above the road surface (6-7 cm).
          _v.set(h.x + A.root.x + Math.sin(h.yaw) * mid, h.y + A.root.y + 0.09, h.z + A.root.z + Math.cos(h.yaw) * mid);
          _s.set((lying ? 1.1 : 1.35) * s, 1, (lying ? 2.3 : 1.35) * s);
          this.blobs.setMatrixAt(blobs++, _m.compose(_v, _q, _s));
          _s.set(1, 1, 1);
        }
      }
      if (pass === 0) this.nShadow = n;
    }
    this.n = n;
    this.mesh.geometry.instanceCount = n;
    this.mesh.visible = n > 0;
    this.dirty = n > 0;
    this.blobs.count = blobs;
    this.blobs.visible = blobs > 0;
    sendFirst(this.blobs.instanceMatrix, blobs);
  }

  /**
   * Send the rows in use to the graphics chip, once a frame. three.js would send the whole
   * texture, or ask the GPU for its unpack state before each partial upload (a stall in Chrome),
   * so after three.js has made the texture this writes the rows itself, in one call.
   */
  _send(renderer) {
    if (!this.dirty) return;
    this.dirty = false;
    const t = renderer.properties.get(this.tex).__webglTexture;
    if (!t) { this.tex.needsUpdate = true; return; } // first frame: three.js uploads it all
    const gl = renderer.getContext();
    renderer.state.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    gl.pixelStorei(gl.UNPACK_ROW_LENGTH, 0); gl.pixelStorei(gl.UNPACK_SKIP_PIXELS, 0); gl.pixelStorei(gl.UNPACK_SKIP_ROWS, 0);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, BLOCK, this.n, gl.RGBA, gl.FLOAT, this.data, 0);
  }

  _pose(h, far) {
    const o = h.outfit, f = o.flags, sc = o.scale;
    // Colours, and which of the optional parts this person shows.
    const d = this.data, at = this._at + BONES.length * 12;
    let mask = f.has('turban') ? SHOW.turban : SHOW.hair | (f.has('bun') ? SHOW.bun : 0) | (f.has('long') ? SHOW.long : 0);
    if (f.has('beard')) mask |= SHOW.beard; else if (f.has('moustache')) mask |= SHOW.moustache;
    for (const k of EXTRAS) if (f.has(k)) mask |= SHOW[k];
    if (!far) mask |= SHOW.limbs; // limbs are a few pixels at range: skip them
    for (let k = 0; k < 4; k++) {
      d[at + k * 4] = o[SLOTS[k * 3]] ?? 0; d[at + k * 4 + 1] = o[SLOTS[k * 3 + 1]] ?? 0; d[at + k * 4 + 2] = o[SLOTS[k * 3 + 2]] ?? 0;
      d[at + k * 4 + 3] = mask;
    }
    // The bones, from this frame's pose (anim.js).
    const A = h.anim, P = A.out, R = A.root, row = this._at;
    // Root: on the ground at the person's spot, turned to their heading, the whole body
    // pitched and rolled about the pelvis (falls, and a two-wheeler's lean).
    const yaw = h.yaw + R.yaw, cy = Math.cos(yaw), sy = Math.sin(yaw), m = rotYXZ(_root, P[C.BP], yaw, (h.roll || 0) + P[C.BR]);
    m[0] *= sc; m[1] *= sc; m[2] *= sc; m[4] *= sc; m[5] *= sc; m[6] *= sc; m[8] *= sc; m[9] *= sc; m[10] *= sc;
    m[3] = h.x + R.x + (P[C.RX] * cy + P[C.RZ] * sy) * sc;
    m[7] = h.y + R.y + P[C.PY] * sc;
    m[11] = h.z + R.z + (P[C.RZ] * cy - P[C.RX] * sy) * sc;
    // Pelvis, torso, head.
    bone(d, row + B.hips * 12, m, 0, rotYXZ(_l, P[C.PP], P[C.PW], P[C.PR]), P[C.PX], 0, P[C.PZ]);
    bone(d, row + B.torso * 12, d, row + B.hips * 12, rotYXZ(_l, P[C.TP], P[C.TW], P[C.TR]), 0, BODY.torsoY, 0);
    bone(d, row + B.head * 12, d, row + B.torso * 12, rotYXZ(_l, P[C.HP], P[C.HW], P[C.HR]), 0, BODY.neck, 0);
    // A sari or kurta follows the thighs: out over them when sitting, gathering shorter as it goes.
    const fold = Math.max(0, (P[C.HF] + P[C.HF + 1]) * 0.42), gather = 1 - 0.42 * smooth(0.3, 1.25, fold);
    rotX(_l, -fold); _l[1] *= gather; _l[5] *= gather; _l[9] *= gather;
    bone(d, row + B.skirt * 12, d, row + B.hips * 12, _l, 0, 0, 0);
    if (far) return;
    // Arms: the shoulder comes forward with a reach, and up with an arm raised overhead.
    for (let s = 0; s < 2; s++) {
      const side = s === 0 ? 1 : -1, ua = s === 0 ? B.upperArmL : B.upperArmR, sf = P[C.SF + s];
      bone(d, row + ua * 12, d, row + B.torso * 12, rotXZY(_l, -sf, -side * P[C.ST + s], side * P[C.SA + s]),
        side * BODY.shoulderX, BODY.shoulderY + 0.03 * smooth(1.6, 2.8, sf), 0.035 * clamp(sf / 1.6, -0.4, 1));
      bone(d, row + (ua + 1) * 12, d, row + ua * 12, rotX(_l, -P[C.EL + s]), 0, -BODY.upperArm, 0);
    }
    // Legs: thigh, shin, foot.
    for (let s = 0; s < 2; s++) {
      const side = s === 0 ? 1 : -1, th = s === 0 ? B.thighL : B.thighR;
      bone(d, row + th * 12, d, row + B.hips * 12, rotXZY(_l, -P[C.HF + s], -side * P[C.HT + s], side * P[C.HA + s]), side * BODY.hipX, BODY.hipY, 0);
      bone(d, row + (th + 1) * 12, d, row + th * 12, rotX(_l, P[C.KN + s]), 0, -BODY.thigh, 0);
      bone(d, row + (th + 2) * 12, d, row + (th + 1) * 12, rotX(_l, P[C.AN + s]), 0, -BODY.shin, 0);
    }
  }
}
