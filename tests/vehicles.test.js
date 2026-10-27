import { test } from 'node:test';
import assert from 'node:assert/strict';
import { world } from './helpers.js';
import { Vehicles } from '../src/actors/vehicles.js';
import { vehicleModel } from '../src/actors/vehicle-models.js';
import { createBody, speedOf, stepBody } from '../src/actors/vehicle-physics.js';
import { Player } from '../src/actors/player.js';
import { Game } from '../src/game/game.js';
import { Colliders } from '../src/world/colliders.js';
import { DECK_H } from '../src/world/roadnet.js';

// A flat, empty city: vehicles meet only each other.
const FLAT = {
  groundHeight: () => 0, pavementAt: () => 0,
  riverDistance: (x, z, o = {}) => { o.d = 100; return o; },
  net: { surfaceAt: () => 0, nearest: () => null, raised: [] },
  bumps: { heightAt: () => 0, holeAt: () => null },
};
const OPEN = { boxContact: () => null, resolveCircle: () => false, blocked: () => false };

function humans() {
  return { list: [], add(outfit, x, z) { const h = { outfit, x, y: 0, z, pose: 'idle', t: 0 }; this.list.push(h); return h; }, remove(h) { const i = this.list.indexOf(h); if (i >= 0) this.list.splice(i, 1); } };
}
/** Vehicles without the renderer (no canvas in node). */
function vehicles(city = FLAT, colliders = OPEN) {
  const V = Object.assign(Object.create(Vehicles.prototype), { list: [], humans: humans(), city, colliders, _contact: {}, time: 0, impacts: 0 });
  V.onImpact = () => V.impacts++;
  return V;
}
let nextId = 1;
function body(V, type, x, z, heading, { kinematic = true, role = 'traffic', speed = 0 } = {}) {
  const v = Object.assign(createBody(type, x, z, heading), { id: nextId++, role, kinematic, passengers: [], driver: null, model: vehicleModel(type), ai: kinematic ? {} : null });
  v.vx = Math.sin(heading) * speed; v.vz = Math.cos(heading) * speed;
  V.list.push(v);
  return v;
}
/** One frame as the game runs it: lane traffic is moved first, then physics. */
function frame(V, dt, controls = new Map()) {
  for (const v of V.list) if (v.kinematic && v.ai) { v.x += v.vx * dt; v.z += v.vz * dt; }
  V.step(dt, controls);
}

test('a crash meets traffic with its real mass: a hatch shoves a scooter on, a truck shrugs off a bike', () => {
  let V = vehicles();
  const hatch = body(V, 'hatch', 0, 0, 0, { kinematic: false, role: 'player', speed: 15 });
  const scooter = body(V, 'scooter', 0, 3.2, Math.PI, { speed: 10 });
  for (let i = 0; i < 30; i++) frame(V, 1 / 60);
  assert.ok(!scooter.kinematic, 'the scooter is knocked out of its lane');
  assert.ok(hatch.vz > 8, `the hatch carries on (${hatch.vz.toFixed(1)} m/s), not thrown back`);
  assert.ok(scooter.vz > hatch.vz, 'the scooter is pushed ahead of it');
  assert.equal(V.impacts, 2, 'one crash, not a string of them');
  V = vehicles();
  const truck = body(V, 'truck', 0, 0, 0, { kinematic: false, role: 'player', speed: 18 });
  body(V, 'bike', 0, 5.2, Math.PI, { speed: 10 });
  for (let i = 0; i < 30; i++) frame(V, 1 / 60);
  assert.ok(truck.vz > 15, `the truck barely slows (${truck.vz.toFixed(1)} m/s)`);
});

test('a brush leaves parked and lane traffic where it is', () => {
  const V = vehicles();
  const hatch = body(V, 'hatch', 0, 0, 0, { kinematic: false, role: 'player', speed: 1 });
  const bike = body(V, 'bike', 0, 3, Math.PI / 2, { role: 'parked' });
  bike.ai = null;
  for (let i = 0; i < 120; i++) frame(V, 1 / 60);
  assert.ok(bike.kinematic, 'still parked');
  assert.equal(bike.x, 0); assert.equal(bike.z, 3);
  assert.ok(hatch.z < 3 - bike.hw - hatch.hd + 0.05, 'the car stops against it');
});

