import { test } from 'node:test';
import assert from 'node:assert/strict';

// Just enough Web Audio to run the game's sound: nodes remember what they connect to and their
// parameters their latest value, and the context keeps a clock the tests move by hand.
const param = value => ({ value, setValueAtTime(v) { this.value = v; }, setTargetAtTime(v) { this.value = v; }, linearRampToValueAtTime(v) { this.value = v; }, exponentialRampToValueAtTime(v) { this.value = v; }, cancelScheduledValues() {} });
class Node { constructor() { this.to = []; } connect(n) { this.to.push(n); return n; } start() {} stop() {} }
class Ctx {
  constructor() { this.currentTime = 0; this.sampleRate = 4000; this.state = 'running'; this.destination = new Node(); }
  createGain() { return Object.assign(new Node(), { gain: param(1) }); }
  createOscillator() { return Object.assign(new Node(), { frequency: param(440) }); }
  createBufferSource() { return new Node(); }
  createBiquadFilter() { return Object.assign(new Node(), { frequency: param(350), Q: param(1) }); }
  createDynamicsCompressor() { return Object.assign(new Node(), { threshold: param(0), ratio: param(1) }); }
  createStereoPanner() { return Object.assign(new Node(), { pan: param(0) }); }
  createBuffer(channels, length) { const d = new Float32Array(length); return { getChannelData: () => d }; }
  resume() { this.state = 'running'; return Promise.resolve(); }
  suspend() { this.state = 'suspended'; return Promise.resolve(); }
}
const listeners = [];
globalThis.window = { AudioContext: Ctx };
globalThis.addEventListener = () => {};
globalThis.document = { hidden: false, addEventListener: (type, f) => listeners.push([type, f]) };
const setHidden = hidden => { document.hidden = hidden; for (const [type, f] of listeners) if (type === 'visibilitychange') f(); };

const { GameAudio } = await import('../src/audio/audio.js');
const { Radio, STATIONS } = await import('../src/audio/radio.js');

/** A street, a player and a save: what GameAudio.update reads from the game each frame. */
function fakeGame(settings = {}) {
  const saved = { dirty: 0 };
  return {
    saved, paused: false, cutscene: false,
    player: { vehicle: null, pos: { x: 0, z: 0 } },
    camera3: { position: { x: 0, y: 2, z: 0 } }, camera: { facing: 0 },
    vehicles: { list: [] }, city: { densityAt: () => 0.5 }, sky: { night: 0, hours: 12, w: { grey: 0 } },
    save: { data: { settings: { radio: 0, ...settings } }, dirty() { saved.dirty++; } },
  };
}
const car = { type: 'auto', rpm: 0.4, throttle: 1, vx: 8, vz: 0, slip: 0, spec: {}, wrecked: false };

test('switching the radio station while music plays carries on with the new station', () => {
  const ctx = new Ctx(), radio = new Radio(ctx, ctx.destination, ctx.createBuffer(1, 8));
  const frames = n => { for (let i = 0; i < n; i++) { ctx.currentTime += 1 / 60; radio.update(1 / 60, true, null); } };
  frames(60);
  assert.equal(radio.playing, true);
  for (const id of ['lavani', 'katta']) {
    radio.cycle();
    frames(60); // threw on the first of these frames: the old song was dropped but still scheduled
    assert.equal(radio.station.id, id);
    assert.ok(radio.song, 'the new station plays a song of its own');
  }
  assert.equal(radio.cycle().name, 'Radio off');
  frames(10);
  radio.cycle();
  frames(10);
  assert.equal(radio.station.id, STATIONS[0].id);
});

test('the radio station is remembered, Radio off included', async () => {
  const audio = new GameAudio();
  await audio.init();
  const g = fakeGame({ radio: -1 });
  g.player.vehicle = car;
  audio.update(1 / 60, g);
  assert.equal(audio.radio.station, null, 'off, as the player left it');
  audio.radio.cycle();
  audio.update(1 / 60, g);
  assert.equal(g.save.data.settings.radio, 0);
  assert.ok(g.saved.dirty > 0, 'and saved');
});

test('the street ambience follows the Effects volume', async () => {
  const audio = new GameAudio();
  await audio.init();
  assert.ok(audio.ambBus.to.includes(audio.sfxBus));
  assert.ok(!audio.ambBus.to.includes(audio.master));
});

test('a hidden page goes quiet at once, and Sound off stops the audio altogether', async () => {
  const audio = new GameAudio();
  await audio.init();
  const g = fakeGame();
  g.player.vehicle = car;
  audio.update(1 / 60, g);
  assert.ok(audio.eng.gain.gain.value > 0, 'the engine runs while driving');
  // No frames run on a hidden page, so nothing would fade the engine or the street out.
  setHidden(true);
  assert.equal(audio.ctx.state, 'suspended');
  for (const p of [audio.eng.gain.gain, audio.eng.wind.gain, audio.amb.bed.gain, audio.sir.g.gain, audio.radio.out.gain]) assert.equal(p.value, 0);
  setHidden(false);
  assert.equal(audio.ctx.state, 'running');
  audio.setEnabled(false);
  await new Promise(r => setTimeout(r, 350));
  assert.equal(audio.ctx.state, 'suspended', 'nothing left rendering silence');
  setHidden(true); setHidden(false);
  assert.equal(audio.ctx.state, 'suspended', 'coming back to the page keeps it off');
  audio.setEnabled(true);
  assert.equal(audio.ctx.state, 'running');
});

test('horn cooldowns are forgotten once over', async () => {
  const audio = new GameAudio();
  await audio.init();
  audio.listener = { x: 0, z: 0 };
  for (let id = 0; id < 500; id++) { audio.ctx.currentTime += 0.5; audio.horn({ id, type: 'auto', x: 5, z: 0 }); }
  assert.ok(audio.hornCool.size <= 65, `${audio.hornCool.size} entries`);
});
