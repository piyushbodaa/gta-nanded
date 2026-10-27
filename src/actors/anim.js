// How people move. Each frame every person's joints are worked out from what they are doing
// (their pose name, speed, a punch, a jump, the vehicle they sit on) as a pose: a list of joint
// angles and offsets that humans.js turns into bones.
//
// Walking and running plant the feet. Each foot follows a path set by the gait's phase and the
// speed over the ground, and the leg reaches for it (two-bone IK), so a stride always matches the
// ground going by. The pelvis rides as high as the loaded leg allows, the arms swing against the
// legs, the shoulders turn against the hips and the head stays level. When someone starts doing
// something else they ease out of the pose they were in instead of snapping into the next one.
import { clamp, lerp, wrapAngle, TAU } from '../core/math.js';

// ---------------------------------------------------------------- the pose
/** Where each joint sits in a pose. Lengths are metres of an unscaled body, angles radians. */
export const C = {
  RX: 0, RZ: 1, // the body's offset from its position: sideways (+ left) and forward
  BP: 2, BR: 3, // the whole body pitched (+ face down) and rolled (+ right side down) about the pelvis
  PY: 4, PX: 5, PZ: 6, // pelvis height above the ground; pelvis shifted left, forward
  PP: 7, PW: 8, PR: 9, // pelvis pitch (+ forward), yaw (+ turned left), roll (+ right side down)
  TP: 10, TW: 11, TR: 12, // torso, on the pelvis
  HP: 13, HW: 14, HR: 15, // head, on the torso (+ looking down, + left, + right ear down)
  // Pairs, left then right.
  SF: 16, SA: 18, ST: 20, EL: 22, // shoulder flexion (+ forward), abduction (+ out), twist (+ in); elbow (+ bent)
  HF: 24, HA: 26, HT: 28, KN: 30, AN: 32, // hip flexion, abduction, twist; knee (+ bent); ankle (+ toes down)
};
export const N = 34;

/** The body's proportions; humans.js builds the parts to them. */
export const BODY = {
  hipX: 0.095, hipY: -0.04, thigh: 0.43, shin: 0.42, ankle: 0.057, heel: 0.078, ball: 0.12,
  torsoY: 0.06, neck: 0.53, shoulderX: 0.235, shoulderY: 0.47, upperArm: 0.29, forearm: 0.33,
};
const { hipX: HIP_X, hipY: HIP_Y, thigh: TH, shin: SH, ankle: ANK } = BODY;
const legLen = knee => Math.sqrt(TH * TH + SH * SH + 2 * TH * SH * Math.cos(knee));
/** Pelvis height of someone standing at ease, knees not quite locked. */
export const STAND = -HIP_Y + ANK + legLen(0.09);

const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const mj = t => t * t * t * (t * (t * 6 - 15) + 10); // minimum-jerk ease
const ease = (rate, dt) => 1 - Math.exp(-rate * dt);
/** Ankle height above the ground with the foot pitched toes-down by th, rolling on heel or ball. */
const rocker = th => ANK * Math.cos(th) + (th < 0 ? -BODY.heel * Math.sin(th) : BODY.ball * Math.sin(th));

/** A pose from a few named joints over standing: pairs take [left, right] or one value for both. */
function def(o, base) {
  const P = base ? Float32Array.from(base) : new Float32Array(N);
  if (!base) P[C.PY] = STAND;
  for (const k in o) {
    const v = o[k], i = C[k];
    if (Array.isArray(v)) { P[i] = v[0]; P[i + 1] = v[1]; } else { P[i] = v; if (i >= C.SF) P[i + 1] = v; }
  }
  return P;
}
const STANDING = def({ SA: 0.1, ST: 0.15, EL: 0.18 });

// Lying where they fell, on the back or face down, and the way back up from each.
const LIE = {
  back: def({ BP: -1.48, PY: 0.13, RZ: -0.5, TP: 0.04, HP: -0.12, HR: 0.25, SF: [0.25, 0.55], SA: [1.05, 0.8], ST: [-0.3, -0.2], EL: [0.35, 0.95],
    HF: [0.55, 0.06], HA: [0.12, 0.18], HT: [-0.2, -0.35], KN: [1.05, 0.12], AN: [0.25, 0.4] }),
  front: def({ BP: 1.5, PY: 0.13, RZ: 0.5, HW: 1.1, HP: -0.45, SF: [2.3, 0.35], SA: [0.55, 0.3], ST: [0.3, 0.15], EL: [1.7, 0.55],
    HF: [0.1, 0.45], HA: [0.1, 0.35], KN: [0.15, 0.9], AN: [0.55, 0.35] }),
};
const GETUP = {
  back: [
    [0, LIE.back],
    [0.36, def({ BP: -0.35, PY: 0.15, RZ: -0.42, TP: 0.55, HP: 0.1, SF: -0.75, SA: 0.35, ST: -0.3, EL: 0.25, HF: [1.85, 1.7], KN: [1.95, 1.6], AN: [-0.3, -0.15] })],
    [0.72, def({ BP: 0, PY: 0.47, RZ: -0.12, TP: 0.72, HP: -0.35, SF: [0.7, 0.55], SA: 0.25, ST: 0.2, EL: 0.6, HF: [1.62, 1.58], KN: [2.02, 1.98], AN: -0.42 })],
    [1.1, STANDING],
  ],
  front: [
    [0, LIE.front],
    [0.36, def({ BP: 1.15, PY: 0.36, RZ: 0.35, TP: -0.08, HP: -0.6, SF: 1.3, SA: 0.2, ST: 0.3, EL: 0.15, HF: 1.4, KN: 1.6, AN: 0.6 })],
    [0.72, def({ BP: 0.25, PY: 0.56, RZ: 0.12, TP: 0.35, HP: -0.2, SF: [0.5, 0.3], SA: 0.2, ST: 0.2, EL: [0.6, 0.5], HF: [1.5, 0.15], KN: [1.6, 1.75], AN: [-0.1, 0.9] })],
    [1.1, STANDING],
  ],
};
/** How long the way back up takes (peds.js keeps them in their get-up state as long). */
export const GETUP_TIME = 1.1;
const COWER = def({ PY: 0.5, PP: 0.15, TP: 0.7, HP: 0.45, SF: 2.15, SA: 0.45, ST: 0.95, EL: 2.25, HF: 1.6, HA: 0.2, KN: 2.05, AN: -0.45 });
// Leaping out of a car's way: crouch, fly with the arms out ahead, land in a crouch.
const DIVE = [
  [0, STANDING],
  [0.12, def({ PY: 0.78, TP: 0.4, SF: -0.4, EL: 0.4, HF: 0.7, KN: 0.85, AN: -0.25 })],
  [0.32, def({ BP: 0.75, PY: 0.85, TP: 0.2, HP: -0.5, SF: [2.4, 2.25], SA: 0.3, EL: 0.2, HF: [-0.25, 0.3], KN: [0.4, 0.9], AN: 0.4 })],
  [0.6, def({ BP: 0.2, PY: 0.58, TP: 0.55, SF: [0.9, 0.8], SA: 0.25, EL: 0.5, HF: [1.4, 1.3], KN: [1.8, 1.7], AN: [-0.35, -0.3] })],
];
// Hands up, and fists up to fight; three punches thrown from the guard (a jab, a cross, a hook).
const GUARD = { SF: [1.05, 0.85], SA: [0.32, 0.38], ST: [0.6, 0.65], EL: [2.15, 2.3], TW: -0.32, TP: 0.1, HP: 0.06 };
const ARM = ['SF', 'SA', 'ST', 'EL'];
const PUNCHES = [
  // The shoulders turn into a straight punch: the arm angles back across to stay on the line.
  { arm: 0, SF: 1.5, SA: 0.6, ST: 1.15, EL: 0.12, TW: -0.55, PW: -0.22 },
  { arm: 1, SF: 1.48, SA: 0.55, ST: 1.15, EL: 0.1, TW: 0.5, PW: 0.28, PZ: 0.05, TP: 0.18 },
  { arm: 0, SF: 1.22, SA: 1.15, ST: 1.25, EL: 1.6, TW: 0.5, PW: 0.24, wind: -0.65 },
];

