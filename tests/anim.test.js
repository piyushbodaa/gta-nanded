import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Humans, makeOutfit } from '../src/actors/humans.js';
import { ik2, N, STAND } from '../src/actors/anim.js';

// The soft shade under people is painted on a canvas; a stand-in is enough here.
globalThis.document ??= { createElement: () => ({ getContext: () => ({ createRadialGradient: () => ({ addColorStop() {} }), fillRect() {} }) }) };

const BLOCK = 14 * 3 + 5, FOOT = [9, 12], HAND = [4, 6], SHOULDER = [3, 5];
const dt = 1 / 60;

/** A crowd of one, and where a point on one of their bones is in the world. */
function rig(kind = 'man', seed = 3) {
  const humans = new Humans(new THREE.Scene(), 4);
  const h = humans.add(makeOutfit(kind, seed), 0, 0);
  const at = (bone, x, y, z) => {
    const d = humans.data, o = bone * 12;
    return [d[o] * x + d[o + 1] * y + d[o + 2] * z + d[o + 3], d[o + 4] * x + d[o + 5] * y + d[o + 6] * z + d[o + 7], d[o + 8] * x + d[o + 9] * y + d[o + 10] * z + d[o + 11]];
  };
  const step = () => humans.update(dt, { x: h.x + 3, z: h.z }, null);
  return { humans, h, at, step };
}

/** Walk (or run) in a straight line at a steady speed; how far a heel or a ball slides while down. */
function slide(speed) {
  const { h, at, step } = rig();
  h.pose = speed > 3.2 ? 'run' : 'walk'; h.speed = speed;
  let worst = 0, lowest = Infinity;
  const down = [{}, {}, {}, {}];
  for (let i = 0; i < 360; i++) {
    h.z += speed * dt;
    step();
    if (i < 120) continue; // up to speed
    for (let s = 0; s < 2; s++) {
      for (let k = 0; k < 2; k++) {
        const p = at(FOOT[s], 0, -0.057, k === 0 ? -0.07 : 0.12), d = down[s * 2 + k];
        lowest = Math.min(lowest, p[1]);
        if (p[1] < 0.02) {
          if (!d.on) { d.on = true; d.x = p[0]; d.z = p[2]; }
          worst = Math.max(worst, Math.hypot(p[0] - d.x, p[2] - d.z));
        } else d.on = false;
      }
    }
  }
  return { worst, lowest };
}

test('walking and running plant the feet: heels and balls stay put while they are down', () => {
  for (const [speed, most] of [[1.3, 0.06], [1.9, 0.07], [4.4, 0.12], [7.4, 0.16]]) {
    const { worst, lowest } = slide(speed);
    assert.ok(worst < most, `${speed} m/s: a foot slid ${worst.toFixed(3)} m while down`);
    assert.ok(lowest > -0.035, `${speed} m/s: a foot went ${(-lowest).toFixed(3)} m into the road`);
  }
});

test('a stride lengthens with speed instead of the legs spinning faster', () => {
  const cycles = speed => {
    const { h, step } = rig();
    h.pose = 'walk'; h.speed = speed;
    let turns = 0, last = null;
    for (let i = 0; i < 600; i++) {
      h.z += speed * dt;
      step();
      const ph = h.anim.phase;
      if (i > 120) turns += (ph - last + 1) % 1;
      last = ph;
    }
    return turns / (479 * dt);
  };
  const slow = cycles(1.2), brisk = cycles(1.9), run = cycles(4.4);
  assert.ok(slow > 0.75 && slow < 1.1, `strides a second at 1.2 m/s: ${slow}`);
  assert.ok(brisk > slow + 0.1 && run > brisk && run < 1.9, `strides a second: ${slow}, ${brisk}, ${run}`);
  // So each stride covers more ground: about 1.3 m walking slowly, 3 m running.
  assert.ok(1.2 / slow > 1.1 && 4.4 / run > 2.5, `strides of ${1.2 / slow} m and ${4.4 / run} m`);
});

test('changing what someone does eases over instead of snapping', () => {
  const { h, at, step } = rig();
  const moved = (from, to) => Math.hypot(to[0] - from[0], to[1] - from[1], to[2] - from[2]);
  const watch = (frames, change) => {
    let worst = 0;
    let before = [...FOOT, ...HAND, 2].map(b => at(b, 0, 0, 0));
    for (let i = 0; i < frames; i++) {
      if (i === 0) change();
      step();
      const now = [...FOOT, ...HAND, 2].map(b => at(b, 0, 0, 0));
      for (let k = 0; k < now.length; k++) worst = Math.max(worst, moved(before[k], now[k]));
      before = now;
    }
    return worst;
  };
  h.pose = 'idle';
  for (let i = 0; i < 30; i++) step();
  // Into a seat a metre away (getting into an auto), then back out to the kerb.
  assert.ok(watch(60, () => { h.pose = 'sit'; h.seatY = 0.82; h.vType = 'auto'; h.vDriver = true; h.x += 0.8; h.z += 0.6; }) < 0.12, 'into the seat');
  assert.ok(watch(60, () => { h.pose = 'idle'; h.x -= 0.8; h.z -= 0.6; }) < 0.12, 'out of the seat');
  // Knocked down, then back up.
  assert.ok(watch(90, () => { h.pose = 'lie'; }) < 0.2, 'falling');
  assert.ok(watch(80, () => { h.pose = 'getup'; }) < 0.12, 'getting up');
  assert.ok(watch(30, () => { h.pose = 'idle'; }) < 0.12, 'standing');
  const head = at(2, 0, 0, 0)[1];
  assert.ok(Math.abs(head - (STAND + 0.59) * h.outfit.scale) < 0.08, `back on their feet: head bone at ${head}`);
});