test('vehicles meeting head-on crash even at a slow phone\'s 20 fps, never slip through each other', () => {
  for (const [a, b] of [['bike', 'bike'], ['hatch', 'bike'], ['hatch', 'hatch']]) {
    for (const fps of [20, 30, 60]) {
      for (let k = 0; k < 24; k++) {
        const V = vehicles();
        const me = body(V, a, 0.1 * (k % 4), 0, 0, { kinematic: false, role: 'player', speed: 33 });
        body(V, b, 0, 20 + (k / 24) * (49 / fps), Math.PI, { speed: 16 });
        const ctl = new Map([[me, { throttle: 1, brake: 0, steer: 0 }]]);
        for (let f = 0; f < fps; f++) frame(V, 1 / fps, ctl);
        assert.ok(V.impacts > 0, `${a} into ${b} at ${fps} fps, phase ${k}: no crash`);
      }
    }
  }
});

test('extra substeps only when a pair is on a collision course, not for traffic passing in its lane', () => {
  const V = vehicles();
  body(V, 'hatch', 0, 0, 0, { kinematic: false, role: 'player', speed: 30 });
  const other = body(V, 'hatch', -2.6, 5, Math.PI, { speed: 15 }); // oncoming, in its own lane, about to pass
  assert.equal(V._nearPairs(1 / 20), 2);
  other.x = 0.5; // the same line: head-on, meeting this frame
  assert.ok(V._nearPairs(1 / 20) > 4);
  other.z = 30; // still far off
  assert.equal(V._nearPairs(1 / 20), 2);
});

test('a vehicle woken again on a speed breaker, or put down on one, rolls over it instead of flying', () => {
  const hump = { ...FLAT, bumps: { heightAt: (x, z) => (Math.abs(z) < 1.1 ? 0.055 * (1 + Math.cos((Math.PI * z) / 1.1)) : 0), holeAt: () => null } };
  for (const fps of [60, 30]) {
    const V = vehicles(hump);
    const bike = body(V, 'bike', 0, -30, 0, { kinematic: false });
    V.step(1 / fps, new Map()); // crashed once on the flat
    bike.kinematic = true; // back in its lane, it crawls up onto the hump
    for (let i = 0; i < 20; i++) { bike.z = -30 + (29.5 * (i + 1)) / 20; V.step(1 / fps, new Map()); }
    bike.vz = 3; bike.kinematic = false; // rear-ended there
    let peak = 0;
    for (let i = 0; i < fps; i++) { V.step(1 / fps, new Map()); peak = Math.max(peak, bike.hop); }
    assert.ok(peak < 0.2, `re-woken at ${fps} fps: ${peak.toFixed(2)} m up`);
  }
  // A police jeep unstuck out of sight onto a hump.
  const V = vehicles(hump);
  const jeep = body(V, 'police', 0, -30, 0, { kinematic: false, role: 'police' });
  for (let i = 0; i < 10; i++) V.step(1 / 60, new Map());
  jeep.z = 1.14; jeep.vz = 0;
  let peak = 0;
  for (let i = 0; i < 60; i++) { V.step(1 / 60, new Map()); peak = Math.max(peak, jeep.hop); }
  assert.ok(peak < 0.2, `put down on a hump: ${peak.toFixed(2)} m up`);
});

test('knocked back faster than it can reverse, a car skids down to that instead of stopping dead', () => {
  const v = createBody('hatch', 0, 0, 0);
  v.vz = -16;
  stepBody(v, { throttle: 0, brake: 0, steer: 0 }, 1 / 120);
  assert.ok(v.vz < -15, `${v.vz.toFixed(1)} m/s after one step`);
  for (let i = 0; i < 240; i++) stepBody(v, { throttle: 0, brake: 0, steer: 0 }, 1 / 120);
  assert.ok(v.vz >= -9 * 1.2 - 1e-6, 'and within reverse speed after a while');
});

test('ramming a car makes its wreck the player\'s crime', () => {
  const V = vehicles();
  const mine = body(V, 'hatch', 0, 0, 0, { kinematic: false, role: 'player' });
  const theirs = body(V, 'sedan', 0, 10, 0);
  V._impact(theirs, 12, null);
  assert.equal(theirs.lastHitBy, undefined, 'a wall is nobody\'s crime');
  V._impact(theirs, 12, mine);
  assert.equal(theirs.lastHitBy, 'player');
});

test('a vehicle taken away under the player leaves them standing, still in the world', () => {
  const g = fakeGame();
  const P = new Player(g, 0, 0, 0);
  const v = g.vehicles.spawn('scooter', 0, 0, 0, { role: 'traffic' });
  P.enterVehicle(v);
  g.vehicles.remove(v);
  assert.ok(g.humans.list.includes(P.human), 'the player\'s body is kept');
  P.update(1 / 60, still());
  assert.equal(P.vehicle, null);
  assert.equal(P.state, 'foot');
});

