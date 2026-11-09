import { test } from 'node:test';
import assert from 'node:assert/strict';

globalThis.addEventListener ??= () => {};
const { PauseMenu, tabEdges } = await import('../src/ui/menus.js');
const { Hud } = await import('../src/ui/hud.js');
const { tapButtons } = await import('../src/ui/tap.js');

test('the pause map draws each mission and static blip once, including distant and boundary blips', () => {
  let missionReads = 0, drawn, route;
  const mission = { x: 20, z: 30, label: 'mission' };
  const dynamic = { x: 40, z: 50, label: 'target' };
  const staticBlips = [
    { x: 100, z: 0, label: 'near race' },
    { x: 260, z: 0, label: 'boundary landmark' },
    { x: 500, z: 0, label: 'far garage' },
    { x: 600, z: 0, label: 'far pump' },
  ];
  const g = {
    player: { pos: { x: 0, z: 0 } },
    missions: { blips() { missionReads++; return [mission]; } },
    staticBlips,
    jobs: { staticBlips: () => staticBlips.slice(0, 3) },
  };
  g.hud = Object.assign(Object.create(Hud.prototype), { game: g, blipList: [dynamic], route: { points: [0, 0, 100, 0] } });
  PauseMenu.prototype._drawMap.call({ game: g, map: { draw(blips, gps) { drawn = blips; route = gps; } } });
  assert.deepEqual(drawn.map(b => b.label).sort(), [dynamic, mission, ...staticBlips].map(b => b.label).sort());
  assert.equal(missionReads, 1, 'mission availability is evaluated only once per redraw');
  assert.equal(route, g.hud.route, 'the map keeps its GPS route');
});

// A pause-menu root that records its listeners, and a button that counts its clicks.
function fakeMenu() {
  const on = {};
  const root = { addEventListener: (type, fn) => (on[type] ??= []).push(fn) };
  const button = { disabled: false, clicks: 0, click() { this.clicks++; } };
  const fire = (type, e) => { const ev = { prevented: false, preventDefault() { this.prevented = true; }, ...e }; for (const fn of on[type] || []) fn(ev); return ev; };
  const target = { closest: () => button };
  /** One finger's tap on the button: down, up (after moving `move` px), then the touchend that follows. */
  const tap = ({ id = 2, primary = false, type = 'touch', move = 0, at = 1000 } = {}) => {
    fire('pointerdown', { pointerId: id, pointerType: type, isPrimary: primary, clientX: 50, clientY: 20, target, timeStamp: at });
    fire('pointerup', { pointerId: id, pointerType: type, isPrimary: primary, clientX: 50 + move, clientY: 20, target, timeStamp: at + 80 });
    return fire('touchend', { timeStamp: at + 81, cancelable: true });
  };
  tapButtons(root);
  return { button, fire, tap };
}

test('a lone finger leaves the tap to the browser; a second finger taps on pointerup, once', () => {
  globalThis.document = { activeElement: null };
  const m = fakeMenu();
  // One finger: the browser's own click acts (it ignores a tap that stops a gliding list, and moves focus).
  const lone = m.tap({ primary: true });
  assert.equal(m.button.clicks, 0);
  assert.equal(lone.prevented, false, 'the browser still makes its click');
  // A thumb rests on the stick: the browser makes no click, so the menu presses the button itself
  // and cancels the touchend so a click can never follow.
  const second = m.tap({ primary: false });
  assert.equal(m.button.clicks, 1);
  assert.equal(second.prevented, true);
  // Mouse and pen keep the plain click.
  m.tap({ type: 'mouse', primary: false });
  assert.equal(m.button.clicks, 1);
});

test('a second finger that moved, or that stops a gliding list, does not press', () => {
  globalThis.document = { activeElement: null };
  const m = fakeMenu();
  assert.equal(m.tap({ move: 30 }).prevented, false);
  assert.equal(m.button.clicks, 0);
  m.fire('scroll', { timeStamp: 1000 });
  m.tap({ at: 1040 });
  assert.equal(m.button.clicks, 0, 'a finger landing 40 ms after a scroll is stopping it');
  m.tap({ at: 1400 });
  assert.equal(m.button.clicks, 1, 'once the list has settled, taps press again');
});

