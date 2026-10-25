// Procedural people. Two bodies on one skeleton: a detailed one for the people near the camera
// (smooth-skinned limbs that bend at the elbow and knee, faces, hands with fingers, collars,
// saris with a pallu, braids, chappals), and the simpler one everyone further off is drawn with.
// Both are a single mesh holding every part anyone wears; each person's mask shows their own.
import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { BODY } from './anim.js';

// ------------------------------------------------------------------ skeleton and slots
// The skeleton's bones; every part hangs from one (the limbs from one each side). A sari or kurta
// hangs from its own, which follows the thighs.
export const BONES = ['hips', 'torso', 'head', 'upperArmL', 'lowerArmL', 'upperArmR', 'lowerArmR', 'thighL', 'shinL', 'footL', 'thighR', 'shinR', 'footR', 'skirt'];
// Each person's colours, in the order the shader reads them (three to a texel).
export const SLOTS = ['skin', 'brow', 'hair', 'extra', 'cap', 'shirt', 'pants', 'sleeve', 'legs', 'shoes', 'trim'];
// Colours nobody chooses, after the people's own (eyes are painted, these are parts).
export const FIXED = { sole: 0x1d1a18, visor: 0x141414, gold: 0xc9a23a, flower: 0xf6f2e4 };
const FIXED_SLOTS = Object.keys(FIXED);
const slotIndex = s => (SLOTS.includes(s) ? SLOTS.indexOf(s) : 12 + FIXED_SLOTS.indexOf(s));
// Parts only some people have, and the limbs (skipped at range): bits of each person's mask.
// The first eleven serve both bodies; the rest only the detailed one.
export const SHOW = {
  hair: 1, long: 2, bun: 4, turban: 8, cap: 16, beard: 32, moustache: 64, skirt: 128, kurta: 256, pack: 512, limbs: 1024,
  collar: 2048, short: 4096, belt: 8192, chappal: 16384, gajra: 32768, bindi: 65536, stubble: 131072, pheta: 262144,
  pcap: 524288, dupatta: 1048576, shoes: 2097152, topi: 4194304, dastar: 8388608,
};
export const ROUGH = { cloth: 0.86, skin: 0.55, hair: 0.42, leather: 0.5 };
// Parts only women wear, and only men: each of the two detailed bodies leaves the other's out.
export const WOMENS = SHOW.skirt | SHOW.dupatta | SHOW.long | SHOW.bun | SHOW.gajra;
export const MENS = SHOW.beard | SHOW.moustache | SHOW.dastar | SHOW.pheta | SHOW.topi | SHOW.pcap | SHOW.collar | SHOW.belt;
// What the detailed body's fragment shader paints on a part (crowdSkin.z).
export const REGION = { plain: 0, face: 1, shirt: 2, sleeveL: 3, sleeveR: 4, sari: 5, pallu: 6, kurta: 7, dupatta: 8, shoe: 9, belt: 10, pcap: 11, turban: 12, hair: 13, shortL: 14, shortR: 15 };

// Where each bone's joint sits in the bind pose (the hips' frame: y up, +z forward, +x the left).
export const JOINTS = (() => {
  const J = { hips: [0, 0, 0], skirt: [0, 0, 0], torso: [0, BODY.torsoY, 0], head: [0, BODY.torsoY + BODY.neck, 0] };
  for (const [s, side] of [[1, 'L'], [-1, 'R']]) {
    J['upperArm' + side] = [s * BODY.shoulderX, BODY.torsoY + BODY.shoulderY, 0];
    J['lowerArm' + side] = [s * BODY.shoulderX, BODY.torsoY + BODY.shoulderY - BODY.upperArm, 0];
    J['thigh' + side] = [s * BODY.hipX, BODY.hipY, 0];
    J['shin' + side] = [s * BODY.hipX, BODY.hipY - BODY.thigh, 0];
    J['foot' + side] = [s * BODY.hipX, BODY.hipY - BODY.thigh - BODY.shin, 0];
  }
  return J;
})();

const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const gauss = (v, c, w) => Math.exp(-(((v - c) / w) ** 2));

// ------------------------------------------------------------------ the simple body
// Sculpted, smooth-shaded body parts built from lofted rings: a chest wider than
// the waist, sloping shoulders, calves, hands and shoes. Limbs hang from their
// joint at y = 0; the skeleton poses them.
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
    [-0.08, 0.168, 0.112, 0.106], [0.02, 0.157, 0.103, 0.098], [0.045, 0.158, 0.104, 0.098, 0.001], [0.14, 0.161, 0.108, 0.1, 0.004],
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
  { key: 'head', geo: head, color: 'skin', mat: 'skin', bones: ['head'] },
  { key: 'face', geo: face, color: 'brow', mat: 'skin', bones: ['head'] },
  { key: 'hair', geo: () => hairShell(), color: 'hair', mat: 'hair', bones: ['head'], show: SHOW.hair },
  { key: 'long', geo: () => merge(ellipsoid(0.088, 0.15, 0.045, 0.1, -0.088, 12, 8)), color: 'hair', mat: 'hair', bones: ['head'], show: SHOW.long },
  { key: 'bun', geo: () => merge(ellipsoid(0.056, 0.052, 0.048, 0.16, -0.12)), color: 'hair', mat: 'hair', bones: ['head'], show: SHOW.bun },
  { key: 'turban', geo: turban, color: 'extra', bones: ['head'], show: SHOW.turban },
  { key: 'cap', geo: () => merge(ellipsoid(0.072, 0.05, 0.122, 0.272, -0.01, 12, 6)), color: 'cap', bones: ['head'], show: SHOW.cap },
  { key: 'beard', geo: () => merge(ellipsoid(0.084, 0.072, 0.07, 0.11, 0.045, 12, 7)), color: 'hair', mat: 'hair', bones: ['head'], show: SHOW.beard },
  { key: 'moustache', geo: () => merge(ellipsoid(0.031, 0.008, 0.012, 0.141, 0.1, 10, 5)), color: 'hair', mat: 'hair', bones: ['head'], show: SHOW.moustache },
  // Below its belt line the shirt hangs from the hips, with the trousers' top (2 mm away): a twist
  // at the waist then stretches the shirt above the belt instead of pushing one through the other.
  { key: 'torso', geo: torso, color: 'shirt', bones: ['torso'], belt: 0.05 },
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

/**
 * The simple body: every part in one mesh. Each vertex knows its bone, its colour slot, the mask
 * bit that shows it (0: always) and its roughness; welded back to indexed triangles.
 */
