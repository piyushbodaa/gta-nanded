import assert from 'node:assert/strict';
import test from 'node:test';
import { createCameraControls, movementForCamera } from '../src/camera-controls.js';

// Event and capture fixtures exercise gesture ownership/lifecycle. Real browser
// rendering and simultaneous physical touchscreen contacts still need UI checks.
class Target {
  listeners = new Map();
  addEventListener(type, callback) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(callback);
  }
  removeEventListener(type, callback) { this.listeners.get(type)?.delete(callback); }
  emit(type, options = {}) {
    const event = { type, pointerId: 1, pointerType: 'touch', clientX: 200, clientY: 200,
      preventDefault() { this.defaultPrevented = true; }, ...options };
    for (const callback of this.listeners.get(type) || []) callback(event);
    return event;
  }
}
function fixture() {
  const windowTarget = new Target(), documentTarget = new Target(), canvas = new Target();
  canvas.captured = new Set();
  canvas.setPointerCapture = id => canvas.captured.add(id);
  canvas.releasePointerCapture = id => { canvas.captured.delete(id); canvas.emit('lostpointercapture', { pointerId: id }); };
  canvas.getBoundingClientRect = () => ({ width: 400, height: 800 });
  canvas.focusCalls = [];
  canvas.focus = options => canvas.focusCalls.push(options);
  let enabled = true;
  const camera = createCameraControls(canvas, { windowTarget, documentTarget, canInteract: () => enabled });
  camera.reset(0);
  return { camera, canvas, windowTarget, documentTarget, disable: () => { enabled = false; }, enable: () => { enabled = true; } };
}
function look(f, { x = 300, y = 100, id = 1 } = {}) {
  f.canvas.emit('pointerdown', { pointerId: id });
  f.canvas.emit('pointermove', { pointerId: id, clientX: x, clientY: y });
  f.canvas.emit('pointerup', { pointerId: id });
}
function close(actual, expected, epsilon = 1e-9) { assert.ok(Math.abs(actual - expected) < epsilon, `${actual} != ${expected}`); }

test('touch drags orbit horizontally, tilt vertically, and clamp away from inverted views', () => {
  const f = fixture();
  f.canvas.emit('pointerdown');
  assert.equal(f.camera.dragging, true);
  assert.equal(f.canvas.captured.has(1), true);
  const move = f.canvas.emit('pointermove', { clientX: 300, clientY: 100 });
  close(f.camera.heading, -Math.PI * 0.375);
  close(f.camera.pitch, 0.44 + Math.PI * 0.09375);
  assert.equal(move.defaultPrevented, true);
  f.canvas.emit('pointermove', { clientX: 300, clientY: -10000 });
  close(f.camera.pitch, 1.1);
  f.canvas.emit('pointermove', { clientX: 300, clientY: 10000 });
  close(f.camera.pitch, 0.14);
  f.canvas.emit('pointerup');
  assert.equal(f.camera.dragging, false);
  assert.equal(f.canvas.captured.size, 0);
  f.camera.destroy();
});

test('a non-primary look finger works beside driving controls and other fingers cannot steal it', () => {
  const f = fixture();
  f.canvas.emit('pointerdown', { pointerId: 8, isPrimary: false });
  f.canvas.emit('pointerdown', { pointerId: 9 });
  f.canvas.emit('pointermove', { pointerId: 9, clientX: 390 });
  close(f.camera.heading, 0);
  f.windowTarget.emit('pointerup', { pointerId: 2 }); // Accelerator pointer release.
  assert.equal(f.camera.dragging, true);
  f.canvas.emit('pointermove', { pointerId: 8, clientX: 300 });
  assert.notEqual(f.camera.heading, 0);
  f.canvas.emit('pointerup', { pointerId: 8 });
  assert.equal(f.camera.dragging, false);
  f.camera.destroy();
});

test('only an accepted camera gesture moves keyboard focus away from HUD buttons', () => {
  const f = fixture();
  f.disable();
  f.canvas.emit('pointerdown');
  assert.deepEqual(f.canvas.focusCalls, []);
  f.enable();
  f.canvas.emit('pointerdown', { pointerType: 'mouse', button: 2 });
  assert.deepEqual(f.canvas.focusCalls, []);
  f.canvas.emit('pointerdown', { pointerId: 8, isPrimary: false });
  assert.deepEqual(f.canvas.focusCalls, [{ preventScroll: true }]);
  f.canvas.emit('pointerdown', { pointerId: 9 });
  assert.equal(f.canvas.focusCalls.length, 1);
  f.canvas.emit('pointerup', { pointerId: 8 });
  f.canvas.emit('pointerdown', { pointerType: 'mouse', button: 0 });
  assert.deepEqual(f.canvas.focusCalls, [{ preventScroll: true }, { preventScroll: true }]);
  f.camera.destroy();
});

test('disabled menus reject input and interrupt a gesture already in progress', () => {
  const f = fixture();
  f.disable();
  const down = f.canvas.emit('pointerdown');
  assert.equal(f.camera.dragging, false);
  assert.equal(down.defaultPrevented, undefined);
  f.enable();
  f.canvas.emit('pointerdown');
  f.disable();
  f.canvas.emit('pointermove', { clientX: 350 });
  assert.equal(f.camera.dragging, false);
  close(f.camera.heading, 0);
  f.enable();
  f.canvas.emit('pointerdown');
  f.disable();
  f.camera.update(0.016, { heading: 0 });
  assert.equal(f.camera.dragging, false);
  f.camera.destroy();
});

