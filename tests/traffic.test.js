import { test } from 'node:test';
import assert from 'node:assert/strict';
import { world, place } from './helpers.js';
import { Traffic } from '../src/actors/traffic.js';
import { createBody } from '../src/actors/vehicle-physics.js';

// India drives on the left. Dual carriageways are mapped as two one-way roads.

test('one-way roads come from the map, and divided roads have the other carriageway on the right', () => {
  const { net } = world();
  let oneway = 0, paired = 0;
  for (let r = 0; r < net.count; r++) {
    if (!net.oneway[r]) continue;
    oneway++;
    if (!net.paired[r]) continue;
    paired++;
    // A carriageway keeps its kerb edge and stops short of the middle on its right.
    const s = net.length[r] / 2, hw = net.width[r] / 2;
    assert.equal(net.edgeAt(r, s, net.oneway[r]), hw, `road ${r} keeps its kerb`);
    assert.ok(net.edgeAt(r, s, -net.oneway[r]) <= hw, `road ${r} ends at its median`);
    assert.equal(net.kerbSide(r), net.oneway[r]);
  }
  assert.ok(oneway > 1000, `${oneway} one-way roads`);
  assert.ok(paired > 1000, `${paired} carriageways of divided roads`);
});

test('lanes stay on their own carriageway: oncoming traffic is always on the right', () => {
  const { net } = world();
  const p = {}, q = {}, n = {};
  let checked = 0;
  for (let r = 0; r < net.count; r += 3) {
    if (!net.paired[r] || net.length[r] < 40) continue;
    const ow = net.oneway[r], s = net.length[r] / 2;
    for (const lane of [0, 1]) {
      net.lanePoint(r, ow, ow > 0 ? s : net.length[r] - s, net.laneOffset(r, lane, s), p);
      net.pointAt(r, s, q);
      // Left of travel is positive: the lane lies between the median edge and the kerb.
      const lat = (p.x - q.x) * p.dz + (p.z - q.z) * -p.dx;
      assert.ok(lat > -net.innerAt(r, s) + 0.9 && lat < net.width[r] / 2 - 0.9, `road ${r} lane ${lane} at ${lat.toFixed(2)} m`);
    }
    // The nearest oncoming lane is on the other side of the median, a lane's width away or more.
    net.lanePoint(r, ow, ow > 0 ? s : net.length[r] - s, net.laneOffset(r, 1, s), p);
    const fx = p.dx, fz = p.dz;
    const other = net.nearest(p.x - fz * (net.innerAt(r, s) * 2 + 1.5), p.z + fx * (net.innerAt(r, s) * 2 + 1.5), 6, n, o => o !== r && net.paired[o] && net.oneway[o] !== 0);
    if (!other) continue;
    const ow2 = net.oneway[other.road];
    if ((other.dx * fx + other.dz * fz) * ow2 > -0.8) continue;
    const s2 = other.s;
    net.lanePoint(other.road, ow2, ow2 > 0 ? s2 : net.length[other.road] - s2, net.laneOffset(other.road, 1, s2), q);
    const right = (q.x - p.x) * -fz + (q.z - p.z) * fx;
    assert.ok(right > 2.4, `road ${r}: oncoming lane ${right.toFixed(2)} m to the right`);
    checked++;
  }
  assert.ok(checked > 100, `checked ${checked} pairs`);
});

test('routes keep to the legal direction of one-way roads', () => {
  const { data, net } = world();
  const ids = ['nanded-station', 'zenda-chowk', 'hazur-sahib', 'workshop-corner', 'nandgiri-fort', 'vishnupuri-dam', 'nanded-airport', 'gandhi-putla', 'shivaji-putla'];
  const n = {};
  let total = 0, wrong = 0;
  for (const a of ids) for (const b of ids) {
    if (a === b) continue;
    const A = place(data, a), B = place(data, b);
    const route = net.route(A.ax, A.az, B.ax, B.az);
    assert.ok(route, `${a} -> ${b}`);
    const P = route.points;
    for (let i = 2; i < P.length; i += 2) {
      const dx = P[i] - P[i - 2], dz = P[i + 1] - P[i - 1], len = Math.hypot(dx, dz);
      if (len < 0.5) continue;
      total += len;
      const m = net.nearest((P[i] + P[i - 2]) / 2, (P[i + 1] + P[i - 1]) / 2, 1, n);
      if (m && net.oneway[m.road] && (m.dx * dx + m.dz * dz) * net.oneway[m.road] < -0.5 * len) wrong += len;
    }
  }
  assert.ok(wrong < total * 0.005, `${wrong.toFixed(0)} of ${total.toFixed(0)} m against the one-way flow`);
});

// A minimal game for the traffic system on the real streets.
function streets(x, z) {
  const { net, city } = world();
  let id = 1;
  const list = [];
  const g = {
    net, city, time: 0, controls: new Map(), quality: { settings: { traffic: 40 } },
    player: { pos: { x, z }, state: 'foot', x, z },
    vehicles: {
      list,
      spawn(type, vx, vz, heading, { role }) { const v = Object.assign(createBody(type, vx, vz, heading), { id: id++, role, kinematic: true, passengers: [] }); list.push(v); return v; },
      remove(v) { list.splice(list.indexOf(v), 1); },
      addPassenger() {},
    },
  };
  return { g, traffic: new Traffic(g) };
}

