import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PerspectiveCamera, Vector3 } from 'three';
import { GameCamera } from '../src/game/camera.js';
import { Colliders } from '../src/world/colliders.js';
import { wrapAngle } from '../src/core/math.js';
import { world } from './helpers.js';

function driver(colliders = { raycast: () => 1 }) {
  const camera = new PerspectiveCamera(62, 16 / 9, 0.1, 300);
  const chase = new GameCamera(camera, colliders);
  const vehicle = { type: 'hatch', x: 0, z: 0, y: 0, heading: 0, w: 0, vx: 0, vz: 0 };
  const input = { look: { x: 0, y: 0 }, zoom: 0, pointerLocked: true, state: { lookBack: false } };
  const subject = { vehicle, groundY: 0 };
  chase.reset(0);
  function advance(seconds, fps = 60) {
    for (let tick = 0; tick < Math.round(seconds * fps); tick++) {
      vehicle.x += vehicle.vx / fps;
      vehicle.z += vehicle.vz / fps;
      chase.update(1 / fps, input, subject);
    }
  }
  return { chase, camera, vehicle, subject, input, advance };
}

test('a driver can look sideways at speed and tap rear view from a manual orbit', () => {
  const { camera, chase, vehicle, input, advance } = driver();
  vehicle.vz = 22;
  advance(1);
  input.look.x = Math.PI / 2;
  input.look.y = -0.22;
  advance(1 / 60);
  const sideYaw = chase.yaw, sidePitch = chase.pitch;
  advance(0.6);
  assert.ok(Math.abs(wrapAngle(chase.yaw - sideYaw)) < 1e-6);
  assert.equal(chase.pitch, sidePitch);
  input.state.lookBack = true;
  advance(1 / 60);
  assert.ok(camera.getWorldDirection(new Vector3()).z < -0.9);
  assert.ok(camera.position.z > vehicle.z + 4);
  advance(2.5);
  input.state.lookBack = false;
  advance(1 / 60);
  assert.ok(camera.getWorldDirection(new Vector3()).x > 0.8);
  assert.ok(Math.abs(wrapAngle(chase.yaw - sideYaw)) < 1e-6);
  assert.equal(chase.pitch, sidePitch);
  advance(3);
  assert.ok(camera.getWorldDirection(new Vector3()).z > 0.9, 'the chase resumes after the look hold expires');
});

test('an automatic chase tracks the turn even while the driver is looking back', () => {
  const { camera, vehicle, input, advance } = driver();
  vehicle.vz = 10;
  advance(1);
  input.state.lookBack = true;
  for (let tick = 0; tick < 120; tick++) {
    vehicle.heading += Math.PI / 240;
    vehicle.vx = Math.sin(vehicle.heading) * 10;
    vehicle.vz = Math.cos(vehicle.heading) * 10;
    advance(1 / 60);
  }
  input.state.lookBack = false;
  advance(1 / 60);
  assert.ok(camera.getWorldDirection(new Vector3()).x > 0.9, 'the released camera faces the road ahead');
});

test('through an intersection the view leads into a turn and follows the slope at different frame rates', () => {
  for (const fps of [30, 120]) {
    const { vehicle, chase, advance } = driver();
    vehicle.vz = 20;
    vehicle.w = 0.8;
    vehicle.roadPitch = 0.12;
    advance(2, fps);
    assert.ok(chase.lookAt.x - chase.target.x > 0.7, 'the view opens into the bend');
    assert.ok(chase.lookAt.z > vehicle.z + 1.8, 'the look target gets ahead of the moving vehicle');
    assert.ok(Math.hypot(chase.lookAt.x - chase.target.x, chase.lookAt.z - chase.target.z) < 3.4);
    assert.ok(chase.lookAt.y - chase.target.y > 0.5, 'the look target rises with the ramp');
    vehicle.vz = -5;
    advance(2, fps);
    assert.ok(Math.hypot(chase.lookAt.x - chase.target.x, chase.lookAt.z - chase.target.z) < 0.01);
  }
});

test('a close wall can pull the bike camera inside its usual minimum distance', () => {
  const colliders = new Colliders(world().city);
  const { vehicle, chase, camera, input, advance } = driver(colliders);
  vehicle.type = 'bike';
  vehicle.x = 5000;
  vehicle.z = 5000;
  const wallFace = vehicle.x + 0.72;
  colliders.addBox(wallFace + 0.1, vehicle.z, 0.1, 2, 0, 6);
  input.look.x = -Math.PI / 2;
  advance(1 / 60);
  assert.ok(camera.position.x > vehicle.x && camera.position.x < wallFace - 0.3);
  const close = chase.curDist;
  input.look.x = Math.PI;
  advance(1 / 60);
  assert.ok(chase.curDist > close && chase.curDist < 1, 'leaving the wall eases the lens back out');
  advance(1);
  assert.ok(chase.curDist > 3.5);
});