test('all release paths clear capture without resetting the inspected angle', () => {
  for (const [target, type] of [['canvas', 'pointercancel'], ['canvas', 'lostpointercapture'], ['windowTarget', 'pointerup'], ['windowTarget', 'blur'], ['documentTarget', 'visibilitychange']]) {
    const f = fixture();
    f.canvas.emit('pointerdown');
    f.canvas.emit('pointermove', { clientX: 300 });
    const heading = f.camera.heading;
    if (type === 'visibilitychange') f.documentTarget.hidden = true;
    f[target].emit(type);
    assert.equal(f.camera.dragging, false, type);
    assert.equal(f.canvas.captured.size, 0, type);
    close(f.camera.heading, heading);
    f.camera.destroy();
  }
});

test('only a held left mouse button rotates the camera, and window release survives capture failure', () => {
  const f = fixture();
  f.canvas.emit('pointerdown', { pointerType: 'mouse', button: 2 });
  assert.equal(f.camera.dragging, false);
  f.canvas.setPointerCapture = () => { throw new Error('Capture unavailable'); };
  f.canvas.emit('pointerdown', { pointerType: 'mouse', button: 0 });
  f.canvas.emit('pointermove', { pointerType: 'mouse', buttons: 1, clientX: 300 });
  assert.notEqual(f.camera.heading, 0);
  f.windowTarget.emit('pointerup', { pointerType: 'mouse' });
  assert.equal(f.camera.dragging, false);
  f.canvas.emit('pointerdown', { pointerType: 'mouse', button: 0 });
  f.canvas.emit('pointermove', { pointerType: 'mouse', buttons: 0, clientX: 300 });
  assert.equal(f.camera.dragging, false);
  f.camera.destroy();
});

test('inspection holds while stationary and recenters smoothly only after moving with an idle gesture', () => {
  const f = fixture();
  look(f);
  const inspected = { heading: f.camera.heading, pitch: f.camera.pitch };
  f.camera.update(10, { heading: 0, speed: 0 });
  close(f.camera.heading, inspected.heading);
  close(f.camera.pitch, inspected.pitch);
  look(f, { x: 220, y: 200 });
  const before = f.camera.heading;
  f.camera.update(1.9, { heading: 0, speed: 15 });
  close(f.camera.heading, before);
  f.camera.update(0.2, { heading: 0, speed: 15 });
  assert.ok(Math.abs(f.camera.heading) < Math.abs(before));
  assert.ok(Math.abs(f.camera.heading) > 0.1);
  for (let i = 0; i < 100; i++) f.camera.update(0.1, { heading: 0, speed: -8 });
  close(f.camera.heading, 0);
  close(f.camera.pitch, 0.44);
  f.camera.destroy();
});

test('driving follows turns while foot movement never rotates its own camera', () => {
  const f = fixture();
  f.camera.update(0.016, { heading: 1 });
  close(f.camera.heading, 1);
  look(f, { x: 250, y: 200 });
  const inspected = f.camera.heading;
  f.camera.update(0.016, { heading: 1, onFoot: true });
  close(f.camera.heading, inspected);
  f.camera.update(10, { heading: -2, speed: 10, onFoot: true });
  close(f.camera.heading, inspected);
  f.camera.update(0, { heading: 2, onFoot: false });
  close(f.camera.heading, inspected);
  f.camera.update(0, { heading: 2.2, onFoot: false });
  close(f.camera.heading, inspected + 0.2);
  f.camera.destroy();
});

test('reset restores the chase angle and destroy removes handlers and active capture', () => {
  const f = fixture();
  f.canvas.emit('pointerdown');
  f.canvas.emit('pointermove', { clientX: 300, clientY: 100 });
  f.camera.reset(2.9);
  close(f.camera.heading, 2.9);
  close(f.camera.pitch, 0.44);
  assert.equal(f.camera.dragging, false);
  f.canvas.emit('pointerdown');
  f.camera.destroy();
  assert.equal(f.camera.dragging, false);
  assert.equal(f.canvas.captured.size, 0);
  f.canvas.emit('pointerdown');
  f.canvas.emit('pointermove', { clientX: 350 });
  close(f.camera.heading, 2.9);
  for (const target of [f.canvas, f.windowTarget, f.documentTarget]) {
    assert.equal([...target.listeners.values()].reduce((count, set) => count + set.size, 0), 0);
  }
});

test('camera-relative walking has correct eight directions and equal diagonal speed', () => {
  for (const heading of [0, Math.PI / 2, Math.PI, -Math.PI / 2, 2.9]) {
    const forward = { x: -Math.sin(heading), z: -Math.cos(heading) };
    const right = { x: Math.cos(heading), z: -Math.sin(heading) };
    for (const [x, y] of [[0,1],[1,1],[1,0],[1,-1],[0,-1],[-1,-1],[-1,0],[-1,1]]) {
      const movement = movementForCamera(x, y, heading);
      const length = Math.hypot(x, y);
      close(movement.x, (forward.x * y + right.x * x) / length);
      close(movement.z, (forward.z * y + right.z * x) / length);
      close(Math.hypot(movement.x, movement.z), 1);
    }
  }
  const still = movementForCamera(0, 0, 1.2);
  close(still.x, 0); close(still.z, 0);
  const north = movementForCamera(0, 1, 0); close(north.x, 0); close(north.z, -1);
  const west = movementForCamera(0, 1, Math.PI / 2); close(west.x, -1); close(west.z, 0);
  const screenRight = movementForCamera(1, 0, Math.PI / 2); close(screenRight.x, 0); close(screenRight.z, -1);
});