export function farGeometry() {
  const pos = [], nrm = [], tag = [];
  for (const p of PARTS) {
    const g0 = p.geo(), g = g0.index ? g0.toNonIndexed() : g0;
    const P = g.attributes.position.array, N = g.attributes.normal.array;
    for (const bone of p.bones) {
      for (let i = 0; i < P.length; i += 3) {
        const low = p.belt !== undefined && P[i + 1] < p.belt; // into the hips bone's space
        pos.push(P[i], P[i + 1] + (low ? BODY.torsoY : 0), P[i + 2]); nrm.push(N[i], N[i + 1], N[i + 2]);
        tag.push(BONES.indexOf(low ? 'hips' : bone), SLOTS.indexOf(p.color), p.show || 0, ROUGH[p.mat || 'cloth']);
      }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  geo.setAttribute('crowdPart', new THREE.Float32BufferAttribute(tag, 4));
  return mergeVertices(geo);
}

// ------------------------------------------------------------------ the detailed body
// Built whole in the bind pose, in the hips' frame. Each vertex hangs from one bone and may blend
// toward a second (elbows, knees, shoulders, hips, waist, neck), so limbs bend instead of hinging.
// Female, heavy and tucked-in shapes are offsets each person mixes in.

/** A point on a superellipse ring: angle `a` from the front (+z), round through the left (+x). */
function ringPoint(a, rx, rf, rb, n) {
  const s = Math.sin(a), c = Math.cos(a), e = 2 / n;
  return [rx * Math.sign(s) * Math.abs(s) ** e, (c > 0 ? rf : rb) * Math.sign(c) * Math.abs(c) ** e];
}

/**
 * A tube lofted bottom to top through rings [y, rx, rf, rb, dz = 0, dx = 0] of `seg` sides
 * (n: 2 for ellipses, more for squarer), smooth-shaded, with optional end caps.
 */
function tube(rings, seg, n = 2, capBottom = false, capTop = false) {
  const pos = [], idx = [];
  for (const [y, rx, rf, rb, dz = 0, dx = 0] of rings) {
    for (let i = 0; i < seg; i++) {
      const [x, z] = ringPoint((i / seg) * Math.PI * 2, rx, rf, rb, n);
      pos.push(x + dx, y, z + dz);
    }
  }
  const R = rings.length;
  for (let k = 0; k < R - 1; k++) {
    for (let i = 0; i < seg; i++) {
      const a = k * seg + i, b = k * seg + (i + 1) % seg;
      idx.push(a, b, b + seg, a, b + seg, a + seg);
    }
  }
  if (capBottom) {
    const c = pos.length / 3, [y, , , , dz = 0, dx = 0] = rings[0];
    pos.push(dx, y, dz);
    for (let i = 0; i < seg; i++) idx.push(c, (i + 1) % seg, i);
  }
  if (capTop) {
    const c = pos.length / 3, [y, , , , dz = 0, dx = 0] = rings[R - 1], base = (R - 1) * seg;
    pos.push(dx, y, dz);
    for (let i = 0; i < seg; i++) idx.push(c, base + i, base + (i + 1) % seg);
  }
  return indexed(pos, idx);
}
function indexed(pos, idx, uv) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  if (uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}
/** The same surface facing the other way, a little inside: the lining of cloth seen from within. */
function lining(g, inset = 0.003) {
  const p = g.attributes.position.array.slice(), n = g.attributes.normal.array, idx = Array.from(g.index.array);
  for (let i = 0; i < p.length; i++) p[i] -= n[i] * inset;
  for (let i = 0; i < idx.length; i += 3) [idx[i + 1], idx[i + 2]] = [idx[i + 2], idx[i + 1]];
  const out = indexed(Array.from(p), idx, g.attributes.uv && Array.from(g.attributes.uv.array));
  return out;
}

/**
 * A tube swept along a path of [x, y, z, r] (or [x, y, z, rWide, rThin]) with `seg` sides; the wide
 * radius lies along `side` (a direction, or a function of the point's index giving one).
 */
function sweep(path, seg, side = [1, 0, 0], caps = true) {
  const pos = [], idx = [], P = path.map(p => new THREE.Vector3(p[0], p[1], p[2]));
  const T = new THREE.Vector3(), Wv = new THREE.Vector3(), Nv = new THREE.Vector3();
  for (let k = 0; k < path.length; k++) {
    T.subVectors(P[Math.min(k + 1, P.length - 1)], P[Math.max(k - 1, 0)]).normalize();
    const sd = typeof side === 'function' ? side(k) : side;
    Wv.set(sd[0], sd[1], sd[2]);
    Wv.addScaledVector(T, -Wv.dot(T)).normalize();
    Nv.crossVectors(T, Wv).normalize();
    const rw = path[k][3], rt = path[k][4] ?? rw;
    for (let i = 0; i < seg; i++) {
      const a = (i / seg) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
      pos.push(P[k].x + Wv.x * c * rw + Nv.x * s * rt, P[k].y + Wv.y * c * rw + Nv.y * s * rt, P[k].z + Wv.z * c * rw + Nv.z * s * rt);
    }
  }
  for (let k = 0; k < path.length - 1; k++) {
    for (let i = 0; i < seg; i++) {
      const a = k * seg + i, b = k * seg + (i + 1) % seg;
      idx.push(a, b, b + seg, a, b + seg, a + seg);
    }
  }
  if (caps) {
    const s0 = pos.length / 3; pos.push(...path[0].slice(0, 3));
    for (let i = 0; i < seg; i++) idx.push(s0, (i + 1) % seg, i);
    const s1 = pos.length / 3, base = (path.length - 1) * seg; pos.push(...path[path.length - 1].slice(0, 3));
    for (let i = 0; i < seg; i++) idx.push(s1, base + i, base + (i + 1) % seg);
  }
  return indexed(pos, idx);
}

/**
 * A ribbon of cloth: `at(u, v)` gives the point (and `out(u, v)` the outward direction) for u
 * along it and v across it, both 0..1, sampled nu × nv; it's given thickness `t` and both faces.
 */
function ribbon(at, out, nu, nv, t) {
  const pos = [], idx = [], uv = [], row = nv + 1, half = (nu + 1) * row;
  // Which way round the faces wind, so the outer one faces `out`.
  const p0 = at(0.49, 0.5), pu = at(0.51, 0.5), pv = at(0.5, 0.51), o = out(0.5, 0.5);
  const du = [pu[0] - p0[0], pu[1] - p0[1], pu[2] - p0[2]], dv = [pv[0] - p0[0], pv[1] - p0[1], pv[2] - p0[2]];
  const flip = (du[1] * dv[2] - du[2] * dv[1]) * o[0] + (du[2] * dv[0] - du[0] * dv[2]) * o[1] + (du[0] * dv[1] - du[1] * dv[0]) * o[2] < 0;
  for (const side of [1, -1]) {
    for (let i = 0; i <= nu; i++) {
      for (let j = 0; j <= nv; j++) {
        const u = i / nu, v = j / nv, p = at(u, v), o = out(u, v);
        pos.push(p[0] + o[0] * t * 0.5 * side, p[1] + o[1] * t * 0.5 * side, p[2] + o[2] * t * 0.5 * side);
        uv.push(u, v);
      }
    }
  }
  for (let i = 0; i < nu; i++) {
    for (let j = 0; j < nv; j++) {
      const a = i * row + j, b = a + row;
      const outer = [a, b, b + 1, a, b + 1, a + 1], inner = [a, b + 1, b, a, a + 1, b + 1].map(k => k + half);
      idx.push(...(flip ? inner.map(k => k - half) : outer), ...(flip ? outer.map(k => k + half) : inner));
    }
  }
  return indexed(pos, idx, uv);
}

/** Bones as [dominant, other, other's weight] from a blend of `a` toward `b` by `w`. */
const blend = (a, b, w) => (w <= 0 ? [a, a, 0] : w >= 1 ? [b, b, 0] : w < 0.5 ? [a, b, w] : [b, a, 1 - w]);

const BONE = Object.fromEntries(BONES.map((k, i) => [k, i]));

class Body {
  constructor() { this.parts = []; }
  /**
   * Add a part built in the bind pose. `o` gives, as values or functions of (x, y, z, i): bones
   * (a name or a blend), slot, show, mat, region, ao, and morph offsets female/heavy/tuck; and its
   * layer, outermost first (0 headwear, 1 hair, 2 wraps and straps, 3 kurtas, sleeves and saris,
   * 4 the body, 5 linings): drawn in that order, what's covered fails the depth test unshaded.
   */
  add(geo, o) { this.parts.push([geo, o]); }
  /**
   * Every part's vertices in one set of attributes, and for each mask in `leaves` the triangles of
   * the parts it doesn't leave out: meshes drawing those see only their own vertices.
   */
  build(leaves) {
    const parts = this.parts.sort((a, b) => (a[1].layer ?? 4) - (b[1].layer ?? 4));
    let n = 0;
    for (const [geo] of parts) n += geo.attributes.position.count;
    const pos = new Float32Array(n * 3), nrm = new Float32Array(n * 3), part = new Float32Array(n * 4), skin = new Float32Array(n * 4);
    const uv = new Float32Array(n * 2), mf = new Float32Array(n * 3), mh = new Float32Array(n * 3), mt = new Float32Array(n * 3);
    const idx = leaves.map(() => []), fn = f => typeof f === 'function';
    let v = 0;
    for (const [geo, o] of parts) {
      const P = geo.attributes.position, N = geo.attributes.normal, U = geo.attributes.uv, base = v;
      // What doesn't vary over the part, worked out once.
      const slot = fn(o.slot) ? null : slotIndex(o.slot), show = o.show ?? 0, rough = ROUGH[o.mat ?? 'cloth'];
      const region = fn(o.region) ? null : (o.region ?? 0), ao = fn(o.ao) ? null : (o.ao ?? 1);
      const bone = typeof o.bones === 'string' ? o.bones : null;
      for (let i = 0; i < P.count; i++, v++) {
        const x = P.getX(i), y = P.getY(i), z = P.getZ(i);
        const b = bone ? null : o.bones(x, y, z, i), b1 = bone ?? b[0], j = JOINTS[b1];
        pos[v * 3] = x - j[0]; pos[v * 3 + 1] = y - j[1]; pos[v * 3 + 2] = z - j[2];
        nrm[v * 3] = N.getX(i); nrm[v * 3 + 1] = N.getY(i); nrm[v * 3 + 2] = N.getZ(i);
        part[v * 4] = BONE[b1]; part[v * 4 + 1] = slot ?? slotIndex(o.slot(x, y, z, i)); part[v * 4 + 2] = show; part[v * 4 + 3] = rough;
        skin[v * 4] = BONE[bone ?? b[1]]; skin[v * 4 + 1] = bone ? 0 : b[2];
        skin[v * 4 + 2] = region ?? o.region(x, y, z, i); skin[v * 4 + 3] = ao ?? o.ao(x, y, z, i);
        if (U) { uv[v * 2] = U.getX(i); uv[v * 2 + 1] = U.getY(i); }
        for (const [m, f] of [[mf, o.female], [mh, o.heavy], [mt, o.tuck]]) {
          if (!f) continue;
          const d = f(x, y, z, i);
          m[v * 3] = d[0]; m[v * 3 + 1] = d[1]; m[v * 3 + 2] = d[2];
        }
      }
      leaves.forEach((leave, k) => { if (!(show & leave)) for (const t of geo.index.array) idx[k].push(base + t); });
    }
    const g = new THREE.BufferGeometry(), f = (a, s) => new THREE.BufferAttribute(a, s);
    g.setAttribute('position', f(pos, 3));
    g.setAttribute('normal', f(nrm, 3));
    g.setAttribute('crowdPart', f(part, 4));
    g.setAttribute('crowdSkin', f(skin, 4));
    g.setAttribute('crowdUV', f(uv, 2));
    g.setAttribute('crowdMF', f(mf, 3));
    g.setAttribute('crowdMH', f(mh, 3));
    g.setAttribute('crowdMT', f(mt, 3));
    return { geometry: g, indices: idx.map(a => new THREE.BufferAttribute(n < 65536 ? new Uint16Array(a) : new Uint32Array(a), 1)) };
  }
}

// --- torso: shirt, blouse or kurta from the hem up to the collar (superellipse rings)
// The shirt stays 6-8 mm outside the trousers' seat down to its hem (the same curve, so they
// never cross); a tucked-in shirt is pulled inside them by its tuck offset. The trapezius runs
// from the neck out to the shoulders, where the arms' deltoids take over.
const TORSO_N = 2.3;
const TORSO = [
  [-0.035, 0.178, 0.118, 0.124], [-0.005, 0.175, 0.114, 0.118], [0.03, 0.172, 0.11, 0.112], [0.07, 0.166, 0.106, 0.106],
  [0.12, 0.161, 0.106, 0.102, 0.002], [0.19, 0.163, 0.111, 0.102, 0.005], [0.26, 0.172, 0.118, 0.104, 0.008],
  [0.33, 0.183, 0.125, 0.107, 0.009], [0.39, 0.191, 0.124, 0.11, 0.007], [0.44, 0.196, 0.116, 0.112, 0.003],
  [0.485, 0.199, 0.105, 0.11, 0], [0.515, 0.202, 0.097, 0.104, -0.003], [0.54, 0.198, 0.089, 0.096, -0.005],
  [0.56, 0.184, 0.082, 0.089, -0.006], [0.58, 0.156, 0.074, 0.08, -0.007], [0.598, 0.112, 0.065, 0.068, -0.006],
  [0.612, 0.074, 0.058, 0.06, -0.005], [0.624, 0.061, 0.055, 0.057, -0.005],
];
/** A loft's surface at angle a and height y (between its rings): [x, z]. */
function ringAt(rings, n, a, y) {
  let k = 0;
  while (k < rings.length - 2 && rings[k + 1][0] < y) k++;
  const A = rings[k], B = rings[k + 1], t = Math.min(1, Math.max(0, (y - A[0]) / (B[0] - A[0])));
  const L = i => (A[i] ?? 0) + ((B[i] ?? 0) - (A[i] ?? 0)) * t;
  const [x, z] = ringPoint(a, L(1), L(2), L(3), n);
  return [x + L(5), z + L(4)];
}
/** How far a loft's surface is from its axis in direction theta (from the front, round through the left) at height y. */
function radiusAt(rings, n, theta, y) {
  let k = 0;
  while (k < rings.length - 2 && rings[k + 1][0] < y) k++;
  const A = rings[k], B = rings[k + 1], t = Math.min(1, Math.max(0, (y - A[0]) / (B[0] - A[0])));
  const L = i => (A[i] ?? 0) + ((B[i] ?? 0) - (A[i] ?? 0)) * t;
  const s = Math.sin(theta), c = Math.cos(theta);
  // A superellipse |x/rx|^n + |z/r|^n = 1 in polar form, then the ring's small offsets.
  return (Math.abs(s / L(1)) ** n + Math.abs(c / (c > 0 ? L(2) : L(3))) ** n) ** (-1 / n) + L(4) * c + L(5) * s;
}
/** The torso's surface at angle a and height y, pushed `off` outward: [x, y, z] and its outward direction. */
function onTorso(a, y, off = 0) {
  const [x0, z0] = ringAt(TORSO, TORSO_N, a, y), [x1, z1] = ringAt(TORSO, TORSO_N, a + 0.01, y);
  // Outward: across the ring's tangent in the horizontal plane.
  let nx = -(z1 - z0), nz = x1 - x0;
  const len = Math.hypot(nx, nz) || 1; nx /= len; nz /= len;
  return { p: [x0 + nx * off, y, z0 + nz * off], n: [nx, 0, nz] };
}
const radial = (x, z, k) => { const r = Math.hypot(x, z) || 1; return [x / r * k, 0, z / r * k]; };
function torsoFemale(x, y, z) {
  const r = Math.hypot(x, z) || 1, side = Math.abs(x) / r;
  const bust = 0.034 * gauss(y, 0.352, 0.055) * Math.min(1, gauss(x, 0.074, 0.048) + gauss(x, -0.074, 0.048)) * Math.max(0, z / r);
  const waist = -0.013 * gauss(y, 0.14, 0.07) * smooth(0.09, 0.13, y), shoulders = -0.016 * side * smooth(0.42, 0.5, y) * (1 - smooth(0.585, 0.62, y));
  // Below the waist, the hem follows the wider hips and seat underneath (pelvisFemale).
  const hips = 0.019 * gauss(y, -0.07, 0.075) * side, seat = -0.015 * gauss(y, -0.085, 0.06) * Math.max(0, -z / r);
  const [wx, , wz] = radial(x, z, waist + hips);
  return [wx + Math.sign(x) * shoulders, -0.25 * bust, wz + bust + seat];
}
function torsoHeavy(x, y, z) {
  const r = Math.hypot(x, z) || 1;
  const belly = 0.048 * gauss(y, 0.1, 0.085) * Math.max(0, z / r) ** 1.5;
  const [sx, , sz] = radial(x, z, 0.016 * gauss(y, 0.12, 0.1) + 0.009 * gauss(y, 0.36, 0.1) - 0.006 * smooth(0.55, 0.62, y));
  // Below the waist the shirt rounds out with the trousers' paunch beneath it.
  const low = pelvisHeavy(x, y, z), t = smooth(0.06, 0.14, y);
  return [low[0] + (sx - low[0]) * t, 0, low[2] + (sz + belly - low[2]) * t];
}
function torsoTuck(x, y, z) {
  // Tucked in: 4 mm inside the trousers below the belt, between them and the belt behind it
  // (pelvis + 3.5 mm, the belt is + 7), and out over it again above.
  if (y > 0.1) return [0, 0, 0];
  const rS = Math.hypot(x, z) || 1, inside = radiusAt(PELVIS, TORSO_N, Math.atan2(x, z), y) - 0.004 + 0.0075 * smooth(0.02, 0.04, y);
  const k = (Math.min(rS, inside + (rS - inside) * smooth(0.074, 0.1, y)) - rS) / rS;
  return [x * k, 0, z * k];
}
const torsoBones = y => blend('hips', 'torso', smooth(0.05, 0.21, y));

// --- pelvis: the trousers' seat and waistband
const PELVIS = [
  [-0.165, 0.042, 0.032, 0.042], [-0.148, 0.112, 0.076, 0.092], [-0.125, 0.153, 0.095, 0.113], [-0.075, 0.169, 0.103, 0.121, -0.002],
  [-0.025, 0.171, 0.105, 0.116], [0.025, 0.166, 0.103, 0.106], [0.065, 0.161, 0.1, 0.1], [0.1, 0.156, 0.097, 0.097],
];
function pelvisFemale(x, y, z) {
  const r = Math.hypot(x, z) || 1;
  const [hx, , hz] = radial(x, z, 0.019 * gauss(y, -0.07, 0.075) * Math.abs(x) / r);
  return [hx, 0, hz - 0.015 * gauss(y, -0.085, 0.06) * Math.max(0, -z / r)];
}
function pelvisHeavy(x, y, z) {
  const r = Math.hypot(x, z) || 1;
  const [sx, , sz] = radial(x, z, 0.011 * gauss(y, 0, 0.1));
  return [sx, 0, sz + 0.032 * gauss(y, 0.065, 0.06) * Math.max(0, z / r) ** 1.5];
}

/** The shirt's and trousers' shapes and offsets, for checking that one stays outside the other. */
export const CLOTH = { TORSO, PELVIS, n: TORSO_N, radiusAt, torsoFemale, torsoHeavy, torsoTuck, pelvisFemale, pelvisHeavy };

// --- arms and legs: [dy from the joint, side radius, front radius, back radius]
// The deltoid's crown sits just above the shoulder joint, its inner half under the torso's
// shoulder; what shows is its round outer side.
const ARM_TOP = 0.012;
const ARM = [
  [ARM_TOP, 0.012], [0.01, 0.03], [0.004, 0.045], [-0.008, 0.0535], [-0.04, 0.055], [-0.09, 0.0535], [-0.15, 0.05],
  [-0.21, 0.048], [-0.26, 0.046], [-0.29, 0.045], [-0.32, 0.046], [-0.37, 0.047], [-0.43, 0.043], [-0.49, 0.037], [-0.535, 0.031], [-0.565, 0.024],
];
const SLEEVE = [[0.015, 0.013], [0.013, 0.033], [0.007, 0.049], [-0.008, 0.058], [-0.05, 0.0595], [-0.1, 0.0585], [-0.128, 0.058], [-0.133, 0.0505]];
const LEG = [
  [0.075, 0.084, 0.08, 0.084], [0.02, 0.089, 0.085, 0.09], [-0.05, 0.088, 0.084, 0.089], [-0.13, 0.084, 0.08, 0.084],
  [-0.22, 0.078, 0.074, 0.077], [-0.3, 0.071, 0.068, 0.07], [-0.37, 0.064, 0.062, 0.062], [-0.41, 0.06, 0.06, 0.058],
  [-0.43, 0.059, 0.06, 0.057], [-0.43, 0.059, 0.06, 0.057], [-0.46, 0.058, 0.057, 0.059], [-0.51, 0.058, 0.055, 0.064],
  [-0.59, 0.057, 0.053, 0.064], [-0.67, 0.054, 0.05, 0.058], [-0.75, 0.05, 0.047, 0.051], [-0.81, 0.048, 0.046, 0.048],
  [-0.838, 0.05, 0.049, 0.05], [-0.848, 0.041, 0.04, 0.041],
];
// Lofted bottom up, the shin's rings ('legs' colour, bare for a dhoti) come first: the knee
// ring is doubled so the colour changes there cleanly.
const LEG_SEG = 14, SHIN_RINGS = LEG.length - 9;
/** Rings listed top down, as a tube wants them: bottom up, about a joint at (x, y). */
const about = (rings, x, y, f) => rings.slice().reverse().map(r => f(r, x, y));

// Elbows, knees and the tops of limbs blend over a band, narrower on the side that creases.
function armBones(side, dy, z) {
  const up = 'upperArm' + side, low = 'lowerArm' + side, front = smooth(-0.02, 0.03, z);
  if (dy > -0.035) return blend(up, 'torso', 0.6 * smooth(-0.035, ARM_TOP, dy));
  const a = -0.24 - 0.025 * front, b = -0.34 + 0.03 * front; // the inner elbow (front) creases
  return blend(up, low, smooth(a, b, dy));
}
function legBones(side, dy, z) {
  const th = 'thigh' + side, sh = 'shin' + side, back = smooth(0.02, -0.03, z);
  if (dy > -0.06) return blend(th, 'hips', 0.65 * smooth(-0.06, 0.075, dy) * (1 - 0.4 * smooth(-0.02, 0.04, z)));
  const a = -0.385 - 0.035 * back, b = -0.49 + 0.045 * back; // the back of the knee creases
  return blend(th, sh, smooth(a, b, dy));
}

// --- head: skull, jaw and the relief a painted face sits on
const HEAD_Y = 0.175, HEAD_Z = 0.004;
/** The skull's surface in the direction of unit vector (x, y, z), from the head's centre. */
function skull(x, y, z) {
  const ax = Math.abs(x);
  let X = x * 0.091, Y = y * 0.118, Z = z * 0.103;
  const low = smooth(-0.1, -0.95, y), front = smooth(0.45, 0.85, z);
  X *= 1 - 0.3 * low; // the jaw narrows to the chin
  if (z > 0) Z += 0.013 * low * z; // jaw and chin come forward
  if (z < 0) Z *= 1 + 0.06 * smooth(-0.6, -0.3, y); // a fuller back of the head
  if (z < 0) Z *= 0.88 + 0.12 * smooth(-0.95, -0.3, y); // the nape tucks in
  Z -= 0.005 * front * smooth(-0.3, 0.45, y) * (1 - smooth(0.5, 0.8, y)); // a flatter face
  Z -= 0.0055 * front * gauss(ax, 0.37, 0.14) * gauss(y, 0.13, 0.1); // eye sockets
  Z += 0.003 * smooth(0.6, 0.9, z) * gauss(y, 0.29, 0.07) * (1 - smooth(0.45, 0.7, ax)); // brow ridge
  const cheek = gauss(ax, 0.6, 0.15) * gauss(y, -0.12, 0.13) * smooth(0.3, 0.7, z);
  X += Math.sign(x) * 0.004 * cheek; Z += 0.002 * cheek; // cheekbones
  Z += 0.0045 * front * gauss(x, 0, 0.26) * gauss(y, -0.41, 0.085); // lips
  Z += 0.003 * front * gauss(x, 0, 0.3) * gauss(y, -0.78, 0.1); // chin
  X *= 1 - 0.035 * gauss(y, 0.42, 0.15) * smooth(0.6, 0.95, ax); // temples
  return [X, Y, Z];
}
/** A sphere (or a band of it, theta from the top) shaped as the skull scaled by k(x, y, z) about the head's centre, plus a nudge. */
function onSkull(k, nudge, w = 28, h = 20, theta = [0, Math.PI]) {
  const g = new THREE.SphereGeometry(1, w, h, 0, Math.PI * 2, theta[0], theta[1]), p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i), [X, Y, Z] = skull(x, y, z), f = k(x, y, z);
    const d = nudge ? nudge(x, y, z) : [0, 0, 0];
    p.setXYZ(i, X * f + d[0], Y * f + HEAD_Y + d[1], Z * f + HEAD_Z + d[2]);
  }
  g.computeVertexNormals();
  return g;
}
const headNear = () => onSkull(() => 1);
function nose() {
  // Bridge between the eyes down to the tip and wings; it sits half inside the face.
  return tube([
    [0.142, 0.007, 0.005, 0.004, 0.093], [0.146, 0.0145, 0.013, 0.006, 0.094], [0.153, 0.0165, 0.02, 0.006, 0.094],
    [0.165, 0.0115, 0.016, 0.005, 0.094], [0.18, 0.0085, 0.0095, 0.004, 0.093], [0.199, 0.0075, 0.004, 0.004, 0.091],
  ], 12, 2, true, true);
}
function ear(s) {
  const g = new THREE.SphereGeometry(1, 10, 6), p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    // A shell: thin, taller than wide, the lobe narrower, cupped toward the front.
    const X = x * 0.009 + (z > 0 ? 0.004 * (1 - y * y) : 0), Y = y * 0.029, Z = z * 0.015 * (y < -0.4 ? 0.75 : 1);
    p.setXYZ(i, s * (0.089 + X), 0.171 + Y, -0.008 + Z);
  }
  g.computeVertexNormals();
  return g;
}
// Where hair grows, as the height on the unit sphere by the angle round the head from the front:
// the hairline (forehead, temples, sideburns, up over the ears, down to the nape) and the top
// of a beard (round the mouth, up the cheeks to the sideburns). The shader paints the same
// edges, a little wider, so the shells' own jagged edges hide under paint of the same colour.
export const HAIRLINE = [[0, 0.62], [0.45, 0.56], [0.75, 0.42], [1.08, 0.02], [1.22, -0.14], [1.36, 0.0], [1.62, 0.28], [1.88, 0.28], [2.2, -0.16], [2.6, -0.5], [Math.PI, -0.62]];
export const BEARDLINE = [[0, -0.27], [0.35, -0.2], [0.8, -0.06], [1.15, 0.02], [1.38, 0.04], [1.5, -1.2]];
export function along(keys, a) {
  let y = keys[0][1];
  for (let k = 0; k < keys.length - 1; k++) y += (keys[k + 1][1] - y) * smooth(keys[k][0], keys[k + 1][0], a);
  return y;
}
/** Hair: a shell over the skull, tucked inside it below the hairline; partings are painted. */
function hairNear() {
  return onSkull((x, y, z) => {
    const line = along(HAIRLINE, Math.abs(Math.atan2(x, z))), on = smooth(line + 0.03, line + 0.11, y);
    const puff = 1.03 + 0.045 * smooth(-0.2, 0.6, y) + 0.012 * smooth(0, -0.8, z);
    return 0.9 + (puff - 0.9) * on;
  }, null, 28, 15, [0, Math.PI * 0.78]);
}
function braid() {
  // From the nape down the back, plaited lobes narrowing to a tassel.
  const path = [], n = 22;
  for (let k = 0; k <= n; k++) {
    const t = k / n, y = 0.71 - t * 0.44, r = 0.021 * (1 - 0.45 * t) * (0.8 + 0.2 * Math.abs(Math.sin(t * Math.PI * 9)));
    const back = onTorso(Math.PI, Math.min(y, 0.6), 0).p[2];
    path.push([0, y, Math.min(back, -0.07 - 0.04 * smooth(0.71, 0.6, y)) - r - 0.004, r, r * 0.85]);
  }
  path.push([0, 0.245, path[n][2], 0.008], [0, 0.22, path[n][2] + 0.002, 0.003]);
  return sweep(path, 6, [1, 0, 0]);
}
function bun() {
  return tube([
    [0.1, 0.012, 0.012, 0.012, -0.112], [0.108, 0.034, 0.03, 0.03, -0.114], [0.122, 0.048, 0.04, 0.04, -0.118],
    [0.138, 0.052, 0.043, 0.043, -0.12], [0.154, 0.046, 0.038, 0.038, -0.118], [0.166, 0.03, 0.026, 0.026, -0.114], [0.171, 0.01, 0.01, 0.01, -0.11],
  ], 16, 2, true, true);
}
function gajra() {
  // A string of jasmine buds round the bun.
  const path = [];
  for (let k = 0; k <= 48; k++) {
    const a = (k / 48) * Math.PI * 2, [x, z] = ringPoint(a, 0.054, 0.046, 0.046, 2), r = 0.0055 + 0.0035 * Math.abs(Math.cos(a * 8));
    path.push([x, 0.132 + 0.004 * Math.sin(a * 3), z - 0.12, r]);
  }
  return sweep(path, 4, [0, 1, 0], false);
}
function moustache() {
  // Thick over the lip, thinning and drooping a little at the ends.
  const pts = [[-0.031, 0.134, 0.088], [-0.02, 0.1385, 0.0985], [-0.008, 0.1405, 0.1035], [0, 0.141, 0.1045], [0.008, 0.1405, 0.1035], [0.02, 0.1385, 0.0985], [0.031, 0.134, 0.088]];
  const r = [0.0025, 0.0055, 0.0068, 0.007, 0.0068, 0.0055, 0.0025];
  return sweep(pts.map((p, k) => [p[0], p[1], p[2], r[k] * 0.6, r[k]]), 8, [0, 0, 1]);
}
function beard() {
  // A shell over the jaw and chin, fuller below; tucked into the face elsewhere and round the mouth.
  const on = (x, y, z) => smooth(0.0, -0.06, y - along(BEARDLINE, Math.abs(Math.atan2(x, z)))) * (1 - gauss(x, 0, 0.3) * gauss(y, -0.43, 0.06) * smooth(0.5, 0.8, z));
  return onSkull(
    (x, y, z) => 0.92 + (0.12 + 0.12 * smooth(-0.1, -0.95, y)) * on(x, y, z),
    (x, y, z) => [0, -0.012 * on(x, y, z) * smooth(-0.1, -0.95, y) ** 2, 0], 24, 11, [Math.PI * 0.44, Math.PI * 0.56]);
}
/** A cap of a sphere (down to `theta` from the top) shaped by f(x, y, z) → [X, Y, Z] in the head's frame. */
function crown(theta, f, w = 24, h = 10) {
  const g = new THREE.SphereGeometry(1, w, h, 0, Math.PI * 2, 0, theta), p = g.attributes.position;
  for (let i = 0; i < p.count; i++) { const [X, Y, Z] = f(p.getX(i), p.getY(i), p.getZ(i)); p.setXYZ(i, X, Y, Z); }
  g.computeVertexNormals();
  return g;
}
/**
 * A wrapped turban: its brim on the forehead in front and low behind, straight sides and a
 * flattish top; `tall` lifts the front into a peak, `fold` ripples the wraps.
 */
