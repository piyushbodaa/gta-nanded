import { test } from 'node:test';
import assert from 'node:assert/strict';
import { world, place } from './helpers.js';
import { PUMP_HW, PUMP_HD, KAMANS, MAL_TEKDI_R, segBoxDist, campusWing } from '../src/world/citygen.js';
import { Colliders } from '../src/world/colliders.js';
import { buildPlace, placeColliders } from '../src/world/landmarks.js';
import { Geo } from '../src/world/geo.js';

// A place's local frame (its front, toward the approach, is local -z), as landmarks.js draws it.
const frame = p => { const r = p.rot + Math.PI, c = Math.cos(r), s = Math.sin(r); return { X: (lx, lz) => p.x + lx * c + lz * s, Z: (lx, lz) => p.z - lx * s + lz * c }; };
let colliders = null;
/** How far someone (radius 0.35) standing at a place's local (lx, lz) is pushed out of what is there. */
function pushed(city, p, lx, lz) {
  colliders ??= new Colliders(city);
  const { X, Z } = frame(p), pos = { x: X(lx, lz), z: Z(lx, lz) }, x0 = pos.x, z0 = pos.z;
  colliders.resolveCircle(pos, 0.35, {});
  return Math.hypot(pos.x - x0, pos.z - z0);
}
/** The boxes a place's builder draws: { x, y, z, hw, h, hd } for every cbox call. */
function drawnBoxes(city, net, p) {
  const boxes = [];
  const g = new Proxy({}, { get: (_, k) => (k === 'cbox' ? (x, y, z, hw, h, hd) => { boxes.push({ x, y, z, hw, h, hd }); return g; } : k === 'v' ? () => 0 : k === 'n' ? 0 : () => g) });
  buildPlace({ g, sg: g, pg: g, fg: null, wires: [], city, net, signSlots: new Map() }, p, city.places.indexOf(p));
  return boxes;
}

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

test('landmarks are solid where they are drawn and open where they look open', () => {
  const { city } = world();
  // Nandgiri Fort: walls, bastions and the gate block stop you; the courtyard doesn't.
  const fort = place(city, 'nandgiri-fort'), k = fort.fit;
  for (const [lx, lz, what] of [[-30 * k, 0, 'west wall'], [0, 10 * k, 'back wall'], [30 * k, 0, 'east wall'], [-30 * k, 10 * k, 'bastion'], [3, -10 * k, 'gate block']]) assert.ok(pushed(city, fort, lx, lz) > 1, `the fort's ${what}`);
  for (const [lx, lz] of [[0, 0], [8, 3], [-15, -4]]) assert.equal(pushed(city, fort, lx, lz), 0, `the fort's courtyard at ${lx}, ${lz}`);
  // A gurudwara: its plinth is solid, the ground a metre and a half beyond it is not.
  for (const [id, s] of [['nagina-ghat', 0.75], ['sangat-sahib', 0.7], ['langar-sahib', 0.8], ['hira-ghat', 0.6]]) {
    const p = place(city, id), hw = 7 * s;
    assert.ok(pushed(city, p, hw + 1.3, 0) > 0, `${id}: the plinth`);
    assert.equal(pushed(city, p, hw + 2.9, 0), 0, `${id}: beside the plinth`);
  }
  assert.ok(pushed(city, place(city, 'langar-sahib'), 0, 14) > 3, 'the langar hall');
  // Hazur Sahib: the Darshani Deori is solid either side of its arch, which stays open.
  const hz = place(city, 'hazur-sahib'), R = 26 * hz.fit;
  assert.ok(pushed(city, hz, 5, -R) > 1 && pushed(city, hz, -5, -R) > 1, 'the gate block beside the arch');
  assert.equal(pushed(city, hz, 0, -R), 0, 'the arch');
  assert.ok(pushed(city, hz, -R * 0.62, R * 0.45) > 1, 'the Angitha Sahib');
  // The stadium: the corners between the stands are open, and the stands solid out to their top tier.
  const st = place(city, 'sggs-stadium'), shw = st.w / 2, shd = st.d / 2;
  assert.equal(pushed(city, st, shw - 1.5, shd - 4.5), 0, 'a corner between the stands');
  assert.equal(pushed(city, st, 0, 0), 0, 'the field');
  assert.ok(pushed(city, st, 0, shd + 1.4) > 0.3, 'the top tier of an end stand');
  assert.ok(pushed(city, st, shw + 1.4, 0) > 0.3, 'the top tier of a side stand');
});