test('traffic drives one-way carriageways only their way, on the left of the road', () => {
  const { net } = world();
  // Busy divided roads: the station area, Vazirabad and the Nanded-Narsi road.
  let seen = 0;
  for (const [x, z] of [[200, 200], [350, 1790], [195.9, 401.1]]) {
    const { g, traffic } = streets(x, z);
    for (let f = 0; f < 1800; f++) {
      g.time += 1 / 30;
      traffic.update(1 / 30);
      if (f % 15) continue;
      for (const v of traffic.cars) {
        const a = v.ai;
        if (!a || a.turn || !net.oneway[a.road]) continue;
        seen++;
        assert.equal(a.dir, net.oneway[a.road], `car ${v.id} on one-way road ${a.road}`);
        // Heading the way the carriageway runs (once it has settled out of the last turn).
        if (a.s < net.trimStart(a.road) + 8 || a.s > net.length[a.road] - net.trimEnd(a.road)) continue;
        const p = net.pointAt(a.road, a.dir > 0 ? a.s : net.length[a.road] - a.s, {});
        assert.ok((Math.sin(v.heading) * p.dx + Math.cos(v.heading) * p.dz) * a.dir > 0.5, `car ${v.id} faces the flow`);
      }
    }
  }
  assert.ok(seen > 50, `watched ${seen} cars on one-way roads`);
});

test('signals stand at the chowks where main roads cross, and crossing roads never both get green', () => {
  const { data, net } = world();
  const { traffic } = streets(0, 0);
  const crossings = new Set(traffic.signals.values());
  assert.ok(crossings.size > 30 && crossings.size < 120, `${crossings.size} signalled crossings`);
  // The big named chowks are among them.
  for (const id of ['shivaji-putla', 'raj-corner', 'iti-corner']) {
    const p = place(data, id);
    assert.ok([...crossings].some(c => c.junctions.some(j => Math.hypot(net.jx[j] - p.ax, net.jz[j] - p.az) < 60)), `${id} has signals`);
  }
  for (const sig of crossings) {
    // Every road into the crossing, with its light over a whole cycle.
    const into = [];
    for (const j of sig.junctions) for (const r of net.jRoads[j]) if (!traffic._link(sig.junctions, r)) into.push([j, r]);
    for (let t = 0; t < 22; t += 0.5) {
      const green = into.filter(([j, r]) => traffic.signalState(j, r, t) === 'green');
      // Green roads all run along one axis.
      const p = {};
      const bearing = ([j, r]) => { net.pointAt(r, net.ra[r] === j ? 0 : net.length[r], p); return Math.atan2(p.dx, p.dz); };
      for (const a of green) for (const b of green) {
        const d = Math.abs(bearing(a) - bearing(b)) % Math.PI;
        assert.ok(Math.min(d, Math.PI - d) < 1.4, 'roads crossing at a right angle are never green together');
      }
    }
    // Each road sees green, amber and red in turn.
    const [j, r] = into[0];
    const states = new Set();
    for (let t = 0; t < 22; t += 0.25) states.add(traffic.signalState(j, r, t));
    assert.deepEqual([...states].sort(), ['amber', 'green', 'red']);
  }
});

// A traffic car driving `road` in direction dir, s metres along its way.
function driving(g, traffic, type, road, dir, s, ai = {}) {
  const { net } = g, len = net.length[road], lane = ai.lane ?? 0;
  const q = net.lanePoint(road, dir, s, net.laneOffset(road, lane, dir > 0 ? s : len - s) + (ai.weave ?? 0), {});
  const car = g.vehicles.spawn(type, q.x, q.z, q.heading, { role: 'traffic' });
  car.ai = { road, dir, s, lane, speed: 8, cruise: 10, turn: null, wait: 0, blocked: 0, honk: 9, weave: 0, dodge: 0, dodgeWant: 0, ...ai };
  traffic.cars.push(car);
  return car;
}
const run = (g, traffic, seconds, each = () => {}) => {
  for (let f = 0; f < seconds * 30; f++) { g.time += 1 / 30; traffic.update(1 / 30); if (each() === false) break; }
};
// Where b is from a: along a's heading and to its right (+), and whether their bodies overlap.
function beside(a, b) {
  const fx = Math.sin(a.heading), fz = Math.cos(a.heading), dx = b.x - a.x, dz = b.z - a.z;
  const along = dx * fx + dz * fz, right = -dx * fz + dz * fx;
  return { along, right, overlap: Math.abs(along) < a.hd + b.hd && Math.abs(right) < a.hw + b.hw };
}
// Whether two bodies touch, whatever angle they stand at to each other.
function touching(a, b) {
  for (const h of [a.heading, b.heading]) for (const [ax, az] of [[Math.sin(h), Math.cos(h)], [Math.cos(h), -Math.sin(h)]]) {
    const ext = v => Math.abs(Math.sin(v.heading) * ax + Math.cos(v.heading) * az) * v.hd + Math.abs(Math.cos(v.heading) * ax - Math.sin(v.heading) * az) * v.hw;
    if (Math.abs((b.x - a.x) * ax + (b.z - a.z) * az) >= ext(a) + ext(b)) return false;
  }
  return true;
}
// A long, level two-way street with one lane each way and no speed breakers.
function street(net, city, minW, maxW, minLen) {
  for (let r = 0; r < net.count; r++) {
    if (net.oneway[r] || net.bridge[r] || net.raised[r] || net.width[r] < minW || net.width[r] >= maxW || net.length[r] < minLen) continue;
    if (!city.bumps.bumps.some(b => b.road === r)) return r;
  }
  return -1;
}

