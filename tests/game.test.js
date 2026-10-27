import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Police } from '../src/game/police.js';
import { Missions, Steps, driveHunters } from '../src/game/missions.js';
import { STORY, CHARACTERS, HOME, STORY_PLACES } from '../src/game/story.js';
import { Save } from '../src/game/save.js';
import { Peds } from '../src/actors/peds.js';

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

/** A mission's context with nothing running, for exercising single steps. */
function stepContext(g) {
  const missions = new Missions(g, []);
  const m = { ent: {}, vars: {}, target: null, timer: null, steps: [], time: 0 };
  m.ctx = missions._ctx(m);
  return m;
}

test('a beaten enemy stays beaten: the one still on the ground cowers when it gets up', () => {
  const g = fakeGame();
  g.hud.bark = () => {};
  const peds = new Peds(g);
  g.peds = peds;
  const m = stepContext(g);
  const goon = peds._make({ x: 1, z: 0, outfit: { kind: 'goon' } }, 1, 0, null);
  m.ent.goon = goon;
  const step = Steps.fight(['goon'], 'Fight');
  step.enter(m.ctx);
  peds.knock(goon, 0, 0, 2, 'punch');
  assert.equal(step.update(m.ctx, 0.1), null, 'one more hit to go');
  goon.state = 'fight';
  peds.knock(goon, 0, 0, 2, 'punch'); // the last hit always knocks him down
  assert.equal(step.update(m.ctx, 0.1), 'done');
  assert.equal(goon.after, 'cower', 'he gets up cowering, not swinging through the next scene');
  assert.equal(goon.grudge, 0);
});

test('carjacking the car you chase wins the chase: its AI lets go and its driver is the one to beat', () => {
  const g = fakeGame();
  const pilot = { x: 0, z: 0 }, me = { x: 0, z: 0 };
  g.player.human = me;
  const car = { id: 1, x: 0, z: 8, hd: 2, vital: true };
  const target = { id: 2, x: 0, z: 0, hd: 2, spec: { top: 40 }, driver: pilot, pilot, health: 1000, lastHit: 0 };
  g.vehicles = { list: [car, target], ejectDriver() { throw new Error('ejected whoever is at the wheel'); } };
  const m = stepContext(g);
  m.ent.car = car; m.ent.mamaCar = target;
  m.ctx.driver = () => ({ setPath() {}, control: () => ({ throttle: 1, brake: 0, steer: 1 }), done: false });
  const step = Steps.chase('mamaCar', { x: 0, z: 500 }, 'Chase', { driverAs: 'mamaMan' });
  step.enter(m.ctx);
  assert.equal(step.update(m.ctx, 0.1), null, 'the chase is on');
  // Pulled out at the door (rules.js carjack), the player takes the wheel (Player.enterVehicle).
  const mama = { h: pilot, state: 'down' };
  g.peds.list.push(mama);
  target.driver = me; g.player.vehicle = target; g.player.pos = target;
  const mine = { throttle: 0, brake: 1, steer: 0 };
  g.controls.set(target, mine);
  assert.equal(step.update(m.ctx, 0.1), 'done');
  step.exit(m.ctx);
  assert.equal(g.controls.get(target), mine, "the player's controls stand");
  assert.equal(target.flee, null);
  assert.equal(m.ent.mamaMan, mama, 'the jacked driver is the one to finish');
  assert.ok(mama.keep && mama.mission);
  assert.equal(car.vital, false, 'the car you chased in is no longer needed');
});

test('a rammed chase target bails out its own driver, and the chasing car may burn now', () => {
  const g = fakeGame();
  const pilot = { x: 0, z: 0 };
  const car = { id: 1, x: 0, z: 8, hd: 2, vital: true };
  const target = { id: 2, x: 0, z: 0, hd: 2, spec: { top: 40 }, driver: pilot, pilot, health: 1000, lastHit: 0, role: 'mission' };
  g.vehicles = { list: [car, target], ejectDriver(v) { const h = v.driver; v.driver = null; return h; }, doorWorld: v => ({ x: v.x + 1, z: v.z }) };
  g.peds = { list: [], _make(h) { const p = { h }; this.list.push(p); return p; } };
  const m = stepContext(g);
  m.ent.car = car; m.ent.pappu = target;
  m.ctx.driver = () => ({ setPath() {}, control: () => ({}), done: false });
  const step = Steps.chase('pappu', { x: 0, z: 500 }, 'Chase', { driverAs: 'pappuMan' });
  step.enter(m.ctx);
  target.health = 300;
  assert.equal(step.update(m.ctx, 0.1), 'done');
  assert.equal(m.ent.pappuMan.h, pilot);
  assert.ok(m.ent.pappuMan.keep && m.ent.pappuMan.mission);
  assert.equal(target.role, 'abandoned');
  assert.equal(car.vital, false);
});

