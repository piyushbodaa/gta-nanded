// Every person in the city is drawn by one set of instanced body parts with a
// procedural skeleton: ~14 draw calls for all pedestrians, drivers, riders,
// police and the player, whatever their number.
import * as THREE from 'three';
import { rng, clamp } from '../core/math.js';

// ------------------------------------------------------------------ part geometry
// Smooth, low-poly body parts. Limbs hang from their joint at y = 0.
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
function ellipsoid(rx, ry, rz, cy = 0, cz = 0, w = 10, h = 8) {
  const g = new THREE.SphereGeometry(1, w, h);
  g.scale(rx, ry, rz); g.translate(0, cy, cz);
  return g;
}
function box(w, h, d, x = 0, y = 0, z = 0) { const g = new THREE.BoxGeometry(w, h, d); g.translate(x, y, z); return g; }
/** A limb hanging down from its joint: tapered cylinder with a ball at the joint. */
function limb(rTop, rBot, len, flat = 1, sides = 8) {
  const c = new THREE.CylinderGeometry(rTop, rBot, len, sides, 1, true);
  c.translate(0, -len / 2, 0);
  const j = new THREE.SphereGeometry(rTop, sides, 5);
  const e = new THREE.SphereGeometry(rBot, sides, 4, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2);
  e.translate(0, -len, 0);
  const g = merge(c, j, e);
  g.scale(1, 1, flat);
  return g;
}
function torso() {
  // Chest tapering to the waist, with rounded shoulders.
  const c = new THREE.CylinderGeometry(0.19, 0.155, 0.46, 12, 1, true);
  c.translate(0, 0.23, 0);
  const sh = ellipsoid(0.2, 0.085, 0.118, 0.46, 0, 12, 6);
  const base = new THREE.CircleGeometry(0.155, 12).rotateX(Math.PI / 2);
  const g = merge(c, base);
  g.scale(1, 1, 0.62);
  return merge(g, sh);
}
function head() {
  const neck = new THREE.CylinderGeometry(0.048, 0.055, 0.1, 8, 1, true).translate(0, 0.045, 0);
  const skull = ellipsoid(0.104, 0.122, 0.112, 0.175, 0, 14, 10);
  const nose = new THREE.ConeGeometry(0.022, 0.05, 5).rotateX(Math.PI / 2).translate(0, 0.165, 0.112);
  const ears = [ellipsoid(0.018, 0.03, 0.012, 0.17, 0, 6, 4).translate(0.103, 0, -0.005), ellipsoid(0.018, 0.03, 0.012, 0.17, 0, 6, 4).translate(-0.103, 0, -0.005)];
  return merge(neck, skull, nose, ...ears);
}
function face() {
  // Eyes and brows: the smallest details that make a crowd feel alive.
  const eyes = [ellipsoid(0.016, 0.012, 0.008, 0.195, 0.104, 6, 4).translate(0.038, 0, 0), ellipsoid(0.016, 0.012, 0.008, 0.195, 0.104, 6, 4).translate(-0.038, 0, 0)];
  const brows = [box(0.045, 0.011, 0.012, 0.038, 0.222, 0.103), box(0.045, 0.011, 0.012, -0.038, 0.222, 0.103)];
  return merge(...eyes, ...brows);
}
function hairCap() {
  // Covers the crown and the back of the head, leaving the forehead clear.
  const g = new THREE.SphereGeometry(0.118, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.56);
  g.rotateX(-0.42); g.scale(1, 0.98, 1.03); g.translate(0, 0.186, -0.012);
  return merge(g);
}
function turban() {
  const g = ellipsoid(0.132, 0.1, 0.136, 0.245, -0.012, 14, 8);
  const peak = ellipsoid(0.08, 0.075, 0.05, 0.27, 0.065, 8, 6);
  return merge(g, peak);
}
function skirt(len = 0.86, r0 = 0.18, r1 = 0.27) {
  const g = new THREE.CylinderGeometry(r0, r1, len, 12, 1, true);
  g.translate(0, -len / 2 + 0.04, 0);
  const t = merge(g); t.scale(1, 1, 0.8); return t;
}

