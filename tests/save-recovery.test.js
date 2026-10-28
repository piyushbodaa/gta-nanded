import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Save } from '../src/game/save.js';

test('a corrupt save starts fresh without marking working storage unavailable', () => {
  const store = new Map([['gta-nanded-save-v2', '{"cash":']]);
  globalThis.localStorage = { getItem: key => store.get(key) ?? null, setItem: (key, value) => store.set(key, value) };
  const save = new Save();
  assert.equal(save.available, true);
  assert.equal(save.cash, 200);
  assert.deepEqual(save.data.story, []);
  save.cash = 350;
  assert.equal(save.flush(), true);
  assert.equal(new Save().cash, 350);
});

test('a real write failure after a corrupt save is reported once', () => {
  globalThis.localStorage = { getItem: () => '{', setItem() { throw new Error('quota exceeded'); } };
  const save = new Save();
  let failures = 0;
  save.onFail = () => failures++;
  save.cash = 350;
  assert.equal(save.flush(), false);
  assert.equal(save.available, false);
  assert.equal(failures, 1);
  assert.equal(save.flush(), false);
  assert.equal(failures, 1);
});

test('a blocked storage read still marks saves unavailable', () => {
  globalThis.localStorage = { getItem() { throw new Error('storage blocked'); } };
  const save = new Save();
  assert.equal(save.available, false);
  assert.equal(save.cash, 200);
});
