import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Hud, countCash } from '../src/ui/hud.js';
import { keyName } from '../src/ui/controls.js';

// Just enough DOM for the HUD: elements that count their writes. Layout is whatever a test says: an element's
// `box` (top and bottom on the screen), and the middle column's bottom (`column.bottom()`, its children's parent).
const column = { bottom: () => 0 };
class FakeEl {
  constructor() {
    this.hidden = true; this.writes = 0; this.html = ''; this.offsetWidth = 0; this.offsetTop = 0; this.offsetHeight = 0;
    this.box = { top: 0, bottom: 0 };
    this.style = { animation: '', top: '', setProperty() {} };
    const classes = new Set();
    this.classList = { toggle: (c, on) => (on ? classes.add(c) : classes.delete(c)), add: c => classes.add(c), remove: c => classes.delete(c), contains: c => classes.has(c) };
    this.parentElement = { classList: this.classList, getBoundingClientRect: () => ({ bottom: column.bottom() }) };
  }
  get innerHTML() { return this.html; }
  set innerHTML(v) { this.html = String(v); this.writes++; }
  get textContent() { return this.html; }
  set textContent(v) { this.html = String(v); this.writes++; }
  getContext() { return {}; }
  getBoundingClientRect() { return { width: 100, height: 100, ...this.box }; }
  querySelector(tag) { const m = this.html.match(new RegExp(`<${tag}[^>]*>(.*?)</${tag}>`)); return m && { textContent: m[1] }; }
}
const els = {};
globalThis.document = { getElementById: id => (els[id] ??= new FakeEl()) };
globalThis.addEventListener ??= () => {};
globalThis.requestAnimationFrame ??= () => 0;
globalThis.innerHeight = 320;

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
  column.bottom = () => 0;
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

// The middle column at 568 x 320 as measured in the game: it starts 56 px down, and what each part of it takes
// (a 3-line objective, a 5-line subtitle, the first drive's 6-line help, a 2-line toast, the 1-line station card).
function columnAt568() {
  const tall = { objective: 61, subtitle: 105, help: 132, toast: 50, radio: 20 };
  column.bottom = () => Object.entries(tall).reduce((y, [k, h]) => (els[`hud-${k}`].hidden ? y : y + h + 6), 56);
}

test('on the shortest phones the help box steps aside while a subtitle, toast or station card would push the column off the screen', () => {
  const g = fakeGame('touch'), hud = hudFor(g), help = els['hud-help'];
  columnAt568();
  hud.objective("Drive to <b>Kaka Savkar's office</b> in the Old Mondha lanes.");
  hud.help('Hold GAS to drive and steer with your left thumb.', 9);
  assert.equal(help.hidden, false, 'the objective and the help fit');
  hud.update(2);
  hud.subtitle('PAKYA', 'Savkar lends to half the district. Farmers, students, auto-wale. Nobody ever finishes paying.', 4.5);
  assert.equal(help.hidden, true, 'under the subtitle it ran off the bottom');
  for (let t = 0; t < 4.6; t += 0.1) hud.update(0.1);
  assert.equal(help.hidden, false, 'back when the subtitle goes');
  assert.ok(Math.abs(hud.timers.help - 7) < 0.25, `with the time it had left: ${hud.timers.help}`);
  // The next line of dialogue: aside again; the dialogue ends: back.
  hud.subtitle('PAKYA', 'No licence, no receipts.', 4.5);
  assert.equal(help.hidden, true);
  hud.clearSubtitle();
  assert.equal(help.hidden, false);
  // A toast with the station card under it: aside while the toast is up; the station card alone fits.
  hud.toast('New neighbourhood: Doctor Lane · 1/53 · +₹50');
  els['hud-radio'].hidden = false;
  hud.update(0.1);
  assert.equal(help.hidden, true);
  for (let t = 0; t < 3.1; t += 0.1) hud.update(0.1);
  assert.equal(els['hud-toast'].hidden, true);
  assert.equal(help.hidden, false, 'the objective, help and station card fit');
  // A big card still comes first: help that would come back under it waits for it.
  hud.subtitle('PAKYA', 'Careful, bhau.', 2);
  hud.big('WANTED', '', 'wanted', 3);
  for (let t = 0; t < 2.1; t += 0.1) hud.update(0.1);
  assert.equal(help.hidden, true, 'the subtitle went, the card is still up');
  for (let t = 0; t < 1.1; t += 0.1) hud.update(0.1);
  assert.equal(help.hidden, false);
  // Where the column has room (or with a keyboard, the help in its corner) nothing steps aside.
  column.bottom = () => 231; // 800 x 360: objective, subtitle and help
  hud.subtitle('PAKYA', 'Careful, bhau.', 4);
  assert.equal(help.hidden, false);
  const k = hudFor(fakeGame('keyboard'));
  columnAt568();
  k.help('Corner help', 6); k.subtitle('PAKYA', 'Careful, bhau.', 4);
  assert.equal(els['hud-help'].hidden, false);
});