test('a car parked in the lane is squeezed past on its right, clear of it, not queued behind for ever', () => {
  const { net, city } = world();
  const road = street(net, city, 6, 9, 160), mid = net.length[road] / 2;
  const p = net.pointAt(road, mid, {});
  const { g, traffic } = streets(p.x, p.z);
  g.quality.settings.traffic = 0;
  // Parked at the kerb, sticking into the lane.
  const parkedOff = net.width[road] / 2 - 0.95;
  const parked = g.vehicles.spawn('hatch', p.x + p.dz * parkedOff, p.z - p.dx * parkedOff, Math.atan2(p.dx, p.dz), { role: 'parked' });
  // A car coming up behind it in the same lane.
  const car = driving(g, traffic, 'sedan', road, 1, mid - 40);
  let closest = Infinity;
  run(g, traffic, 12, () => {
    const b = beside(parked, car);
    // Alongside: it goes by towards the middle of the road, with room to spare.
    if (Math.abs(b.along) < car.hd + parked.hd) closest = Math.min(closest, b.right - car.hw - parked.hw);
    return car.ai.road === road;
  });
  assert.ok(car.ai.road !== road || car.ai.s > mid + 6, `the car got past (s ${car.ai.s.toFixed(1)} of ${net.length[road].toFixed(0)})`);
  assert.ok(closest > 0.1, `passed ${closest.toFixed(2)} m clear of it, on its right`);
});

test('a car stalled across the middle of the lane is passed on the road, on its right', () => {
  const { net, city } = world();
  const road = street(net, city, 6, 9, 160), mid = net.length[road] / 2, hw = net.width[road] / 2;
  const p = net.pointAt(road, mid, {});
  const { g, traffic } = streets(p.x, p.z);
  g.quality.settings.traffic = 0;
  // Abandoned a little right of the lane's centre.
  const off = net.laneOffset(road, 0, mid) - 0.3;
  const stalled = g.vehicles.spawn('hatch', p.x + p.dz * off, p.z - p.dx * off, Math.atan2(p.dx, p.dz), { role: 'abandoned' });
  const car = driving(g, traffic, 'sedan', road, 1, mid - 40);
  let hit = false, offRoad = 0, side = 0;
  run(g, traffic, 12, () => {
    const b = beside(stalled, car);
    hit ||= b.overlap;
    if (Math.abs(b.along) < car.hd + stalled.hd) side = Math.sign(b.right);
    // Its body stays between the road's edges.
    const q = net.nearest(car.x, car.z, 8, {});
    if (q.road === road) offRoad = Math.max(offRoad, q.dist + car.hw - hw);
    return car.ai.road === road;
  });
  assert.ok(!hit, 'never drove into it');
  assert.equal(side, 1, 'went round it on the right, by the middle of the road');
  assert.ok(offRoad < 0.05, `stayed on the road (${offRoad.toFixed(2)} m over its edge)`);
  assert.ok(car.ai.road !== road || car.ai.s > mid + 6, 'and got past');
});

test('a scooter nosed onto the footpath is passed by cars and buses in the kerb lane, clear of its tail', () => {
  const { net, city } = world();
  // Two-way roads, wide and 6 m narrow, and a 10 m one-way carriageway: their kerb lanes run close
  // by the two-wheelers parked along them.
  const oneway = net.oneway.findIndex((ow, r) => ow && !net.bridge[r] && !net.raised[r] && net.width[r] >= 10 && net.width[r] < 10.5 && net.length[r] >= 160 && !city.bumps.bumps.some(b => b.road === r));
  for (const road of [street(net, city, 11.5, 13, 160), street(net, city, 6, 6.5, 160), oneway]) {
    assert.ok(road >= 0);
    const mid = net.length[road] / 2, w = net.width[road], side = net.kerbSide(road) || 1;
    for (const type of ['sedan', 'bus']) {
      const p = net.pointAt(road, mid, {});
      const { g, traffic } = streets(p.x, p.z);
      g.quality.settings.traffic = 0;
      // As Parked leaves one: just off the kerb on the traffic's left, nosed in at an angle, its tail out over the road.
      const off = (w / 2 + 0.55) * side, heading = Math.atan2(p.dx, p.dz) + (side > 0 ? 0 : Math.PI) + side * 1.2;
      const scooter = g.vehicles.spawn('scooter', p.x + p.dz * off, p.z - p.dx * off, heading, { role: 'parked' });
      const car = driving(g, traffic, type, road, side, mid - 40);
      let hit = false, slowest = Infinity;
      run(g, traffic, 10, () => {
        hit ||= touching(car, scooter);
        slowest = Math.min(slowest, car.ai.speed);
        return car.ai.road === road && car.ai.s < mid + 8;
      });
      assert.ok(car.ai.road !== road || car.ai.s >= mid + 8, `road ${road}, ${w} m: the ${type} got past (s ${car.ai.s.toFixed(1)})`);
      assert.ok(!hit, `road ${road}, ${w} m: the ${type} never touched it`);
      assert.ok(slowest > 5, `road ${road}, ${w} m: the ${type} kept going (${slowest.toFixed(1)} m/s)`);
    }
  }
});

