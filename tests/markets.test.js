import { test } from 'node:test';
import assert from 'node:assert/strict';
import { world } from './helpers.js';
import { Markets } from '../src/actors/markets.js';

test('market shoppers stand at the road\'s edge in front of the goods, clear of the traffic', () => {
  const { city, net } = world();
  const g = { city, humans: { add: (outfit, x, z) => ({ outfit, x, y: 0, z, yaw: 0, pose: 'idle' }), remove() {} }, player: { pos: { x: 0, z: 0 } } };
  const markets = new Markets(g), P = city.props;
  let buyers = 0;
  for (const m of markets.markets) {
    const people = markets._fill(m);
    for (const i of m.vendors) {
      const rot = P.rot[i], s = Math.sin(rot), c = Math.cos(rot), road = P.road[i], hw = net.width[road] / 2;
      for (const h of people) {
        // A shopper faces the stall from the road side, within a stall's width of its middle.
        const front = (h.x - P.x[i]) * s + (h.z - P.z[i]) * c, along = (h.x - P.x[i]) * c - (h.z - P.z[i]) * s;
        if (front < 0.5 || front > 1.5 || Math.abs(along) > 0.75) continue;
        buyers++;
        const n = net.nearest(h.x, h.z, 20, {}, r => r === road);
        assert.ok(n.dist > hw - 0.1, `market on road ${road}: a shopper ${(hw - n.dist).toFixed(2)} m into the carriageway`);
        assert.ok(front > 0.75 + 0.15, `in the goods (${front.toFixed(2)} m in front of the stall's middle)`);
        assert.equal(h.y, P.y[i], 'on the footpath with the stall');
      }
    }
  }
  assert.ok(buyers > 50, `${buyers} shoppers`);
});