test('a hunter car the player jacks stops hunting and never steers the player', () => {
  const g = fakeGame();
  const v = { id: 1, x: 0, z: 0, hunt: { control: () => ({ throttle: 1, steer: -1 }) }, blip: '#ff4d4d' };
  g.missions = { active: { ent: { tigerCar: v } } };
  g.player.vehicle = v; g.player.pos = v;
  const mine = { throttle: 0, brake: 1, steer: 0.8 };
  g.controls.set(v, mine);
  driveHunters(g, 0.1);
  assert.equal(g.controls.get(v), mine);
  assert.equal(v.hunt, null);
});

test('a step that fails leaves no GPS line to its target', () => {
  const g = fakeGame();
  let routed = 0;
  g.net.route = () => { routed++; return { points: [] }; };
  const def = { id: 'x', giver: 'PAKYA', start: { x: 0, z: 0 }, steps: () => [{ enter(c) { c.setTarget({ x: 500, z: 0 }); }, update: () => 'fail:Gone.' }] };
  const missions = new Missions(g, [def]);
  missions.start('x');
  missions.update(1 / 60);
  assert.equal(missions.active, null);
  assert.equal(g.hud.route, null);
  assert.equal(routed, 0);
});

test('a contact marker waits while you lie WASTED, or while a witness is still calling a crime in', () => {
  const g = fakeGame();
  const def = { id: 'x', giver: 'PAKYA', start: { x: 0, z: 0 }, steps: () => [Steps.wait(5)] };
  const missions = new Missions(g, [def]);
  g.respawning = true;
  missions.update(0.1);
  assert.equal(missions.active, null, 'not on the WASTED card');
  g.respawning = false; g.police.pending = [{ t: 3, heat: 1 }];
  missions.update(0.1);
  assert.equal(missions.active, null, 'not with the police about to hear of it');
  g.police.pending = [];
  missions.update(0.1);
  assert.equal(missions.active?.def, def);
});

test('the story race shows your place and the checkpoints left', () => {
  const g = fakeGame();
  let shown = '';
  g.hud.objective = t => { shown = t; };
  const m = stepContext(g);
  const tiger = { id: 1, x: 150, z: 0, spec: { top: 40 } };
  m.ent.tiger = tiger;
  m.ctx.driver = () => ({ setPath() {}, control: () => ({}) });
  const step = Steps.race([{ x: 100, z: 0 }, { x: 200, z: 0 }], ['tiger'], 'Win.');
  step.enter(m.ctx);
  tiger.raceIdx = 1; // Tiger is past the first checkpoint, you are not
  step.update(m.ctx, 0.1);
  assert.match(shown, /^Win\. Position <b>2\/2<\/b> · checkpoint 1\/2$/);
});

test('the river race crosses the Govardhan bridge once, straight on to the dam', async () => {
  const { world } = await import('./helpers.js');
  const { net } = world();
  const g = { ...fakeGame(), net, input: { mode: 'keyboard' }, settings: {} };
  const pts = STORY.find(m => m.id === 'c6').steps(g).find(s => s.kind === 'race').points;
  for (let i = 0; i < pts.length; i++) for (let j = 0; j < i; j++) assert.ok(Math.hypot(pts[i].x - pts[j].x, pts[i].z - pts[j].z) > 40, `checkpoint ${i} is checkpoint ${j} again`);
  const P = STORY_PLACES;
  let len = 0, from = P.gandhiPutla;
  for (const p of pts) { len += net.route(from.x, from.z, p.x, p.z).length; from = p; }
  const direct = net.route(P.gandhiPutla.x, P.gandhiPutla.z, P.dam.x, P.dam.z).length;
  assert.ok(len < direct * 1.08, `${len.toFixed(0)} m of racing for a ${direct.toFixed(0)} m drive`);
});

