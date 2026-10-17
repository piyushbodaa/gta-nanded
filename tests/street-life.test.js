import test from 'node:test';
import assert from 'node:assert/strict';
import { timeOfDay, VENDOR_MENU, CHATTER } from '../src/street-life.js';
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

test('the two new side missions are repeatable on foot with a clear objective', () => {
  for (const id of ['tiffin-run', 'ghat-errand']) {
    const def = MISSIONS.find(m => m.id === id);
    assert.ok(def, id);
    assert.equal(def.seconds, null, `${id} has no timer`);
    assert.ok(def.stops.length >= 2 && def.stops.every(s => Number.isFinite(s.x) && s.label), id);
  }
  assert.equal(new Set(MISSIONS.map(m => m.id)).size, MISSIONS.length, 'mission ids are unique');
});
