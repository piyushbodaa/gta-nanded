import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// Just enough of a browser for the quality settings: a phone or a desktop, and storage.
const store = new Map();
globalThis.localStorage = { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) };
globalThis.document = { hidden: false };
let coarse = true;
globalThis.matchMedia = () => ({ matches: coarse });
Object.assign(globalThis, { innerWidth: 915, innerHeight: 412, devicePixelRatio: 2.625 });
const { Quality, gpuLabel, guessTier, MIN_SCALE, MIN_CROWD } = await import('../src/core/quality.js');

const phone = gpu => { coarse = true; globalThis.innerWidth = 915; globalThis.innerHeight = 412; globalThis.devicePixelRatio = 2.625; const q = new Quality(); q.setGpu(gpu); return q; };
const game = () => ({ started: true, paused: false, time: 100, resizes: 0, tiers: 0, resize() { this.resizes++; }, applyQuality() { this.tiers++; } });
/** Feed `seconds` of frames, each `ms` long. */
const run = (q, g, seconds, ms) => { for (let t = 0; t < seconds; t += ms / 1000) q.sample(ms / 1000, g); };

beforeEach(() => store.clear());

test('GPU names come out short and readable', () => {
  assert.equal(gpuLabel('ANGLE (Qualcomm, Adreno (TM) 710, OpenGL ES 3.2)'), 'Adreno 710');
  assert.equal(gpuLabel('ANGLE (Qualcomm, Vulkan 1.3.128 (Adreno (TM) 740 (0x43050a01)), Qualcomm Technologies Inc. Adreno Vulkan Driver)'), 'Adreno 740');
  assert.equal(gpuLabel('ANGLE (ARM, Mali-G68 MC4, OpenGL ES 3.2)'), 'Mali-G68 MC4');
  assert.equal(gpuLabel('Apple GPU'), 'Apple GPU');
  assert.equal(gpuLabel('ANGLE (Apple, ANGLE Metal Renderer: Apple M1 Pro, Unspecified Version)'), 'Apple M1 Pro');
  assert.equal(gpuLabel('ANGLE (Intel, Vulkan 1.3.255 (Intel(R) Iris(R) Xe Graphics (TGL GT2) (0x00009A49)), Intel open-source Mesa driver)'), 'Iris Xe');
  assert.equal(gpuLabel('ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)'), 'GeForce RTX 3060');
});

test('a phone starts at a tier that fits its GPU', () => {
  assert.equal(guessTier('Adreno 740', true), 'high');
  assert.equal(guessTier('Adreno 710', true), 'medium');
  assert.equal(guessTier('Adreno 619', true), 'low');
  assert.equal(guessTier('Mali-G57 MC2', true), 'low');
  assert.equal(guessTier('Mali-G715 MC7', true), 'medium');
  assert.equal(guessTier('Apple GPU', true), 'medium');
  assert.equal(guessTier('Iris Xe', false, 8), 'high');
});

test('phones draw more pixels than before, smooth edges in the final pass, and cap at 60 fps', () => {
  const q = phone('Adreno 710');
  assert.equal(q.tier, 'medium');
  assert.equal(q.pixelRatio(), 1.75, 'Balanced draws 1.75 pixels per CSS pixel on a phone (was 1)');
  assert.equal(q.settings.msaa, false, 'FXAA instead of MSAA on a phone');
  assert.equal(q.fpsCap, 60, 'auto starts at 60');
  assert.deepEqual([q.cycleFps(), q.cycleFps(), q.cycleFps()], ['60 fps · smooth', '30 fps · battery saver', 'Auto (60 fps)']);
  store.clear();
  coarse = false; globalThis.innerWidth = 1600; globalThis.innerHeight = 900; globalThis.devicePixelRatio = 1;
  const d = new Quality(); d.setGpu('ANGLE (Intel, Iris(R) Xe Graphics)');
  assert.equal(d.fpsCap, 0, 'desktops follow the display');
  assert.equal(d.settings.msaa, true);
  assert.deepEqual([d.cycleFps(), d.cycleFps(), d.cycleFps()], ['60 fps · smooth', '30 fps · battery saver', 'Unlimited']);
});

