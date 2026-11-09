import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Humans, makeOutfit } from '../src/actors/humans.js';
import { N, THROW_TIME } from '../src/actors/anim.js';
import { GRIPS, GUN_IDS, HAND_GRIP, gunGeometry, gunModel, triangles } from '../src/actors/gun-models.js';
import { WEAPONS } from '../src/game/weapon-data.js';
import { GameCamera } from '../src/game/camera.js';
import { WeaponFx } from '../src/game/weapon-fx.js';

// The soft shade under people and the loot glow are painted on a canvas; a stand-in is enough here.
globalThis.document ??= { createElement: () => ({ getContext: () => ({ createRadialGradient: () => ({ addColorStop() {} }), fillRect() {} }) }) };

const dt = 1 / 60, HAND = [4, 6], SHOULDER = [3, 5], FOOT = [9, 12];
const len = v => Math.hypot(v[0], v[1], v[2]);
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** A crowd of one: where a point on one of their bones is, and the weapon's frame in the world. */
function rig(kind = 'player', seed = 7) {
  const humans = new Humans(new THREE.Scene(), 4);
  const h = humans.add(makeOutfit(kind, seed), 0, 0);
  const at = (bone, x, y, z) => {
    const d = humans.data, o = h._row + bone * 12;
    return [d[o] * x + d[o + 1] * y + d[o + 2] * z + d[o + 3], d[o + 4] * x + d[o + 5] * y + d[o + 6] * z + d[o + 7], d[o + 8] * x + d[o + 9] * y + d[o + 10] * z + d[o + 11]];
  };
  const step = () => humans.update(dt, { x: h.x + 3, z: h.z }, null);
  /** The weapon's direction and top in the world (a gun's frame is the body's, turned by the heading). */
  const gun = () => {
    const g = h.anim.gun, c = Math.cos(h.yaw), s = Math.sin(h.yaw);
    return { d: [g.dx * c + g.dz * s, g.dy, -g.dx * s + g.dz * c], u: [g.ux * c + g.uz * s, g.uy, -g.ux * s + g.uz * c] };
  };
  const arm = id => { h.gun = id; h.hold = WEAPONS[id].hold; };
  return { humans, h, at, step, gun, arm };
}
const finite = h => { for (let c = 0; c < N; c++) assert.ok(Number.isFinite(h.anim.out[c]), `channel ${c} is ${h.anim.out[c]}`); };

// ---------------------------------------------------------------- the models
test('every weapon but bare fists has a model inside the phone budget, held where the data says', () => {
  for (const id in WEAPONS) {
    if (id === 'fist') { assert.equal(gunModel(id), null); continue; }
    assert.ok(GUN_IDS.includes(id), `${id} has no model`);
    const m = gunModel(id), g = m.geometry, p = g.attributes.position.array;
    assert.equal(m.hold, WEAPONS[id].hold, `${id} is held as the data says`);
    const tris = triangles(g);
    assert.ok(tris >= 60 && tris <= 600, `${id}: ${tris} triangles`);
    assert.equal(g.attributes.color.count, g.attributes.position.count, `${id}: a colour for every vertex`);
    for (const v of p) assert.ok(Number.isFinite(v), `${id}: a vertex is ${v}`);
    for (const v of g.attributes.normal.array) assert.ok(Number.isFinite(v), `${id}: a normal is ${v}`);
    g.computeBoundingBox();
    const b = g.boundingBox;
    // The fist closes on the model, the muzzle is at its front and on its centre line.
    assert.ok(b.containsPoint(new THREE.Vector3(0, 0, 0)), `${id}: the grip is inside the model`);
    if (m.hold === 'rifle' || m.hold === 'pistol') assert.ok(Math.abs(m.muzzle.z - b.max.z) < 0.04 && Math.abs(m.muzzle.x) < 1e-6, `${id}: muzzle ${m.muzzle.z} vs front ${b.max.z}`);
    else assert.ok(b.containsPoint(m.muzzle), `${id}: what it hits with is on it`);
    assert.deepEqual(m.barrel.toArray(), [0, 0, 1]);
    if (m.hold === 'rifle') {
      assert.ok(m.support && m.support.z > 0.15 && m.support.z < b.max.z, `${id}: the left hand goes on the handguard`);
      assert.ok(m.butt && Math.abs(m.butt.z - b.min.z) < 0.03, `${id}: the butt is the back of the stock`);
    }
  }
  // Real lengths: a pistol a hand long, an assault rifle under a metre, the AWM the longest.
  const length = id => { const g = gunGeometry(id); g.computeBoundingBox(); return g.boundingBox.max.z - g.boundingBox.min.z; };
  assert.ok(length('p92') < 0.26 && length('akm') > 0.8 && length('akm') < 0.95 && length('awm') > 1.1 && length('awm') > length('kar98k'));
});