// Where the hands and feet go on each kind of vehicle, from the seat (metres: + left, + up, + forward).
const SEATS = {
  auto: { grip: [0.3, 0.3, 0.28], feet: [0.13, -0.44, 0.37], lean: 0.08 },
  bike: { grip: [0.33, 0.22, 0.72], feet: [0.17, -0.42, 0.28], lean: 0.34, two: true },
  scooter: { grip: [0.31, 0.34, 0.76], feet: [0.12, -0.36, 0.33], lean: 0.18, two: true },
  car: { wheel: [0, 0.29, 0.43, 0.18], lean: -0.06 },
};

// ---------------------------------------------------------------- reaching
const _pm = new Float32Array(9), _tm = new Float32Array(9), _v = [0, 0, 0], _ik = { a: 0, c: 0, k: 0 };

/** Euler YXZ (three.js order) as a row-major 3x3. */
function yxz(m, x, y, z) {
  const a = Math.cos(x), b = Math.sin(x), c = Math.cos(y), d = Math.sin(y), e = Math.cos(z), f = Math.sin(z);
  const ce = c * e, cf = c * f, de = d * e, df = d * f;
  m[0] = ce + df * b; m[1] = de * b - cf; m[2] = a * d;
  m[3] = a * f; m[4] = a * e; m[5] = -b;
  m[6] = cf * b - de; m[7] = df + ce * b; m[8] = a * c;
}
/** v into the frame rotated by m (v = mᵀ v). */
function into(m, v) {
  const x = v[0], y = v[1], z = v[2];
  v[0] = m[0] * x + m[3] * y + m[6] * z;
  v[1] = m[1] * x + m[4] * y + m[7] * z;
  v[2] = m[2] * x + m[5] * y + m[8] * z;
}

/**
 * Two-bone IK for a limb hanging down its joint's -y: the joint's angles (a about x, c about z,
 * as Rx(a) Rz(c), no twist) and the bend k of the middle joint that put the end at (dx, dy, dz).
 * bend +1 folds the far bone backwards (a knee), -1 forwards (an elbow).
 */
export function ik2(o, L1, L2, dx, dy, dz, bend) {
  const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
  const dc = clamp(d, Math.abs(L1 - L2) + 0.02, L1 + L2 - 1e-4);
  o.k = Math.PI - Math.acos(clamp((L1 * L1 + L2 * L2 - dc * dc) / (2 * L1 * L2), -1, 1));
  const al = Math.acos(clamp((L1 * L1 + dc * dc - L2 * L2) / (2 * L1 * dc), -1, 1));
  const r = Math.sqrt(dy * dy + dz * dz) || 1e-6;
  o.a = Math.atan2(-dz, -dy) - bend * Math.asin(clamp((d * Math.sin(al)) / r, -1, 1));
  o.c = Math.atan2(dx, -(dy * Math.cos(o.a) + dz * Math.sin(o.a)));
  return o;
}

/** Put leg s's ankle at (x, y, z) in the body's frame (origin at the pelvis height). Needs _pm. */
function reachLeg(P, s, x, y, z) {
  const side = s === 0 ? 1 : -1;
  _v[0] = x - P[C.PX]; _v[1] = y; _v[2] = z - P[C.PZ];
  into(_pm, _v);
  ik2(_ik, TH, SH, _v[0] - side * HIP_X, _v[1] - HIP_Y, _v[2], 1);
  P[C.HF + s] = -_ik.a; P[C.HA + s] = side * _ik.c; P[C.KN + s] = _ik.k; P[C.HT + s] = 0;
}
/** Put arm s's hand at (x, y, z) in the body's frame. Needs _pm and _tm. */
function reachArm(P, s, x, y, z) {
  const side = s === 0 ? 1 : -1;
  _v[0] = x - P[C.PX]; _v[1] = y; _v[2] = z - P[C.PZ];
  into(_pm, _v);
  _v[1] -= BODY.torsoY;
  into(_tm, _v);
  ik2(_ik, BODY.upperArm, BODY.forearm, _v[0] - side * BODY.shoulderX, _v[1] - BODY.shoulderY, _v[2], -1);
  P[C.SF + s] = -_ik.a; P[C.SA + s] = side * _ik.c; P[C.EL + s] = _ik.k; P[C.ST + s] = 0;
}
/** The foot flat (or pitched to th) whatever the leg's angles. */
function footAt(P, s, th) { P[C.AN + s] = th - P[C.PP] + P[C.HF + s] - P[C.KN + s]; }