test('WASTED or BUSTED at the wheel: the car brakes to a stop and the body stays in its seat', () => {
  const g = fakeGame();
  const P = new Player(g, 0, 0, 0);
  const v = g.vehicles.spawn('hatch', 0, 0, 0, { role: 'traffic' });
  P.enterVehicle(v);
  const go = still(); go.state.throttle = 1;
  for (let i = 0; i < 120; i++) { P.update(1 / 60, go); g.vehicles.step(1 / 60, new Map([[v, P.controls]])); }
  assert.ok(speedOf(v) > 8);
  P.state = 'dead'; P.human.pose = 'lie'; // as rules.js wasted() leaves them
  for (let i = 0; i < 240; i++) { P.update(1 / 60, go); g.vehicles.step(1 / 60, new Map([[v, P.controls]])); }
  assert.ok(speedOf(v) < 0.5, `still rolling at ${speedOf(v).toFixed(1)} m/s`);
  assert.equal(P.human.pose, 'sit');
  // Pulled out (the car burns, or the respawn): still dead until the respawn.
  P.leaveVehicle(true);
  assert.equal(P.state, 'dead');
  assert.equal(P.human.pose, 'lie');
  assert.ok(Math.hypot(P.human.x - v.x, P.human.z - v.z) > v.hw, 'lying beside the car, not in its seat');
});

test('stepping off a kerb keeps your feet; walking off a ledge is a fall, and the landing hurts', () => {
  for (const [h, hurt] of [[0.2, false], [5, true]]) {
    const city = { ...FLAT, groundHeight: (x, z) => (z < 0 ? h : 0) };
    const g = fakeGame(city);
    const P = new Player(g, 0, -0.4, 0);
    P.y = P.groundY = h;
    const walk = still(); walk.state.moveY = 1;
    let air = false;
    for (let i = 0; i < 90; i++) { P.update(1 / 60, walk); air ||= P.human.air; }
    assert.equal(air, hurt, `${h} m: in the air`);
    assert.equal(P.health < 100, hurt, `${h} m: hurt`);
    assert.ok(P.onGround && P.y === 0);
  }
});

test('getting in gives up on a car that drives off or burns out, instead of teleporting into it', () => {
  const g = fakeGame();
  const P = new Player(g, 0, 0, 0);
  const away = g.vehicles.spawn('hatch', 3, 0, 0, { role: 'traffic' });
  away.kinematic = false;
  P._beginEnter(away);
  for (let i = 0; i < 120; i++) { away.z += 10 / 60; P.update(1 / 60, still()); }
  assert.equal(P.state, 'foot');
  assert.equal(P.vehicle, null);
  const burning = g.vehicles.spawn('hatch', 3, 0, 0, { role: 'parked', driver: false });
  P._beginEnter(burning);
  P.update(1 / 60, still());
  burning.wrecked = true;
  for (let i = 0; i < 120; i++) P.update(1 / 60, still());
  assert.equal(P.vehicle, null);
  burning.wrecked = false;
  P._beginEnter(burning);
  for (let i = 0; i < 120 && !P.vehicle; i++) P.update(1 / 60, still());
  assert.equal(P.vehicle, burning, 'a car standing still is got into');
});

test('two-wheelers are got on and off from the left, the side their stand is on', () => {
  const V = vehicles();
  for (const type of ['bike', 'scooter']) {
    const v = body(V, type, 0, 0, 0); // facing +z: the left is +x
    assert.ok(V.doorWorld(v).x > 0, type);
  }
  const car = body(V, 'sedan', 0, 0, 0);
  assert.ok(V.doorWorld(car).x < 0, 'a car\'s driver gets out on the right (right-hand drive)');
});

test('no car on a flyover deck can be got into from the street below, or the other way round', () => {
  const V = vehicles();
  const deck = body(V, 'sedan', 0, 0, 0); deck.y = DECK_H;
  const g = { vehicles: V, player: { vehicle: null, y: 0 } };
  assert.equal(Game.prototype.nearestEnterable.call(g, 2, 0, 4.2), null, 'from the street');
  g.player.y = DECK_H;
  assert.equal(Game.prototype.nearestEnterable.call(g, 2, 0, 4.2), deck, 'from the deck');
});

