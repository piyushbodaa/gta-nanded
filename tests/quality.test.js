import test from 'node:test';
import assert from 'node:assert/strict';
import { QUALITY_TIERS, initialTier, loadQualityMode, saveQualityMode, nextQualityMode, tierForMode, createAutoQuality, tierSettings } from '../src/quality.js';

test('quality tiers get strictly cheaper from best to worst', () => {
  for (let i = 1; i < QUALITY_TIERS.length; i++) {
    assert.ok(QUALITY_TIERS[i].pixelRatio < QUALITY_TIERS[i - 1].pixelRatio, QUALITY_TIERS[i].name);
    assert.ok(QUALITY_TIERS[i].viewDistance < QUALITY_TIERS[i - 1].viewDistance, QUALITY_TIERS[i].name);
    assert.ok(QUALITY_TIERS[i].actorDistance < QUALITY_TIERS[i - 1].actorDistance, QUALITY_TIERS[i].name);
  }
  assert.equal(QUALITY_TIERS.at(-1).shadowMap, 0, 'the cheapest tier drops shadows entirely');
});

test('weak devices start on a cheaper tier than strong ones', () => {
  assert.equal(initialTier({}), 0);
  assert.equal(initialTier({ coarse: true }), 1);
  assert.equal(initialTier({ coarse: true, cores: 4, memory: 3 }), 3);
  assert.ok(initialTier({ coarse: true, smallScreen: true, cores: 2, memory: 2 }) <= QUALITY_TIERS.length - 1);
});

test('the saved quality mode survives a reload and bad storage is safe', () => {
  let value;
  const storage = { getItem: () => value, setItem: (k, v) => { value = v; } };
  assert.equal(loadQualityMode(storage), 'auto');
  assert.equal(saveQualityMode(storage, 'performance'), true);
  assert.equal(loadQualityMode(storage), 'performance');
  value = 'nonsense';
  assert.equal(loadQualityMode(storage), 'auto', 'an unknown saved mode falls back to auto');
  assert.equal(saveQualityMode({ setItem() { throw Error(); } }, 'high'), false);
  assert.equal(loadQualityMode({ getItem() { throw Error(); } }), 'auto');
});

test('cycling the mode visits every choice and pinned modes ignore the auto tier', () => {
  assert.equal(nextQualityMode('auto'), 'high');
  assert.equal(nextQualityMode('performance'), 'auto');
  assert.equal(tierForMode('high', 3), QUALITY_TIERS[0]);
  assert.equal(tierForMode('performance', 0), QUALITY_TIERS[2]);
  assert.equal(tierForMode('auto', 2), QUALITY_TIERS[2]);
  assert.equal(tierForMode('auto', 99), QUALITY_TIERS.at(-1));
});

test('auto quality steps down under sustained load, then recovers only after a long calm stretch', () => {
  const auto = createAutoQuality(0);
  let changed = null;
  for (let i = 0; i < 600 && changed === null; i++) changed = auto.sample(1 / 25);
  assert.equal(changed, 1, '25 fps steps down one tier');
  assert.ok(auto.fps < 40);
  // A single hitch must not bounce the tier around.
  assert.equal(auto.sample(0.1), null);
  let recovered = null;
  for (let i = 0; i < 60 * 30 && recovered === null; i++) recovered = auto.sample(1 / 60);
  assert.equal(recovered, 0, 'sustained 60 fps eventually steps back up');
  assert.equal(auto.sample(NaN), null);
  assert.equal(auto.sample(0), null);
});

test('tier settings respect the real device pixel ratio and mobile caps', () => {
  const desktop = tierSettings(QUALITY_TIERS[0], { mobile: false, devicePixelRatio: 3 });
  assert.equal(desktop.pixelRatio, 1.6, 'never renders above the tier cap, however dense the screen');
  assert.equal(desktop.shadowMap, 2048);
  const phone = tierSettings(QUALITY_TIERS[0], { mobile: true, devicePixelRatio: 3 });
  assert.equal(phone.pixelRatio, 1.25);
  assert.equal(phone.shadowMap, 1024);
  const lowDpr = tierSettings(QUALITY_TIERS[0], { mobile: false, devicePixelRatio: 1 });
  assert.equal(lowDpr.pixelRatio, 1, 'never upscales past the device ratio');
});