function wrap(theta, brim, top, tall, fold) {
  const bottom = Math.cos(theta);
  return crown(theta, (x, y, z) => {
    const t = (y - bottom) / (1 - bottom), front = smooth(-0.3, 0.9, z);
    const rho = Math.hypot(x, z), f = rho > 1e-6 ? rho ** 0.55 / rho : 0; // straighter sides, a flatter top
    const bulge = (1 + 0.07 * Math.sin(Math.PI * Math.min(1, t * 1.3))) * (1 + fold * Math.sin(y * 24 + z * 3));
    const peak = tall * smooth(0.4, 0.95, z) * (1 - smooth(0, 0.4, Math.abs(x))) * t;
    const lo = brim[1] + (brim[0] - brim[1]) * front, hi = top + tall * 0.03 * front;
    return [x * f * 0.088 * bulge, lo + (hi - lo) * t + 0.014 * peak, -0.006 + z * f * 0.112 * bulge];
  });
}
// A Sikh dastar, wound high to a peak over the forehead; a Marathi pheta, rounder and lower, its
// tail down the back of the neck.
const dastar = () => wrap(Math.PI * 0.62, [0.228, 0.15], 0.322, 1, 0);
const pheta = () => wrap(Math.PI * 0.6, [0.218, 0.158], 0.31, 0.2, 0.02);
function phetaTail() {
  // In the head's frame from the back of the turban down to the shoulders.
  return ribbon(
    (u, v) => [(v - 0.5) * 0.07 * (1 + 0.4 * u), 0.2 - u * 0.24, -0.118 - 0.02 * u],
    () => [0, 0, -1], 6, 2, 0.006);
}
function topi() {
  // A Gandhi cap: a boat shape with a ridge front to back, worn a touch to one side.
  return crown(Math.PI * 0.55, (x, y, z) => {
    const X = x * 0.084 * (1 - 0.55 * smooth(0.2, 1, y));
    return [X + 0.006, 0.236 + y * 0.062 + X * 0.08, -0.004 + z * 0.122];
  }, 20, 8);
}
function policeCap() {
  const crown = tube([
    [0.226, 0.084, 0.094, 0.093, 0.002], [0.25, 0.088, 0.1, 0.095, 0.004], [0.292, 0.098, 0.116, 0.1, 0.01], [0.298, 0.094, 0.11, 0.096, 0.01],
  ], 24, 2.4, false, true);
  const visor = ribbon((u, v) => {
    const a = (u - 0.5) * 2.2, r = 0.09 + v * 0.06;
    return [Math.sin(a) * r * 0.95, 0.228 - v * 0.022, 0.012 + Math.cos(a) * r];
  }, () => [0, 1, 0], 10, 2, 0.004);
  return { crown, visor };
}

