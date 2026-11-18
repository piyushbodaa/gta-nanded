import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Effects } from '../src/game/effects.js';
import { createRain, updateRain } from '../src/game/rain.js';

test('rain uses the scene resolution, pauses its movement and thins the same drop field on Low', () => {
  const mesh = createRain(), u = mesh.material.uniforms;
  const drops = mesh.geometry.attributes.drop, highCount = mesh.geometry.instanceCount;
  updateRain(mesh, 0.25, 1, 0.6, 720, false);
  assert.ok(mesh.visible);
  assert.equal(u.time.value, 0.25);
  updateRain(mesh, 0, 0.2, 0.6, 450, true);
  assert.equal(u.heightPx.value, 450);
  assert.equal(u.strength.value, 0.2);
  assert.equal(u.time.value, 0.25);
  assert.equal(mesh.geometry.attributes.drop, drops);
  assert.ok(mesh.geometry.instanceCount < highCount);
  updateRain(mesh, 0.25, 0, 0, 720, false);
  assert.equal(mesh.visible, false);
});

test('wet footfalls spray only when a moving shoe plants, at the height of the surface under it', () => {
  const fx = Object.create(Effects.prototype), points = [], sounds = [];
  fx.lastPlanted = -1;
  fx.spawn = (...args) => points.push(args);
  const feet = [{ planted: true }, { planted: false, anchorX: 4, surfaceY: 6, anchorZ: 8 }];
  const p = { state: 'foot', onGround: true, human: { speed: 3, anim: { family: 'ground', feet } } };
  const audio = { sfx: sound => sounds.push(sound) };
  fx.footfalls(0.1, p, 0.8, audio);
  feet[1].planted = true;
  fx.footfalls(0, p, 0.8, audio);
  assert.deepEqual(points, []);
  fx.footfalls(0.1, p, 0.8, audio);
  assert.equal(points.length, 5);
  assert.deepEqual(points[0].slice(0, 3), [4, 6.035, 8]);
  fx.footfalls(0.1, p, 0.8, audio);
  feet[1].planted = false;
  fx.footfalls(0.1, p, 0.8, audio);
  feet[1].planted = true;
  fx.footfalls(0.1, p, 0, audio);
  assert.equal(points.length, 5);
  assert.deepEqual(sounds, ['wetStep', 'shoe']);
});

test('tyre spray originates at each rear contact patch, rotated and raised with the vehicle', () => {
  const fx = Object.create(Effects.prototype), points = [];
  fx.spawn = (...args) => points.push(args);
  const v = { x: 5, y: 3, z: 9, heading: Math.PI / 2, vx: 10, vz: 0,
    model: { wheels: [[0, 1, 0.2, true], [-0.5, -1, 0.2, false], [0.5, -1, 0.2, false]] } };
  fx.tyreSpray(v, 1, 10);
  assert.equal(points.length, 4);
  assert.deepEqual([points[0], points[2]].map(p => p.slice(0, 3)), [[4, 3.09, 9.5], [4, 3.09, 8.5]]);
  assert.ok(points[1][0] < 4 && points[3][0] < 4);
});