// ---------------------------------------------------------------- keyframes
/** Pose at time t through keys [[time, pose], ...], eased between them (Catmull-Rom). */
function clip(P, keys, t) {
  let i = 0;
  while (i < keys.length - 2 && t > keys[i + 1][0]) i++;
  const [t1, p1] = keys[i], [t2, p2] = keys[i + 1];
  const p0 = keys[Math.max(0, i - 1)][1], p3 = keys[Math.min(keys.length - 1, i + 2)][1];
  const u = clamp((t - t1) / (t2 - t1), 0, 1), u2 = u * u, u3 = u2 * u;
  for (let c = 0; c < N; c++) {
    const a = p0[c], b = p1[c], d = p2[c], e = p3[c];
    P[c] = 0.5 * (2 * b + (d - a) * u + (2 * a - 5 * b + 4 * d - e) * u2 + (3 * b - a - 3 * d + e) * u3);
  }
}

// ---------------------------------------------------------------- people
const FAMILY = { walk: 'ground', run: 'ground', idle: 'ground', phone: 'ground', wave: 'ground', sit: 'sit', ride: 'ride', lie: 'lie', getup: 'getup', cower: 'cower', dive: 'dive' };
// How quickly each kind of pose takes over from the last one (rad/s of a critically damped ease).
const SETTLE = { ground: 10, sit: 8, ride: 8, lie: 16, getup: 9, cower: 9, dive: 14 };
// Arms at rest [flexion, abduction, twist, elbow]: hanging, clasped behind, on the hips, folded, on a bag's straps.
const ARMS = { hang: [0.05, 0.1, 0.15, 0.18], behind: [-0.34, 0.15, 0.8, 1.2], hips: [-0.12, 0.55, 1.5, 1.15], folded: [0.55, 0.22, 1.15, 1.95], straps: [0.15, 0.12, 0.55, 2.25] };

/** Each person's way of moving: a pace, an arm swing, a posture, what they do with their hands. */
function styleOf(o) {
  const r = Math.random, kind = o.kind, f = o.flags, sari = f.has('skirt');
  const pick = (...opts) => { let x = r(); for (let i = 0; i < opts.length; i += 2) { if ((x -= opts[i + 1]) < 0) return opts[i]; } return 'hang'; };
  const arms = kind === 'elder' ? pick('behind', 0.55) : kind === 'police' ? pick('behind', 0.45, 'hips', 0.2) : kind === 'goon' ? pick('folded', 0.4, 'hips', 0.3)
    : f.has('pack') ? pick('straps', 0.45) : kind === 'man' || kind === 'sikh' || kind === 'farmer' ? pick('folded', 0.12, 'hips', 0.08, 'behind', 0.08) : kind === 'player' ? 'hang' : pick('folded', 0.08);
  return {
    cad: kind === 'elder' ? 0.88 + r() * 0.08 : 0.94 + r() * 0.12,
    swing: (sari ? 0.6 : kind === 'elder' ? 0.55 : 1) * (0.8 + r() * 0.4),
    lean: kind === 'elder' ? 0.1 + r() * 0.08 : f.has('pack') ? 0.05 : r() * 0.03,
    sway: sari || kind === 'woman' ? 1.3 : 1,
    arms: ARMS[arms],
    // Hands behind the back, or on a bag's straps, stay there on the move.
    walkArms: arms === 'behind' || arms === 'straps' ? 0.15 : 1,
    phone: r() < 0.5 ? 'screen' : 'ear',
    side: f.has('skirt') && kind !== 'player', // rides pillion side-saddle
  };
}

function create(h) {
  const r = Math.random;
  const foot = () => ({ x: 0, y: 0, z: 0, pitch: 0, load: 0, reach: 0 });
  return {
    pose: new Float32Array(N), out: new Float32Array(N), off: new Float32Array(N), offV: new Float32Array(N), easing: false,
    root: { x: 0, y: 0, z: 0, yaw: 0, vx: 0, vy: 0, vz: 0, vyaw: 0 }, rootEasing: false,
    family: null, ft: 0, settle: 10, fall: -1, fallTime: 0.55,
    lx: h.x, ly: h.y, lz: h.z, lyaw: h.yaw, t: r() * 100,
    phase: r(), spd: 0, acc: 0, turn: 0, feet: [foot(), foot()],
    shift: 0, shiftTo: r() < 0.5 ? -1 : 1, shiftT: 2 + r() * 6, look: 0, lookTo: 0, lookT: 1 + r() * 5, lookYaw: 0,
    wPhone: 0, wWave: 0, wUp: 0, wGuard: 0, guardT: 0, wPunch: 0, lastPunch: 0, punch: 0, punches: 0,
    wAir: 0, air: false, airLead: 0, airLeap: 0, lastVy: 0, land: 0, landV: 0, footDown: 0,
    style: styleOf(h.outfit),
  };
}

/**
 * Work out this frame's pose for person h (h.anim.out) and their easing root offsets
 * (h.anim.root). lod: 0 close up, 1 a street away (no hands on handlebars), 2 far (body only).
 */