// --- hands: a palm with four curled fingers and a thumb, palm toward the thigh
function handNear(s) {
  const parts = [];
  const palm = tube([
    [0.012, 0.018, 0.026, 0.026], [-0.01, 0.017, 0.032, 0.03], [-0.035, 0.0155, 0.04, 0.035],
    [-0.06, 0.0148, 0.043, 0.037], [-0.077, 0.013, 0.042, 0.036], [-0.088, 0.0095, 0.035, 0.03],
  ], 14, 2.4, false, true);
  parts.push(palm);
  const fingers = [[0.026, 0.072, 0.0088], [0.009, 0.08, 0.0088], [-0.008, 0.074, 0.0084], [-0.024, 0.058, 0.0074]];
  for (const [fz, len, r] of fingers) {
    // Three segments curling toward the palm (inward: -s along x).
    const pts = [[0, -0.07, fz, r]];
    let x = 0, y = -0.07, ang = 0;
    for (const [frac, bend] of [[0.45, 0.32], [0.3, 0.75], [0.25, 0.75]]) {
      ang += bend;
      const L = len * frac;
      x -= s * Math.sin(ang) * L; y -= Math.cos(ang) * L;
      pts.push([x, y, fz, r * (0.93 - 0.08 * pts.length)]);
    }
    parts.push(sweep(pts, 6, [0, 0, 1]));
  }
  parts.push(sweep([[-s * 0.004, -0.018, 0.026, 0.0115], [-s * 0.014, -0.036, 0.046, 0.0105], [-s * 0.028, -0.054, 0.058, 0.0092], [-s * 0.038, -0.068, 0.062, 0.0082]], 7, [0, 0, 1]));
  const g = mergeIndexed(parts);
  const j = JOINTS['lowerArm' + (s > 0 ? 'L' : 'R')];
  g.translate(j[0], j[1] - 0.245, j[2]);
  return g;
}

