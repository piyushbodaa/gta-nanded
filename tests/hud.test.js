import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Hud, countCash } from '../src/ui/hud.js';
import { keyName } from '../src/ui/controls.js';

// Just enough DOM for the HUD: elements that count their writes.
class FakeEl {
  constructor() {
    this.hidden = true; this.writes = 0; this.html = ''; this.offsetWidth = 0;
    this.style = { animation: '', setProperty() {} };
    const classes = new Set();
    this.classList = { toggle: (c, on) => (on ? classes.add(c) : classes.delete(c)), add: c => classes.add(c), remove: c => classes.delete(c), contains: c => classes.has(c) };
    this.parentElement = { classList: this.classList };
  }
  get innerHTML() { return this.html; }
  set innerHTML(v) { this.html = String(v); this.writes++; }
  get textContent() { return this.html; }
  set textContent(v) { this.html = String(v); this.writes++; }
  getContext() { return {}; }
  getBoundingClientRect() { return { width: 100, height: 100 }; }
}
const els = {};
globalThis.document = { getElementById: id => (els[id] ??= new FakeEl()) };
globalThis.addEventListener ??= () => {};
globalThis.requestAnimationFrame ??= () => 0;

function fakeGame(mode = 'keyboard') {
  return {
    time: 0, waypoint: null,
    input: { mode, touch: { active: mode === 'touch' } },
    save: { cash: 0 },
    sky: { clockText: () => '17:00' },
    player: { pos: { x: 0, z: 0 }, x: 0, z: 0, state: 'foot', vehicle: null, health: 100, maxHealth: 100, stamina: 1 },
    city: { district: () => ({ name: 'Taroda Khurd' }) },
    missions: { active: null, blips: () => [] },
    jobs: { active: null },
    net: { route: (ax, az, bx, bz) => ({ points: [ax, az, bx, bz] }) },
    nearestEnterable: () => null,
  };
}
function hudFor(g) {
  for (const k in els) delete els[k];
  const hud = new Hud(g);
  hud.radar = { draw() {}, resize() {} };
  return hud;
}

test('the cash counter lands exactly on the balance at any frame rate', () => {
  for (const fps of [30, 60, 90, 120, 144]) {
    for (const [from, to] of [[0, 200], [200, 700], [700, 450], [0, 12], [6000, 5800]]) {
      let shown = from, frames = 0;
      while (shown !== to && frames < 2000) { shown = countCash(shown, to, 1 / fps); frames++; }
      assert.equal(shown, to, `${fps} fps, ₹${from} → ₹${to}`);
      assert.ok(frames < fps * 3, `${fps} fps, ₹${from} → ₹${to} took ${frames} frames`);
    }
  }
});

test('objective, timer and speedometer touch the DOM only when they change', () => {
  const g = fakeGame(), hud = hudFor(g);
  for (let i = 0; i < 100; i++) hud.objective('Drive to <b>Old Mondha</b>');
  assert.equal(els['hud-objective'].writes, 1);
  assert.equal(els['hud-objective'].hidden, false);
  hud.objective('');
  assert.equal(els['hud-objective'].hidden, true);
  // A countdown set every frame for 2 s rewrites only when the seconds change.
  for (let t = 30; t > 28; t -= 1 / 60) hud.setTimer(t, 'TIP');
  assert.ok(els['hud-timer'].writes <= 3, `${els['hud-timer'].writes} timer writes`);
  // Driving at a steady speed: the speed and gear are written once.
  g.player.vehicle = { vx: 0, vz: 10, heading: 0, gear: 2, health: 1000 };
  for (let i = 0; i < 60; i++) hud.update(1 / 60);
  assert.equal(els['hud-speed-num'].writes, 1);
  assert.equal(els['hud-gear'].writes, 1);
  assert.equal(els['hud-speed-num'].html, '36');
});

test('a countdown turns urgent in its last 10 s, a race stopwatch never does', () => {
  const hud = hudFor(fakeGame()), timer = els['hud-timer'];
  hud.setTimer(42, 'TIP');
  assert.equal(timer.classList.contains('urgent'), false);
  hud.setTimer(9, 'TIP');
  assert.equal(timer.classList.contains('urgent'), true);
  hud.setTimer(3, 'TIME', false);
  assert.equal(timer.classList.contains('urgent'), false);
  assert.match(timer.html, /TIME.*0:03/);
});