export function animate(h, dt, lod = 0) {
  const a = h.anim || (h.anim = create(h));
  // How fast they really go forward and turn, from where they were last frame.
  const dx = h.x - a.lx, dz = h.z - a.lz, jumped = dx * dx + dz * dz > 9;
  if (dt > 0) {
    const fwd = jumped ? h.speed || 0 : (dx * Math.sin(h.yaw) + dz * Math.cos(h.yaw)) / dt;
    const prev = a.spd;
    // Never faster than they mean to go; slower when something holds them up.
    a.spd += (clamp(Math.min(h.speed || 0, fwd + 0.15), 0, 12) - a.spd) * ease(10, dt);
    a.acc += ((a.spd - prev) / dt - a.acc) * ease(6, dt);
    a.turn += (clamp(jumped ? 0 : wrapAngle(h.yaw - a.lyaw) / dt, -8, 8) - a.turn) * ease(8, dt);
    a.t += dt;
  }
  const fam = FAMILY[h.pose] || 'ground', changed = fam !== a.family, first = a.family === null;
  if (changed) {
    if (!first) {
      // Ease the body over from where it was drawn: into a seat, out of a door, onto the road.
      const R = a.root, ox = a.lx + R.x - h.x, oy = a.ly + R.y - h.y, oz = a.lz + R.z - h.z;
      if (ox * ox + oz * oz < 9 && Math.abs(oy) < 2) {
        R.x = ox; R.y = oy; R.z = oz; R.yaw = wrapAngle(a.lyaw + R.yaw - h.yaw);
        R.vx = R.vy = R.vz = R.vyaw = 0; a.rootEasing = true;
      }
    }
    if (fam === 'lie') {
      // Thrown forward (or hit from behind) lands face down; anything else falls back.
      const fwd = jumped || dt <= 0 ? 0 : (dx * Math.sin(h.yaw) + dz * Math.cos(h.yaw)) / dt;
      a.fall = fwd > 1.2 ? 1 : -1;
      a.fallTime = Math.hypot(dx, dz) / Math.max(dt, 1e-3) > 4 ? 0.4 : 0.55;
    }
    a.family = fam; a.ft = 0; a.settle = SETTLE[fam];
  } else if (fam === 'ground' && !h.air) {
    // A step up a kerb or down off it: the body follows over a moment instead of popping.
    const dy = h.y - a.ly;
    if (Math.abs(dy) > 0.03 && Math.abs(dy) < 0.45) { a.root.y -= dy; a.rootEasing = true; }
  }
  a.ft += dt;
  const P = a.pose;
  P.set(STANDING);
  if (lod >= 2) far(a, h, P);
  else if (fam === 'ground') ground(a, h, P, dt);
  else if (fam === 'sit') sit(a, h, P, lod);
  else if (fam === 'ride') ride(a, h, P, dt, lod);
  else if (fam === 'lie') lie(a, h, P);
  else if (fam === 'getup') clip(P, GETUP[a.fall > 0 ? 'front' : 'back'], a.ft);
  else if (fam === 'cower') cower(a, P);
  else clip(P, DIVE, a.ft);
  // Ease out of the last pose.
  const out = a.out;
  if (changed && !first) {
    for (let i = 0; i < N; i++) { a.off[i] = out[i] - P[i]; a.offV[i] = 0; }
    a.easing = true;
  }
  if (a.easing && dt > 0) {
    const w = a.settle, e = Math.exp(-w * dt);
    let left = 0;
    for (let i = 0; i < N; i++) {
      const x = a.off[i], v = a.offV[i], j = v + w * x;
      a.off[i] = (x + j * dt) * e; a.offV[i] = (v - w * j * dt) * e;
      left = Math.max(left, Math.abs(a.off[i]));
    }
    if (left < 1e-3) { a.off.fill(0); a.offV.fill(0); a.easing = false; }
  }
  if (a.easing) for (let i = 0; i < N; i++) out[i] = P[i] + a.off[i];
  else out.set(P);
  if (a.rootEasing && dt > 0) {
    const R = a.root, w = 9, e = Math.exp(-w * dt);
    let j = R.vx + w * R.x; R.x = (R.x + j * dt) * e; R.vx = (R.vx - w * j * dt) * e;
    j = R.vy + w * R.y; R.y = (R.y + j * dt) * e; R.vy = (R.vy - w * j * dt) * e;
    j = R.vz + w * R.z; R.z = (R.z + j * dt) * e; R.vz = (R.vz - w * j * dt) * e;
    j = R.vyaw + w * R.yaw; R.yaw = (R.yaw + j * dt) * e; R.vyaw = (R.vyaw - w * j * dt) * e;
    if (Math.abs(R.x) + Math.abs(R.y) + Math.abs(R.z) + Math.abs(R.yaw) < 1e-3) { R.x = R.y = R.z = R.yaw = 0; a.rootEasing = false; }
  }
  a.lx = h.x; a.ly = h.y; a.lz = h.z; a.lyaw = h.yaw;
  return out;
}

/** Far away only the body shows: just sit, ride or lie at the right height. */
function far(a, h, P) {
  const fam = a.family;
  if (fam === 'sit' || fam === 'ride') { P[C.PY] = h.seatY || 0.6; P[C.TP] = fam === 'ride' ? 0.25 : 0; }
  else if (fam === 'lie') P.set(LIE[a.fall > 0 ? 'front' : 'back']);
  else if (fam === 'cower' || fam === 'getup') P[C.PY] = 0.5;
}

