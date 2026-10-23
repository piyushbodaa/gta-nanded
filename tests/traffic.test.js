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

test('a car parked in the lane is squeezed past, not queued behind for ever', () => {
  const { net } = world();
  // A long two-way street with one lane each way.
  let road = -1;
  for (let r = 0; r < net.count; r++) if (!net.oneway[r] && !net.bridge[r] && net.width[r] >= 6 && net.width[r] < 9 && net.length[r] > 160) { road = r; break; }
  const p = net.pointAt(road, net.length[road] / 2, {});
  const { g, traffic } = streets(p.x, p.z);
  g.quality.settings.traffic = 0;
  // Parked at the kerb, sticking into the lane.
  const parkedOff = net.width[road] / 2 - 0.95, spot = net.pointAt(road, net.length[road] / 2, {});
  const parked = g.vehicles.spawn('hatch', spot.x + spot.dz * parkedOff, spot.z - spot.dx * parkedOff, Math.atan2(spot.dx, spot.dz), { role: 'parked' });
  // A car coming up behind it in the same lane.
  const s = net.length[road] / 2 - 40, q = net.lanePoint(road, 1, s, net.laneOffset(road, 0, s), {});
  const car = g.vehicles.spawn('sedan', q.x, q.z, q.heading, { role: 'traffic' });
  car.ai = { road, dir: 1, s, lane: 0, speed: 8, cruise: 10, turn: null, wait: 0, blocked: 0, honk: 9, weave: 0, dodge: 0, dodgeWant: 0 };
  traffic.cars.push(car);
  for (let f = 0; f < 30 * 12 && car.ai.road === road; f++) { g.time += 1 / 30; traffic.update(1 / 30); }
  assert.ok(car.ai.road !== road || car.ai.s > net.length[road] / 2 + 6, `the car got past (s ${car.ai.s.toFixed(1)} of ${net.length[road].toFixed(0)})`);
  void parked;
});
