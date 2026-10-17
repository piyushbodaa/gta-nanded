import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRoadIndex } from '../src/road-clearance.js';

const nodes = [{ x: 0, z: -200 }, { x: 0, z: 200 }, { x: 300, z: 0 }];
const edges = [{ a: 0, b: 1, width: 10 }, { a: 0, b: 2, width: 4 }];
const index = buildRoadIndex(nodes, edges, 1, 30, 1);

test('a point on a street or within its margin counts as on the road', () => {
  assert.equal(index.onRoad(0, 0), true);
  assert.equal(index.onRoad(5, 50), true, 'half of a 10-wide street plus the margin');
  assert.equal(index.onRoad(200, 0), false, 'the thin street reaches only a few metres');
});

test('a point well clear of every street is off the road, including far along a segment end', () => {
  assert.equal(index.onRoad(40, 0), false);
  assert.equal(index.onRoad(0, 230), false, 'beyond the end of the first street');
  assert.equal(index.onRoad(-100, -100), false);
});

test('edges with missing endpoints are ignored instead of crashing', () => {
  const safe = buildRoadIndex(nodes, [{ a: 0, b: 99, width: 6 }], 1);
  assert.equal(safe.onRoad(0, 0), false);
});
