import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBody, stepBody, forwardSpeed, collidePair } from '../src/actors/vehicle-physics.js';

const dt = 1 / 120;
const run = (v, ctl, seconds) => { for (let t = 0; t < seconds; t += dt) stepBody(v, ctl, dt); return v; };

test('a hatchback reaches 100 km/h in under 9 s and tops out near 140', () => {
  const v = createBody('hatch', 0, 0, 0);
  let t100 = null;
  for (let t = 0; t < 30; t += dt) { stepBody(v, { throttle: 1, brake: 0, steer: 0 }, dt); if (t100 === null && forwardSpeed(v) * 3.6 >= 100) t100 = t; }
  assert.ok(t100 !== null && t100 < 9, `0-100 in ${t100}`);
  const top = forwardSpeed(v) * 3.6;
  assert.ok(top > 120 && top < 160, `top speed ${top}`);
});

test('an auto-rickshaw is an auto-rickshaw', () => {
  const v = run(createBody('auto', 0, 0, 0), { throttle: 1, brake: 0, steer: 0 }, 30);
  assert.ok(forwardSpeed(v) * 3.6 < 70);
});

test('brakes stop the car and then it reverses', () => {
  const v = createBody('hatch', 0, 0, 0);
  v.vz = 20;
  run(v, { throttle: 0, brake: 1, steer: 0 }, 6);
  assert.ok(forwardSpeed(v) < 0, 'holding brake at a stop reverses');
  assert.ok(forwardSpeed(v) > -12, 'reverse is slow');
});

test('cornering grip stays within physics (about 1 g)', () => {
  const v = createBody('hatch', 0, 0, 0);
  v.vz = 50 / 3.6;
  run(v, { throttle: 0.35, brake: 0, steer: 1 }, 2);
  assert.ok(Math.abs(v.latAcc) < 12, `lateral ${v.latAcc}`);
  assert.ok(v.heading > 0.5, 'positive steer turns left');
});

test('the handbrake swings the tail out', () => {
  const v = createBody('hatch', 0, 0, 0);
  v.vz = 60 / 3.6;
  run(v, { throttle: 0.2, brake: 0, steer: 1, handbrake: true }, 1);
  const slide = Math.abs(Math.atan2(v.vx, v.vz) - v.heading);
  assert.ok(slide > 0.3, `slide angle ${slide}`);
});

test('a crash transfers momentum and the heavier body wins', () => {
  const bus = createBody('bus', 0, 0, 0), car = createBody('hatch', 0, 6.8, Math.PI);
  bus.vz = 10;
  const impact = collidePair(bus, car);
  assert.ok(impact > 5);
  assert.ok(car.vz > 0, 'the car is pushed along');
  assert.ok(bus.vz > 6, 'the bus barely slows');
});