test('a second finger on a greyed-out button, or off any button, presses nothing', () => {
  globalThis.document = { activeElement: null };
  const m = fakeMenu();
  m.button.disabled = true;
  assert.equal(m.tap().prevented, false);
  assert.equal(m.button.clicks, 0);
  // Off any button (the map, a card's text): nothing is pressed, and the touch goes on as usual.
  const off = { closest: () => null };
  m.fire('pointerdown', { pointerId: 4, pointerType: 'touch', isPrimary: false, clientX: 10, clientY: 10, target: off, timeStamp: 2000 });
  m.fire('pointerup', { pointerId: 4, pointerType: 'touch', isPrimary: false, clientX: 10, clientY: 10, target: off, timeStamp: 2080 });
  assert.equal(m.fire('touchend', { cancelable: true }).prevented, false);
});

test('the tab row fades only at the ends that have tabs past them', () => {
  const nav = (scrollLeft, clientWidth, scrollWidth) => {
    const on = new Set();
    return { scrollLeft, clientWidth, scrollWidth, on, classList: { toggle: (c, f) => (f ? on.add(c) : on.delete(c)) } };
  };
  const all = nav(0, 600, 600); tabEdges(all);
  assert.deepEqual([...all.on], [], 'every tab fits: no fade');
  const start = nav(0, 400, 600); tabEdges(start);
  assert.deepEqual([...start.on], ['more-r'], 'scrolled to the start: Settings and Controls wait on the right');
  const middle = nav(100, 400, 600); tabEdges(middle);
  assert.deepEqual([...middle.on].sort(), ['more-l', 'more-r']);
  const end = nav(200, 400, 600); tabEdges(end);
  assert.deepEqual([...end.on], ['more-l'], 'scrolled to the end: only the left fades');
  const hidden = nav(0, 0, 0); tabEdges(hidden);
  assert.deepEqual([...hidden.on], [], 'a closed menu measures nothing and fades nothing');
});

test('a second-finger tap lets go of the search box, so the phone keyboard closes', () => {
  let blurred = 0;
  globalThis.document = { activeElement: { matches: sel => sel.includes('input'), blur: () => blurred++ } };
  const m = fakeMenu();
  m.tap();
  assert.equal(m.button.clicks, 1);
  assert.equal(blurred, 1);
});

test('the photo card closes on a second-finger tap of its ✕, with the other thumb on the stick', async () => {
  // A stand-in page: the card records its listeners, and its buttons run their click listeners when clicked.
  const on = {};
  const photo = { hidden: false, addEventListener: (type, fn) => (on[type] ??= []).push(fn) };
  const button = () => ({ disabled: false, fns: [], addEventListener(type, fn) { if (type === 'click') this.fns.push(fn); }, click() { for (const fn of this.fns) fn(); } });
  const els = { photo, 'photo-close': button(), 'photo-save': button(), 'photo-share': button() };
  globalThis.document = { activeElement: null, getElementById: id => els[id] ?? { addEventListener() {} } };
  const { installRules } = await import('../src/game/rules.js');
  const g = { city: { places: [] }, vehicles: {} };
  installRules(g);
  const fire = (type, e) => { const ev = { prevented: false, preventDefault() { this.prevented = true; }, ...e }; for (const fn of on[type] || []) fn(ev); return ev; };
  const close = els['photo-close'];
  const target = { closest: () => close };
  fire('pointerdown', { pointerId: 3, pointerType: 'touch', isPrimary: false, clientX: 200, clientY: 30, target, timeStamp: 500 });
  fire('pointerup', { pointerId: 3, pointerType: 'touch', isPrimary: false, clientX: 201, clientY: 30, target, timeStamp: 580 });
  const end = fire('touchend', { cancelable: true, timeStamp: 581 });
  assert.equal(photo.hidden, true, 'the card goes away');
  assert.equal(end.prevented, true, 'and the browser makes no second click');
  clearTimeout(g._photoT);
});
