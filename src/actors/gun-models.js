// Guns, the pan, the grenade, loot crates and the air drop as small low-poly models: each one a
// single merged geometry with its colours in the vertices, so every weapon type is one
// instanced draw with one shared material (a phone compiles one program for all of them).
//
// Every weapon is modelled in the same frame: the origin is where the right fist closes on it
// (the pistol grip, a rifle's wrist, the pan's handle), +z runs down the barrel, +y is up and +x
// is the holder's left, the body frame anim.js poses people in. GRIPS gives the points the
// animation and the effects need (pure data: anim.js reads it without building anything).
import * as THREE from 'three';

/**
 * Where the right fist holds a weapon, in the forearm bone's own frame (humans.js: -y runs from
 * the elbow to the hand, +z is the thumb side): the middle of the curled fingers, where the
 * arm's reach (anim.js, a forearm of 0.33) ends.
 */
export const HAND_GRIP = [0.012, -0.325, 0.006];

/**
 * Per weapon, in the weapon's frame (metres): muzzle (where tracers start and the flash shows),
 * support (where the left hand goes, null for one-handed holds), butt (what sits in the shoulder),
 * mag (where a reload's hand goes), and how it is held ('melee' and 'throw' ride the forearm).
 */
export const GRIPS = {
  pan: { hold: 'melee', muzzle: [0, 0.01, 0.31], support: null, butt: null, mag: null },
  p92: { hold: 'pistol', muzzle: [0, 0.068, 0.19], support: null, butt: null, mag: [0, -0.07, -0.01] },
  uzi: { hold: 'pistol', muzzle: [0, 0.06, 0.205], support: null, butt: null, mag: [0, -0.15, 0] },
  ump45: { hold: 'rifle', muzzle: [0, 0.07, 0.375], support: [0, 0.01, 0.25], butt: [0, 0.035, -0.35], mag: [0, -0.07, 0.095] },
  akm: { hold: 'rifle', muzzle: [0, 0.075, 0.72], support: [0, 0.045, 0.4], butt: [0, 0.02, -0.43], mag: [0, -0.06, 0.14] },
  m416: { hold: 'rifle', muzzle: [0, 0.075, 0.655], support: [0, 0.04, 0.37], butt: [0, 0.045, -0.335], mag: [0, -0.05, 0.1] },
  s12k: { hold: 'rifle', muzzle: [0, 0.085, 0.73], support: [0, 0.04, 0.42], butt: [0, 0.05, -0.39], mag: [0, -0.05, 0.155] },
  kar98k: { hold: 'rifle', muzzle: [0, 0.062, 0.785], support: [0, 0.02, 0.27], butt: [0, -0.005, -0.47], mag: [0, -0.02, 0.04] },
  awm: { hold: 'rifle', muzzle: [0, 0.08, 0.965], support: [0, 0.01, 0.29], butt: [0, 0.0, -0.53], mag: [0, -0.04, 0.08] },
  grenade: { hold: 'throw', muzzle: [0, 0, 0], support: null, butt: null, mag: null },
};
// The long guns are modelled big and drawn at their real lengths (AKM 0.88 m, M416 0.81 m, AWM
// 1.2 m...): the points above are scaled with them, so the hands land where the model is.
const SCALE = { ump45: 0.95, akm: 0.77, m416: 0.82, s12k: 0.85, kar98k: 0.88, awm: 0.8 };
for (const id in SCALE) for (const k of ['muzzle', 'support', 'butt', 'mag']) if (GRIPS[id][k]) GRIPS[id][k] = GRIPS[id][k].map(v => v * SCALE[id]);
/** The weapons that have a model (everything but bare fists). */
export const GUN_IDS = Object.keys(GRIPS);

// ---------------------------------------------------------------- colours (sRGB)
const BLK = 0x34373a, DARK = 0x26282b, STEEL = 0x5a6066, BLUED = 0x3d4146, POLY = 0x3a3c3f;
const WOOD = 0x9b5a2a, WOOD_D = 0x7a4521, WALNUT = 0x7b4b27, BAKE = 0x8a3f1d;
const OLIVE = 0x5c6740, OLIVE_D = 0x434b2d, LENS = 0x1d3550, RIVET = 0x8d939a;