// ---------------------------------------------------------------- on foot
function ground(a, h, P, dt) {
  const st = a.style, sc = h.outfit.scale || 1;
  const v = a.spd / sc, spin = Math.abs(a.turn);
  const run = smooth(2.0, 2.9, v), k = smooth(0.05, 0.9, v);
  // Turning on the spot steps the feet round too.
  const turning = 0.55 * smooth(0.7, 2.2, spin) * (1 - k), lift = Math.max(k, turning);
  overlayWeights(a, h, dt);
  // The gait: cycles a second, the share of each cycle a foot is down, and how far the body
  // travels over a planted foot.
  // Strides a second, from measured gaits (0.9 at 1.3 m/s, 1.1 at 1.9, 1.5 running at 4.4), a
  // little quicker for shorter people.
  const vc = Math.max(a.spd, 1.8 * turning);
  const f = (lerp(0.47 + 0.3 * vc, 1.18 + 0.06 * vc, run) * st.cad) / Math.sqrt(sc);
  if (dt > 0) a.phase = (a.phase + f * dt) % 1;
  const ph = a.phase * TAU, beta = lerp(0.67 - 0.035 * v, 0.4 - 0.024 * v, run), L = (v * beta) / f;
  const still = 1 - k, guard = a.wGuard * (1 - run);
  // Standing: weight shifts from one leg to the other every few seconds, and the eyes wander.
  if (dt > 0) {
    if ((a.shiftT -= dt) < 0) { a.shiftTo = -a.shiftTo; a.shiftT = 3 + Math.random() * 6; }
    a.shift += (a.shiftTo - a.shift) * ease(1.6, dt);
    if ((a.lookT -= dt) < 0) { a.lookTo = Math.random() < 0.4 ? 0 : (Math.random() - 0.5) * 1.1; a.lookT = 2 + Math.random() * 6; }
    a.look += (a.lookTo * still * (1 - guard) - a.look) * ease(2.5, dt);
  }
  const shift = a.shift * still * (1 - guard);
  // Pelvis: over the standing leg, dropping on the swinging side, turning with the stride; and
  // into a turn as people lean into a corner.
  const mid = ph - beta * Math.PI; // from the left foot's mid-stance
  const bank = clamp((0.5 * a.spd * a.turn) / 9.81, -0.22, 0.22);
  const pu = a.punches % 3, pw = a.wPunch * punchExt(a.punch);
  P[C.PX] = k * lerp(0.022, 0.01, run) * st.sway * Math.cos(mid) + 0.03 * shift;
  P[C.PR] = k * lerp(0.05, 0.035, run) * Math.cos(mid) + 0.045 * shift - 0.5 * bank;
  P[C.PW] = -k * lerp(0.06, 0.1, run) * Math.cos(ph) - 0.14 * guard + pw * (PUNCHES[pu].PW || 0);
  P[C.PP] = 0.02 + run * 0.08;
  P[C.PZ] = pw * (PUNCHES[pu].PZ || 0);
  // Feet: where each one is on its path this frame.
  const width = lerp(lerp(0.115, 0.06, k), 0.035, run) + 0.04 * guard;
  for (let s = 0; s < 2; s++) {
    const o = a.feet[s], side = s === 0 ? 1 : -1;
    footPath(o, (a.phase + 0.5 * s) % 1, L, beta, run, k, lift, v);
    o.x = side * width;
    // Fists up: the left foot leads. Resting on one leg: the other eases out a little.
    o.z += 0.13 * guard * side + 0.05 * still * Math.max(0, -side * a.shift);
  }
  // The pelvis rides as high as the loaded legs reach (a run adds its bounce).
  const low = STAND - 0.07 - 0.006 * Math.max(0, v - 3);
  const bounce = low + (0.018 + 0.0015 * v) * (1 - Math.cos(2 * TAU * (a.phase - beta / 2)));
  const top = lerp(STAND + 0.01, bounce, run) - 0.035 * guard;
  let pull = 0;
  for (let s = 0; s < 2; s++) {
    const o = a.feet[s];
    if (o.load <= 0) continue;
    const lat = o.x - (s === 0 ? HIP_X : -HIP_X), r2 = o.reach * o.reach - o.z * o.z - lat * lat;
    pull = Math.max(pull, o.load * Math.max(0, top - (-HIP_Y + o.y + Math.sqrt(Math.max(0.04, r2)))));
  }
  if (dt > 0 && (a.land || a.landV)) {
    // Landing from a jump: the knees take it and the body springs back up.
    const w = 12, e = Math.exp(-w * dt), j = a.landV + w * a.land;
    a.land = (a.land + j * dt) * e; a.landV = (a.landV - w * j * dt) * e;
    if (Math.abs(a.land) + Math.abs(a.landV) < 1e-4) a.land = a.landV = 0;
  }
  P[C.PY] = top - pull + a.land;
  // Legs reach their feet.
  yxz(_pm, P[C.PP], P[C.PW], P[C.PR]);
  for (let s = 0; s < 2; s++) {
    const o = a.feet[s];
    reachLeg(P, s, o.x, o.y - P[C.PY], o.z);
    footAt(P, s, o.pitch);
    P[C.HT + s] = -0.08; // toes out a little
  }
  // Torso: lean into the speed and into speeding up, the shoulders turning against the hips;
  // breathing at rest. Head: steady, eyes level and ahead.
  P[C.TP] = st.lean * (1 - 0.5 * run) + lerp(0.035, 0.11 + 0.012 * v, run) * k + clamp(a.acc * 0.035, -0.12, 0.18) + 0.012 * still * Math.sin(a.t * 1.7);
  P[C.TW] = k * lerp(0.11, 0.25, run) * Math.cos(ph);
  P[C.TR] = -0.7 * P[C.PR] - 0.4 * bank;
  // Arms: each swings with the opposite leg, a little behind it; at rest they do what this person does.
  const R = st.arms, swW = 0.3 * st.swing, swR = (0.55 + 0.04 * v) * st.swing, move = Math.max(k, run) * st.walkArms;
  for (let s = 0; s < 2; s++) {
    const sw = Math.cos(ph - 0.22 - (s === 0 ? Math.PI : 0)), fwd = Math.max(0, sw);
    P[C.SF + s] = lerp(R[0], lerp(0.03 + swW * sw, -0.12 + swR * sw, run), move) + 0.01 * still * Math.sin(a.t * 1.7);
    P[C.SA + s] = lerp(R[1], lerp(0.1, 0.17, run), move);
    P[C.ST + s] = lerp(R[2], lerp(0.15, 0.42, run), move);
    P[C.EL + s] = lerp(R[3], lerp(0.2 + 0.28 * fwd, 1.42 + 0.22 * sw, run), move);
  }
  upper(a, h, P);
  P[C.HW] = -(P[C.PW] + P[C.TW]) * 0.85 + a.look + a.lookYaw;
  P[C.HP] += -0.75 * (P[C.TP] + P[C.PP]) + 0.04;
  P[C.HR] = -0.6 * (P[C.PR] + P[C.TR]);
  air(a, h, P);
}

