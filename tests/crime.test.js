// Crimes and consequences: what the police count, how they let go, and what a blast does.
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { Police } from '../src/game/police.js';
import { installRules } from '../src/game/rules.js';

function policeGame() {
  const g = {
    time: 0, cutscene: false, controls: new Map(), bustedN: 0,
    player: { x: 0, z: 0, y: 0, vehicle: null, state: 'foot', speed: 0 },
    vehicles: { list: [], remove(v) { const i = this.list.indexOf(v); if (i >= 0) this.list.splice(i, 1); } },
    peds: { list: [] },
    colliders: { raycast: () => 1 },
    net: { nearest: () => null, route: () => null, raised: [], width: [] },
    onWantedChange() {}, onEvaded() {}, busted() { g.bustedN++; },
  };
  g.player.pos = g.player;
  g.police = new Police(g);
  return g;
}
const jeep = (o = {}) => ({ type: 'police', role: 'police', x: 0, z: 0, y: 0, vx: 0, vz: 0, sirenOn: true, keep: true, wrecked: false, driver: {}, passengers: [], spec: { two: false }, ...o });
const run = (g, seconds) => { for (let t = 0; t < seconds; t += 1 / 60) { g.time += 1 / 60; g.police.update(1 / 60); } };

test('small crimes are forgotten: two punches long ago and one now are not a star', () => {
  const g = policeGame(), p = g.police;
  p.report('punch', 0, 0, { cop: true });
  p.report('punch', 0, 0, { cop: true });
  assert.equal(p.level, 0);
  run(g, 60);
  assert.equal(p.heat, 0);
  p.report('punch', 0, 0, { cop: true });
  assert.equal(p.level, 0);
  p.report('hitCop', 0, 0, { cop: true });
  assert.equal(p.level, 2, 'serious crimes still count at once');
});

test('a wrecked or stolen police jeep is let go: siren off, free to be towed', () => {
  const g = policeGame(), p = g.police;
  p.setLevel(2);
  const wreck = jeep({ x: 50, wrecked: true }), stolen = jeep({ x: 20, role: 'player', sirenOn: false });
  g.vehicles.list.push(wreck, stolen);
  p.units.push({ v: wreck }, { v: stolen });
  g.controls.set(wreck, {}); g.controls.set(stolen, { throttle: 1 });
  run(g, 1 / 60);
  assert.equal(p.units.length, 0);
  // The wreck is the tow truck's now (Parked: abandoned or wrecked, not kept, far away).
  assert.deepEqual([wreck.role, wreck.sirenOn, wreck.keep, g.controls.has(wreck)], ['abandoned', false, false, false]);
  assert.deepEqual([stolen.role, stolen.keep, g.controls.has(stolen)], ['player', false, true], "the player's jeep keeps its controls");
  // Jeeps officers got out of are cleared away when left behind, even mid-chase, and go quiet on 'Lost them'.
  const left = jeep({ x: 0, role: 'police-parked', driver: null }), parked = jeep({ x: 395, role: 'police-parked', driver: null });
  g.vehicles.list.push(left, parked);
  g.player.x = 400;
  run(g, 1 / 60);
  assert.ok(!g.vehicles.list.includes(left));
  assert.ok(g.vehicles.list.includes(parked));
  p.setLevel(0);
  assert.equal(parked.sirenOn, false);
});

test('only a jeep with an officer in it witnesses a crime', () => {
  const g = policeGame(), p = g.police;
  const empty = jeep({ x: 10, role: 'police-parked', driver: null }), burnt = jeep({ x: 10, role: 'police-parked', wrecked: true });
  g.vehicles.list.push(empty, burnt);
  p.report('hitPed', 0, 0);
  assert.equal(p.heat, 0, 'an empty or burnt-out jeep sees nothing');
  g.vehicles.list.push(jeep({ x: 10, role: 'police-idle' }));
  p.report('hitPed', 0, 0);
  assert.equal(p.level, 1);
});

test('no arrest while a cutscene holds the player still', () => {
  const g = policeGame(), p = g.police;
  p.setLevel(1);
  const cop = { h: { x: 0.5, z: 0 }, state: 'fight', keep: true };
  g.peds.list.push(cop); p.foot.push(cop);
  g.cutscene = true;
  run(g, 6);
  assert.equal(g.bustedN, 0);
  g.cutscene = false;
  run(g, 2);
  assert.equal(g.bustedN, 1);
});