test("on a phone the station card that only repeats the vehicle card's station goes; another station's replaces the vehicle card", () => {
  const g = fakeGame('touch'), hud = hudFor(g), radio = els['hud-radio'], vehicle = els['hud-vehicle'];
  vehicle.box = { top: 249, bottom: 302 };
  hud.vehicleName('Nanded Auto', 'रिक्षा · 📻 Radio Godavari 92.7');
  const station = (name, line) => { const r = els['hud-radio']; r.innerHTML = `<strong style="color:#ffcf3f">📻 ${name}</strong><span>${line}</span>`; r.hidden = false; };
  // The radio's DJ card as the first song starts (at 800 x 360 the column's end met the vehicle's name).
  station('Radio Godavari 92.7', 'Next up on Radio Godavari 92.7: a brand-new track, made in Nanded.');
  hud.update(0.1);
  assert.equal(radio.hidden, true, 'the vehicle card names the station already');
  assert.equal(vehicle.hidden, false);
  // 📻 tapped: another station. Now the vehicle card is out of date.
  station('Lavani Express 98.3', 'ढोलकी, हार्मोनियम आणि ठसका');
  hud.update(0.1);
  assert.equal(radio.hidden, false);
  assert.equal(vehicle.hidden, true);
  assert.equal(hud.timers.vehicle, 0);
  // With the vehicle card gone, a station card stays; with a keyboard, both do (they are far apart).
  station('Lavani Express 98.3', 'You are tuned to Lavani Express 98.3.');
  hud.update(0.1);
  assert.equal(radio.hidden, false);
  // 568 x 320, getting in for the first drive: the station card comes up, and in the same frame the first drive's
  // help, before the HUD's own update. The station card goes first, so the column (objective and help) stays
  // clear of the vehicle's name at the bottom instead of reaching it and dropping it.
  const p = hudFor(fakeGame('touch'));
  columnAt568();
  els['hud-vehicle'].box = { top: 270, bottom: 310 };
  p.objective("Drive to <b>Kaka Savkar's office</b> in the Old Mondha lanes.");
  p.vehicleName('Nanded Auto', 'रिक्षा · 📻 Radio Godavari 92.7');
  station('Radio Godavari 92.7', 'Radio Godavari 92.7 — chai cutting, volume full.');
  p.help('Hold GAS to drive and steer with your left thumb.', 9);
  assert.equal(els['hud-radio'].hidden, true);
  assert.equal(els['hud-vehicle'].hidden, false);
  assert.equal(els['hud-help'].hidden, false);
  const k = hudFor(fakeGame('keyboard'));
  els['hud-vehicle'].box = { top: 249, bottom: 302 };
  k.vehicleName('Nanded Auto', 'रिक्षा · 📻 Radio Godavari 92.7');
  station('Radio Godavari 92.7', 'Radio Godavari 92.7 — chai cutting, volume full.');
  k.update(0.1);
  assert.equal(els['hud-radio'].hidden, false);
  assert.equal(els['hud-vehicle'].hidden, false);
});

test('on a phone a big card goes under the middle column, and further down when the column grows under it', () => {
  const g = fakeGame('touch'), hud = hudFor(g), big = els['hud-big'];
  // 568 x 320: the card's place is 46% down (147 px), and a WANTED card is 101 px tall.
  big.offsetTop = 147; big.offsetHeight = 101;
  column.bottom = () => 186; // a 3-line objective and a 3-line subtitle
  hud.big('WANTED', 'A student saw you take it', 'wanted', 2.5);
  assert.equal(big.style.top, '192px');
  // The next line of dialogue is longer: the card moves down, no further than keeps it on the screen.
  big.offsetTop = 192; column.bottom = () => 228;
  hud.subtitle('BUNTY', 'Their fathers will buy new ones. Yours can\'t buy back his land. Ride, before the watchman wakes up.', 5);
  assert.equal(big.style.top, '211px');
  // A short column leaves it in its place; so does a keyboard (no middle column).
  big.offsetTop = 166; column.bottom = () => 145;
  hud.big('MISSION PASSED', '₹500', 'passed', 4.5);
  assert.equal(big.style.top, '');
  const k = hudFor(fakeGame('keyboard'));
  els['hud-big'].offsetTop = 147; column.bottom = () => 186;
  k.big('WANTED', '', 'wanted', 2.5);
  assert.equal(els['hud-big'].style.top, '');
});

test('on a phone the area and vehicle names keep the newer where they meet; a big card and the middle column beat both', () => {
  const g = fakeGame('touch'), hud = hudFor(g), area = els['hud-area'], vehicle = els['hud-vehicle'], big = els['hud-big'];
  // 568 x 320: both names at the bottom of the screen.
  area.box = { top: 284, bottom: 308 }; vehicle.box = { top: 270, bottom: 310 };
  hud.vehicleName('Nanded Auto', 'रिक्षा');
  hud.area('Shivaji Nagar');
  assert.equal(vehicle.hidden, true);
  assert.equal(area.hidden, false);
  hud.vehicleName('Bike', 'बाईक');
  assert.equal(area.hidden, true);
  assert.equal(hud.timers.area, 0);
  assert.equal(vehicle.hidden, false);
  // A big card reaching down there: the name under it goes, and one that comes while the card is up doesn't show.
  big.box = { top: 192, bottom: 293 }; big.offsetTop = 192;
  hud.big('WANTED', '', 'wanted', 2.5);
  assert.equal(vehicle.hidden, true);
  hud.area('Vazirabad');
  assert.equal(area.hidden, true);
  // Bigger phones: the names are apart, and both stay.
  hud.update(3);
  vehicle.box = { top: 249, bottom: 302 }; area.box = { top: 324, bottom: 348 };
  hud.vehicleName('Bike', 'बाईक'); hud.area('Taroda Khurd');
  assert.equal(vehicle.hidden, false);
  assert.equal(area.hidden, false);
  // The middle column reaching down to a name (a new district's toast under the first drive's help, at
  // 568 x 320): the name goes, the column stays whole.
  hud.update(5);
  area.box = { top: 284, bottom: 308 };
  hud.area('Doctor Lane');
  column.bottom = () => 311;
  hud.toast('New neighbourhood: Doctor Lane · 1/53 · +₹50');
  assert.equal(area.hidden, true);
  assert.equal(els['hud-toast'].hidden, false);
  // A name that comes while the column is that long doesn't show.
  hud.vehicleName('Bike', 'बाईक');
  assert.equal(vehicle.hidden, true);
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
