import { test } from 'node:test';
import assert from 'node:assert/strict';
import { world } from './helpers.js';
import { PROP } from '../src/world/citygen.js';
import { obbOverlap } from '../src/core/math.js';

// What stands along the streets faces them, and stays out of their lanes.

test('tea stalls, shrines and hoardings face the street; lamps on bridges reach over the deck', () => {
  const { city, net } = world();
  const P = city.props, near = {}, seen = {};
  for (let i = 0; i < P.count; i++) {
    const k = P.kind[i], deck = k === PROP.LAMP && (net.bridge[P.road[i]] || net.raised[P.road[i]]);
    if (k !== PROP.STALL && k !== PROP.SHRINE && k !== PROP.HOARDING && !deck) continue;
    // buildProp draws their fronts (a lamp's arm and light) on local -z. Measured to the nearest
    // point of their road, which on a bend is not quite square to where they were set out.
    const n = net.nearest(P.x[i], P.z[i], 30, near, r => r === P.road[i]);
    const tx = n.x - P.x[i], tz = n.z - P.z[i], l = Math.hypot(tx, tz) || 1;
    const facing = -(tx * Math.sin(P.rot[i]) + tz * Math.cos(P.rot[i])) / l;
    assert.ok(facing > 0.25, `prop ${i} (kind ${k}) turned ${Math.round(Math.acos(Math.max(-1, Math.min(1, facing))) * 57.3)}° from its road`);
    seen[k] = (seen[k] || 0) + 1;
  }
  for (const k of [PROP.STALL, PROP.SHRINE, PROP.HOARDING, PROP.LAMP]) assert.ok(seen[k] > 20, `${seen[k]} props of kind ${k}`);
});

test('no street lamp or electric pole stands in the lane of a road beside its own', () => {
  const { city, net } = world();
  const P = city.props;
  let n = 0;
  for (let i = 0; i < P.count; i++) {
    // A bridge's lamps stand on its parapet; the rest stand beside the street, clear of every carriageway.
    if ((P.kind[i] !== PROP.LAMP && P.kind[i] !== PROP.POLE) || net.bridge[P.road[i]] || net.raised[P.road[i]]) continue;
    const clear = net.roadClearance(P.x[i], P.z[i], 10);
    assert.ok(clear >= 0.4 - 1e-6, `prop ${i} (kind ${P.kind[i]}, road ${P.road[i]}) ${clear.toFixed(2)} m from a road edge`);
    n++;
  }
  assert.ok(n > 10000, `${n} lamps and poles`);
});

test('a compound wall runs into no other building, and no street tree stands in a wall or a shop platform', () => {
  const { city } = world();
  const L = city.lots, T = city.trees, ov = {};
  let walls = 0, otas = 0;
  for (let i = 0; i < L.count; i++) {
    const wall = city.compoundWall(i), ota = city.shopPlatform(i);
    if (!wall && !ota) continue;
    const c = Math.cos(L.rot[i]), s = Math.sin(L.rot[i]);
    // The wall's line 1.6 m in front of the house (chunks.js, colliders.js) and the platform along the shop front.
    const strips = [];
    if (wall) strips.push([-L.hd[i] - 1.5, L.hw[i], 0.12, 'wall']);
    if (ota) strips.push([-L.hd[i] - ota / 2, L.hw[i] - 0.05, ota / 2, 'platform']);
    for (const [lz, hw, hd, what] of strips) {
      const x = L.x[i] + lz * s, z = L.z[i] + lz * c, ext = hw + 12;
      city.lotGrid.query(x - ext, z - ext, x + ext, z + ext, id => {
        if (what === 'wall' && id >= 0 && id !== i) assert.ok(!obbOverlap(x, z, hw, hd, L.rot[i], L.x[id], L.z[id], L.hw[id], L.hd[id], L.rot[id], ov), `lot ${i}'s wall runs into lot ${id}`);
        if (id > -100000 || id <= -200000) return;
        const k = -100000 - id - 1, r = T.kind[k] === 2 ? 0.75 : T.kind[k] === 5 ? 0.6 : 0.32, dx = T.x[k] - x, dz = T.z[k] - z;
        assert.ok(Math.abs(dx * c - dz * s) >= hw + r || Math.abs(dx * s + dz * c) >= hd + r, `tree ${k} stands in lot ${i}'s ${what}`);
      });
    }
    if (wall) walls++; if (ota) otas++;
  }
  assert.ok(walls > 1000 && otas > 5000, `${walls} walls, ${otas} platforms`);
});
