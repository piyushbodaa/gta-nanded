import { test } from 'node:test';
import assert from 'node:assert/strict';
import { world } from './helpers.js';
import { PROP } from '../src/world/citygen.js';

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