// ---------------------------------------------------------------- a small modelling kit
const _m = new THREE.Matrix4(), _e = new THREE.Euler(), _c = new THREE.Color(), _q = new THREE.Quaternion();
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _Y = new THREE.Vector3(0, 1, 0);

/** Parts in, one flat-shaded, vertex-coloured, non-indexed geometry out. */
class Kit {
  constructor() { this.pos = []; this.col = []; }
  /** Add a three.js geometry (moved by m) in one colour (or a per-triangle colour function). */
  add(g, hex, m) {
    if (m) g.applyMatrix4(m);
    const flat = g.index ? g.toNonIndexed() : g, p = flat.attributes.position.array;
    for (let i = 0; i < p.length; i += 3) {
      this.pos.push(p[i], p[i + 1], p[i + 2]);
      _c.setHex(typeof hex === 'function' ? hex(i / 9 | 0, p, i) : hex);
      this.col.push(_c.r, _c.g, _c.b);
    }
    g.dispose(); if (flat !== g) flat.dispose();
    return this;
  }
  /** A box of size w×h×d centred at (x, y, z), turned by rx, ry, rz. */
  box(x, y, z, w, h, d, hex, rx = 0, ry = 0, rz = 0) {
    return this.add(new THREE.BoxGeometry(w, h, d), hex, _m.makeRotationFromEuler(_e.set(rx, ry, rz)).setPosition(x, y, z));
  }
  /** A side profile (points as [z, y]) extruded w wide, centred on x: stocks, grips, magazines. */
  side(pts, w, hex, x = 0) {
    const s = new THREE.Shape(pts.map(([z, y]) => new THREE.Vector2(z, y)));
    const g = new THREE.ExtrudeGeometry(s, { depth: w, bevelEnabled: false, curveSegments: 1 });
    // Shape x -> z, shape y -> y, extrusion -> x (a proper rotation, so faces keep their winding).
    g.rotateY(-Math.PI / 2);
    return this.add(g, hex, _m.makeTranslation(x + w / 2, 0, 0));
  }
  /** A round bar along z from z0 to z1 at (x, y), radius r0 at z0 and r1 at z1. */
  tube(z0, z1, r0, y, hex, { r1 = r0, x = 0, seg = 8 } = {}) {
    const g = new THREE.CylinderGeometry(r1, r0, z1 - z0, seg, 1).rotateX(Math.PI / 2);
    return this.add(g, hex, _m.makeTranslation(x, y, (z0 + z1) / 2));
  }
  /** A round part standing on y (a pan, a can) at (x, y, z). */
  can(x, y, z, r0, r1, h, hex, seg = 12) {
    return this.add(new THREE.CylinderGeometry(r1, r0, h, seg, 1), hex, _m.makeTranslation(x, y, z));
  }
  /** A thin bar from a to b (parachute lines, straps). */
  bar(ax, ay, az, bx, by, bz, t, hex) {
    _a.set(ax, ay, az); _b.set(bx - ax, by - ay, bz - az);
    const len = _b.length();
    _q.setFromUnitVectors(_Y, _b.normalize());
    _m.compose(_a.addScaledVector(_b, len / 2), _q, _b.set(1, 1, 1));
    return this.add(new THREE.BoxGeometry(t, len, t), hex, _m);
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.computeVertexNormals(); // non-indexed: one normal per face, the low-poly look
    g.computeBoundingSphere();
    return g;
  }
}