/** One foot on its path at phase p of the gait: ankle height and forward offset, pitch, load. */
function footPath(o, p, L, beta, run, k, lift, v) {
  const zc = lerp(0.38, 0.3, run); // the share of a stance ahead of the hip
  const toesUp = lerp(-0.26, -0.06, run) * k, toesDown = lerp(0.5, 0.62, run) * k;
  if (p < beta) {
    // Down: heel strike, foot flat, heel off, toe off, while the body passes over it.
    const u = p / beta;
    o.z = L * (zc - u);
    o.pitch = toesUp * (1 - smooth(0, 0.16, u)) + toesDown * smooth(lerp(0.55, 0.42, run), 1, u);
    o.y = rocker(o.pitch);
    // Pushing off a run, the rear leg lets the body rise away from it instead of holding it down.
    o.load = 1 - smooth(lerp(0.78, 0.5, run), lerp(0.94, 0.72, run), u);
    const s = Math.sin(Math.PI * Math.min(1, u / 0.45));
    o.reach = legLen(lerp(0.09, lerp(0.09 + 0.21 * s * s + 0.2 * smooth(0.6, 0.92, u), 0.3, run), k));
  } else {
    // Swinging through: up off the toes, past the other leg, reaching for the next strike;
    // running, the heel comes up behind first.
    // The swing is planned on the ground, not on the body: the foot leaves the road and lands
    // on it at rest, a whole stride on, while the body travels on over it. Against the body it
    // starts and ends moving back, which (running) loops the heel up behind first.
    const s = (p - beta) / (1 - beta), m = mj(s), sm = s * s * (3 - 2 * s);
    const stride = L / beta, travel = stride - L;
    const reachOut = run * k * (0.08 + 0.015 * v) * smooth(0.45, 0.8, s) * (1 - smooth(0.8, 1, s));
    o.z = L * (zc - 1) + stride * lerp(m, sm, run) - travel * s + reachOut;
    const walk = 0.055 * Math.sin(Math.PI * s) * (1.25 - 0.5 * s);
    const runUp = clamp(0.18 + 0.045 * v, 0.25, 0.55) * Math.sin(Math.PI * Math.pow(s, 0.8));
    o.y = lerp(rocker(toesDown), rocker(toesUp), lerp(m, s, run)) + lift * lerp(walk, runUp, run);
    o.pitch = toesDown * (1 - smooth(lerp(0, 0.1, run), lerp(0.45, 0.6, run), s)) + toesUp * smooth(lerp(0.6, 0.7, run), 1, s);
    o.load = smooth(0.88, 1, s);
    o.reach = legLen(0.09);
  }
}

const punchExt = t => smooth(0, 0.3, t) * (1 - smooth(0.5, 1, t));

/** Ease weight w toward target at rate (most people, most frames, have nothing to ease). */
const toward = (w, target, rate, dt) => (w === target ? w : Math.abs(target - w) < 1e-3 ? target : w + (target - w) * ease(rate, dt));

function overlayWeights(a, h, dt) {
  if (dt <= 0) return;
  a.wPhone = toward(a.wPhone, h.pose === 'phone' ? 1 : 0, 5, dt);
  a.wWave = toward(a.wWave, h.pose === 'wave' ? 1 : 0, 6, dt);
  a.wUp = toward(a.wUp, h.armsUp || 0, 6, dt);
  a.lookYaw = toward(a.lookYaw, h.lookYaw || 0, 6, dt);
  const p = h.punch || 0;
  if (p > 0) {
    // A new punch: the player's combo picks it (jab, cross, hook); anyone else alternates.
    if (a.lastPunch === 0 || p < a.lastPunch) a.punches = h.combo !== undefined ? (h.combo + 2) % 3 : (a.punches + 1 + (Math.random() < 0.25 ? 1 : 0)) % 3;
    a.punch = p; a.guardT = 1.6;
  }
  a.wPunch = toward(a.wPunch, p > 0 ? 1 : 0, p > 0 ? 30 : 10, dt);
  a.lastPunch = p;
  if (a.guardT > 0) a.guardT = Math.max(0, a.guardT - dt);
  a.wGuard = toward(a.wGuard, a.guardT > 0 || h.guard ? 1 : 0, 9, dt);
  // Off the ground: a jump from standing tucks, a running one leaps.
  if (h.air && !a.air) { a.airLead = a.feet[0].load < a.feet[1].load ? 0 : 1; a.airLeap = smooth(1.5, 4, a.spd); }
  if (!h.air && a.air) a.landV = -clamp(Math.abs(a.lastVy) * 0.55, 0.5, 4);
  a.air = Boolean(h.air); a.lastVy = h.vy || 0;
  a.wAir = toward(a.wAir, a.air ? 1 : 0, a.air ? 18 : 12, dt);
}

const mixTo = (P, i, v, w) => { P[i] += (v - P[i]) * w; };