test('officers left far behind go back to their beat, and only so many leave their jeeps', () => {
  const g = policeGame(), p = g.police;
  p.setLevel(3);
  const far = { h: { x: 300, z: 0 }, state: 'fight', keep: true }, near = { h: { x: 3, z: 0 }, state: 'fight', keep: true };
  g.peds.list.push(far, near); p.foot.push(far, near);
  run(g, 1 / 60);
  assert.deepEqual(p.foot, [near]);
  assert.deepEqual([far.keep, far.state], [false, 'walk']);
  // With a full squad on foot, a stuck unit next to the player keeps its officers in.
  for (let i = 0; i < 5; i++) p.foot.push({ h: { x: 2, z: i }, state: 'fight' });
  const u = { v: jeep({ x: 10 }) };
  assert.equal(p._unstick(u), false);
  assert.ok(u.v.driver);
});

// ---------------------------------------------------------------- the rules
function rulesGame() {
  const el = () => ({ addEventListener() {}, hidden: true });
  globalThis.document ??= { getElementById: el, body: { classList: { add() {}, remove() {} } } };
  globalThis.addEventListener ??= () => {};
  const g = policeGame();
  Object.assign(g, {
    big: [], helps: [],
    city: { places: [], densityAt: () => 0.5 },
    audio: { sfx(name, k = 1) { if (name === 'explosion') g.boom = k; } },
    camera: { addShake() {} },
    save: { cash: 1000, stat() {}, flush() {}, set(k, v) { this.data[k] = v; }, data: { stats: { playTime: 0, distance: 0 } } },
    effects: { sparks() {}, explosion() {}, fire() {}, smoke() {}, dust() {}, skid() {}, tyreSmoke() {}, splash() {} },
    missions: { active: null, fail(reason) { g.hud.big('MISSION FAILED', reason); g.missions.active = null; } },
    jobs: { update() {}, stop() {} },
    input: { pressed: () => false },
  });
  g.hud = { big: t => g.big.push(t), help: m => g.helps.push(m), toast() {}, cashChange() {} };
  g.peds.forEachNear = (x, z, r, fn) => { for (const p of g.peds.list) if (Math.hypot(p.h.x - x, p.h.z - z) < r) fn(p); };
  g.peds.knock = (p, vx, vz) => { p.knocked = Math.hypot(vx, vz); };
  Object.assign(g.vehicles, { wake(v) { v.kinematic = false; } });
  Object.assign(g.player, { health: 100, maxHealth: 100, human: {}, damage() { g.hurt = true; }, knockDown() {}, leaveVehicle() {}, teleport() {}, heal() {} });
  installRules(g);
  return g;
}

test('one punch on an officer is one crime, and fighting the story\'s own enemies is none', () => {
  const g = rulesGame();
  // Like Peds.punchFrom, which tells onPedHurt about the same punch.
  const punch = who => { g.peds.punchFrom = () => { g.onPedHurt?.(who, 'punch'); return who; }; g.playerPunch(g.player); };
  punch({ cop: true, h: { x: 0, z: 1 } });
  assert.equal(g.police.level, 2);
  g.police.clear();
  for (let i = 0; i < 20; i++) punch({ mission: true, h: { x: 0, z: 1 } });
  assert.equal(g.police.heat, 0);
  assert.equal(g.police.pending.length, 0);
});

test('being rammed by a police jeep is no crime; ramming one is', () => {
  const g = rulesGame();
  const mine = jeep({ type: 'hatch', role: 'player', driver: null });
  const unit = jeep({ z: 4, vz: -9 });
  for (let i = 0; i < 4; i++) { g.time += 2; g.vehicles.onImpact(unit, 9, mine); g.vehicles.onImpact(mine, 9, unit); }
  assert.equal(g.police.level, 0, 'four rams by the police');
  unit.vz = 0; mine.vz = 9;
  g.time += 2; g.vehicles.onImpact(unit, 9, mine);
  g.time += 0.3; g.vehicles.onImpact(unit, 2, mine); // the bounce of the same shunt
  assert.equal(g.police.level, 1);
});