/** A pistol grip, raked back, its middle at the origin (where the fist closes). */
const grip = (k, hex, w = 0.03) => k.side([[0.026, 0.035], [0.012, -0.075], [-0.03, -0.08], [-0.024, 0.035]], w, hex);
/** A trigger and its guard in front of the grip. */
function trigger(k, z = 0.045, y = 0.032, hex = BLK) {
  k.box(0, y - 0.022, z + 0.012, 0.008, 0.006, 0.06, hex);
  k.box(0, y - 0.008, z + 0.04, 0.008, 0.026, 0.006, hex);
  k.box(0, y - 0.006, z, 0.005, 0.02, 0.006, DARK, 0.25);
}
/** A telescopic sight along z, its tube at height y: bells, rings and blue-black glass. */
function scope(k, z0, z1, y, r, bell, hex) {
  k.tube(z0, z1, r, y, hex, { seg: 10 });
  k.tube(z0 - 0.045, z0, r * 1.3, y, hex, { r1: r, seg: 10 }); // eyepiece
  k.tube(z1, z1 + 0.07, r, y, hex, { r1: bell, seg: 10 }); // objective bell
  k.tube(z1 + 0.07, z1 + 0.074, bell * 0.9, y, LENS, { seg: 10 });
  k.tube(z0 - 0.049, z0 - 0.045, r * 1.15, y, LENS, { seg: 10 });
  k.box(0, y + r + 0.008, (z0 + z1) / 2, r * 1.1, 0.016, r * 1.1, hex); // elevation turret
  for (const z of [z0 + 0.04, z1 - 0.04]) k.box(0, (y + 0.07) / 2 + 0.005, z, 0.02, y - 0.06, 0.016, DARK); // rings
}

