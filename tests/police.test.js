import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Police } from '../src/game/police.js';
import { installRules } from '../src/game/rules.js';
import { Peds } from '../src/actors/peds.js';

function game(onFoot) {
  const g = {
    controls: new Map(), city: { places: [] },
    player: { x: 0, z: 0, pos: { x: 0, z: 0 }, vehicle: null },
    vehicles: {
      list: [], doorWorld: v => ({ x: v.x - 1.5, z: v.z }),
      ejectDriver(v) { const h = v.driver; v.driver = null; return h; },
    },
    peds: { list: [], seed: 1, _make: Peds.prototype._make, adoptEjected() {} },
    save: { stat() {}, data: { seenWantedHelp: true } }, audio: { sfx() {} },
  };
  g.police = new Police(g);
  g.police.level = 2; g.police.seen = true;
  for (let i = 0; i < onFoot; i++) g.police.foot.push(g.peds._make({ x: 2, z: i }, 2, i));
  return g;
}

function unit(g) {
  const human = () => ({ x: 10, z: 0, y: 1, pose: 'sit' });
  const v = { type: 'police', role: 'police', keep: true, x: 10, z: 0, heading: 0, hw: 1, hd: 2,
    vx: 0, vz: 0, driver: human(), passengers: [human()], model: { passengers: [[0.5, 1, 0]] } };
  const u = { v, exitT: 1, driver: { control: () => ({ brake: 1 }) } };
  g.vehicles.list.push(v); g.police.units.push(u); g.controls.set(v, { brake: 1 });
  return u;
}

for (const mode of ['stopped', 'stuck']) test(`${mode} jeep sends only one officer into the last foot slot, then the driver when room opens`, () => {
  const g = game(5), u = unit(g), driver = u.v.driver, passenger = u.v.passengers[0];
  const dismount = () => mode === 'stopped' ? g.police._driveUnit(u, 0.1, g.player.pos) : g.police._unstick(u);
  dismount();
  assert.equal(g.police.foot.length, 6);
  assert.equal(g.peds.list.length, 6);
  assert.equal(g.police.foot.at(-1).h, passenger);
  assert.equal(u.v.driver, driver);
  assert.equal(driver.pose, 'sit');
  assert.deepEqual(u.v.passengers, []);
  assert.ok(g.police.units.includes(u));
  assert.ok(g.controls.has(u.v));
  dismount();
  assert.equal(g.police.foot.length, 6, 'a full squad leaves the driver seated');
  g.police.foot.shift();
  dismount();
  assert.equal(g.police.foot.length, 6);
  assert.equal(g.police.foot.at(-1).h, driver);
  assert.equal(u.v.driver, null);
  assert.equal(u.v.role, 'police-parked');
  assert.equal(g.police.units.length, 0);
  assert.equal(g.controls.has(u.v), false);
});

test('a full squad leaves every jeep occupant untouched even if dismount is called directly', () => {
  const g = game(6), u = unit(g), before = structuredClone(u.v);
  g.police._dismount(u);
  assert.equal(g.police.foot.length, 6);
  assert.equal(g.peds.list.length, 6);
  assert.deepEqual(u.v, before);
  assert.ok(g.police.units.includes(u));
});

for (const count of [5, 6]) test(`carjacking with ${count} officers on foot respects the cap and retains any passenger without a slot`, () => {
  globalThis.addEventListener ??= () => {};
  globalThis.document ??= { getElementById: () => ({ addEventListener() {} }) };
  const g = game(count), u = unit(g), passenger = u.v.passengers[0], before = { ...passenger };
  installRules(g);
  g.carjack(u.v, g.player);
  assert.equal(g.police.foot.length, 6);
  assert.equal(g.peds.list.length, 6);
  if (count === 6) {
    assert.deepEqual(u.v.passengers, [passenger]);
    assert.deepEqual(passenger, before, 'the retained passenger keeps its seated pose and position');
  } else {
    assert.deepEqual(u.v.passengers, []);
    const cop = g.police.foot.at(-1);
    assert.equal(cop.h, passenger);
    assert.equal(cop.state, 'fight');
    assert.ok(cop.cop && cop.keep);
    assert.ok(passenger.x > u.v.x + u.v.hw, 'the officer exits clear of the passenger side');
  }
});
