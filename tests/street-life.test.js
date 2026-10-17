import test from 'node:test';
import assert from 'node:assert/strict';
import { timeOfDay, VENDOR_MENU, CHATTER, signalState, PHASES } from '../src/street-life.js';
import { MISSIONS, VEHICLES } from '../src/mechanics.js';

test('the sky follows the local clock: day, a warm dusk, and a lantern-lit night', () => {
  const at = h => new Date(2026, 9, 17, h, 0);
  assert.equal(timeOfDay(at(12)), 'day');
  assert.equal(timeOfDay(at(18)), 'dusk');
  assert.equal(timeOfDay(at(6)), 'dusk');
  assert.equal(timeOfDay(at(21)), 'night');
  assert.equal(timeOfDay(at(2)), 'night');
});

test('vendors, chatter and new vehicles are all defined', () => {
  assert.ok(VENDOR_MENU.every(v => v.price > 0 && v.item && v.mr && v.line && v.lineEn));
  assert.ok(CHATTER.every(line => line.mr && line.en));
  for (const kind of ['bike', 'bus']) assert.ok(VEHICLES[kind].maxSpeed > 0 && VEHICLES[kind].radius > 0, kind);
  assert.ok(VEHICLES.bike.maxSpeed > VEHICLES.auto.maxSpeed, 'a bike is quicker than an auto-rickshaw');
});

test('traffic signals cycle green, amber, red and opposite approaches never share a green', () => {
  assert.equal(signalState(0), 'green');
  assert.equal(signalState(6.5), 'amber');
  assert.equal(signalState(10), 'red');
  assert.equal(signalState(14), 'green', 'the cycle wraps');
  assert.equal(signalState(-1), 'red', 'negative time still lands inside the cycle');
  for (let t = 0; t < 28; t += 0.25) {
    assert.ok(!(signalState(t, 0) === 'green' && signalState(t, 7) === 'green'), `both approaches green at ${t}s`);
  }
  assert.deepEqual(PHASES, ['day', 'dusk', 'night']);
});

test('the yatra, bazaar and airport adventures use real researched stops', () => {
  const yatra = MISSIONS.find(m => m.id === 'darshan-yatra');
  assert.deepEqual(yatra.stops.map(s => s.placeId), ['hazur-sahib', 'nagina-ghat', 'langar-sahib', 'sangat-sahib']);
  const run = MISSIONS.find(m => m.id === 'airport-run');
  assert.equal(run.race, true);
  assert.equal(run.stops.at(-1).placeId, 'nanded-airport');
  assert.ok(run.seconds >= 180, 'a cross-city run needs a fair clock');
});

test('the two new side missions are repeatable on foot with a clear objective', () => {
  for (const id of ['tiffin-run', 'ghat-errand']) {
    const def = MISSIONS.find(m => m.id === id);
    assert.ok(def, id);
    assert.equal(def.seconds, null, `${id} has no timer`);
    assert.ok(def.stops.length >= 2 && def.stops.every(s => Number.isFinite(s.x) && s.label), id);
  }
  assert.equal(new Set(MISSIONS.map(m => m.id)).size, MISSIONS.length, 'mission ids are unique');
});

import { seasonalWeather } from '../src/street-life.js';

test('the monsoon brings mostly rain, summer is hazy, and winter is clear', () => {
  const on = month => new Date(2026, month, 15);
  const never = () => 0.99; // the least likely roll: rain stays in the monsoon, haze otherwise
  assert.equal(seasonalWeather(on(6), never), 'clear');
  assert.equal(seasonalWeather(on(6), () => 0.1), 'rain');
  assert.equal(seasonalWeather(on(3), () => 0.1), 'haze');
  assert.equal(seasonalWeather(on(3), () => 0.9), 'clear');
  assert.equal(seasonalWeather(on(11), () => 0.05), 'haze');
  assert.equal(seasonalWeather(on(11), () => 0.5), 'clear');
});