// ---------------------------------------------------------------- the weapons
const BUILD = {
  pan(k) {
    // A cast-iron pan on a riveted handle, held like a hammer: the handle runs through the fist.
    k.box(0, 0, 0.06, 0.022, 0.016, 0.25, DARK);
    k.box(0, 0.0, 0.19, 0.03, 0.02, 0.03, STEEL);
    k.box(0, 0.011, 0.19, 0.008, 0.004, 0.008, RIVET);
    k.can(0, -0.005, 0.31, 0.112, 0.13, 0.045, BLK, 12); // the bowl, flaring up
    k.can(0, 0.0185, 0.31, 0.118, 0.118, 0.002, 0x55595e, 12); // the cooking face, lighter
  },
  p92(k) {
    k.box(0, 0.068, 0.075, 0.03, 0.034, 0.22, BLUED); // slide
    k.box(0, 0.042, 0.07, 0.026, 0.02, 0.19, BLK); // frame
    k.tube(0.185, 0.19, 0.007, 0.068, DARK);
    k.box(0, 0.088, 0.175, 0.004, 0.007, 0.006, DARK); k.box(0, 0.088, -0.025, 0.016, 0.007, 0.006, DARK); // sights
    k.side([[0.028, 0.04], [0.012, -0.068], [-0.03, -0.064], [-0.026, 0.04], [-0.036, 0.05], [-0.03, 0.055]], 0.03, BLK);
    k.box(0, -0.07, -0.009, 0.032, 0.008, 0.045, DARK);
    trigger(k, 0.04, 0.034);
  },
  uzi(k) {
    k.box(0, 0.058, 0.055, 0.045, 0.055, 0.23, BLK);
    k.tube(0.17, 0.205, 0.009, 0.06, DARK);
    k.side([[0.022, 0.032], [0.016, -0.07], [-0.024, -0.07], [-0.02, 0.032]], 0.032, POLY);
    k.box(0, -0.11, -0.002, 0.026, 0.08, 0.032, STEEL); // the magazine out of the grip
    for (const x of [-0.026, 0.026]) k.box(x, 0.07, -0.02, 0.006, 0.006, 0.17, DARK); // folded stock
    k.box(0, 0.06, -0.106, 0.05, 0.03, 0.006, DARK);
    k.box(0, 0.091, 0.08, 0.01, 0.012, 0.02, STEEL);
    k.box(0, 0.094, 0.15, 0.006, 0.016, 0.008, DARK);
    trigger(k, 0.045, 0.032);
  },
  ump45(k) {
    k.side([[-0.06, 0.03], [0.32, 0.03], [0.32, 0.1], [0.0, 0.106], [-0.06, 0.096]], 0.05, POLY);
    k.box(0, 0.016, 0.24, 0.046, 0.032, 0.16, POLY);
    k.tube(0.32, 0.375, 0.011, 0.07, DARK);
    grip(k, POLY, 0.032);
    k.side([[0.06, 0.03], [0.105, 0.03], [0.125, -0.15], [0.085, -0.155]], 0.028, BLK);
    k.box(0, 0.086, -0.2, 0.014, 0.016, 0.28, DARK); // skeleton stock
    k.side([[-0.06, 0.035], [-0.33, -0.02], [-0.33, -0.004], [-0.06, 0.051]], 0.012, DARK);
    k.box(0, 0.035, -0.34, 0.032, 0.13, 0.02, DARK);
    k.box(0, 0.112, 0.12, 0.02, 0.01, 0.24, DARK); // rail
    k.box(0, 0.123, 0.0, 0.016, 0.014, 0.02, DARK); k.box(0, 0.123, 0.29, 0.006, 0.016, 0.01, DARK);
    trigger(k, 0.04, 0.035);
  },
  akm(k) {
    k.box(0, 0.068, 0.135, 0.044, 0.064, 0.33, BLUED); // receiver
    k.box(0, 0.104, 0.14, 0.036, 0.012, 0.3, BLUED); // dust cover
    k.box(0, 0.112, 0.31, 0.03, 0.022, 0.04, BLUED); // rear sight block
    k.box(0, 0.112, 0.42, 0.03, 0.022, 0.18, WOOD); // upper handguard over the gas tube
    k.side([[0.3, 0.038], [0.5, 0.046], [0.5, 0.09], [0.3, 0.096]], 0.052, WOOD); // lower handguard
    k.tube(0.3, 0.7, 0.0105, 0.075, DARK);
    k.box(0, 0.098, 0.64, 0.016, 0.024, 0.02, DARK); k.box(0, 0.118, 0.64, 0.004, 0.022, 0.006, DARK); // front sight
    k.tube(0.68, 0.722, 0.014, 0.075, DARK, { r1: 0.012 }); // slant brake
    grip(k, WOOD_D);
    k.side([[-0.03, 0.098], [-0.03, 0.038], [-0.12, 0.012], [-0.42, -0.03], [-0.42, 0.083], [-0.1, 0.086]], 0.04, WOOD); // stock, dropping
    k.box(0, 0.027, -0.427, 0.042, 0.118, 0.012, DARK);
    // The banana magazine, curving forward.
    k.side([[0.135, 0.038], [0.16, -0.06], [0.205, -0.165], [0.25, -0.235], [0.195, -0.255], [0.152, -0.18], [0.11, -0.065], [0.085, 0.038]], 0.03, BAKE);
    k.box(0, 0.09, 0.0, 0.02, 0.02, 0.03, BLUED, 0, 0, 0); // receiver back
    k.box(-0.025, 0.08, 0.2, 0.006, 0.012, 0.05, STEEL); // charging handle on the right
    trigger(k, 0.04, 0.036);
  },
  m416(k) {
    k.box(0, 0.075, 0.12, 0.044, 0.05, 0.3, BLK); // upper
    k.box(0, 0.106, 0.22, 0.022, 0.012, 0.48, DARK); // top rail
    for (let z = -0.0; z < 0.46; z += 0.065) k.box(0, 0.115, z, 0.025, 0.006, 0.014, DARK);
    k.box(0, 0.035, 0.08, 0.042, 0.035, 0.22, BLK); // lower
    k.box(0, 0.072, 0.37, 0.052, 0.062, 0.2, BLK); // handguard
    for (const x of [-0.028, 0.028]) k.box(x, 0.072, 0.37, 0.006, 0.014, 0.19, DARK);
    k.tube(0.47, 0.6, 0.01, 0.075, DARK);
    k.tube(0.6, 0.655, 0.013, 0.075, DARK, { seg: 6 });
    grip(k, BLK);
    k.side([[0.11, 0.02], [0.125, -0.08], [0.15, -0.16], [0.095, -0.165], [0.072, -0.08], [0.06, 0.02]], 0.026, DARK);
    k.tube(-0.25, -0.03, 0.016, 0.07, DARK); // buffer tube
    k.side([[-0.17, 0.1], [-0.17, 0.04], [-0.2, -0.005], [-0.335, -0.012], [-0.335, 0.1], [-0.31, 0.116]], 0.042, BLK); // stock
    k.box(0, 0.124, 0.0, 0.016, 0.02, 0.02, DARK); k.box(0, 0.126, 0.43, 0.008, 0.024, 0.014, DARK); // flip sights
    k.box(0, 0.09, -0.035, 0.03, 0.012, 0.018, DARK);
    trigger(k, 0.04, 0.03);
  },
  s12k(k) {
    k.box(0, 0.07, 0.14, 0.05, 0.07, 0.34, BLK);
    k.box(0, 0.109, 0.14, 0.042, 0.01, 0.3, DARK);
    k.box(0, 0.07, 0.43, 0.056, 0.066, 0.22, POLY);
    k.tube(0.32, 0.725, 0.014, 0.085, DARK);
    k.tube(0.3, 0.6, 0.009, 0.112, DARK, { seg: 6 }); // gas tube
    k.box(0, 0.104, 0.69, 0.006, 0.026, 0.012, DARK);
    k.side([[0.1, 0.04], [0.2, 0.04], [0.21, -0.13], [0.11, -0.142]], 0.05, DARK); // box magazine
    grip(k, POLY);
    k.side([[-0.03, 0.102], [-0.03, 0.04], [-0.38, 0.0], [-0.39, 0.0], [-0.39, 0.11], [-0.1, 0.1]], 0.042, POLY);
    k.box(-0.028, 0.08, 0.2, 0.006, 0.012, 0.05, STEEL);
    trigger(k, 0.04, 0.036);
  },
  kar98k(k) {
    // One long walnut stock from the butt to the forend; the right hand on its straight wrist.
    k.side([[-0.47, -0.075], [-0.47, 0.06], [-0.2, 0.046], [-0.04, 0.034], [0.0, 0.05], [0.6, 0.05], [0.625, 0.036], [0.6, 0.018],
      [0.12, 0.0], [0.08, -0.024], [0.0, -0.024], [-0.04, -0.018], [-0.2, -0.036]], 0.042, WALNUT);
    k.box(0, -0.008, -0.477, 0.044, 0.138, 0.012, DARK);
    k.tube(-0.02, 0.2, 0.014, 0.062, BLUED);
    k.tube(0.2, 0.785, 0.0115, 0.062, BLUED, { r1: 0.009 });
    for (const z of [0.36, 0.56]) k.box(0, 0.045, z, 0.046, 0.04, 0.014, BLUED); // barrel bands
    k.box(0, 0.08, 0.77, 0.004, 0.016, 0.008, DARK);
    k.box(-0.036, 0.056, 0.0, 0.042, 0.008, 0.008, STEEL, 0, 0, 0.55); // bolt handle, turned down on the right
    k.box(-0.056, 0.042, 0.0, 0.016, 0.016, 0.016, STEEL);
    scope(k, -0.02, 0.22, 0.118, 0.013, 0.021, DARK);
    trigger(k, 0.05, 0.022, DARK);
  },
  awm(k) {
    k.side([[-0.52, -0.085], [-0.52, 0.09], [-0.44, 0.095], [-0.2, 0.08], [-0.12, 0.05], [-0.05, 0.045], [-0.05, 0.0], [-0.1, -0.012], [-0.2, -0.032], [-0.4, -0.05]], 0.05, OLIVE);
    k.box(0, 0.0, -0.53, 0.052, 0.18, 0.02, DARK); // butt pad
    k.box(0, 0.1, -0.3, 0.036, 0.014, 0.16, DARK); // cheek pad
    k.side([[0.024, 0.03], [0.012, -0.075], [-0.03, -0.08], [-0.03, 0.03]], 0.03, DARK);
    k.box(0, 0.046, 0.31, 0.058, 0.054, 0.7, OLIVE); // chassis
    k.box(0, 0.016, 0.31, 0.05, 0.008, 0.58, OLIVE_D);
    k.tube(-0.05, 0.22, 0.018, 0.082, DARK); // action
    k.tube(0.22, 0.92, 0.0135, 0.082, DARK, { r1: 0.011 });
    k.box(0, 0.082, 0.935, 0.036, 0.032, 0.07, DARK); // muzzle brake
    for (const x of [-0.019, 0.019]) k.box(x, 0.082, 0.935, 0.004, 0.02, 0.04, 0x15161a);
    k.box(-0.03, 0.084, 0.02, 0.04, 0.009, 0.009, DARK, 0, 0, 0.2); k.box(-0.05, 0.08, 0.02, 0.018, 0.018, 0.018, DARK);
    scope(k, -0.05, 0.27, 0.148, 0.018, 0.03, DARK);
    k.box(-0.026, 0.148, 0.11, 0.018, 0.022, 0.022, DARK); // windage turret
    for (const x of [-0.019, 0.019]) k.box(x, 0.004, 0.5, 0.008, 0.008, 0.22, DARK); // bipod, folded
    k.box(0, 0.012, 0.62, 0.044, 0.016, 0.022, DARK);
    k.box(0, -0.02, 0.08, 0.036, 0.05, 0.075, DARK); // magazine
    trigger(k, 0.04, 0.02, DARK);
  },
  grenade(k) {
    // A frag body, its safety lever down the side and the pin's ring at the top.
    const body = new THREE.LatheGeometry([[0.001, -0.037], [0.022, -0.033], [0.031, -0.012], [0.03, 0.014], [0.019, 0.032], [0.001, 0.036]].map(([r, y]) => new THREE.Vector2(r, y)), 8);
    k.add(body, OLIVE);
    k.can(0, 0.044, 0, 0.011, 0.011, 0.018, STEEL, 6);
    k.box(-0.004, 0.012, 0.031, 0.012, 0.06, 0.005, STEEL, 0.18);
    k.add(new THREE.TorusGeometry(0.011, 0.0022, 4, 8), RIVET, _m.makeTranslation(0.018, 0.05, 0));
  },
};

