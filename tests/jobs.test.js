import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Jobs } from '../src/game/jobs.js';
import { PROP } from '../src/world/citygen.js';

/** Just enough game for the side jobs, with the player in an auto at the origin. */
function fakeGame() {
  const hud = { big() {}, objective() {}, setTimer() {}, subtitle() {}, help() {}, toast() {}, route: null, blipList: [] };
  const auto = { id: 1, type: 'auto', x: 0, z: 0, vx: 0, vz: 0, health: 1000, passengers: [] };
  return {
    time: 0, hud, controls: new Map(), city: { places: [] }, input: { mode: 'keyboard', pressed: () => false }, settings: {},
    player: { pos: auto, x: 0, z: 0, vehicle: auto, state: 'driving' },
    missions: { active: null }, police: { level: 0 }, effects: { markers: { set() {} } },
    save: { cash: 0, stat() {}, data: { stamps: [], records: {} } }, addCash() {},
    net: { nearest: () => null, route: () => null, raised: [], bridge: [], width: [6], kerbSide: () => 1 },
    colliders: { blocked: () => false },
    humans: { add: (outfit, x, z) => ({ x, z, outfit }), remove() {} },
    peds: { list: [], outfitFor: () => ({}), _make(h) { const p = { h }; this.list.push(p); return p; }, remove() {} },
    vehicles: { list: [auto], addPassenger: () => null },
  };
}

test('a fare search that finds nobody tries again next frame, and a fare is never paid twice', () => {
  const g = fakeGame();
  let fares = 0;
  g.addCash = () => fares++;
  const jobs = new Jobs(g);
  jobs._startTaxi();
  assert.doesNotThrow(() => jobs.update(1 / 60), 'nobody at the kerb yet');
  assert.equal(jobs.active.stage, 'search');
  // At the drop-off with nobody to pick up next: paid once, then searching.
  Object.assign(jobs.active, { stage: 'ride', target: { x: 0, z: 0 }, left: 10, limit: 20, routeLen: 300, startHealth: 1000 });
  for (let i = 0; i < 5; i++) jobs.update(1 / 60);
  assert.equal(fares, 1);
  // Somebody turns up.
  g.net.nearest = () => ({ x: 100, z: 0, dx: 0, dz: 1, road: 0 });
  jobs.update(1 / 60);
  assert.equal(jobs.active.stage, 'pickup');
});

test('ending a job takes its target off the radar and lets its race rivals be towed', () => {
  const g = fakeGame();
  const jobs = new Jobs(g);
  const rival = { role: 'rival', keep: true, raceDriver: {} }, taken = { role: 'player', keep: true, raceDriver: {} };
  jobs.active = { kind: 'race', label: 'Race', rivals: [rival, taken] };
  g.hud.blipList = [{ x: 10, z: 10, color: '#7edac8' }];
  jobs.stop(true);
  assert.deepEqual(g.hud.blipList, []);
  assert.deepEqual([rival.role, rival.keep, rival.raceDriver], ['abandoned', false, null]);
  assert.deepEqual([taken.role, taken.keep], ['player', false], 'the rival you drive stays yours');
});

test('the job GPS line is worked out every 1.2 s of game time, whatever the frame rate', () => {
  const routes = fps => {
    const g = fakeGame(), jobs = new Jobs(g);
    let n = 0;
    g.net.route = () => { n++; return { points: [] }; };
    for (let i = 0; i < 4 * fps; i++) { g.time += 1 / fps; jobs._markersAndRoute({ x: 50, z: 0 }); }
    return n;
  };
  assert.equal(routes(32), 4);
  assert.equal(routes(128), 4);
});

test('a snack stall just across a chunk border is still offered', async () => {
  const { world } = await import('./helpers.js');
  const { city } = world();
  const props = city.props;
  let i = 0;
  // A stall a metre or so east of a chunk's west edge; stand 2 m west of it, in the next chunk.
  while (i < props.count && !((props.kind[i] === PROP.STALL || props.kind[i] === PROP.CART) && props.x[i] - Math.floor(props.x[i] / 192) * 192 < 1.5)) i++;
  assert.ok(i < props.count, 'a stall by a chunk border');
  const g = { ...fakeGame(), city };
  Object.assign(g.player, { x: props.x[i] - 2, z: props.z[i], state: 'foot', vehicle: null });
  assert.equal(Math.floor(g.player.x / 192) === Math.floor(props.x[i] / 192), false);
  const jobs = new Jobs(g);
  assert.notEqual(jobs._nearStall(), null);
  assert.match(jobs.contextAction().label, /^Buy /);
});

test("a race checkpoint up on a flyover stands on its deck, where the GPS leads: Station to Airport's first", async () => {
  const { world } = await import('./helpers.js');
  const { net } = world();
  const g = { ...fakeGame(), net };
  let shown = [];
  g.effects.markers.set = m => { shown = m; };
  g.vehicles.spawn = (type, x, z) => ({ type, x, z, spec: { top: 30 } });
  g.DynamicDriver = class { setPath() {} control() { return {}; } };
  const jobs = new Jobs(g);
  const race = jobs.races.find(r => r.id === 'race-airport');
  Object.assign(g.player.vehicle, { x: race.start.x, z: race.start.z, heading: 0 });
  jobs._startRace(race);
  const ys = jobs.active.ys;
  assert.ok(ys[0] > 5, `the first checkpoint is ${ys[0].toFixed(1)} m up, on the Hingoli Gate flyover`);
  assert.deepEqual(ys.slice(1), [0, 0], 'the others are on the street');
  jobs.update(4); // past the countdown
  assert.equal(shown[0].y, ys[0]);
});

test('a race starts with the siren off: on a phone its button waits for STOP JOB to go, so it could not be stopped', () => {
  const g = fakeGame();
  Object.assign(g.player.vehicle, { type: 'police', heading: 0, sirenOn: true });
  const jobs = new Jobs(g);
  const race = jobs.races[0];
  Object.assign(g.player.vehicle, { x: race.start.x, z: race.start.z });
  jobs._startRace(race);
  assert.equal(jobs.active.kind, 'race');
  assert.equal(g.player.vehicle.sirenOn, false);
});
