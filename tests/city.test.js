import { test } from 'node:test';
import assert from 'node:assert/strict';
import { world } from './helpers.js';
import { RoadNet } from '../src/world/roadnet.js';
import { City, ZONE, segBoxDist } from '../src/world/citygen.js';

test('the generated city is dense and deterministic', () => {
  const { city, data } = world();
  assert.ok(city.lots.count > 50000, `${city.lots.count} buildings`);
  assert.ok(city.trees.count > 20000);
  const again = new City(data, new RoadNet(data)).generate();
  assert.equal(again.lots.count, city.lots.count);
  assert.equal(again.lots.x[1234], city.lots.x[1234]);
});

test('no building stands on a street', () => {
  const { city, net } = world();
  const L = city.lots;
  for (let i = 0; i < L.count; i += 37) {
    const c = Math.cos(L.rot[i]), s = Math.sin(L.rot[i]);
    const ext = Math.max(L.hw[i], L.hd[i]) * 1.5 + 8;
    net.grid.query(L.x[i] - ext, L.z[i] - ext, L.x[i] + ext, L.z[i] + ext, k => {
      const d = segBoxDist(net.px[k], net.pz[k], net.px[k + 1], net.pz[k + 1], L.x[i], L.z[i], L.hw[i], L.hd[i], c, s);
      assert.ok(d >= net.width[net.ptRoad[k]] / 2 - 0.01, `lot ${i} clears road ${net.ptRoad[k]}`);
    });
  }
});

test('zones follow the neighbourhoods', () => {
  const { city } = world();
  assert.equal(city.zoneAt(480, 610), ZONE.OLD); // Old Mondha
  assert.equal(city.zoneAt(-50, -850), ZONE.COACHING); // Shyam Nagar
});

test('the Godavari cuts a valley and the banks are dry land', () => {
  const { city } = world();
  const g = city.rivers.find(r => r.name === 'Godavari');
  const x = g.p[20], z = g.p[21];
  assert.ok(city.groundHeight(x, z) < -3, 'river bed is low');
  assert.ok(city.riverDistance(x, z).d < 0);
});