test('a car left in the middle of a narrow street is squeezed past from both ends, a wheel on the verge if need be', () => {
  const { net, city } = world();
  const road = street(net, city, 4.5, 5.2, 160), len = net.length[road], mid = len / 2, hw = net.width[road] / 2;
  const past = c => c.ai.road !== road || c.ai.s > (c.ai.dir > 0 ? mid : len - mid) + 6;
  for (const across of [0, 0.4, -0.4]) {
    const p = net.pointAt(road, mid, {});
    const { g, traffic } = streets(p.x, p.z);
    g.quality.settings.traffic = 0;
    // On the centre line or a little to one side: no room for a car on either side of it.
    const left = g.vehicles.spawn('hatch', p.x + p.dz * across, p.z - p.dx * across, Math.atan2(p.dx, p.dz), { role: 'abandoned' });
    const cars = [driving(g, traffic, 'sedan', road, 1, mid - 35), driving(g, traffic, 'suv', road, -1, len - mid - 35)];
    let hit = false, over = 0;
    run(g, traffic, 25, () => {
      hit ||= cars.some(c => touching(c, left)) || touching(cars[0], cars[1]);
      for (const c of cars) {
        const q = net.nearest(c.x, c.z, 8, {});
        if (q.road === road) over = Math.max(over, q.dist + c.hw - hw);
      }
      return !cars.every(past);
    });
    assert.ok(cars.every(past), `${across} m off the middle: both got past it`);
    assert.ok(!hit, `${across} m off the middle: nobody touched it or each other`);
    assert.ok(over < 0.5, `no more than a wheel off the road (${over.toFixed(2)} m over its edge)`);
  }
});

test('traffic follows a slow police jeep in its lane instead of driving through it', () => {
  const { net, city } = world();
  const road = street(net, city, 6, 9, 160), mid = net.length[road] / 2;
  const p = net.pointAt(road, mid, {});
  const { g, traffic } = streets(p.x, p.z);
  g.quality.settings.traffic = 0;
  // A physics vehicle (no traffic brain) crawling along the lane at 3 m/s.
  let js = mid - 20;
  const q = net.lanePoint(road, 1, js, net.laneOffset(road, 0, js), {});
  const jeep = g.vehicles.spawn('police', q.x, q.z, q.heading, { role: 'police' });
  jeep.kinematic = false;
  const car = driving(g, traffic, 'sedan', road, 1, mid - 45);
  let hit = false, slowest = Infinity;
  run(g, traffic, 8, () => {
    js += 3 / 30;
    net.lanePoint(road, 1, js, net.laneOffset(road, 0, js), q);
    jeep.vx = (q.x - jeep.x) * 30; jeep.vz = (q.z - jeep.z) * 30; jeep.x = q.x; jeep.z = q.z;
    hit ||= beside(jeep, car).overlap;
    slowest = Math.min(slowest, car.ai.speed);
  });
  assert.ok(!hit, 'never ran into it');
  assert.ok(slowest < 3.5, `slowed to its pace (${slowest.toFixed(1)} m/s)`);
});

test('traffic judges its path by its own width: a bus stops for a car at its side, a bike rides by people on the edge', () => {
  const { net, city } = world();
  // A bus in the kerb lane of a wide two-way road; the player's car stands 1.9 m to its left.
  const wide = street(net, city, 11.5, 13, 160), mid = net.length[wide] / 2;
  let p = net.pointAt(wide, mid, {});
  let { g, traffic } = streets(p.x, p.z);
  g.quality.settings.traffic = 0;
  const off = net.laneOffset(wide, 0, mid) + 1.9;
  const mine = g.vehicles.spawn('hatch', p.x + p.dz * off, p.z - p.dx * off, Math.atan2(p.dx, p.dz), { role: 'player' });
  mine.kinematic = false;
  const bus = driving(g, traffic, 'bus', wide, 1, mid - 40, { cruise: 9, speed: 9 });
  let hit = false;
  run(g, traffic, 10, () => { hit ||= beside(mine, bus).overlap; });
  assert.ok(!hit, 'the bus never sideswiped the car');

  // A bike on a narrow street, keeping well left, passes someone walking at the street's edge.
  const lane = street(net, city, 4.5, 5.2, 160), m2 = net.length[lane] / 2, hw = net.width[lane] / 2;
  p = net.pointAt(lane, m2, {});
  ({ g, traffic } = streets(p.x, p.z));
  g.quality.settings.traffic = 0;
  const walker = { h: { x: p.x + p.dz * (hw + 0.45), z: p.z - p.dx * (hw + 0.45) }, onRoadOk: false };
  g.peds = { forEachNear: (x, z, r, fn) => { if (Math.hypot(walker.h.x - x, walker.h.z - z) < r) fn(walker); } };
  const bike = driving(g, traffic, 'bike', lane, 1, m2 - 35, { weave: 0.4, cruise: 9, speed: 9 });
  let slowest = Infinity;
  run(g, traffic, 6, () => { slowest = Math.min(slowest, bike.ai.speed); return bike.ai.road === lane && bike.ai.s < m2 + 5; });
  assert.ok(slowest > 6, `the bike kept going (${slowest.toFixed(1)} m/s)`);
});