// --- feet: closed shoes, or chappals on bare feet
function shoeNear(s) {
  const g = new THREE.SphereGeometry(1, 16, 10), p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const Z = z * 0.133 + 0.052;
    const w = 0.035 + 0.014 * smooth(-0.06, 0.1, Z) - 0.01 * smooth(0.13, 0.19, Z);
    const top = 0.072 - 0.03 * smooth(0.0, 0.11, Z) - 0.012 * smooth(0.11, 0.18, Z);
    const Y = -0.057 + (Math.max(y, -0.7) + 0.7) / 1.7 * top + 0.006 * smooth(0.12, 0.19, Z) * (y < 0 ? 1 : 0);
    p.setXYZ(i, x * w - s * 0.004 * smooth(0.06, 0.18, Z) * (x * s < 0 ? 1 : 0.3), Y, Z);
  }
  g.computeVertexNormals();
  return g;
}
function footNear(s) {
  // A bare foot: heel, arch, the ball and toes; the ankle runs up into the shin.
  const g = new THREE.SphereGeometry(1, 14, 9), p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const Z = z * 0.122 + 0.048;
    const w = 0.031 + 0.013 * smooth(-0.05, 0.11, Z) - 0.007 * smooth(0.14, 0.18, Z);
    const top = 0.085 - 0.06 * smooth(-0.01, 0.12, Z) - 0.006 * smooth(0.12, 0.17, Z);
    const Y = -0.045 + (Math.max(y, -0.75) + 0.75) / 1.75 * top;
    p.setXYZ(i, x * w - s * 0.003 * smooth(0.06, 0.17, Z), Y, Z);
  }
  g.computeVertexNormals();
  return g;
}
function chappal(s) {
  // The sole (a footprint, a centimetre thick) and a V of strap from between the toes.
  const out = [];
  for (let k = 0; k < 20; k++) {
    const a = (k / 20) * Math.PI * 2, c = Math.cos(a), sn = Math.sin(a);
    const Z = 0.05 + sn * 0.138, w = 0.037 + 0.015 * smooth(-0.06, 0.1, Z) - 0.012 * smooth(0.14, 0.19, Z);
    out.push([c * w - s * 0.004 * smooth(0.06, 0.18, Z), Z]);
  }
  const pos = [], idx = [];
  for (const y of [-0.057, -0.046]) { for (const [x, z] of out) pos.push(x, y, z); pos.push(0, y, 0.05); }
  const n = out.length, top = n + 1;
  for (let k = 0; k < n; k++) {
    const k1 = (k + 1) % n;
    idx.push(n, k1, k); idx.push(top + n, top + k, top + k1); // bottom, top
    idx.push(k, k1, top + k1, k, top + k1, top + k); // rim
  }
  const sole = indexed(pos, idx);
  const toe = [-s * 0.012, -0.044, 0.135], straps = [];
  for (const side of [1, -1]) {
    const end = [side * 0.04 - s * 0.002, -0.046, 0.06];
    const mid = [(toe[0] + end[0]) / 2, -0.018, (toe[2] + end[2]) / 2];
    straps.push(sweep([[...toe, 0.004, 0.0025], [...mid, 0.006, 0.0028], [...end, 0.005, 0.0025]], 6, [0, 1, 0]));
  }
  return { sole, straps: mergeIndexed(straps) };
}