test('a blast wrecks or sets alight the cars it ruins, throws people hardest close in, and stays on its level', () => {
  const g = rulesGame();
  g.player.x = 100;
  const boom = jeep({ type: 'hatch', role: 'abandoned', wrecked: true, explodeAt: 1, rammedT: 0, driver: null });
  const ruined = jeep({ type: 'hatch', role: 'traffic', x: 2, health: 300, driver: null });
  const smoking = jeep({ type: 'hatch', role: 'traffic', x: 5, health: 450, driver: null });
  const fresh = jeep({ type: 'hatch', role: 'traffic', x: -3, health: 1000, driver: null });
  const above = jeep({ type: 'hatch', role: 'traffic', z: 2, y: 6.4, health: 300, driver: null });
  const witness = jeep({ x: 20, role: 'police-idle' });
  g.vehicles.list.push(boom, ruined, smoking, fresh, above, witness);
  const close = { h: { x: 1, z: 0, y: 0 } }, farther = { h: { x: 0, z: 7, y: 0 } }, underneath = { h: { x: 0, z: -1, y: -6.4 } };
  g.peds.list.push(close, farther, underneath);
  g.time = 2;
  g.hooks[0](1 / 60);
  assert.ok(boom.exploded);
  assert.ok(ruined.wrecked && ruined.health === 0 && ruined.explodeAt > g.time, 'wrecked, and it will blow up in turn');
  assert.ok(smoking.onFire && !smoking.wrecked);
  assert.ok(!fresh.onFire && !fresh.wrecked && fresh.health < 1000);
  assert.equal(above.health, 300, 'a blast on the street does not reach the flyover');
  assert.ok(close.knocked > farther.knocked);
  assert.equal(underneath.knocked, undefined);
  assert.ok(g.boom < 0.3, 'a bang 100 m off is quieter');
  assert.equal(g.police.level, 1, 'blowing up a car you rammed is a crime');
});

test('a car you never rammed blowing up is not your crime', () => {
  const g = rulesGame();
  g.player.x = 100;
  g.vehicles.list.push(jeep({ type: 'hatch', role: 'abandoned', wrecked: true, explodeAt: 1, driver: null }), jeep({ x: 20, role: 'police-idle' }));
  g.time = 2;
  g.hooks[0](1 / 60);
  assert.equal(g.police.level, 0);
});

test("the story's own cars are part of the job, even once the chase has let them go", () => {
  const g = rulesGame();
  g.player.x = 100;
  // c10: the last ram ends the chase, which marks Mama's SUV 'abandoned' and leaves it burning;
  // the player's car, still rolling, shunts it again, and it blows up while the fight goes on.
  const ramAndBlow = car => {
    const mine = jeep({ type: 'hatch', role: 'player', driver: null, vz: 9 });
    g.time += 2; g.vehicles.onImpact(car, 9, mine);
    car.wrecked = true; car.explodeAt = g.time + 1;
    g.time += 2; g.hooks[0](1 / 60);
    assert.ok(car.exploded);
  };
  g.vehicles.list.push(jeep({ x: 20, role: 'police-idle' }));
  const suv = jeep({ type: 'suv', role: 'abandoned', z: 4, health: 200, driver: null });
  g.vehicles.list.push(suv);
  g.missions.active = { ent: { mamaCar: suv } };
  ramAndBlow(suv);
  assert.equal(g.police.level, 0);
  assert.equal(g.police.pending.length, 0);
  // Once the mission is over, an abandoned car is anyone's, and wrecking one is a crime again.
  g.missions.active = null;
  const left = jeep({ type: 'suv', role: 'abandoned', z: 4, health: 200, driver: null });
  g.vehicles.list.push(left);
  ramAndBlow(left);
  assert.equal(g.police.level, 1);
});

test('WASTED in a mission shows its card, then MISSION FAILED after the respawn; the fee is what was paid', () => {
  const g = rulesGame();
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    g.missions.active = {};
    g.save.cash = 50;
    g.wasted();
    assert.equal(g.big.at(-1), 'WASTED');
    mock.timers.tick(4200);
    assert.equal(g.big.at(-1), 'MISSION FAILED');
    assert.match(g.helps.at(-1), /₹50 for the stitches/);
    g.busted();
    mock.timers.tick(4000);
    assert.equal(g.big.at(-1), 'BUSTED', 'no mission, no second card');
    assert.match(g.helps.at(-1), /with a warning/);
  } finally { mock.timers.reset(); }
});

