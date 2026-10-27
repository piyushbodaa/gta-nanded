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
    save: { cash: 1000, stat() {}, flush() {}, data: { stats: { playTime: 0, distance: 0 } } },
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