test('getting out next to a flyover\'s railing leaves you on the deck, not on the street below', () => {
  const { net, city } = world();
  const colliders = new Colliders(city);
  const V = vehicles(city, colliders);
  const c = net.crossings.find(k => k.h >= DECK_H - 0.01 && !net.oneway[k.road]);
  const p = net.pointAt(c.road, c.s, {}), w = net.width[c.road];
  // Facing against the road's direction, its driver's side (right) is the road's left: against the railing.
  const car = body(V, 'sedan', 0, 0, Math.atan2(p.dx, p.dz) + Math.PI);
  const off = w / 2 - car.hw - 0.05;
  car.x = p.x + p.dz * off; car.z = p.z - p.dx * off; car.y = net.surfaceAt(car.x, car.z, DECK_H);
  const door = V.doorWorld(car);
  assert.ok(Math.max(city.groundHeight(door.x, door.z), net.surfaceAt(door.x, door.z, car.y)) < 1, 'the door is past the deck\'s edge');
  const out = V.exitWorld(car);
  assert.ok(Math.abs(out.y - car.y) < 0.5, `out at ${out.y.toFixed(2)} m, the deck is at ${car.y.toFixed(2)} m`);
  assert.ok(!colliders.blocked(out.x, out.z, 0.34, out.y), 'clear of the railing');
  // Knocked down there, sliding toward the railing: the body lies on the deck, and gets up on it.
  const g = fakeGame(city, colliders);
  const P = new Player(g, out.x, out.z, 0);
  P.y = P.groundY = out.y;
  P.knockDown(p.dz * 6, -p.dx * 6, 1.6);
  for (let i = 0; i < 120; i++) {
    P.update(1 / 60, still());
    assert.ok(Math.abs(P.human.y - car.y) < 0.5, `the body at ${P.human.y.toFixed(2)} m`);
  }
  assert.equal(P.state, 'foot');
  assert.ok(Math.abs(P.y - car.y) < 0.5, 'up on the deck');
});

test('number plates front and back on two-wheelers, tempos and ambulances; the police jeep seats a second officer', () => {
  const plate = (type, rgb) => {
    const g = vehicleModel(type).geos.fixed, pos = g.attributes.position, col = g.attributes.color;
    const all = { lo: Infinity, hi: -Infinity }, on = { lo: Infinity, hi: -Infinity };
    for (let i = 0; i < pos.count; i++) {
      const z = pos.getZ(i);
      all.lo = Math.min(all.lo, z); all.hi = Math.max(all.hi, z);
      if (Math.abs(col.getX(i) - rgb[0]) + Math.abs(col.getY(i) - rgb[1]) + Math.abs(col.getZ(i) - rgb[2]) < 0.01) { on.lo = Math.min(on.lo, z); on.hi = Math.max(on.hi, z); }
    }
    return on.hi > 0 && on.lo < 0 && on.hi > all.hi - 0.35 && on.lo < all.lo + 0.35;
  };
  const WHITE = [0xf4 / 255, 0xf4 / 255, 0xf0 / 255], YELLOW = [0xf2 / 255, 0xc2 / 255, 0x30 / 255];
  for (const type of ['bike', 'scooter', 'ambulance']) assert.ok(plate(type, WHITE), type);
  assert.ok(plate('tempo', YELLOW), 'tempo');
  assert.ok(vehicleModel('police').passengers.length >= 1);
});

test('lamps know what they are: tail lamps and light bars are lit apart from the head lamps', () => {
  const kinds = type => new Set(vehicleModel(type).geos.lights.attributes.lamp.array);
  assert.deepEqual([...kinds('hatch')].sort(), [0, 1]);
  assert.deepEqual([...kinds('police')].sort(), [0, 1, 2]);
  assert.deepEqual([...kinds('ambulance')].sort(), [0, 1, 2]);
});

// ---------------------------------------------------------------- helpers
function still() {
  return { state: { moveX: 0, moveY: 0, sprint: false, throttle: 0, brake: 0, steer: 0, handbrake: false, horn: false }, mode: 'touch', pressed: () => false };
}
function fakeGame(city = FLAT, colliders = OPEN) {
  const V = vehicles(city, colliders);
  return {
    city, net: city.net, colliders, humans: V.humans, vehicles: V, time: 0, energy: 0,
    camera: { facing: 0, reset() {} },
    pushOutOfVehicles() {}, nearestEnterable: () => null, carjack(v) { V.ejectDriver(v); },
  };
}