test('a bike waits for a cow sitting across a narrow street, and rides by one standing along its far side', () => {
  const { net, city } = world();
  const road = street(net, city, 4.5, 5.2, 160), mid = net.length[road] / 2;
  const p = net.pointAt(road, mid, {}), along = Math.atan2(p.dx, p.dz);
  // Sat across the middle, its head and rump reaching into both lanes; or standing in the other lane.
  for (const [off, heading, stops] of [[0, along + Math.PI / 2, true], [-1.2, along, false]]) {
    const { g, traffic } = streets(p.x, p.z);
    g.quality.settings.traffic = 0;
    const cow = { cow: true, x: p.x + p.dz * off, z: p.z - p.dx * off, heading };
    g.animals = { forEachNear: (x, z, r, fn) => { if (Math.hypot(cow.x - x, cow.z - z) < r) fn(cow); } };
    const bike = driving(g, traffic, 'bike', road, 1, mid - 30, { cruise: 9, speed: 9 });
    let slowest = Infinity;
    run(g, traffic, 8, () => { slowest = Math.min(slowest, bike.ai.speed); return bike.ai.road === road && bike.ai.s < mid + 5; });
    if (stops) assert.ok(bike.ai.speed < 0.3 && bike.ai.s < mid - 2, `stopped short of the cow (${(bike.ai.s - mid).toFixed(1)} m)`);
    else assert.ok(slowest > 6, `rode by the cow (${slowest.toFixed(1)} m/s)`);
  }
});

// The zebra at a crossing runs from 0.8 to 3.8 m out from the junction's edge (chunks.js).
const ZEBRA_OUT = 3.8;

test('traffic stops at the stop line on red, whichever way it drives the road, its nose short of the zebra', () => {
  const { net, city } = world();
  const { g, traffic } = streets(0, 0);
  g.quality.settings.traffic = 0;
  // Roads driven from b to a into a signalled crossing, whose two ends are trimmed differently.
  let checked = 0;
  for (const [j, sig] of traffic.signals) {
    for (const road of net.jRoads[j]) {
      const len = net.length[road], line = net.trimStart(road);
      if (net.ra[road] !== j || net.rb[road] === j || !net.canTravel(road, -1) || traffic._link(sig.junctions, road)) continue;
      if (line - net.trimEnd(road) < 2.5 || len < 70 || city.bumps.bumps.some(b => b.road === road && b.s < line + 50)) continue;
      // Just as the light turns red: a bike, a car at a main road's speed, and a bus, 40 m out.
      let t = 0;
      while (!(traffic.signalState(j, road, t) === 'red' && traffic.signalState(j, road, t - 0.1) === 'amber')) t += 0.1;
      for (const [type, speed] of [['bike', 12], ['sedan', 17], ['bus', 12]]) {
        g.time = t;
        g.vehicles.list.length = 0; traffic.cars.length = 0;
        const car = driving(g, traffic, type, road, -1, len - line - 40, { speed, cruise: speed });
        g.player.pos = { x: car.x, z: car.z };
        run(g, traffic, 10.5);
        // Measured from the crossing: its nose short of the zebra, not far back from it.
        const nose = len - car.ai.s - car.hd - line;
        assert.ok(car.ai.speed < 0.3 && nose > ZEBRA_OUT && nose < ZEBRA_OUT + 1.5, `road ${road} into junction ${j}: ${type} stopped with its nose ${nose.toFixed(1)} m out`);
      }
      checked++;
    }
  }
  assert.ok(checked >= 4, `checked ${checked} approaches`);
});

test('on amber a car stops short of the zebra if it can, and goes on through if it cannot; it never stops in the crossing', () => {
  const { net, city } = world();
  const { g, traffic } = streets(0, 0);
  g.quality.settings.traffic = 0;
  let checked = 0, stopped = 0, went = 0;
  for (const [j, sig] of traffic.signals) {
    for (const road of net.jRoads[j]) {
      const dir = net.rb[road] === j ? 1 : -1, len = net.length[road];
      if (net.ra[road] === net.rb[road] || !net.canTravel(road, dir) || traffic._link(sig.junctions, road)) continue;
      const end = len - (dir > 0 ? net.trimEnd(road) : net.trimStart(road));
      if (end - (dir > 0 ? net.trimStart(road) : net.trimEnd(road)) < 60 || city.bumps.bumps.some(b => b.road === road && Math.abs((dir > 0 ? b.s : len - b.s) - end) < 50)) continue;
      // Just as the light turns amber, at the speed traffic comes up to a crossing, from close in to well back.
      let t = 0;
      while (!(traffic.signalState(j, road, t) === 'amber' && traffic.signalState(j, road, t - 0.1) === 'green')) t += 0.1;
      for (const type of ['hatch', 'bus']) for (let out = 1; out <= 25; out += 3) {
        g.time = t;
        g.vehicles.list.length = 0; traffic.cars.length = 0;
        const toEnd = out + createBody(type, 0, 0, 0).hd, speed = 5 + toEnd * 0.45;
        const car = driving(g, traffic, type, road, dir, end - toEnd, { speed, cruise: 14 });
        g.player.pos = { x: car.x, z: car.z };
        run(g, traffic, 6, () => !(car.ai.turn || car.ai.road !== road));
        if (car.ai.turn || car.ai.road !== road) { went++; continue; }
        const nose = end - car.ai.s - car.hd;
        assert.ok(car.ai.speed < 0.3 && nose > ZEBRA_OUT, `road ${road} into junction ${j}: a ${type} ${out} m out on amber stopped with its nose ${nose.toFixed(1)} m out`);
        stopped++;
      }
      if (++checked >= 12) break;
    }
    if (checked >= 12) break;
  }
  assert.ok(checked >= 6 && stopped > 10 && went > 10, `${checked} approaches: ${stopped} stopped, ${went} went through`);
});