test('loot crates, the air drop and its parachute are small, finite and stand on the ground', () => {
  for (const id of ['crate', 'airdrop', 'parachute']) {
    const g = gunGeometry(id);
    assert.ok(g, id);
    assert.ok(triangles(g) <= 600, `${id}: ${triangles(g)} triangles`);
    for (const v of g.attributes.position.array) assert.ok(Number.isFinite(v));
    g.computeBoundingBox();
    assert.ok(Math.abs(g.boundingBox.min.y) < 0.02, `${id} sits on its origin (${g.boundingBox.min.y})`);
  }
  assert.ok(gunGeometry('parachute').boundingBox.max.y > 5, 'the canopy is well over the crate');
  assert.equal(gunGeometry('akm'), gunGeometry('akm'), 'built once');
});

// ---------------------------------------------------------------- the poses
test('aiming a rifle: the butt in the right shoulder, the left hand on the handguard, along the aim', () => {
  for (const id of ['akm', 'm416', 'ump45', 's12k', 'kar98k', 'awm']) {
    for (const pitch of [0, 0.5, -0.4]) {
      const { h, at, step, gun, arm } = rig();
      arm(id); h.aim = 1; h.aimPitch = pitch; h.yaw = 0.7;
      for (let i = 0; i < 50; i++) step();
      finite(h);
      const { d, u } = gun(), G = GRIPS[id];
      const want = [Math.sin(h.yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(h.yaw) * Math.cos(pitch)];
      assert.ok(dot(d, want) > 0.998, `${id} at ${pitch}: points along the aim`);
      assert.ok(Math.abs(dot(d, u)) < 1e-6 && u[1] > 0.7, `${id}: upright`);
      const R = at(HAND[1], ...HAND_GRIP), L = at(HAND[0], -HAND_GRIP[0], HAND_GRIP[1], HAND_GRIP[2]);
      const l = [u[1] * d[2] - u[2] * d[1], u[2] * d[0] - u[0] * d[2], u[0] * d[1] - u[1] * d[0]];
      const support = [0, 1, 2].map(k => R[k] + d[k] * G.support[2] + u[k] * G.support[1] + l[k] * G.support[0]);
      assert.ok(len(sub(L, support)) < 0.06, `${id} at ${pitch}: left hand ${len(sub(L, support)).toFixed(3)} m off the handguard`);
      const butt = [0, 1, 2].map(k => R[k] + d[k] * G.butt[2] + u[k] * G.butt[1]);
      assert.ok(len(sub(butt, at(SHOULDER[1], 0, 0, 0))) < 0.2, `${id}: the butt ${len(sub(butt, at(SHOULDER[1], 0, 0, 0))).toFixed(2)} m from the shoulder`);
      // In front of the body and up at the shoulder, not down at the hip.
      const fwd = [Math.sin(h.yaw), 0, Math.cos(h.yaw)], head = at(2, 0, 0, 0);
      assert.ok(dot(sub(R, [h.x, 0, h.z]), fwd) > 0.1 && Math.abs(R[1] - head[1]) < 0.45, `${id}: the fist at ${R.map(v => v.toFixed(2))}`);
    }
  }
});

test('carried, a long gun lies low across the hips, its stock out past the right side and its muzzle past the left', () => {
  for (const id of ['akm', 'm416', 'ump45', 's12k', 'kar98k', 'awm']) {
    const { h, at, step, gun, arm } = rig();
    arm(id); h.aim = 0; h.yaw = -1.1;
    for (let i = 0; i < 60; i++) step();
    finite(h);
    const { d, u } = gun(), G = GRIPS[id], R = at(HAND[1], ...HAND_GRIP), L = at(HAND[0], -HAND_GRIP[0], HAND_GRIP[1], HAND_GRIP[2]);
    const left = [Math.cos(h.yaw), 0, -Math.sin(h.yaw)], fwd = [Math.sin(h.yaw), 0, Math.cos(h.yaw)], mid = [h.x, 0, h.z];
    const butt = [0, 1, 2].map(k => R[k] + d[k] * G.butt[2] + u[k] * G.butt[1]), muzzle = [0, 1, 2].map(k => R[k] + d[k] * G.muzzle[2]);
    const side = p => dot(sub(p, mid), left), shoulder = at(SHOULDER[1], 0, 0, 0);
    // Seen from behind both ends stick out beside the body (its shoulders are 0.235 m out, the hips less; the
    // UMP is the short one).
    assert.ok(side(butt) < (id === 'ump45' ? -0.22 : -0.28), `${id}: the stock ${side(butt).toFixed(2)} m to the left`);
    assert.ok(side(muzzle) > 0.3, `${id}: the muzzle ${side(muzzle).toFixed(2)} m to the left`);
    // Low and in front: below the shoulder, the muzzle down and forward of the body.
    assert.ok(butt[1] < shoulder[1] - 0.1 && muzzle[1] < butt[1] && d[1] < -0.2, `${id}: low, muzzle down (${butt[1].toFixed(2)}, ${muzzle[1].toFixed(2)})`);
    assert.ok(dot(sub(muzzle, mid), fwd) > 0.25 && dot(sub(R, mid), fwd) > 0.12, `${id}: in front of the body`);
    // Both hands on it.
    const l = [u[1] * d[2] - u[2] * d[1], u[2] * d[0] - u[0] * d[2], u[0] * d[1] - u[1] * d[0]];
    const support = [0, 1, 2].map(k => R[k] + d[k] * (G.support[2] - 0.04) + u[k] * G.support[1] + l[k] * G.support[0]);
    assert.ok(len(sub(L, support)) < 0.08, `${id}: left hand ${len(sub(L, support)).toFixed(3)} m off the handguard`);
  }
});

test('aiming a pistol puts both fists out in front on the aim; carried, it hangs at the side', () => {
  const { h, at, step, gun, arm } = rig();
  arm('p92'); h.aim = 1; h.aimPitch = 0.3;
  for (let i = 0; i < 50; i++) step();
  finite(h);
  const R = at(HAND[1], ...HAND_GRIP), L = at(HAND[0], 0, -0.33, 0), { d } = gun();
  assert.ok(len(sub(R, L)) < 0.09, `the hands are together (${len(sub(R, L)).toFixed(3)} m)`);
  assert.ok(R[2] > 0.35 && d[1] > 0.25, `out in front (${R[2].toFixed(2)}) and pointing up the aim`);
  h.aim = 0;
  for (let i = 0; i < 60; i++) step();
  const low = at(HAND[1], ...HAND_GRIP);
  assert.ok(low[1] < 1.0 && gun().d[1] < -0.5, `lowered to ${low[1].toFixed(2)} m, muzzle down`);
  assert.ok(h.anim.gun.on);
});

test('a gun drawn, raised and put away eases over instead of snapping, and goes from the hand', () => {
  const { h, at, step, arm } = rig();
  h.pose = 'idle';
  for (let i = 0; i < 30; i++) step();
  const watch = (frames, change) => {
    let worst = 0, before = [...HAND, 2].map(b => at(b, 0, 0, 0));
    for (let i = 0; i < frames; i++) {
      if (i === 0) change();
      step();
      const now = [...HAND, 2].map(b => at(b, 0, 0, 0));
      for (let k = 0; k < now.length; k++) worst = Math.max(worst, len(sub(now[k], before[k])));
      before = now;
    }
    return worst;
  };
  assert.ok(watch(40, () => arm('akm')) < 0.12, 'drawing');
  assert.ok(watch(40, () => { h.aim = 1; }) < 0.12, 'raising');
  assert.ok(watch(40, () => arm('p92')) < 0.12, 'swapping to a pistol');
  assert.ok(watch(40, () => { h.gun = null; h.hold = 'none'; h.aim = 0; }) < 0.12, 'putting it away');
  assert.equal(h.anim.gun.on, false);
});

test('aiming one way and walking another steps the feet instead of sliding them', () => {
  for (const [name, dir] of [['sideways', Math.PI / 2], ['backwards', Math.PI], ['diagonally back', -2.3]]) {
    const { h, at, step, arm } = rig();
    arm('m416'); h.aim = 1; h.yaw = 0; h.pose = 'walk'; h.speed = 1.9;
    let worst = 0, lowest = Infinity;
    const down = [{}, {}];
    for (let i = 0; i < 300; i++) {
      h.x += Math.sin(dir) * h.speed * dt; h.z += Math.cos(dir) * h.speed * dt;
      step();
      finite(h);
      if (i < 90) continue;
      for (let s = 0; s < 2; s++) {
        const p = at(FOOT[s], 0, -0.057, 0.03), o = down[s];
        lowest = Math.min(lowest, p[1]);
        if (p[1] < 0.03) { if (!o.on) { o.on = true; o.x = p[0]; o.z = p[2]; } worst = Math.max(worst, Math.hypot(p[0] - o.x, p[2] - o.z)); } else o.on = false;
      }
    }
    assert.ok(h.anim.spd > 1.4, `${name}: steps at ${h.anim.spd.toFixed(2)} m/s`);
    assert.ok(worst < 0.12, `${name}: a planted foot slid ${worst.toFixed(3)} m`);
    assert.ok(lowest > -0.05, `${name}: a foot went ${(-lowest).toFixed(3)} m into the road`);
  }
});

test('a grenade winds up, is thrown with the next kick and leaves the hand; a pan swings from the right', () => {
  const { h, step, arm } = rig();
  arm('grenade'); h.aim = 1;
  for (let i = 0; i < 30; i++) step();
  assert.ok(h.anim.gun.on && h.anim.gun.arm);
  h.recoil = 1; // weapons.js: the throw
  step();
  assert.ok(h.anim.throwT > 0);
  let gone = false;
  for (let t = 0; t < THROW_TIME; t += dt) { step(); finite(h); gone ||= !h.anim.gun.on; }
  assert.ok(gone, 'let go mid-throw');
  for (let i = 0; i < 20; i++) step();
  assert.ok(h.anim.gun.on && h.recoil === 0, 'another in hand, the kick died away');
  arm('pan'); h.aim = 0;
  for (let i = 0; i < 30; i++) step();
  h.punch = 0.1; step();
  assert.equal(h.anim.punches % 3, 1, 'the pan swings with the right arm');
});

test('far away an armed officer is posed from fixed angles, and every one is finite', () => {
  const { humans, h, at, step, arm } = rig('police', 4);
  arm('m416'); h.aim = 1;
  const far = () => humans.update(dt, { x: h.x + 40, z: h.z }, null); // a street away: no reaching
  for (let i = 0; i < 30; i++) far();
  finite(h);
  assert.equal(h._lod, 1);
  assert.ok(at(HAND[1], 0, -0.33, 0)[1] > 1.15 && at(HAND[0], 0, -0.33, 0)[1] > 1.1, 'both hands up on the rifle');
  for (const id of ['p92', 'grenade', 'pan']) { arm(id); for (let i = 0; i < 20; i++) far(); finite(h); }
  step();
});

// ---------------------------------------------------------------- the camera
function camRig(weapons) {
  const cam = new GameCamera(new THREE.PerspectiveCamera(62, 2, 0.3, 900), { raycast: () => 1 });
  cam.weapons = weapons;
  const input = { look: { x: 0, y: 0 }, zoom: 0, state: {}, pointerLocked: false };
  const subject = { human: { x: 0, y: 0, z: 0, outfit: { scale: 0.96 } }, speed: 0, heading: 0, groundY: 0 };
  cam.reset(0);
  const run = (s, f) => { for (let t = 0; t < s; t += dt) { f?.(); cam.update(dt, input, subject); } };
  return { cam, input, subject, run };
}

test('without weapons the camera is as it was: no aim, no scope, the same view', () => {
  const { cam, run } = camRig(undefined);
  run(1);
  assert.equal(cam.camera.fov, 62);
  assert.equal(cam.aimK, 0);
  assert.ok(Math.abs(cam.camera.position.distanceTo(new THREE.Vector3(0, 1.55, 0)) - 4.05) < 0.05); // its orbit, a little in from the wall test
});

test('aiming brings the view in over the right shoulder and narrows it; a scope looks from the eye', () => {
  const W = { aiming: false, scoped: false, def: { scope: 0 } };
  const { cam, input, run } = camRig(W);
  run(0.5);
  W.aiming = true;
  run(0.6);
  const p = cam.camera.position, right = new THREE.Vector3(Math.cos(cam.yaw), 0, -Math.sin(cam.yaw));
  assert.ok(Math.abs(cam.camera.fov - 48) < 0.5, `fov ${cam.camera.fov}`);
  assert.ok(Math.hypot(p.x, p.z) < 2.3 && p.dot(right) > 0.35, `at the shoulder: ${p.toArray().map(v => v.toFixed(2))}`);
  // The crosshair (the view's centre) passes over the player's right shoulder, not through them.
  const fwd = cam.camera.getWorldDirection(new THREE.Vector3()), toBody = new THREE.Vector3(0, 1.4, 0).sub(p);
  const miss = toBody.clone().sub(fwd.clone().multiplyScalar(toBody.dot(fwd))).length();
  assert.ok(miss > 0.3, `the aim line passes ${miss.toFixed(2)} m from the body`);
  // Aiming, a drag turns the view less (in proportion to the narrower view).
  const yaw = cam.yaw;
  input.look.x = 0.1; run(dt);
  assert.ok(Math.abs(cam.yaw - yaw - 0.1 * 48 / 62) < 0.01, `turned ${cam.yaw - yaw}`);
  // A sniper's scope: quickly to 62/zoom, from in front of the eyes.
  W.scoped = true; W.def = { scope: 8 };
  run(0.25);
  assert.ok(Math.abs(cam.camera.fov - 62 / 8) < 0.6, `scope fov ${cam.camera.fov}`);
  assert.ok(Math.abs(cam.camera.position.y - 1.54) < 0.15 && Math.hypot(cam.camera.position.x, cam.camera.position.z) < 0.45, `at the eye: ${cam.camera.position.toArray()}`);
  const y2 = cam.yaw;
  input.look.x = 0.1; run(dt);
  assert.ok(cam.yaw - y2 < 0.02, 'a scope turns slowly');
  W.aiming = W.scoped = false;
  run(1);
  assert.ok(Math.abs(cam.camera.fov - 62) < 0.5 && cam.aimK === 0 && cam.scopeK === 0, 'back to the plain view');
});

test('a shot kicks the view up and it settles most of the way back', () => {
  const { cam, run } = camRig({ aiming: true, scoped: false, def: { scope: 0 } });
  run(0.5);
  const p0 = cam.pitch;
  cam.kick(0.05);
  assert.ok(Math.abs(cam.pitch - (p0 - 0.05)) < 1e-9, 'up at once');
  run(0.5);
  assert.ok(Math.abs(cam.pitch - (p0 - 0.02)) < 0.003, `settled to ${cam.pitch - p0}`);
});

// ---------------------------------------------------------------- the effects
function fxGame() {
  const scene = new THREE.Scene(), humans = new Humans(scene, 8), h = humans.add(makeOutfit('player', 7), 0, 0);
  const spawned = [], calls = [];
  const g = {
    scene, humans, started: true, time: 0, player: { human: h, pos: { x: 0, z: 0 } }, camera3: { position: new THREE.Vector3(0, 2, -4) },
    quality: { tier: 'medium', settings: { dynamicShadows: true } },
    effects: { spawn: (...a) => spawned.push(a), sparks: (...a) => calls.push(['sparks', ...a]), dust: (...a) => calls.push(['dust', ...a]) },
    weapons: { scoped: false, loot: [], airdrop: null, grenades: [] },
  };
  const fx = new WeaponFx(g);
  const frame = (n = 1) => { for (let i = 0; i < n; i++) { humans.update(dt, { x: 3, z: 0 }, null); fx.update(dt); } };
  return { g, h, fx, frame, spawned, calls };
}

test('the gun is drawn in the right fist, its muzzle out along the aim, and hidden through a scope', () => {
  const { g, h, fx, frame } = fxGame();
  frame(5);
  assert.equal(fx.guns.akm.count, 0);
  assert.equal(fx.muzzle({}), false, 'no gun, no muzzle');
  h.gun = 'akm'; h.hold = 'rifle'; h.aim = 1;
  frame(40);
  assert.equal(fx.guns.akm.count, 1);
  assert.ok(fx.guns.akm.visible && fx.guns.akm.castShadow);
  const e = fx.guns.akm.instanceMatrix.array, hand = new THREE.Vector3(e[12], e[13], e[14]);
  const d = g.humans.data, o = h._row + 6 * 12;
  const wrist = new THREE.Vector3(d[o + 1] * -0.33 + d[o + 3], d[o + 5] * -0.33 + d[o + 7], d[o + 9] * -0.33 + d[o + 11]);
  assert.ok(hand.distanceTo(wrist) < 0.03, 'in the fist');
  const m = {};
  assert.ok(fx.muzzle(m));
  assert.ok(m.z - hand.z > 0.4 && Math.abs(m.x - hand.x) < 0.02, `muzzle ${[m.x, m.y, m.z].map(v => v.toFixed(2))} ahead of the fist`);
  g.weapons.scoped = true;
  frame();
  assert.equal(fx.guns.akm.count, 0, 'not drawn through the scope');
  assert.ok(fx.muzzle(m), 'but the muzzle is still known');
  g.quality.settings.dynamicShadows = false; g.weapons.scoped = false;
  frame();
  assert.equal(fx.guns.akm.castShadow, false, 'no moving shadows on cheap settings');
  const cop = g.humans.add(makeOutfit('police', 3), 4, 4);
  cop.gun = 'p92'; cop.hold = 'pistol'; cop.aim = 1;
  frame(20);
  assert.equal(fx.guns.p92.count, 1, 'an officer\'s pistol');
  assert.ok(fx.muzzleOf(cop, m) && Math.hypot(m.x - 4, m.z - 4) < 1);
});

test('loot shows nearby crates with glow beams and the weapon over them; the air drop parachutes and smokes', () => {
  const { g, fx, frame, spawned } = fxGame();
  g.weapons.loot = [
    { x: 5, y: 0, z: 5, id: 'kar98k', ammo: null, n: 15, taken: false, kind: 'crate' },
    { x: 8, y: 0, z: 0, id: null, ammo: '9mm', n: 45, taken: false, kind: 'crate' },
    { x: 400, y: 0, z: 0, id: 'akm', ammo: null, n: 60, taken: false, kind: 'crate' },
    { x: 3, y: 0, z: 9, id: 'm416', ammo: null, n: 60, taken: true, kind: 'crate' },
  ];
  frame();
  assert.equal(fx.crates.count, 2, 'the two untaken crates in range');
  assert.equal(fx.beams.count, 2);
  assert.equal(fx.guns.kar98k.count, 1, 'the rifle turns over its crate');
  const c = new THREE.Color(); fx.beams.getColorAt(0, c);
  assert.ok(c.b > c.g && c.r > c.g, 'an epic find glows purple');
  g.weapons.loot = [];
  g.weapons.airdrop = { x: 30, z: 30, y: 60, landed: false };
  frame();
  assert.ok(fx.chute.visible && fx.chute.count === 1 && fx.drops.count === 1, 'coming down under its canopy');
  assert.equal(spawned.length, 0, 'no smoke in the air');
  g.weapons.airdrop.landed = true; g.weapons.airdrop.y = 0;
  g.weapons.loot = [{ x: 30, y: 0, z: 30, id: 'awm', ammo: null, n: 10, taken: false, kind: 'airdrop' }];
  frame(120);
  assert.ok(!fx.chute.visible && fx.chute.count === 0, 'the canopy folds away');
  assert.equal(fx.drops.count, 1);
  assert.ok(spawned.length > 10 && spawned.every(s => s[8] > 0.8 && s[9] < 0.3), 'red smoke');
  g.weapons.loot[0].taken = true;
  const n = spawned.length;
  frame(60);
  assert.equal(spawned.length, n, 'no smoke once it is taken');
  assert.equal(fx.drops.count, 0);
});

test('a shot draws a tracer and a flash; it fades, and bullets puff, spark and splash but never bleed', () => {
  const { g, fx, frame, spawned, calls } = fxGame();
  frame();
  assert.equal(fx.tracers.visible, false, 'nothing to draw');
  for (let i = 0; i < 8; i++) fx.shot(0, 1.4, 0.5, 0, 1.2, 40, 's12k'); // a shotgun's pellets
  frame();
  assert.ok(fx.tracers.visible && fx.tracers.geometry.instanceCount === 8);
  const flash = spawned.filter(s => s[6] < 0.1);
  assert.ok(flash.length >= 2 && flash.length <= 3, `one flash for all the pellets (${flash.length} sprites)`);
  frame(30);
  assert.equal(fx.tracers.visible, false, 'faded');
  assert.equal(fx.tracers.geometry.instanceCount, 0);
  spawned.length = 0;
  fx.impact(1, 1, 1, 'body');
  assert.ok(spawned.length > 0 && spawned.every(s => Math.abs(s[8] - s[9]) < 0.1 && Math.abs(s[9] - s[10]) < 0.1), 'a grey puff, no red');
  fx.impact(1, 1, 1, 'metal'); fx.impact(1, 1, 1, 'wall'); fx.impact(1, 0, 1, 'ground'); fx.impact(1, -2.6, 1, 'water');
  assert.ok(calls.some(c => c[0] === 'sparks') && calls.filter(c => c[0] === 'dust').length === 2);
  g.weapons.grenades = [{ x: 1, y: 2, z: 3, vx: 2, vy: 1, vz: 0, t: 1 }];
  frame();
  assert.equal(fx.flying.count, 1);
  g.weapons.grenades = [];
  frame();
  assert.equal(fx.flying.visible, false);
});
