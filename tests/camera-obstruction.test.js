import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveCameraPosition } from '../src/camera-obstruction.js';

const bounds = { minX: -50, maxX: 50, minZ: -50, maxZ: 50 };
const focus = { x: 0, y: 1.6, z: 0 };
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

test('clear camera positions are unchanged, including diagonal and zero-length booms', () => {
  for (const desired of [{ x: 0, y: 10, z: 19 }, { x: 12, y: 7, z: -15 }, focus]) {
    assert.deepEqual(resolveCameraPosition(focus, desired, [], bounds), desired);
  }
  const buildings = [{ x: 20, z: 15, w: 4, d: 4, h: 20 }];
  const desired = { x: 0, y: 10, z: 19 };
  assert.deepEqual(resolveCameraPosition(focus, desired, buildings, bounds), desired);
});

test('a building between actor and clear endpoint shortens the boom before its wall', () => {
  const building = { x: 0, z: 7, w: 8, d: 4, h: 20 };
  const desired = { x: 0, y: 8, z: 19 };
  const resolved = resolveCameraPosition(focus, desired, [building], bounds);
  assert.ok(resolved.z > 4 && resolved.z < 4.55, `camera z=${resolved.z}`);
  assert.ok(distance(focus, resolved) < distance(focus, desired));
  assert.equal(resolved.x, 0);
  assert.ok(Math.abs((resolved.y - focus.y) / resolved.z - (desired.y - focus.y) / desired.z) < 1e-9);
});

test('a thin wall between samples still blocks the camera with lens clearance', () => {
  const wall = { x: 0, z: 5.23, w: 15, d: 0.04, h: 5 };
  const resolved = resolveCameraPosition(focus, { x: 0, y: 2, z: 20 }, [wall], bounds);
  assert.ok(resolved.z > 4.4 && resolved.z < 4.76);
});

test('rotated building footprints use the same geometry as movement collisions', () => {
  const rotated = { x: 0, z: 6, w: 10, d: 1, h: 20, rotation: Math.PI / 4 };
  const desired = { x: 0, y: 4, z: 20 };
  const resolved = resolveCameraPosition(focus, desired, [rotated], bounds);
  const localDepth = Math.sin(rotated.rotation) * resolved.x + Math.cos(rotated.rotation) * (resolved.z - rotated.z);
  assert.ok(localDepth < -rotated.d / 2 - 0.45);
  assert.ok(resolved.z > 4 && resolved.z < 5);
});

test('a camera above a building stays unobstructed only when the full ray clears its roof', () => {
  const building = { x: 0, z: 8, w: 8, d: 5, h: 4 };
  const highFocus = { x: 0, y: 8, z: 0 }, highCamera = { x: 0, y: 12, z: 20 };
  assert.deepEqual(resolveCameraPosition(highFocus, highCamera, [building], bounds), highCamera);
  const endpointAboveRoof = { x: 0, y: 8, z: 20 };
  const resolved = resolveCameraPosition(focus, endpointAboveRoof, [building], bounds);
  assert.ok(resolved.z < 5.05, 'raising only the endpoint must not allow the sight line through a building');
});

test('world edges shorten the boom and the camera stays above ground', () => {
  const nearEdge = { x: 48, y: 1.6, z: 0 };
  const resolved = resolveCameraPosition(nearEdge, { x: 60, y: 3, z: 0 }, [], bounds);
  assert.ok(resolved.x > 49 && resolved.x < 49.55);
  assert.deepEqual(resolveCameraPosition(focus, { x: 0, y: -5, z: 10 }, [], bounds), { x: 0, y: 1, z: 10 });
});

test('a spatial index is queried for the complete boom, including an obstruction near its beginning', () => {
  const wall = { x: 0, z: 3, w: 6, d: 0.2, h: 20 };
  const calls = [];
  const indexed = { query(x, z, radius) { calls.push({ x, z, radius }); return [wall]; } };
  const resolved = resolveCameraPosition(focus, { x: 0, y: 10, z: 20 }, indexed, bounds);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], { x: 0, z: 10, radius: 10.45 });
  assert.ok(resolved.z < 2.45);
});

test('resolving after interpolation prevents a corner from entering the camera sight line', () => {
  const building = { x: 0, z: 10, w: 8, d: 6, h: 15 };
  const left = { x: -14, y: 6, z: 18 }, right = { x: 14, y: 6, z: 18 };
  assert.deepEqual(resolveCameraPosition(focus, left, [building], bounds), left);
  assert.deepEqual(resolveCameraPosition(focus, right, [building], bounds), right);
  const interpolated = { x: 0, y: 6, z: 18 };
  assert.ok(resolveCameraPosition(focus, interpolated, [building], bounds).z < 6.55);
});

test('an elevated sign blocks rays through its face without becoming a wall underneath', () => {
  const sign = { x: 0, z: 8, w: 10, d: 0.25, minY: 6, h: 8 };
  const behindSign = { x: 0, y: 7, z: 20 };
  const blockedView = resolveCameraPosition({ x: 0, y: 7, z: 0 }, behindSign, [sign], bounds);
  assert.ok(blockedView.z > 7 && blockedView.z < 7.425);
  const underneath = { x: 0, y: 4, z: 20 };
  assert.deepEqual(resolveCameraPosition(focus, underneath, [sign], bounds), underneath);
  // h is the absolute top, not a thickness added to minY.
  const above = { x: 0, y: 9, z: 20 };
  assert.deepEqual(resolveCameraPosition({ x: 0, y: 9, z: 0 }, above, [sign], bounds), above);
});

test('the underside of a raised sign has lens clearance while lower rays pass freely', () => {
  const sign = { x: 0, z: 8, w: 10, d: 0.25, minY: 6, h: 8 };
  const nearUnderside = { x: 0, y: 5.8, z: 20 };
  const clipped = resolveCameraPosition({ x: 0, y: 5.8, z: 0 }, nearUnderside, [sign], bounds);
  assert.ok(clipped.z < 7.425, 'the lens must clear the sign even just below its bottom');
  const clearUnder = { x: 0, y: 5.6, z: 20 };
  assert.deepEqual(resolveCameraPosition({ x: 0, y: 5.6, z: 0 }, clearUnder, [sign], bounds), clearUnder);
});

test('a vertical boom from beneath a raised sign stops before its underside', () => {
  const sign = { x: 0, z: 8, w: 10, d: 0.25, minY: 6, h: 8 };
  const underneath = { x: 0, y: 1.6, z: 8 }, above = { x: 0, y: 10, z: 8 };
  const upward = resolveCameraPosition(underneath, above, [sign], bounds);
  assert.equal(upward.x, 0); assert.equal(upward.z, 8);
  assert.ok(upward.y > 5.5 && upward.y < 5.7);
  const downward = resolveCameraPosition(above, underneath, [sign], bounds);
  assert.ok(downward.y > 8.3 && downward.y < 8.5);
});