const PARTS = [
  { key: 'head', geo: head, color: 'skin' },
  { key: 'face', geo: face, color: 'brow' },
  { key: 'hair', geo: hairCap, color: 'hair' },
  { key: 'bun', geo: () => ellipsoid(0.058, 0.055, 0.05, 0.15, -0.115), color: 'hair', flag: 'bun' },
  { key: 'turban', geo: turban, color: 'extra', flag: 'turban' },
  { key: 'cap', geo: () => merge(new THREE.CylinderGeometry(0.1, 0.108, 0.075, 12).translate(0, 0.285, -0.01)), color: 'cap', flag: 'cap' },
  { key: 'beard', geo: () => ellipsoid(0.088, 0.085, 0.07, 0.105, 0.045, 10, 6), color: 'hair', flag: 'beard' },
  { key: 'torso', geo: torso, color: 'shirt' },
  { key: 'hips', geo: () => { const g = merge(new THREE.CylinderGeometry(0.16, 0.172, 0.2, 12).translate(0, -0.02, 0)); g.scale(1, 1, 0.66); return g; }, color: 'pants' },
  { key: 'skirt', geo: () => skirt(0.86, 0.18, 0.27), color: 'extra', flag: 'skirt' },
  { key: 'kurta', geo: () => skirt(0.44, 0.19, 0.235), color: 'shirt', flag: 'kurta' },
  { key: 'pack', geo: () => merge(box(0.28, 0.34, 0.13, 0, 0.27, -0.17)), color: 'extra', flag: 'pack' },
  { key: 'upperArm', geo: () => limb(0.056, 0.046, 0.29, 0.95), color: 'sleeve', count: 2 },
  { key: 'lowerArm', geo: () => merge(limb(0.044, 0.036, 0.25, 0.95), ellipsoid(0.04, 0.05, 0.026, -0.29, 0.005, 7, 5)), color: 'skin', count: 2 },
  { key: 'thigh', geo: () => limb(0.078, 0.06, 0.43, 0.95), color: 'pants', count: 2 },
  { key: 'shin', geo: () => limb(0.058, 0.044, 0.42, 0.95), color: 'legs', count: 2 },
  { key: 'foot', geo: () => merge(ellipsoid(0.05, 0.04, 0.12, -0.03, 0.05, 8, 5)), color: 'shoes', count: 2 },
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
    extra: 0, cap: 0xf2f2f2, flags: new Set(), scale: r.range(0.94, 1.06), kind, brow: 0x1a120c,
  };
  o.sleeve = o.shirt; o.legs = o.pants;
  switch (kind) {
    case 'woman':
      o.flags.add('skirt'); o.flags.add('bun'); o.extra = r.pick(SARIS); o.shirt = r.chance(0.6) ? o.extra : r.pick(SARIS); o.sleeve = o.shirt;
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
      o.skin = 0xa0672c; o.hair = 0x16110d; o.shirt = 0xe8652e; o.sleeve = 0xe8652e; o.pants = 0x1f3a5f; o.legs = o.pants; o.shoes = 0xf2f2f2; o.scale = 1.02;
      break;
    default:
      if (r.chance(0.25)) { o.flags.add('kurta'); o.pants = r.pick([0xf2f2f2, o.pants]); o.legs = o.pants; }
      if (r.chance(0.12)) { o.flags.add('cap'); o.cap = 0xfafafa; }
  }
  if (o.sleeve === o.shirt && r.chance(0.35) && kind !== 'police' && kind !== 'elder') o.sleeve = o.skin; // short sleeves
  return o;
}

// ------------------------------------------------------------------ renderer
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
    const mat = new THREE.MeshLambertMaterial();
    for (const p of PARTS) {
      const n = capacity * (p.count || 1);
      const mesh = new THREE.InstancedMesh(p.geo(), mat, n);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.setColorAt(0, _c.set(0xffffff));
      mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
      mesh.count = 0;
      mesh.castShadow = true;
      mesh.frustumCulled = false;
      mesh.name = `human-${p.key}`;
      scene.add(mesh);
      this.meshes[p.key] = { mesh, part: p, n: 0 };
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
  update(dt, cam) {
    for (const k in this.meshes) this.meshes[k].n = 0;
    const maxD2 = this.drawDistance * this.drawDistance;
    let drawn = 0;
    for (const h of this.list) {
      if (!h.visible) continue;
      const dx = h.x - cam.x, dz = h.z - cam.z, d2 = dx * dx + dz * dz;
      if (d2 > maxD2) continue;
      if (drawn >= this.capacity) break;
      drawn++;
      // Stride ~1.35 m per cycle walking, longer running.
      const stride = h.speed > 3.2 ? 2.4 : 1.35;
      h.phase += (h.speed / stride) * Math.PI * 2 * dt;
      this._pose(h, d2 > 3600);
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
    let hipL = 0, hipR = 0, kneeL = 0.04, kneeR = 0.04, shL = 0, shR = 0, abL = 0.08, abR = -0.08, elL = -0.15, elR = -0.15;
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
      default: { // idle
        const br = Math.sin(h.t * 1.7 + ph) * 0.02;
        shL = br; shR = -br; bob = br * 0.3;
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
    else { this._emit('hair', _m, o.hair); if (f.has('bun')) this._emit('bun', _m, o.hair); }
    if (f.has('beard')) this._emit('beard', _m, o.hair);
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