test('the kamans span a street on the ground, clear of flyovers, rails and other roads', () => {
  const { city, net } = world();
  for (const id of Object.keys(KAMANS)) {
    const p = place(city, id), A = p.arch, K = KAMANS[id];
    assert.ok(A, `${id} found a street to span`);
    assert.ok(Math.hypot(A.x - p.ax, A.z - p.az) < 40, `${id} stands near its place`);
    const c = Math.cos(A.rot), s = Math.sin(A.rot);
    for (let lx = -A.span - K.hw; lx <= A.span + K.hw; lx += 0.5) assert.ok(net.deckOver(A.x + lx * c, A.z - lx * s) < 0.3, `${id}: no deck over the arch`);
    const pillars = placeColliders(p);
    assert.equal(pillars.length, 2, `${id}: both pillars are solid`);
    for (const b of pillars) {
      assert.ok(city.railDistance(b.x, b.z) > Math.hypot(K.hw, K.hd) + 2.9, `${id}: a pillar off the railway`);
      net.grid.query(b.x - 12, b.z - 12, b.x + 12, b.z + 12, k => {
        const d = segBoxDist(net.px[k], net.pz[k], net.px[k + 1], net.pz[k + 1], b.x, b.z, b.hw, b.hd, Math.cos(b.rot), Math.sin(b.rot));
        assert.ok(d >= net.width[net.ptRoad[k]] / 2 + 0.29, `${id}: a pillar ${d.toFixed(2)} m from road ${net.ptRoad[k]}`);
      });
    }
  }
});

test('Mal Tekdi keeps off the streets, and its stamp marker stands in the open', () => {
  const { city, net } = world();
  const p = place(city, 'mal-tekdi'), R = MAL_TEKDI_R * p.fit;
  for (let a = 0; a < 64; a++) {
    const x = p.x + Math.cos((a / 64) * Math.PI * 2) * R, z = p.z + Math.sin((a / 64) * Math.PI * 2) * R;
    assert.ok(net.roadClearance(x, z, 40) > 0.5, 'the foot of the hill is off the road');
  }
  assert.ok(Math.hypot(p.ax - p.x, p.az - p.z) > R, 'the approach is outside the hill');
  const L = city.lots;
  for (let i = 0; i < L.count; i++) assert.ok(Math.hypot(L.x[i] - p.x, L.z[i] - p.z) > R, `lot ${i} under the hill`);
});

