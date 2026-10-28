import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { Save } from '../src/game/save.js';

function storage() {
  const store = new Map();
  globalThis.localStorage = { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
}

test('an untouched save does not offer Continue, but every started session does', () => {
  storage();
  const save = new Save();
  assert.equal(save.hasProgress, false);
  save.data.started = true;
  save.dirty(); save.flush();
  assert.equal(new Save().hasProgress, true, 'a session can resume before its first reward');
});

test('free-roam stamps, records and stats survive at starting cash without story missions', () => {
  storage();
  const save = new Save();
  save.data.started = true;
  save.data.stamps.push('hazur-sahib');
  save.data.districts.push('old-city');
  save.data.records['river-run'] = 74.5;
  save.stat('playTime', 600);
  save.stat('distance', 1200);
  save.flush();
  const again = new Save();
  assert.equal(again.hasProgress, true, 'Continue recognizes exploration as progress');
  assert.equal(again.cash, 200);
  assert.deepEqual(again.data.story, []);
  assert.deepEqual(again.data.stamps, ['hazur-sahib']);
  assert.deepEqual(again.data.districts, ['old-city']);
  assert.equal(again.data.records['river-run'], 74.5);
  assert.equal(again.data.stats.playTime, 600);
  assert.equal(again.data.stats.distance, 1200);
});

// Exercise the real cover button handler, with only its DOM and clock stood in:
// this keeps the destructive reset's confirmation and settings retention in the test.
function newStoryButton(save) {
  const source = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  const from = source.indexOf("  const newBtn = $('menu-new')");
  const to = source.indexOf("  $('menu-free').addEventListener", from);
  assert.ok(from > 0 && to > from, 'the cover has a New Story handler');
  let click, now = 1000;
  const modes = [];
  const small = { textContent: 'Godavari Gold' }, big = { textContent: 'NEW STORY' };
  const button = { querySelector: s => s === 'small' ? small : big, addEventListener: (_type, f) => { click = f; } };
  runInNewContext(source.slice(from, to), {
    $: () => button, game: { save }, has: save.hasProgress, starting: false,
    begin: mode => modes.push(mode), performance: { now: () => now },
    matchMedia: () => ({ matches: true }), setTimeout: () => 1, clearTimeout() {},
  });
  return { click: () => click(), advance: t => { now += t; }, modes, big };
}

test('New Story confirms before resetting a free-roam save and retains settings on disk', () => {
  storage();
  const save = new Save();
  save.data.started = true;
  save.data.stamps.push('hazur-sahib');
  save.stat('playTime', 600);
  save.data.settings.sensitivity = 1.4;
  save.data.settings.sound = false;
  save.flush();
  const button = newStoryButton(save);
  button.click();
  assert.equal(button.big.textContent, 'ERASE SAVE?');
  assert.deepEqual(button.modes, []);
  assert.deepEqual(save.data.stamps, ['hazur-sahib'], 'the first tap erases nothing');
  button.advance(100); button.click();
  assert.deepEqual(button.modes, [], 'a double tap does not confirm erasing');
  button.advance(600); button.click();
  assert.deepEqual(button.modes, ['new']);
  const again = new Save();
  assert.equal(again.hasProgress, false, 'reset happened before the new session starts');
  assert.deepEqual(again.data.stamps, []);
  assert.equal(again.data.stats.playTime, 0);
  assert.equal(again.cash, 200);
  assert.equal(again.data.settings.sensitivity, 1.4);
  assert.equal(again.data.settings.sound, false);
});

test('New Story opens immediately on a genuinely untouched save', () => {
  storage();
  const button = newStoryButton(new Save());
  button.click();
  assert.deepEqual(button.modes, ['new']);
  assert.equal(button.big.textContent, 'NEW STORY');
});