test('a car that went on through amber and was held up over the line goes on, instead of standing on the zebra through the red', () => {
  const { net } = world();
  const { g, traffic } = streets(0, 0);
  g.quality.settings.traffic = 0;
  let checked = 0;
  for (const [j, sig] of traffic.signals) {
    for (const road of net.jRoads[j]) {
      const dir = net.rb[road] === j ? 1 : -1, len = net.length[road];
      if (net.ra[road] === net.rb[road] || !net.canTravel(road, dir) || traffic._link(sig.junctions, road)) continue;
      const end = len - (dir > 0 ? net.trimEnd(road) : net.trimStart(road));
      if (end - (dir > 0 ? net.trimStart(road) : net.trimEnd(road)) < 30) continue;
      // As the light turns red: crawling over the zebra, its nose a metre short of the crossing,
      // after whoever was ahead held it up there.
      let t = 0;
      while (!(traffic.signalState(j, road, t) === 'red' && traffic.signalState(j, road, t - 0.1) === 'amber')) t += 0.1;
      g.time = t;
      g.vehicles.list.length = 0; traffic.cars.length = 0;
      const car = driving(g, traffic, 'hatch', road, dir, end - createBody('hatch', 0, 0, 0).hd - 1, { speed: 0.5, goOn: j });
      g.player.pos = { x: car.x, z: car.z };
      run(g, traffic, 4, () => !(car.ai.turn || car.ai.road !== road));
      assert.ok(car.ai.turn || car.ai.road !== road, `road ${road} into junction ${j}: it stood on the zebra through the red`);
      if (++checked >= 8) break;
    }
    if (checked >= 8) break;
  }
  assert.ok(checked >= 8, `checked ${checked} approaches`);
});

test('turning onto a short road with a red light at its far end, a car slows in the turn and stops short of the zebra', () => {
  const { net, city } = world();
  const { g, traffic } = streets(0, 0);
  g.quality.settings.traffic = 0;
  let checked = 0;
  for (const [j, sig] of traffic.signals) {
    for (const road of net.jRoads[j]) {
      // A link of 8-11 m of lane between two junctions, the far one signalled.
      const dir = net.rb[road] === j ? 1 : -1, len = net.length[road], lane = len - net.trimStart(road) - net.trimEnd(road);
      if (net.ra[road] === net.rb[road] || !net.canTravel(road, dir) || traffic._link(sig.junctions, road)) continue;
      if (lane < 8 || lane > 11 || city.bumps.bumps.some(b => b.road === road)) continue;
      const k = dir > 0 ? net.ra[road] : net.rb[road];
      const from = net.jRoads[k].find(r => r !== road && net.ra[r] !== net.rb[r] && !net.bridge[r] && net.canTravel(r, net.rb[r] === k ? 1 : -1));
      if (from === undefined) continue;
      // A hatch at the end of a road into the near junction, taking the turn onto the link.
      const fdir = net.rb[from] === k ? 1 : -1, fend = net.length[from] - (fdir > 0 ? net.trimEnd(from) : net.trimStart(from));
      g.vehicles.list.length = 0; traffic.cars.length = 0;
      const car = driving(g, traffic, 'hatch', from, fdir, fend, { speed: 6, cruise: 14 });
      let onto = false;
      for (let t = 0; t < 40 && !onto; t += 1 / 3) { g.time = t; car.ai.turn = null; onto = traffic._chooseTurn(car, k) && car.ai.turn.road === road; }
      if (!onto) continue;
      // The light ahead has just turned red.
      let t = 0;
      while (!(traffic.signalState(j, road, t) === 'red' && traffic.signalState(j, road, t - 0.1) === 'amber')) t += 0.1;
      g.time = t; g.player.pos = { x: car.x, z: car.z };
      run(g, traffic, 8);
      const nose = len - (dir > 0 ? net.trimEnd(road) : net.trimStart(road)) - car.ai.s - car.hd;
      assert.ok(car.ai.road === road && car.ai.speed < 0.3 && nose > ZEBRA_OUT, `road ${road} into junction ${j}: stopped with its nose ${nose.toFixed(1)} m out`);
      if (++checked >= 6) break;
    }
    if (checked >= 6) break;
  }
  assert.ok(checked >= 6, `checked ${checked} links`);
});

