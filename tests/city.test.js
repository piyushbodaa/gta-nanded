import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { world } from './helpers.js';
import { RoadNet } from '../src/world/roadnet.js';
import { City, ZONE, PROP, segBoxDist, FOOTPATH_W } from '../src/world/citygen.js';
import { obbOverlap } from '../src/core/math.js';

test('the generated city is dense and deterministic', () => {
  const { city, data } = world();
  assert.ok(city.lots.count > 40000, `${city.lots.count} buildings`);
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

test('mapped buildings, turned to face the street, keep the ground they were checked on', () => {
  const { city, net, data } = world();
  const L = city.lots, mapped = new Set(data.footprints.map(([x, z]) => `${Math.fround(x)},${Math.fround(z)}`));
  const ov = {};
  let n = 0;
  for (let i = 0; i < L.count; i++) {
    if (!mapped.has(`${L.x[i]},${L.z[i]}`)) continue;
    n++;
    const c = Math.cos(L.rot[i]), s = Math.sin(L.rot[i]), ext = Math.max(L.hw[i], L.hd[i]) * 1.5 + 8;
    net.grid.query(L.x[i] - ext, L.z[i] - ext, L.x[i] + ext, L.z[i] + ext, k => {
      const d = segBoxDist(net.px[k], net.pz[k], net.px[k + 1], net.pz[k + 1], L.x[i], L.z[i], L.hw[i], L.hd[i], c, s);
      assert.ok(d >= net.width[net.ptRoad[k]] / 2 - 0.01, `mapped lot ${i} stands ${(net.width[net.ptRoad[k]] / 2 - d).toFixed(2)} m into road ${net.ptRoad[k]}`);
    });
    city.lotGrid.query(L.x[i] - ext, L.z[i] - ext, L.x[i] + ext, L.z[i] + ext, j => {
      if (j < 0 || j === i) return;
      assert.ok(!obbOverlap(L.x[i], L.z[i], L.hw[i] - 0.3, L.hd[i] - 0.3, L.rot[i], L.x[j], L.z[j], L.hw[j], L.hd[j], L.rot[j], ov), `mapped lot ${i} inside lot ${j}`);
    });
  }
  assert.ok(n > 400, `${n} mapped buildings`);
});

test('a handcart on a footpath stands wholly on the paving', () => {
  const { city, net } = world();
  const P = city.props, near = {};
  let onPath = 0;
  for (let i = 0; i < P.count; i++) {
    if (P.kind[i] !== PROP.CART) continue;
    const c = Math.cos(P.rot[i]), s = Math.sin(P.rot[i]), own = r => r === P.road[i];
    for (const [lx, lz] of [[-0.6, -0.61], [0.6, -0.61], [-0.6, 0.61], [0.6, 0.61]]) {
      // Measured from the cart's own street, whose footpath it stands on.
      const x = P.x[i] + lx * c + lz * s, z = P.z[i] - lx * s + lz * c, n = net.nearest(x, z, 20, near, own);
      if (n) assert.ok(Math.abs(city.pavementAt(n.seg, n.dist) - P.y[i]) < 0.01, `cart ${i}: a wheel at another height than the cart`);
    }
    if (P.y[i] > 0) onPath++;
  }
  assert.ok(onPath > 100, `${onPath} carts on footpaths`);
});

test('no lamp post or electric pole stands through a handcart or a vendor\'s umbrella', () => {
  const { city } = world();
  const P = city.props, posts = [];
  for (let i = 0; i < P.count; i++) if (P.kind[i] === PROP.LAMP || P.kind[i] === PROP.POLE) posts.push(i);
  for (let i = 0; i < P.count; i++) {
    const cart = P.kind[i] === PROP.CART;
    if (!cart && P.kind[i] !== PROP.VENDOR) continue;
    // The umbrellas (chunks.js buildProp): a cart's 1.35 m round over its middle, a vendor's
    // 1.45 m round and 0.35 m back. A pole is up to 0.14 m thick.
    const back = cart ? 0 : 0.35, x = P.x[i] - back * Math.sin(P.rot[i]), z = P.z[i] - back * Math.cos(P.rot[i]);
    const r = cart ? 1.49 : 1.59;
    const j = posts.find(j => (P.x[j] - x) ** 2 + (P.z[j] - z) ** 2 < r * r);
    assert.equal(j, undefined, `prop ${i} (kind ${P.kind[i]}) round pole ${j}`);
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


test('footpaths stay clear: no building stands on one', () => {
  const { city, net } = world();
  const L = city.lots;
  for (let i = 0; i < L.count; i += 13) {
    const c = Math.cos(L.rot[i]), s = Math.sin(L.rot[i]);
    const ext = Math.max(L.hw[i], L.hd[i]) * 1.5 + 10;
    net.grid.query(L.x[i] - ext, L.z[i] - ext, L.x[i] + ext, L.z[i] + ext, k => {
      if (!city.footpathAt(k)) return;
      const d = segBoxDist(net.px[k], net.pz[k], net.px[k + 1], net.pz[k + 1], L.x[i], L.z[i], L.hw[i], L.hd[i], c, s);
      assert.ok(d >= net.width[net.ptRoad[k]] / 2 + FOOTPATH_W - 0.01, `lot ${i} is ${d.toFixed(2)} m from footpath road ${net.ptRoad[k]}`);
    });
  }
});

test('shop platforms and compound walls leave the kerb free', () => {
  const { city, net } = world();
  const L = city.lots;
  let platforms = 0, walls = 0;
  for (let i = 0; i < L.count; i++) {
    const ota = city.shopPlatform(i), wall = city.compoundWall(i);
    if (!ota && !wall) continue;
    // The strip in front of the building that the platform or wall occupies.
    const depth = wall ? 1.6 : ota, c = Math.cos(L.rot[i]), s = Math.sin(L.rot[i]);
    const lz = -L.hd[i] - depth / 2, x = L.x[i] + lz * s, z = L.z[i] + lz * c;
    const clearance = net.roadClearance(x, z, 20) - depth / 2;
    assert.ok(clearance > 0.4, `lot ${i}: ${wall ? 'wall' : 'platform'} reaches ${clearance.toFixed(2)} m from the road edge`);
    if (ota) platforms++; if (wall) walls++;
  }
  assert.ok(platforms > 1000 && walls > 500, `${platforms} platforms, ${walls} compound walls`);
});

test('satellite villages and far rural outskirts are excluded and world geometry respects tighter bounds', () => {
  const { city, data } = world();
  const placesFile = JSON.parse(readFileSync(new URL('../public/data/places.json', import.meta.url), 'utf8'));
  assert.ok(Array.isArray(placesFile), 'places.json is an array of places');
  const removedAreas = new Set(['Puyni', 'Pasadgaon', 'Eastern river outskirts', 'Godavari outskirts']);
  const removedIds = new Set(['oxford-global-school', 'shakuntal-school', 'hira-ghat', 'mata-sahib', 'shikar-ghat']);
  for (const d of city.districts) assert.ok(!removedAreas.has(d.name), `removed district in world.json: ${d.name}`);
  for (const p of data.places) {
    assert.ok(!removedAreas.has(p.area), `removed area place in world.json: ${p.id} (${p.area})`);
    assert.ok(!removedIds.has(p.id), `removed place id in world.json: ${p.id}`);
  }
  for (const p of placesFile) {
    assert.ok(!removedAreas.has(p.area), `removed area place in places.json: ${p.id} (${p.area})`);
    assert.ok(!removedIds.has(p.id), `removed place id in places.json: ${p.id}`);
  }
  const b = data.bounds;
  assert.ok(b.maxX - b.minX < 5500 && b.maxZ - b.minZ < 6800, `tighter bounds: ${Math.round(b.maxX - b.minX)} x ${Math.round(b.maxZ - b.minZ)}`);
  const inside = (x, z, pad = 0) => x >= b.minX - pad && x <= b.maxX + pad && z >= b.minZ - pad && z <= b.maxZ + pad;
  // Former satellite village / far-east outskirt coordinates must lie outside the shrunk map.
  assert.ok(!inside(-1928, -2760), 'Puyni is outside bounds');
  assert.ok(!inside(-815, -3169), 'Pasadgaon is outside bounds');
  assert.ok(!inside(5324, 1656), 'Shikar Ghat is outside bounds');
  for (const p of data.places) assert.ok(inside(p.x, p.z) && inside(p.ax, p.az), `place ${p.id} inside bounds`);
  for (const d of city.districts) assert.ok(inside(d.x, d.z), `district ${d.name} inside bounds`);
  for (const r of data.roads) {
    for (let i = 6; i < r.length; i += 2) assert.ok(inside(r[i], r[i + 1]), `road vertex inside bounds`);
  }
  for (const [x, z] of data.footprints) assert.ok(inside(x, z), `footprint inside bounds`);
  for (const rv of data.rivers) {
    for (let i = 0; i < rv.p.length; i += 2) assert.ok(inside(rv.p[i], rv.p[i + 1], 100), `river ${rv.name} vertex inside bounds`);
  }
});