test('Mal Tekdi is solid right to its drawn foot, with no invisible wall before it', () => {
  const { city, net } = world();
  const p = place(city, 'mal-tekdi');
  // Where the drawn hill meets the ground: its triangles' crossings of y = 0.
  const V = [], feet = [];
  const g = new Proxy({}, { get: (_, k) => {
    if (k === 'n') return V.length;
    if (k === 'v') return (x, y, z) => V.push([x, y, z]) - 1;
    if (k === 'blob') return Geo.prototype.blob;
    if (k === 'tri') return (...t) => {
      const cut = [];
      for (let i = 0; i < 3; i++) {
        const u = V[t[i]], w = V[t[(i + 1) % 3]];
        if (u[1] > 0 !== w[1] > 0) { const f = u[1] / (u[1] - w[1]); cut.push([u[0] + (w[0] - u[0]) * f, u[2] + (w[2] - u[2]) * f]); }
      }
      if (cut.length === 2) feet.push(cut);
      return g;
    };
    return () => g;
  } });
  buildPlace({ g, sg: g, pg: g, fg: null, wires: [], city, net, signSlots: new Map() }, p, city.places.indexOf(p));
  colliders ??= new Colliders(city);
  for (let a = 0; a < 72; a++) {
    const dx = Math.cos((a / 72) * Math.PI * 2), dz = Math.sin((a / 72) * Math.PI * 2);
    let foot = 0;
    for (const [[x1, z1], [x2, z2]] of feet) {
      const ex = x2 - x1, ez = z2 - z1, ox = x1 - p.x, oz = z1 - p.z, den = dx * ez - dz * ex;
      const t = (ox * ez - oz * ex) / den, s = (ox * dz - oz * dx) / den;
      if (t > 0 && s >= 0 && s <= 1) foot = Math.max(foot, t);
    }
    // A body (radius 0.35) whose front is 0.8 m into the slope is pushed out; one whose front is 0.8 m short of it is free.
    const at = d => { const x = p.x + dx * d, z = p.z + dz * d, pos = { x, z }; colliders.resolveCircle(pos, 0.35, {}); return Math.hypot(pos.x - x, pos.z - z); };
    assert.ok(at(foot + 0.35 - 0.8) > 0, `${a * 5} deg: walks into the slope past the hill's foot at ${foot.toFixed(1)} m`);
    assert.equal(at(foot + 0.35 + 0.8), 0, `${a * 5} deg: stopped short of the hill's foot at ${foot.toFixed(1)} m`);
  }
});

test('nothing at a ghat stands in the road', () => {
  const { city, net } = world();
  for (const id of ['govardhan-ghat', 'ram-ghat', 'urvashi-ghat', 'nagina-ghat', 'hira-ghat', 'shikar-ghat', 'banda-ghat']) {
    // The ghat's side walls are its half-metre-wide boxes.
    const walls = drawnBoxes(city, net, place(city, id)).filter(b => b.hw === 0.5);
    for (const b of walls) assert.ok(net.roadClearance(b.x, b.z, 10) > 0.5, `${id}: a side wall in the road`);
  }
});

test('campus wings, malls and the langar hall stand on their own ground', () => {
  const { city, net } = world();
  const L = city.lots;
  const inLot = (x, z) => {
    let hit = false;
    city.lotGrid.query(x, z, x, z, i => {
      if (i < 0) return;
      const c = Math.cos(L.rot[i]), s = Math.sin(L.rot[i]), dx = x - L.x[i], dz = z - L.z[i];
      if (Math.abs(dx * c - dz * s) < L.hw[i] && Math.abs(dx * s + dz * c) < L.hd[i]) hit = true;
    });
    return hit;
  };
  let wings = 0;
  for (const p of city.places) {
    const parts = [];
    if ((p.category === 'college' || p.category === 'school') && p.wing) { parts.push(campusWing(p)); wings++; }
    if ((p.category === 'cinema' || p.category === 'shopping') && p.id !== 'sarafa-bazar') parts.push([0, 0, p.w / 2 + 4, p.d / 2 + 3]);
    if (p.id === 'langar-sahib') parts.push([0, 14, 10, 5]);
    const { X, Z } = frame(p);
    for (const [lx, lz, hw, hd] of parts) {
      for (let a = -hw; a <= hw; a += 1) {
        for (let b = -hd; b <= hd; b += 1) {
          const x = X(lx + a, lz + b), z = Z(lx + a, lz + b);
          assert.ok(!inLot(x, z), `${p.id}: a house inside it at ${x.toFixed(1)}, ${z.toFixed(1)}`);
          assert.ok(net.roadClearance(x, z, 10) > 0, `${p.id}: on a road at ${x.toFixed(1)}, ${z.toFixed(1)}`);
        }
      }
      assert.ok(pushed(city, p, lx, lz) > 1, `${p.id}: solid`);
    }
  }
  assert.ok(wings > 25, `${wings} campuses have their rear wing`);
});