test('missed frames lower the resolution, then the tier, and the tier is remembered as too heavy', () => {
  const q = phone('Adreno 710'), g = game();
  run(q, g, 2.1, 33.4);
  assert.equal(q.scale, 0.9);
  run(q, g, 20, 33.4);
  assert.equal(q.scale, MIN_SCALE, 'resolution bottoms out first');
  assert.equal(q.tier, 'low', 'then the tier steps down');
  assert.ok(q.tooHeavy.includes('medium'));
  const next = phone('Adreno 710');
  assert.equal(next.tier, 'low', 'the next launch starts where this one settled');
  assert.ok(next.learned.tooHeavy.includes('medium'));
});

test('frames that keep up raise the resolution again, but not straight back to one that failed', () => {
  const q = phone('Adreno 710'), g = game();
  run(q, g, 6.1, 33.4); // 1.0 -> 0.9 -> 0.8 -> 0.7
  assert.equal(q.scale, 0.7);
  run(q, g, 40, 16.7);
  assert.ok(q.scale > 0.7 && q.scale <= 0.75 + 1e-9, `held below the resolution that just failed (${q.scale})`);
  run(q, g, 70, 16.7); // the failure is a minute old
  assert.equal(q.scale, 1);
});

test('a minute and a half at full resolution marks the GPU for a tier up at the next launch', () => {
  const q = phone('Adreno 710'), g = game();
  run(q, g, 95, 16.7);
  assert.equal(q.learned?.promote, true);
  assert.equal(g.tiers, 0, 'no tier change mid-game: that would recompile shaders');
});

test('throttled windows, pauses and manual settings leave the resolution alone', () => {
  const q = phone('Adreno 710'), g = game();
  run(q, g, 10, 250); // a backgrounded tab
  g.paused = true; run(q, g, 10, 40); g.paused = false;
  assert.equal(q.scale, 1);
  q.mode = 'high';
  run(q, g, 10, 40);
  assert.equal(q.scale, 1);
  assert.equal(g.resizes, 0);
});

test('what was learned belongs to one GPU', () => {
  const q = phone('Adreno 710'), g = game();
  run(q, g, 4.1, 33.4);
  assert.equal(phone('Adreno 710').scale, q.scale);
  const other = phone('Mali-G57 MC2');
  assert.equal(other.scale, 1);
  assert.equal(other.tier, 'low');
});

test('a phone whose processor cannot keep up thins the crowds, then settles at 30 fps, and keeps its sharpness', () => {
  // A budget phone on Test Lab: 9-14 ms of the game's own work in a 16.7 ms frame.
  const q = phone('Mali-G57 MC2'), g = { ...game(), cpuMs: 12 };
  run(q, g, 2.1, 30);
  assert.equal(q.crowd, 1, 'one slow window is not a sustained load');
  run(q, g, 2.1, 30);
  assert.equal(q.crowd, 0.8, 'fewer cars and people first');
  run(q, g, 20, 30);
  assert.equal(q.crowd, MIN_CROWD);
  assert.equal(q.fpsCap, 30, 'then, still under 40 fps, a steady 30 instead of a ragged 30-40');
  assert.equal(q.scale, 1, 'the picture stays as sharp as it was');
  assert.equal(g.resizes, 0);
  const next = phone('Mali-G57 MC2');
  assert.equal(next.fpsCap, 30, 'the next launch starts there');
  assert.equal(next.crowd, MIN_CROWD);
  // A phone whose graphics chip is the limit still trades resolution.
  const gpu = phone('Mali-G68'), gg = { ...game(), cpuMs: 4 };
  run(gpu, gg, 2.1, 25);
  assert.equal(gpu.scale, 0.9);
  assert.equal(gpu.crowd, 1);
});

test('crowds come back once there is room, a step at a time', () => {
  const q = phone('Adreno 619'), g = { ...game(), cpuMs: 12 };
  run(q, g, 4.2, 25);
  assert.equal(q.crowd, 0.8);
  g.cpuMs = 4;
  run(q, g, 30, 16.7);
  assert.equal(q.crowd, 0.8, 'not within a minute of thinning');
  run(q, g, 40, 16.7);
  assert.ok(q.crowd > 0.8, `back up after a minute (${q.crowd})`);
});

test('the first seconds after the start or a teleport are left out', () => {
  const q = phone('Adreno 710'), g = { ...game(), time: 3 };
  run(q, g, 4.2, 40);
  assert.equal(q.scale, 1, 'streets still filling in after the start');
  g.time = 50; g.player = { teleportAt: 48 };
  run(q, g, 4.2, 40);
  assert.equal(q.scale, 1, 'or just after a teleport');
  g.player.teleportAt = 40;
  run(q, g, 2.1, 40);
  assert.equal(q.scale, 0.9);
});