test('story people never stand inside walls, and story vehicles never appear on top of anything', async () => {
  const { world } = await import('./helpers.js');
  const { Colliders, obbSat } = await import('../src/world/colliders.js');
  const { VEHICLE_TYPES } = await import('../src/actors/vehicle-types.js');
  const { net, city } = world();
  const colliders = new Colliders(city);
  const onRoad = (x, z) => net.nearest(x, z, 80, {}, r => !net.raised[r]);
  const overlap = (a, b) => obbSat(a.x, a.z, a.hw, a.hd, Math.cos(a.heading), Math.sin(a.heading), b.x, b.z, b.hw, b.hd, Math.cos(b.heading), Math.sin(b.heading), {});
  // Each mission's scripted spawns on the real city: its calls run, and between them the player just
  // arrives where the steps send them (on foot, or in the step's vehicle, on the road there).
  for (const def of STORY) {
    const list = [];
    const g = { ...fakeGame(), net, colliders, city, input: { mode: 'keyboard' }, settings: {} };
    g.vehicles = {
      list, addPassenger() {}, remove(v) { list.splice(list.indexOf(v), 1); },
      spawn(type, x, z, heading, o) {
        const s = VEHICLE_TYPES[type];
        const v = { id: list.length + 1, type, x, z, heading, hw: s.W / 2, hd: s.L / 2, spec: s, role: o.role, passengers: [], driver: o.driver ? { x, z, outfit: { flags: new Set() } } : null };
        list.push(v);
        return v;
      },
    };
    g.humans = { add: (outfit, x, z) => ({ x, z, outfit }) };
    g.peds = { list: [], _make(h) { const p = { h }; this.list.push(p); return p; }, remove(p) { this.list.splice(this.list.indexOf(p), 1); } };
    g.police.clear = () => {}; g.hud.help = () => {};
    const P = Object.assign(g.player, { human: {}, heading: 0 });
    const walkTo = t => {
      const n = colliders.blocked(t.x, t.z, 0.34) ? onRoad(t.x, t.z) : t;
      P.vehicle = null; P.x = n.x; P.z = n.z; P.pos = P;
    };
    walkTo(def.start);
    const m = { def, ent: {}, vars: {}, target: null, timer: null, steps: def.steps(g), time: 0 };
    m.ctx = new Missions(g, [def])._ctx(m);
    for (const [i, step] of m.steps.entries()) {
      if (step.kind === 'call') {
        const before = new Set(list);
        step.enter(m.ctx);
        for (const [name, e] of Object.entries(m.ent)) if (e?.h) assert.ok(!colliders.blocked(e.h.x, e.h.z, 0.25), `${def.id} step ${i}: ${name} stands inside a wall`);
        for (const v of list.filter(v => !before.has(v))) {
          for (const o of list) assert.ok(o === v || !overlap(v, o), `${def.id} step ${i}: a ${v.type} appears on a ${o.type}`);
          if (!P.vehicle) assert.ok(!overlap(v, { x: P.x, z: P.z, hw: 0.34, hd: 0.34, heading: 0 }), `${def.id} step ${i}: a ${v.type} appears on the player`);
          const wall = colliders.boxContact(v.x, v.z, v.hw, v.hd, v.heading, {});
          assert.ok(!wall || wall.depth < 0.3, `${def.id} step ${i}: a ${v.type} appears ${wall?.depth.toFixed(2)} m into a wall`);
        }
      } else if (step.kind === 'goTo') {
        const t = typeof step.target === 'function' ? step.target(m.ctx) : step.target;
        const v = step.opts.vehicle && m.ent[step.opts.vehicle];
        if (v) { const n = onRoad(t.x, t.z); Object.assign(v, { x: n.x, z: n.z, heading: Math.atan2(n.dx, n.dz) }); P.vehicle = v; P.pos = v; } else walkTo(t);
      } else if (step.kind === 'enter') { P.vehicle = m.ent[step.vehicle]; P.pos = P.vehicle; }
      else if (step.kind === 'leave' && P.vehicle) walkTo(onRoad(P.vehicle.x, P.vehicle.z));
    }
  }
});

test('Continue and Free Roam never put you inside a contact marker', async () => {
  const { world } = await import('./helpers.js');
  const { net } = world();
  // Where main.js startGame puts you: home, 4 m across the street from its centre line.
  const n = net.nearest(HOME.x, HOME.z, 30, {});
  const spawn = { x: HOME.x + n.dz * 4, z: HOME.z - n.dx * 4 };
  for (const m of STORY) {
    const d = Math.hypot(m.start.x - spawn.x, m.start.z - spawn.z);
    assert.ok(d > 5, `${m.id} starts ${d.toFixed(1)} m from where you wake up`);
  }
});
