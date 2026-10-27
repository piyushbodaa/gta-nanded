import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Humans, makeOutfit } from '../src/actors/humans.js';
import { sendFirst } from '../src/core/buffers.js';

const BLOCK = 14 * 3 + 5; // texels per person: 14 bones, colours with the parts mask, then build and style

// The soft shade under people is painted on a canvas; a stand-in is enough here.
globalThis.document ??= { createElement: () => ({ getContext: () => ({ createRadialGradient: () => ({ addColorStop() {} }), fillRect() {} }) }) };

test('the whole crowd is two meshes, and each person is a row of bones, colours and parts', () => {
  const scene = new THREE.Scene(), humans = new Humans(scene, 16);
  const crowd = scene.children.filter(o => o.name.startsWith('human-') && o.name !== 'human-shade');
  assert.equal(crowd.length, 3, 'a detailed body up close (for men, and for women) and a simple one for everyone else');
  const sikh = humans.add(makeOutfit('sikh', 7), 10, 20);
  const woman = humans.add(makeOutfit('woman', 3), 12, 20);
  const far = humans.add(makeOutfit('man', 5), 10, 120);
  const hidden = humans.add(makeOutfit('man', 6), 11, 20);
  hidden.visible = false;
  humans.update(0.016, { x: 10, z: 10 }, null);
  assert.equal(humans.meshes.reduce((n, m) => n + m.geometry.instanceCount, 0), 3, 'everyone in view, nobody else');
  assert.deepEqual(humans.meshes.map(m => m.geometry.instanceCount), [1, 1, 1], 'the two ten metres off in detail, the man and the woman each in theirs');
  const row = i => humans.data.subarray(i * BLOCK * 4, (i + 1) * BLOCK * 4);
  const colour = (r, slot) => r[(42 + Math.floor(slot / 3)) * 4 + (slot % 3)];
  const mask = r => r[42 * 4 + 3];
  // The sikh: a turban instead of hair, a beard, limbs drawn up close.
  const s = row(0);
  assert.ok(mask(s) & 8 && !(mask(s) & 1) && mask(s) & 32 && mask(s) & 1024);
  assert.equal(colour(s, 0), sikh.outfit.skin);
  assert.equal(colour(s, 3), sikh.outfit.extra);
  // Head bone: above the feet by pelvis + torso + neck, scaled to the person.
  const sc = sikh.outfit.scale, head = [s[2 * 12 + 3], s[2 * 12 + 7], s[2 * 12 + 11]];
  assert.ok(Math.abs(head[0] - 10) < 0.05 && Math.abs(head[2] - 20) < 0.05, `head over the feet: ${head}`);
  assert.ok(Math.abs(head[1] - (0.93 + 0.06 + 0.53) * sc) < 0.06, `head height ${head[1]}`);
  // The woman: hair (with a bun or long hair) and a sari or a kurta.
  const w = row(1);
  assert.ok(mask(w) & 1 && (mask(w) & 2 || mask(w) & 4) && (mask(w) & 128 || mask(w) & 256));
  // A hundred metres off, the limbs are left out.
  assert.equal(mask(row(2)) & 1024, 0);
  void far; void woman;
});

test('only the instances in use are sent to the graphics chip', () => {
  const attr = new THREE.InstancedBufferAttribute(new Float32Array(16 * 100), 16);
  const v0 = attr.version;
  sendFirst(attr, 7);
  assert.deepEqual(attr.updateRanges, [{ start: 0, count: 7 * 16 }]);
  assert.equal(attr.version, v0 + 1);
  sendFirst(attr, 0);
  assert.deepEqual(attr.updateRanges, []);
  assert.equal(attr.version, v0 + 1, 'nothing to send');
});

test('the few detailed bodies go to the people the camera can see', () => {
  const scene = new THREE.Scene(), humans = new Humans(scene, 16);
  humans.nearRadius = 10; humans.nearMax = 1;
  // A phone in landscape, behind the player's shoulder, looking up the street.
  const camera = new THREE.PerspectiveCamera(62, 915 / 412, 0.3, 900);
  camera.position.set(0, 2.2, 0); camera.lookAt(0, 1, 10);
  const ahead = humans.add(makeOutfit('man', 1), 0.5, 6);
  const behind = humans.add(makeOutfit('woman', 2), 0, -2); // nearer the camera, but out of sight
  humans.update(0.016, camera.position, null, camera);
  assert.ok(ahead.near && !behind.near, 'the one in front in detail');
  // Swung round to face the other way, the detail follows.
  camera.lookAt(0, 1, -10);
  humans.update(0.016, camera.position, null, camera);
  assert.ok(behind.near && !ahead.near, 'the one now in front in detail');
  // With no camera (the people viewer), the nearest, as before.
  humans.update(0.016, camera.position, null);
  assert.ok(behind.near && !ahead.near);
});
