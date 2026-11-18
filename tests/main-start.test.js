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
    finishIntro(skipCampaign = false) { completeIntro(skipCampaign); },
    timeout() { for (const { fn, delay } of timers.values()) { assert.equal(delay, 1000); fn(); } },
  };
}

for (const mode of ['continue', 'free', 'new']) {
  test(`${mode} starts at once even if the phone's audio never opens`, async () => {
    const c = cover(() => new Promise(() => {}));
    c.controls.begin(mode);
    assert.equal(c.initCalls, 1, 'audio starts synchronously in the user gesture');
    c.controls.begin(mode);
    assert.equal(c.initCalls, 1, 'a second tap cannot start the audio or the game again');
    assert.equal(c.timers.size, 0, 'nothing waits on the audio');
    if (mode === 'new') {
      assert.equal(c.introCalls, 1);
      assert.equal(c.starts.length, 0, 'the intro still precedes gameplay');
      c.controls.begin('free');
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
    c.controls.begin('free');
    assert.deepEqual(c.starts, ['free']);
    await new Promise(r => setImmediate(r)); // a rejected init is caught, not left unhandled
  }
});

test('startup and intro failures release the start guard', () => {
  for (const options of [{ failStart: true }, { failIntro: true }]) {
    const c = cover(() => Promise.resolve(), options);
    assert.throws(() => c.controls.begin(options.failIntro ? 'new' : 'free'), /failed/);
    assert.equal(c.controls.starting, false);
    assert.equal(c.controls.onMenu, true);
  }
  const c = cover(() => Promise.resolve(), { failStart: true });
  c.controls.begin('new');
  assert.throws(() => c.finishIntro(), /start failed/);
  assert.equal(c.controls.starting, false, 'a delayed intro callback also releases the guard');
});

test('sound off starts immediately without initializing audio', async () => {
  const c = cover(() => { throw new Error('audio should stay off'); }, { sound: false });
  c.controls.begin('free');
  assert.equal(c.initCalls, 0);
  assert.deepEqual(c.starts, ['free']);
  assert.equal(c.timers.size, 0);
});

test('Skip story starts free roam without clearing a previously confirmed story save', () => {
  const c = cover(() => Promise.resolve());
  c.game.save.data = { story: ['c1'], cash: 810, seenIntro: true };
  c.game.save.reset = () => assert.fail('free roam must preserve progress');
  c.controls.begin('new', true);
  assert.equal(c.introCalls, 1);
  c.finishIntro(true);
  assert.deepEqual(c.starts, ['free']);
  assert.deepEqual(c.game.save.data.story, ['c1']);
  assert.equal(c.game.save.data.cash, 810);
});

test('Skip intro commits a confirmed new story and keeps sound settings', () => {
  const c = cover(() => Promise.resolve());
  const settings = { sound: false, music: .35 };
  c.game.save.data = { settings, story: ['c1'] };
  c.game.save.reset = () => { c.game.save.data = { story: [] }; };
  c.controls.begin('new', true);
  c.finishIntro();
  assert.deepEqual(c.starts, ['new']);
  assert.deepEqual(c.game.save.data.story, []);
  assert.equal(c.game.save.data.settings, settings);
});
