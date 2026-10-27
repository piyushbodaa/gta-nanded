import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Police } from '../src/game/police.js';
import { Missions, Steps } from '../src/game/missions.js';
import { STORY, CHARACTERS } from '../src/game/story.js';
import { Save } from '../src/game/save.js';

function fakeGame() {
  const hud = { big() {}, objective() {}, setTimer() {}, subtitle() {}, clearSubtitle() {}, help() {}, route: null };
  return {
    time: 0, hud, controls: new Map(), cutscene: false,
    player: { pos: { x: 0, z: 0 }, x: 0, z: 0, vehicle: null, state: 'foot', speed: 0 },
    vehicles: { list: [] }, peds: { list: [] }, police: { level: 0, setLevel() {}, lock: false },
    save: { done: id => false, complete() {}, flush() {}, data: { stamps: [] } }, addCash() {},
    camera: { cinematic: null, playShot() {}, endShot() {} }, effects: { markers: { set() {} } },
    net: { route: () => null }, onWantedChange() {},
  };
}

test('crimes seen by the police raise the wanted level', () => {
  const g = fakeGame();
  const p = new Police(g);
  p.report('carjack', 0, 0, { cop: true });
  assert.equal(p.level, 1);
  p.report('hitCop', 0, 0, { cop: true });
  assert.equal(p.level, 3);
  p.clear();
  assert.equal(p.level, 0);
});

test('unseen crimes may be reported by witnesses a moment later', () => {
  const g = fakeGame();
  const p = new Police(g);
  for (let i = 0; i < 20; i++) p.report('hitPed', 0, 0);
  assert.equal(p.level, 0, 'nothing immediately');
  assert.ok(p.pending.length > 0, 'witnesses are calling it in');
});

test('the story is ten missions in a playable order, each given by someone in it', () => {
  assert.equal(STORY.length, 10);
  const ids = new Set(STORY.map(m => m.id));
  for (const m of STORY) for (const r of m.requires || []) assert.ok(ids.has(r), `${m.id} requires ${r}`);
  assert.deepEqual(STORY.filter(m => !m.requires).map(m => m.id), [STORY[0].id], 'one way in');
  // Fresh ids: saves from the old story (m1-m8) don't skip any of it.
  for (const m of STORY) assert.ok(!/^m\d$/.test(m.id), m.id);
  for (const m of STORY) assert.ok(CHARACTERS[m.giver]?.initial, `${m.id} has a contact to mark on the map`);
});

test('every line of the story is spoken by a character it knows', () => {
  const g = { ...fakeGame(), input: { mode: 'keyboard' }, settings: {} };
  let n = 0;
  for (const m of STORY) {
    for (const step of m.steps(g)) {
      const lines = [...(step.lines || []), ...(step.opts?.chatter || []).flatMap(([, l]) => l)];
      for (const [who, text] of lines) { assert.ok(CHARACTERS[who], `${m.id}: ${who}`); assert.ok(text.length < 200, `${m.id}: a line short enough to read`); n++; }
    }
  }
  assert.ok(n > 80, `${n} lines`);
});

test('a goTo step completes inside its radius and only once you stop', () => {
  const g = fakeGame();
  const missions = new Missions(g, []);
  const m = { ent: {}, vars: {}, target: null, timer: null, steps: [] };
  m.ctx = missions._ctx(m);
  const step = Steps.goTo({ x: 10, z: 0 }, 'Go', { radius: 3 });
  step.enter(m.ctx);
  assert.equal(step.update(m.ctx, 0.1), null);
  g.player.pos = { x: 9, z: 0 }; g.player.x = 9;
  assert.equal(step.update(m.ctx, 0.1), 'done');
});

test('dialogue steps wait for the lines to finish', () => {
  const g = fakeGame();
  const missions = new Missions(g, []);
  const m = { ent: {}, vars: {}, target: null, timer: null, steps: [] };
  m.ctx = missions._ctx(m);
  const step = Steps.say([['PAKYA', 'Bhau!'], ['YOU', 'Pakya!']]);
  step.enter(m.ctx);
  let t = 0;
  while (step.update(m.ctx, 0.1) !== 'done' && t < 20) { missions._dialog(0.1); t += 0.1; }
  assert.ok(t > 3 && t < 20, `took ${t.toFixed(1)} s`);
});

test('saves survive a round trip and reset cleanly', () => {
  const store = new Map();
  globalThis.localStorage = { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
  const s = new Save();
  s.cash = 1234; s.complete('m1'); s.flush();
  const again = new Save();
  assert.equal(again.cash, 1234);
  assert.ok(again.done('m1'));
  again.reset();
  assert.equal(new Save().cash, 200);
});

test('a browser that refuses the save gets the game to say so, once', () => {
  globalThis.localStorage = { getItem: () => null, setItem: () => { throw new Error('storage is blocked'); } };
  const s = new Save();
  let told = 0;
  s.onFail = () => told++;
  s.cash = 500;
  assert.equal(s.flush(), false);
  s.cash = 600; s.flush();
  assert.equal(s.available, false);
  assert.equal(told, 1);
});

test('every place the story sends you is on a road you can drive', async () => {
  const { world } = await import('./helpers.js');
  const { STORY_PLACES } = await import('../src/game/story.js');
  const { net } = world();
  for (const [name, p] of Object.entries(STORY_PLACES)) {
    const n = net.nearest(p.x, p.z, 60, {}, r => !net.raised[r]);
    assert.ok(n && Math.hypot(n.x - p.x, n.z - p.z) < 25, `${name} is ${n ? Math.hypot(n.x - p.x, n.z - p.z).toFixed(0) + ' m' : 'far'} from a road`);
  }
  for (const m of STORY) {
    const s = typeof m.start === 'function' ? null : m.start;
    if (s) assert.ok(net.nearest(s.x, s.z, 30, {}, r => !net.raised[r]), `${m.id} starts by a road`);
  }
});
