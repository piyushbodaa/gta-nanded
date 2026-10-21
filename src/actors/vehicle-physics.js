// Vehicle dynamics on the ground plane: a bicycle model with tyre slip,
// weight transfer and a handbrake that lets the tail step out, plus impulse
// collisions against the static city and between vehicles.
import { clamp, wrapAngle } from '../core/math.js';
import { VEHICLE_TYPES } from './vehicle-types.js';
import { obbSat } from '../world/colliders.js';

const G = 9.81;

export function createBody(type, x, z, heading) {
  const s = VEHICLE_TYPES[type];
  const a = s.wheelbase * 0.48, b = s.wheelbase * 0.52;
  return {
    type, spec: s, x, z, y: 0, heading,
    vx: 0, vz: 0, w: 0, steer: 0, rpm: 0, gear: 1,
    mass: s.mass, inertia: s.mass * (s.L * s.L + s.W * s.W) / 12 * 1.05,
    a, b, hw: s.W / 2, hd: s.L / 2,
    health: 1000, wheelSpin: 0, slip: 0, longAcc: 0, latAcc: 0, pitch: 0, roll: 0, lean: 0,
    throttle: 0, brake: 0, handbrake: false, braking: false, reversing: false,
    onFire: 0, wrecked: false, airborne: 0, vy: 0,
  };
}

export const speedOf = v => Math.hypot(v.vx, v.vz);
export const forwardSpeed = v => v.vx * Math.sin(v.heading) + v.vz * Math.cos(v.heading);

// Normalised tyre curve: rises linearly, peaks near 8-10 degrees of slip, then fades a little.
const tyre = alpha => Math.sin(1.45 * Math.atan(7.5 * alpha));

/**
 * Integrate one step. ctl: { throttle 0..1, brake 0..1, steer -1..1 (+left), handbrake, analog }.
 * Throttle/brake are "forward/back" pedals: brake while rolling forward stops, then reverses.
 *
 * Frame: forward f = (sin h, cos h), right r = (-cos h, sin h); +w turns left.
 * A sideways (rightward) force F at distance d ahead of the centre gives yaw torque -d*F.
 */
