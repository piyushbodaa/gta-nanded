import { test } from 'node:test';
import assert from 'node:assert/strict';
import { world, place } from './helpers.js';

test('the street network is one connected graph of polylines', () => {
  const { net } = world();
  assert.ok(net.count > 15000, `expected the full city, got ${net.count} roads`);
  for (let r = 0; r < net.count; r += 97) {
    assert.ok(net.length[r] > 0, `road ${r} has length`);
    assert.ok(net.ra[r] >= 0 && net.rb[r] >= 0);
  }
});

test('every researched place sits on a reachable street', () => {
  const { data, net } = world();
  const station = place(data, 'nanded-station');
  for (const p of data.places) {
    const n = net.nearest(p.ax, p.az, 60, {});
    assert.ok(n && n.dist < 2, `${p.id} approach is on a road`);
  }
  for (const id of ['zenda-chowk', 'hazur-sahib', 'workshop-corner', 'nandgiri-fort', 'vishnupuri-dam', 'nanded-airport']) {
    const p = place(data, id);
    const r = net.route(station.ax, station.az, p.ax, p.az);
    assert.ok(r && r.length > 0, `route station -> ${id}`);
    assert.ok(r.length < 6000, `${id} route is plausible (${r.length.toFixed(0)} m)`);
  }
});

test('routes follow roads: consecutive points are close to the network', () => {
  const { data, net } = world();
  const a = place(data, 'nanded-station'), b = place(data, 'zenda-chowk');
  const r = net.route(a.ax, a.az, b.ax, b.az);
  for (let i = 0; i < r.points.length; i += 2) {
    const n = net.nearest(r.points[i], r.points[i + 1], 10, {});
    assert.ok(n && n.dist < 0.5, 'route point lies on a street');
  }
});

test('traffic keeps left: lane points sit left of the direction of travel', () => {
  const { net } = world();
  const out = {}, centre = {};
  for (let r = 0; r < net.count; r += 211) {
    const s = net.length[r] / 2;
    // A one-way road is only ever driven its own way.
    for (const dir of net.oneway[r] ? [net.oneway[r]] : [1, -1]) {
      net.lanePoint(r, dir, s, net.laneOffset(r), out);
      net.pointAt(r, s, centre);
      const fx = out.dx, fz = out.dz;
      // Left of forward (fx, fz) is (fz, -fx).
      const side = (out.x - centre.x) * fz + (out.z - centre.z) * -fx;
      assert.ok(side > 0, `road ${r} dir ${dir} drives on the left`);
    }
  }
});

test('lane paths shift routes off the centre line', () => {
  const { data, net } = world();
  const a = place(data, 'gandhi-putla'), b = place(data, 'shivaji-putla');
  const r = net.route(a.ax, a.az, b.ax, b.az);
  const lane = net.lanePath(r.points);
  let moved = 0;
  for (let i = 2; i < lane.length - 2; i += 2) if (Math.hypot(lane[i] - r.points[i], lane[i + 1] - r.points[i + 1]) > 0.3) moved++;
  assert.ok(moved > 0);
});