/** Arms and shoulders over the walk: a phone, hailing an auto, fists up, a punch, hands up. */
function upper(a, h, P) {
  if (a.wPhone > 0.01) {
    const w = a.wPhone;
    if (a.style.phone === 'screen') {
      mixTo(P, C.SF + 1, 0.72, w); mixTo(P, C.SA + 1, 0.12, w); mixTo(P, C.ST + 1, 0.55, w); mixTo(P, C.EL + 1, 1.95, w);
      mixTo(P, C.SF, 0.42, w); mixTo(P, C.ST, 0.6, w); mixTo(P, C.EL, 1.55, w);
      mixTo(P, C.HP, 0.42, w);
    } else {
      mixTo(P, C.SF + 1, 0.35, w); mixTo(P, C.SA + 1, 0.38, w); mixTo(P, C.ST + 1, 0.4, w); mixTo(P, C.EL + 1, 2.45, w);
      mixTo(P, C.HR, -0.12, w);
    }
  }
  if (a.wWave > 0.01) {
    // Hailing an auto, Indian style: arm out toward the road, the hand flapping down and up.
    const w = a.wWave, f = Math.sin(a.t * 13);
    mixTo(P, C.SF + 1, 1.35 + 0.22 * f, w); mixTo(P, C.SA + 1, 0.45, w); mixTo(P, C.ST + 1, 0.9, w); mixTo(P, C.EL + 1, 0.3 + 0.18 * f, w);
  }
  const g = a.wGuard * (1 - 0.7 * smooth(2.0, 3.5, a.spd));
  if (g > 0.01) {
    for (const k of ARM) { mixTo(P, C[k], GUARD[k][0], g); mixTo(P, C[k] + 1, GUARD[k][1], g); }
    mixTo(P, C.TW, GUARD.TW, g); P[C.TP] += GUARD.TP * g; P[C.HP] += GUARD.HP * g;
  }
  if (a.wPunch > 0.01) {
    const pu = PUNCHES[a.punches % 3], t = a.punch, e = punchExt(t), w = a.wPunch, s = pu.arm;
    for (const k of ARM) mixTo(P, C[k] + s, lerp(GUARD[k][s], pu[k], e), w);
    const o = 1 - s; // the other hand stays up
    for (const k of ARM) mixTo(P, C[k] + o, GUARD[k][o], w);
    // The body turns through the punch; a hook winds up the other way first.
    let tw = lerp(GUARD.TW, pu.TW, e);
    if (pu.wind) tw = lerp(lerp(GUARD.TW, pu.wind, smooth(0, 0.12, t)), pu.TW, smooth(0.1, 0.36, t)) * (1 - smooth(0.5, 1, t)) + GUARD.TW * smooth(0.5, 1, t);
    mixTo(P, C.TW, tw, w);
    P[C.TP] += w * e * (pu.TP || 0.1);
  }
  if (a.wUp > 0.01) {
    const w = a.wUp;
    for (let s = 0; s < 2; s++) { mixTo(P, C.SF + s, 2.5, w); mixTo(P, C.SA + s, 0.5, w); mixTo(P, C.ST + s, -0.4, w); mixTo(P, C.EL + s, 1.0, w); }
  }
}

/** In the air: tucked going up, legs reaching down to land; a running jump is a leap. */
function air(a, h, P) {
  const w = a.wAir;
  if (w < 0.01) {
    if (a.land < -0.005) for (let s = 0; s < 2; s++) { P[C.SA + s] += -a.land * 2; P[C.SF + s] += -a.land * 2.5; }
    return;
  }
  // Legs straight off the ground, tucked over the top of the jump, reaching down to land.
  const vy = h.vy || 0, up = smooth(-1.5, 1.5, vy), tuck = 1 - smooth(1, 4, Math.abs(vy)), leap = a.airLeap;
  for (let s = 0; s < 2; s++) {
    const lead = s === a.airLead;
    mixTo(P, C.HF + s, lerp(lerp(0.22, 1.1, tuck), lead ? 0.95 : -0.3, leap), w);
    mixTo(P, C.KN + s, lerp(lerp(0.3, 1.75, tuck), lead ? lerp(0.5, 0.75, up) : 1.15, leap), w);
    mixTo(P, C.HA + s, 0.06 + 0.08 * tuck, w); mixTo(P, C.AN + s, 0.4 - 0.25 * tuck, w);
    // Arms swing up with the take-off and spread for balance.
    mixTo(P, C.SF + s, lerp(lerp(0.55, 1.7, up), lead ? -0.55 : 1.0, leap), w);
    mixTo(P, C.SA + s, lerp(0.3, 0.7, tuck), w); mixTo(P, C.EL + s, lerp(0.45, 0.9, leap), w);
  }
  mixTo(P, C.TP, 0.06 + 0.12 * tuck + 0.1 * leap, w);
}

// ---------------------------------------------------------------- vehicles
/** In a seat: hands on the wheel or the handlebar, swaying with the turns and the brakes. */
function sit(a, h, P, lod) {
  const seat = SEATS[h.vType] || SEATS.car, drv = h.vDriver;
  P[C.PY] = h.seatY || 0.55;
  P[C.PP] = -0.08;
  P[C.TP] = (drv ? seat.lean : -0.04) + clamp(-(h.vLong || 0) * 0.012, -0.12, 0.12);
  P[C.TR] = clamp(-(h.vLat || 0) * 0.012, -0.1, 0.1);
  for (let s = 0; s < 2; s++) { P[C.HF + s] = 1.42; P[C.KN + s] = 1.38; P[C.AN + s] = -0.18; P[C.HA + s] = 0.12; P[C.HT + s] = -0.1; }
  // Hands on the thighs by default.
  for (let s = 0; s < 2; s++) { P[C.SF + s] = 0.55; P[C.SA + s] = 0.15; P[C.ST + s] = 0.3; P[C.EL + s] = 1.0; }
  P[C.HW] = drv ? clamp((h.vSteer || 0) * 0.8, -0.5, 0.5) : 0;
  if (!drv || lod > 0) return;
  yxz(_pm, P[C.PP], P[C.PW], P[C.PR]);
  yxz(_tm, P[C.TP], P[C.TW], P[C.TR]);
  const sc = h.outfit.scale || 1;
  if (seat.grip) {
    const [gx, gy, gz] = seat.grip;
    for (let s = 0; s < 2; s++) reachArm(P, s, (s === 0 ? gx : -gx) / sc, gy / sc, gz / sc);
    const [fx, fy, fz] = seat.feet;
    for (let s = 0; s < 2; s++) { reachLeg(P, s, (s === 0 ? fx : -fx) / sc, fy / sc, fz / sc); footAt(P, s, -0.1); }
  } else {
    // A steering wheel turns several times the road wheels; hands at ten to two go round with it.
    const [cx, cy, cz, r] = seat.wheel, turn = clamp((h.vSteer || 0) * 3.5, -1.4, 1.4);
    for (let s = 0; s < 2; s++) {
      const ang = (s === 0 ? 1 : -1) * 0.95 + turn;
      reachArm(P, s, (cx + Math.sin(ang) * r) / sc, (cy + Math.cos(ang) * r * 0.9) / sc, (cz - Math.cos(ang) * r * 0.35) / sc);
    }
  }
}

