import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Police } from '../src/game/police.js';
import { Missions, Steps, driveHunters } from '../src/game/missions.js';
import { STORY, CHARACTERS, HOME, STORY_PLACES } from '../src/game/story.js';
import { Save } from '../src/game/save.js';
import { Peds } from '../src/actors/peds.js';
import { DynamicDriver } from '../src/actors/traffic.js';

function fakeGame() {
  const hud = { big() {}, objective() {}, setTimer() {}, subtitle() {}, clearSubtitle() {}, help() {}, route: null };
  return {
    time: 0, hud, controls: new Map(), cutscene: false,
    player: { pos: { x: 0, z: 0 }, x: 0, z: 0, vehicle: null, state: 'foot', speed: 0 },
    vehicles: { list: [] }, peds: { list: [] }, police: { level: 0, setLevel() {}, lock: false },
    save: { done: id => false, complete() {}, flush() {}, set(k, v) { this.data[k] = v; }, data: { stamps: [] } }, addCash() {},
    camera: { cinematic: null, playShot() {}, endShot() {} }, effects: { markers: { set() {} } },
    net: { route: () => null, nearest: () => null, raised: [] }, onWantedChange() {},
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

test('a rider thrown at the end of a chase lands and gets up before the fight, not snapped upright', () => {
  const g = fakeGame();
  g.hud.bark = () => {};
  const peds = new Peds(g);
  g.peds = peds;
  const m = stepContext(g);
  const pappu = peds._make({ x: 1, z: 0, outfit: { kind: 'man' } }, 1, 0, null);
  pappu.state = 'down'; pappu.t = 1.2; pappu.after = 'flee'; // as Steps.chase leaves him
  m.ent.pappuMan = pappu;
  const step = Steps.fight(['pappuMan'], 'Get the bag', { pappuMan: 1 });
  step.enter(m.ctx);
  assert.equal(pappu.state, 'down', 'still falling');
  assert.equal(pappu.after, 'fight', 'and up swinging once he gets up');
  assert.equal(pappu.needHits, 1);
  pappu.state = 'getup'; pappu.after = 'flee';
  assert.equal(step.update(m.ctx, 0.1), null);
  assert.equal(pappu.after, 'fight', 'getting up, he still means to fight');
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

test("pulling out the story's own driver is no crime, under a policeman's nose; a car off the street still is", async () => {
  // rules.js wires up the photo panel and the cheat keys as it installs.
  const el = () => ({ addEventListener() {}, hidden: true });
  globalThis.document ??= { getElementById: el, body: { classList: { add() {}, remove() {} } } };
  globalThis.addEventListener ??= () => {};
  const { installRules } = await import('../src/game/rules.js');
  const g = fakeGame();
  Object.assign(g, { city: { places: [] }, audio: { sfx() {} } });
  g.save.stat = () => {};
  g.police = new Police(g);
  const jeep = { type: 'police', role: 'police-idle', x: 6, z: 0, driver: {} }; // an officer watching
  g.vehicles = { list: [jeep], ejectDriver(v) { const h = v.driver; v.driver = null; return h; }, doorWorld: v => ({ x: v.x + 1, z: v.z }) };
  g.peds = { list: [], adoptEjected() {} };
  installRules(g);
  const car = role => ({ type: 'suv', role, x: 0, z: 0, driver: { x: 0, z: 0 }, passengers: [] });
  g.carjack(car('mission'), g.player); // Mama's SUV mid-chase, or a hunter
  assert.deepEqual([g.police.level, g.police.heat, g.police.pending.length], [0, 0, 0]);
  g.carjack(car('traffic'), g.player);
  assert.equal(g.police.level, 1);
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

test('a hunter that rams straight at the player and gets nowhere (a median between) goes round by the roads', () => {
  const g = fakeGame();
  let routed = 0, rams = 0;
  g.net.route = () => { routed++; return { points: [0, 26, 0, 0] }; };
  const v = { id: 1, x: 0, z: 26, hunt: { setPath() {}, control: (dt, target) => { if (target) rams++; return {}; } } };
  g.missions = { active: { ent: { tigerCar: v } } };
  for (let t = 0; t < 4; t += 0.1) driveHunters(g, 0.1);
  assert.equal(routed, 0, 'straight at the player at first');
  for (let t = 0; t < 3; t += 0.1) driveHunters(g, 0.1);
  assert.ok(routed > 0 && v.huntRoads > 0, 'then round by the roads');
  rams = 0;
  for (let t = 0; t < 9; t += 0.1) driveHunters(g, 0.1);
  assert.ok(rams > 0, 'and at the player again');
});

test('a hunter ramming the player, backing off and ramming again keeps at it, never off round the roads', () => {
  const g = fakeGame();
  let routed = 0, rams = 0, frames = 0;
  g.net.route = () => { routed++; return { points: [0, 10, 0, 0] }; };
  const v = { id: 1, x: 0, z: 10, hunt: { setPath() {}, control: (dt, target) => { if (target) rams++; return {}; } } };
  g.missions = { active: { ent: { savkarCar: v } } };
  // In to 3.5 m (against the player's car), back out to 12 m, in again: every 3 s for a minute.
  for (let t = 0; t < 60; t += 0.1, frames++) {
    const k = (t % 3) / 3;
    v.z = 3.5 + 8.5 * (k < 0.5 ? 1 - 2 * k : 2 * k - 1);
    driveHunters(g, 0.1);
  }
  assert.equal(routed, 0);
  assert.equal(rams, frames);
});

test('a hunter pressed against a player who stopped backs off and comes again, and plans afresh on the roads after', () => {
  const g = fakeGame();
  let routed = 0;
  g.net.route = () => { routed++; return { points: [0, 80, 0, 40] }; };
  g.net.lanePath = p => p;
  // c7: Tiger came round by the roads (the path ends at the onion tempo) and rammed it; it stopped.
  const v = { id: 1, x: 0, z: 4.2, y: 0, heading: Math.PI, vx: 0, vz: 0, hw: 1, hd: 2.3, spec: { top: 40 } };
  v.hunt = new DynamicDriver(g, v, { aggression: 0.9, maxSpeed: 40 });
  v.hunt.setPath([0, 60, 0, 30, 0, 4, 0, 0], false);
  v.hunt.i = 3;
  g.missions = { active: { ent: { tigerCar: v } } };
  let back = 0;
  for (let t = 0; t < 4; t += 0.1) { driveHunters(g, 0.1); const c = g.controls.get(v); if (c.brake && !c.throttle) back++; }
  assert.ok(back > 0, 'it backs off to ram again');
  assert.equal(routed, 0);
  // The player drives off: round by the roads, planned at once rather than idling with no path.
  g.player.pos = { x: 0, z: -60 };
  driveHunters(g, 0.1);
  assert.equal(routed, 1);
  assert.ok(v.hunt.path?.length >= 4);
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

test("out of the car you must drive: 'Get back in Pakya's auto', not 'the Pakya's auto'", () => {
  const g = fakeGame();
  let shown = '';
  g.hud.objective = t => { shown = t; };
  const m = stepContext(g);
  for (const [label, text] of [["Pakya's auto", "Get back in Pakya's auto."], ['onion tempo', 'Get back in the onion tempo.'], ['your car', 'Get back in your car.'], [undefined, 'Get back in the vehicle.']]) {
    m.ent.v = { id: 1, x: 50, z: 0, label };
    const step = Steps.goTo({ x: 500, z: 0 }, 'Drive.', { vehicle: 'v' });
    step.enter(m.ctx);
    assert.equal(step.update(m.ctx, 0.1), null);
    assert.equal(shown, text);
  }
  const missions = new Missions(g, [{ id: 'x', giver: 'PAKYA', start: { x: 0, z: 0 }, steps: () => [Steps.wait(9)] }]);
  let failed = '';
  g.hud.big = (title, sub) => { failed = sub; };
  missions.start('x');
  missions.active.ent.cash = { id: 2, x: 0, z: 0, label: 'cash car', vital: true, wrecked: true };
  missions.update(0.1);
  assert.equal(failed, 'The cash car was wrecked.');
});

test('a mission that ends lets its cast go, and a retry clears what is left of the last one', () => {
  const g = fakeGame();
  const vlist = [], removed = [];
  g.vehicles = {
    list: vlist,
    spawn(type, x, z, heading, o) { const v = { id: vlist.length + 1, type, x, z, heading, role: o.role, driver: null, passengers: [] }; vlist.push(v); return v; },
    remove(v) { removed.push(v); vlist.splice(vlist.indexOf(v), 1); },
  };
  const resnapped = [];
  g.peds = { list: [], _make(h) { const p = { h }; this.list.push(p); return p; }, remove(p) { this.list.splice(this.list.indexOf(p), 1); }, _resnap(p) { resnapped.push(p); } };
  g.humans = { add: (outfit, x, z) => ({ x, z, outfit }) };
  const def = {
    id: 'x', giver: 'SHERA', start: { x: 0, z: 0 },
    steps: () => [Steps.call(c => {
      c.spawnPed('shera', 'goon', 3, 0); c.spawnPed('goon', 'goon', 4, 0);
      c.spawnVehicle('car', 'hatch', 10, 0, 0); c.spawnVehicle('bike', 'bike', 14, 0, 0);
    }), Steps.wait(60)],
  };
  const missions = new Missions(g, [def]);
  missions.start('x');
  missions.update(0.1);
  const first = missions.active.ent;
  first.goon.state = 'cower'; first.goon.t = 999; // beaten
  g.player.vehicle = first.car; missions.update(0.1); g.player.vehicle = null; // drove Shera's car a while
  missions.fail('Pappu got away.');
  assert.equal(first.shera.state, 'walk', 'nobody stands frozen in a scene that is over');
  assert.ok(resnapped.includes(first.shera));
  assert.ok(first.goon.t < 10, 'the beaten get up before long');
  assert.ok(!first.shera.keep && !first.shera.mission && first.shera.role == null);
  assert.equal(first.bike.role, 'abandoned');
  missions.cooldown = 0;
  missions.start('x');
  missions.update(0.1);
  assert.ok(!g.peds.list.includes(first.shera) && !g.peds.list.includes(first.goon), 'one Shera, not two');
  assert.deepEqual(removed, [first.bike], 'the old bike goes; the car you drove is yours to keep');
  assert.equal(g.peds.list.length, 2);
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

test('a race rival heads for the checkpoint it owes, and one wedged out of sight is put back on its route', () => {
  const g = fakeGame();
  g.net = {
    route: (x0, z0, x1, z1) => ({ points: [x0, z0, (x0 + x1) / 2, (z0 + z1) / 2, x1, z1] }),
    nearest: (x, z) => ({ x, z, road: 0 }), raised: [], deckOver: () => 0,
  };
  const m = stepContext(g);
  const tiger = { id: 1, x: 0, z: -20, spec: { top: 40 }, heading: 0 };
  m.ent.tiger = tiger;
  g.vehicles.list = [tiger];
  m.ctx.driver = () => ({ i: 0, setPath(p) { this.path = p; this.goal = { x: p.at(-2), z: p.at(-1) }; }, control: () => ({}) });
  const cps = [{ x: 0, z: 100 }, { x: 0, z: 200 }, { x: 0, z: 300 }];
  const step = Steps.race(cps, ['tiger'], 'Win.');
  step.enter(m.ctx);
  const d = tiger.raceDriver;
  assert.deepEqual(d.goal, cps[0], 'its re-plans head for the first checkpoint, not the finish');
  assert.equal(d.path.at(-1), 200, 'and its line runs on through the next');
  // Its driver re-plans by itself (wedged), to the checkpoint alone: on through the next again, or
  // it brakes to a stop there, and wedged on that last stretch it counts as arriving, never stuck.
  d.setPath([0, -20, 0, 100]);
  step.update(m.ctx, 0.1);
  assert.deepEqual([d.path.at(-1), d.goal], [200, cps[0]]);
  Object.assign(tiger, { x: 0, z: 95 });
  step.update(m.ctx, 0.1);
  assert.equal(tiger.raceIdx, 1);
  assert.deepEqual(d.goal, cps[1]);
  // Wedged 150 m off: back on its route, facing along it. In sight, left to unstick itself.
  Object.assign(tiger, { x: 30, z: 150, vx: 3 });
  assert.equal(d.onStuck(), true);
  assert.deepEqual([tiger.x, tiger.vx, Math.round(tiger.heading * 100)], [0, 0, 0]);
  Object.assign(tiger, { x: 20, z: 10 });
  assert.equal(d.onStuck(), false);
});

test('a wedged rival is put back a short way on: never into the checkpoint it owes, past you, or where you can see it', async () => {
  const THREE = await import('three');
  const g = fakeGame();
  g.net = { route: (x0, z0, x1, z1) => ({ points: [x0, z0, x1, z1] }), nearest: (x, z) => ({ x, z, road: 0 }), raised: [], deckOver: () => 0 };
  const m = stepContext(g);
  const tiger = { id: 1, x: 0, z: 0, y: 0, spec: { top: 40 }, heading: 0 };
  m.ent.tiger = tiger;
  g.vehicles.list = [tiger];
  m.ctx.driver = () => ({ i: 0, setPath(p) { this.path = p; }, control: () => ({}) });
  const step = Steps.race([{ x: 0, z: 1000 }, { x: 0, z: 2000 }], ['tiger'], 'Win.');
  step.enter(m.ctx);
  const d = tiger.raceDriver, at = (x, z, i) => { Object.assign(tiger, { x, z, heading: 2 }); d.i = i; };
  // A long straight, its points 236 m apart: 30 m on along it, not on to the next point.
  g.player.pos = { x: 0, z: -400 };
  d.path = [0, -400, 0, 264, 0, 500, 0, 736, 0, 1000, 0, 2000];
  at(1.5, 270, 2);
  assert.equal(d.onStuck(), true);
  assert.deepEqual([tiger.x, tiger.z, tiger.heading, d.i], [0, 300, 0, 2]);
  // Wedged by the checkpoint it owes: it drives through that itself.
  at(1, 970, 4);
  assert.equal(d.onStuck(), true);
  assert.ok(tiger.z <= 980, `put back at ${tiger.z}, inside the checkpoint`);
  at(1, 990, 4);
  assert.equal(d.onStuck(), false);
  // Behind you and out of the camera's view, 30 m back: on toward you, but still behind.
  const cam = new THREE.PerspectiveCamera(62, 915 / 412, 0.3, 900);
  cam.position.set(0, 3, -6); cam.lookAt(0, 1, 30); cam.updateMatrixWorld();
  g.camera3 = cam;
  g.player.pos = { x: 0, z: 0 };
  at(2, -30, 1);
  assert.equal(d.onStuck(), true);
  assert.ok(tiger.z > -30 && tiger.z < -10, `put back at ${tiger.z}`);
  // Ahead of you, in view: it unsticks itself.
  at(2, 60, 2);
  assert.equal(d.onStuck(), false);
  assert.deepEqual([tiger.x, tiger.z], [2, 60]);
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
  // Off the start by the main roads, as the rivals plan it (two checkpoints ahead): not the sharp
  // turn into the 4.8 m lanes behind the Putla, which every car overshot at race pace.
  const p = [P.gandhiPutla, pts[0], pts[1]].flatMap((a, i, all) => i ? net.route(all[i - 1].x, all[i - 1].z, a.x, a.z).points.slice(0, -2) : []);
  for (let i = 0; i < p.length; i += 2) {
    const n = net.nearest(p[i], p[i + 1], 10, {});
    assert.ok(!n || net.width[n.road] >= 7, `a ${net.width[n.road].toFixed(1)} m lane at ${p[i].toFixed(0)}, ${p[i + 1].toFixed(0)}`);
  }
});

/**
 * Each mission's scripted spawns on the real city: its calls run, and between them the player just
 * arrives where the steps send them (on foot, or in the step's vehicle, on the road there). Returns
 * what looked wrong, and where each mission's vehicles first stood: { problems, spawns }. Run once.
 */
let dryRun = null;
const storyDryRun = () => (dryRun ??= runStory());
async function runStory() {
  const { world } = await import('./helpers.js');
  const { Colliders, obbSat } = await import('../src/world/colliders.js');
  const { VEHICLE_TYPES } = await import('../src/actors/vehicle-types.js');
  const { net, city } = world();
  const colliders = new Colliders(city);
  const onRoad = (x, z) => net.nearest(x, z, 80, {}, r => !net.raised[r]);
  const overlap = (a, b) => obbSat(a.x, a.z, a.hw, a.hd, Math.cos(a.heading), Math.sin(a.heading), b.x, b.z, b.hw, b.hd, Math.cos(b.heading), Math.sin(b.heading), {});
  // Facing the dead end of the street it is parked in (through any plain bends)?
  const nosedIn = v => {
    const n = onRoad(v.x, v.z);
    let r = n.road, j = Math.cos(v.heading - Math.atan2(n.dx, n.dz)) > 0 ? net.rb[r] : net.ra[r];
    for (let k = 0; k < 8 && net.jRoads[j].length === 2; k++) { r = net.jRoads[j].find(o => o !== r); j = net.otherEnd(r, j); }
    return net.jRoads[j].length === 1;
  };
  const problems = [], spawns = {}, voices = {}, check = (ok, msg) => { if (!ok) problems.push(msg); };
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
        for (const [name, e] of Object.entries(m.ent)) if (e?.h) check(!colliders.blocked(e.h.x, e.h.z, 0.25), `${def.id} step ${i}: ${name} stands inside a wall`);
        for (const v of list.filter(v => !before.has(v))) {
          for (const o of list) check(o === v || !overlap(v, o), `${def.id} step ${i}: a ${v.type} appears on a ${o.type}`);
          if (!P.vehicle) check(!overlap(v, { x: P.x, z: P.z, hw: 0.34, hd: 0.34, heading: 0 }), `${def.id} step ${i}: a ${v.type} appears on the player`);
          const wall = colliders.boxContact(v.x, v.z, v.hw, v.hd, v.heading, {});
          check(!wall || wall.depth < 0.3, `${def.id} step ${i}: a ${v.type} appears ${wall?.depth.toFixed(2)} m into a wall`);
          check(!nosedIn(v), `${def.id} step ${i}: a ${v.type} is parked facing a dead end`);
        }
        for (const [name, e] of Object.entries(m.ent)) if (e?.id) (spawns[def.id] ??= {})[name] ??= { ...e };
      } else if (step.kind === 'goTo') {
        const t = typeof step.target === 'function' ? step.target(m.ctx) : step.target;
        const v = step.opts.vehicle && m.ent[step.opts.vehicle];
        if (v) { const n = onRoad(t.x, t.z); Object.assign(v, { x: n.x, z: n.z, heading: Math.atan2(n.dx, n.dz) }); P.vehicle = v; P.pos = v; } else walkTo(t);
      } else if (step.kind === 'enter') { P.vehicle = m.ent[step.vehicle]; P.pos = P.vehicle; }
      else if (step.kind === 'leave' && P.vehicle) walkTo(onRoad(P.vehicle.x, P.vehicle.z));
      else if (step.kind === 'say') {
        // Someone of the cast who speaks in person (not on the phone) is there to be seen.
        for (const [who] of step.lines) {
          const e = m.ent[who.toLowerCase()];
          if (e?.h) (voices[def.id] ??= []).push({ step: i, who, d: Math.hypot(e.h.x - P.pos.x, e.h.z - P.pos.z), on: onRoad(e.h.x, e.h.z) });
        }
      }
    }
  }
  return { problems, spawns, voices };
}

test('story people never stand inside walls, and story vehicles never appear on top of anything, or nosed into a dead end', async () => {
  assert.deepEqual((await storyDryRun()).problems, []);
});

test('the cast speak in person only where you can see them', async () => {
  const { world } = await import('./helpers.js');
  const { net } = world();
  const { voices } = await storyDryRun();
  for (const [id, list] of Object.entries(voices)) {
    for (const v of list) assert.ok(v.d < 25, `${id} step ${v.step}: ${v.who} speaks from ${v.d.toFixed(0)} m away`);
  }
  // c5 ends with the tipper parked on the main road: Mama and Shera wait for it on the footpath,
  // not down the ghat lanes, nor where it pulls in.
  const home = voices.c5.filter(v => v.step === voices.c5.at(-1).step);
  assert.deepEqual([...new Set(home.map(v => v.who))].sort(), ['MAMA', 'SHERA']);
  for (const v of home) assert.ok(v.on.dist > net.width[v.on.road] / 2, `${v.who} stands ${v.on.dist.toFixed(1)} m from the middle of a ${net.width[v.on.road]} m road`);
});

test("Mama's tippers load on the main road: no hairpin a truck can't turn between the ghat and the bridge", async () => {
  const { world } = await import('./helpers.js');
  const { net } = world();
  const P = STORY_PLACES;
  const sharpest = (from, to) => {
    const p = net.route(from.x, from.z, to.x, to.z).points;
    let worst = 0;
    for (let i = 2; i + 5 < p.length; i += 2) { // (the last point is the goal itself, off the road)
      const d = Math.atan2(p[i + 2] - p[i], p[i + 3] - p[i + 1]) - Math.atan2(p[i] - p[i - 2], p[i + 1] - p[i - 1]);
      worst = Math.max(worst, Math.abs(Math.atan2(Math.sin(d), Math.cos(d))));
    }
    return worst * 180 / Math.PI;
  };
  const tipper = (await storyDryRun()).spawns.c4.tipper;
  assert.ok(sharpest(tipper, P.bridgeN) < 60, `c4: a ${sharpest(tipper, P.bridgeN).toFixed(0)}° turn on the way to the bridge`);
  const home = STORY.find(m => m.id === 'c5').steps({ input: { mode: 'keyboard' }, settings: {} }).filter(s => s.kind === 'goTo').at(-1).target;
  // Coming back over the bridge (its southbound carriageway) with the seized one.
  assert.ok(sharpest(P.ghatBridge, home) < 60, `c5: a ${sharpest(P.ghatBridge, home).toFixed(0)}° turn bringing the tipper home`);
});

test("Mama's seized tipper faces the way out of the impound yard's lane, with nothing parked in front of it", async () => {
  const { world } = await import('./helpers.js');
  const { net } = world();
  const { spawns } = await storyDryRun();
  const s = spawns.c5.seized, fx = Math.sin(s.heading), fz = Math.cos(s.heading), home = STORY_PLACES.ghatRoad;
  // A truck can't turn round in a 4.8 m lane: the route home sets off the way it faces.
  const p = net.route(s.x, s.z, home.x, home.z).points;
  let k = 2;
  while (Math.hypot(p[k] - p[0], p[k + 1] - p[1]) < 8) k += 2;
  assert.ok(fx * (p[k] - p[0]) + fz * (p[k + 1] - p[1]) > 0, 'it faces back up the lane, away from the way out');
  for (const name of ['yardTractor', 'yardBike', 'yardAuto']) {
    const v = spawns.c5[name], ox = v.x - s.x, oz = v.z - s.z;
    const ahead = ox * fx + oz * fz, across = Math.abs(ox * fz - oz * fx);
    assert.ok(!(ahead > 0 && ahead < s.hd + v.hd + 6 && across < s.hw + v.hw + 0.5), `the ${name} stands ${(ahead - s.hd - v.hd).toFixed(1)} m in front of it`);
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