test('cars through busy chowks keep moving: each turn starts at its own road\'s end, with no jumps, and nobody waits for ever', () => {
  const { data, net } = world();
  let turns = 0;
  for (const id of ['shivaji-putla', 'nanded-station']) {
    const P = place(data, id);
    const { g, traffic } = streets(P.ax, P.az);
    const choose = traffic._chooseTurn.bind(traffic);
    traffic._chooseTurn = (v, j) => {
      const a = v.ai;
      assert.equal(j, a.dir > 0 ? net.rb[a.road] : net.ra[a.road], `car ${v.id} turns at the junction its road ends at`);
      const ok = choose(v, j);
      if (ok) turns++;
      return ok;
    };
    const last = new Map(), moved = new Map();
    run(g, traffic, 100, () => {
      for (const v of traffic.cars) {
        const p = last.get(v);
        if (p) assert.ok(Math.hypot(v.x - p[0], v.z - p[1]) < 6, `car ${v.id} jumped`);
        last.set(v, [v.x, v.z]);
        if (!moved.has(v) || v.ai.speed > 0.3) moved.set(v, g.time);
      }
    });
    const stuck = traffic.cars.filter(v => g.time - moved.get(v) > 45);
    assert.ok(stuck.length <= traffic.cars.length * 0.1, `${id}: ${stuck.length} of ${traffic.cars.length} cars stood still for over 45 s`);
  }
  assert.ok(turns > 500, `${turns} turns`);
});

test('a one-way carriageway that just ends sends traffic over to the other one, never back against the flow', () => {
  const { net } = world();
  let ends = 0;
  for (let r = 0; r < net.count; r++) {
    const ow = net.oneway[r];
    if (!ow) continue;
    const j = ow > 0 ? net.rb[r] : net.ra[r];
    if (net.jRoads[j].some(o => o !== r && net.canTravel(o, net.ra[o] === j ? 1 : -1))) continue;
    const { g, traffic } = streets(net.jx[j], net.jz[j]);
    g.quality.settings.traffic = 0;
    const len = net.length[r], end = len - (ow > 0 ? net.trimEnd(r) : net.trimStart(r));
    const car = driving(g, traffic, 'sedan', r, ow, end - 0.5);
    run(g, traffic, 1, () => !car.ai.turn);
    const T = car.ai.turn;
    assert.ok(T, `car at the end of road ${r} found a way on`);
    assert.ok(T.road !== r && net.canTravel(T.road, T.dir), `road ${r}: carries on along road ${T.road} the legal way`);
    ends++;
  }
  assert.ok(ends > 0, 'there are such ends on the map');
});

test('a crashed car rejoins the road on its own level: a flyover\'s deck, or the street under it', () => {
  const { net } = world();
  const q = {}, p = {}, c = {};
  // A lane point high on a deck whose nearest road on the map (seen from above) is a street below,
  // and a spot on the ground under a deck whose nearest road is the deck.
  let deck = null, under = null;
  for (let r = 0; r < net.count && !(deck && under); r++) {
    if (!net.raised[r]) continue;
    const dir = net.oneway[r] || 1;
    for (let s = 5; s < net.length[r] - 5; s += 3) {
      const at = dir > 0 ? s : net.length[r] - s, h = net.deckAt(r, at);
      if (h < 4) continue;
      net.lanePoint(r, dir, s, net.laneOffset(r, 0, at), p);
      const n = net.nearest(p.x, p.z, 6, q);
      if (!deck && n && !net.raised[n.road]) deck = { x: p.x, z: p.z, y: h, heading: p.heading };
      const m = net.nearest(p.x, p.z, 6, {}, o => !net.raised[o]);
      if (under || !m) continue;
      // Between that street and the deck's centre line.
      net.pointAt(r, at, c);
      const x = (m.x + c.x) / 2, z = (m.z + c.z) / 2;
      if (net.raised[net.nearest(x, z, 6, q).road]) under = { x, z, y: 0, heading: Math.atan2(m.dx, m.dz) };
    }
  }
  assert.ok(deck && under, 'found both');
  for (const at of [deck, under]) {
    const { g, traffic } = streets(at.x, at.z);
    g.quality.settings.traffic = 0;
    const car = g.vehicles.spawn('hatch', at.x, at.z, at.heading, { role: 'traffic' });
    Object.assign(car, { y: at.y, kinematic: false, stunned: 0 });
    car.ai = { road: 0, dir: 1, s: 0, lane: 0, speed: 0, cruise: 10, turn: null, wait: 0, blocked: 0, honk: 9, weave: 0, dodge: 0, dodgeWant: 0 };
    traffic.cars.push(car);
    run(g, traffic, 0.1);
    const a = car.ai;
    assert.ok(car.kinematic && a, 'back in traffic');
    const y = net.deckAt(a.road, a.dir > 0 ? a.s : net.length[a.road] - a.s);
    assert.ok(Math.abs(y - at.y) < 1.5, `rejoined road ${a.road} at ${y.toFixed(1)} m, from ${at.y.toFixed(1)} m`);
  }
});

