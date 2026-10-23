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
