import { test } from 'node:test';
import assert from 'node:assert/strict';
import { world, place } from './helpers.js';
import { PUMP_HW, PUMP_HD } from '../src/world/citygen.js';

test('the station runs along the railway, with Platform 1 between the building and the first track', () => {
  const { city } = world();
  const p = place(city, 'nanded-station'), S = p.station;
  assert.ok(S, 'the station found its tracks');
  assert.ok(S.tracks.length >= 4, `${S.tracks.length} tracks through the station`);
  const pl = S.platforms[0];
  // No track crosses the platform.
  for (const line of city.rails) {
    for (let i = 0; i + 1 < line.length; i += 2) {
      const a = (line[i] - p.x) * S.dx + (line[i + 1] - p.z) * S.dz, b = (line[i] - p.x) * S.nx + (line[i + 1] - p.z) * S.nz;
      assert.ok(!(a > pl.a0 && a < pl.a1 && b > pl.b0 && b < pl.b1), 'no rail on Platform 1');
    }
  }
  assert.ok(Math.abs(city.groundHeight(p.x + S.nx * (pl.b0 + pl.b1) / 2, p.z + S.nz * (pl.b0 + pl.b1) / 2) - 0.84) < 1e-6, 'the platform stands 840 mm high');
});

test('the airfield is the mapped one, with nothing built on the runway', () => {
  const { city, data } = world();
  const rw = data.airfield.runways[0];
  assert.equal(rw.ref, '10/28');
  const ax = rw.p[0], az = rw.p[1], bx = rw.p.at(-2), bz = rw.p.at(-1), len = Math.hypot(bx - ax, bz - az);
  assert.ok(len > 1000 && len < 1300, `runway ${len.toFixed(0)} m at half scale`);
  const ux = (bx - ax) / len, uz = (bz - az) / len, L = city.lots;
  for (let i = 0; i < L.count; i++) {
    const dx = L.x[i] - ax, dz = L.z[i] - az, along = dx * ux + dz * uz, lat = Math.abs(-dx * uz + dz * ux);
    assert.ok(!(along > 0 && along < len && lat < 30), `lot ${i} on the runway`);
  }
  assert.ok(place(city, 'nanded-airport').plane, 'an airliner waits on the apron');
});

test('petrol pumps stand at every mapped pump and along the main roads, off the carriageway', () => {
  const { city, data } = world();
  assert.ok(city.pumps.length >= 12, `${city.pumps.length} petrol pumps`);
  for (const [fx, fz] of data.fuel) assert.ok(city.pumps.some(q => Math.hypot(q.x - fx, q.z - fz) < 130), `a pump near the one mapped at ${fx}, ${fz}`);
  for (const q of city.pumps) assert.ok(city._clearOfStreets(q.x, q.z, PUMP_HW * q.k, PUMP_HD * q.k, q.rot, 0.2), 'forecourt clear of the streets');
});

test('sabzi markets line busy old-town streets without spilling onto the road', () => {
  const { city, net } = world();
  assert.ok(city.markets.length >= 6, `${city.markets.length} markets`);
  const P = city.props;
  for (const m of city.markets) {
    assert.ok(m.vendors.length >= 8);
    for (const i of m.vendors) assert.ok(net.roadClearance(P.x[i], P.z[i], 10) >= 0.2, 'stall off the road');
  }
});
