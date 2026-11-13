import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pack, unpack } from '../src/world/worldpack.js';

const tiny = () => ({
  version: 2, names: ['', 'Station Road'],
  junctions: [[10.5, -3.2, 0, 1], [40, 0.1, 0, 2], [-7.3, 55.9, 1, 2]],
  roads: [[0, 1, 10, 1, 1, 0, 10.5, -3.2, 20.1, -2.9, 30.7, -1, 40, 0.1], [0, 2, 6, 5, 0, 1, 10.5, -3.2, -7.3, 55.9], [1, 2, 6, 5, 0, 0, 40, 0.1, 12.3, 30, -7.3, 55.9]],
});

test('a packed world unpacks to exactly what was packed', () => {
  const w = tiny();
  assert.deepEqual(unpack(JSON.parse(JSON.stringify(pack(w)))), w);
});

test('the shipped world is packed, and packing it again gives the same data', () => {
  const file = JSON.parse(readFileSync(new URL('../public/data/world.json', import.meta.url), 'utf8'));
  assert.equal(file.packed, 1);
  const data = unpack(file);
  assert.ok(Array.isArray(data.roads[0]) && data.junctions.length > 10000 && data.packed === undefined);
  // Compared piece by piece: a mismatch must not print the whole city.
  const again = pack(data);
  assert.deepEqual(Object.keys(again).sort(), Object.keys(file).sort());
  assert.ok(JSON.stringify(again.junctions) === JSON.stringify(file.junctions), 'junctions differ');
  for (const k of Object.keys(file.roads)) assert.ok(JSON.stringify(again.roads[k]) === JSON.stringify(file.roads[k]), `roads.${k} differs`);
});

test('data that was never packed passes straight through', () => {
  const w = tiny();
  assert.equal(unpack(w), w);
});

test('a road that does not end on its junction is refused, not quietly moved', () => {
  const w = tiny();
  w.roads[1][8] += 0.1;
  assert.throws(() => pack(w), /junctions/);
});

test('junction road lists the format cannot rebuild are refused', () => {
  const w = tiny();
  w.junctions[0] = [10.5, -3.2, 1, 0];
  assert.throws(() => pack(w), /order/);
});