// ---------------------------------------------------------------- props
const PROPS = {
  /** A loot crate: olive boards in a darker frame, rope handles and a plain stencil panel. */
  crate(k) {
    const W = 0.62, H = 0.38, D = 0.42;
    k.box(0, H / 2, 0, W - 0.02, H - 0.02, D - 0.02, OLIVE);
    for (const [x, z] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) k.box(x * (W / 2 - 0.02), H / 2, z * (D / 2 - 0.02), 0.045, H, 0.045, OLIVE_D);
    for (const y of [0.02, H - 0.02]) { k.box(0, y, D / 2 - 0.015, W, 0.04, 0.03, OLIVE_D); k.box(0, y, -D / 2 + 0.015, W, 0.04, 0.03, OLIVE_D); }
    k.box(0, H - 0.005, 0, W - 0.08, 0.012, 0.006, OLIVE_D); // the lid's seam
    k.box(0, H * 0.52, D / 2, W * 0.46, H * 0.3, 0.006, 0xcfc6a2); // stencil panel
    for (const [w, y] of [[0.2, 0.025], [0.13, -0.022]]) k.box(-0.03, H * 0.52 + y, D / 2 + 0.004, w, 0.02, 0.004, 0x3a3d2c);
    for (const x of [-1, 1]) k.box(x * (W / 2 + 0.01), H * 0.62, 0, 0.02, 0.03, 0.14, 0x2c2e25); // handles
  },
  /** The air-drop crate: a big olive box in black straps with grey corners. */
  airdrop(k) {
    const S = 1.1, H = 0.95;
    k.box(0, H / 2, 0, S, H, S, OLIVE);
    for (const t of [-0.22, 0.22]) {
      k.box(t, H / 2, S / 2 + 0.006, 0.09, H + 0.004, 0.012, 0x24261d); k.box(t, H / 2, -S / 2 - 0.006, 0.09, H + 0.004, 0.012, 0x24261d);
      k.box(t, H + 0.006, 0, 0.09, 0.012, S + 0.02, 0x24261d);
      k.box(S / 2 + 0.006, H / 2, t, 0.012, H + 0.004, 0.09, 0x24261d); k.box(-S / 2 - 0.006, H / 2, t, 0.012, H + 0.004, 0.09, 0x24261d);
      k.box(0, H + 0.012, t, S + 0.02, 0.012, 0.09, 0x24261d);
    }
    for (const [x, z] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) for (const y of [0.06, H - 0.06]) k.box(x * (S / 2 - 0.05), y, z * (S / 2 - 0.05), 0.13, 0.13, 0.13, 0x6c7176);
    k.box(0, H * 0.55, S / 2 + 0.008, 0.3, 0.16, 0.004, 0xd8d0b0); k.box(S / 2 + 0.008, H * 0.55, 0, 0.004, 0.16, 0.3, 0xd8d0b0);
  },
  /**
   * The parachute over an air drop: a red and white canopy with its lines down to the crate's top
   * corners. Origin on the crate's lid; the canopy is drawn from both sides.
   */
  parachute(k) {
    const R = 3.2, top = 6.2, seg = 12, rings = 3, rimDrop = 1.5, inset = 0.42;
    const ring = (j, i) => {
      const f = j / rings, a = (i / seg) * Math.PI * 2, r = R * Math.sin(f * 1.25) / Math.sin(1.25);
      return [Math.cos(a) * r, top - rimDrop * (1 - Math.cos(f * Math.PI / 2)), Math.sin(a) * r];
    };
    const pos = [], col = [];
    for (let j = 0; j < rings; j++) {
      for (let i = 0; i < seg; i++) {
        const a = ring(j, i), b = ring(j, i + 1), c = ring(j + 1, i + 1), d = ring(j + 1, i);
        const hex = i % 2 ? 0xc8322b : 0xf1ede2;
        // Outside (seen from below and from the side) and inside, a shade darker.
        for (const [p, sh] of [[[a, c, d, a, b, c], 1], [[a, d, c, a, c, b], 0.72]]) {
          _c.setHex(hex).multiplyScalar(sh);
          for (const v of p) { pos.push(...v); col.push(_c.r, _c.g, _c.b); }
        }
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    k.add(g, (t) => { _c.setRGB(col[t * 9], col[t * 9 + 1], col[t * 9 + 2]); return _c.getHex(); });
    // Lines from every other rim point to the nearest top corner of the crate.
    for (let i = 0; i < seg; i += 1.5) {
      const ii = Math.round(i) % seg, [x, y, z] = ring(rings, ii);
      k.bar(x, y, z, Math.sign(x || 1) * inset, 0.02, Math.sign(z || 1) * inset, 0.012, 0xd9d4c6);
    }
    k.box(0, 0.06, 0, 0.5, 0.06, 0.5, 0x2c2e25); // harness plate on the lid
  },
};

// ---------------------------------------------------------------- the builders
const cache = new Map();

/** The merged geometry for a weapon id (GUN_IDS) or a prop ('crate', 'airdrop', 'parachute'); built once. */
export function gunGeometry(id) {
  let g = cache.get(id);
  if (g) return g;
  const make = BUILD[id] || PROPS[id];
  if (!make) return null;
  const k = new Kit();
  make(k);
  g = k.build();
  if (SCALE[id]) { g.scale(SCALE[id], SCALE[id], SCALE[id]); g.computeBoundingSphere(); }
  g.name = 'gun-' + id;
  cache.set(id, g);
  return g;
}

/**
 * A weapon's model and the points on it: { geometry, grip (the right fist, always the origin),
 * barrel (unit, +z), muzzle, support, butt, mag, hold } as THREE.Vector3s (support/butt/mag null
 * when the weapon has none). Null for an id with no model (fists).
 */
export function gunModel(id) {
  const G = GRIPS[id];
  if (!G) return null;
  const v = a => (a ? new THREE.Vector3(a[0], a[1], a[2]) : null);
  return { geometry: gunGeometry(id), grip: new THREE.Vector3(), barrel: new THREE.Vector3(0, 0, 1), muzzle: v(G.muzzle), support: v(G.support), butt: v(G.butt), mag: v(G.mag), hold: G.hold };
}

/** Triangles in a built geometry (tests keep each weapon inside the phone budget). */
export const triangles = g => (g.index ? g.index.count : g.attributes.position.count) / 3;
