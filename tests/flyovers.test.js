import { test } from 'node:test';
import assert from 'node:assert/strict';
import { world } from './helpers.js';
import { Colliders } from '../src/world/colliders.js';
import { DECK_H } from '../src/world/roadnet.js';

// Bridges on dry land that cross a street or the railway are flyovers: raised decks on ramps.

test('flyovers rise over the streets and the railway they cross', () => {
  const { net } = world();
  const standing = new Set(net.crossings.map(c => c.road));
  assert.ok(standing.size >= 8, `${standing.size} flyover bridges`);
  const cleared = net.crossings.filter(c => c.h >= 4.5);
  assert.ok(cleared.length >= net.crossings.length * 0.85, `${cleared.length}/${net.crossings.length} crossings have headroom`);
  // The Hingoli Gate flyover reaches full height, and its ramps come down to the ground.
  const hingoli = [];
  for (let r = 0; r < net.count; r++) if (net.name(r) === 'Hingoli Gate Flyover' && net.bridge[r] && net.raised[r]) hingoli.push(r);
  assert.ok(hingoli.length >= 2, 'both carriageways of the Hingoli Gate flyover are raised');
  for (const r of hingoli) {
    let top = 0;
    for (let s = 0; s <= net.length[r]; s += 2) top = Math.max(top, net.deckAt(r, s));
    assert.ok(top > DECK_H - 0.01, `road ${r} reaches the deck height`);
  }
  // Ramps are never steeper than a lorry can climb, and every structure meets the ground.
  for (let r = 0; r < net.count; r++) {
    if (!net.raised[r]) continue;
    for (let s = 0; s + 2 <= net.length[r]; s += 2) assert.ok(Math.abs(net.deckAt(r, s + 2) - net.deckAt(r, s)) <= 0.08 * 2 + 1e-6, `road ${r} ramp at ${s}`);
  }
  for (let j = 0; j < net.junctionCount; j++) {
    if (net.jRoads[j].some(r => net.raised[r]) && net.jRoads[j].some(r => !net.raised[r])) assert.ok(net.jDeck[j] < 0.05, `junction ${j} where a ramp meets the street is on the ground`);
  }
});

test('the street under a flyover stays on the ground, the deck carries its own traffic', () => {
  const { net } = world();
  const c = net.crossings.find(k => k.h >= DECK_H - 0.01 && k.half < 6.5);
  const p = net.pointAt(c.road, c.s, {});
  assert.equal(net.surfaceAt(p.x, p.z, 0), 0, 'a car on the street passes under');
  assert.ok(Math.abs(net.surfaceAt(p.x, p.z, DECK_H) - DECK_H) < 0.05, 'a car on the deck stays on it');
  // Piers never stand on another street.
  for (let r = 0; r < net.count; r++) {
    if (!net.raised[r]) continue;
    for (const pier of net.deckPiers(r)) {
      const n = net.nearest(pier.x, pier.z, 8, {}, o => o !== r && !net.raised[o]);
      if (n) assert.ok(n.dist > net.width[n.road] / 2, `pier of road ${r} clear of road ${n.road}`);
    }
  }
});

test('a car driven up a ramp from the street climbs onto the deck', () => {
  const { net } = world();
  const p = {};
  let ramps = 0, climbed = 0;
  // From every foot on the ground, along the centre and the kerb lane, a substep (0.4 m) at a time.
  for (let r = 0; r < net.count; r++) {
    if (!net.raised[r]) continue;
    let top = 0;
    for (let s = 0; s <= net.length[r]; s += 1) top = Math.max(top, net.deckAt(r, s));
    for (const back of [false, true]) {
      if (net.jDeck[back ? net.rb[r] : net.ra[r]] > 0.05) continue;
      for (const off of [0, net.width[r] / 4]) {
        let y = 0, high = 0;
        for (let k = 0; k * 0.4 <= net.length[r]; k++) {
          net.pointAt(r, back ? net.length[r] - k * 0.4 : k * 0.4, p);
          y = net.surfaceAt(p.x + p.dz * off, p.z - p.dx * off, y);
          high = Math.max(high, y);
        }
        ramps++;
        if (high > top - 0.5) climbed++;
      }
    }
  }
  assert.ok(ramps > 60 && climbed >= ramps * 0.95, `${climbed} of ${ramps} ramps climbed`);
  // The Hingoli Gate flyover, driven its own way in the kerb lane from the street, road after road.
  const hingoli = r => net.name(r) === 'Hingoli Gate Flyover' && net.raised[r];
  let climbs = 0;
  for (let r0 = 0; r0 < net.count; r0++) {
    const from = net.oneway[r0] > 0 ? net.ra[r0] : net.rb[r0];
    if (!hingoli(r0) || !net.oneway[r0] || net.jDeck[from] > 0.05) continue;
    let y = 0, high = 0;
    for (let r = r0, j = from; r >= 0; ) {
      const dir = net.ra[r] === j ? 1 : -1, len = net.length[r];
      for (let s = 0; s <= len; s += 0.4) {
        net.lanePoint(r, dir, s, net.laneOffset(r, 0, dir > 0 ? s : len - s), p);
        y = net.surfaceAt(p.x, p.z, y);
        high = Math.max(high, y);
      }
      j = net.otherEnd(r, j);
      r = net.jDeck[j] > 0.05 ? net.jRoads[j].find(o => o !== r && hingoli(o) && net.oneway[o] === (net.ra[o] === j ? 1 : -1)) ?? -1 : -1;
    }
    assert.ok(high > DECK_H - 0.01, `up the Hingoli Gate flyover from road ${r0}: ${high.toFixed(2)} m`);
    climbs++;
  }
  assert.ok(climbs >= 2, 'both carriageways climbed');
  // Crossing a ramp's foot, inside the junction, the street stays on the ground.
  for (let j = 0; j < net.junctionCount; j++) {
    if (net.jDeck[j] > 0.05 || !net.jRoads[j].some(r => net.raised[r])) continue;
    for (let a = 0; a < 16; a++) {
      const k = (net.jRadius[j] - 1) * Math.sqrt((a % 4 + 0.5) / 4), t = (a * Math.PI) / 8;
      assert.ok(net.surfaceAt(net.jx[j] + Math.cos(t) * k, net.jz[j] + Math.sin(t) * k, 0) < 0.25, `junction ${j}`);
    }
  }
});

test('railings on a deck stop deck traffic and let the street below through', () => {
  const { net, city } = world();
  const colliders = new Colliders(city);
  const c = net.crossings.find(k => k.h >= DECK_H - 0.01 && k.half < 6.5);
  const p = net.pointAt(c.road, c.s, {});
  const heading = Math.atan2(p.dx, p.dz) + Math.PI / 2; // across the flyover, as the street runs
  const out = {};
  // A car on the street beneath, right under the deck's edge: nothing to hit.
  const hw = net.width[c.road] / 2;
  assert.equal(colliders.boxContact(p.x + p.dz * hw, p.z - p.dx * hw, 0.85, 2, heading, out, 0), null, 'street level is clear');
  // The same spot at deck level: the railing.
  assert.ok(colliders.boxContact(p.x + p.dz * hw, p.z - p.dx * hw, 0.85, 2, heading, out, DECK_H), 'the deck has a railing');
});