export function stepBody(v, ctl, dt, assist = 1) {
  const s = v.spec, two = s.two;
  let sin = Math.sin(v.heading), cos = Math.cos(v.heading);
  const vF = v.vx * sin + v.vz * cos;
  const vR = -v.vx * cos + v.vz * sin;
  const speed = Math.hypot(vF, vR);

  // Pedals: drive, brake, or reverse once stopped.
  let drive = 0, brake = 0;
  const thr = v.wrecked ? 0 : ctl.throttle, brk = ctl.brake;
  v.reversing = false;
  if (thr > 0.02) { if (vF < -0.5) brake = thr; else drive = thr; }
  if (brk > 0.02) {
    if (vF > 0.5) brake = Math.max(brake, brk);
    else if (thr < 0.02 && !v.wrecked) { drive = -brk; v.reversing = true; }
  }
  v.braking = brake > 0.05 || (ctl.handbrake && speed > 1);

  // Steering lock shrinks with speed so keyboard steering stays sane at 120 km/h.
  const maxLock = s.steerLock / (1 + speed * (two ? 0.045 : 0.05) * assist);
  const target = clamp(ctl.steer, -1, 1) * maxLock;
  const rate = (Math.abs(target) < Math.abs(v.steer) ? 6 : 3.4) * (ctl.analog ? 2 : 1);
  v.steer += clamp(target - v.steer, -rate * dt, rate * dt);
  const delta = v.steer, cd = Math.cos(delta), sd = Math.sin(delta);

  // Engine and brakes.
  const m = v.mass, L = s.wheelbase;
  let Fx = 0;
  if (drive > 0) {
    const frac = clamp(vF / s.top, 0, 1.2);
    Fx = s.accel * m * drive * Math.max(0, 1 - frac * frac) * (frac < 0.15 ? 1.15 : 1);
  } else if (drive < 0) {
    const frac = clamp(-vF / s.reverseTop, 0, 1.2);
    Fx = -s.accel * 0.6 * m * -drive * Math.max(0, 1 - frac * frac);
  }
  const brakeF = brake * s.brake * m;
  const sgn = vF > 0.05 ? 1 : vF < -0.05 ? -1 : 0;

  // Axle loads with weight transfer.
  const h = s.H * 0.35;
  const Nf = clamp(m * G * v.b / L - m * v.longAcc * h / L, m * G * 0.15, m * G * 0.85);
  const Nr = m * G - Nf;
  const mu = s.grip * (v.wrecked ? 0.6 : 1);

  // Slip at each axle.
  const vRf = vR - v.w * v.a, vRr = vR + v.w * v.b;
  const latF = vF * sd + vRf * cd;
  const longF = vF * cd - vRf * sd;
  const alphaF = Math.atan2(latF, Math.max(Math.abs(longF), 0.6));
  const alphaR = Math.atan2(vRr, Math.max(Math.abs(vF), 0.6));
  let FyF = -mu * Nf * tyre(alphaF);
  let FyR = -mu * Nr * tyre(alphaR);
  let FxF = 0, FxR = 0;
  if (s.drive === 'front') FxF = Fx; else FxR = Fx;
  FxF -= brakeF * 0.62 * sgn; FxR -= brakeF * 0.38 * sgn;
  if (ctl.handbrake && !two) {
    // Rear wheels lock: they drag and lose most of their side grip.
    FyR *= 0.3;
    FxR = -sgn * mu * Nr * 0.6;
  } else if (ctl.handbrake) FxR = -sgn * mu * Nr * 0.7;
  // Friction circle per axle.
  const limR = mu * Nr * 1.05, limF = mu * Nf * 1.05;
  const magR = Math.hypot(FxR, FyR); if (magR > limR) { FxR *= limR / magR; FyR *= limR / magR; }
  const magF = Math.hypot(FxF, FyF); if (magF > limF) { FxF *= limF / magF; FyF *= limF / magF; }
  const wheelspin = drive > 0.8 && Math.abs(Fx) > limR * 0.95 && speed < 10;
  v.slip = speed > 4 ? Math.max(Math.abs(alphaR) * 2.2, ctl.handbrake ? 0.6 : 0, wheelspin ? 0.5 : 0) : (wheelspin ? 0.5 : 0);

  // Resultant in the body frame (front forces rotate with the wheels).
  const fLong = FxR + FxF * cd + FyF * sd - 0.42 * vF * Math.abs(vF) - 0.012 * m * G * sgn;
  const fLat = FyR + FyF * cd - FxF * sd;
  const torque = -v.a * (FyF * cd - FxF * sd) + v.b * FyR;

  // Integrate in the world frame.
  v.vx += ((fLong * sin - fLat * cos) / m) * dt;
  v.vz += ((fLong * cos + fLat * sin) / m) * dt;
  v.w += (torque / v.inertia) * dt;
  v.longAcc += (fLong / m - v.longAcc) * clamp(dt * 8, 0, 1);
  v.latAcc += (fLat / m - v.latAcc) * clamp(dt * 8, 0, 1);

  // Re-read body velocities for the assists.
  let nF = v.vx * sin + v.vz * cos, nR = -v.vx * cos + v.vz * sin;
  // Low speed: blend toward the kinematic bicycle model (parking manners, no creeping slides).
  const kin = clamp(1 - Math.abs(nF) / 4, 0, 1);
  if (kin > 0) {
    const wKin = (nF * Math.tan(delta)) / L;
    v.w += (wKin - v.w) * kin * clamp(dt * 12, 0, 1);
    nR *= 1 - kin * clamp(dt * 10, 0, 1);
  }
  // Stability assist: gently damp spin and sideways slide unless the handbrake is on.
  if (!ctl.handbrake) {
    v.w *= 1 - clamp(dt * 1.4 * assist, 0, 0.5);
    nR *= 1 - clamp(dt * 0.8 * assist, 0, 0.5);
  }
  if (two) { v.w *= 1 - clamp(dt * 2.5, 0, 0.5); nR *= 1 - clamp(dt * 3, 0, 0.6); }
  if (nF > s.top * 1.08) nF = s.top * 1.08;
  if (nF < -s.reverseTop * 1.2) nF = -s.reverseTop * 1.2;
  if (drive === 0 && brake > 0 && Math.abs(nF) < 0.4) nF = 0;
  if (drive === 0 && brake === 0 && Math.abs(nF) < 0.08) nF = 0;

  // Rebuild the world velocity in the same basis it was read in, then turn.
  v.vx = nF * sin - nR * cos;
  v.vz = nF * cos + nR * sin;
  v.heading = wrapAngle(v.heading + v.w * dt);
  v.x += v.vx * dt;
  v.z += v.vz * dt;
  v.wheelSpin += (nF / (s.wheelR || 0.3)) * dt;
  v.throttle = drive; v.brake = brake; v.handbrake = Boolean(ctl.handbrake);

  // Suspension feel: nose dips under braking, squats on throttle, body rolls in corners.
  const tp = clamp(-v.longAcc * 0.011, -0.06, 0.06), tr = clamp(-v.latAcc * 0.011, -0.07, 0.07);
  v.pitch += (tp - v.pitch) * clamp(dt * 6, 0, 1);
  v.roll += (tr - v.roll) * clamp(dt * 6, 0, 1);
  if (two) {
    const lean = clamp(Math.atan2(nF * v.w, G), -0.75, 0.75);
    v.lean += (lean - v.lean) * clamp(dt * 7, 0, 1);
  }
  // Engine note: fake gears by speed band.
  const kmh = Math.abs(nF) * 3.6;
  const gears = [0, 22, 45, 70, 100, 140, 999];
  let gear = 1; while (kmh > gears[gear] && gear < 6) gear++;
  v.gear = nF < -0.3 ? -1 : gear;
  const lo = gears[gear - 1], hi = Math.min(gears[gear], s.top * 3.6 * 1.05);
  const rpmT = 0.18 + 0.82 * clamp((kmh - lo) / Math.max(10, hi - lo), 0, 1) * (drive !== 0 ? 1 : 0.6) + (wheelspin ? 0.3 : 0);
  v.rpm += (Math.min(1, rpmT) - v.rpm) * clamp(dt * 6, 0, 1);
  return v;
}

