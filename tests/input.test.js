import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

// Just enough of a browser for Input: window and element listeners, a clock, a gamepad, a phone screen.
class El {
  constructor() { this.on = {}; }
  addEventListener(type, f) { (this.on[type] ||= []).push(f); }
}
for (const name of ['HTMLInputElement', 'HTMLTextAreaElement', 'HTMLSelectElement', 'HTMLButtonElement']) globalThis[name] = class extends El {};
const win = new El();
globalThis.addEventListener = (type, f) => win.addEventListener(type, f);
globalThis.document = Object.assign(new El(), { body: new El(), hidden: false, pointerLockElement: null });
globalThis.matchMedia = () => ({ matches: false }); // a phone: no fine pointer
let now = 1000;
globalThis.performance = { now: () => now };
let pads = [];
navigator.getGamepads = () => pads;

const { Input } = await import('../src/core/input.js');
const { GameCamera } = await import('../src/game/camera.js');

/** Dispatch an event at `target`; window listeners see it too, as it bubbles. */
function fire(target, type, props = {}) {
  const e = { type, target, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, ...props };
  for (const f of target.on[type] || []) f(e);
  if (target !== win) for (const f of win.on[type] || []) f(e);
  return e;
}
const key = (type, code, target = document.body) => fire(target, type, { code });
const pad = pressed => ({ connected: true, axes: [0, 0, 0, 0], buttons: Array.from({ length: 16 }, (_, i) => ({ pressed: pressed.includes(i), value: pressed.includes(i) ? 1 : 0 })) });

function fresh() {
  win.on = {}; document.on = {}; // only this test's Input is listening
  const canvas = new El();
  const input = new Input(canvas);
  return { input, canvas };
}

test('a tap on the view looks around but never throws a punch; a mouse click does', () => {
  const { input, canvas } = fresh();
  input.live = true;
  // A tap: the finger goes down and up, then the browser sends the mouse events of a click.
  fire(canvas, 'pointerdown', { pointerType: 'touch', pointerId: 1, clientX: 500, clientY: 200 });
  now += 120;
  fire(win, 'pointerup', { pointerType: 'touch', pointerId: 1 });
  fire(canvas, 'mousedown', { button: 0 });
  assert.equal(input.pressed('attack'), false, 'the tap is not a punch');
  // Chrome marks them however late they come.
  now += 5000;
  fire(canvas, 'mousedown', { button: 0, sourceCapabilities: { firesTouchEvents: true } });
  assert.equal(input.pressed('attack'), false);
  // A real mouse click, well after any touch.
  fire(canvas, 'mousedown', { button: 0, sourceCapabilities: { firesTouchEvents: false } });
  assert.equal(input.pressed('attack'), true);
});

test('keys pressed on the cover or in the intro wait for play, and Tab moves focus there', () => {
  const { input, canvas } = fresh();
  for (const code of ['Tab', 'KeyM', 'Escape', 'Space']) {
    const e = key('keydown', code);
    assert.equal(e.defaultPrevented, false, `${code} does what the page does with it`);
  }
  assert.equal(input.events.size, 0, 'nothing queued for the first frame of play');
  input.live = true;
  const tab = key('keydown', 'Tab', canvas);
  assert.ok(tab.defaultPrevented && input.pressed('map'), 'in play, Tab on the street opens the map');
  const onButton = key('keydown', 'Tab', new HTMLButtonElement());
  assert.ok(!onButton.defaultPrevented && !input.pressed('map'), 'Tab on a menu button moves focus');
});

test('Space and Enter on a focused button click it instead of jumping', () => {
  const { input } = fresh();
  input.live = true;
  const button = new HTMLButtonElement();
  for (const code of ['Space', 'Enter']) {
    const e = key('keydown', code, button);
    assert.equal(e.defaultPrevented, false, code);
  }
  assert.equal(input.events.size, 0);
  assert.ok(key('keydown', 'Space').defaultPrevented, 'Space on the street is still the jump');
  assert.ok(input.pressed('jump'));
});

test('two keys for one action: letting go of one keeps the other held', () => {
  const { input } = fresh();
  input.live = true;
  key('keydown', 'KeyW');
  key('keydown', 'ArrowUp');
  key('keyup', 'ArrowUp');
  input.update();
  assert.equal(input.state.throttle, 1, 'W is still down');
  key('keyup', 'KeyW');
  input.update();
  assert.equal(input.state.throttle, 0);
});

test('Ctrl is not a punch key (Ctrl+W would close the tab)', () => {
  const { input } = fresh();
  input.live = true;
  key('keydown', 'ControlLeft');
  assert.equal(input.pressed('attack'), false);
  key('keydown', 'KeyJ');
  assert.equal(input.pressed('attack'), true);
});

test('a gamepad button held while the pause menu opens is one press, not two', () => {
  const { input } = fresh();
  pads = [pad([9])];
  input.update();
  assert.equal(input.pressed('pause'), true);
  input.clear(); // the pause menu opens
  input.update();
  assert.equal(input.pressed('pause'), false, 'still the same press');
  pads = [pad([])];
  input.update();
  pads = [pad([9])];
  input.update();
  assert.equal(input.pressed('pause'), true, 'pressed again');
  pads = [];
});

test('gamepad X is the action and L3 the sprint, so running past a stall buys nothing', () => {
  const { input } = fresh();
  pads = [pad([2])];
  input.update();
  assert.equal(input.state.sprint, false);
  assert.equal(input.pressed('action'), true);
  pads = [pad([10])];
  input.update();
  assert.equal(input.state.sprint, true);
  assert.equal(input.pressed('action'), false);
  pads = [];
});

test('the wheel zooms over the street only, a notch at a time', () => {
  const { input, canvas } = fresh();
  fire(new El(), 'wheel', { deltaY: 100, deltaMode: 0 }); // the pause menu's city map
  assert.ok(!input.zoom);
  fire(canvas, 'wheel', { deltaY: 100, deltaMode: 0 });
  assert.equal(input.zoom, 1);
  fire(canvas, 'wheel', { deltaY: -4, deltaMode: 0 }); // a trackpad's small step
  assert.ok(Math.abs(input.zoom - 0.96) < 1e-9);
  fire(canvas, 'wheel', { deltaY: 900, deltaMode: 0 });
  assert.ok(Math.abs(input.zoom - 1.96) < 1e-9, 'one event is never more than a notch');
});

test('drags during a scripted shot are dropped, so the camera settles behind the player after it', () => {
  const cam = new GameCamera(new THREE.PerspectiveCamera(62, 2, 0.3, 900), { raycast: () => 1 });
  const input = { look: { x: 0, y: 0 }, zoom: 0, state: {}, pointerLocked: false };
  const subject = { human: { x: 0, y: 0, z: 0 }, speed: 0, heading: 0, groundY: 0 };
  cam.playShot({ from: new THREE.Vector3(0, 20, 20), to: new THREE.Vector3(0, 10, 10), look: new THREE.Vector3(), duration: 3 });
  for (let i = 0; i < 30; i++) { input.look.x += 0.2; input.look.y -= 0.05; input.zoom += 1; cam.update(1 / 30, input, subject); }
  cam.endShot(0.5);
  cam.update(1 / 30, input, subject);
  assert.ok(Math.abs(cam.facing - 0.5) < 1e-6, `facing ${cam.facing}`);
  assert.equal(cam.pitch, 0.22);
  assert.equal(cam.zoom, 1);
});