test('wrecked and stranded cars stop counting as traffic; a stranded one keeps its driver until it is towed', async () => {
  const { net, city } = world();
  const { Parked } = await import('../src/actors/traffic.js');
  // Somewhere well away from any road.
  let x = 0, z = 0;
  for (let k = 1; net.nearest(x, z, 12, {}); k++) { x = Math.cos(k) * k * 7; z = Math.sin(k) * k * 7; }
  const { g, traffic } = streets(x, z);
  g.quality.settings.traffic = 1;
  const stranded = g.vehicles.spawn('hatch', x, z, 0, { role: 'traffic' }), wreck = g.vehicles.spawn('sedan', x + 30, z, 0, { role: 'traffic' });
  for (const v of [stranded, wreck]) {
    Object.assign(v, { kinematic: false, stunned: 0, driver: { seated: true } });
    v.ai = { road: 0, dir: 1, s: 0, lane: 0, speed: 0, cruise: 10, turn: null, wait: 0, blocked: 0, honk: 9 };
    traffic.cars.push(v);
  }
  wreck.wrecked = true;
  traffic.update(1 / 30); traffic.update(1 / 30);
  assert.ok(!traffic.cars.includes(stranded) && !traffic.cars.includes(wreck), 'neither holds a place in traffic');
  assert.ok(g.vehicles.list.includes(stranded) && g.vehicles.list.includes(wreck), 'both still stand there');
  assert.equal(stranded.ai, null);
  assert.equal(stranded.role, 'traffic', 'its driver still owns it: taking it is a carjacking');
  assert.ok(stranded.driver);
  // Towed once the player is well away.
  Object.assign(g, { colliders: { blocked: () => true } });
  g.player.pos = { x: x + 400, z };
  new Parked(g).update(1);
  assert.ok(!g.vehicles.list.includes(stranded) && !g.vehicles.list.includes(wreck), 'both towed');
  void city;
});

test('parked two-wheelers stand on the footpath they are nosed onto, not sunk into it', async () => {
  const { data, net, city } = world();
  const { Parked } = await import('../src/actors/traffic.js');
  const { pointSegDist2 } = await import('../src/core/math.js');
  let raised = 0;
  for (const id of ['shivaji-putla', 'raj-corner', 'nanded-station']) {
    const P = place(data, id);
    const { g } = streets(P.ax, P.az);
    Object.assign(g, { colliders: { blocked: () => false } });
    const parked = new Parked(g);
    parked.update(1);
    for (const [seg, v] of parked.bySeg) {
      if (!v.spec.two) continue;
      const half = v.spec.wheelbase / 2;
      for (const end of [1, -1]) {
        // Each wheel: what it stands over, and how high its tyre's foot is.
        const wx = v.x + Math.sin(v.heading) * half * end, wz = v.z + Math.cos(v.heading) * half * end;
        const across = Math.sqrt(pointSegDist2(wx, wz, net.px[seg], net.pz[seg], net.px[seg + 1], net.pz[seg + 1]));
        const under = city.pavementAt(seg, across), foot = v.y + Math.sin(v.bumpPitch || 0) * half * end;
        if (under > 0) raised++;
        assert.ok(foot > under - 0.03, `${v.type} at ${id}: a wheel ${(under - foot).toFixed(2)} m into the footpath`);
      }
    }
  }
  assert.ok(raised > 5, `${raised} wheels up on footpaths`);
});

test('signal poles stand on the kerb, clear of every carriageway at the crossing', async () => {
  const { net } = world();
  const { Signals } = await import('../src/world/signals.js');
  const { traffic } = streets(0, 0);
  const posts = [];
  const signals = new Signals({ add() {} }, net, traffic, { addCircle: (x, z) => posts.push([x, z]) });
  assert.equal(posts.length, signals.heads.length, 'one post per light');
  for (const h of signals.heads) {
    // Standing off the road surface, unless a flyover deck passes high over it.
    assert.ok(net.roadClearance(h.x, h.z, 12) > 0.12 || net.deckOver(h.x, h.z) >= 5, `the pole for road ${h.road} at junction ${h.j} stands in a carriageway`);
  }
  // Every signalled crossing still shows its lights, and nearly every road into one has its own pole.
  let roads = 0;
  for (const sig of new Set(traffic.signals.values())) {
    assert.ok(signals.heads.some(h => sig.junctions.includes(h.j)), `crossing at junction ${sig.junctions[0]} has a pole`);
    for (const j of sig.junctions) for (const r of net.jRoads[j]) if (net.ra[r] !== net.rb[r] && net.canTravel(r, net.rb[r] === j ? 1 : -1) && !traffic._link(sig.junctions, r)) roads++;
  }
  assert.ok(signals.heads.length > roads * 0.9, `${signals.heads.length} of ${roads} roads into crossings have a pole`);
});

test('traffic slows to a crawl over speed breakers', () => {
  const { net, city } = world();
  // A two-way street with a breaker well clear of its ends.
  const b = city.bumps.bumps.find(o => !net.oneway[o.road] && o.s > 60 && net.length[o.road] - o.s > 30);
  const { g, traffic } = streets(b.x, b.z);
  g.quality.settings.traffic = 0;
  const s = b.s - 45, q = net.lanePoint(b.road, 1, s, net.laneOffset(b.road, 0, s), {});
  const car = g.vehicles.spawn('sedan', q.x, q.z, q.heading, { role: 'traffic' });
  car.ai = { road: b.road, dir: 1, s, lane: 0, speed: 11, cruise: 12, turn: null, wait: 0, blocked: 0, honk: 9, weave: 0, dodge: 0, dodgeWant: 0 };
  traffic.cars.push(car);
  let over = Infinity, lifted = 0;
  for (let f = 0; f < 30 * 10 && car.ai.road === b.road && car.ai.s < b.s + 8; f++) {
    g.time += 1 / 30; traffic.update(1 / 30);
    if (Math.abs(car.ai.s - b.s) < 1) { over = Math.min(over, car.ai.speed); lifted = Math.max(lifted, car.y); }
  }
  assert.ok(over < 4, `crossed at ${over.toFixed(1)} m/s`);
  assert.ok(lifted > 0.03, 'and rode up over it');
});