test('every pose is a finite set of joint angles', () => {
  const { h, step } = rig('woman', 9);
  const poses = ['idle', 'walk', 'run', 'phone', 'wave', 'sit', 'ride', 'lie', 'getup', 'cower', 'dive'];
  for (const pose of poses) {
    h.pose = pose; h.speed = pose === 'run' ? 5 : pose === 'walk' ? 1.4 : 0;
    h.vType = pose === 'ride' ? 'scooter' : 'auto'; h.vDriver = pose !== 'ride'; h.seatY = 0.75; h.vSteer = 0.3; h.vSpeed = 0;
    h.punch = pose === 'idle' ? 0.4 : 0; h.air = pose === 'run'; h.vy = 2;
    for (let i = 0; i < 40; i++) { h.z += h.speed * dt; step(); }
    assert.equal(h.anim.out.length, N);
    for (let c = 0; c < N; c++) assert.ok(Number.isFinite(h.anim.out[c]), `${pose}: channel ${c} is ${h.anim.out[c]}`);
  }
});

test('the leg and arm solver reaches what it can, and points at what it cannot', () => {
  const o = { a: 0, c: 0, k: 0 };
  const end = (L1, L2, bend) => {
    // Forward kinematics of the same chain: Rx(a) Rz(c) down L1, then the far bone bent by bend*k.
    const rz = v => [v[0] * Math.cos(o.c) - v[1] * Math.sin(o.c), v[0] * Math.sin(o.c) + v[1] * Math.cos(o.c), v[2]];
    const rx = (v, a) => [v[0], v[1] * Math.cos(a) - v[2] * Math.sin(a), v[1] * Math.sin(a) + v[2] * Math.cos(a)];
    const far = rx([0, -L2, 0], bend * o.k), near = [far[0], far[1] - L1, far[2]];
    return rx(rz(near), o.a);
  };
  for (const [dx, dy, dz, bend] of [[0.05, -0.7, 0.2, 1], [-0.1, -0.55, -0.3, 1], [0.08, -0.3, 0.45, -1], [0.2, 0.1, 0.4, -1]]) {
    const [L1, L2] = bend > 0 ? [0.43, 0.42] : [0.29, 0.33];
    ik2(o, L1, L2, dx, dy, dz, bend);
    const p = end(L1, L2, bend);
    assert.ok(Math.hypot(p[0] - dx, p[1] - dy, p[2] - dz) < 1e-3, `reached ${p} for ${[dx, dy, dz]}`);
    assert.ok(o.k >= 0 && o.k < Math.PI, 'bends one way');
  }
  ik2(o, 0.43, 0.42, 0, -2, 0.4, 1);
  const p = end(0.43, 0.42, 1);
  assert.ok(o.k < 0.05 && Math.abs(p[2] / p[1] - 0.4 / -2) < 0.02, 'out of reach: straight, toward the target');
});

test('a punch reaches out from the shoulder, a jump tucks the feet up', () => {
  const { h, at, step } = rig();
  h.pose = 'idle';
  for (let i = 0; i < 30; i++) step();
  h.combo = 1; // a jab
  let reach = 0;
  for (let i = 0; i < 20; i++) {
    h.punch = Math.min(1, i / 19);
    step();
    const s = at(SHOULDER[0], 0, 0, 0), hand = at(HAND[0], 0, -0.33, 0);
    reach = Math.max(reach, hand[2] - s[2]);
  }
  assert.ok(reach > 0.45, `the jab reached ${reach.toFixed(2)} m forward`);
  h.punch = 0;
  for (let i = 0; i < 30; i++) step();
  h.air = true; h.vy = 0.3; h.y = 0.6; // at the top of a jump
  for (let i = 0; i < 20; i++) step();
  const feet = Math.min(at(FOOT[0], 0, -0.057, 0)[1], at(FOOT[1], 0, -0.057, 0)[1]) - h.y;
  assert.ok(feet > 0.2, `feet tucked ${feet.toFixed(2)} m above where they stand`);
});
