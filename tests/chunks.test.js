import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { world } from './helpers.js';
import { ChunkManager, NEAR, RUSH } from '../src/world/chunks.js';
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

test('far chunks are plain blocks, swapped for the close-up as the player comes near', () => {
  const cm = manager();
  // Old Mondha: the densest streets.
  const x = 517, z = 600;
  cm.setRadius(420);
  for (let i = 0; i < 20000 && cm.update(x, z, 50) > 0; i++);
  const tris = level => level.meshes.reduce((n, m) => n + (m.geometry.index ? m.geometry.index.count / 3 : 0), 0);
  let near = 0, far = 0;
  for (const ch of cm.chunks.values()) {
    const d = cm._dist(ch.cx, ch.cz), [N, F] = ch.levels;
    if (d < 150) { assert.ok(N && N.group.visible && !(F && F.group.visible), 'close-up near the player'); near++; }
    if (d > 190) { assert.ok(F && F.group.visible && !N, 'far version away from the player'); far++; }
  }
  assert.ok(near >= 4 && far >= 10, `${near} close-up, ${far} far`);
  // A far chunk costs a fraction of its close-up.
  const key = [...cm.chunks.keys()].find(k => cm.chunks.get(k).levels[1] && cm._dist(cm.chunks.get(k).cx, cm.chunks.get(k).cz) > 250 && tris(cm.chunks.get(k).levels[1]) > 4000);
  const ch = cm.chunks.get(key), ref = manager();
  ref._build(key, ch.cx, ch.cz);
  assert.ok(tris(ch.levels[1]) < tris(ref.chunks.get(key).levels[0]) * 0.45, `far ${tris(ch.levels[1])} vs close-up ${tris(ref.chunks.get(key).levels[0])}`);
  // Walk over to it: the close-up replaces the far version.
  const cx = (ch.cx + 0.5) * CHUNK, cz = (ch.cz + 0.5) * CHUNK;
  for (let i = 0; i < 20000 && cm.update(cx, cz, 50) > 0; i++);
  assert.ok(ch.levels[0]?.group.visible && !ch.levels[1]?.group.visible, 'close-up on arrival');
});

/** The chunks a player standing at (x, z) needs at once: those within RUSH of their square. */
function underfoot(x, z) {
  const keys = [];
  for (let cx = Math.floor((x - RUSH) / CHUNK); cx <= Math.floor((x + RUSH) / CHUNK); cx++) {
    for (let cz = Math.floor((z - RUSH) / CHUNK); cz <= Math.floor((z + RUSH) / CHUNK); cz++) {
      if (Math.hypot(Math.max(cx * CHUNK - x, 0, x - (cx + 1) * CHUNK), Math.max(cz * CHUNK - z, 0, z - (cz + 1) * CHUNK)) < RUSH) keys.push(`${cx},${cz}`);
    }
  }
  return keys;
}

test('the ground where play will start is built ahead, in slices, and the first update there has nothing to rush', () => {
  const cm = manager();
  cm.setRadius(300);
  for (let i = 0; i < 4000 && cm.update(160, 375, 1) > 0; i++); // the city around the loading spot
  const loaded = [...cm.chunks.keys()];
  // Zenda Chowk, where Free Roam begins: by a chunk edge (two chunks underfoot), 2.5 km away.
  const x = -935, z = -1834, need = underfoot(x, z);
  let slices = 1;
  while (!cm.prepare(x, z, performance.now() + 1)) slices++;
  assert.ok(slices > need.length, `${slices} slices`);
  assert.ok(loaded.every(k => cm.chunks.has(k)), 'nothing dropped while the menu is up');
  const groups = need.map(k => cm.chunks.get(k)?.levels[NEAR]?.group);
  assert.ok(groups.every(Boolean), 'every chunk underfoot built close-up');
  assert.equal(cm.prepare(x, z, performance.now() + 1), true, 'and nothing more to do');
  cm.update(x, z, 0.01);
  assert.deepEqual(need.map(k => cm.chunks.get(k)?.levels[NEAR]?.group), groups, 'none of them built again');
  assert.ok(loaded.every(k => !cm.chunks.has(k)), 'the old spot let go');
});

test('streaming and building ahead share their builders without spoiling a chunk', () => {
  const cm = manager(), ref = manager();
  const x = 517, z = 600, cx = Math.floor(x / CHUNK), cz = Math.floor(z / CHUNK), key = `${cx},${cz}`;
  ref._build(key, cx, cz);
  // Half a chunk streamed, then building ahead takes over, then streaming again.
  cm.setRadius(200);
  cm.update(x, z, 0.01);
  for (let i = 0; i < 50 && !cm.job; i++) cm.update(x, z, 0.01);
  cm._dispose(key, cm.chunks.get(key));
  cm.prepare(x, z, 0);
  assert.ok(cm._prep && !cm.job, 'building ahead dropped the half-streamed chunk');
  for (let i = 0; i < 4000 && cm.update(x, z, 1) > 0; i++);
  assert.ok(!cm._prep, 'and gave way to streaming');
  assert.equal(fingerprint(cm.chunks.get(key)), fingerprint(ref.chunks.get(key)));
});
