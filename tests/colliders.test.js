import { test } from 'node:test';
import assert from 'node:assert/strict';
import { world } from './helpers.js';
import { Colliders } from '../src/world/colliders.js';

test('every collider is stored and indexed, however many the city has', () => {
  const { city } = world();
  const c = new Colliders(city);
  const indexed = new Set();
  for (const list of c.grid.map.values()) for (const i of list) indexed.add(i);
  assert.equal(indexed.size, c.n, `${c.n - indexed.size} of ${c.n} colliders are missing from the grid`);
  for (let i = 0; i < c.n; i++) assert.ok(Number.isFinite(c.x[i] + c.z[i] + c.hw[i] + c.hd[i] + c.c[i] + c.s[i] + c.h[i]), `collider ${i} has no data`);
});

test('a wall spanning several grid cells pushes a circle out once', () => {
  const { city } = world();
  const c = new Colliders(city);
  // A long wall across many 16 m cells, and a circle overlapping it by 0.1 m.
  const i = c.addBox(5000, 5000, 40, 0.2, 0, 2);
  const pos = { x: 5000, z: 5000 + 0.2 + 0.3 - 0.1 }, out = {};
  assert.ok(c.resolveCircle(pos, 0.3, out));
  assert.ok(Math.abs(pos.z - (5000 + 0.5)) < 1e-5, `pushed to ${pos.z}`); // sizes are stored as float32
  assert.ok(Math.abs(out.nz - 1) < 1e-6 && Math.abs(out.nx) < 1e-6);
  assert.ok(i === c.n - 1);
});

test('compound gates are as solid as they look, and walls block the camera', () => {
  const { city } = world();
  const c = new Colliders(city), L = city.lots;
  let i = 0;
  while (i < L.count && !city.compoundWall(i)) i++;
  assert.ok(i < L.count, 'a lot with a compound wall');
  const cs = Math.cos(L.rot[i]), sn = Math.sin(L.rot[i]);
  const at = (lx, lz) => [L.x[i] + lx * cs + lz * sn, L.z[i] - lx * sn + lz * cs];
  // Straight through the middle of the gate, from the road side into the yard.
  const [ox, oz] = at(0, -L.hd[i] - 3), [ix, iz] = at(0, -L.hd[i] - 0.8);
  assert.ok(c.blocked(...at(0, -L.hd[i] - 1.6), 0.3), 'the gate is solid');
  // A camera low behind the wall is pulled in front of it.
  assert.ok(c.raycast(ix, 1.0, iz, ox, 1.0, oz, 0.1) < 1, 'the wall hides a low camera');
  assert.equal(c.raycast(ix, 2.2, iz, ox, 2.2, oz, 0.1), 1, 'and not one that looks over it');
});

test('colliders added after the city still collide once the arrays have grown', () => {
  const { city } = world();
  const c = new Colliders(city), probe = { x: 0, z: 0 }, out = {};
  c.resolveCircle(probe, 0.3, out); // a query before growing
  const cap = c.type.length;
  for (let k = 0, extra = cap - c.n + 10; k < extra; k++) c.addCircle(9000 + (k % 300) * 3, 9000 + Math.floor(k / 300) * 3, 0.5, 2);
  assert.ok(c.type.length > cap, 'the arrays grew');
  // A wall across several grid cells, added after growing; a circle at its centre is pushed clear of it.
  c.addBox(-9000, -9000, 30, 0.2, 0.3, 2);
  const pos = { x: -9000, z: -9000 }, o = {};
  assert.ok(c.resolveCircle(pos, 0.3, o));
  const lz = (pos.x + 9000) * Math.sin(0.3) + (pos.z + 9000) * Math.cos(0.3);
  assert.ok(Math.abs(Math.abs(lz) - 0.5) < 1e-5, `left ${Math.abs(lz).toFixed(4)} m from the wall's centre line`);
  assert.ok(Number.isFinite(pos.x) && Number.isFinite(pos.z));
});
