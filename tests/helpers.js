// Shared fixtures: the real world data, built once per test file.
import { readFileSync } from 'node:fs';
import { RoadNet } from '../src/world/roadnet.js';
import { City } from '../src/world/citygen.js';

let cached = null;
export function world() {
  if (cached) return cached;
  const data = JSON.parse(readFileSync(new URL('../public/data/world.json', import.meta.url), 'utf8'));
  const net = new RoadNet(data);
  const city = new City(data, net).generate();
  cached = { data, net, city };
  return cached;
}
export const place = (data, id) => data.places.find(p => p.id === id);
