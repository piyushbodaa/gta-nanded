import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Input } from '../src/core/input.js';
import { installRules } from '../src/game/rules.js';

class El {
  constructor() { this.on = {}; }
  addEventListener(type, fn) { (this.on[type] ||= []).push(fn); }
}
for (const name of ['HTMLInputElement', 'HTMLTextAreaElement', 'HTMLSelectElement', 'HTMLButtonElement']) globalThis[name] = class extends El {};

function setup(t) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const win = new El(), canvas = new El();
  globalThis.addEventListener = (type, fn) => win.addEventListener(type, fn);
  globalThis.document = Object.assign(new El(), { body: new El(), getElementById: () => new El() });
  const input = new Input(canvas);
  input.live = true;
  const g = {
    input, started: true, paused: false, city: { places: [] }, peds: {},
    vehicles: { list: [], spawn(type) { const v = { type }; this.list.push(v); return v; } },
    net: { nearest: () => ({ x: 0, z: 0, dx: 0, dz: 1, road: 0 }), oneway: [0] },
    player: { pos: { x: 0, z: 0 }, heading: 0, health: 1, maxHealth: 100 },
    police: { level: 3, clear() { this.level = 0; } },
    sky: { hours: 9, weather: 'clear', setWeather(weather) { this.weather = weather; } },
    save: { cash: 200 }, audio: { sfx() {} },
    messages: [], hud: { cashChange() {}, big(...args) { g.messages.push(args); } },
  };
  installRules(g);
  const fire = (type, props = {}) => {
    const e = { target: canvas, preventDefault() {}, ...props };
    for (const fn of win.on[type] || []) fn(e);
  };
  const frame = () => {
    if (input.pressed('pause')) g.paused = !g.paused;
    if (input.pressed('map')) g.paused = !g.paused;
    input.endFrame();
  };
  const key = (letter, props = {}) => {
    const code = letter.length === 1 ? `Key${letter.toUpperCase()}` : letter;
    fire('keydown', { key: letter, code, ...props });
    fire('keyup', { key: letter, code });
    frame();
  };
  return { g, key, frame, fire };
}

const cheats = {
  BHAUMONEY: g => assert.equal(g.save.cash, 5200),
  KADAMCHUTTI: g => assert.equal(g.police.level, 0),
  JUGAAD: g => assert.equal(g.player.health, 100),
  LALPARI: g => assert.equal(g.vehicles.list[0]?.type, 'bus'),
  RICKSHAW: g => assert.equal(g.vehicles.list[0]?.type, 'auto'),
  POLICEWALA: g => assert.equal(g.vehicles.list[0]?.type, 'police'),
  PAUSKALA: g => assert.equal(g.sky.weather, 'rain'),
  RAATRANI: g => assert.equal(g.sky.hours, 21),
};
for (const [code, check] of Object.entries(cheats)) {
  test(`${code} can be typed with a game frame between every letter`, t => {
    const { g, key, frame } = setup(t);
    for (const letter of code.toLowerCase()) {
      key(letter);
      assert.equal(g.paused, false, `typing ${letter} must not open the menu`);
      t.mock.timers.tick(100);
    }
    check(g);
    assert.equal(g.messages.length, 1);
    t.mock.timers.tick(1500); frame();
    assert.equal(g.paused, false, 'no delayed menu after the cheat');
  });
}

test('a lone P pauses after the prefix wait, and an invalid continuation pauses immediately', t => {
  const { g, key, frame } = setup(t);
  key('p');
  t.mock.timers.tick(999); frame();
  assert.equal(g.paused, false);
  t.mock.timers.tick(1); frame();
  assert.equal(g.paused, true);
  g.paused = false;
  key('p'); key('x');
  assert.equal(g.paused, true);
});

test('M, Escape and Tab still open the menu immediately without a cheat prefix', t => {
  const { g, key } = setup(t);
  for (const code of ['m', 'Escape', 'Tab']) {
    g.paused = false; key(code);
    assert.equal(g.paused, true, code);
  }
});

test('a non-letter gameplay key releases deferred pause; menu keys do not queue two actions', t => {
  const { g, key, frame } = setup(t);
  for (const code of ['Space', 'ArrowUp', 'Escape', 'Tab', 'm']) {
    g.paused = false;
    key('p'); key(code);
    assert.equal(g.paused, true, code);
    g.paused = false;
    t.mock.timers.tick(1000); frame();
    assert.equal(g.paused, false, 'no stale pause after returning to play');
  }
});

test('Shift between letters preserves a cheat prefix', t => {
  const { g, key } = setup(t);
  for (const c of 'PAUSKALA') { key('Shift'); key(c); }
  assert.equal(g.paused, false);
  assert.equal(g.sky.weather, 'rain');
});

test('expired prefixes do not swallow M and blur cancels deferred pause', t => {
  const { g, key, frame, fire } = setup(t);
  for (const c of 'bhau') key(c);
  t.mock.timers.tick(1000); key('m');
  assert.equal(g.paused, true);
  g.paused = false;
  key('p'); fire('blur');
  t.mock.timers.tick(1000); frame();
  assert.equal(g.paused, false);
});

test('held-key repeats do not break a prefix, and form input does not activate cheats', t => {
  const { g, key } = setup(t);
  key('p'); key('p', { repeat: true });
  for (const c of 'auskala') key(c);
  assert.equal(g.sky.weather, 'rain');
  for (const c of 'bhaumoney') key(c, { target: new HTMLInputElement() });
  assert.equal(g.save.cash, 200);
});