test('a frozen player is not beaten up during a cutscene', () => {
  const g = rulesGame();
  g.cutscene = true;
  g.pedAttacks({ h: { x: 0.5, z: 0, yaw: 0 }, cop: true }, 7);
  assert.ok(!g.hurt);
  g.cutscene = false;
  g.pedAttacks({ h: { x: 0.5, z: 0, yaw: 0 }, cop: true }, 7);
  assert.ok(g.hurt);
});

test('the autosave keeps play time, distance and one-time tips, even on a quiet drive where nothing else changes', async () => {
  const { Save } = await import('../src/game/save.js');
  const store = new Map();
  globalThis.localStorage = { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
  const g = rulesGame();
  g.save = new Save();
  g.onWantedChange(1, 0); // the "you are wanted" tip, shown once ever
  g.player.vehicle = jeep({ type: 'hatch', role: 'player', driver: null, vz: 10 });
  for (let t = 0; t < 10.5; t += 1 / 60) g.hooks[0](1 / 60);
  const saved = JSON.parse(store.get('gta-nanded-save-v2') ?? 'null');
  assert.ok(saved, 'the 10 s autosave wrote, though no cash or crime changed');
  assert.ok(saved.stats.playTime > 9.9 && saved.stats.distance > 99, `played ${saved.stats.playTime} s, drove ${saved.stats.distance} m`);
  assert.equal(saved.seenWantedHelp, true);
  assert.equal(saved.cash, 200);
});

test('a witness calls a crime in where it happened: the search starts there, with the player unseen', () => {
  const g = policeGame(), p = g.police;
  g.colliders.raycast = () => 0; // walls between any unit and the player
  g.player.x = 150; // drove off before the call came in
  p.pending.push({ t: 0.01, heat: 1, x: 10, z: 0 });
  run(g, 0.05);
  assert.equal(p.level, 1);
  assert.deepEqual([p.lastSeen.x, p.lastSeen.z, p.seen], [10, 0, false], 'searching the crime scene, not the player');
  // Searching for the player, out of sight, nearly lost them: a carjack called in 300 m away is the
  // freshest word the police have. The search moves there and starts again, with the second star.
  p.lastSeen.x = 120; p.unseenT = 6;
  p.pending.push({ t: 0.01, heat: 1, x: 450, z: 0 });
  run(g, 0.05);
  assert.equal(p.level, 2);
  assert.deepEqual([p.lastSeen.x, p.seen], [450, false]);
  assert.ok(p.unseenT < 0.1, 'the search starts again');
  run(g, 3);
  assert.equal(p.level, 2, 'not lost again a moment later');
  // With the player in sight, a call adds heat but doesn't send the hunt back to the crime.
  p.seen = true; p.lastSeen.x = 150; p.unseenT = 0;
  p.addHeat(1, 10, 0, true);
  assert.deepEqual([p.level, p.lastSeen.x, p.seen], [3, 150, true]);
  // An officer who sees a crime knows where the player is.
  p.clear();
  p.report('hitCop', 150, 0, { cop: true });
  assert.deepEqual([p.lastSeen.x, p.seen], [150, true]);
  // Lost them: the next call starts a new hunt at its crime, whatever the last hunt last saw.
  p.setLevel(0);
  p.addHeat(1, 10, 0, true);
  assert.deepEqual([p.level, p.lastSeen.x, p.seen], [1, 10, false]);
});

test('a witness still calling a crime in is too late once the player steps into a mission marker', () => {
  const g = policeGame(), p = g.police;
  const def = { id: 'c1', start: { x: 0, z: 0 } };
  g.missions = { active: null, cooldown: 0, available: () => [def], startPoint: d => d.start };
  const call = () => { p.clear(); p.pending.push({ t: 3, heat: 1, x: 40, z: 0 }); };
  // Walked up to it: the mission starts (missions.js waits for no call), and no star lands there.
  call();
  g.player.x = 30; run(g, 1);
  assert.equal(p.pending.length, 1, 'still calling while the player is on the way');
  g.player.x = 1; run(g, 6);
  assert.deepEqual([p.pending.length, p.level], [0, 0]);
  // Driven across it without stopping, it is not started: the call comes in.
  call();
  g.player.vehicle = { vx: 12, vz: 0 }; run(g, 6);
  assert.equal(p.level, 1);
  g.player.vehicle = null;
  // Nor once a mission is under way: a crime in it is a crime.
  call();
  g.missions.active = {}; run(g, 6);
  assert.equal(p.level, 1);
});

test('no police jeep past its instance slots: a unit waits until one is towed', () => {
  const g = policeGame(), p = g.police;
  g.vehicles.meshes = { police: { cap: 3 } };
  g.net = { nearest: () => ({ x: 120, z: 0, dx: 1, dz: 0, road: 0 }), route: () => null, raised: [], width: [8] };
  g.vehicles.spawn = (type, x, z, heading, { role }) => { const v = jeep({ type, role, x, z, heading }); g.vehicles.list.push(v); return v; };
  p.level = 1;
  // A wreck, a jeep its officers got out of, and the one the player stole.
  const wreck = jeep({ x: 40, role: 'abandoned', wrecked: true });
  g.vehicles.list.push(wreck, jeep({ x: 30, role: 'police-parked', driver: null }), jeep({ role: 'player' }));
  assert.equal(p._spawnUnit(g.player), null);
  assert.equal(g.vehicles.list.length, 3);
  g.vehicles.remove(wreck);
  assert.ok(p._spawnUnit(g.player), 'a slot is free again');
  assert.equal(g.vehicles.list.filter(v => v.type === 'police').length, 3);
});

test('pulling a driver out at a petrol pump or a stand is a carjack; the story\'s or a race\'s own car is not', () => {
  const g = rulesGame();
  Object.assign(g.vehicles, { ejectDriver(v) { const h = v.driver; v.driver = null; return h; }, doorWorld: v => ({ x: v.x - 1.4, z: v.z }) });
  Object.assign(g.peds, { adoptEjected() {}, _make: h => ({ h }) });
  g.vehicles.list.push(jeep({ x: 6, role: 'police-idle' })); // an officer looking on
  const car = role => jeep({ type: 'hatch', role, heading: 0, driver: {} });
  const jack = v => { g.police.clear(); g.carjack(v, g.player); return g.police.level; };
  assert.equal(jack(car('parked')), 1, 'a hatch filling up at a pump, an auto at the station stand');
  assert.equal(jack(car('traffic')), 1);
  assert.equal(jack(car('abandoned')), 1, 'a car left on the street with its driver in it');
  assert.equal(jack(car('mission')), 0, 'the man you chase');
  assert.equal(jack(car('rival')), 0, 'a race rival');
  const target = car('abandoned');
  g.missions.active = { ent: { target } };
  assert.equal(jack(target), 0, 'a chase target the chase has let go, while its mission lasts');
});

test('a cheat car waits parked, is towed once left far behind untaken, and none past what can be drawn', () => {
  const g = rulesGame();
  g.net = { nearest: () => ({ x: 8, z: 0, dx: 0, dz: 1, road: 0 }), oneway: [0], raised: [] };
  g.player.heading = 0;
  g.vehicles.meshes = { auto: { cap: 2 } };
  g.vehicles.spawn = (type, x, z, heading, { role, driver }) => { const v = jeep({ type, role, x, z, heading, driver: driver ? {} : null }); g.vehicles.list.push(v); return v; };
  g.vehicles.remove = v => { g.vehicles.list.splice(g.vehicles.list.indexOf(v), 1); v.removed = true; };
  assert.ok(g.cheat('RICKSHAW'));
  const [auto] = g.vehicles.list;
  assert.deepEqual([auto.type, auto.role, auto.driver, auto.kinematic], ['auto', 'parked', null, true]);
  assert.ok(g.cheat('RICKSHAW'));
  assert.equal(g.cheat('RICKSHAW'), null, 'a third auto would be invisible');
  assert.equal(g.vehicles.list.length, 2);
  // The player rides off in one and leaves it (an abandoned car now: traffic tows those); the other
  // stays put while they're about, and is towed once they're well away.
  const [, taken] = g.vehicles.list;
  taken.role = 'player';
  g.hooks[0](1 / 60);
  taken.role = 'abandoned';
  g.player.x = 200; g.hooks[0](1 / 60);
  assert.equal(g.vehicles.list.length, 2);
  g.player.x = 400; g.hooks[0](1 / 60);
  assert.deepEqual(g.vehicles.list, [taken]);
});

test('a jacked car\'s passengers get out on their own side, clear of it as it rolls on', () => {
  const g = rulesGame();
  const hw = 0.7, hd = 1.4;
  Object.assign(g.vehicles, { ejectDriver(v) { const h = v.driver; v.driver = null; return h; }, doorWorld: v => ({ x: v.x - (hw + 0.55) * Math.cos(v.heading), z: v.z + (hw + 0.55) * Math.sin(v.heading) }) });
  Object.assign(g.peds, { adoptEjected() {}, _make: (h, x, z) => { const p = { h, x, z }; g.peds.list.push(p); return p; } });
  g.colliders.blocked = () => false;
  for (const heading of [0, 0.8, 2, -2.6]) {
    g.peds.list = [];
    // An auto still rolling at 8 m/s with two in the back (vehicle-models.js: [x left, y, z ahead]).
    const auto = jeep({ type: 'auto', role: 'traffic', x: 5, z: -3, heading, hw, hd, vx: Math.sin(heading) * 8, vz: Math.cos(heading) * 8, driver: {}, passengers: [{}, {}], model: { passengers: [[0.3, 0.88, -0.75], [-0.3, 0.88, -0.75]] } });
    g.carjack(auto, g.player);
    const c = Math.cos(heading), s = Math.sin(heading);
    const sides = g.peds.list.map(({ h }) => {
      const dx = h.x - auto.x, dz = h.z - auto.z, lx = dx * c - dz * s, lz = dx * s + dz * c;
      assert.ok(Math.abs(lx) > hw + 0.3 || Math.abs(lz) > hd + 0.3, 'outside the body (Peds: run over inside hw + 0.3, hd + 0.3)');
      assert.ok(lz < hd, 'not in its path');
      return Math.sign(lx);
    });
    assert.deepEqual(sides, [1, -1], 'each out of their own side');
  }
});

test('a jacked two-wheeler\'s pillion gets off the left, behind the rider, not into the traffic lane', () => {
  const g = rulesGame();
  // vehicles.js doorWorld: a two-wheeler is got on and off from its left (local +x), the stand side.
  const hw = 0.36, hd = 1, seatZ = -0.28;
  const local = (v, lx, lz) => ({ x: v.x + lx * Math.cos(v.heading) + lz * Math.sin(v.heading), z: v.z - lx * Math.sin(v.heading) + lz * Math.cos(v.heading) });
  Object.assign(g.vehicles, { ejectDriver(v) { const h = v.driver; v.driver = null; return h; }, doorWorld: v => local(v, hw + 0.5, seatZ) });
  Object.assign(g.peds, { adoptEjected() {}, _make: (h, x, z) => { const p = { h, x, z }; g.peds.list.push(p); return p; } });
  let wall = false;
  g.colliders.blocked = () => wall;
  const jack = heading => {
    g.peds.list = [];
    const bike = jeep({ type: 'bike', role: 'traffic', x: 5, z: -3, heading, hw, hd, spec: { two: true }, driver: {}, passengers: [{}], model: { seat: { x: 0, z: seatZ }, passengers: [[0, 0.86, -0.62]] } });
    g.carjack(bike, g.player);
    const [{ h }] = g.peds.list, c = Math.cos(heading), s = Math.sin(heading), dx = h.x - bike.x, dz = h.z - bike.z;
    return [dx * c - dz * s, dx * s + dz * c];
  };
  for (const heading of [0, 1.1, -2.4]) {
    const [lx, lz] = jack(heading);
    assert.ok(lx > hw + 0.3, 'on the left, clear of the bike');
    assert.ok(lz < seatZ - 0.4, 'a step behind the rider, who is put down at the door');
  }
  wall = true;
  const [lx, lz] = jack(0.5);
  assert.ok(Math.abs(lx) < 0.01 && lz < -hd, 'against a wall, behind the bike');
});