/** Resolve the body against static colliders. Returns the impact speed (m/s) of the worst hit. */
export function collideStatic(v, colliders, contact) {
  let worst = 0;
  for (let iter = 0; iter < 3; iter++) {
    const c = colliders.boxContact(v.x, v.z, v.hw, v.hd, v.heading, contact);
    if (!c) break;
    // Push out.
    v.x += c.nx * (c.depth + 0.002);
    v.z += c.nz * (c.depth + 0.002);
    // Impulse at the contact point against an immovable world.
    const rx = c.px - v.x, rz = c.pz - v.z;
    const pvx = v.vx + v.w * rz, pvz = v.vz - v.w * rx;
    const vn = pvx * c.nx + pvz * c.nz;
    if (vn < 0) {
      const rn = rz * c.nx - rx * c.nz;
      const e = 0.18;
      const j = (-(1 + e) * vn) / (1 / v.mass + (rn * rn) / v.inertia);
      v.vx += (j * c.nx) / v.mass; v.vz += (j * c.nz) / v.mass;
      v.w += (rn * j) / v.inertia;
      // Scrape friction along the wall.
      const tx = -c.nz, tz = c.nx;
      const vt = pvx * tx + pvz * tz;
      const jt = clamp(-vt / (1 / v.mass + 0.0001), -j * 0.35, j * 0.35);
      v.vx += (jt * tx) / v.mass; v.vz += (jt * tz) / v.mass;
      worst = Math.max(worst, -vn);
    }
  }
  return worst;
}

const _sat = {};
/** Vehicle-vehicle impulse. Either body may be kinematic (mass Infinity). Returns impact speed or 0. */
export function collidePair(A, B) {
  const ca = Math.cos(A.heading), sa = Math.sin(A.heading), cb = Math.cos(B.heading), sb = Math.sin(B.heading);
  const res = obbSat(A.x, A.z, A.hw, A.hd, ca, sa, B.x, B.z, B.hw, B.hd, cb, sb, _sat);
  if (!res) return 0;
  const nx = res.nx, nz = res.nz; // from B to A
  const ima = A.kinematic ? 0 : 1 / A.mass, imb = B.kinematic ? 0 : 1 / B.mass;
  if (ima + imb === 0) return 0;
  // Separate.
  const share = ima / (ima + imb);
  A.x += nx * res.depth * share; A.z += nz * res.depth * share;
  B.x -= nx * res.depth * (1 - share); B.z -= nz * res.depth * (1 - share);
  // Contact point: midpoint of the two centres projected onto the overlap.
  const px = (A.x * B.hw + B.x * A.hw) / (A.hw + B.hw), pz = (A.z * B.hw + B.z * A.hw) / (A.hw + B.hw);
  const rax = px - A.x, raz = pz - A.z, rbx = px - B.x, rbz = pz - B.z;
  const vax = A.vx + (A.w || 0) * raz, vaz = A.vz - (A.w || 0) * rax;
  const vbx = B.vx + (B.w || 0) * rbz, vbz = B.vz - (B.w || 0) * rbx;
  const vn = (vax - vbx) * nx + (vaz - vbz) * nz;
  if (vn >= 0) return 0;
  const ran = raz * nx - rax * nz, rbn = rbz * nx - rbx * nz;
  const iia = A.kinematic ? 0 : 1 / A.inertia, iib = B.kinematic ? 0 : 1 / B.inertia;
  const e = 0.25;
  const j = (-(1 + e) * vn) / (ima + imb + ran * ran * iia + rbn * rbn * iib);
  if (!A.kinematic) { A.vx += j * nx * ima; A.vz += j * nz * ima; A.w += ran * j * iia; }
  if (!B.kinematic) { B.vx -= j * nx * imb; B.vz -= j * nz * imb; B.w -= rbn * j * iib; }
  return -vn;
}
