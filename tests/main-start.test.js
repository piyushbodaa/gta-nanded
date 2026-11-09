import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// Exercise the real cover's start handler without loading WebGL, CSS or the city.
const source = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
const beginSource = source.slice(source.indexOf('  let starting = false;'), source.indexOf("  $('menu-continue').addEventListener"));

function cover(init, { sound = true, failStart = false, failIntro = false } = {}) {
  const timers = new Map(), starts = [];
  let nextTimer = 0, initCalls = 0, introCalls = 0, completeIntro;
  const game = { started: false, save: { data: {} }, audio: {
    init() { initCalls++; return init(); }, setVolumes() {}, setEnabled() {},
  } };
  const intro = { play(done) { introCalls++; if (failIntro) throw new Error('intro failed'); completeIntro = done; } };
  const controls = vm.runInNewContext(`${beginSource}\n({ begin, get starting() { return starting; }, get onMenu() { return onMenu; } });`, {
    game, intro, st: { sound }, onMenu: true, fullscreen() {},
    startGame(g, mode) { if (failStart) throw new Error('start failed'); starts.push(mode); g.started = true; },
    setTimeout(fn, delay) { const id = ++nextTimer; timers.set(id, { fn, delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
  });
  return { game, controls, starts, timers, get initCalls() { return initCalls; }, get introCalls() { return introCalls; },
    finishIntro() { completeIntro(); },
    timeout() { for (const { fn, delay } of timers.values()) { assert.equal(delay, 1000); fn(); } },
  };
}

for (const mode of ['continue', 'free', 'new']) {
  test(`${mode} starts after the audio deadline even if resume never settles`, async () => {
    const c = cover(() => new Promise(() => {}));
    const pending = c.controls.begin(mode);
    assert.equal(c.initCalls, 1, 'audio starts synchronously in the user gesture');
    await c.controls.begin(mode);
    assert.equal(c.initCalls, 1, 'a second tap cannot start a second audio wait');
    assert.equal(c.starts.length, 0);
    c.timeout();
    await pending;
    assert.equal(c.timers.size, 0);
    if (mode === 'new') {
      assert.equal(c.introCalls, 1);
      assert.equal(c.starts.length, 0, 'the intro still precedes gameplay');
      await c.controls.begin('free');
      assert.equal(c.initCalls, 1, 'the guard stays set throughout the intro');
      c.finishIntro();
    }
    assert.deepEqual(c.starts, [mode]);
    assert.equal(c.controls.starting, false);
  });
}

test('audio success, rejection or a synchronous failure cannot hold the cover open', async () => {
  for (const init of [() => Promise.resolve(), () => Promise.reject(new Error('blocked')), () => { throw new Error('unsupported'); }]) {
    const c = cover(init);
    await c.controls.begin('free');
    assert.deepEqual(c.starts, ['free']);
    assert.equal(c.timers.size, 0, 'settled audio clears its deadline');
  }
});

test('startup and intro failures release the start guard', async () => {
  for (const options of [{ failStart: true }, { failIntro: true }]) {
    const c = cover(() => Promise.resolve(), options);
    await assert.rejects(c.controls.begin(options.failIntro ? 'new' : 'free'), /failed/);
    assert.equal(c.controls.starting, false);
    assert.equal(c.controls.onMenu, true);
  }
  const c = cover(() => Promise.resolve(), { failStart: true });
  await c.controls.begin('new');
  assert.throws(() => c.finishIntro(), /start failed/);
  assert.equal(c.controls.starting, false, 'a delayed intro callback also releases the guard');
});

test('sound off starts immediately without initializing audio', async () => {
  const c = cover(() => { throw new Error('audio should stay off'); }, { sound: false });
  await c.controls.begin('free');
  assert.equal(c.initCalls, 0);
  assert.deepEqual(c.starts, ['free']);
  assert.equal(c.timers.size, 0);
});
