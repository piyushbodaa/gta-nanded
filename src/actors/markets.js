// The people at the sabzi markets: a seller behind every stall and shoppers haggling at
// some of them, there while you are near. They are part of the scenery, not pedestrians:
// they stay at their stalls.
import { makeOutfit } from './humans.js';
import { rng, hash2 } from '../core/math.js';

const NEAR = 140, FAR = 190;
// How far in front of a stall's middle its shopper stands: the goods reach 0.75 m toward the
// road, and the stall stands 0.95 m back from the road's edge (citygen.js).
const BUYER = 0.95;

export class Markets {
  constructor(game) {
    this.game = game;
    this.markets = game.city.markets || [];
    this.people = new Map(); // market -> its humans, while filled
  }

  update() {
    const g = this.game, pos = g.player.pos;
    for (const m of this.markets) {
      const d = Math.hypot(m.x - pos.x, m.z - pos.z), here = this.people.get(m);
      if (!here && d < NEAR) this.people.set(m, this._fill(m));
      else if (here && d > FAR) { for (const h of here) g.humans.remove(h); this.people.delete(m); }
    }
  }

  _fill(m) {
    const g = this.game, P = g.city.props, out = [];
    for (const i of m.vendors) {
      const r = rng(hash2(i, 5150));
      // A stall's local +z points at the road: the seller stands behind the goods facing it.
      const x = P.x[i], z = P.z[i], rot = P.rot[i], s = Math.sin(rot), c = Math.cos(rot);
      const seller = g.humans.add(makeOutfit(r.pick(['man', 'woman', 'elder', 'woman', 'farmer']), (r() * 1e9) | 0), x - s * 1.2, z - c * 1.2);
      seller.yaw = rot;
      out.push(seller);
      if (r.chance(0.35)) {
        // A shopper at the front of the goods, at the road's edge (on the footpath with the
        // stall, where the street has one), clear of the traffic in the kerb lane.
        const u = r.range(-0.7, 0.7), buyer = g.humans.add(makeOutfit(r.pick(['woman', 'man', 'student', 'elder']), (r() * 1e9) | 0), x + s * BUYER + c * u, z + c * BUYER - s * u);
        buyer.y = P.y[i];
        buyer.yaw = rot + Math.PI;
        if (r.chance(0.3)) buyer.pose = 'phone';
        out.push(buyer);
      }
    }
    return out;
  }
}