/** On a two-wheeler: leaning over the bars with it, the left foot down when it stops. */
function ride(a, h, P, dt, lod) {
  const seat = SEATS[h.vType] || SEATS.bike, drv = h.vDriver, sc = h.outfit.scale || 1;
  const Y = h.seatY || 0.8;
  P[C.PY] = Y;
  P[C.HR] = -(h.roll || 0) * 0.5; // the head stays nearer level than the bike
  if (!drv && a.style.side) {
    // Side-saddle on the pillion, legs over the left, as women in saris ride.
    P[C.PW] = 1.45; P[C.TW] = -0.75; P[C.HW] = -0.5; P[C.TP] = 0.04;
    for (let s = 0; s < 2; s++) { P[C.HF + s] = 1.5; P[C.KN + s] = 1.5; P[C.AN + s] = 0.1; P[C.HA + s] = 0.05; }
    for (let s = 0; s < 2; s++) { P[C.SF + s] = 0.38; P[C.SA + s] = 0.12; P[C.ST + s] = 0.55; P[C.EL + s] = 1.3; } // hands in the lap
    return;
  }
  P[C.PP] = 0.12;
  P[C.TP] = drv ? seat.lean : 0.12;
  P[C.HP] = -P[C.TP] * 0.7;
  P[C.HW] = drv ? clamp((h.vSteer || 0) * 0.6, -0.4, 0.4) : 0;
  if (dt > 0) a.footDown += ((drv && (h.vSpeed || 0) < 0.7 ? 1 : 0) - a.footDown) * ease(5, dt);
  if (!drv) {
    for (let s = 0; s < 2; s++) { P[C.HF + s] = 1.25; P[C.KN + s] = 1.55; P[C.AN + s] = 0.1; P[C.HA + s] = 0.2; }
    for (let s = 0; s < 2; s++) { P[C.SF + s] = 0.6; P[C.SA + s] = 0.25; P[C.ST + s] = 0.5; P[C.EL + s] = 1.1; }
    return;
  }
  if (lod > 0) {
    for (let s = 0; s < 2; s++) { P[C.HF + s] = 1.2; P[C.KN + s] = 1.3; P[C.SF + s] = 1.0; P[C.SA + s] = 0.25; P[C.EL + s] = 0.35; }
    return;
  }
  yxz(_pm, P[C.PP], P[C.PW], P[C.PR]);
  yxz(_tm, P[C.TP], P[C.TW], P[C.TR]);
  const [gx, gy, gz] = seat.grip, [fx, fy, fz] = seat.feet;
  for (let s = 0; s < 2; s++) reachArm(P, s, (s === 0 ? gx : -gx) / sc, gy / sc, gz / sc);
  // Feet on the pegs; stopped, the left one goes down to the road beside the bike (which the
  // stand lean tips that way), in the body's own tilted frame.
  const roll = h.roll || 0, cr = Math.cos(roll), sr = Math.sin(roll);
  for (let s = 0; s < 2; s++) {
    let x = s === 0 ? fx : -fx, y = fy, z = fz;
    if (s === 0 && a.footDown > 0.01) {
      const gx2 = 0.36, gy2 = -Y + 0.02;
      const rx = gx2 * cr + gy2 * sr, ry = -gx2 * sr + gy2 * cr;
      x = lerp(x, rx, a.footDown); y = lerp(y, ry, a.footDown); z = lerp(z, 0.12, a.footDown);
    }
    reachLeg(P, s, x / sc, y / sc, z / sc);
    footAt(P, s, s === 0 ? lerp(0.05, 0, a.footDown) : 0.05);
  }
}

// ---------------------------------------------------------------- down and back up
/** Falling: knees go, the body topples (about the feet more than the hips), arms fly; then lie. */
function lie(a, h, P) {
  const end = LIE[a.fall > 0 ? 'front' : 'back'], f = clamp(a.ft / a.fallTime, 0, 1);
  if (f >= 1) {
    P.set(end);
    P[C.TP] += 0.01 * Math.sin(a.t * 1.9); // still breathing
    if (h.y - (h.floor || 0) > 0.05) flail(a, P, 0.5); // in the air above what they fell on (h.floor: a deck, a footpath; the road is 0)
    return;
  }
  const g = f * f, buckle = Math.sin(Math.PI * Math.min(1, f * 1.6));
  for (let i = 0; i < N; i++) P[i] = lerp(STANDING[i], end[i], smooth(0, 1, f));
  P[C.BP] = end[C.BP] * g;
  for (let s = 0; s < 2; s++) {
    P[C.KN + s] += 0.9 * buckle;
    P[C.SF + s] += 1.8 * Math.sin(Math.PI * f);
    P[C.SA + s] += 0.5 * Math.sin(Math.PI * f);
  }
  // Keep the feet out of the road while the body goes over.
  const legs = -HIP_Y + ANK + legLen(P[C.KN]);
  P[C.PY] = Math.max(lerp(STAND, end[C.PY], f * f * f), legs * Math.cos(P[C.BP]) - 0.05);
  P[C.RZ] = end[C.RZ] * Math.abs(Math.sin(P[C.BP]) / Math.sin(end[C.BP]));
  if (h.y - (h.floor || 0) > 0.05) flail(a, P, 1);
}
/** Limbs thrown about in the air (hit by a car). */
function flail(a, P, k) {
  for (let s = 0; s < 2; s++) {
    const t = a.t * 11 + s * 2.1;
    P[C.SF + s] += k * 0.6 * Math.sin(t); P[C.SA + s] += k * 0.4 * Math.sin(t * 1.3 + 1);
    P[C.HF + s] += k * 0.4 * Math.sin(t * 0.9 + 2); P[C.KN + s] += k * 0.4 * (1 + Math.sin(t * 1.1));
  }
}
function cower(a, P) {
  P.set(COWER);
  const tremble = Math.sin(a.t * 31) * 0.015 + Math.sin(a.t * 23) * 0.01;
  P[C.TP] += tremble; P[C.SF] += tremble * 2; P[C.SF + 1] -= tremble * 2;
}
