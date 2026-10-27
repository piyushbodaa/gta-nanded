import { test } from 'node:test';
import assert from 'node:assert/strict';

globalThis.addEventListener ??= () => {};
const { tapButtons } = await import('../src/ui/menus.js');

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

test('a second-finger tap lets go of the search box, so the phone keyboard closes', () => {
  let blurred = 0;
  globalThis.document = { activeElement: { matches: sel => sel.includes('input'), blur: () => blurred++ } };
  const m = fakeMenu();
  m.tap();
  assert.equal(m.button.clicks, 1);
  assert.equal(blurred, 1);
});
