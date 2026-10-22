import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { world } from './helpers.js';
import { ChunkManager } from '../src/world/chunks.js';
import { CHUNK } from '../src/world/citygen.js';

function manager() {
  const { city } = world();
  const mats = { city: new THREE.MeshBasicMaterial(), signs: new THREE.MeshBasicMaterial(), pools: new THREE.MeshBasicMaterial(), wires: new THREE.LineBasicMaterial(), foliage: new THREE.MeshBasicMaterial() };
  return new ChunkManager(new THREE.Scene(), city, mats, new Map());
}

/** A fingerprint of everything a chunk draws. */
function fingerprint(ch) {
  let h = 2166136261, n = 0;
  for (const m of ch.meshes) {
    const a = m.geometry.attributes.position.array;
    n += a.length;
    for (let i = 0; i < a.length; i += 7) h = Math.imul(h ^ Math.round(a[i] * 100), 16777619) >>> 0;
  }
  return `${n}:${h}`;
}

test('a chunk rebuilds identically after it is unloaded', () => {
  const cm = manager();
  const cx = Math.floor(-54 / CHUNK), cz = Math.floor(-849 / CHUNK), key = `${cx},${cz}`;
  cm._build(key, cx, cz);
  const first = fingerprint(cm.chunks.get(key));
  cm._dispose(key, cm.chunks.get(key));
  assert.equal(cm.chunks.has(key), false);
  cm._build(key, cx, cz);
  assert.equal(fingerprint(cm.chunks.get(key)), first);
});

test('streaming in slices builds the same chunks as building at once', () => {
  const sliced = manager(), whole = manager();
  const x = 517, z = 600;
  sliced.setRadius(300); whole.setRadius(300);
  // A tiny budget: one slice per call, many calls.
  let calls = 0;
  while (sliced.update(x, z, 0.01) > 0 && calls < 5000) calls++;
  assert.ok(calls > sliced.chunks.size, `${calls} calls for ${sliced.chunks.size} chunks: work was spread out`);
  whole.prime(x, z, 300);
  for (const [key, ch] of sliced.chunks) if (whole.chunks.has(key)) assert.equal(fingerprint(ch), fingerprint(whole.chunks.get(key)), `chunk ${key}`);
});

test('the ground under the player is built at once, and far chunks are released', () => {
  const cm = manager();
  cm.setRadius(300);
  cm.update(160, 375, 0.01);
  const here = `${Math.floor(160 / CHUNK)},${Math.floor(375 / CHUNK)}`;
  assert.ok(cm.chunks.has(here), 'the chunk under the player exists after one call');
  for (let i = 0; i < 4000 && cm.update(160, 375, 1) > 0; i++);
  const loaded = cm.chunks.size;
  // Leave mid-build: widen the view so a new chunk starts, then go 2 km away.
  cm.setRadius(420);
  for (let i = 0; i < 50 && !cm.job; i++) cm.update(160, 375, 0.01);
  assert.ok(cm.job, 'a chunk is half-built');
  const half = cm.job.key;
  cm.setRadius(300);
  cm.update(-1500, -1800, 0.01);
  assert.ok(!cm.job || cm.job.key !== half, 'the half-built chunk from the old spot was dropped');
  for (let i = 0; i < 4000 && cm.update(-1500, -1800, 1) > 0; i++);
  assert.ok(!cm.chunks.has(half));
  assert.equal(cm.chunks.has(here), false);
  assert.ok(loaded > 4 && cm.chunks.size > 4);
  for (const ch of cm.chunks.values()) assert.ok(Math.hypot((ch.cx + 0.5) * CHUNK + 1500, (ch.cz + 0.5) * CHUNK + 1800) < 300 + CHUNK * 2);
});
