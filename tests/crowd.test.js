import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Humans, makeOutfit } from '../src/actors/humans.js';
import { sendFirst } from '../src/core/buffers.js';

const BLOCK = 13 * 3 + 4; // texels per person: 13 bones, then colours and the parts mask

// The soft shade under people is painted on a canvas; a stand-in is enough here.
globalThis.document ??= { createElement: () => ({ getContext: () => ({ createRadialGradient: () => ({ addColorStop() {} }), fillRect() {} }) }) };

test('the whole crowd is one mesh, and each person is a row of bones, colours and parts', () => {
  const scene = new THREE.Scene(), humans = new Humans(scene, 16);
  const crowd = scene.children.filter(o => o.name.startsWith('human-') && o.name !== 'human-shade');
  assert.equal(crowd.length, 1, 'one mesh for everyone');
  const sikh = humans.add(makeOutfit('sikh', 7), 10, 20);
  const woman = humans.add(makeOutfit('woman', 3), 12, 20);
  const far = humans.add(makeOutfit('man', 5), 10, 120);
  const hidden = humans.add(makeOutfit('man', 6), 11, 20);
  hidden.visible = false;
  humans.update(0.016, { x: 10, z: 10 }, null);
  assert.equal(humans.mesh.geometry.instanceCount, 3, 'everyone in view, nobody else');
  const row = i => humans.data.subarray(i * BLOCK * 4, (i + 1) * BLOCK * 4);
  const colour = (r, slot) => r[(39 + Math.floor(slot / 3)) * 4 + (slot % 3)];
  const mask = r => r[39 * 4 + 3];
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