test('on a touch screen the help box waits for a big card, then shows for its full time', () => {
  const g = fakeGame('touch'), hud = hudFor(g), help = els['hud-help'];
  hud.big('MISSION PASSED', '₹500', 'passed', 5);
  hud.help('New contacts are marked on your radar.', 9);
  assert.equal(help.hidden, true, 'not under the card');
  for (let t = 0; t < 5.1; t += 0.1) hud.update(0.1);
  assert.equal(help.hidden, false);
  assert.match(help.html, /New contacts/);
  assert.ok(hud.timers.help > 8.5, 'its whole time is still to come');
  // A help box already up steps aside for a card and comes back with the time it had left.
  hud.update(3);
  hud.big('WANTED', 'A student saw you take it', 'wanted', 2.5);
  assert.equal(help.hidden, true);
  for (let t = 0; t < 2.6; t += 0.1) hud.update(0.1);
  assert.equal(help.hidden, false);
  // Keyboard players see both at once: their help box is in the corner.
  const k = hudFor(fakeGame('keyboard'));
  k.big('MISSION PASSED', '₹500', 'passed', 5);
  k.help('Corner help', 6);
  assert.equal(els['hud-help'].hidden, false);
});

test('a big card reads as a sentence and a second cash change restarts its animation', () => {
  const hud = hudFor(fakeGame());
  hud.big('MISSION FAILED', 'sand tipper was wrecked.', 'failed');
  assert.match(els['hud-big'].html, /<span>Sand tipper was wrecked\.<\/span>/);
  const delta = els['hud-cash-delta'];
  const seen = [];
  Object.defineProperty(delta.style, 'animation', { get: () => '', set: v => seen.push(v) });
  hud.cashChange(10); hud.cashChange(-15);
  assert.deepEqual(seen, ['none', '', 'none', '']);
  assert.equal(delta.html, '−₹15');
});

test('prompts and the corner hint name the keys of the device in use', () => {
  const g = fakeGame('keyboard'), hud = hudFor(g);
  g.nearestEnterable = () => ({ type: 'auto', driver: null });
  g.contextAction = () => ({ label: 'Buy chai · ₹10' });
  hud.update(0.25);
  assert.match(els['hud-prompt'].html, /<kbd>F<\/kbd>Get in .*<kbd>Q<\/kbd>Buy chai/);
  assert.match(els['hud-hint'].html, /<kbd>Esc<\/kbd> Pause <kbd>M<\/kbd> Map/);
  g.input.mode = 'gamepad';
  hud.update(0.25);
  assert.match(els['hud-prompt'].html, /<kbd>Y<\/kbd>Get in .*<kbd>X<\/kbd>Buy chai/);
  assert.match(els['hud-hint'].html, /<kbd>Start<\/kbd> Pause <kbd>Back<\/kbd> Map/);
  // Behind the wheel the job key.
  g.player.state = 'driving'; g.player.vehicle = { vx: 0, vz: 0, heading: 0, gear: 1, health: 1000 };
  g.contextAction = () => ({ key: 'N', label: 'Start rickshaw fares' });
  hud.update(0.25);
  assert.match(els['hud-prompt'].html, /<kbd>D-pad ↑<\/kbd>Start rickshaw fares/);
  assert.equal(keyName(g, 'pause'), 'Start');
});

test('the waypoint line follows the player, gives way to missions and jobs, and clears on arrival', () => {
  const g = fakeGame(), hud = hudFor(g);
  g.waypoint = { x: 1000, z: 0 };
  hud.update(0.1);
  assert.deepEqual(hud.route.points.slice(0, 2), [0, 0]);
  assert.equal(hud.route.color, '#c77dff');
  // Moved: within 1.2 s the line starts from the new spot.
  g.player.pos = { x: 300, z: 40 };
  for (let t = 0; t < 1.3; t += 0.1) hud.update(0.1);
  assert.deepEqual(hud.route.points.slice(0, 2), [300, 40]);
  // A mission owns the route while it runs; after it ends (route null) the waypoint's comes back.
  g.missions.active = {}; hud.route = { points: [], color: '#f4c430' };
  for (let t = 0; t < 1.3; t += 0.1) hud.update(0.1);
  assert.equal(hud.route.color, '#f4c430');
  g.missions.active = null; hud.route = null;
  for (let t = 0; t < 1.3; t += 0.1) hud.update(0.1);
  assert.equal(hud.route?.color, '#c77dff');
  // Arriving clears the waypoint and its line.
  g.player.pos = { x: 990, z: 5 };
  for (let t = 0; t < 1.3; t += 0.1) hud.update(0.1);
  assert.equal(g.waypoint, null);
  assert.equal(hud.route, null);
});