function mergeIndexed(geos) {
  const pos = [], idx = [], uv = [];
  let any = false;
  for (const g of geos) {
    const base = pos.length / 3, P = g.attributes.position.array, U = g.attributes.uv;
    pos.push(...P);
    if (U) { any = true; uv.push(...U.array); } else for (let i = 0; i < P.length / 3; i++) uv.push(0, 0);
    if (g.index) for (const k of g.index.array) idx.push(base + k);
    else for (let i = 0; i < P.length / 3; i++) idx.push(base + i);
  }
  const g = indexed(pos, idx, any ? uv : undefined);
  return g;
}

/**
 * The detailed body: every part anyone wears up close, with what the crowd shader needs per vertex
 * (bone and second bone with its weight, colour slot, mask bit, roughness, painted region,
 * occlusion, ribbon coordinates and the female, heavy and tucked offsets), and the triangles of
 * the men's body (without WOMENS) and the women's (without MENS).
 */
export function nearGeometry() {
  const b = new Body();
  const H = JOINTS.head;
  const inHead = g => g.translate(H[0], H[1], H[2]);

  // Torso: shirt, blouse or kurta. Darker under the arms and where the arms hide it.
  b.add(tube(TORSO, 24, TORSO_N, true, true), {
    bones: (x, y) => torsoBones(y), slot: 'shirt', region: REGION.shirt,
    ao: (x, y) => 1 - 0.28 * smooth(0.15, 0.192, Math.abs(x)) * smooth(0.28, 0.42, y) * (1 - smooth(0.5, 0.56, y)),
    female: torsoFemale, heavy: torsoHeavy, tuck: torsoTuck,
  });
  // Trousers' seat and waistband, and a belt for a tucked-in shirt.
  b.add(tube(PELVIS, 24, TORSO_N, true, true), {
    bones: 'hips', slot: 'pants', female: pelvisFemale, heavy: pelvisHeavy,
    ao: (x, y) => 1 - 0.3 * (1 - smooth(-0.175, -0.11, y)) * (1 - smooth(0.03, 0.09, Math.abs(x))),
  });
  const belt = tube([[0.033, 0.1712, 0.108, 0.1118], [0.036, 0.1722, 0.109, 0.1122], [0.071, 0.1658, 0.1052, 0.1052], [0.074, 0.1648, 0.1042, 0.1042]], 24, TORSO_N);
  b.add(belt, { bones: 'hips', slot: 'shoes', mat: 'leather', show: SHOW.belt, region: REGION.belt, heavy: pelvisHeavy, layer: 2 });

  // Legs: thigh to ankle in one, bending at the knee; trousers above it, the shin's colour below.
  for (const [s, side] of [[1, 'L'], [-1, 'R']]) {
    const j = JOINTS['thigh' + side];
    const g = tube(about(LEG, j[0], j[1], ([dy, rx, rf, rb], x0, y0) => [y0 + dy, rx, rf, rb, 0, x0]), LEG_SEG, 2, false, false);
    b.add(g, {
      bones: (x, y, z) => legBones(side, y - j[1], z),
      slot: (x, y, z, i) => (Math.floor(i / LEG_SEG) < SHIN_RINGS ? 'legs' : 'pants'),
      ao: (x, y, z) => {
        const dy = y - j[1], inner = Math.max(0, -s * (x - j[0]) / 0.085);
        return 1 - 0.2 * inner * smooth(-0.3, -0.02, dy) - 0.14 * gauss(dy, -0.43, 0.04) * smooth(0.01, -0.04, z);
      },
      heavy: (x, y, z) => radial(x - j[0], z, 0.011 * smooth(-0.4, -0.05, y - j[1]) + 0.004 * gauss(y - j[1], -0.6, 0.1)),
      female: (x, y, z) => radial(x - j[0], z, 0.006 * gauss(y - j[1], -0.1, 0.12) * Math.max(0, s * (x - j[0]) / 0.085)),
    });
    // Arms: the deltoid to the wrist, bending at the elbow; sleeve-coloured (skin for short sleeves).
    const a = JOINTS['upperArm' + side];
    const ring = ([dy, r], x0, y0) => [y0 + dy, r, r * 0.9, r * 0.9, 0, x0 - s * 0.01 * smooth(-0.06, 0.02, dy)];
    const arm = tube(about(ARM, a[0], a[1], ring), 14, 2, false, true);
    const armMorph = k => (x, y, z) => radial(x - a[0], z, k(y - a[1]));
    b.add(arm, {
      bones: (x, y, z) => armBones(side, y - a[1], z), slot: 'sleeve', region: s > 0 ? REGION.sleeveL : REGION.sleeveR,
      ao: (x, y) => 1 - 0.13 * Math.max(0, -s * (x - a[0]) / 0.06) - 0.12 * gauss(y - a[1], -0.02, 0.06) * Math.max(0, -s * (x - a[0]) / 0.06),
      female: armMorph(dy => -0.005 * smooth(0.05, -0.1, dy)), heavy: armMorph(dy => (dy > -0.29 ? 0.009 : 0.005) * smooth(0.06, -0.04, dy)),
    });
    const sleeve = tube(about(SLEEVE, a[0], a[1], ring), 14, 2, false, true);
    b.add(sleeve, {
      bones: (x, y, z) => armBones(side, y - a[1], z), slot: 'shirt', show: SHOW.short, region: s > 0 ? REGION.shortL : REGION.shortR, layer: 3,
      female: armMorph(dy => -0.004), heavy: armMorph(dy => 0.009 * smooth(0.06, -0.04, dy)),
    });
    const hand = 'lowerArm' + side;
    b.add(handNear(s), { bones: hand, slot: 'skin', mat: 'skin', ao: (x) => 1 - 0.1 * Math.max(0, -s * (x - a[0]) / 0.02) });
    // Feet.
    const f = JOINTS['foot' + side], foot = 'foot' + side, at = g => g.translate(f[0], f[1], f[2]);
    b.add(at(shoeNear(s)), { bones: foot, slot: 'shoes', mat: 'leather', show: SHOW.shoes, region: REGION.shoe });
    const ch = chappal(s);
    b.add(at(footNear(s)), {
      bones: (x, y) => blend(foot, 'shin' + side, 0.5 * smooth(f[1] + 0.02, f[1] + 0.05, y)), slot: 'skin', mat: 'skin', show: SHOW.chappal,
    });
    b.add(at(ch.sole), { bones: foot, slot: 'shoes', mat: 'leather', show: SHOW.chappal, ao: (x, y) => (y > f[1] - 0.05 ? 1 : 0.7) });
    b.add(at(ch.straps), { bones: foot, slot: 'shoes', mat: 'leather', show: SHOW.chappal });
  }

  // Head, neck, nose and ears; the eyes, brows, lips, a bindi and stubble are painted on.
  const neck = tube([[-0.07, 0.05, 0.048, 0.052], [-0.02, 0.0495, 0.047, 0.05], [0.03, 0.0475, 0.046, 0.048], [0.08, 0.0465, 0.046, 0.047], [0.13, 0.044, 0.044, 0.045]].map(r => [r[0], r[1], r[2], r[3], -0.006]), 16);
  b.add(inHead(neck), {
    bones: (x, y) => blend('torso', 'head', smooth(H[1] - 0.005, H[1] + 0.09, y)), slot: 'skin', mat: 'skin',
    ao: (x, y, z) => 1 - 0.3 * smooth(H[1] + 0.06, H[1] + 0.11, y) * smooth(0, 0.04, z),
  });
  b.add(inHead(headNear()), {
    bones: 'head', slot: 'skin', mat: 'skin', region: REGION.face,
    ao: (x, y, z) => 1 - 0.25 * smooth(H[1] + 0.09, H[1] + 0.06, y) * smooth(0.0, 0.05, z),
  });
  b.add(inHead(nose()), { bones: 'head', slot: 'skin', mat: 'skin', region: REGION.face, ao: (x, y) => 1 - 0.18 * smooth(H[1] + 0.152, H[1] + 0.142, y) });
  for (const s of [1, -1]) b.add(inHead(ear(s)), { bones: 'head', slot: 'skin', mat: 'skin', ao: (x, y, z) => 0.8 + 0.2 * smooth(-0.004, 0.006, s * x - 0.089) });
  // Hair, a braid or a bun (with jasmine), a moustache or beard.
  b.add(inHead(hairNear()), { bones: 'head', slot: 'hair', mat: 'hair', show: SHOW.hair, region: REGION.hair, layer: 1 });
  b.add(braid(), {
    bones: (x, y) => blend('torso', 'head', smooth(0.6, 0.7, y)), slot: 'hair', mat: 'hair', show: SHOW.long, region: REGION.hair, layer: 1,
    female: (x, y, z) => [0, 0, -0.012 * smooth(0.5, 0.35, y) * smooth(0.25, 0.32, y) - 0.006 * smooth(0.6, 0.45, y)],
    heavy: (x, y) => [0, 0, -0.008 * gauss(y, 0.3, 0.15)],
  });
  b.add(inHead(bun()), { bones: 'head', slot: 'hair', mat: 'hair', show: SHOW.bun, region: REGION.hair, layer: 1 });
  b.add(inHead(gajra()), { bones: 'head', slot: 'flower', show: SHOW.gajra, layer: 1 });
  b.add(inHead(moustache()), { bones: 'head', slot: 'hair', mat: 'hair', show: SHOW.moustache, layer: 1 });
  b.add(inHead(beard()), { bones: 'head', slot: 'hair', mat: 'hair', show: SHOW.beard, region: REGION.hair, layer: 1 });
  // Turbans and caps.
  b.add(inHead(dastar()), { bones: 'head', slot: 'extra', show: SHOW.dastar, region: REGION.turban, layer: 0 });
  b.add(inHead(pheta()), { bones: 'head', slot: 'extra', show: SHOW.pheta, region: REGION.turban, layer: 0 });
  b.add(inHead(phetaTail()), { bones: (x, y) => blend('torso', 'head', smooth(H[1] + 0.0, H[1] + 0.12, y)), slot: 'extra', show: SHOW.pheta, layer: 0 });
  b.add(inHead(topi()), { bones: 'head', slot: 'cap', show: SHOW.topi, layer: 0 });
  const pc = policeCap();
  b.add(inHead(pc.crown), { bones: 'head', slot: 'cap', show: SHOW.pcap, region: REGION.pcap, layer: 0 });
  b.add(inHead(pc.visor), { bones: 'head', slot: 'visor', mat: 'leather', show: SHOW.pcap, layer: 0 });

  // A shirt collar, folded down round the neck, open at the throat with its points on the chest.
  const collarAt = u => 0.39 + u * (Math.PI * 2 - 0.78);
  const collar = ribbon((u, v) => {
    const a = collarAt(u), df = Math.min(a, Math.PI * 2 - a), y0 = 0.604 + 0.017 * smooth(0.4, 2.2, df);
    const o = onTorso(a, Math.min(y0, 0.616), 0.002);
    const lift = 0.026 * (1 - v), spread = 0.018 * v, point = 0.016 * v * (1 - smooth(0.4, 1.1, df));
    return [o.p[0] + o.n[0] * spread, o.p[1] + lift - point, o.p[2] + o.n[2] * spread];
  }, u => onTorso(collarAt(u), 0.61).n, 22, 2, 0.004);
  b.add(collar, { bones: 'torso', slot: 'shirt', show: SHOW.collar, region: REGION.shirt, female: torsoFemale, heavy: torsoHeavy, layer: 2 });
  // Police shoulder straps.
  for (const s of [1, -1]) {
    const strap = tube([[-0.003, 0.046, 0.021, 0.021], [0.003, 0.046, 0.021, 0.021]], 8, 6, true, true);
    strap.rotateZ(-s * 0.36).translate(s * 0.152, 0.588, -0.004);
    b.add(strap, { bones: 'torso', slot: 'shirt', show: SHOW.pcap, layer: 2 });
  }
  // The sari: pleated skirt (on the skirt bone, folding over the thighs when seated), and the pallu
  // from the right hip across the chest, over the left shoulder and down the back.
  const sari = tube(Array.from({ length: 8 }, (_, k) => {
    const t = 1 - k / 7, y = 0.045 - t * 0.86, r = 0.18 + 0.1 * t * t + 0.004 * t;
    return [y, r, r * 0.8, r * 0.8];
  }), 32, 2, false, false);
  {
    const p = sari.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i), a = Math.atan2(x, z), t = (0.045 - y) / 0.86;
      const pleats = 0.012 * Math.cos(a * 34) * smooth(0.55, 0.15, Math.abs(a)) * (0.3 + t), folds = 0.006 * Math.sin(a * 9) * t;
      const k = 1 + (pleats + folds) / Math.hypot(x, z);
      p.setXYZ(i, x * k, y, z * k);
    }
    sari.computeVertexNormals();
  }
  // Tied at the waist, it stays there; below, it follows the thighs.
  const skirtBones = (x, y) => blend('hips', 'skirt', smooth(0.02, -0.14, y));
  const sariOpts = { bones: skirtBones, slot: 'extra', show: SHOW.skirt, region: REGION.sari, female: pelvisFemale, layer: 3 };
  b.add(sari, sariOpts);
  b.add(lining(sari), { ...sariOpts, ao: 0.55, layer: 5 });
  // In the torso's own terms: angle round it and height, then off the end down the back.
  const palluPath = u => {
    const k = [[-0.62, 0.02], [-0.3, 0.2], [0.25, 0.36], [0.85, 0.5], [1.35, 0.585], [2.05, 0.56], [2.6, 0.42], [2.75, 0.2], [2.8, 0.0], [2.82, -0.2]];
    const f = u * (k.length - 1), i = Math.min(k.length - 2, Math.floor(f)), t = f - i;
    return [k[i][0] + (k[i + 1][0] - k[i][0]) * t, k[i][1] + (k[i + 1][1] - k[i][1]) * t];
  };
  // Width runs across the drape: perpendicular to it, measured round the torso (radius ~0.17).
  const across = (path, u, w) => {
    const [a0, y0] = path(Math.max(0, u - 0.01)), [a1, y1] = path(Math.min(1, u + 0.01)), [a, y] = path(u);
    const ta = (a1 - a0) * 0.17, ty = y1 - y0, len = Math.hypot(ta, ty) || 1;
    return [a - (ty / len) * w / 0.17, y + (ta / len) * w];
  };
  const pallu = ribbon((u, v) => {
    const [a, y] = across(palluPath, u, (v - 0.5) * 0.24);
    const o = onTorso(a, Math.max(-0.03, y), 0.007 + 0.006 * u);
    // Below the blouse's hem it hangs free over the skirt.
    if (y < -0.03) { const d = -0.03 - y; o.p[1] = y; o.p[0] += o.n[0] * d * 0.25; o.p[2] += o.n[2] * d * 0.25; }
    return o.p;
  }, u => { const [a, y] = palluPath(u); return onTorso(a, Math.max(-0.03, y)).n; }, 30, 4, 0.004);
  b.add(pallu, {
    bones: (x, y) => torsoBones(y), slot: 'extra', show: SHOW.skirt, region: REGION.pallu, layer: 2,
    female: (x, y, z) => torsoFemale(x, y, z).map(v => v * 1.05), heavy: torsoHeavy,
  });
  // A dupatta over both shoulders, its ends down the front.
  const dupattaPath = u => {
    const k = [[0.42, 0.1], [0.62, 0.32], [1.05, 0.5], [1.55, 0.6], [2.4, 0.615], [Math.PI, 0.62], [3.9, 0.615], [4.73, 0.6], [5.23, 0.5], [5.66, 0.32], [5.86, 0.1]];
    const f = u * (k.length - 1), i = Math.min(k.length - 2, Math.floor(f)), t = f - i;
    return [k[i][0] + (k[i + 1][0] - k[i][0]) * t, k[i][1] + (k[i + 1][1] - k[i][1]) * t];
  };
  const dupatta = ribbon((u, v) => {
    const [a, y] = dupattaPath(u), w = (v - 0.5) * 0.11, top = smooth(0.25, 0.4, u) * smooth(0.75, 0.6, u);
    const o = onTorso(a + w * (1 - top) * 1.4, Math.min(0.618, y + w * top * 0.5), 0.009 + 0.004 * top);
    return [o.p[0], o.p[1] + 0.012 * top, o.p[2]];
  }, (u) => { const [a, y] = dupattaPath(u); return onTorso(a, Math.min(0.6, y)).n; }, 32, 3, 0.004);
  b.add(dupatta, { bones: (x, y) => torsoBones(y), slot: 'trim', show: SHOW.dupatta, region: REGION.dupatta, female: torsoFemale, heavy: torsoHeavy, layer: 2 });
  // Kurta: from the waist (close over the shirt-coloured torso) closed to the hip, then front and
  // back panels with slits at the sides, flaring to the knee.
  const kurtaTop = tube([[-0.12, 0.205, 0.17, 0.165], [-0.04, 0.192, 0.15, 0.142], [0.03, 0.177, 0.118, 0.118], [0.075, 0.17, 0.111, 0.111]], 32, TORSO_N);
  const panel = (a0, a1) => ribbon((u, v) => {
    const [x, z] = ringPoint(a0 + (a1 - a0) * v, 0.205 + 0.035 * u, 0.17 + 0.03 * u, 0.165 + 0.03 * u, TORSO_N);
    return [x, -0.12 - u * 0.3, z];
  }, (u, v) => { const a = a0 + (a1 - a0) * v; return [Math.sin(a), 0, Math.cos(a)]; }, 3, 11, 0.004);
  const kurtaOpts = { bones: skirtBones, slot: 'shirt', show: SHOW.kurta, region: REGION.kurta, female: torsoFemale, heavy: torsoHeavy, layer: 3 };
  b.add(kurtaTop, kurtaOpts);
  b.add(lining(kurtaTop), { ...kurtaOpts, ao: 0.55, layer: 5 });
  b.add(panel(-1.22, 1.22), kurtaOpts);
  b.add(panel(1.92, 4.36), kurtaOpts);
  // A school bag, and its straps over the shoulders and under the arms.
  const bag = tube([[0.1, 0.125, 0.04, 0.05], [0.13, 0.135, 0.05, 0.062], [0.22, 0.142, 0.058, 0.068], [0.38, 0.138, 0.055, 0.064], [0.43, 0.118, 0.048, 0.055], [0.455, 0.08, 0.035, 0.04]].map(r => [r[0] + BODY.torsoY, r[1], r[2], r[3], -0.165]), 14, 2.6, true, true);
  b.add(bag, { bones: 'torso', slot: 'extra', show: SHOW.pack, heavy: () => [0, 0, -0.008], ao: (x, y, z) => 1 - 0.3 * smooth(-0.14, -0.12, z), layer: 2 });
  for (const s of [1, -1]) {
    const path = [[-2.55, 0.46], [-2.15, 0.585], [-1.45, 0.598], [-0.95, 0.5], [-0.8, 0.4], [-1.25, 0.33], [-1.7, 0.3], [-2.45, 0.2]].map(([a, y]) => [s * -a, y]);
    const strap = ribbon((u, v) => {
      const f = u * (path.length - 1), i = Math.min(path.length - 2, Math.floor(f)), t = f - i;
      const a = path[i][0] + (path[i + 1][0] - path[i][0]) * t, y = path[i][1] + (path[i + 1][1] - path[i][1]) * t;
      const o = onTorso(a + (v - 0.5) * 0.18, Math.min(0.6, y + (v - 0.5) * 0.01), 0.01);
      return [o.p[0], o.p[1] + 0.004, o.p[2]];
    }, (u) => {
      const f = u * (path.length - 1), i = Math.min(path.length - 2, Math.floor(f));
      return onTorso(path[i][0], Math.min(0.6, path[i][1])).n;
    }, 16, 2, 0.005);
    b.add(strap, { bones: (x, y) => torsoBones(y), slot: 'extra', show: SHOW.pack, female: torsoFemale, heavy: torsoHeavy, layer: 2 });
  }
  const { geometry, indices: [men, women] } = b.build([WOMENS, MENS]);
  return { geometry, men, women };
}
